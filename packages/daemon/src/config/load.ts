import { mkdir, readFile } from "node:fs/promises";
import { delimiter, dirname } from "node:path";

import { DaemonConfigSchema, DefaultDaemonConfigPath, type DaemonConfig } from "./schema.js";

export async function loadDaemonConfig(
  configPath = process.env.HELLOBUG_DAEMON_CONFIG_PATH ?? DefaultDaemonConfigPath,
): Promise<DaemonConfig> {
  await mkdir(dirname(configPath), { recursive: true });
  let config: Partial<DaemonConfig> = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8")) as Partial<DaemonConfig>;
  } catch (error) {
    if (isMissingFileError(error)) {
      if (!hasDaemonConfigEnvOverrides()) {
        throw new Error(
          `daemon config not found at ${configPath}; create JSON with server_url, optional register_url/bootstrap_token, and allowed_paths, or set HELLOBUG_DAEMON_SERVER_URL / HELLOBUG_DAEMON_ALLOWED_PATHS`,
        );
      }
    } else {
      throw error;
    }
  }

  return DaemonConfigSchema.parse(applyEnvOverrides(config));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function hasDaemonConfigEnvOverrides(): boolean {
  return (
    readEnvString("HELLOBUG_DAEMON_SERVER_URL") !== undefined ||
    readEnvString("HELLOBUG_DAEMON_REGISTER_URL") !== undefined ||
    readEnvString("HELLOBUG_DAEMON_BOOTSTRAP_TOKEN") !== undefined ||
    readEnvString("HELLOBUG_DAEMON_ALLOWED_PATHS") !== undefined ||
    readEnvString("HELLOBUG_DAEMON_PAIRING_TTL_MS") !== undefined ||
    readEnvString("HELLOBUG_DAEMON_PAIRING_REFRESH_MS") !== undefined
  );
}

function applyEnvOverrides(base: Partial<DaemonConfig>): Partial<DaemonConfig> {
  const config: Partial<DaemonConfig> = { ...base };
  const serverUrl = readEnvString("HELLOBUG_DAEMON_SERVER_URL");
  if (serverUrl) {
    config.server_url = serverUrl;
  }

  const registerUrl = readEnvString("HELLOBUG_DAEMON_REGISTER_URL");
  if (registerUrl) {
    config.register_url = registerUrl;
  }

  const bootstrapToken = readEnvString("HELLOBUG_DAEMON_BOOTSTRAP_TOKEN");
  if (bootstrapToken) {
    config.bootstrap_token = bootstrapToken;
  }

  const allowedPaths = readAllowedPathsEnv("HELLOBUG_DAEMON_ALLOWED_PATHS");
  if (allowedPaths) {
    config.allowed_paths = allowedPaths;
  }

  const pairingTtlMs = readEnvNumber("HELLOBUG_DAEMON_PAIRING_TTL_MS");
  if (pairingTtlMs !== undefined) {
    config.pairing_ttl_ms = pairingTtlMs;
  }

  const pairingRefreshMs = readEnvNumber("HELLOBUG_DAEMON_PAIRING_REFRESH_MS");
  if (pairingRefreshMs !== undefined) {
    config.pairing_refresh_ms = pairingRefreshMs;
  }

  return config;
}

function readEnvString(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvNumber(name: string): number | undefined {
  const raw = readEnvString(name);
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readAllowedPathsEnv(name: string): string[] | undefined {
  const raw = readEnvString(name);
  if (raw === undefined) {
    return undefined;
  }

  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error(`${name} must be a JSON string array when using JSON syntax`);
    }
    return parsed.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }

  return raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
