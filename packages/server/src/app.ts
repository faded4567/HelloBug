import Fastify from "fastify";

import { createServerServices, type ServerServices } from "./lib/services.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerRegisterRoute } from "./routes/register.js";
import { registerRelayRoute } from "./routes/relay.js";

export interface BuildServerOptions {
  jwtSecret?: string;
  logger?: boolean;
}

export interface BuiltServer {
  app: ReturnType<typeof Fastify>;
  services: ServerServices;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<BuiltServer> {
  const services = await createServerServices(options.jwtSecret);
  const app = Fastify({
    logger: options.logger ?? false,
  });

  await registerHealthRoute(app);
  await registerRegisterRoute(app, services);
  await registerRelayRoute(app, services);

  return { app, services };
}

