import type { Message } from "@hellobug/protocol";
import { WebSocket, type RawData } from "ws";

import type { AppDeviceRecord } from "../auth/device-registry.js";
import type { ServerServices } from "../lib/services.js";
import { decodeRelayFrame, sendRelayMessage } from "./framing.js";
import { AppToDaemonMessageTypes, DaemonBroadcastMessageTypes, getSessionId } from "./message-types.js";
import { sendJson } from "./socket.js";

export class RelayConnectionHandler {
  private daemonDeviceId: string | null = null;
  private appDeviceId: string | null = null;

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
    try {
      const { message: parsed } = decodeRelayFrame(this.socket, raw);
      console.log(`[relay] recv <- ${parsed.type}`);
      await this.handleMessage(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid message";
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

    this.services.relayRegistry.unregisterDaemon(this.daemonDeviceId, this.socket);
    this.services.pairing.clearDaemon(this.daemonDeviceId);
    this.services.sessionRegistry.clearDaemon(this.daemonDeviceId);
    this.services.presence.markOffline(this.daemonDeviceId);
    this.broadcastPresence(this.daemonDeviceId);
  }

  private async handleMessage(message: Message): Promise<void> {
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
      this.handlePairStart(message);
      return;
    }

    if (message.type === "device.pair.sas") {
      this.handlePairSas(message);
      return;
    }

    if (message.type === "device.pair.confirm") {
      await this.handlePairConfirm(message);
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

    if (AppToDaemonMessageTypes.has(message.type)) {
      this.handleAppToDaemonMessage(message);
      return;
    }

    if (message.type === "session.event" || message.type === "danger.pending" || message.type === "replay.done") {
      this.handleDaemonToAppMessage(message);
      return;
    }

    if (DaemonBroadcastMessageTypes.has(message.type)) {
      this.handleDaemonBroadcast(message);
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
      const verified = await this.services.jwtManager.verify(message.payload.jwt);
      const appDevice = this.services.deviceRegistry.getAppDevice(verified.deviceId);
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

      const refreshed = await this.services.jwtManager.issue(appDevice.deviceId);
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
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Invalid JWT";
      this.sendError(message.type, "AUTH_INVALID", text);
    }
  }

  private handleDaemonHello(message: Extract<Message, { type: "daemon.hello" }>): void {
    const daemonDevice = this.services.deviceRegistry.getDaemonDevice(message.payload.device_id);
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
    this.services.relayRegistry.registerDaemon(daemonDevice.deviceId, this.socket);
    this.services.presence.markOnline(daemonDevice.deviceId, daemonDevice.machineName ?? "unknown");
    this.broadcastPresence(daemonDevice.deviceId);
  }

  private handlePairReady(message: Extract<Message, { type: "device.pair.ready" }>): void {
    if (!this.daemonDeviceId) {
      this.sendError(message.type, "AUTH_INVALID", "daemon.hello required first");
      return;
    }

    this.services.pairing.registerReady(this.daemonDeviceId, message.payload);
  }

  private handlePairStart(message: Extract<Message, { type: "device.pair" }>): void {
    const attempt = this.services.pairing.startAttempt({
      appSocket: this.socket,
      pairingCode: message.payload.pairing_code,
      appPubKey: message.payload.app_pubkey,
      appEd25519PubKey: message.payload.app_ed25519_pubkey,
      appDeviceName: message.payload.app_device_name,
      serverUrl: message.payload.server_url,
    });

    if (!attempt) {
      this.sendError(message.type, "SESSION_NOT_FOUND", "Pairing slot not found or expired");
      return;
    }

    const daemonSocket = this.services.relayRegistry.getDaemon(attempt.daemonDeviceId);
    if (!daemonSocket) {
      this.services.pairing.completeAttemptForAppSocket(this.socket);
      this.sendError(message.type, "SESSION_NOT_FOUND", "Target daemon is offline");
      return;
    }

    sendJson(daemonSocket, message);
  }

  private handlePairSas(message: Extract<Message, { type: "device.pair.sas" }>): void {
    if (!this.daemonDeviceId) {
      this.sendError(message.type, "AUTH_INVALID", "Unregistered daemon connection");
      return;
    }

    const attempt = this.services.pairing.getAttemptByDaemonDeviceId(this.daemonDeviceId);
    if (!attempt) {
      this.sendError(message.type, "SESSION_NOT_FOUND", "No pairing attempt waiting for SAS");
      return;
    }

    this.services.deviceRegistry.updateDaemonMetadata(this.daemonDeviceId, {
      machineName: message.payload.machine_name,
      os: message.payload.os,
    });
    this.services.presence.markOnline(this.daemonDeviceId, message.payload.machine_name);
    void this.services.persistState();
    this.sendToSocket(attempt.appSocket, message, {
      from: this.daemonDeviceId,
    });
  }

  private async handlePairConfirm(
    message: Extract<Message, { type: "device.pair.confirm" }>,
  ): Promise<void> {
    const attempt = this.services.pairing.completeAttemptForAppSocket(this.socket);
    if (!attempt) {
      this.sendError(message.type, "SESSION_NOT_FOUND", "No active pairing attempt");
      return;
    }

    const daemonSocket = this.services.relayRegistry.getDaemon(attempt.daemonDeviceId);
    if (!daemonSocket) {
      this.sendError(message.type, "SESSION_NOT_FOUND", "Target daemon is offline");
      return;
    }

    sendJson(daemonSocket, message);

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

  private handleSessionResume(message: Extract<Message, { type: "session.resume" }>): void {
    const replay = this.services.replayBuffer.replay(
      message.payload.session_id,
      message.payload.last_seq,
    );

    for (const replayMessage of replay.messages) {
      this.sendToSelf(replayMessage);
    }

    this.sendToSelf({
      v: 1,
      type: "replay.done",
      payload: {
        session_id: message.payload.session_id,
        replayed_count: replay.replayedCount,
        current_seq: replay.currentSeq,
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

  private handleAppToDaemonMessage(message: Message): void {
    if (!this.appDeviceId) {
      this.sendError(message.type, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    const daemonId = this.resolveDaemonForAppMessage(this.appDeviceId, message);
    if (!daemonId) {
      this.sendError(message.type, "SESSION_NOT_FOUND", "Session is not registered");
      return;
    }

    if (message.type === "session.start") {
      this.services.sessionRegistry.register(message.payload.session_id, this.appDeviceId, daemonId);
    }

    const daemonSocket = this.services.relayRegistry.getDaemon(daemonId);
    if (!daemonSocket) {
      this.sendError(message.type, "SESSION_NOT_FOUND", "Target daemon is offline");
      return;
    }

    sendJson(daemonSocket, message);
  }

  private handleDaemonToAppMessage(message: Message): void {
    if (!this.daemonDeviceId) {
      this.sendError(message.type, "AUTH_INVALID", "Unregistered daemon connection");
      return;
    }

    if (message.type === "session.event") {
      this.services.replayBuffer.append(message);
    }

    this.routeDaemonMessageToApp(this.daemonDeviceId, message);
  }

  private handleDaemonBroadcast(message: Message): void {
    if (!this.daemonDeviceId) {
      this.sendError(message.type, "AUTH_INVALID", "Unregistered daemon connection");
      return;
    }

    for (const appSocket of this.services.relayRegistry.getAppSocketsForDaemon(
      this.services.deviceRegistry,
      this.daemonDeviceId,
    )) {
      this.sendToSocket(appSocket, message, {
        from: this.daemonDeviceId,
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

      this.sendToSelf({
        v: 1,
        type: "device.status",
        payload: {
          device_id: presence.deviceId,
          online: presence.online,
          machine_name: presence.machineName,
          ts: presence.ts,
        },
      }, { from: presence.deviceId });
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
      this.sendToSocket(socket, {
        v: 1,
        type: "device.status",
        payload: {
          device_id: presence.deviceId,
          online: presence.online,
          machine_name: presence.machineName,
          ts: presence.ts,
        },
      }, { from: presence.deviceId });
    }
  }

  private resolveDaemonForAppMessage(appDeviceId: string, message: Message): string | null {
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

  private routeDaemonMessageToApp(daemonDeviceId: string, message: Message): void {
    const sessionId = getSessionId(message);
    if (sessionId) {
      const session = this.services.sessionRegistry.get(sessionId);
      if (session) {
        for (const socket of this.services.relayRegistry.getAppSockets(session.appDeviceId)) {
          this.sendToSocket(socket, message, {
            from: daemonDeviceId,
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
      });
    }
  }

  private sendToSelf(
    message: Message,
    options?: {
      from?: string;
      to?: string;
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
    },
  ): void {
    console.log(`[relay] send -> ${message.type}`);
    sendRelayMessage(socket, message, options);
  }

  private sendError(
    requestId: string,
    code: "AUTH_INVALID" | "AUTH_EXPIRED" | "DEVICE_REVOKED" | "SESSION_NOT_FOUND" | "PROTOCOL_VERSION",
    message: string,
  ): void {
    this.sendToSelf({
      v: 1,
      type: "error",
      payload: {
        request_id: requestId,
        code,
        message,
      },
    });
  }
}
