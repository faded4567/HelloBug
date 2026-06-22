import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { DaemonConfigSchema, DefaultDaemonConfigPath, type DaemonConfig } from "./schema.js";

export async function loadDaemonConfig(configPath = DefaultDaemonConfigPath): Promise<DaemonConfig> {
  await mkdir(dirname(configPath), { recursive: true });
  const raw = await readFile(configPath, "utf8");
  return DaemonConfigSchema.parse(JSON.parse(raw));
}

