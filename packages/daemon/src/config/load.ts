import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { DaemonConfigSchema, DefaultDaemonConfigPath, type DaemonConfig } from "./schema.js";

export async function loadDaemonConfig(
  configPath = process.env.HELLOBUG_DAEMON_CONFIG_PATH ?? DefaultDaemonConfigPath,
): Promise<DaemonConfig> {
  await mkdir(dirname(configPath), { recursive: true });
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        `daemon config not found at ${configPath}; create JSON with server_url, optional register_url/bootstrap_token, and allowed_paths`,
      );
    }
    throw error;
  }
  return DaemonConfigSchema.parse(JSON.parse(raw));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
