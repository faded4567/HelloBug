import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ServerServices } from "../lib/services.js";

const IssueBootstrapTokenBodySchema = z.object({
  ttl_ms: z.number().int().positive().max(24 * 60 * 60 * 1_000).optional(),
});

const IssueBootstrapTokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.number().int().nonnegative(),
});

export async function registerBootstrapAdminRoute(
  app: FastifyInstance,
  services: ServerServices,
  options: {
    adminToken: string;
  },
): Promise<void> {
  app.post("/v1/admin/bootstrap-token", async (request, reply) => {
    const providedToken = readHeaderToken(request.headers["x-admin-token"]);
    if (providedToken !== options.adminToken) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
      });
    }

    const parsed = IssueBootstrapTokenBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_BODY",
        issues: parsed.error.flatten(),
      });
    }

    const issued = services.bootstrapTokens.issueToken(parsed.data.ttl_ms);
    await services.persistState();
    const response = IssueBootstrapTokenResponseSchema.parse({
      token: issued.token,
      expires_at: issued.expiresAt,
    });
    return reply.code(201).send(response);
  });
}

function readHeaderToken(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
