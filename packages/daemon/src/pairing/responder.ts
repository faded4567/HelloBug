import { createHash } from "node:crypto";
import { hostname, platform } from "node:os";

import type { Message } from "@hellobug/protocol";

import type { DeviceIdentity } from "../crypto/keys.js";
import { getSas } from "./code.js";

type DevicePairMessage = Extract<Message, { type: "device.pair" }>;
type DevicePairSasMessage = Extract<Message, { type: "device.pair.sas" }>;

export function buildPairingSasMessage(
  identity: DeviceIdentity,
  payload: DevicePairMessage["payload"],
): DevicePairSasMessage {
  return {
    v: 1,
    type: "device.pair.sas",
    payload: {
      sas: getSas(derivePairingSeed(identity, payload)),
      daemon_pubkey: identity.x25519PublicKeyBase64Url,
      daemon_ed25519_pubkey: identity.ed25519PublicKeyBase64Url,
      machine_name: hostname(),
      os: platform(),
    },
  };
}

export function formatPairingSasLine(message: DevicePairSasMessage): string {
  return message.payload.sas.join(" ");
}

function derivePairingSeed(
  identity: DeviceIdentity,
  payload: DevicePairMessage["payload"],
): Buffer {
  return createHash("sha256")
    .update(payload.app_pubkey)
    .update(payload.app_ed25519_pubkey)
    .update(identity.x25519PublicKeyBase64Url)
    .update(identity.ed25519PublicKeyBase64Url)
    .digest();
}
