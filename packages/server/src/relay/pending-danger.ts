import type { Envelope, Message } from "@hellobug/protocol";

type DangerPendingMessage = Extract<Message, { type: "danger.pending" }>;

export interface RelayPendingDangerEntry {
  appDeviceId: string;
  daemonDeviceId: string;
  message: DangerPendingMessage;
  envelope?: Envelope;
  storedAt: number;
  expiresAt: number;
}

export interface RelayPendingDangerRegistryOptions {
  maxRetentionMs?: number;
  now?: () => number;
}

export class RelayPendingDangerRegistry {
  private readonly pendingById = new Map<string, RelayPendingDangerEntry>();
  private readonly dangerIdsByApp = new Map<string, Set<string>>();
  private readonly dangerIdsByDaemon = new Map<string, Set<string>>();
  private readonly maxRetentionMs: number;
  private readonly now: () => number;

  constructor(options: RelayPendingDangerRegistryOptions = {}) {
    this.maxRetentionMs = options.maxRetentionMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  upsert(
    appDeviceId: string,
    daemonDeviceId: string,
    message: DangerPendingMessage,
    envelope?: Envelope,
  ): void {
    const ts = this.now();
    this.pruneExpired(ts);

    this.remove(message.payload.danger_id);

    const expiresAt = Math.min(
      message.payload.timeout_at,
      ts + this.maxRetentionMs,
    );

    const entry: RelayPendingDangerEntry = {
      appDeviceId,
      daemonDeviceId,
      message,
      envelope,
      storedAt: ts,
      expiresAt,
    };

    this.pendingById.set(message.payload.danger_id, entry);
    this.indexDangerId(this.dangerIdsByApp, appDeviceId, message.payload.danger_id);
    this.indexDangerId(
      this.dangerIdsByDaemon,
      daemonDeviceId,
      message.payload.danger_id,
    );
  }

  listForApp(appDeviceId: string): RelayPendingDangerEntry[] {
    const ts = this.now();
    this.pruneExpired(ts);

    return Array.from(this.dangerIdsByApp.get(appDeviceId) ?? [])
      .map((dangerId) => this.pendingById.get(dangerId))
      .filter((entry): entry is RelayPendingDangerEntry => Boolean(entry))
      .sort((left, right) => left.storedAt - right.storedAt)
      .map((entry) => ({
        ...entry,
      }));
  }

  remove(dangerId: string): boolean {
    const entry = this.pendingById.get(dangerId);
    if (!entry) {
      return false;
    }

    this.pendingById.delete(dangerId);
    this.unindexDangerId(this.dangerIdsByApp, entry.appDeviceId, dangerId);
    this.unindexDangerId(this.dangerIdsByDaemon, entry.daemonDeviceId, dangerId);
    return true;
  }

  removeForDaemon(daemonDeviceId: string): void {
    const dangerIds = Array.from(
      this.dangerIdsByDaemon.get(daemonDeviceId) ?? [],
    );
    for (const dangerId of dangerIds) {
      this.remove(dangerId);
    }
  }

  getSize(): number {
    const ts = this.now();
    this.pruneExpired(ts);
    return this.pendingById.size;
  }

  private pruneExpired(ts: number): void {
    for (const [dangerId, entry] of this.pendingById.entries()) {
      if (entry.expiresAt <= ts) {
        this.remove(dangerId);
      }
    }
  }

  private indexDangerId(
    index: Map<string, Set<string>>,
    key: string,
    dangerId: string,
  ): void {
    const ids = index.get(key) ?? new Set<string>();
    ids.add(dangerId);
    index.set(key, ids);
  }

  private unindexDangerId(
    index: Map<string, Set<string>>,
    key: string,
    dangerId: string,
  ): void {
    const ids = index.get(key);
    if (!ids) {
      return;
    }

    ids.delete(dangerId);
    if (ids.size === 0) {
      index.delete(key);
    }
  }
}
