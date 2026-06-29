import Fastify from "fastify";

import { createServerServices, type ServerServices } from "./lib/services.js";
import { ServerStateStore } from "./lib/state-store.js";
import type { PushProvider } from "./push/provider.js";
import { registerBootstrapAdminRoute } from "./routes/bootstrap.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerRegisterRoute } from "./routes/register.js";
import { registerRelayRoute } from "./routes/relay.js";

export interface BuildServerOptions {
  bootstrapAdminToken?: string;
  jwtSecret?: string;
  logger?: boolean;
  stateStore?: ServerStateStore;
  relayPendingRequestTimeoutMs?: number;
  relayPendingSessionStartTimeoutMs?: number;
  pushProvider?: PushProvider;
}

export interface BuiltServer {
  app: ReturnType<typeof Fastify>;
  services: ServerServices;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<BuiltServer> {
  const services = await createServerServices({
    jwtSecret: options.jwtSecret,
    stateStore: options.stateStore,
    relayPendingRequestTimeoutMs: options.relayPendingRequestTimeoutMs,
    relayPendingSessionStartTimeoutMs:
      options.relayPendingSessionStartTimeoutMs,
    pushProvider: options.pushProvider,
  });
  const app = Fastify({
    logger: options.logger ?? false,
  });

  await registerHealthRoute(app);
  if (options.bootstrapAdminToken) {
    await registerBootstrapAdminRoute(app, services, {
      adminToken: options.bootstrapAdminToken,
    });
  }
  await registerRegisterRoute(app, services);
  await registerRelayRoute(app, services);

  return { app, services };
}
