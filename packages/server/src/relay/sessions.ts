import type { AgentType } from "@hellobug/protocol";

export interface RelaySessionRecord {
  sessionId: string;
  appDeviceId: string;
  daemonDeviceId: string;
  requiresEncryptedTransport: boolean;
  createdAt: number;
  active: boolean;
  completedAt?: number;
}

export interface RelayPendingSessionRecord extends RelaySessionRecord {
  requestId: string;
  agentType: AgentType;
  workspacePath: string;
}

export interface RelaySessionRegistryOptions {
  pendingStartTimeoutMs?: number;
}

interface RelayPendingSessionEntry {
  record: RelayPendingSessionRecord;
  timer: ReturnType<typeof setTimeout> | null;
}

export class RelaySessionRegistry {
  private readonly sessions = new Map<string, RelaySessionRecord>();
  private readonly pendingSessions = new Map<string, RelayPendingSessionEntry>();

  constructor(
    private readonly options: RelaySessionRegistryOptions = {},
  ) {}

  register(
    sessionId: string,
    appDeviceId: string,
    daemonDeviceId: string,
    requiresEncryptedTransport = false,
  ): RelaySessionRecord {
    const record: RelaySessionRecord = {
      sessionId,
      appDeviceId,
      daemonDeviceId,
      requiresEncryptedTransport,
      createdAt: Date.now(),
      active: true,
    };

    this.sessions.set(sessionId, record);
    return record;
  }

  get(sessionId: string): RelaySessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  beginPendingStart(
    sessionId: string,
    appDeviceId: string,
    daemonDeviceId: string,
    requestId: string,
    agentType: AgentType,
    workspacePath: string,
    requiresEncryptedTransport: boolean,
    onTimeout?: (record: RelayPendingSessionRecord) => void,
  ): RelayPendingSessionRecord {
    this.clearPending(sessionId);

    const record: RelayPendingSessionRecord = {
      sessionId,
      appDeviceId,
      daemonDeviceId,
      requestId,
      agentType,
      workspacePath,
      requiresEncryptedTransport,
      createdAt: Date.now(),
      active: false,
    };

    const timeoutMs = this.options.pendingStartTimeoutMs;
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            const entry = this.pendingSessions.get(sessionId);
            if (!entry) {
              return;
            }

            this.pendingSessions.delete(sessionId);
            onTimeout?.(entry.record);
          }, timeoutMs)
        : null;

    timer?.unref?.();
    this.pendingSessions.set(sessionId, { record, timer });
    return record;
  }

  getPending(sessionId: string): RelayPendingSessionRecord | undefined {
    return this.pendingSessions.get(sessionId)?.record;
  }

  confirmPendingStart(sessionId: string): RelaySessionRecord | undefined {
    const pending = this.clearPending(sessionId);
    if (!pending) {
      return this.sessions.get(sessionId);
    }

    const record: RelaySessionRecord = {
      sessionId: pending.record.sessionId,
      appDeviceId: pending.record.appDeviceId,
      daemonDeviceId: pending.record.daemonDeviceId,
      requiresEncryptedTransport: pending.record.requiresEncryptedTransport,
      createdAt: pending.record.createdAt,
      active: true,
    };
    this.sessions.set(sessionId, record);
    return record;
  }

  complete(sessionId: string): RelaySessionRecord | undefined {
    const current = this.sessions.get(sessionId);
    if (!current || !current.active) {
      return current;
    }

    const next: RelaySessionRecord = {
      ...current,
      active: false,
      completedAt: Date.now(),
    };
    this.sessions.set(sessionId, next);
    return next;
  }

  discardPendingStart(sessionId: string): void {
    this.clearPending(sessionId);
  }

  takePendingForDaemon(daemonDeviceId: string): RelayPendingSessionRecord[] {
    const drained: RelayPendingSessionRecord[] = [];

    for (const [sessionId, entry] of Array.from(this.pendingSessions.entries())) {
      if (entry.record.daemonDeviceId !== daemonDeviceId) {
        continue;
      }

      const record = this.clearPending(sessionId);
      if (record) {
        drained.push(record.record);
      }
    }

    return drained;
  }

  clearDaemon(daemonDeviceId: string): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.daemonDeviceId === daemonDeviceId) {
        if (session.active) {
          this.sessions.set(sessionId, {
            ...session,
            active: false,
            completedAt: session.completedAt ?? Date.now(),
          });
        }
      }
    }

    for (const [sessionId, entry] of Array.from(this.pendingSessions.entries())) {
      if (entry.record.daemonDeviceId === daemonDeviceId) {
        this.clearPending(sessionId);
      }
    }
  }

  countForDaemon(daemonDeviceId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.daemonDeviceId === daemonDeviceId && session.active) {
        count += 1;
      }
    }
    return count;
  }

  private clearPending(
    sessionId: string,
  ): RelayPendingSessionEntry | undefined {
    const entry = this.pendingSessions.get(sessionId);
    if (!entry) {
      return undefined;
    }

    this.pendingSessions.delete(sessionId);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    return entry;
  }
}
