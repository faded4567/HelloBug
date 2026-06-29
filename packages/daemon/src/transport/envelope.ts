import { createPrivateKey, sign } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  createEnvelopeSigningPayload,
  type CipherMode,
  type Envelope,
  type Message,
  validateEnvelope,
  validateMessage,
} from "@hellobug/protocol";

import type { DeviceIdentity } from "../crypto/keys.js";

export function encodeEnvelope(
  message: Message,
  options: {
    identity: DeviceIdentity;
    from: string;
    to?: string;
    sessionId?: string;
    seq: number;
    ts?: number;
    messageType?: string;
    cipherMode?: CipherMode;
    senderPubkey?: string;
    requestId?: string;
    routingPayload?: string;
    ciphertext?: string;
  },
): Envelope {
  const ciphertext =
    options.ciphertext ??
    Buffer.from(JSON.stringify(message), "utf8").toString("base64url");
  const ts = options.ts ?? Date.now();
  const envelope: Envelope = {
    from: options.from,
    to: options.to ?? "",
    session_id: options.sessionId ?? "",
    seq: options.seq,
    ts,
    sig: "",
    ciphertext,
    message_type: options.messageType ?? message.type,
    cipher_mode: options.cipherMode ?? "plain",
    ...(options.senderPubkey ? { sender_pubkey: options.senderPubkey } : {}),
    ...(options.requestId ? { request_id: options.requestId } : {}),
    ...(options.routingPayload
      ? { routing_payload: options.routingPayload }
      : {}),
  };

  const payload = createEnvelopeSigningPayload(envelope);
  envelope.sig = sign(
    null,
    payload,
    createPrivateKey(options.identity.ed25519PrivateKeyPem),
  ).toString("base64url");

  return envelope;
}

export function decodeEnvelope(raw: string | Buffer): Message {
  const parsed = JSON.parse(raw.toString()) as unknown;
  const envelope = validateEnvelope(parsed);
  if (envelope.cipher_mode === "noise_static_v1") {
    throw new Error(
      "Encrypted envelopes must be decrypted before decodeEnvelope",
    );
  }
  const innerRaw = JSON.parse(
    Buffer.from(envelope.ciphertext, "base64url").toString("utf8"),
  ) as unknown;
  return validateMessage(innerRaw);
}
