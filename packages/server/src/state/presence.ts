export interface PresenceRecord {
  deviceId: string;
  machineName: string;
  online: boolean;
  lastSeenAt: number | null;
}

export class PresenceService {
  private readonly devices = new Map<string, PresenceRecord>();

  markOnline(deviceId: string, machineName = "unknown"): PresenceRecord {
    const record: PresenceRecord = {
      deviceId,
      machineName,
      online: true,
      lastSeenAt: Date.now(),
    };
    this.devices.set(deviceId, record);
    return record;
  }

  markOffline(deviceId: string, machineName = "unknown"): PresenceRecord {
    const current = this.devices.get(deviceId);
    const next: PresenceRecord = {
      deviceId,
      machineName: current?.machineName ?? machineName,
      online: false,
      lastSeenAt: current?.online ? Date.now() : (current?.lastSeenAt ?? null),
    };
    this.devices.set(deviceId, next);
    return next;
  }

  rename(deviceId: string, machineName: string): PresenceRecord {
    const current = this.devices.get(deviceId);
    const next: PresenceRecord = {
      deviceId,
      machineName,
      online: current?.online ?? false,
      lastSeenAt: current?.lastSeenAt ?? null,
    };
    this.devices.set(deviceId, next);
    return next;
  }

  get(deviceId: string): PresenceRecord | undefined {
    return this.devices.get(deviceId);
  }
}
