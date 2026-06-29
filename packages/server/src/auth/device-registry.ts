import { randomUUID } from "node:crypto";

export interface DaemonDeviceRecord {
  deviceId: string;
  devicePubKey: string;
  certPem: string;
  caCertPem: string;
  registeredAt: number;
  machineName?: string;
  os?: string;
  daemonVersion?: string;
  supportedFeatures?: string[];
  revokedAt?: number;
}

export interface AppDeviceRecord {
  deviceId: string;
  linkedDaemonId: string;
  appPubKey: string;
  appEd25519PubKey: string;
  appDeviceName: string;
  createdAt: number;
  pushPlatform?: "ios" | "android";
  apnsToken?: string;
  manufacturer?: "Xiaomi" | "OPPO" | "vivo" | "Other";
  vendorToken?: string;
  pushTokenUpdatedAt?: number;
  pushTokenInvalidatedAt?: number;
  revokedAt?: number;
}

export class DeviceRegistry {
  private readonly daemonDevices = new Map<string, DaemonDeviceRecord>();
  private readonly daemonDeviceByPubKey = new Map<string, string>();
  private readonly appDevices = new Map<string, AppDeviceRecord>();

  constructor(state?: {
    daemonDevices?: DaemonDeviceRecord[];
    appDevices?: AppDeviceRecord[];
  }) {
    for (const record of state?.daemonDevices ?? []) {
      this.daemonDevices.set(record.deviceId, { ...record });
      this.daemonDeviceByPubKey.set(record.devicePubKey, record.deviceId);
    }

    for (const record of state?.appDevices ?? []) {
      this.appDevices.set(record.deviceId, { ...record });
    }
  }

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

  getDaemonByPubKey(devicePubKey: string): DaemonDeviceRecord | undefined {
    const deviceId = this.daemonDeviceByPubKey.get(devicePubKey);
    return deviceId ? this.daemonDevices.get(deviceId) : undefined;
  }

  getAppDevice(deviceId: string): AppDeviceRecord | undefined {
    return this.appDevices.get(deviceId);
  }

  updateDaemonMetadata(
    deviceId: string,
    metadata: {
      machineName?: string;
      os?: string;
      daemonVersion?: string;
      supportedFeatures?: string[];
    },
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
    if (metadata.daemonVersion) {
      record.daemonVersion = metadata.daemonVersion;
    }
    if (metadata.supportedFeatures) {
      record.supportedFeatures = [...metadata.supportedFeatures];
    }

    return record;
  }

  renameDaemonDevice(
    deviceId: string,
    machineName: string,
  ): DaemonDeviceRecord | undefined {
    const record = this.daemonDevices.get(deviceId);
    if (!record) {
      return undefined;
    }

    record.machineName = machineName;
    return record;
  }

  updateAppPushToken(
    deviceId: string,
    token:
      | {
          platform: "ios";
          apnsToken: string;
        }
      | {
          platform: "android";
          manufacturer: "Xiaomi" | "OPPO" | "vivo" | "Other";
          vendorToken: string;
        },
  ): AppDeviceRecord | undefined {
    const record = this.appDevices.get(deviceId);
    if (!record) {
      return undefined;
    }

    record.pushPlatform = token.platform;
    record.pushTokenUpdatedAt = Date.now();
    delete record.pushTokenInvalidatedAt;

    if (token.platform === "ios") {
      record.apnsToken = token.apnsToken;
      delete record.manufacturer;
      delete record.vendorToken;
      return record;
    }

    delete record.apnsToken;
    record.manufacturer = token.manufacturer;
    record.vendorToken = token.vendorToken;
    return record;
  }

  clearAppPushToken(deviceId: string): AppDeviceRecord | undefined {
    const record = this.appDevices.get(deviceId);
    if (!record) {
      return undefined;
    }

    delete record.pushPlatform;
    delete record.apnsToken;
    delete record.manufacturer;
    delete record.vendorToken;
    record.pushTokenInvalidatedAt = Date.now();
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

  listDaemonDevices(): DaemonDeviceRecord[] {
    return Array.from(this.daemonDevices.values(), (record) => ({
      ...record,
      supportedFeatures: record.supportedFeatures
        ? [...record.supportedFeatures]
        : undefined,
    }));
  }

  listAppDevices(): AppDeviceRecord[] {
    return Array.from(this.appDevices.values(), (record) => ({ ...record }));
  }

  isRevoked(deviceId: string): boolean {
    return Boolean(
      this.daemonDevices.get(deviceId)?.revokedAt ??
        this.appDevices.get(deviceId)?.revokedAt,
    );
  }

  exportState(): {
    daemonDevices: DaemonDeviceRecord[];
    appDevices: AppDeviceRecord[];
  } {
    return {
      daemonDevices: Array.from(this.daemonDevices.values(), (record) => ({ ...record })),
      appDevices: Array.from(this.appDevices.values(), (record) => ({ ...record })),
    };
  }
}
