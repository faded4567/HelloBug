import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  validateEnvelope,
  validateMessage,
  type Envelope,
  type Message,
} from "@hellobug/protocol";
import type { RawData, WebSocket } from "ws";

import { sendJson } from "./socket.js";

export type RelayWireFormat = "plain" | "envelope";

interface RelayEnvelopeState {
  nextSeq: number;
}

interface DecodeRelayFrameResult {
  message: Message;
  wireFormat: RelayWireFormat;
}

const socketWireFormats = new WeakMap<WebSocket, RelayWireFormat>();
const socketEnvelopeStates = new WeakMap<WebSocket, RelayEnvelopeState>();

export function decodeRelayFrame(
  socket: WebSocket,
  raw: RawData,
): DecodeRelayFrameResult {
  const parsed = JSON.parse(raw.toString()) as unknown;
  const envelope = tryValidateEnvelope(parsed);

  if (envelope) {
    socketWireFormats.set(socket, "envelope");

    const innerRaw = JSON.parse(
      Buffer.from(envelope.ciphertext, "base64url").toString("utf8"),
    ) as unknown;

    return {
      wireFormat: "envelope",
      message: validateMessage(normalizeLegacyMessage(innerRaw)),
    };
  }

  socketWireFormats.set(socket, "plain");
  return {
    wireFormat: "plain",
    message: validateMessage(normalizeLegacyMessage(parsed)),
  };
}

export function sendRelayMessage(
  socket: WebSocket,
  message: Message,
  options: {
    from?: string;
    to?: string;
  } = {},
): void {
  const wireFormat = socketWireFormats.get(socket) ?? "plain";
  const wireMessage = toLegacyCompatibleWireMessage(message);
  if (wireFormat === "plain") {
    sendJson(socket, ensureWireMessageId(wireMessage));
    return;
  }

  const inner = ensureWireMessageId(wireMessage);
  const envelope = {
    from: options.from ?? "hellobug-server",
    to: options.to ?? "",
    session_id: getEnvelopeSessionId(message),
    seq: getEnvelopeSequence(socket, message),
    ts: Date.now(),
    sig: "",
    ciphertext: Buffer.from(JSON.stringify(inner), "utf8").toString(
      "base64url",
    ),
  } satisfies Envelope;

  sendJson(socket, envelope);
}

function tryValidateEnvelope(raw: unknown): Envelope | null {
  try {
    return validateEnvelope(raw);
  } catch {
    return null;
  }
}

function normalizeLegacyMessage(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (type === "session.replay") {
    return {
      ...record,
      type: "session.resume",
      payload: normalizeSessionResumePayload(record.payload),
    };
  }

  if (type === "session.resume") {
    return {
      ...record,
      payload: normalizeSessionResumePayload(record.payload),
    };
  }

  if (type === "session.start") {
    return {
      ...record,
      payload: normalizeLegacySessionStartPayload(record.payload),
    };
  }

  if (type === "session.command.slash") {
    return {
      ...record,
      payload: normalizeLegacySlashPayload(record.payload),
    };
  }

  if (type === "fs.read") {
    return {
      ...record,
      type: "fs.file.req",
    };
  }

  if (type === "fs.tree.req") {
    return {
      ...record,
      payload: normalizeLegacyFsTreePayload(record.payload),
    };
  }

  return raw;
}

function normalizeSessionResumePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.from_seq !== "number" ||
    typeof record.last_seq === "number"
  ) {
    return payload;
  }

  const { from_seq, ...rest } = record;
  return {
    ...rest,
    last_seq: from_seq,
  };
}

function normalizeLegacySessionStartPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if ("resume_session_id" in record) {
    return payload;
  }

  return {
    ...record,
    resume_session_id: null,
  };
}

function normalizeLegacySlashPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.args)) {
    return payload;
  }

  const rawArgs = typeof record.args === "string" ? record.args.trim() : "";
  return {
    ...record,
    args: rawArgs.length == 0 ? [] : rawArgs.split(/\s+/),
  };
}

function ensureWireMessageId(
  message: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof message.id === "string" && message.id.length > 0) {
    return message;
  }

  return {
    ...message,
    id: randomUUID(),
  };
}

function getEnvelopeSessionId(message: Message): string {
  if (message.type === "session.event") {
    return message.payload.session_id;
  }

  if (message.type === "replay.done") {
    return message.payload.session_id;
  }

  return "";
}

function getEnvelopeSequence(socket: WebSocket, message: Message): number {
  if (message.type === "session.event") {
    return message.payload.seq;
  }

  if (message.type === "replay.done") {
    return message.payload.current_seq;
  }

  const state = socketEnvelopeStates.get(socket) ?? { nextSeq: 0 };
  state.nextSeq += 1;
  socketEnvelopeStates.set(socket, state);
  return state.nextSeq;
}

function normalizeLegacyFsTreePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.path === "string" &&
    typeof record.workspace_path !== "string" &&
    typeof record.dir_path !== "string"
  ) {
    return {
      session_id: record.session_id,
      workspace_path: record.path,
      dir_path: "",
    };
  }

  return payload;
}

function toLegacyCompatibleWireMessage(
  message: Message,
): Record<string, unknown> {
  if (message.type === "fs.tree") {
    const dirPath = resolve(
      message.payload.workspace_path,
      message.payload.dir_path || ".",
    );
    return {
      ...message,
      payload: {
        ...message.payload,
        path: dirPath,
        items: message.payload.entries.map((entry) => ({
          name: entry.name,
          path: resolve(message.payload.workspace_path, entry.path),
          is_dir: entry.type === "dir",
          modified: entry.modified,
          size: entry.size,
        })),
      },
    };
  }

  if (message.type === "fs.file") {
    let content = "";
    try {
      content = Buffer.from(message.payload.data, "base64url").toString("utf8");
    } catch {
      content = "";
    }

    return {
      ...message,
      payload: {
        ...message.payload,
        data: content,
        data_base64url: message.payload.data,
        content,
      },
    };
  }

  if (message.type === "slash.list" && "commands" in message.payload) {
    const { commands } = message.payload;
    return {
      ...message,
      payload: {
        ...message.payload,
        commands: commands.map((command) => ({
          ...command,
          description: command.desc,
        })),
      },
    };
  }

  return message as unknown as Record<string, unknown>;
}
