import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  type KeyObject,
} from "node:crypto";
import { Buffer } from "node:buffer";

export type NoiseRole = "initiator" | "responder";

export interface SessionKeys {
  sendKey: Buffer;
  recvKey: Buffer;
}

export interface NoiseHandshakeState {
  chainingKey: Buffer;
  handshakeHash: Buffer;
}

interface NoiseSymmetricState extends NoiseHandshakeState {
  cipherKey: Buffer | null;
}

export interface InitiatorHandshakeResult {
  state: NoiseHandshakeState;
  localEphemeralPublicKey: Buffer;
  message: Buffer;
}

export interface ResponderHandshakeResult {
  state: NoiseHandshakeState;
  pairingHandshakeHash: Buffer;
  localEphemeralPublicKey: Buffer;
  message: Buffer;
  keys: SessionKeys;
}

export interface CompletedHandshakeResult {
  state: NoiseHandshakeState;
  keys: SessionKeys;
}

const SessionKeyLength = 32;
const SessionKeyMaterialLength = SessionKeyLength * 2;
const CipherNonceLength = 12;
const CipherTagLength = 16;
const HkdfInfo = Buffer.from("hellobug-noise-static-v1", "utf8");
const HkdfSaltLabel = Buffer.from("hellobug-noise-static-salt-v1", "utf8");
const NoiseProtocolName = Buffer.from(
  "Noise_IK_HelloBug_25519_ChaChaPoly_SHA256",
  "utf8",
);
const ZeroNonce = Buffer.alloc(12, 0);
const EmptyBuffer = Buffer.alloc(0);

export function deriveSessionKeys(options: {
  role: NoiseRole;
  localPrivateKey: string | KeyObject;
  localPublicKeyBase64Url: string;
  remotePublicKeyBase64Url: string;
}): SessionKeys {
  const localPrivateKey =
    typeof options.localPrivateKey === "string"
      ? createPrivateKey(options.localPrivateKey)
      : options.localPrivateKey;
  const remotePublicKey = createPublicKey({
    key: {
      kty: "OKP",
      crv: "X25519",
      x: normalizeBase64Url(options.remotePublicKeyBase64Url),
    } satisfies JsonWebKey,
    format: "jwk",
  });
  const sharedSecret = Buffer.from(
    diffieHellman({
      privateKey: localPrivateKey,
      publicKey: remotePublicKey,
    }),
  );

  return deriveSessionKeysFromSharedSecret({
    role: options.role,
    sharedSecret,
    initiatorPublicKeyBase64Url:
      options.role === "initiator"
        ? options.localPublicKeyBase64Url
        : options.remotePublicKeyBase64Url,
    responderPublicKeyBase64Url:
      options.role === "responder"
        ? options.localPublicKeyBase64Url
        : options.remotePublicKeyBase64Url,
  });
}

export function createSessionNonce(sessionId: string, counter: number): Buffer {
  const prefix = createHash("sha256")
    .update(Buffer.from(sessionId, "utf8"))
    .digest()
    .subarray(0, 4);
  const nonce = Buffer.alloc(CipherNonceLength);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 4);
  nonce.writeUInt32BE(counter >>> 0, 8);
  return nonce;
}

export function deriveSessionKeysFromSharedSecret(options: {
  role: NoiseRole;
  sharedSecret: Buffer | Uint8Array;
  initiatorPublicKeyBase64Url: string;
  responderPublicKeyBase64Url: string;
}): SessionKeys {
  const salt = createHash("sha256")
    .update(HkdfSaltLabel)
    .update(Buffer.from(options.initiatorPublicKeyBase64Url, "base64url"))
    .update(Buffer.from(options.responderPublicKeyBase64Url, "base64url"))
    .digest();
  const material = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(options.sharedSecret),
      salt,
      HkdfInfo,
      SessionKeyMaterialLength,
    ),
  );
  const initiatorSendKey = Buffer.from(material.subarray(0, SessionKeyLength));
  const responderSendKey = Buffer.from(
    material.subarray(SessionKeyLength, SessionKeyMaterialLength),
  );

  return options.role === "initiator"
    ? {
        sendKey: initiatorSendKey,
        recvKey: responderSendKey,
      }
    : {
        sendKey: responderSendKey,
        recvKey: initiatorSendKey,
      };
}

export function initializeHandshakeState(): NoiseHandshakeState {
  const protocolHash = createHash("sha256").update(NoiseProtocolName).digest();
  return {
    chainingKey: Buffer.from(protocolHash),
    handshakeHash: Buffer.from(protocolHash),
  };
}

export function initiateHandshake(options: {
  localStaticPrivateKey: string | KeyObject;
  localStaticPublicKey: Buffer | Uint8Array;
  remoteStaticPublicKey: Buffer | Uint8Array;
  localEphemeralPrivateKey: string | KeyObject;
  localEphemeralPublicKey?: Buffer | Uint8Array;
}): InitiatorHandshakeResult {
  const localStaticPrivateKey = asPrivateKey(options.localStaticPrivateKey);
  const localEphemeralPrivateKey = asPrivateKey(
    options.localEphemeralPrivateKey,
  );
  const localStaticPublicKey = validatePublicKeyBytes(
    options.localStaticPublicKey,
  );
  const remoteStaticPublicKey = validatePublicKeyBytes(
    options.remoteStaticPublicKey,
  );
  const localEphemeralPublicKey =
    options.localEphemeralPublicKey !== undefined
      ? validatePublicKeyBytes(options.localEphemeralPublicKey)
      : exportPublicKeyBytes(createPublicKey(localEphemeralPrivateKey));

  let state = initializeSymmetricState();
  state = mixHash(state, remoteStaticPublicKey);
  state = mixHash(state, localEphemeralPublicKey);
  state = mixKey(state, dh(localEphemeralPrivateKey, remoteStaticPublicKey));
  const encryptedStatic = encryptAndHash(state, localStaticPublicKey);
  state = encryptedStatic.state;
  state = mixKey(state, dh(localStaticPrivateKey, remoteStaticPublicKey));

  return {
    state: snapshotState(state),
    localEphemeralPublicKey,
    message: Buffer.concat([
      localEphemeralPublicKey,
      encryptedStatic.ciphertext,
    ]),
  };
}

export function respondHandshake(options: {
  localStaticPrivateKey: string | KeyObject;
  localStaticPublicKey: Buffer | Uint8Array;
  remoteStaticPublicKey: Buffer | Uint8Array;
  localEphemeralPrivateKey: string | KeyObject;
  localEphemeralPublicKey?: Buffer | Uint8Array;
  message: Buffer | Uint8Array;
}): ResponderHandshakeResult {
  const localStaticPrivateKey = asPrivateKey(options.localStaticPrivateKey);
  const localEphemeralPrivateKey = asPrivateKey(
    options.localEphemeralPrivateKey,
  );
  const localStaticPublicKey = validatePublicKeyBytes(
    options.localStaticPublicKey,
  );
  const remoteStaticPublicKey = validatePublicKeyBytes(
    options.remoteStaticPublicKey,
  );
  const localEphemeralPublicKey =
    options.localEphemeralPublicKey !== undefined
      ? validatePublicKeyBytes(options.localEphemeralPublicKey)
      : exportPublicKeyBytes(createPublicKey(localEphemeralPrivateKey));
  const message = Buffer.from(options.message);
  if (message.length !== 32 + 32 + CipherTagLength) {
    throw new Error("invalid initiator handshake message length");
  }

  const initiatorEphemeralPublicKey = validatePublicKeyBytes(
    message.subarray(0, 32),
  );
  const encryptedStatic = message.subarray(32);

  let state = initializeSymmetricState();
  state = mixHash(state, localStaticPublicKey);
  state = mixHash(state, initiatorEphemeralPublicKey);
  state = mixKey(state, dh(localStaticPrivateKey, initiatorEphemeralPublicKey));
  const decryptedStatic = decryptAndHash(state, encryptedStatic);
  state = decryptedStatic.state;
  const initiatorStaticPublicKey = validatePublicKeyBytes(
    decryptedStatic.plaintext,
  );
  if (!initiatorStaticPublicKey.equals(remoteStaticPublicKey)) {
    throw new Error("initiator static public key mismatch");
  }
  state = mixKey(state, dh(localStaticPrivateKey, initiatorStaticPublicKey));
  const pairingHandshakeHash = Buffer.from(state.handshakeHash);
  state = mixHash(state, localEphemeralPublicKey);
  state = mixKey(
    state,
    dh(localEphemeralPrivateKey, initiatorEphemeralPublicKey),
  );
  state = mixKey(state, dh(localEphemeralPrivateKey, initiatorStaticPublicKey));

  const keys = splitSessionKeys(state, "responder");
  return {
    state: snapshotState(state),
    pairingHandshakeHash,
    localEphemeralPublicKey,
    message: Buffer.from(localEphemeralPublicKey),
    keys,
  };
}

export function completeHandshake(options: {
  localStaticPrivateKey: string | KeyObject;
  remoteStaticPublicKey: Buffer | Uint8Array;
  localEphemeralPrivateKey: string | KeyObject;
  state: NoiseHandshakeState;
  message: Buffer | Uint8Array;
}): CompletedHandshakeResult {
  const localStaticPrivateKey = asPrivateKey(options.localStaticPrivateKey);
  const localEphemeralPrivateKey = asPrivateKey(
    options.localEphemeralPrivateKey,
  );
  const remoteStaticPublicKey = validatePublicKeyBytes(
    options.remoteStaticPublicKey,
  );
  const message = Buffer.from(options.message);
  if (message.length !== 32) {
    throw new Error("invalid responder handshake message length");
  }

  const responderEphemeralPublicKey = validatePublicKeyBytes(message);
  let state = resumeSymmetricState(options.state);
  state = mixHash(state, responderEphemeralPublicKey);
  state = mixKey(
    state,
    dh(localEphemeralPrivateKey, responderEphemeralPublicKey),
  );
  state = mixKey(state, dh(localStaticPrivateKey, responderEphemeralPublicKey));

  return {
    state: snapshotState(state),
    keys: splitSessionKeys(state, "initiator"),
  };
}

export class SessionCipher {
  readonly sendKey: Buffer;
  readonly recvKey: Buffer;

  constructor(keys: SessionKeys) {
    this.sendKey = validateKeyLength("sendKey", keys.sendKey);
    this.recvKey = validateKeyLength("recvKey", keys.recvKey);
  }

  encrypt(plaintext: Buffer | Uint8Array, nonce: Buffer | Uint8Array): Buffer {
    return encryptWithKey(plaintext, this.sendKey, nonce);
  }

  decrypt(ciphertext: Buffer | Uint8Array, nonce: Buffer | Uint8Array): Buffer {
    return decryptWithKey(ciphertext, this.recvKey, nonce);
  }
}

export function encryptWithKey(
  plaintext: Buffer | Uint8Array,
  key: Buffer | Uint8Array,
  nonce: Buffer | Uint8Array,
  aad?: Buffer | Uint8Array,
): Buffer {
  const safeKey = validateKeyLength("key", key);
  const safeNonce = validateNonce(nonce);
  const cipher = createCipheriv("chacha20-poly1305", safeKey, safeNonce, {
    authTagLength: CipherTagLength,
  });
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad), {
      plaintextLength: Buffer.byteLength(Buffer.from(plaintext)),
    });
  }
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]);
}

export function decryptWithKey(
  ciphertextWithTag: Buffer | Uint8Array,
  key: Buffer | Uint8Array,
  nonce: Buffer | Uint8Array,
  aad?: Buffer | Uint8Array,
): Buffer {
  const safeCiphertext = Buffer.from(ciphertextWithTag);
  if (safeCiphertext.length < CipherTagLength) {
    throw new Error("ciphertext is too short");
  }

  const safeKey = validateKeyLength("key", key);
  const safeNonce = validateNonce(nonce);
  const ciphertext = safeCiphertext.subarray(
    0,
    safeCiphertext.length - CipherTagLength,
  );
  const authTag = safeCiphertext.subarray(
    safeCiphertext.length - CipherTagLength,
  );
  const decipher = createDecipheriv("chacha20-poly1305", safeKey, safeNonce, {
    authTagLength: CipherTagLength,
  });
  if (aad !== undefined) {
    decipher.setAAD(Buffer.from(aad), { plaintextLength: ciphertext.length });
  }
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function normalizeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("base64url");
}

function validateKeyLength(label: string, key: Buffer | Uint8Array): Buffer {
  const safeKey = Buffer.from(key);
  if (safeKey.length !== SessionKeyLength) {
    throw new Error(`${label} must be ${SessionKeyLength} bytes`);
  }
  return safeKey;
}

function validateNonce(nonce: Buffer | Uint8Array): Buffer {
  const safeNonce = Buffer.from(nonce);
  if (safeNonce.length !== CipherNonceLength) {
    throw new Error(`nonce must be ${CipherNonceLength} bytes`);
  }
  return safeNonce;
}

function validatePublicKeyBytes(bytes: Buffer | Uint8Array): Buffer {
  const safeBytes = Buffer.from(bytes);
  if (safeBytes.length !== 32) {
    throw new Error("X25519 public key must be 32 bytes");
  }
  return safeBytes;
}

function asPrivateKey(key: string | KeyObject): KeyObject {
  return typeof key === "string" ? createPrivateKey(key) : key;
}

function exportPublicKeyBytes(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" }) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "X25519" || typeof jwk.x !== "string") {
    throw new Error("Unable to export X25519 public key");
  }
  return validatePublicKeyBytes(Buffer.from(jwk.x, "base64url"));
}

function importPublicKey(bytes: Buffer | Uint8Array): KeyObject {
  return createPublicKey({
    key: {
      kty: "OKP",
      crv: "X25519",
      x: Buffer.from(bytes).toString("base64url"),
    } satisfies JsonWebKey,
    format: "jwk",
  });
}

function dh(
  localPrivateKey: KeyObject,
  remotePublicKeyBytes: Buffer | Uint8Array,
): Buffer {
  return Buffer.from(
    diffieHellman({
      privateKey: localPrivateKey,
      publicKey: importPublicKey(remotePublicKeyBytes),
    }),
  );
}

function initializeSymmetricState(): NoiseSymmetricState {
  const base = initializeHandshakeState();
  return {
    ...base,
    cipherKey: null,
  };
}

function resumeSymmetricState(state: NoiseHandshakeState): NoiseSymmetricState {
  return {
    chainingKey: Buffer.from(state.chainingKey),
    handshakeHash: Buffer.from(state.handshakeHash),
    cipherKey: null,
  };
}

function snapshotState(state: NoiseSymmetricState): NoiseHandshakeState {
  return {
    chainingKey: Buffer.from(state.chainingKey),
    handshakeHash: Buffer.from(state.handshakeHash),
  };
}

function mixHash(
  state: NoiseSymmetricState,
  input: Buffer | Uint8Array,
): NoiseSymmetricState {
  return {
    chainingKey: Buffer.from(state.chainingKey),
    handshakeHash: createHash("sha256")
      .update(state.handshakeHash)
      .update(Buffer.from(input))
      .digest(),
    cipherKey: state.cipherKey ? Buffer.from(state.cipherKey) : null,
  };
}

function mixKey(
  state: NoiseSymmetricState,
  inputKeyMaterial: Buffer | Uint8Array,
): NoiseSymmetricState {
  const material = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(inputKeyMaterial),
      state.chainingKey,
      EmptyBuffer,
      SessionKeyLength * 2,
    ),
  );
  return {
    chainingKey: Buffer.from(material.subarray(0, SessionKeyLength)),
    handshakeHash: Buffer.from(state.handshakeHash),
    cipherKey: Buffer.from(
      material.subarray(SessionKeyLength, SessionKeyLength * 2),
    ),
  };
}

function encryptAndHash(
  state: NoiseSymmetricState,
  plaintext: Buffer | Uint8Array,
): { state: NoiseSymmetricState; ciphertext: Buffer } {
  const key = state.cipherKey;
  const ciphertext =
    key === null
      ? Buffer.from(plaintext)
      : encryptWithKey(plaintext, key, ZeroNonce, state.handshakeHash);
  return {
    state: mixHash(state, ciphertext),
    ciphertext,
  };
}

function decryptAndHash(
  state: NoiseSymmetricState,
  ciphertext: Buffer | Uint8Array,
): { state: NoiseSymmetricState; plaintext: Buffer } {
  const key = state.cipherKey;
  const safeCiphertext = Buffer.from(ciphertext);
  const plaintext =
    key === null
      ? safeCiphertext
      : decryptWithKey(safeCiphertext, key, ZeroNonce, state.handshakeHash);
  return {
    state: mixHash(state, safeCiphertext),
    plaintext,
  };
}

function splitSessionKeys(
  state: NoiseHandshakeState,
  role: NoiseRole,
): SessionKeys {
  const material = Buffer.from(
    hkdfSync(
      "sha256",
      EmptyBuffer,
      state.chainingKey,
      EmptyBuffer,
      SessionKeyMaterialLength,
    ),
  );
  const initiatorSendKey = Buffer.from(material.subarray(0, SessionKeyLength));
  const responderSendKey = Buffer.from(
    material.subarray(SessionKeyLength, SessionKeyMaterialLength),
  );
  return role === "initiator"
    ? { sendKey: initiatorSendKey, recvKey: responderSendKey }
    : { sendKey: responderSendKey, recvKey: initiatorSendKey };
}
