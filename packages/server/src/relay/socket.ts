import { WebSocket } from "ws";

export type RelayErrorCode =
  | "AUTH_INVALID"
  | "AUTH_EXPIRED"
  | "DEVICE_REVOKED"
  | "SESSION_NOT_FOUND"
  | "PROTOCOL_VERSION";

export function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

export function sendRelayError(
  socket: WebSocket,
  requestId: string,
  code: RelayErrorCode,
  message: string,
): void {
  sendJson(socket, {
    type: "error",
    payload: {
      request_id: requestId,
      code,
      message,
    },
  });
}
