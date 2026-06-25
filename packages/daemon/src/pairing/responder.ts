import { Buffer } from "node:buffer";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { hostname, platform } from "node:os";

import type { Message } from "@hellobug/protocol";

import type { DeviceIdentity } from "../crypto/keys.js";
import {
  completeHandshake,
  initiateHandshake,
  type NoiseHandshakeState,
} from "../crypto/noise.js";
import { getSas } from "./code.js";

type DevicePairMessage = Extract<Message, { type: "device.pair" }>;
type DevicePairSasMessage = Extract<Message, { type: "device.pair.sas" }>;
type DevicePairConfirmMessage = Extract<
  Message,
  { type: "device.pair.confirm" }
>;

export interface PendingPairingHandshake {
  appPublicKey: Buffer;
  appPublicKeyBase64Url: string;
  localEphemeralPrivateKey: KeyObject;
  state: NoiseHandshakeState;
}

export function buildPairingSasMessage(
  identity: DeviceIdentity,
  payload: DevicePairMessage["payload"],
): {
  message: DevicePairSasMessage;
  pending: PendingPairingHandshake;
} {
  const localEphemeral = generateKeyPairSync("x25519");
  const appPublicKey = Buffer.from(payload.app_pubkey, "base64url");
  const initiated = initiateHandshake({
    localStaticPrivateKey: identity.x25519PrivateKeyPem,
    localStaticPublicKey: Buffer.from(
      identity.x25519PublicKeyBase64Url,
      "base64url",
    ),
    remoteStaticPublicKey: appPublicKey,
    localEphemeralPrivateKey: localEphemeral.privateKey,
  });

  return {
    message: {
      v: 1,
      type: "device.pair.sas",
      payload: {
        sas: getSas(initiated.state.handshakeHash),
        noise_handshake: initiated.message.toString("base64url"),
        daemon_pubkey: identity.x25519PublicKeyBase64Url,
        daemon_ed25519_pubkey: identity.ed25519PublicKeyBase64Url,
        machine_name: hostname(),
        os: platform(),
      },
    },
    pending: {
      appPublicKey,
      appPublicKeyBase64Url: payload.app_pubkey,
      localEphemeralPrivateKey: localEphemeral.privateKey,
      state: initiated.state,
    },
  };
}

export function formatPairingSasLine(message: DevicePairSasMessage): string {
  return message.payload.sas.join(" ");
}

export function completePairingSasHandshake(
  identity: DeviceIdentity,
  pending: PendingPairingHandshake,
  payload: DevicePairConfirmMessage["payload"],
): { sendKey: Buffer; recvKey: Buffer } {
  if (!payload.noise_handshake) {
    throw new Error("pairing confirm is missing noise_handshake");
  }

  const completed = completeHandshake({
    localStaticPrivateKey: identity.x25519PrivateKeyPem,
    localEphemeralPrivateKey: pending.localEphemeralPrivateKey,
    remoteStaticPublicKey: pending.appPublicKey,
    state: pending.state,
    message: Buffer.from(payload.noise_handshake, "base64url"),
  });
  return {
    sendKey: completed.keys.sendKey,
    recvKey: completed.keys.recvKey,
  };
}
