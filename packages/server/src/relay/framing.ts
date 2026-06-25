import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

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
  envelope?: Envelope;
  forwardEnvelope?: Envelope;
}

const socketWireFormats = new WeakMap<WebSocket, RelayWireFormat>();
const socketEnvelopeStates = new WeakMap<WebSocket, RelayEnvelopeState>();
const EncryptedRoutableMessageTypes = new Set<string>([
  "session.start",
  "session.agent.add",
  "session.input",
  "session.input.image",
  "session.input.voice_text",
  "session.command.slash",
  "session.cancel",
  "danger.allow",
  "danger.deny",
  "fs.tree.req",
  "fs.file.req",
  "history.get",
  "slash.list",
  "pty.input",
  "pty.resize",
  "session.start.result",
  "session.event",
  "danger.pending",
  "danger.result",
  "fs.tree",
  "fs.file",
  "slash.list",
  "error",
]);

export function decodeRelayFrame(
  socket: WebSocket,
  raw: RawData,
): DecodeRelayFrameResult {
  const parsed = JSON.parse(raw.toString()) as unknown;
  const envelope = tryValidateEnvelope(parsed);

  if (envelope) {
    socketWireFormats.set(socket, "envelope");
    const cipherMode = envelope.cipher_mode ?? "plain";

    if (cipherMode === "noise_static_v1") {
      return {
        envelope,
        forwardEnvelope: canForwardSourceEnvelope(envelope) ? envelope : undefined,
        wireFormat: "envelope",
        message: createEncryptedEnvelopePlaceholder(envelope),
      };
    }

    const innerRaw = JSON.parse(
      Buffer.from(envelope.ciphertext, "base64url").toString("utf8"),
    ) as unknown;
    const normalizedInner = normalizeLegacyMessage(innerRaw);

    return {
      envelope,
      forwardEnvelope: canForwardSourceEnvelope(envelope, innerRaw)
        ? envelope
        : undefined,
      wireFormat: "envelope",
      message: validateMessage(normalizedInner),
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
    sourceEnvelope?: Envelope;
  } = {},
): void {
  const wireFormat = socketWireFormats.get(socket) ?? "plain";
  const wireMessage = toLegacyCompatibleWireMessage(message);
  if (wireFormat === "plain") {
    sendJson(socket, ensureWireMessageId(wireMessage));
    return;
  }

  if (
    options.sourceEnvelope &&
    canReuseSourceEnvelope(options.sourceEnvelope, message, wireMessage, options)
  ) {
    sendJson(socket, options.sourceEnvelope);
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
    message_type: message.type,
    cipher_mode: "plain",
  } satisfies Envelope;

  sendJson(socket, envelope);
}

function canForwardSourceEnvelope(
  envelope: Envelope,
  innerRaw?: unknown,
): boolean {
  if ((envelope.cipher_mode ?? "plain") === "noise_static_v1") {
    return canRouteEncryptedEnvelope(envelope);
  }

  return isDeepStrictEqual(normalizeLegacyMessage(innerRaw), innerRaw);
}

function canReuseSourceEnvelope(
  envelope: Envelope,
  message: Message,
  wireMessage: Record<string, unknown>,
  options: {
    from?: string;
    to?: string;
  },
): boolean {
  if (options.from && options.from !== envelope.from) {
    return false;
  }

  if (options.to && envelope.to.length > 0 && options.to !== envelope.to) {
    return false;
  }

  if ((envelope.cipher_mode ?? "plain") === "noise_static_v1") {
    if (!canRouteEncryptedEnvelope(envelope)) {
      return false;
    }
    if (message.type !== envelope.message_type) {
      return false;
    }
    if (getEnvelopeSessionId(message) !== envelope.session_id) {
      return false;
    }
    if (message.type === "session.event" && message.payload.seq !== envelope.seq) {
      return false;
    }
    return true;
  }

  if (!isDeepStrictEqual(wireMessage, message)) {
    return false;
  }

  return true;
}

function tryValidateEnvelope(raw: unknown): Envelope | null {
  try {
    return validateEnvelope(raw);
  } catch {
    return null;
  }
}

function canRouteEncryptedEnvelope(envelope: Envelope): boolean {
  return (
    (envelope.cipher_mode ?? "plain") === "noise_static_v1" &&
    typeof envelope.message_type === "string" &&
    EncryptedRoutableMessageTypes.has(envelope.message_type)
  );
}

function createEncryptedEnvelopePlaceholder(envelope: Envelope): Message {
  if (!canRouteEncryptedEnvelope(envelope) || !envelope.message_type) {
    throw new Error("Encrypted envelope is missing routable metadata");
  }

  const message = {
    v: 1,
    type: envelope.message_type,
    payload: createEncryptedPayload(envelope),
  };
  return validateMessage(message);
}

function createEncryptedPayload(envelope: Envelope): Record<string, unknown> {
  switch (envelope.message_type) {
    case "session.start":
      return {
        session_id: envelope.session_id,
        agent_type: "claude_code",
        workspace_path: "",
        resume_session_id: null,
      };
    case "session.agent.add":
      return {
        session_id: envelope.session_id,
        agent_id: "encrypted-agent",
        agent_type: "claude_code",
      };
    case "session.input":
      return {
        session_id: envelope.session_id,
        text: "",
      };
    case "session.input.image":
      return {
        session_id: envelope.session_id,
        image_id: "encrypted-image",
        chunk_index: 0,
        total_chunks: 1,
        mime_type: "application/octet-stream",
        data: "encrypted",
      };
    case "session.input.voice_text":
      return {
        session_id: envelope.session_id,
        text: "",
        confidence: 1,
      };
    case "session.command.slash":
      return {
        session_id: envelope.session_id,
        command: "/encrypted",
        args: [],
      };
    case "session.cancel":
      return {
        session_id: envelope.session_id,
      };
    case "danger.allow":
      return {
        session_id: envelope.session_id,
        danger_id: "encrypted-danger",
        biometric_verified: true,
      };
    case "danger.deny":
      return {
        session_id: envelope.session_id,
        danger_id: "encrypted-danger",
      };
    case "fs.tree.req":
      return {
        session_id: envelope.session_id,
        workspace_path: "/encrypted",
        dir_path: "",
      };
    case "fs.file.req":
      return {
        session_id: envelope.session_id,
        file_path: "encrypted",
        chunk_index: 0,
      };
    case "history.get":
      return {
        session_id: envelope.session_id,
        offset: 0,
        total: 0,
        lines: [],
      };
    case "slash.list":
      return {
        session_id: envelope.session_id,
        commands: [],
      };
    case "pty.input":
      return {
        session_id: envelope.session_id,
        data: "",
      };
    case "pty.resize":
      return {
        session_id: envelope.session_id,
        cols: 1,
        rows: 1,
      };
    case "session.start.result":
      return {
        request_id: "encrypted-request",
        session_id: envelope.session_id,
        agent_type: "claude_code",
        workspace_path: "",
        status: "started",
        message: "encrypted",
      };
    case "session.event":
      return {
        session_id: envelope.session_id,
        agent_id: null,
        agent_type: null,
        seq: envelope.seq,
        event: {
          event_type: "assistant.delta",
          text: "",
        },
      };
    case "danger.pending":
      return {
        danger_id: "encrypted-danger",
        session_id: envelope.session_id,
        agent_id: null,
        agent_type: null,
        command: "encrypted",
        tool_name: "encrypted",
        rule_matched: "encrypted",
        workspace: "encrypted",
        timeout_at: envelope.ts,
      };
    case "danger.result":
      return {
        danger_id: "encrypted-danger",
        session_id: envelope.session_id,
        status: "approved",
        message: "encrypted",
      };
    case "fs.tree":
      return {
        session_id: envelope.session_id,
        workspace_path: "/encrypted",
        dir_path: "",
        entries: [],
      };
    case "fs.file":
      return {
        session_id: envelope.session_id,
        file_path: "encrypted",
        mime_type: "application/octet-stream",
        chunk_index: 0,
        total_chunks: 1,
        data: "",
        total_size: 0,
      };
    case "error":
      return {
        request_id: "encrypted-request",
        session_id: envelope.session_id,
        code: "PROTOCOL_VERSION",
        message: "encrypted",
      };
    default:
      throw new Error(`Encrypted envelope type is not supported: ${envelope.message_type}`);
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
  if (
    typeof message.payload === "object" &&
    message.payload !== null &&
    "session_id" in message.payload &&
    typeof message.payload.session_id === "string"
  ) {
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
