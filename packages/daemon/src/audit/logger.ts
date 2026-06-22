import { appendFile, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { DeviceIdentity } from "../crypto/keys.js";
import { toBase64Url } from "../lib/base64url.js";

export const DefaultAuditDirectory = resolve(homedir(), ".hellobug/audit");

const AuditFileNamePattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
// The package's ESM export is incomplete in the current workspace install, so we pin to CJS.
const sodium = createRequire(import.meta.url)("libsodium-wrappers") as any;

export interface AuditEntry {
  ts: number;
  session_id: string | null;
  agent_id: string | null;
  device_id: string;
  event_type: string;
  summary: string;
}

export interface AuditEntryInput {
  ts?: number;
  session_id?: string | null;
  agent_id?: string | null;
  event_type: string;
  summary: string;
}

export interface AuditLogger {
  appendAuditEntry(entry: AuditEntryInput): Promise<void>;
  readAuditLog(date: string): Promise<AuditEntry[]>;
}

export interface EncryptedAuditLoggerOptions {
  rootDir?: string;
  retentionDays?: number;
  now?: () => Date;
}

interface StoredAuditLine {
  nonce: string;
  ciphertext: string;
}

export class EncryptedAuditLogger implements AuditLogger {
  private readonly rootDir: string;
  private readonly retentionDays: number;
  private readonly now: () => Date;
  private readonly keyPromise: Promise<Uint8Array>;

  constructor(
    private readonly identity: Pick<DeviceIdentity, "deviceId" | "ed25519PrivateKeyPem">,
    options: EncryptedAuditLoggerOptions = {},
  ) {
    this.rootDir = options.rootDir ?? DefaultAuditDirectory;
    this.retentionDays = options.retentionDays ?? 30;
    this.now = options.now ?? (() => new Date());
    this.keyPromise = deriveAuditKey(identity.ed25519PrivateKeyPem);
  }

  async appendAuditEntry(entry: AuditEntryInput): Promise<void> {
    const now = entry.ts ? new Date(entry.ts) : this.now();
    const record: AuditEntry = {
      ts: entry.ts ?? now.getTime(),
      session_id: entry.session_id ?? null,
      agent_id: entry.agent_id ?? null,
      device_id: this.identity.deviceId,
      event_type: entry.event_type,
      summary: entry.summary,
    };

    await mkdir(this.rootDir, { recursive: true });
    await this.cleanupExpiredLogs(now);

    const encryptedLine = await this.encryptRecord(record);
    const filePath = join(this.rootDir, `${formatDate(now)}.jsonl`);
    await appendFile(filePath, `${JSON.stringify(encryptedLine)}\n`, "utf8");
  }

  async readAuditLog(date: string): Promise<AuditEntry[]> {
    const filePath = join(this.rootDir, `${date}.jsonl`);
    let content: string;

    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const records: AuditEntry[] = [];
    for (const line of lines) {
      const encrypted = JSON.parse(line) as StoredAuditLine;
      records.push(await this.decryptRecord(encrypted));
    }

    return records;
  }

  private async encryptRecord(record: AuditEntry): Promise<StoredAuditLine> {
    const sodiumLib = await sodium.ready.then(() => sodium);
    const key = await this.keyPromise;
    const nonce = sodiumLib.randombytes_buf(
      sodiumLib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
    );
    const ciphertext = sodiumLib.crypto_aead_xchacha20poly1305_ietf_encrypt(
      JSON.stringify(record),
      undefined,
      null,
      nonce,
      key,
    );

    return {
      nonce: toBase64Url(nonce),
      ciphertext: toBase64Url(ciphertext),
    };
  }

  private async decryptRecord(line: StoredAuditLine): Promise<AuditEntry> {
    const sodiumLib = await sodium.ready.then(() => sodium);
    const key = await this.keyPromise;
    const plaintext = sodiumLib.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      Buffer.from(line.ciphertext, "base64url"),
      undefined,
      Buffer.from(line.nonce, "base64url"),
      key,
      "text",
    );

    return JSON.parse(plaintext) as AuditEntry;
  }

  private async cleanupExpiredLogs(now: Date): Promise<void> {
    let files: string[];

    try {
      files = await readdir(this.rootDir);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    const cutoff = new Date(now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000);
    const cutoffDate = formatDate(cutoff);

    await Promise.all(
      files
        .filter((file) => AuditFileNamePattern.test(file))
        .filter((file) => file.slice(0, 10) < cutoffDate)
        .map(async (file) => {
          await unlink(join(this.rootDir, file));
        }),
    );
  }
}

async function deriveAuditKey(secret: string): Promise<Uint8Array> {
  const sodiumLib = await sodium.ready.then(() => sodium);
  return sodiumLib.crypto_generichash(
    sodiumLib.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    secret,
  );
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
