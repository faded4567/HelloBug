import type { Message } from "@hellobug/protocol";

import type { DeviceIdentity } from "../crypto/keys.js";
import { buildPairingSasMessage } from "../pairing/responder.js";
import { DaemonSessionError } from "../sessions/manager.js";
import type { DaemonSessionManager } from "../sessions/manager.js";
import type { DaemonConnection } from "./connection.js";

type DevicePairMessage = Extract<Message, { type: "device.pair" }>;
type DevicePairConfirmMessage = Extract<Message, { type: "device.pair.confirm" }>;

export interface DaemonMessageRouterOptions {
  identity: DeviceIdentity;
  sessions?: DaemonSessionManager;
  onPairingRequest?: (payload: DevicePairMessage["payload"]) => void | Promise<void>;
  onPairingConfirmed?: (payload: DevicePairConfirmMessage["payload"]) => void | Promise<void>;
  onUnhandledMessage?: (message: Message) => void | Promise<void>;
}

export function createDaemonMessageRouter(options: DaemonMessageRouterOptions) {
  return async (message: Message, connection: DaemonConnection): Promise<void> => {
    if (
      message.type === "session.start" ||
      message.type === "session.input" ||
      message.type === "session.input.image" ||
      message.type === "session.input.voice_text" ||
      message.type === "session.command.slash" ||
      message.type === "session.cancel" ||
      message.type === "danger.allow" ||
      message.type === "danger.deny"
    ) {
      try {
        if (message.type === "session.start") {
          await options.sessions?.startSession(message);
          return;
        }

        if (message.type === "session.input") {
          await options.sessions?.handleInput(message);
          return;
        }

        if (message.type === "session.input.image") {
          await options.sessions?.handleImageInput(message);
          return;
        }

        if (message.type === "session.input.voice_text") {
          await options.sessions?.handleVoiceText(message);
          return;
        }

        if (message.type === "session.command.slash") {
          await options.sessions?.handleSlashCommand(message);
          return;
        }

        if (message.type === "danger.allow") {
          await options.sessions?.allowDanger(message);
          return;
        }

        if (message.type === "danger.deny") {
          await options.sessions?.denyDanger(message);
          return;
        }

        await options.sessions?.cancelSession(message);
      } catch (error) {
        if (error instanceof DaemonSessionError) {
          connection.sendMessage({
            v: 1,
            type: "error",
            payload: {
              request_id: message.id ?? `${message.type}:${Date.now()}`,
              code: error.code,
              message: error.message,
            },
          });
          return;
        }

        throw error;
      }

      return;
    }

    if (message.type === "device.pair") {
      await options.onPairingRequest?.(message.payload);
      connection.sendMessage(buildPairingSasMessage(options.identity, message.payload));
      return;
    }

    if (message.type === "device.pair.confirm") {
      await options.onPairingConfirmed?.(message.payload);
      return;
    }

    await options.onUnhandledMessage?.(message);
  };
}
