import { randomUUID } from "node:crypto";

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
  if (wireFormat === "plain") {
    sendJson(socket, message);
    return;
  }

  const inner = ensureMessageId(message);
  const envelope = {
    from: options.from ?? "hellobug-server",
    to: options.to ?? "",
    session_id: getEnvelopeSessionId(inner),
    seq: getEnvelopeSequence(socket, inner),
    ts: Date.now(),
    sig: "",
    ciphertext: Buffer.from(JSON.stringify(inner), "utf8").toString("base64url"),
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

  if (type === "fs.read") {
    return {
      ...record,
      type: "fs.file.req",
    };
  }

  return raw;
}

function normalizeSessionResumePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.from_seq !== "number" || typeof record.last_seq === "number") {
    return payload;
  }

  const { from_seq, ...rest } = record;
  return {
    ...rest,
    last_seq: from_seq,
  };
}

function ensureMessageId(message: Message): Message {
  if (message.id) {
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
