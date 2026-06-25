import type { Message } from "@hellobug/protocol";

import type { DaemonCatalogService } from "../catalog/service.js";
import type { DeviceIdentity } from "../crypto/keys.js";
import type { DaemonWorkspaceService } from "../fs/workspace.js";
import type { DaemonTranscriptService } from "../history/transcripts.js";
import {
  buildPairingSasMessage,
  completePairingSasHandshake,
  formatPairingSasLine,
  type PendingPairingHandshake,
} from "../pairing/responder.js";
import { DaemonSessionError } from "../sessions/manager.js";
import type { DaemonSessionManager } from "../sessions/manager.js";
import type { DaemonConnection } from "./connection.js";
import type { PairingTransportKeyStore } from "./pairing-key-store.js";

type DevicePairMessage = Extract<Message, { type: "device.pair" }>;
type DevicePairConfirmMessage = Extract<
  Message,
  { type: "device.pair.confirm" }
>;

export interface DaemonMessageRouterOptions {
  identity: DeviceIdentity;
  catalog?: DaemonCatalogService;
  sessions?: DaemonSessionManager;
  workspace?: DaemonWorkspaceService;
  history?: DaemonTranscriptService;
  pairingTransportKeys?: PairingTransportKeyStore;
  onPairingRequest?: (
    payload: DevicePairMessage["payload"],
  ) => void | Promise<void>;
  onPairingConfirmed?: (
    payload: DevicePairConfirmMessage["payload"],
  ) => void | Promise<void>;
  onUnhandledMessage?: (message: Message) => void | Promise<void>;
}

export function createDaemonMessageRouter(options: DaemonMessageRouterOptions) {
  let pendingPairingHandshake: PendingPairingHandshake | null = null;

  return async (
    message: Message,
    connection: DaemonConnection,
  ): Promise<void> => {
    if (
      message.type === "session.start" ||
      message.type === "session.agent.add" ||
      message.type === "session.input" ||
      message.type === "session.input.image" ||
      message.type === "session.input.voice_text" ||
      message.type === "session.command.slash" ||
      message.type === "session.cancel" ||
      message.type === "pty.input" ||
      message.type === "pty.resize" ||
      message.type === "danger.allow" ||
      message.type === "danger.deny" ||
      message.type === "fs.tree.req" ||
      message.type === "fs.file.req" ||
      message.type === "history.list" ||
      message.type === "history.get" ||
      message.type === "templates.list" ||
      message.type === "slash.list"
    ) {
      try {
        if (message.type === "session.start") {
          console.log(
            `[daemon-router] session.start session=${message.payload.session_id} workspace=${message.payload.workspace_path} agent=${message.payload.agent_type}`,
          );
          const started = await options.sessions?.startSession(message);
          if (!started) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "Session service is not configured",
            );
          }
          connection.sendMessage({
            v: 1,
            type: "session.start.result",
            payload: {
              request_id: message.id ?? `${message.type}:${Date.now()}`,
              session_id: started.sessionId,
              agent_type: started.agentType,
              workspace_path: started.workspacePath,
              status: "started",
              message: "Session started",
            },
          });
          return;
        }

        if (message.type === "session.agent.add") {
          console.log(
            `[daemon-router] session.agent.add session=${message.payload.session_id} agent=${message.payload.agent_id} type=${message.payload.agent_type}`,
          );
          throw new DaemonSessionError(
            "PROTOCOL_VERSION",
            "session.agent.add is not implemented yet",
          );
        }

        if (message.type === "session.input") {
          console.log(
            `[daemon-router] session.input session=${message.payload.session_id} length=${message.payload.text.length}`,
          );
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
          console.log(
            `[daemon-router] session.command.slash session=${message.payload.session_id} command=${message.payload.command} args=${message.payload.args.join(" ")}`,
          );
          await options.sessions?.handleSlashCommand(message);
          return;
        }

        if (message.type === "pty.input") {
          await options.sessions?.handlePtyInput(message);
          return;
        }

        if (message.type === "pty.resize") {
          console.log(
            `[daemon-router] pty.resize session=${message.payload.session_id} cols=${message.payload.cols} rows=${message.payload.rows}`,
          );
          await options.sessions?.handlePtyResize(message);
          return;
        }

        if (message.type === "session.cancel") {
          await options.sessions?.cancelSession(message);
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

        if (message.type === "fs.tree.req") {
          console.log(
            `[daemon-router] fs.tree.req session=${message.payload.session_id} workspace=${message.payload.workspace_path} dir=${message.payload.dir_path || "."}`,
          );
          const response = await options.workspace?.handleTreeRequest(message);
          if (!response) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "Workspace service is not configured",
            );
          }
          connection.sendMessage(response);
          return;
        }

        if (message.type === "fs.file.req") {
          console.log(
            `[daemon-router] fs.file.req session=${message.payload.session_id} file=${message.payload.file_path}`,
          );
          const responses = await options.workspace?.handleFileRequest(message);
          if (!responses) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "Workspace service is not configured",
            );
          }
          for (const response of responses) {
            connection.sendMessage(response);
          }
          return;
        }

        if (message.type === "history.list") {
          if (!("workspace_path" in message.payload)) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "history.list request is missing workspace_path",
            );
          }
          console.log(
            `[daemon-router] history.list workspace=${message.payload.workspace_path}`,
          );
          const response = await options.history?.handleListRequest(
            message as Parameters<
              NonNullable<typeof options.history>["handleListRequest"]
            >[0],
          );
          if (!response) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "Transcript service is not configured",
            );
          }
          connection.sendMessage(response);
          return;
        }

        if (message.type === "history.get") {
          if (!("limit" in message.payload)) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "history.get request is missing limit",
            );
          }
          console.log(
            `[daemon-router] history.get session=${message.payload.session_id} offset=${message.payload.offset} limit=${message.payload.limit}`,
          );
          const response = await options.history?.handleGetRequest(
            message as Parameters<
              NonNullable<typeof options.history>["handleGetRequest"]
            >[0],
          );
          if (!response) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "Transcript service is not configured",
            );
          }
          connection.sendMessage(response);
          return;
        }

        if (message.type === "templates.list") {
          console.log("[daemon-router] templates.list");
          const response = await options.catalog?.handleTemplatesListRequest(
            message as Parameters<
              NonNullable<typeof options.catalog>["handleTemplatesListRequest"]
            >[0],
          );
          if (!response) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "Catalog service is not configured",
            );
          }
          connection.sendMessage(response);
          return;
        }

        if (message.type === "slash.list") {
          if (!("session_id" in message.payload)) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "slash.list request is missing session_id",
            );
          }
          console.log(
            `[daemon-router] slash.list session=${message.payload.session_id}`,
          );
          const response = await options.catalog?.handleSlashListRequest(
            message as Parameters<
              NonNullable<typeof options.catalog>["handleSlashListRequest"]
            >[0],
          );
          if (!response) {
            throw new DaemonSessionError(
              "PROTOCOL_VERSION",
              "Catalog service is not configured",
            );
          }
          connection.sendMessage(response);
          return;
        }
      } catch (error) {
        if (error instanceof DaemonSessionError) {
          if (message.type === "session.start") {
            connection.sendMessage({
              v: 1,
              type: "session.start.result",
              payload: {
                request_id: message.id ?? `${message.type}:${Date.now()}`,
                session_id: message.payload.session_id,
                agent_type: message.payload.agent_type,
                workspace_path: message.payload.workspace_path,
                status: "rejected",
                code: error.code,
                message: error.message,
              },
            });
            return;
          }

          connection.sendMessage({
            v: 1,
            type: "error",
            payload: {
              request_id: message.id ?? `${message.type}:${Date.now()}`,
              session_id:
                "session_id" in message.payload &&
                typeof message.payload.session_id === "string"
                  ? message.payload.session_id
                  : null,
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
      const pairing = buildPairingSasMessage(options.identity, message.payload);
      pendingPairingHandshake = pairing.pending;
      console.log(
        `[pairing] sas: ${formatPairingSasLine(pairing.message)}${message.payload.app_device_name ? ` <- ${message.payload.app_device_name}` : ""}`,
      );
      connection.sendMessage(pairing.message);
      return;
    }

    if (message.type === "device.pair.confirm") {
      console.log(
        `[pairing] ${message.payload.confirmed ? "confirmed" : "cancelled"} by app`,
      );
      if (message.payload.confirmed) {
        if (!pendingPairingHandshake) {
          throw new Error("no pending pairing handshake");
        }
        const completed = completePairingSasHandshake(
          options.identity,
          pendingPairingHandshake,
          message.payload,
        );
        await options.pairingTransportKeys?.set(
          pendingPairingHandshake.appPublicKeyBase64Url,
          completed,
        );
      }
      pendingPairingHandshake = null;
      await options.onPairingConfirmed?.(message.payload);
      return;
    }

    await options.onUnhandledMessage?.(message);
  };
}
