import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import type { BootstrapTokenRecord } from "../auth/bootstrap-tokens.js";
import type { AppDeviceRecord, DaemonDeviceRecord } from "../auth/device-registry.js";

const ServerStateSchema = z.object({
  jwtSecret: z.string().min(1),
  certificateAuthority: z.object({
    caCertPem: z.string().min(1),
    caKeyPem: z.string().min(1),
  }),
  devices: z.object({
    daemonDevices: z.array(
      z.object({
        deviceId: z.string().min(1),
        devicePubKey: z.string().min(1),
        certPem: z.string().min(1),
        caCertPem: z.string().min(1),
        registeredAt: z.number().int().nonnegative(),
        machineName: z.string().min(1).optional(),
        os: z.string().min(1).optional(),
        revokedAt: z.number().int().nonnegative().optional(),
      }),
    ),
    appDevices: z.array(
      z.object({
        deviceId: z.string().min(1),
        linkedDaemonId: z.string().min(1),
        appPubKey: z.string().min(1),
        appEd25519PubKey: z.string().min(1),
        appDeviceName: z.string().min(1),
        createdAt: z.number().int().nonnegative(),
        pushPlatform: z.enum(["ios", "android"]).optional(),
        apnsToken: z.string().min(1).optional(),
        manufacturer: z.enum(["Xiaomi", "OPPO", "vivo", "Other"]).optional(),
        vendorToken: z.string().min(1).optional(),
        pushTokenUpdatedAt: z.number().int().nonnegative().optional(),
        revokedAt: z.number().int().nonnegative().optional(),
      }),
    ),
  }),
  bootstrapTokens: z.array(
    z.object({
      tokenHash: z.string().min(1),
      expiresAt: z.number().int().nonnegative(),
      consumedAt: z.number().int().nonnegative().optional(),
    }),
  ),
});

export type PersistedServerState = {
  jwtSecret: string;
  certificateAuthority: {
    caCertPem: string;
    caKeyPem: string;
  };
  devices: {
    daemonDevices: DaemonDeviceRecord[];
    appDevices: AppDeviceRecord[];
  };
  bootstrapTokens: BootstrapTokenRecord[];
};

export class ServerStateStore {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = resolve(process.cwd(), ".hellobug/server-state.json"),
  ) {}

  async load(): Promise<PersistedServerState | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = ServerStateSchema.parse(JSON.parse(raw));
      return {
        jwtSecret: parsed.jwtSecret,
        certificateAuthority: parsed.certificateAuthority,
        devices: {
          daemonDevices: parsed.devices.daemonDevices,
          appDevices: parsed.devices.appDevices,
        },
        bootstrapTokens: parsed.bootstrapTokens,
      };
    } catch {
      return null;
    }
  }

  async save(state: PersistedServerState): Promise<void> {
    const payload = JSON.stringify(ServerStateSchema.parse(state), null, 2);
    this.saveQueue = this.saveQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tempPath, payload, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(tempPath, this.filePath);
    });
    await this.saveQueue;
  }
}
