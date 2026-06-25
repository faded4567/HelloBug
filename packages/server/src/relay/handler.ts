import { createPublicKey, type KeyObject, verify } from "node:crypto";

import {
  createEnvelopeSigningPayload,
  type ErrorCode,
  type Envelope,
  type Message,
} from "@hellobug/protocol";
import { WebSocket, type RawData } from "ws";

import type { AppDeviceRecord } from "../auth/device-registry.js";
import type { ServerServices } from "../lib/services.js";
import { decodeRelayFrame, sendRelayMessage } from "./framing.js";
import {
  AppToDaemonMessageTypes,
  DaemonBroadcastMessageTypes,
  getSessionId,
} from "./message-types.js";
import { sendJson } from "./socket.js";

export class RelayConnectionHandler {
  private daemonDeviceId: string | null = null;
  private appDeviceId: string | null = null;
  private receiveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly socket: WebSocket,
    private readonly services: ServerServices,
  ) {}

  sendServerHello(): void {
    sendJson(this.socket, {
      type: "server.hello",
      payload: {
        protocol_version: 1,
        server_id: "hellobug-server",
        ts: Date.now(),
        min_client_version: 1,
      },
    });
  }

  async handleRawMessage(raw: RawData): Promise<void> {
    this.receiveQueue = this.receiveQueue
      .then(() => this.processRawMessage(raw))
      .catch((error) => {
        console.error("[relay] inbound message error", error);
      });
    await this.receiveQueue;
  }

  private async processRawMessage(raw: RawData): Promise<void> {
    try {
      const decoded = decodeRelayFrame(this.socket, raw);
      await this.assertEnvelopeSignature(decoded.message, decoded.envelope);
      const parsed = decoded.message;
      console.log(`[relay] recv <- ${parsed.type}`);
      await this.handleMessage(parsed, decoded.forwardEnvelope);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid message";
      this.sendError("relay", "AUTH_INVALID", message);
    }
  }

  handleClose(): void {
    this.services.pairing.clearAppSocket(this.socket);

    if (this.appDeviceId) {
      this.services.relayRegistry.detachApp(this.appDeviceId, this.socket);
    }

    if (!this.daemonDeviceId) {
      return;
    }

    this.services.relayRegistry.unregisterDaemon(
      this.daemonDeviceId,
      this.socket,
    );
    this.services.pendingDangers.removeForDaemon(this.daemonDeviceId);
    this.services.pairing.clearDaemon(this.daemonDeviceId);
    this.services.sessionRegistry.clearDaemon(this.daemonDeviceId);
    this.services.presence.markOffline(this.daemonDeviceId);
    this.broadcastPresence(this.daemonDeviceId);
  }

  private async handleMessage(
    message: Message,
    forwardEnvelope?: Envelope,
  ): Promise<void> {
    if (message.type === "auth.attach" || message.type === "auth.refresh") {
      await this.handleAuthMessage(message);
      return;
    }

    if (message.type === "daemon.hello") {
      this.handleDaemonHello(message);
      return;
    }

    if (message.type === "device.pair.ready") {
      this.handlePairReady(message);
      return;
    }

    if (message.type === "device.pair") {
      this.handlePairStart(message, forwardEnvelope);
      return;
    }

    if (message.type === "device.pair.sas") {
      this.handlePairSas(message, forwardEnvelope);
      return;
    }

    if (message.type === "device.pair.confirm") {
      await this.handlePairConfirm(message, forwardEnvelope);
      return;
    }

    if (message.type === "session.resume") {
      this.handleSessionResume(message);
      return;
    }

    if (message.type === "device.push_token") {
      await this.handleDevicePushToken(message);
      return;
    }

    if (this.isDaemonRelayResponse(message)) {
      if (DaemonBroadcastMessageTypes.has(message.type) && !getSessionId(message)) {
        this.handleDaemonBroadcast(message, forwardEnvelope);
        return;
      }

      this.handleDaemonToAppMessage(message, forwardEnvelope);
      return;
    }

    if (message.type === "key.ratchet" || message.type === "key.ratchet_ack") {
      if (this.daemonDeviceId && !this.appDeviceId) {
        this.handleDaemonToAppMessage(message, forwardEnvelope);
        return;
      }

      this.handleAppToDaemonMessage(message, forwardEnvelope);
      return;
    }

    if (AppToDaemonMessageTypes.has(message.type)) {
      this.handleAppToDaemonMessage(message, forwardEnvelope);
      return;
    }

    if (
      message.type === "session.start.result" ||
      message.type === "session.event" ||
      message.type === "danger.pending" ||
      message.type === "danger.result" ||
      message.type === "replay.done"
    ) {
      this.handleDaemonToAppMessage(message, forwardEnvelope);
      return;
    }

    if (DaemonBroadcastMessageTypes.has(message.type)) {
      const sessionId = getSessionId(message);
      if (sessionId) {
        this.handleDaemonToAppMessage(message, forwardEnvelope);
        return;
      }
      this.handleDaemonBroadcast(message, forwardEnvelope);
      return;
    }

    this.sendError(
      message.type,
      "PROTOCOL_VERSION",
      `Unsupported relay message: ${message.type}`,
    );
  }

  private async handleAuthMessage(
    message: Extract<Message, { type: "auth.attach" | "auth.refresh" }>,
  ): Promise<void> {
    try {
      const verified = await this.services.jwtManager.verify(
        message.payload.jwt,
      );
      const appDevice = this.services.deviceRegistry.getAppDevice(
        verified.deviceId,
      );
      if (!appDevice) {
        this.sendError(message.type, "AUTH_INVALID", "Unknown app device");
        return;
      }
      if (this.services.deviceRegistry.isRevoked(appDevice.deviceId)) {
        this.sendError(message.type, "DEVICE_REVOKED", "Device revoked");
        return;
      }

      if (message.type === "auth.attach") {
        if (this.appDeviceId && this.appDeviceId !== appDevice.deviceId) {
          this.services.relayRegistry.detachApp(this.appDeviceId, this.socket);
        }
        this.appDeviceId = appDevice.deviceId;
        this.services.relayRegistry.attachApp(appDevice.deviceId, this.socket);
      }

      const refreshed = await this.services.jwtManager.issue(
        appDevice.deviceId,
      );
      this.sendToSelf({
        v: 1,
        type: "auth.token",
        payload: {
          jwt: refreshed.jwt,
          expires_at: refreshed.expiresAt,
        },
      });

      if (message.type === "auth.attach") {
        this.sendCurrentPresence(appDevice.deviceId);
        this.replayPendingDangers(appDevice.deviceId);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Invalid JWT";
      this.sendError(message.type, "AUTH_INVALID", text);
    }
  }

  private handleDaemonHello(
    message: Extract<Message, { type: "daemon.hello" }>,
  ): void {
    const daemonDevice = this.services.deviceRegistry.getDaemonDevice(
      message.payload.device_id,
    );
    if (!daemonDevice) {
      this.sendError(message.type, "AUTH_INVALID", "Unknown daemon device");
      this.socket.close();
      return;
    }
    if (this.services.deviceRegistry.isRevoked(daemonDevice.deviceId)) {
      this.sendError(message.type, "DEVICE_REVOKED", "Device revoked");
      this.socket.close();
      return;
    }

    this.daemonDeviceId = daemonDevice.deviceId;
    this.services.relayRegistry.registerDaemon(
      daemonDevice.deviceId,
      this.socket,
    );
    this.services.presence.markOnline(
      daemonDevice.deviceId,
      daemonDevice.machineName ?? "unknown",
    );
    this.broadcastPresence(daemonDevice.deviceId);
  }

  private handlePairReady(
    message: Extract<Message, { type: "device.pair.ready" }>,
  ): void {
    if (!this.daemonDeviceId) {
      this.sendError(
        message.type,
        "AUTH_INVALID",
        "daemon.hello required first",
      );
      return;
    }

    console.log(
      `[relay] pairing ready daemon=${this.daemonDeviceId} code=${message.payload.pairing_code} pairing_id=${message.payload.pairing_id}`,
    );
    this.services.pairing.registerReady(this.daemonDeviceId, message.payload);
  }

  private handlePairStart(
    message: Extract<Message, { type: "device.pair" }>,
    forwardEnvelope?: Envelope,
  ): void {
    console.log(
      `[relay] pairing start code=${message.payload.pairing_code} app_device=${message.payload.app_device_name ?? "unknown"}`,
    );
    const attempt = this.services.pairing.startAttempt({
      appSocket: this.socket,
      pairingCode: message.payload.pairing_code,
      appPubKey: message.payload.app_pubkey,
      appEd25519PubKey: message.payload.app_ed25519_pubkey,
      appDeviceName: message.payload.app_device_name,
      serverUrl: message.payload.server_url,
    });

    if (!attempt) {
      this.sendError(
        message.type,
        "SESSION_NOT_FOUND",
        "Pairing slot not found or expired",
      );
      return;
    }
    console.log(
      `[relay] pairing routed code=${message.payload.pairing_code} daemon=${attempt.daemonDeviceId}`,
    );

    const daemonSocket = this.services.relayRegistry.getDaemon(
      attempt.daemonDeviceId,
    );
    if (!daemonSocket) {
      this.services.pairing.completeAttemptForAppSocket(this.socket);
      this.sendError(
        message.type,
        "SESSION_NOT_FOUND",
        "Target daemon is offline",
      );
      return;
    }

    this.sendToSocket(daemonSocket, message, {
      to: attempt.daemonDeviceId,
      sourceEnvelope: forwardEnvelope,
    });
  }

  private handlePairSas(
    message: Extract<Message, { type: "device.pair.sas" }>,
    forwardEnvelope?: Envelope,
  ): void {
    if (!this.daemonDeviceId) {
      this.sendError(
        message.type,
        "AUTH_INVALID",
        "Unregistered daemon connection",
      );
      return;
    }

    const attempt = this.services.pairing.getAttemptByDaemonDeviceId(
      this.daemonDeviceId,
    );
    if (!attempt) {
      this.sendError(
        message.type,
        "SESSION_NOT_FOUND",
        "No pairing attempt waiting for SAS",
      );
      return;
    }

    this.services.deviceRegistry.updateDaemonMetadata(this.daemonDeviceId, {
      machineName: message.payload.machine_name,
      os: message.payload.os,
    });
    console.log(
      `[relay] pairing sas daemon=${this.daemonDeviceId} machine=${message.payload.machine_name} os=${message.payload.os}`,
    );
    this.services.presence.markOnline(
      this.daemonDeviceId,
      message.payload.machine_name,
    );
    void this.services.persistState();
    this.sendToSocket(attempt.appSocket, message, {
      from: this.daemonDeviceId,
      sourceEnvelope: forwardEnvelope,
    });
  }

  private async handlePairConfirm(
    message: Extract<Message, { type: "device.pair.confirm" }>,
    forwardEnvelope?: Envelope,
  ): Promise<void> {
    console.log(
      `[relay] pairing confirm confirmed=${message.payload.confirmed}`,
    );
    const attempt = this.services.pairing.getAttemptByAppSocket(this.socket);
    if (!attempt) {
      this.sendError(
        message.type,
        "SESSION_NOT_FOUND",
        "No active pairing attempt",
      );
      return;
    }
    if (message.payload.confirmed && !message.payload.noise_handshake) {
      this.sendError(
        message.type,
        "PROTOCOL_VERSION",
        "device.pair.confirm requires noise_handshake when confirmed=true",
      );
      return;
    }

    const daemonSocket = this.services.relayRegistry.getDaemon(
      attempt.daemonDeviceId,
    );
    if (!daemonSocket) {
      this.sendError(
        message.type,
        "SESSION_NOT_FOUND",
        "Target daemon is offline",
      );
      return;
    }

    this.sendToSocket(daemonSocket, message, {
      to: attempt.daemonDeviceId,
      sourceEnvelope: forwardEnvelope,
    });
    this.services.pairing.completeAttemptForAppSocket(this.socket);

    if (!message.payload.confirmed) {
      return;
    }

    const appDevice = this.services.deviceRegistry.registerAppDevice({
      linkedDaemonId: attempt.daemonDeviceId,
      appPubKey: attempt.appPubKey,
      appEd25519PubKey: attempt.appEd25519PubKey,
      appDeviceName: attempt.appDeviceName,
    });

    if (this.appDeviceId && this.appDeviceId !== appDevice.deviceId) {
      this.services.relayRegistry.detachApp(this.appDeviceId, this.socket);
    }
    this.appDeviceId = appDevice.deviceId;
    this.services.relayRegistry.attachApp(appDevice.deviceId, this.socket);
    console.log(
      `[relay] pairing linked app=${appDevice.deviceId} daemon=${attempt.daemonDeviceId}`,
    );

    const jwt = await this.services.jwtManager.issue(appDevice.deviceId);
    await this.services.persistState();
    this.sendToSelf({
      v: 1,
      type: "auth.token",
      payload: {
        jwt: jwt.jwt,
        expires_at: jwt.expiresAt,
      },
    });
    this.sendCurrentPresence(appDevice.deviceId);
  }

  private handleSessionResume(
    message: Extract<Message, { type: "session.resume" }>,
  ): void {
    if (!this.appDeviceId) {
      this.sendError(message.type, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    console.log(
      `[relay] session resume session=${message.payload.session_id} last_seq=${message.payload.last_seq}`,
    );
    const session = this.services.sessionRegistry.get(message.payload.session_id);
    if (!session || session.appDeviceId !== this.appDeviceId) {
      this.sendToSelf({
        v: 1,
        type: "replay.done",
        payload: {
          session_id: message.payload.session_id,
          replayed_count: 0,
          current_seq: message.payload.last_seq,
          status: "session_not_found",
          message: "Session not found for replay",
        },
      });
      return;
    }

    const replay = this.services.replayBuffer.replay(
      message.payload.session_id,
      message.payload.last_seq,
    );

    for (const replayEntry of replay.entries) {
      this.sendToSelf(replayEntry.message, {
        sourceEnvelope: replayEntry.envelope,
      });
    }

    this.sendToSelf({
      v: 1,
      type: "replay.done",
      payload: {
        session_id: message.payload.session_id,
        replayed_count: replay.replayedCount,
        current_seq: replay.currentSeq,
        status: "ok",
        message: "Replay complete",
      },
    });
  }

  private async handleDevicePushToken(
    message: Extract<Message, { type: "device.push_token" }>,
  ): Promise<void> {
    if (!this.appDeviceId) {
      this.sendError(message.type, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    const updated =
      message.payload.platform === "ios"
        ? this.services.deviceRegistry.updateAppPushToken(this.appDeviceId, {
            platform: "ios",
            apnsToken: message.payload.apns_token,
          })
        : this.services.deviceRegistry.updateAppPushToken(this.appDeviceId, {
            platform: "android",
            manufacturer: message.payload.manufacturer,
            vendorToken: message.payload.vendor_token,
          });

    if (!updated) {
      this.sendError(message.type, "AUTH_INVALID", "Unknown app device");
      return;
    }

    await this.services.persistState();
  }

  private handleAppToDaemonMessage(
    message: Message,
    forwardEnvelope?: Envelope,
  ): void {
    if (!this.appDeviceId) {
      if (message.type === "session.start") {
        this.sendSessionStartRejected(
          message,
          "AUTH_INVALID",
          "App is not authenticated",
        );
        return;
      }
      this.sendError(message.type, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    const daemonId = this.resolveDaemonForAppMessage(this.appDeviceId, message);
    if (!daemonId) {
      if (message.type === "session.start") {
        this.sendSessionStartRejected(
          message,
          "SESSION_NOT_FOUND",
          "Session is not registered",
        );
        return;
      }
      this.sendError(
        message.type,
        "SESSION_NOT_FOUND",
        "Session is not registered",
      );
      return;
    }

    const daemonSocket = this.services.relayRegistry.getDaemon(daemonId);
    if (!daemonSocket) {
      if (message.type === "session.start") {
        this.sendSessionStartRejected(
          message,
          "SESSION_NOT_FOUND",
          "Target daemon is offline",
        );
        return;
      }
      this.sendError(
        message.type,
        "SESSION_NOT_FOUND",
        "Target daemon is offline",
      );
      return;
    }

    if (message.type === "session.start") {
      this.services.sessionRegistry.beginPendingStart(
        message.payload.session_id,
        this.appDeviceId,
        daemonId,
        message.id ?? `${message.type}:${Date.now()}`,
      );
      console.log(
        `[relay] session start pending session=${message.payload.session_id} app=${this.appDeviceId} daemon=${daemonId} workspace=${message.payload.workspace_path} agent=${message.payload.agent_type}`,
      );
    } else if (
      "session_id" in message.payload &&
      typeof message.payload.session_id === "string"
    ) {
      console.log(
        `[relay] route app->daemon type=${message.type} session=${message.payload.session_id} daemon=${daemonId}`,
      );
    }

    if (message.type === "danger.allow" || message.type === "danger.deny") {
      this.services.pendingDangers.remove(message.payload.danger_id);
    }

    this.sendToSocket(daemonSocket, message, {
      to: daemonId,
      sourceEnvelope: forwardEnvelope,
    });
  }

  private handleDaemonToAppMessage(
    message: Message,
    forwardEnvelope?: Envelope,
  ): void {
    if (!this.daemonDeviceId) {
      this.sendError(
        message.type,
        "AUTH_INVALID",
        "Unregistered daemon connection",
      );
      return;
    }

    if (message.type === "session.start.result") {
      const pending = this.services.sessionRegistry.getPending(
        message.payload.session_id,
      );
      const targetAppDeviceId =
        pending?.appDeviceId ??
        this.resolveAppOwnerForSession(message.payload.session_id);
      if (message.payload.status === "started") {
        this.services.sessionRegistry.confirmPendingStart(
          message.payload.session_id,
        );
      } else {
        this.services.sessionRegistry.discardPendingStart(
          message.payload.session_id,
        );
      }
      console.log(
        `[relay] route daemon->app type=session.start.result session=${message.payload.session_id} status=${message.payload.status}`,
      );
      this.routeDaemonMessageToApp(
        this.daemonDeviceId,
        message,
        forwardEnvelope,
        targetAppDeviceId ?? undefined,
      );
      return;
    }

    if (message.type === "session.event") {
      this.services.replayBuffer.append(message, forwardEnvelope);
      console.log(
        `[relay] route daemon->app type=session.event session=${message.payload.session_id} seq=${message.payload.seq} event=${message.payload.event.event_type}`,
      );
    } else if (message.type === "danger.pending") {
      const appDeviceId = this.resolveAppOwnerForSession(message.payload.session_id);
      if (appDeviceId) {
        this.services.pendingDangers.upsert(
          appDeviceId,
          this.daemonDeviceId,
          message,
          forwardEnvelope,
        );
      }
      console.log(
        `[relay] route daemon->app type=danger.pending session=${message.payload.session_id} danger=${message.payload.danger_id}`,
      );
    } else if (message.type === "danger.result") {
      this.services.pendingDangers.remove(message.payload.danger_id);
      console.log(
        `[relay] route daemon->app type=danger.result session=${message.payload.session_id} danger=${message.payload.danger_id} status=${message.payload.status}`,
      );
    } else if (
      message.type === "key.ratchet" ||
      message.type === "key.ratchet_ack"
    ) {
      console.log(
        `[relay] route daemon->app type=${message.type} session=${message.payload.session_id}`,
      );
    } else if (getSessionId(message)) {
      console.log(
        `[relay] route daemon->app type=${message.type} session=${getSessionId(message)}`,
      );
    }

    this.routeDaemonMessageToApp(this.daemonDeviceId, message, forwardEnvelope);
  }

  private handleDaemonBroadcast(
    message: Message,
    forwardEnvelope?: Envelope,
  ): void {
    if (!this.daemonDeviceId) {
      this.sendError(
        message.type,
        "AUTH_INVALID",
        "Unregistered daemon connection",
      );
      return;
    }

    for (const appSocket of this.services.relayRegistry.getAppSocketsForDaemon(
      this.services.deviceRegistry,
      this.daemonDeviceId,
    )) {
      this.sendToSocket(appSocket, message, {
        from: this.daemonDeviceId,
        sourceEnvelope: forwardEnvelope,
      });
    }
  }

  private getAppRecord(appDeviceId: string): AppDeviceRecord | null {
    return this.services.deviceRegistry.getAppDevice(appDeviceId) ?? null;
  }

  private sendCurrentPresence(appDeviceId: string): void {
    const appDevice = this.getAppRecord(appDeviceId);
    if (!appDevice) {
      return;
    }

    const presence = this.services.presence.get(appDevice.linkedDaemonId);
    if (!presence) {
      return;
    }

    this.sendToSelf(
      {
        v: 1,
        type: "device.status",
        payload: {
          device_id: presence.deviceId,
          online: presence.online,
          machine_name: presence.machineName,
          ts: presence.ts,
        },
      },
      { from: presence.deviceId },
    );
  }

  private broadcastPresence(daemonDeviceId: string): void {
    const presence = this.services.presence.get(daemonDeviceId);
    if (!presence) {
      return;
    }

    const sockets = this.services.relayRegistry.getAppSocketsForDaemon(
      this.services.deviceRegistry,
      daemonDeviceId,
    );

    for (const socket of sockets) {
      this.sendToSocket(
        socket,
        {
          v: 1,
          type: "device.status",
          payload: {
            device_id: presence.deviceId,
            online: presence.online,
            machine_name: presence.machineName,
            ts: presence.ts,
          },
        },
        { from: presence.deviceId },
      );
    }
  }

  private resolveDaemonForAppMessage(
    appDeviceId: string,
    message: Message,
  ): string | null {
    const appDevice = this.getAppRecord(appDeviceId);
    if (!appDevice) {
      return null;
    }

    const sessionId = getSessionId(message);
    if (!sessionId) {
      return appDevice.linkedDaemonId;
    }

    const session = this.services.sessionRegistry.get(sessionId);
    if (!session) {
      return message.type === "session.start" ? appDevice.linkedDaemonId : null;
    }

    if (session.appDeviceId !== appDeviceId) {
      return null;
    }

    return session.daemonDeviceId;
  }

  private resolveAppOwnerForSession(sessionId: string): string | null {
    return this.services.sessionRegistry.get(sessionId)?.appDeviceId ?? null;
  }

  private isDaemonRelayResponse(message: Message): boolean {
    if (!this.daemonDeviceId || this.appDeviceId) {
      return false;
    }

    if (
      message.type === "session.start.result" ||
      message.type === "session.event" ||
      message.type === "danger.pending" ||
      message.type === "danger.result" ||
      message.type === "replay.done" ||
      message.type === "key.ratchet" ||
      message.type === "key.ratchet_ack" ||
      message.type === "fs.tree" ||
      message.type === "fs.file" ||
      message.type === "error"
    ) {
      return true;
    }

    if (
      message.type === "history.list" &&
      "items" in message.payload
    ) {
      return true;
    }

    if (
      message.type === "history.get" &&
      "lines" in message.payload &&
      "total" in message.payload
    ) {
      return true;
    }

    if (
      message.type === "templates.list" &&
      "templates" in message.payload
    ) {
      return true;
    }

    if (
      message.type === "slash.list" &&
      "commands" in message.payload
    ) {
      return true;
    }

    return false;
  }

  private routeDaemonMessageToApp(
    daemonDeviceId: string,
    message: Message,
    forwardEnvelope?: Envelope,
    targetAppDeviceId?: string,
  ): void {
    if (targetAppDeviceId) {
      for (const socket of this.services.relayRegistry.getAppSockets(
        targetAppDeviceId,
      )) {
        this.sendToSocket(socket, message, {
          from: daemonDeviceId,
          sourceEnvelope: forwardEnvelope,
        });
      }
      return;
    }

    const sessionId = getSessionId(message);
    if (sessionId) {
      const session = this.services.sessionRegistry.get(sessionId);
      if (session) {
        for (const socket of this.services.relayRegistry.getAppSockets(
          session.appDeviceId,
        )) {
          this.sendToSocket(socket, message, {
            from: daemonDeviceId,
            sourceEnvelope: forwardEnvelope,
          });
        }
        return;
      }

      const pending = this.services.sessionRegistry.getPending(sessionId);
      if (pending) {
        for (const socket of this.services.relayRegistry.getAppSockets(
          pending.appDeviceId,
        )) {
          this.sendToSocket(socket, message, {
            from: daemonDeviceId,
            sourceEnvelope: forwardEnvelope,
          });
        }
        return;
      }
    }

    for (const socket of this.services.relayRegistry.getAppSocketsForDaemon(
      this.services.deviceRegistry,
      daemonDeviceId,
    )) {
      this.sendToSocket(socket, message, {
        from: daemonDeviceId,
        sourceEnvelope: forwardEnvelope,
      });
    }
  }

  private replayPendingDangers(appDeviceId: string): void {
    const pendingEntries = this.services.pendingDangers.listForApp(appDeviceId);
    for (const entry of pendingEntries) {
      this.sendToSelf(entry.message, {
        from: entry.daemonDeviceId,
        sourceEnvelope: entry.envelope,
      });
    }
  }

  private sendToSelf(
    message: Message,
    options?: {
      from?: string;
      to?: string;
      sourceEnvelope?: Envelope;
    },
  ): void {
    this.sendToSocket(this.socket, message, options);
  }

  private sendToSocket(
    socket: WebSocket,
    message: Message,
    options?: {
      from?: string;
      to?: string;
      sourceEnvelope?: Envelope;
    },
  ): void {
    console.log(`[relay] send -> ${message.type}`);
    sendRelayMessage(socket, message, options);
  }

  private sendError(
    requestId: string,
    code:
      | "AUTH_INVALID"
      | "AUTH_EXPIRED"
      | "DEVICE_REVOKED"
      | "SESSION_NOT_FOUND"
      | "PROTOCOL_VERSION",
    message: string,
  ): void {
    this.sendToSelf({
      v: 1,
      type: "error",
      payload: {
        request_id: requestId,
        session_id: null,
        code,
        message,
      },
    });
  }

  private sendSessionStartRejected(
    message: Extract<Message, { type: "session.start" }>,
    code: ErrorCode,
    errorMessage: string,
  ): void {
    this.sendToSelf({
      v: 1,
      type: "session.start.result",
      payload: {
        request_id: message.id ?? `${message.type}:${Date.now()}`,
        session_id: message.payload.session_id,
        agent_type: message.payload.agent_type,
        workspace_path: message.payload.workspace_path,
        status: "rejected",
        code,
        message: errorMessage,
      },
    });
  }

  private async assertEnvelopeSignature(
    message: Message,
    envelope?: Envelope,
  ): Promise<void> {
    if (!envelope) {
      return;
    }
    if (envelope.sig.length === 0) {
      throw new Error("Missing envelope signature");
    }

    const publicKey = await this.resolveEnvelopePublicKey(message, envelope);
    if (!publicKey) {
      throw new Error("Missing signing key for envelope sender");
    }

    const verified = verify(
      null,
      createEnvelopeSigningPayload(envelope),
      publicKey,
      Buffer.from(envelope.sig, "base64url"),
    );
    if (!verified) {
      throw new Error("Invalid envelope signature");
    }
  }

  private async resolveEnvelopePublicKey(
    message: Message,
    envelope: Envelope,
  ): Promise<KeyObject | null> {
    if (message.type === "daemon.hello") {
      if (envelope.from !== message.payload.device_id) {
        return null;
      }
      const daemonDevice = this.services.deviceRegistry.getDaemonDevice(
        message.payload.device_id,
      );
      return daemonDevice
        ? this.importDaemonEd25519Key(daemonDevice.devicePubKey)
        : null;
    }

    if (this.daemonDeviceId) {
      const daemonDevice = this.services.deviceRegistry.getDaemonDevice(
        this.daemonDeviceId,
      );
      if (!daemonDevice || envelope.from !== daemonDevice.deviceId) {
        return null;
      }
      return this.importDaemonEd25519Key(daemonDevice.devicePubKey);
    }

    if (message.type === "device.pair") {
      return this.importAppEd25519Key(message.payload.app_ed25519_pubkey);
    }

    if (message.type === "device.pair.confirm") {
      const attempt = this.services.pairing.getAttemptByAppSocket(this.socket);
      if (!attempt) {
        return null;
      }
      return this.importAppEd25519Key(attempt.appEd25519PubKey);
    }

    if (message.type === "auth.attach" || message.type === "auth.refresh") {
      const verified = await this.services.jwtManager.verify(
        message.payload.jwt,
      );
      const appDevice = this.services.deviceRegistry.getAppDevice(
        verified.deviceId,
      );
      if (!appDevice || envelope.from !== appDevice.deviceId) {
        return null;
      }
      return this.importAppEd25519Key(appDevice.appEd25519PubKey);
    }

    if (this.appDeviceId) {
      const appDevice = this.services.deviceRegistry.getAppDevice(
        this.appDeviceId,
      );
      if (!appDevice) {
        return null;
      }
      if (envelope.from !== appDevice.deviceId) {
        return null;
      }
      return this.importAppEd25519Key(appDevice.appEd25519PubKey);
    }

    return null;
  }

  private importAppEd25519Key(keyBase64Url: string) {
    return createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: this.normalizeBase64Url(keyBase64Url),
      },
      format: "jwk",
    });
  }

  private importDaemonEd25519Key(keyBase64Url: string) {
    try {
      return createPublicKey({
        key: {
          kty: "OKP",
          crv: "Ed25519",
          x: this.normalizeBase64Url(keyBase64Url),
        },
        format: "jwk",
      });
    } catch {
      const pem = Buffer.from(keyBase64Url, "base64url").toString("utf8");
      return createPublicKey(pem);
    }
  }

  private normalizeBase64Url(value: string): string {
    return Buffer.from(value, "base64url").toString("base64url");
  }
}
