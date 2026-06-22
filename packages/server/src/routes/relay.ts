import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";

import type { ServerServices } from "../lib/services.js";
import { RelayConnectionHandler } from "../relay/handler.js";

export async function registerRelayRoute(
  app: FastifyInstance,
  services: ServerServices,
): Promise<void> {
  await app.register(websocket);

  app.get("/v1/relay", { websocket: true }, (socket) => {
    const handler = new RelayConnectionHandler(socket, services);

    handler.sendServerHello();
    socket.on("message", async (raw) => {
      await handler.handleRawMessage(raw);
    });
    socket.on("close", () => {
      handler.handleClose();
    });
  });
}
