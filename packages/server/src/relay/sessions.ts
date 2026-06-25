export interface RelaySessionRecord {
  sessionId: string;
  appDeviceId: string;
  daemonDeviceId: string;
  createdAt: number;
}

export interface RelayPendingSessionRecord extends RelaySessionRecord {
  requestId: string;
}

export class RelaySessionRegistry {
  private readonly sessions = new Map<string, RelaySessionRecord>();
  private readonly pendingSessions = new Map<string, RelayPendingSessionRecord>();

  register(sessionId: string, appDeviceId: string, daemonDeviceId: string): RelaySessionRecord {
    const record: RelaySessionRecord = {
      sessionId,
      appDeviceId,
      daemonDeviceId,
      createdAt: Date.now(),
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
  ): RelayPendingSessionRecord {
    const record: RelayPendingSessionRecord = {
      sessionId,
      appDeviceId,
      daemonDeviceId,
      requestId,
      createdAt: Date.now(),
    };

    this.pendingSessions.set(sessionId, record);
    return record;
  }

  getPending(sessionId: string): RelayPendingSessionRecord | undefined {
    return this.pendingSessions.get(sessionId);
  }

  confirmPendingStart(sessionId: string): RelaySessionRecord | undefined {
    const pending = this.pendingSessions.get(sessionId);
    if (!pending) {
      return this.sessions.get(sessionId);
    }

    const record: RelaySessionRecord = {
      sessionId: pending.sessionId,
      appDeviceId: pending.appDeviceId,
      daemonDeviceId: pending.daemonDeviceId,
      createdAt: pending.createdAt,
    };
    this.pendingSessions.delete(sessionId);
    this.sessions.set(sessionId, record);
    return record;
  }

  discardPendingStart(sessionId: string): void {
    this.pendingSessions.delete(sessionId);
  }

  clearDaemon(daemonDeviceId: string): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.daemonDeviceId === daemonDeviceId) {
        this.sessions.delete(sessionId);
      }
    }

    for (const [sessionId, session] of this.pendingSessions.entries()) {
      if (session.daemonDeviceId === daemonDeviceId) {
        this.pendingSessions.delete(sessionId);
      }
    }
  }
}
