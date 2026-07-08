import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject } from "node:crypto";

import {
  TransportControlSessionId,
  type Envelope,
  type Message,
  validateEnvelope,
  validateMessage,
} from "@hellobug/protocol";
import { WebSocket } from "ws";

import type { DeviceIdentity } from "../crypto/keys.js";
import {
  SessionCipher,
  createSessionNonce,
  deriveSessionKeys,
} from "../crypto/noise.js";
import type { PairingSlot } from "../pairing/code.js";
import type { DaemonCertificateBundle } from "./register.js";
import { decodeEnvelope, encodeEnvelope } from "./envelope.js";
import type { PairingTransportKeyStore } from "./pairing-key-store.js";

const EncryptedAppMessageTypes = new Set<string>([
  "session.start",
  "session.agent.add",
  "session.input",
  "session.input.image",
  "session.input.voice_text",
  "session.command.slash",
  "session.cancel",
  "danger.allow",
  "danger.deny",
  "fs.tree.req",
  "fs.file.req",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "pty.input",
  "pty.resize",
  "key.ratchet",
  "key.ratchet_ack",
]);

const EncryptedDaemonMessageTypes = new Set<string>([
  "session.start.result",
  "session.event",
  "danger.pending",
  "danger.result",
  "push.trigger",
  "fs.tree",
  "fs.file",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "error",
  "key.ratchet",
  "key.ratchet_ack",
]);
const PlaceholderOutboundDaemonMessageTypes = new Set<string>([
  "daemon.hello",
  "device.pair.ready",
  "device.pair.sas",
]);
const RoutingPayloadPlaceholderMessageTypes = new Set<string>([
  "device.pair",
  "device.pair.confirm",
  "push.trigger",
  "error",
]);
const TransportControlPlaceholderMessageTypes = new Set<string>([
  "daemon.hello",
]);
const TransportControlMessageTypes = new Set<string>([
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "templates.list",
]);
const AllowedLegacyRawInboundMessageTypes = new Set<string>(["server.hello"]);

const DefaultRatchetMessageLimit = 100;
const DefaultRatchetMaxAgeMs = 10 * 60 * 1000;

interface PendingRatchetState {
  nextPubkey: string;
}

interface SessionCryptoState {
  appIdentityPubkey: string;
  localPrivateKey: string | KeyObject;
  localPublicKeyBase64Url: string;
  currentCipher: SessionCipher;
  previousCipher: SessionCipher | null;
  pendingRatchet: PendingRatchetState | null;
  outboundEncryptedCount: number;
  lastRatchetAt: number;
}

type SessionEventMessage = Extract<Message, { type: "session.event" }>;

export interface DaemonConnectionHandlers {
  onMessage?: (
    message: Message,
    connection: DaemonConnection,
  ) => void | Promise<void>;
}

export interface DaemonConnectionOptions {
  serverUrl: string;
  identity: DeviceIdentity;
  certificates: DaemonCertificateBundle;
  supportedFeatures?: string[];
  pairingTransportKeys?: PairingTransportKeyStore;
  ratchetMessageLimit?: number;
  ratchetMaxAgeMs?: number;
  handlers?: DaemonConnectionHandlers;
}

export class DaemonConnection {
  onDisconnect?: () => void | Promise<void>;

  private socket: WebSocket | null = null;
  private sequence = Math.floor(Math.random() * 1_000_000_000);
  private readonly sessionCrypto = new Map<string, SessionCryptoState>();
  private readonly ratchetMessageLimit: number;
  private readonly ratchetMaxAgeMs: number;

  constructor(private readonly options: DaemonConnectionOptions) {
    this.ratchetMessageLimit =
      options.ratchetMessageLimit ?? DefaultRatchetMessageLimit;
    this.ratchetMaxAgeMs = options.ratchetMaxAgeMs ?? DefaultRatchetMaxAgeMs;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.serverUrl);
      this.socket = socket;

      socket.once("open", () => {
        console.log(`[daemon] relay connected -> ${this.options.serverUrl}`);
        this.sendMessage({
          v: 1,
          type: "daemon.hello",
          payload: {
            device_id: this.options.certificates.deviceId,
            daemon_version: "0.1.0",
            supported_features: this.options.supportedFeatures ?? [
              "e2ee_noise_ik",
              "multi_session",
              "pty",
            ],
          },
        });
        resolve();
      });

      socket.on("message", async (raw) => {
        try {
          const parsed = this.decodeIncoming(raw.toString());
          console.log(`[daemon] recv <- ${parsed.type}`);
          if (parsed.type === "error") {
            console.log(
              `[daemon] error payload <- ${JSON.stringify(parsed.payload)}`,
            );
          }
          await this.handleIncomingMessage(parsed);
        } catch (error) {
          console.error("[daemon] incoming message error", error);
          this.tryReplyIncomingError(raw.toString(), error);
        }
      });

      socket.on("close", (code, reason) => {
        console.log(
          `[daemon] relay closed code=${code} reason=${reason.toString()}`,
        );
        void this.onDisconnect?.();
      });

      socket.once("error", (error: Error) => {
        console.error("[daemon] relay error", error);
        reject(error);
      });
    });
  }

  announcePairingSlot(slot: PairingSlot): void {
    this.sendMessage({
      v: 1,
      type: "device.pair.ready",
      payload: slot,
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }

  sendMessage(message: Omit<Message, "id"> & { id?: string }): void {
    console.log(`[daemon] send -> ${message.type}`);
    if (!this.socket) {
      return;
    }
    const payload = validateMessage(message);
    this.maybeSendPushTrigger(payload);
    const sessionId = this.getEnvelopeSessionId(payload);
    const requestId = this.getEnvelopeRequestId(payload);
    const routingPayload = this.getEnvelopeRoutingPayload(payload);
    this.maybeInitiateRatchet(payload, sessionId);
    const seq = ++this.sequence;
    const encoded = this.encodeOutgoingMessage(payload, sessionId, seq);
    const envelope = encodeEnvelope(payload, {
      identity: this.options.identity,
      from: this.options.certificates.deviceId,
      seq,
      sessionId,
      requestId,
      routingPayload,
      ciphertext: encoded.ciphertext,
      cipherMode: encoded.cipherMode,
      senderPubkey:
        encoded.cipherMode === "noise_static_v1"
          ? this.getEnvelopeSenderPubkey(sessionId, payload.type)
          : undefined,
    });
    this.socket.send(JSON.stringify(envelope));
  }

  private async handleIncomingMessage(message: Message): Promise<void> {
    if (message.type === "key.ratchet") {
      this.handleIncomingRatchet(message);
      return;
    }

    if (message.type === "key.ratchet_ack") {
      this.handleIncomingRatchetAck(message);
      return;
    }

    await this.options.handlers?.onMessage?.(message, this);
  }

  private decodeIncoming(raw: string): Message {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "ciphertext" in parsed &&
      "sig" in parsed
    ) {
      const envelope = validateEnvelope(parsed);
      if (
        envelope.cipher_mode === "noise_static_v1" &&
        envelope.message_type &&
        RoutingPayloadPlaceholderMessageTypes.has(envelope.message_type) &&
        envelope.routing_payload
      ) {
        return this.decodeRoutingPayloadEnvelope(envelope);
      }
      if (envelope.cipher_mode === "noise_static_v1") {
        return this.decodeEncryptedEnvelope(envelope);
      }
      return decodeEnvelope(raw);
    }

    const message = validateMessage(parsed);
    if (!AllowedLegacyRawInboundMessageTypes.has(message.type)) {
      throw new Error(
        `Legacy raw relay messages are no longer allowed for ${message.type}`,
      );
    }

    return message;
  }

  private encodeOutgoingMessage(
    message: Message,
    sessionId: string,
    seq: number,
  ): { ciphertext: string; cipherMode: "plain" | "noise_static_v1" } {
    if (PlaceholderOutboundDaemonMessageTypes.has(message.type)) {
      return {
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        cipherMode: "noise_static_v1",
      };
    }

    if (
      sessionId.length > 0 &&
      EncryptedDaemonMessageTypes.has(message.type) &&
      this.sessionCrypto.has(sessionId)
    ) {
      const nonce = createSessionNonce(sessionId, seq);
      const state = this.sessionCrypto.get(sessionId)!;
      const cipher =
        message.type === "key.ratchet"
          ? state.previousCipher ?? state.currentCipher
          : state.currentCipher;
      const ciphertext = cipher
        .encrypt(Buffer.from(JSON.stringify(message), "utf8"), nonce)
        .toString("base64url");
      state.outboundEncryptedCount += 1;
      return {
        ciphertext,
        cipherMode: "noise_static_v1",
      };
    }

    return {
      ciphertext: Buffer.from(JSON.stringify(message), "utf8").toString(
        "base64url",
      ),
      cipherMode: "plain",
    };
  }

  private decodeRoutingPayloadEnvelope(envelope: Envelope): Message {
    const decoded = JSON.parse(
      Buffer.from(envelope.routing_payload ?? "", "base64url").toString("utf8"),
    ) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("Envelope routing_payload must decode to an object");
    }

    return validateMessage({
      v: 1,
      ...(envelope.request_id ? { id: envelope.request_id } : {}),
      type: envelope.message_type,
      payload: decoded,
    });
  }

  private decodeEncryptedEnvelope(envelope: Envelope): Message {
    if (!envelope.sender_pubkey) {
      throw new Error("Encrypted envelope missing sender_pubkey");
    }
    if (!envelope.message_type) {
      throw new Error("Encrypted envelope missing message_type");
    }
    if (!EncryptedAppMessageTypes.has(envelope.message_type)) {
      throw new Error(
        `Encrypted envelope type is not supported: ${envelope.message_type}`,
      );
    }
    if (envelope.session_id.length === 0) {
      throw new Error("Encrypted envelope missing session_id");
    }

    const state = this.getOrCreateSessionState(
      envelope.session_id,
      envelope.sender_pubkey,
    );
    const nonce = createSessionNonce(envelope.session_id, envelope.seq);
    const plaintext = this.decryptWithSessionState(
      state,
      Buffer.from(envelope.ciphertext, "base64url"),
      nonce,
    );
    const message = validateMessage(
      JSON.parse(plaintext.toString("utf8")) as unknown,
    );
    if (message.type !== envelope.message_type) {
      throw new Error("Envelope message_type does not match decrypted message");
    }
    return message;
  }

  private maybeInitiateRatchet(message: Message, sessionId: string): void {
    if (
      sessionId.length === 0 ||
      sessionId === TransportControlSessionId ||
      !EncryptedDaemonMessageTypes.has(message.type) ||
      !this.socket
    ) {
      return;
    }

    const state = this.sessionCrypto.get(sessionId);
    if (!state || state.pendingRatchet) {
      return;
    }

    const ratchetDueByCount =
      state.outboundEncryptedCount >= this.ratchetMessageLimit;
    const ratchetDueByTime =
      Date.now() - state.lastRatchetAt >= this.ratchetMaxAgeMs;
    if (!ratchetDueByCount && !ratchetDueByTime) {
      return;
    }

    const nextKeyPair = generateKeyPairSync("x25519");
    const nextPubkey = exportX25519PublicKeyBase64Url(nextKeyPair.publicKey);
    state.previousCipher = state.currentCipher;
    state.localPrivateKey = nextKeyPair.privateKey;
    state.localPublicKeyBase64Url = nextPubkey;
    state.currentCipher = new SessionCipher(
      deriveSessionKeys({
        role: "initiator",
        localPrivateKey: state.localPrivateKey,
        localPublicKeyBase64Url: state.localPublicKeyBase64Url,
        remotePublicKeyBase64Url: state.appIdentityPubkey,
      }),
    );
    state.pendingRatchet = { nextPubkey };
    state.outboundEncryptedCount = 0;
    state.lastRatchetAt = Date.now();

    this.sendMessage({
      v: 1,
      type: "key.ratchet",
      payload: {
        session_id: sessionId,
        next_pubkey: nextPubkey,
      },
    });
  }

  private handleIncomingRatchet(
    message: Extract<Message, { type: "key.ratchet" }>,
  ): void {
    const state = this.sessionCrypto.get(message.payload.session_id);
    if (!state) {
      throw new Error(
        `Session ratchet received before encrypted session state exists: ${message.payload.session_id}`,
      );
    }

    state.appIdentityPubkey = message.payload.next_pubkey;
    state.previousCipher = state.currentCipher;
    state.currentCipher = new SessionCipher(
      deriveSessionKeys({
        role: "responder",
        localPrivateKey: state.localPrivateKey,
        localPublicKeyBase64Url: state.localPublicKeyBase64Url,
        remotePublicKeyBase64Url: message.payload.next_pubkey,
      }),
    );
    state.pendingRatchet = null;
    state.outboundEncryptedCount = 0;
    state.lastRatchetAt = Date.now();

    this.sendMessage({
      v: 1,
      type: "key.ratchet_ack",
      payload: {
        session_id: message.payload.session_id,
      },
    });
  }

  private handleIncomingRatchetAck(
    message: Extract<Message, { type: "key.ratchet_ack" }>,
  ): void {
    const state = this.sessionCrypto.get(message.payload.session_id);
    if (!state) {
      return;
    }

    state.previousCipher = null;
    state.pendingRatchet = null;
    state.lastRatchetAt = Date.now();
  }

  private decryptWithSessionState(
    state: SessionCryptoState,
    ciphertext: Buffer,
    nonce: Buffer,
  ): Buffer {
    try {
      return state.currentCipher.decrypt(ciphertext, nonce);
    } catch (currentError) {
      if (state.previousCipher) {
        return state.previousCipher.decrypt(ciphertext, nonce);
      }
      throw currentError;
    }
  }

  private getOrCreateSessionState(
    sessionId: string,
    appPubkey: string,
  ): SessionCryptoState {
    const existing = this.sessionCrypto.get(sessionId);
    if (existing) {
      return existing;
    }

    const pairingTransportKeys =
      this.options.pairingTransportKeys?.get(appPubkey);
    const state: SessionCryptoState = {
      appIdentityPubkey: appPubkey,
      localPrivateKey: this.options.identity.x25519PrivateKeyPem,
      localPublicKeyBase64Url: this.options.identity.x25519PublicKeyBase64Url,
      currentCipher:
        pairingTransportKeys !== null && pairingTransportKeys !== undefined
          ? new SessionCipher({
              sendKey: pairingTransportKeys.sendKey,
              recvKey: pairingTransportKeys.recvKey,
            })
          : new SessionCipher(
              deriveSessionKeys({
                role: "responder",
                localPrivateKey: this.options.identity.x25519PrivateKeyPem,
                localPublicKeyBase64Url:
                  this.options.identity.x25519PublicKeyBase64Url,
                remotePublicKeyBase64Url: appPubkey,
              }),
            ),
      previousCipher: null,
      pendingRatchet: null,
      outboundEncryptedCount: 0,
      lastRatchetAt: Date.now(),
    };
    this.sessionCrypto.set(sessionId, state);
    return state;
  }

  private getEnvelopeSessionId(message: Message): string {
    if (
      "session_id" in message.payload &&
      typeof message.payload.session_id === "string"
    ) {
      return message.payload.session_id;
    }

    if (TransportControlMessageTypes.has(message.type)) {
      return TransportControlSessionId;
    }

    if (TransportControlPlaceholderMessageTypes.has(message.type)) {
      return TransportControlSessionId;
    }

    if (
      message.type === "error" &&
      typeof message.payload.request_id === "string" &&
      message.payload.request_id.length > 0 &&
      message.payload.session_id === null
    ) {
      return TransportControlSessionId;
    }

    return "";
  }

  private getEnvelopeRequestId(message: Message): string | undefined {
    if (typeof message.id === "string" && message.id.length > 0) {
      return message.id;
    }

    if (
      "request_id" in message.payload &&
      typeof message.payload.request_id === "string" &&
      message.payload.request_id.length > 0
    ) {
      return message.payload.request_id;
    }

    return undefined;
  }

  private getEnvelopeRoutingPayload(message: Message): string | undefined {
    if (message.type === "session.start.result") {
      const payload =
        message.payload.status === "rejected"
          ? {
              status: "rejected",
              code: message.payload.code,
            }
          : {
              status: "started",
            };
      return Buffer.from(JSON.stringify(payload), "utf8").toString(
        "base64url",
      );
    }

    if (message.type === "session.event") {
      return Buffer.from(
        JSON.stringify(createSessionEventRoutingPayload(message)),
        "utf8",
      ).toString("base64url");
    }

    if (message.type === "danger.pending" || message.type === "danger.result") {
      return Buffer.from(
        JSON.stringify(message.payload),
        "utf8",
      ).toString("base64url");
    }

    if (message.type === "push.trigger") {
      return Buffer.from(JSON.stringify(message.payload), "utf8").toString(
        "base64url",
      );
    }

    if (message.type === "error") {
      return Buffer.from(JSON.stringify(message.payload), "utf8").toString(
        "base64url",
      );
    }

    if (!PlaceholderOutboundDaemonMessageTypes.has(message.type)) {
      return undefined;
    }

    return Buffer.from(JSON.stringify(message.payload), "utf8").toString(
      "base64url",
    );
  }

  private getEnvelopeSenderPubkey(
    sessionId: string,
    messageType: string,
  ): string | undefined {
    if (sessionId.length > 0 && sessionId !== TransportControlSessionId) {
      const state = this.sessionCrypto.get(sessionId);
      if (state) {
        return state.localPublicKeyBase64Url;
      }
    }

    if (
      sessionId === TransportControlSessionId ||
      PlaceholderOutboundDaemonMessageTypes.has(messageType) ||
      RoutingPayloadPlaceholderMessageTypes.has(messageType) ||
      TransportControlMessageTypes.has(messageType)
    ) {
      return this.options.identity.x25519PublicKeyBase64Url;
    }

    return this.options.identity.x25519PublicKeyBase64Url;
  }

  private maybeSendPushTrigger(message: Message): void {
    if (message.type === "push.trigger") {
      return;
    }

    const trigger = this.createPushTriggerMessage(message);
    if (!trigger) {
      return;
    }

    const payload = validateMessage(trigger);
    const sessionId = this.getEnvelopeSessionId(payload);
    const requestId = this.getEnvelopeRequestId(payload);
    const routingPayload = this.getEnvelopeRoutingPayload(payload);
    const seq = ++this.sequence;
    const encoded = this.encodeOutgoingMessage(payload, sessionId, seq);
    const envelope = encodeEnvelope(payload, {
      identity: this.options.identity,
      from: this.options.certificates.deviceId,
      seq,
      sessionId,
      requestId,
      routingPayload,
      ciphertext: encoded.ciphertext,
      cipherMode: encoded.cipherMode,
      senderPubkey:
        encoded.cipherMode === "noise_static_v1"
          ? this.getEnvelopeSenderPubkey(sessionId, payload.type)
          : undefined,
    });
    this.socket?.send(JSON.stringify(envelope));
  }

  private createPushTriggerMessage(
    message: Message,
  ): Extract<Message, { type: "push.trigger" }> | null {
    if (
      message.type === "danger.pending" &&
      this.sessionCrypto.has(message.payload.session_id)
    ) {
      return {
        v: 1,
        type: "push.trigger",
        payload: {
          session_id: message.payload.session_id,
          event_type: "danger_pending",
        },
      };
    }

    if (
      message.type === "session.event" &&
      message.payload.event.event_type === "session.done" &&
      this.sessionCrypto.has(message.payload.session_id)
    ) {
      return {
        v: 1,
        type: "push.trigger",
        payload: {
          session_id: message.payload.session_id,
          event_type: "task_done",
        },
      };
    }

    if (
      message.type === "error" &&
      typeof message.payload.session_id === "string" &&
      message.payload.session_id.length > 0 &&
      message.payload.session_id !== TransportControlSessionId &&
      this.sessionCrypto.has(message.payload.session_id)
    ) {
      return {
        v: 1,
        type: "push.trigger",
        payload: {
          session_id: message.payload.session_id,
          event_type: "session_error",
        },
      };
    }

    return null;
  }

  private tryReplyIncomingError(raw: string, error: unknown): void {
    if (!this.socket) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    if (!("ciphertext" in parsed) || !("sig" in parsed)) {
      this.tryReplyRawIncomingError(parsed, error);
      return;
    }

    let envelope: Envelope;
    try {
      envelope = validateEnvelope(parsed);
    } catch {
      return;
    }

    if (envelope.message_type === "error") {
      return;
    }

    const requestId =
      typeof envelope.request_id === "string" && envelope.request_id.length > 0
        ? envelope.request_id
        : envelope.message_type ?? "incoming-envelope";
    const sessionId =
      envelope.session_id.length > 0 &&
      envelope.session_id !== TransportControlSessionId
        ? envelope.session_id
        : null;
    const message = normalizeIncomingEnvelopeError(error);

    this.sendMessage({
      v: 1,
      type: "error",
      payload: {
        request_id: requestId,
        session_id: sessionId,
        code: "PROTOCOL_VERSION",
        message,
      },
    });
  }

  private tryReplyRawIncomingError(parsed: object, error: unknown): void {
    let message: Message;
    try {
      message = validateMessage(parsed);
    } catch {
      return;
    }

    if (AllowedLegacyRawInboundMessageTypes.has(message.type)) {
      return;
    }

    const requestId = this.getEnvelopeRequestId(message) ?? message.type;
    const sessionId =
      "session_id" in message.payload &&
      typeof message.payload.session_id === "string" &&
      message.payload.session_id.length > 0 &&
      message.payload.session_id !== TransportControlSessionId
        ? message.payload.session_id
        : null;

    this.sendMessage({
      v: 1,
      type: "error",
      payload: {
        request_id: requestId,
        session_id: sessionId,
        code: "PROTOCOL_VERSION",
        message: normalizeIncomingEnvelopeError(error),
      },
    });
  }
}

function normalizeIncomingEnvelopeError(error: unknown): string {
  if (error instanceof Error) {
    const text = error.message.trim();
    if (text.length > 0) {
      return text;
    }
  }

  return "Invalid inbound relay message";
}

function createSessionEventRoutingPayload(
  message: SessionEventMessage,
): SessionEventMessage["payload"] {
  return {
    session_id: message.payload.session_id,
    agent_id: message.payload.agent_id ?? null,
    agent_type: message.payload.agent_type ?? null,
    seq: message.payload.seq,
    event: createSessionEventRoutingBody(message),
  };
}

function createSessionEventRoutingBody(
  message: SessionEventMessage,
): SessionEventMessage["payload"]["event"] {
  switch (message.payload.event.event_type) {
    case "assistant.delta":
      return {
        event_type: "assistant.delta",
        text: "",
      };
    case "assistant.thinking":
      return {
        event_type: "assistant.thinking",
        text: "",
      };
    case "tool.use":
      return {
        event_type: "tool.use",
        tool_name: "encrypted",
        tool_input: {},
        tool_use_id: "encrypted-tool-use",
      };
    case "tool.result":
      return {
        event_type: "tool.result",
        tool_use_id: "encrypted-tool-use",
        tool_name: "encrypted",
        is_error: message.payload.event.is_error,
        content: "",
      };
    case "file.changed":
      return {
        event_type: "file.changed",
        file_path: "encrypted",
        diff: "",
        added: 0,
        removed: 0,
      };
    case "session.usage":
      return {
        event_type: "session.usage",
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cost_usd: 0,
      };
    case "session.done":
      return {
        event_type: "session.done",
        exit_code: message.payload.event.exit_code,
        duration_ms: message.payload.event.duration_ms,
      };
    case "pty.data":
      return {
        event_type: "pty.data",
        bytes: "",
      };
  }
}

function exportX25519PublicKeyBase64Url(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "X25519" || typeof jwk.x !== "string") {
    throw new Error("Unable to export X25519 ratchet public key");
  }
  return Buffer.from(jwk.x, "base64url").toString("base64url");
}
