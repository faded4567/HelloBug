import Fastify from "fastify";

import { createServerServices, type ServerServices } from "./lib/services.js";
import { ServerStateStore } from "./lib/state-store.js";
import { registerBootstrapAdminRoute } from "./routes/bootstrap.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerRegisterRoute } from "./routes/register.js";
import { registerRelayRoute } from "./routes/relay.js";

export interface BuildServerOptions {
  bootstrapAdminToken?: string;
  jwtSecret?: string;
  logger?: boolean;
  stateStore?: ServerStateStore;
}

export interface BuiltServer {
  app: ReturnType<typeof Fastify>;
  services: ServerServices;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<BuiltServer> {
  const services = await createServerServices(options.jwtSecret, options.stateStore);
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
