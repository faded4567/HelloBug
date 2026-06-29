import { createPublicKey, type KeyObject, verify } from "node:crypto";

import {
  createEnvelopeSigningPayload,
  type ErrorCode,
  type Envelope,
  type Message,
  validateNotificationPushPayload,
} from "@hellobug/protocol";
import { WebSocket, type RawData } from "ws";

import type { AppDeviceRecord } from "../auth/device-registry.js";
import type { ServerServices } from "../lib/services.js";
import {
  RelayFrameDecodeError,
  decodeRelayFrame,
  sendRelayMessage,
} from "./framing.js";
import {
  AppToDaemonMessageTypes,
  DaemonBroadcastMessageTypes,
  getSessionId,
} from "./message-types.js";
import type { RelayPendingRequestRecord } from "./requests.js";
import type {
  RelayPendingSessionRecord,
  RelaySessionRecord,
} from "./sessions.js";
import { sendJson } from "./socket.js";

const MaxEnvelopeClockSkewMs = 5 * 60 * 1000;
const NoiseRequiredDirectDaemonRequestTypes = new Set<string>([
  "history.list",
  "templates.list",
  "workspace.list",
  "workspace.resolve",
]);
const NoiseRequiredSessionUtilityRequestTypes = new Set<string>([
  "history.get",
  "slash.list",
  "fs.tree.req",
  "fs.file.req",
]);
const NoiseRequiredDaemonSessionResponseTypes = new Set<string>([
  "session.event",
  "danger.pending",
  "danger.result",
  "fs.tree",
  "fs.file",
  "history.get",
  "slash.list",
  "key.ratchet",
  "key.ratchet_ack",
  "error",
]);

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
      this.sendError(
        error instanceof RelayFrameDecodeError && error.context
          ? error.context
          : "relay",
        error instanceof RelayFrameDecodeError ? error.code : "AUTH_INVALID",
        message,
      );
    }
  }

  handleClose(): void {
    this.services.pairing.clearAppSocket(this.socket);

    if (this.appDeviceId) {
      this.services.requestRegistry.clearForAppDevice(this.appDeviceId);
      this.services.relayRegistry.detachApp(this.appDeviceId, this.socket);
    }

    if (!this.daemonDeviceId) {
      return;
    }

    const pendingStarts = this.services.sessionRegistry.takePendingForDaemon(
      this.daemonDeviceId,
    );
    const pendingRequests = this.services.requestRegistry.drainForDaemonDevice(
      this.daemonDeviceId,
    );
    this.services.relayRegistry.unregisterDaemon(
      this.daemonDeviceId,
      this.socket,
    );
    this.services.pendingDangers.removeForDaemon(this.daemonDeviceId);
    this.services.pairing.clearDaemon(this.daemonDeviceId);
    this.failPendingDaemonWork(
      this.daemonDeviceId,
      pendingStarts,
      pendingRequests,
    );
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

    if (message.type === "push.trigger") {
      await this.handlePushTrigger(message);
      return;
    }

    if (message.type === "device.list") {
      this.handleDeviceList(message);
      return;
    }

    if (message.type === "device.rename") {
      await this.handleDeviceRename(
        message as Extract<
          Message,
          {
            type: "device.rename";
            payload: {
              device_id: string;
              machine_name: string;
            };
          }
        >,
      );
      return;
    }

    if (message.type === "device.revoke") {
      await this.handleDeviceRevoke(
        message as Extract<
          Message,
          {
            type: "device.revoke";
            payload: {
              device_id: string;
              mode: "unlink" | "revoke";
            };
          }
        >,
      );
      return;
    }

    if (this.isDaemonRelayResponse(message)) {
      if (message.type === "replay.done") {
        this.sendError(
          message,
          "PROTOCOL_VERSION",
          "replay.done is server-generated and cannot originate from daemon",
        );
        return;
      }

      const directRequest = this.takePendingRequest(message);
      if (directRequest) {
        if (
          directRequest.requiresEncryptedResponse &&
          !this.isNoiseStaticEnvelope(forwardEnvelope)
        ) {
          this.rejectDowngradedDirectResponse(directRequest, message);
          return;
        }

        this.handleDaemonToAppMessage(
          message,
          forwardEnvelope,
          directRequest.appDeviceId,
        );
        return;
      }

      if (this.isExpiredDirectDaemonResponse(message)) {
        console.warn(
          `[relay] drop stale daemon response type=${message.type} request=${this.getDirectRequestId(message) ?? "unknown"}`,
        );
        return;
      }

      if (
        DaemonBroadcastMessageTypes.has(message.type) &&
        !getSessionId(message)
      ) {
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
      message,
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
        this.sendError(message, "AUTH_INVALID", "Unknown app device");
        return;
      }
      if (this.services.deviceRegistry.isRevoked(appDevice.deviceId)) {
        this.sendError(message, "DEVICE_REVOKED", "Device revoked");
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
      this.sendError(message, "AUTH_INVALID", text);
    }
  }

  private handleDaemonHello(
    message: Extract<Message, { type: "daemon.hello" }>,
  ): void {
    const daemonDevice = this.services.deviceRegistry.getDaemonDevice(
      message.payload.device_id,
    );
    if (!daemonDevice) {
      this.sendError(message, "AUTH_INVALID", "Unknown daemon device");
      this.socket.close();
      return;
    }
    if (this.services.deviceRegistry.isRevoked(daemonDevice.deviceId)) {
      this.sendError(message, "DEVICE_REVOKED", "Device revoked");
      this.socket.close();
      return;
    }

    this.daemonDeviceId = daemonDevice.deviceId;
    this.services.deviceRegistry.updateDaemonMetadata(daemonDevice.deviceId, {
      daemonVersion: message.payload.daemon_version,
      supportedFeatures: message.payload.supported_features,
    });
    this.services.relayRegistry.registerDaemon(
      daemonDevice.deviceId,
      this.socket,
    );
    this.services.presence.markOnline(
      daemonDevice.deviceId,
      daemonDevice.machineName ?? "unknown",
    );
    this.broadcastPresence(daemonDevice.deviceId);
    void this.services.persistState();
  }

  private handlePairReady(
    message: Extract<Message, { type: "device.pair.ready" }>,
  ): void {
    if (!this.daemonDeviceId) {
      this.sendError(message, "AUTH_INVALID", "daemon.hello required first");
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
        message,
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
      this.sendError(message, "SESSION_NOT_FOUND", "Target daemon is offline");
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
      this.sendError(message, "AUTH_INVALID", "Unregistered daemon connection");
      return;
    }

    const attempt = this.services.pairing.getAttemptByDaemonDeviceId(
      this.daemonDeviceId,
    );
    if (!attempt) {
      this.sendError(
        message,
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
      this.sendError(message, "SESSION_NOT_FOUND", "No active pairing attempt");
      return;
    }
    if (message.payload.confirmed && !message.payload.noise_handshake) {
      this.sendError(
        message,
        "PROTOCOL_VERSION",
        "device.pair.confirm requires noise_handshake when confirmed=true",
      );
      return;
    }

    const daemonSocket = this.services.relayRegistry.getDaemon(
      attempt.daemonDeviceId,
    );
    if (!daemonSocket) {
      this.sendError(message, "SESSION_NOT_FOUND", "Target daemon is offline");
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
      this.sendError(message, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    console.log(
      `[relay] session resume session=${message.payload.session_id} last_seq=${message.payload.last_seq}`,
    );
    const session = this.services.sessionRegistry.get(
      message.payload.session_id,
    );
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
      this.sendError(message, "AUTH_INVALID", "App is not authenticated");
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
      this.sendError(message, "AUTH_INVALID", "Unknown app device");
      return;
    }

    await this.services.persistState();
  }

  private handleDeviceList(
    message: Extract<Message, { type: "device.list" }>,
  ): void {
    if (!this.appDeviceId) {
      this.sendError(message, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    const appDevice = this.getAppRecord(this.appDeviceId);
    if (!appDevice) {
      this.sendError(message, "AUTH_INVALID", "Unknown app device");
      return;
    }

    const daemonDevice = this.services.deviceRegistry.getDaemonDevice(
      appDevice.linkedDaemonId,
    );
    const devices = daemonDevice
      ? [this.buildDeviceListItem(daemonDevice.deviceId)]
      : [];

    this.sendToSelf({
      v: 1,
      id: message.id,
      type: "device.list",
      payload: {
        devices,
      },
    });
  }

  private async handleDeviceRename(
    message: Extract<
      Message,
      {
        type: "device.rename";
        payload: {
          device_id: string;
          machine_name: string;
        };
      }
    >,
  ): Promise<void> {
    if (!this.appDeviceId) {
      this.sendError(message, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    const appDevice = this.getAppRecord(this.appDeviceId);
    if (!appDevice || appDevice.linkedDaemonId !== message.payload.device_id) {
      this.sendError(
        message,
        "AUTH_INVALID",
        "Device is not linked to this app",
      );
      return;
    }

    const renamed = this.services.deviceRegistry.renameDaemonDevice(
      message.payload.device_id,
      message.payload.machine_name,
    );
    if (!renamed) {
      this.sendError(message, "SESSION_NOT_FOUND", "Device not found");
      return;
    }

    this.services.presence.rename(
      message.payload.device_id,
      message.payload.machine_name,
    );
    await this.services.persistState();
    this.broadcastPresence(message.payload.device_id);
    this.sendToSelf({
      v: 1,
      id: message.id,
      type: "device.rename",
      payload: {
        device: this.buildDeviceListItem(message.payload.device_id),
      },
    });
  }

  private async handleDeviceRevoke(
    message: Extract<
      Message,
      {
        type: "device.revoke";
        payload: {
          device_id: string;
          mode: "unlink" | "revoke";
        };
      }
    >,
  ): Promise<void> {
    if (!this.appDeviceId) {
      this.sendError(message, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    const appDevice = this.getAppRecord(this.appDeviceId);
    if (!appDevice || appDevice.linkedDaemonId !== message.payload.device_id) {
      this.sendError(
        message,
        "AUTH_INVALID",
        "Device is not linked to this app",
      );
      return;
    }

    const revokedAt = Date.now();
    let disconnected = false;

    if (message.payload.mode === "unlink") {
      this.services.deviceRegistry.revokeDevice(this.appDeviceId);
      await this.services.persistState();
      this.sendToSelf({
        v: 1,
        id: message.id,
        type: "device.revoke",
        payload: {
          device_id: message.payload.device_id,
          mode: "unlink",
          revoked_at: revokedAt,
          disconnected: true,
        },
      });
      disconnected = true;
      for (const socket of this.services.relayRegistry.getAppSockets(
        this.appDeviceId,
      )) {
        socket.close();
      }
      return;
    }

    const daemonDevice = this.services.deviceRegistry.getDaemonDevice(
      message.payload.device_id,
    );
    if (!daemonDevice) {
      this.sendError(message, "SESSION_NOT_FOUND", "Device not found");
      return;
    }

    this.services.deviceRegistry.revokeDevice(daemonDevice.deviceId);
    const daemonSocket = this.services.relayRegistry.getDaemon(
      daemonDevice.deviceId,
    );
    await this.services.persistState();
    this.sendToSelf({
      v: 1,
      id: message.id,
      type: "device.revoke",
      payload: {
        device_id: daemonDevice.deviceId,
        mode: "revoke",
        revoked_at: daemonDevice.revokedAt ?? revokedAt,
        disconnected: Boolean(daemonSocket),
      },
    });
    if (daemonSocket) {
      disconnected = true;
      daemonSocket.close();
    }

    if (!disconnected) {
      this.services.presence.markOffline(daemonDevice.deviceId);
      this.broadcastPresence(daemonDevice.deviceId);
    }
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
      this.sendError(message, "AUTH_INVALID", "App is not authenticated");
      return;
    }

    if (this.shouldRejectDirectDaemonRequestDowngrade(message, forwardEnvelope)) {
      this.sendError(
        message,
        "PROTOCOL_VERSION",
        `Envelope plaintext downgrade is not allowed for ${message.type}`,
      );
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
      this.sendError(message, "SESSION_NOT_FOUND", "Session is not registered");
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
      this.sendError(message, "SESSION_NOT_FOUND", "Target daemon is offline");
      return;
    }

    if (message.type === "session.start") {
      this.services.sessionRegistry.beginPendingStart(
        message.payload.session_id,
        this.appDeviceId,
        daemonId,
        message.id ?? `${message.type}:${Date.now()}`,
        message.payload.agent_type,
        message.payload.workspace_path,
        this.isNoiseStaticEnvelope(forwardEnvelope),
        (pending) => {
          this.failPendingSessionStart(
            pending,
            "Target daemon timed out before session started",
          );
        },
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

    if (this.shouldTrackDirectDaemonRequest(message) && message.id) {
      this.services.requestRegistry.register(
        message.id,
        this.appDeviceId,
        daemonId,
        message.type,
        {
          requiresEncryptedResponse: this.isNoiseStaticEnvelope(forwardEnvelope),
          onTimeout: (pending) => {
            this.failPendingDirectRequest(
              pending,
              "Target daemon timed out before responding",
            );
          },
        },
      );
    }

    if (this.shouldTrackSessionUtilityRequest(message) && message.id) {
      this.services.requestRegistry.register(
        message.id,
        this.appDeviceId,
        daemonId,
        message.type,
        {
          requiresEncryptedResponse: this.isNoiseStaticEnvelope(forwardEnvelope),
          onTimeout: (pending) => {
            this.failPendingSessionUtilityRequest(
              pending,
              message,
              "Target daemon timed out before responding",
            );
          },
        },
      );
    }

    this.sendToSocket(daemonSocket, message, {
      to: daemonId,
      sourceEnvelope: forwardEnvelope,
    });
  }

  private handleDaemonToAppMessage(
    message: Message,
    forwardEnvelope?: Envelope,
    targetAppDeviceId?: string,
  ): void {
    if (!this.daemonDeviceId) {
      this.sendError(message, "AUTH_INVALID", "Unregistered daemon connection");
      return;
    }

    if (message.type === "session.start.result") {
      const pending = this.services.sessionRegistry.getPending(
        message.payload.session_id,
      );
      if (!pending) {
        console.warn(
          `[relay] drop stale daemon response type=session.start.result session=${message.payload.session_id}`,
        );
        return;
      }
      if (
        pending.requiresEncryptedTransport &&
        !this.isNoiseStaticEnvelope(forwardEnvelope)
      ) {
        this.rejectDowngradedSessionStartResponse(pending, message);
        return;
      }
      const targetAppDeviceId =
        pending?.appDeviceId ??
        this.resolveAppOwnerForSession(message.payload.session_id);
      const started = message.payload.status === "started";
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
      if (started) {
        this.broadcastPresence(this.daemonDeviceId);
      }
      return;
    }

    const encryptedSession = this.getEncryptedSessionTransportRecord(message);
    if (
      encryptedSession &&
      !this.isNoiseStaticEnvelope(forwardEnvelope)
    ) {
      this.rejectDowngradedSessionMessage(
        encryptedSession,
        message,
        targetAppDeviceId,
      );
      return;
    }

    if (message.type === "session.event") {
      this.services.replayBuffer.append(message, forwardEnvelope);
      console.log(
        `[relay] route daemon->app type=session.event session=${message.payload.session_id} seq=${message.payload.seq} event=${message.payload.event.event_type}`,
      );
    } else if (message.type === "danger.pending") {
      const appDeviceId = this.resolveAppOwnerForSession(
        message.payload.session_id,
      );
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

    this.routeDaemonMessageToApp(
      this.daemonDeviceId,
      message,
      forwardEnvelope,
      targetAppDeviceId,
    );
    if (
      message.type === "session.event" &&
      message.payload.event.event_type === "session.done"
    ) {
      this.services.sessionRegistry.complete(message.payload.session_id);
      this.broadcastPresence(this.daemonDeviceId);
    }
  }

  private async handlePushTrigger(
    message: Extract<Message, { type: "push.trigger" }>,
  ): Promise<void> {
    if (!this.daemonDeviceId || this.appDeviceId) {
      this.sendError(message, "AUTH_INVALID", "push.trigger is daemon-only");
      return;
    }

    const session = this.services.sessionRegistry.get(message.payload.session_id);
    if (!session || session.daemonDeviceId !== this.daemonDeviceId) {
      console.warn(
        `[relay] drop push.trigger daemon=${this.daemonDeviceId} session=${message.payload.session_id} reason=unknown_or_unowned_session`,
      );
      return;
    }

    const payload = this.createPushNotificationPayload(message);
    const dispatched = await this.services.push.dispatchToLinkedOfflineApps(
      this.daemonDeviceId,
      payload,
    );
    console.log(
      `[relay] push.trigger daemon=${this.daemonDeviceId} session=${message.payload.session_id} event=${message.payload.event_type} dispatched=${dispatched.length}`,
    );
  }

  private handleDaemonBroadcast(
    message: Message,
    forwardEnvelope?: Envelope,
  ): void {
    if (!this.daemonDeviceId) {
      this.sendError(message, "AUTH_INVALID", "Unregistered daemon connection");
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
      this.createDeviceStatusMessage(presence.deviceId, presence),
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
        this.createDeviceStatusMessage(presence.deviceId, presence),
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

    if (!session.active) {
      return message.type === "session.start" ? appDevice.linkedDaemonId : null;
    }

    return session.daemonDeviceId;
  }

  private resolveAppOwnerForSession(sessionId: string): string | null {
    return this.services.sessionRegistry.get(sessionId)?.appDeviceId ?? null;
  }

  private createPushNotificationPayload(
    message: Extract<Message, { type: "push.trigger" }>,
  ) {
    const alert =
      message.payload.event_type === "task_done"
        ? {
            title: "HelloBug",
            body: "任务已完成",
          }
        : message.payload.event_type === "danger_pending"
          ? {
              title: "HelloBug",
              body: "需要确认危险操作",
            }
          : {
              title: "HelloBug",
              body: "任务出现异常",
            };

    return validateNotificationPushPayload({
      aps: {
        alert,
        sound: "default",
      },
      session_id: message.payload.session_id,
      event_type: message.payload.event_type,
    });
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

    if (message.type === "history.list" && "items" in message.payload) {
      return true;
    }

    if (
      message.type === "history.get" &&
      "lines" in message.payload &&
      "total" in message.payload
    ) {
      return true;
    }

    if (message.type === "templates.list" && "templates" in message.payload) {
      return true;
    }

    if (message.type === "workspace.list" && "items" in message.payload) {
      return true;
    }

    if (
      message.type === "workspace.resolve" &&
      "resolved_path" in message.payload &&
      "status" in message.payload
    ) {
      return true;
    }

    if (message.type === "slash.list" && "commands" in message.payload) {
      return true;
    }

    return false;
  }

  private shouldTrackDirectDaemonRequest(message: Message): boolean {
    return (
      !getSessionId(message) &&
      NoiseRequiredDirectDaemonRequestTypes.has(message.type)
    );
  }

  private shouldTrackSessionUtilityRequest(message: Message): boolean {
    return (
      !!getSessionId(message) &&
      NoiseRequiredSessionUtilityRequestTypes.has(message.type)
    );
  }

  private takePendingRequest(message: Message): RelayPendingRequestRecord | null {
    if (message.id) {
      const pending = this.isStreamingDirectResponse(message)
        ? this.peekPendingStreamingRequest(message)
        : this.services.requestRegistry.take(message.id);
      if (pending) {
        return pending;
      }
    }

    if (message.type === "error") {
      const pending = this.services.requestRegistry.take(
        message.payload.request_id,
      );
      if (pending) {
        return pending;
      }
    }

    return null;
  }

  private isExpiredDirectDaemonResponse(message: Message): boolean {
    const requestId = this.getDirectRequestId(message);
    if (!requestId) {
      return false;
    }

    if (message.type === "error") {
      return this.services.requestRegistry.wasRecentlyExpired(requestId);
    }

    return (
      message.type === "history.list" ||
      message.type === "history.get" ||
      message.type === "templates.list" ||
      message.type === "workspace.list" ||
      message.type === "workspace.resolve" ||
      message.type === "slash.list" ||
      message.type === "fs.tree" ||
      message.type === "fs.file"
    );
  }

  private isStreamingDirectResponse(message: Message): boolean {
    return message.type === "fs.file";
  }

  private peekPendingStreamingRequest(
    message: Message,
  ): RelayPendingRequestRecord | null {
    if (message.type !== "fs.file") {
      return null;
    }

    if (!message.id) {
      return null;
    }

    const pending = this.services.requestRegistry.get(message.id);
    if (!pending) {
      return null;
    }

    if (
      message.payload.status !== "ready" ||
      message.payload.chunk_index + 1 >= message.payload.total_chunks
    ) {
      return this.services.requestRegistry.take(message.id) ?? pending;
    }

    return pending;
  }

  private getDirectRequestId(message: Message): string | null {
    if (message.id) {
      return message.id;
    }

    if (message.type === "error") {
      return message.payload.request_id;
    }

    return null;
  }

  private shouldRejectDirectDaemonRequestDowngrade(
    message: Message,
    forwardEnvelope?: Envelope,
  ): boolean {
    return (
      this.shouldTrackDirectDaemonRequest(message) &&
      this.isPlainMetadataEnvelope(forwardEnvelope)
    );
  }

  private isNoiseStaticEnvelope(envelope?: Envelope): boolean {
    return (envelope?.cipher_mode ?? "plain") === "noise_static_v1";
  }

  private isPlainMetadataEnvelope(envelope?: Envelope): boolean {
    return (
      !!envelope &&
      !this.isNoiseStaticEnvelope(envelope) &&
      typeof envelope.message_type === "string"
    );
  }

  private rejectDowngradedDirectResponse(
    pending: RelayPendingRequestRecord,
    message: Message,
  ): void {
    if (!this.daemonDeviceId) {
      return;
    }

    const sessionId = getSessionId(message);
    console.warn(
      `[relay] reject downgraded direct response type=${pending.messageType} request=${pending.requestId} session=${sessionId ?? "none"} daemon=${this.daemonDeviceId}`,
    );
    this.routeDaemonMessageToApp(
      this.daemonDeviceId,
      {
        v: 1,
        type: "error",
        payload: {
          request_id: pending.requestId,
          session_id: sessionId,
          code: "PROTOCOL_VERSION",
          message: `Encrypted request requires noise_static_v1 response for ${pending.messageType}`,
        },
      },
      undefined,
      pending.appDeviceId,
    );
  }

  private rejectDowngradedSessionStartResponse(
    pending: RelayPendingSessionRecord,
    message: Extract<Message, { type: "session.start.result" }>,
  ): void {
    if (!this.daemonDeviceId) {
      return;
    }

    console.warn(
      `[relay] reject downgraded session.start.result request=${pending.requestId} session=${pending.sessionId} daemon=${this.daemonDeviceId}`,
    );
    this.services.sessionRegistry.discardPendingStart(pending.sessionId);
    this.routeDaemonMessageToApp(
      this.daemonDeviceId,
      {
        v: 1,
        type: "session.start.result",
        payload: {
          request_id: pending.requestId,
          session_id: pending.sessionId,
          agent_type: message.payload.agent_type,
          workspace_path: message.payload.workspace_path,
          status: "rejected",
          code: "PROTOCOL_VERSION",
          message:
            "Encrypted session.start requires noise_static_v1 session.start.result",
        },
      },
      undefined,
      pending.appDeviceId,
    );
  }

  private getEncryptedSessionTransportRecord(
    message: Message,
  ): RelaySessionRecord | null {
    const sessionId = getSessionId(message);
    if (!sessionId) {
      return null;
    }

    if (!NoiseRequiredDaemonSessionResponseTypes.has(message.type)) {
      return null;
    }

    const session = this.services.sessionRegistry.get(sessionId);
    if (!session?.requiresEncryptedTransport) {
      return null;
    }

    return session;
  }

  private rejectDowngradedSessionMessage(
    session: RelaySessionRecord,
    message: Message,
    targetAppDeviceId?: string,
  ): void {
    if (!this.daemonDeviceId) {
      return;
    }

    const requestId =
      message.type === "error"
        ? message.payload.request_id
        : message.id ?? message.type;
    console.warn(
      `[relay] reject downgraded session message type=${message.type} request=${requestId} session=${session.sessionId} daemon=${this.daemonDeviceId}`,
    );
    this.routeDaemonMessageToApp(
      this.daemonDeviceId,
      {
        v: 1,
        type: "error",
        payload: {
          request_id: requestId,
          session_id: session.sessionId,
          code: "PROTOCOL_VERSION",
          message: `Encrypted session requires noise_static_v1 transport for ${message.type}`,
        },
      },
      undefined,
      targetAppDeviceId ?? session.appDeviceId,
    );
  }

  private failPendingSessionUtilityRequest(
    pending: RelayPendingRequestRecord,
    request: Message,
    message: string,
  ): void {
    for (const socket of this.services.relayRegistry.getAppSockets(
      pending.appDeviceId,
    )) {
      this.sendToSocket(
        socket,
        {
          v: 1,
          type: "error",
          payload: {
            request_id: pending.requestId,
            session_id: getSessionId(request),
            code: "SESSION_NOT_FOUND",
            message,
          },
        },
        {
          from: pending.daemonDeviceId,
        },
      );
    }
  }

  private buildDeviceListItem(deviceId: string): {
    device_id: string;
    machine_name: string;
    os: string | null;
    daemon_version: string | null;
    online: boolean;
    paired_at: number;
    last_seen_at: number | null;
    revoked_at: number | null;
    active_session_count: number;
  } {
    const device = this.services.deviceRegistry.getDaemonDevice(deviceId);
    if (!device) {
      throw new Error(`Unknown daemon device: ${deviceId}`);
    }

    const presence = this.services.presence.get(deviceId);
    return {
      device_id: device.deviceId,
      machine_name: device.machineName ?? "unknown",
      os: device.os ?? null,
      daemon_version: device.daemonVersion ?? null,
      online: presence?.online ?? false,
      paired_at: device.registeredAt,
      last_seen_at: presence?.lastSeenAt ?? null,
      revoked_at: device.revokedAt ?? null,
      active_session_count: this.services.sessionRegistry.countForDaemon(
        device.deviceId,
      ),
    };
  }

  private createDeviceStatusMessage(
    daemonDeviceId: string,
    presence = this.services.presence.get(daemonDeviceId),
  ): Extract<Message, { type: "device.status" }> {
    if (!presence) {
      throw new Error(`Missing presence for device: ${daemonDeviceId}`);
    }

    const daemon = this.services.deviceRegistry.getDaemonDevice(daemonDeviceId);
    return {
      v: 1,
      type: "device.status",
      payload: {
        device_id: daemonDeviceId,
        online: presence.online,
        machine_name: daemon?.machineName ?? presence.machineName,
        ts: Date.now(),
        os: daemon?.os ?? null,
        daemon_version: daemon?.daemonVersion ?? null,
        paired_at: daemon?.registeredAt ?? null,
        last_seen_at: presence.lastSeenAt,
        revoked_at: daemon?.revokedAt ?? null,
        active_session_count:
          this.services.sessionRegistry.countForDaemon(daemonDeviceId),
      },
    };
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

      console.warn(
        `[relay] drop unroutable daemon session message type=${message.type} session=${sessionId}`,
      );
      return;
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

  private failPendingDaemonWork(
    daemonDeviceId: string,
    pendingStarts: RelayPendingSessionRecord[],
    pendingRequests: RelayPendingRequestRecord[],
  ): void {
    for (const pending of pendingStarts) {
      this.failPendingSessionStart(
        pending,
        "Target daemon went offline before session started",
      );
    }

    for (const pending of pendingRequests) {
      this.failPendingDirectRequest(
        pending,
        "Target daemon went offline before responding",
      );
    }
  }

  private failPendingSessionStart(
    pending: RelayPendingSessionRecord,
    message: string,
  ): void {
    for (const socket of this.services.relayRegistry.getAppSockets(
      pending.appDeviceId,
    )) {
      this.sendToSocket(
        socket,
        {
          v: 1,
          type: "session.start.result",
          payload: {
            request_id: pending.requestId,
            session_id: pending.sessionId,
            agent_type: pending.agentType,
            workspace_path: pending.workspacePath,
            status: "rejected",
            code: "SESSION_NOT_FOUND",
            message,
          },
        },
        {
          from: pending.daemonDeviceId,
        },
      );
    }
  }

  private failPendingDirectRequest(
    pending: RelayPendingRequestRecord,
    message: string,
  ): void {
    for (const socket of this.services.relayRegistry.getAppSockets(
      pending.appDeviceId,
    )) {
      this.sendToSocket(
        socket,
        {
          v: 1,
          type: "error",
          payload: {
            request_id: pending.requestId,
            session_id: null,
            code: "SESSION_NOT_FOUND",
            message,
          },
        },
        {
          from: pending.daemonDeviceId,
        },
      );
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
    request:
      | string
      | Message
      | {
          request_id?: string | null;
          session_id?: string | null;
        },
    code:
      | "AUTH_INVALID"
      | "AUTH_EXPIRED"
      | "DEVICE_REVOKED"
      | "SESSION_NOT_FOUND"
      | "PROTOCOL_VERSION",
    message: string,
  ): void {
    let requestId = "relay";
    let sessionId: string | null = null;

    if (typeof request === "string") {
      requestId = request;
    } else if ("type" in request) {
      requestId = request.id ?? request.type;
      sessionId = getSessionId(request);
    } else {
      requestId = request.request_id || "relay";
      sessionId = request.session_id ?? null;
    }

    this.sendToSelf({
      v: 1,
      type: "error",
      payload: {
        request_id: requestId,
        session_id: sessionId,
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
    this.assertEnvelopeTimestamp(envelope);
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

    this.assertEnvelopeReplay(envelope);
  }

  private assertEnvelopeTimestamp(envelope: Envelope): void {
    if (Math.abs(Date.now() - envelope.ts) > MaxEnvelopeClockSkewMs) {
      throw new Error("Envelope timestamp exceeds allowed skew");
    }
  }

  private assertEnvelopeReplay(envelope: Envelope): void {
    if (!this.services.envelopeReplays.remember(envelope)) {
      throw new Error("Envelope replay detected");
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
