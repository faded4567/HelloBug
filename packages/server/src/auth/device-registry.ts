import { randomUUID } from "node:crypto";

export interface DaemonDeviceRecord {
  deviceId: string;
  devicePubKey: string;
  certPem: string;
  caCertPem: string;
  registeredAt: number;
  machineName?: string;
  os?: string;
  revokedAt?: number;
}

export interface AppDeviceRecord {
  deviceId: string;
  linkedDaemonId: string;
  appPubKey: string;
  appEd25519PubKey: string;
  appDeviceName: string;
  createdAt: number;
  revokedAt?: number;
}

export class DeviceRegistry {
  private readonly daemonDevices = new Map<string, DaemonDeviceRecord>();
  private readonly daemonDeviceByPubKey = new Map<string, string>();
  private readonly appDevices = new Map<string, AppDeviceRecord>();

  registerDaemonDevice(input: {
    devicePubKey: string;
    certPem: string;
    caCertPem: string;
  }): DaemonDeviceRecord {
    const existingId = this.daemonDeviceByPubKey.get(input.devicePubKey);
    if (existingId) {
      const existing = this.daemonDevices.get(existingId);
      if (existing) {
        return existing;
      }
    }

    const record: DaemonDeviceRecord = {
      deviceId: randomUUID(),
      devicePubKey: input.devicePubKey,
      certPem: input.certPem,
      caCertPem: input.caCertPem,
      registeredAt: Date.now(),
    };

    this.daemonDevices.set(record.deviceId, record);
    this.daemonDeviceByPubKey.set(record.devicePubKey, record.deviceId);
    return record;
  }

  registerAppDevice(input: {
    linkedDaemonId: string;
    appPubKey: string;
    appEd25519PubKey: string;
    appDeviceName: string;
  }): AppDeviceRecord {
    const record: AppDeviceRecord = {
      deviceId: randomUUID(),
      linkedDaemonId: input.linkedDaemonId,
      appPubKey: input.appPubKey,
      appEd25519PubKey: input.appEd25519PubKey,
      appDeviceName: input.appDeviceName,
      createdAt: Date.now(),
    };
    this.appDevices.set(record.deviceId, record);
    return record;
  }

  getDaemonDevice(deviceId: string): DaemonDeviceRecord | undefined {
    return this.daemonDevices.get(deviceId);
  }

  getAppDevice(deviceId: string): AppDeviceRecord | undefined {
    return this.appDevices.get(deviceId);
  }

  updateDaemonMetadata(
    deviceId: string,
    metadata: { machineName?: string; os?: string },
  ): DaemonDeviceRecord | undefined {
    const record = this.daemonDevices.get(deviceId);
    if (!record) {
      return undefined;
    }

    if (metadata.machineName) {
      record.machineName = metadata.machineName;
    }
    if (metadata.os) {
      record.os = metadata.os;
    }

    return record;
  }

  revokeDevice(deviceId: string): void {
    const daemon = this.daemonDevices.get(deviceId);
    if (daemon) {
      daemon.revokedAt = Date.now();
      return;
    }

    const app = this.appDevices.get(deviceId);
    if (app) {
      app.revokedAt = Date.now();
    }
  }

  isRevoked(deviceId: string): boolean {
    return Boolean(
      this.daemonDevices.get(deviceId)?.revokedAt ??
        this.appDevices.get(deviceId)?.revokedAt,
    );
  }
}
