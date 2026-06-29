import { buildServer } from "./app.js";
import { ServerStateStore } from "./lib/state-store.js";

function readOptionalNumber(...names: string[]): number | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw.length === 0) {
      continue;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${name} must be a finite number`);
    }

    return parsed;
  }

  return undefined;
}

async function main(): Promise<void> {
  const bootstrapAdminToken =
    process.env.HELLOBUG_BOOTSTRAP_ADMIN_TOKEN ?? process.env.BOOTSTRAP_ADMIN_TOKEN;
  const { app } = await buildServer({
    bootstrapAdminToken,
    jwtSecret: process.env.HELLOBUG_JWT_SECRET ?? process.env.JWT_SECRET,
    stateStore: new ServerStateStore(
      process.env.HELLOBUG_SERVER_STATE_FILE ?? process.env.SERVER_STATE_FILE,
    ),
    relayPendingRequestTimeoutMs: readOptionalNumber(
      "HELLOBUG_RELAY_PENDING_REQUEST_TIMEOUT_MS",
      "RELAY_PENDING_REQUEST_TIMEOUT_MS",
    ),
    relayPendingSessionStartTimeoutMs: readOptionalNumber(
      "HELLOBUG_RELAY_PENDING_SESSION_START_TIMEOUT_MS",
      "RELAY_PENDING_SESSION_START_TIMEOUT_MS",
    ),
    logger: true,
  });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  if (bootstrapAdminToken) {
    console.log("[server] bootstrap admin route enabled: POST /v1/admin/bootstrap-token");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
