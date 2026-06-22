export interface RelaySessionRecord {
  sessionId: string;
  appDeviceId: string;
  daemonDeviceId: string;
  createdAt: number;
}

export class RelaySessionRegistry {
  private readonly sessions = new Map<string, RelaySessionRecord>();

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

  clearDaemon(daemonDeviceId: string): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.daemonDeviceId === daemonDeviceId) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
