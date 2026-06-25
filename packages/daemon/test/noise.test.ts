import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  completeHandshake,
  createSessionNonce,
  deriveSessionKeys,
  initiateHandshake,
  respondHandshake,
  SessionCipher,
} from "../src/crypto/noise.js";

interface NoiseFixture {
  handshake: {
    initiator_static_seed: string;
    initiator_static_pub: string;
    responder_static_seed: string;
    responder_static_pub: string;
    initiator_ephemeral_seed: string;
    initiator_ephemeral_pub: string;
    responder_ephemeral_seed: string;
    responder_ephemeral_pub: string;
    message_1: string;
    message_2: string;
    initiator_handshake_hash: string;
    responder_handshake_hash: string;
    final_handshake_hash: string;
    initiator_send_key: string;
    initiator_recv_key: string;
    responder_send_key: string;
    responder_recv_key: string;
  };
  aead: {
    nonce: string;
    plaintext_utf8: string;
    ciphertext_hex: string;
  };
  ratchet: {
    session_id: string;
    counter: number;
    nonce_hex: string;
    initiator_next_seed: string;
    initiator_next_pub: string;
    initiator_send_key: string;
    initiator_recv_key: string;
  };
  staged_static: {
    initiator_send_key: string;
    initiator_recv_key: string;
    responder_send_key: string;
    responder_recv_key: string;
  };
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/noise_ik_fixture.json", import.meta.url),
    "utf8",
  ),
) as NoiseFixture;

describe("noise helper", () => {
  it("preserves staged static directional session keys for transport compatibility", () => {
    const initiator = deriveSessionKeys({
      role: "initiator",
      localPrivateKey: privateKeyFromSeed(
        fixture.handshake.initiator_static_seed,
        fixture.handshake.initiator_static_pub,
      ),
      localPublicKeyBase64Url: fixture.handshake.initiator_static_pub,
      remotePublicKeyBase64Url: fixture.handshake.responder_static_pub,
    });
    const responder = deriveSessionKeys({
      role: "responder",
      localPrivateKey: privateKeyFromSeed(
        fixture.handshake.responder_static_seed,
        fixture.handshake.responder_static_pub,
      ),
      localPublicKeyBase64Url: fixture.handshake.responder_static_pub,
      remotePublicKeyBase64Url: fixture.handshake.initiator_static_pub,
    });

    expect(initiator.sendKey.toString("hex")).toBe(
      fixture.staged_static.initiator_send_key,
    );
    expect(initiator.recvKey.toString("hex")).toBe(
      fixture.staged_static.initiator_recv_key,
    );
    expect(responder.sendKey.toString("hex")).toBe(
      fixture.staged_static.responder_send_key,
    );
    expect(responder.recvKey.toString("hex")).toBe(
      fixture.staged_static.responder_recv_key,
    );
  });

  it("runs the deterministic 2-message Noise IK transcript and derives matching keys", () => {
    const initiatorStaticPrivate = privateKeyFromSeed(
      fixture.handshake.initiator_static_seed,
      fixture.handshake.initiator_static_pub,
    );
    const responderStaticPrivate = privateKeyFromSeed(
      fixture.handshake.responder_static_seed,
      fixture.handshake.responder_static_pub,
    );
    const initiatorEphemeralPrivate = privateKeyFromSeed(
      fixture.handshake.initiator_ephemeral_seed,
      fixture.handshake.initiator_ephemeral_pub,
    );
    const responderEphemeralPrivate = privateKeyFromSeed(
      fixture.handshake.responder_ephemeral_seed,
      fixture.handshake.responder_ephemeral_pub,
    );

    const initiated = initiateHandshake({
      localStaticPrivateKey: initiatorStaticPrivate,
      localStaticPublicKey: publicKeyBytes(initiatorStaticPrivate),
      remoteStaticPublicKey: Buffer.from(
        fixture.handshake.responder_static_pub,
        "base64url",
      ),
      localEphemeralPrivateKey: initiatorEphemeralPrivate,
      localEphemeralPublicKey: Buffer.from(
        fixture.handshake.initiator_ephemeral_pub,
        "base64url",
      ),
    });
    expect(initiated.message.toString("base64url")).toBe(
      fixture.handshake.message_1,
    );
    expect(initiated.state.handshakeHash.toString("hex")).toBe(
      fixture.handshake.initiator_handshake_hash,
    );

    const responded = respondHandshake({
      localStaticPrivateKey: responderStaticPrivate,
      localStaticPublicKey: publicKeyBytes(responderStaticPrivate),
      remoteStaticPublicKey: Buffer.from(
        fixture.handshake.initiator_static_pub,
        "base64url",
      ),
      localEphemeralPrivateKey: responderEphemeralPrivate,
      localEphemeralPublicKey: Buffer.from(
        fixture.handshake.responder_ephemeral_pub,
        "base64url",
      ),
      message: initiated.message,
    });
    expect(responded.message.toString("base64url")).toBe(
      fixture.handshake.message_2,
    );
    expect(responded.state.handshakeHash.toString("hex")).toBe(
      fixture.handshake.responder_handshake_hash,
    );
    expect(responded.pairingHandshakeHash.toString("hex")).toBe(
      fixture.handshake.initiator_handshake_hash,
    );
    expect(responded.keys.sendKey.toString("hex")).toBe(
      fixture.handshake.responder_send_key,
    );
    expect(responded.keys.recvKey.toString("hex")).toBe(
      fixture.handshake.responder_recv_key,
    );

    const completed = completeHandshake({
      localStaticPrivateKey: initiatorStaticPrivate,
      remoteStaticPublicKey: Buffer.from(
        fixture.handshake.responder_static_pub,
        "base64url",
      ),
      localEphemeralPrivateKey: initiatorEphemeralPrivate,
      state: initiated.state,
      message: responded.message,
    });
    expect(completed.state.handshakeHash.toString("hex")).toBe(
      fixture.handshake.final_handshake_hash,
    );
    expect(completed.keys.sendKey.toString("hex")).toBe(
      fixture.handshake.initiator_send_key,
    );
    expect(completed.keys.recvKey.toString("hex")).toBe(
      fixture.handshake.initiator_recv_key,
    );
  });

  it("matches the shared AEAD and nonce fixtures", () => {
    const initiatorCipher = new SessionCipher({
      sendKey: Buffer.from(fixture.handshake.initiator_send_key, "hex"),
      recvKey: Buffer.from(fixture.handshake.initiator_recv_key, "hex"),
    });
    const responderCipher = new SessionCipher({
      sendKey: Buffer.from(fixture.handshake.responder_send_key, "hex"),
      recvKey: Buffer.from(fixture.handshake.responder_recv_key, "hex"),
    });
    const nonce = Buffer.from(fixture.aead.nonce, "hex");
    const plaintext = Buffer.from(fixture.aead.plaintext_utf8, "utf8");

    const ciphertext = initiatorCipher.encrypt(plaintext, nonce);

    expect(ciphertext.toString("hex")).toBe(fixture.aead.ciphertext_hex);
    expect(responderCipher.decrypt(ciphertext, nonce).toString("utf8")).toBe(
      fixture.aead.plaintext_utf8,
    );
    expect(
      createSessionNonce(
        fixture.ratchet.session_id,
        fixture.ratchet.counter,
      ).toString("hex"),
    ).toBe(fixture.ratchet.nonce_hex);
  });

  it("derives the ratchet fixture from the next initiator static key", () => {
    const derived = deriveSessionKeys({
      role: "initiator",
      localPrivateKey: privateKeyFromSeed(
        fixture.ratchet.initiator_next_seed,
        fixture.ratchet.initiator_next_pub,
      ),
      localPublicKeyBase64Url: fixture.ratchet.initiator_next_pub,
      remotePublicKeyBase64Url: fixture.handshake.responder_static_pub,
    });

    expect(derived.sendKey.toString("hex")).toBe(
      fixture.ratchet.initiator_send_key,
    );
    expect(derived.recvKey.toString("hex")).toBe(
      fixture.ratchet.initiator_recv_key,
    );
  });
});

function privateKeyFromSeed(seed: string, publicKey: string) {
  return createPrivateKey({
    key: {
      kty: "OKP",
      crv: "X25519",
      d: seed,
      x: publicKey,
    } satisfies JsonWebKey,
    format: "jwk",
  });
}

function publicKeyBytes(
  privateKey: ReturnType<typeof createPrivateKey>,
): Buffer {
  const jwk = createPublicKey(privateKey).export({
    format: "jwk",
  }) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "X25519" || typeof jwk.x !== "string") {
    throw new Error("invalid X25519 public key");
  }
  return Buffer.from(jwk.x, "base64url");
}
