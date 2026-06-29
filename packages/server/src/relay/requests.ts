export interface RelayPendingRequestRecord {
  requestId: string;
  appDeviceId: string;
  daemonDeviceId: string;
  messageType: string;
  requiresEncryptedResponse: boolean;
  createdAt: number;
}

export interface RelayRequestRegistryOptions {
  timeoutMs?: number;
}

export interface RelayRequestRegisterOptions {
  requiresEncryptedResponse?: boolean;
  onTimeout?: (record: RelayPendingRequestRecord) => void;
}

interface RelayPendingRequestEntry {
  record: RelayPendingRequestRecord;
  timer: ReturnType<typeof setTimeout> | null;
}

export class RelayRequestRegistry {
  private readonly pending = new Map<string, RelayPendingRequestEntry>();
  private readonly expired = new Map<string, number>();

  constructor(
    private readonly options: RelayRequestRegistryOptions = {},
  ) {}

  register(
    requestId: string,
    appDeviceId: string,
    daemonDeviceId: string,
    messageType: string,
    options: RelayRequestRegisterOptions = {},
  ): RelayPendingRequestRecord {
    this.clearPending(requestId);
    this.expired.delete(requestId);

    const record: RelayPendingRequestRecord = {
      requestId,
      appDeviceId,
      daemonDeviceId,
      messageType,
      requiresEncryptedResponse: options.requiresEncryptedResponse ?? false,
      createdAt: Date.now(),
    };
    const timeoutMs = this.options.timeoutMs;
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            const entry = this.pending.get(requestId);
            if (!entry) {
              return;
            }

            this.pending.delete(requestId);
            this.rememberExpired(requestId);
            options.onTimeout?.(entry.record);
          }, timeoutMs)
        : null;

    timer?.unref?.();
    this.pending.set(requestId, { record, timer });
    return record;
  }

  take(requestId: string): RelayPendingRequestRecord | undefined {
    return this.clearPending(requestId);
  }

  get(requestId: string): RelayPendingRequestRecord | undefined {
    return this.pending.get(requestId)?.record;
  }

  clearForAppDevice(appDeviceId: string): void {
    for (const [requestId, entry] of Array.from(this.pending.entries())) {
      if (entry.record.appDeviceId === appDeviceId) {
        this.clearPending(requestId);
      }
    }
  }

  drainForDaemonDevice(daemonDeviceId: string): RelayPendingRequestRecord[] {
    const drained: RelayPendingRequestRecord[] = [];

    for (const [requestId, entry] of Array.from(this.pending.entries())) {
      if (entry.record.daemonDeviceId !== daemonDeviceId) {
        continue;
      }

      const record = this.clearPending(requestId);
      if (record) {
        drained.push(record);
      }
    }

    return drained;
  }

  wasRecentlyExpired(requestId: string): boolean {
    const expiresAt = this.expired.get(requestId);
    if (!expiresAt) {
      return false;
    }

    if (expiresAt <= Date.now()) {
      this.expired.delete(requestId);
      return false;
    }

    return true;
  }

  private clearPending(requestId: string): RelayPendingRequestRecord | undefined {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return undefined;
    }

    this.pending.delete(requestId);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    return entry.record;
  }

  private rememberExpired(requestId: string): void {
    const timeoutMs = this.options.timeoutMs ?? 0;
    const ttlMs = Math.max(timeoutMs, 1_000);
    this.expired.set(requestId, Date.now() + ttlMs);
  }
}
