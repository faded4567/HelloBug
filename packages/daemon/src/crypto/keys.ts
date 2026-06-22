import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { toBase64Url } from "../lib/base64url.js";

export const DefaultDeviceKeyPath = resolve(homedir(), ".hellobug/device.key");

interface StoredIdentity {
  deviceId: string;
  createdAt: number;
  ed25519PrivateKeyPem: string;
  ed25519PublicKeyPem: string;
  x25519PrivateKeyPem: string;
  x25519PublicKeyPem: string;
}

export interface DeviceIdentity extends StoredIdentity {
  ed25519PublicKeyBase64Url: string;
  x25519PublicKeyBase64Url: string;
}

export class DeviceKeyStore {
  constructor(private readonly filePath = DefaultDeviceKeyPath) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const existing = JSON.parse(await readFile(this.filePath, "utf8")) as StoredIdentity;
      return this.toIdentity(existing);
    } catch {
      const generated = this.generateIdentity();
      await writeFile(this.filePath, JSON.stringify(generated, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(this.filePath, 0o600);
      return this.toIdentity(generated);
    }
  }

  private generateIdentity(): StoredIdentity {
    const ed25519 = generateKeyPairSync("ed25519");
    const x25519 = generateKeyPairSync("x25519");

    return {
      deviceId: randomUUID(),
      createdAt: Date.now(),
      ed25519PrivateKeyPem: ed25519.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ed25519PublicKeyPem: ed25519.publicKey.export({ type: "spki", format: "pem" }).toString(),
      x25519PrivateKeyPem: x25519.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      x25519PublicKeyPem: x25519.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
  }

  private toIdentity(stored: StoredIdentity): DeviceIdentity {
    return {
      ...stored,
      ed25519PublicKeyBase64Url: toBase64Url(stored.ed25519PublicKeyPem),
      x25519PublicKeyBase64Url: toBase64Url(stored.x25519PublicKeyPem),
    };
  }
}

