export interface PresenceRecord {
  deviceId: string;
  machineName: string;
  online: boolean;
  ts: number;
}

export class PresenceService {
  private readonly devices = new Map<string, PresenceRecord>();

  markOnline(deviceId: string, machineName = "unknown"): PresenceRecord {
    const record: PresenceRecord = {
      deviceId,
      machineName,
      online: true,
      ts: Date.now(),
    };
    this.devices.set(deviceId, record);
    return record;
  }

  markOffline(deviceId: string): PresenceRecord | undefined {
    const current = this.devices.get(deviceId);
    if (!current) {
      return undefined;
    }
    const next = {
      ...current,
      online: false,
      ts: Date.now(),
    };
    this.devices.set(deviceId, next);
    return next;
  }

  get(deviceId: string): PresenceRecord | undefined {
    return this.devices.get(deviceId);
  }
}

