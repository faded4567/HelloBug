import { homedir } from "node:os";
import { resolve } from "node:path";

import { z } from "zod";

export const DefaultDaemonConfigPath = resolve(homedir(), ".hellobug/daemon.json");

export const DaemonConfigSchema = z.object({
  server_url: z.string().url(),
  register_url: z.string().url().optional(),
  bootstrap_token: z.string().min(1).optional(),
  allowed_paths: z.array(z.string().min(1)).default([]),
  pairing_ttl_ms: z.number().int().positive().optional(),
  pairing_refresh_ms: z.number().int().positive().optional(),
});

export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;

export function resolveRegisterUrl(config: DaemonConfig): string {
  if (config.register_url) {
    return config.register_url;
  }
  if (config.server_url.startsWith("wss://")) {
    return config.server_url.replace(/^wss:/, "https:");
  }
  if (config.server_url.startsWith("ws://")) {
    return config.server_url.replace(/^ws:/, "http:");
  }
  return config.server_url;
}
