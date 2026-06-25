import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject } from "node:crypto";

import {
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
  "history.get",
  "slash.list",
  "pty.input",
  "pty.resize",
]);

const EncryptedDaemonMessageTypes = new Set<string>([
  "session.start.result",
  "session.event",
  "danger.pending",
  "danger.result",
  "fs.tree",
  "fs.file",
  "history.get",
  "slash.list",
  "error",
]);

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

export interface DaemonConnectionHandlers {
  onMessage?: (message: Message, connection: DaemonConnection) => void | Promise<void>;
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
        }
      });

      socket.on("close", (code, reason) => {
        console.log(
          `[daemon] relay closed code=${code} reason=${reason.toString()}`,
        );
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
    const sessionId = this.getSessionId(payload);
    this.maybeInitiateRatchet(payload, sessionId);
    const seq = ++this.sequence;
    const encoded = this.encodeOutgoingMessage(payload, sessionId, seq);
    const envelope = encodeEnvelope(payload, {
      identity: this.options.identity,
      from: this.options.certificates.deviceId,
      seq,
      sessionId,
      ciphertext: encoded.ciphertext,
      cipherMode: encoded.cipherMode,
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
      if (envelope.cipher_mode === "noise_static_v1") {
        return this.decodeEncryptedEnvelope(envelope);
      }
      return decodeEnvelope(raw);
    }

    return validateMessage(parsed);
  }

  private encodeOutgoingMessage(
    message: Message,
    sessionId: string,
    seq: number,
  ): { ciphertext: string; cipherMode: "plain" | "noise_static_v1" } {
    if (
      sessionId.length > 0 &&
      EncryptedDaemonMessageTypes.has(message.type) &&
      this.sessionCrypto.has(sessionId)
    ) {
      const nonce = createSessionNonce(sessionId, seq);
      const state = this.sessionCrypto.get(sessionId)!;
      const ciphertext = state.currentCipher
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

    const pairingTransportKeys = this.options.pairingTransportKeys?.get(
      appPubkey,
    );
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

  private getSessionId(message: Message): string {
    return "session_id" in message.payload &&
      typeof message.payload.session_id === "string"
      ? message.payload.session_id
      : "";
  }
}

function exportX25519PublicKeyBase64Url(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "X25519" || typeof jwk.x !== "string") {
    throw new Error("Unable to export X25519 ratchet public key");
  }
  return Buffer.from(jwk.x, "base64url").toString("base64url");
}
