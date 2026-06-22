import type { FastifyInstance } from "fastify";

import {
  RegisterDaemonBodySchema,
  RegisterDaemonResponseSchema,
} from "../auth/register.js";
import type { ServerServices } from "../lib/services.js";

export async function registerRegisterRoute(
  app: FastifyInstance,
  services: ServerServices,
): Promise<void> {
  app.post("/v1/register", async (request, reply) => {
    const parsed = RegisterDaemonBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_BODY",
        issues: parsed.error.flatten(),
      });
    }

    const tokenResult = services.bootstrapTokens.consumeToken(parsed.data.bootstrap_token);
    if (!tokenResult.ok) {
      return reply.code(401).send({
        error: "INVALID_BOOTSTRAP_TOKEN",
        reason: tokenResult.reason,
      });
    }

    const signed = services.certificateAuthority.signClientCertificate(parsed.data.device_pub_key);
    const device = services.deviceRegistry.registerDaemonDevice({
      devicePubKey: parsed.data.device_pub_key,
      certPem: signed.certPem,
      caCertPem: signed.caCertPem,
    });

    const response = RegisterDaemonResponseSchema.parse({
      device_id: device.deviceId,
      cert: signed.certPem,
      ca_cert: signed.caCertPem,
    });
    return reply.code(201).send(response);
  });
}

