import { createHash, randomBytes } from "node:crypto";

import { encodeBase58 } from "../lib/base58.js";

export interface BootstrapTokenRecord {
  tokenHash: string;
  expiresAt: number;
  consumedAt?: number;
}

export class BootstrapTokenRegistry {
  private readonly records = new Map<string, BootstrapTokenRecord>();

  issueToken(ttlMs = 5 * 60_000): { token: string; expiresAt: number } {
    const token = encodeBase58(randomBytes(32));
    const tokenHash = this.hashToken(token);
    const expiresAt = Date.now() + ttlMs;
    this.records.set(tokenHash, { tokenHash, expiresAt });
    return { token, expiresAt };
  }

  consumeToken(token: string): { ok: true } | { ok: false; reason: "missing" | "expired" | "used" } {
    const tokenHash = this.hashToken(token);
    const record = this.records.get(tokenHash);
    if (!record) {
      return { ok: false, reason: "missing" };
    }
    if (record.consumedAt) {
      return { ok: false, reason: "used" };
    }
    if (record.expiresAt < Date.now()) {
      return { ok: false, reason: "expired" };
    }

    record.consumedAt = Date.now();
    return { ok: true };
  }

  pruneExpired(now = Date.now()): void {
    for (const [hash, record] of this.records.entries()) {
      if (record.expiresAt < now) {
        this.records.delete(hash);
      }
    }
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }
}

