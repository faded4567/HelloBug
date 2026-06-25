import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { Buffer } from "node:buffer";

import { toBase64Url } from "../lib/base64url.js";

export const DefaultPairingTransportKeyStorePath = resolve(
  homedir(),
  ".hellobug/pairing-transport-keys.json",
);

interface StoredPairingTransportKeyRecord {
  appPubkey: string;
  sendKey: string;
  recvKey: string;
  updatedAt: number;
}

interface StoredPairingTransportKeyFile {
  version: 1;
  records: StoredPairingTransportKeyRecord[];
}

export interface PairingTransportKeys {
  sendKey: Buffer;
  recvKey: Buffer;
}

export interface PairingTransportKeyRecord extends PairingTransportKeys {
  appPubkey: string;
  updatedAt: number;
}

export class PairingTransportKeyStore {
  private readonly records = new Map<string, PairingTransportKeyRecord>();
  private loaded = false;

  constructor(
    private readonly filePath = DefaultPairingTransportKeyStorePath,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as StoredPairingTransportKeyFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error("invalid pairing transport key store");
      }
      this.records.clear();
      for (const record of parsed.records) {
        if (
          typeof record.appPubkey !== "string" ||
          typeof record.sendKey !== "string" ||
          typeof record.recvKey !== "string" ||
          typeof record.updatedAt !== "number"
        ) {
          continue;
        }
        this.records.set(record.appPubkey, {
          appPubkey: record.appPubkey,
          sendKey: Buffer.from(record.sendKey, "base64url"),
          recvKey: Buffer.from(record.recvKey, "base64url"),
          updatedAt: record.updatedAt,
        });
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
    this.loaded = true;
  }

  get(appPubkey: string): PairingTransportKeyRecord | null {
    const found = this.records.get(appPubkey);
    if (!found) {
      return null;
    }
    return {
      appPubkey: found.appPubkey,
      sendKey: Buffer.from(found.sendKey),
      recvKey: Buffer.from(found.recvKey),
      updatedAt: found.updatedAt,
    };
  }

  async set(appPubkey: string, keys: PairingTransportKeys): Promise<void> {
    await this.load();
    this.records.set(appPubkey, {
      appPubkey,
      sendKey: Buffer.from(keys.sendKey),
      recvKey: Buffer.from(keys.recvKey),
      updatedAt: Date.now(),
    });
    await this.flush();
  }

  private async flush(): Promise<void> {
    const payload: StoredPairingTransportKeyFile = {
      version: 1,
      records: Array.from(this.records.values()).map((record) => ({
        appPubkey: record.appPubkey,
        sendKey: toBase64Url(record.sendKey),
        recvKey: toBase64Url(record.recvKey),
        updatedAt: record.updatedAt,
      })),
    };
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.filePath, 0o600);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
