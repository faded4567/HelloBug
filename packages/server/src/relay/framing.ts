import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  TransportControlSessionId,
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
  lastInboundSeq: number | null;
}

interface DecodeRelayFrameResult {
  message: Message;
  wireFormat: RelayWireFormat;
  envelope?: Envelope;
  forwardEnvelope?: Envelope;
}

interface RelayFrameErrorContext {
  request_id?: string | null;
  session_id?: string | null;
}

const socketWireFormats = new WeakMap<WebSocket, RelayWireFormat>();
const socketEnvelopeStates = new WeakMap<WebSocket, RelayEnvelopeState>();
const EncryptedRoutableMessageTypes = new Set<string>([
  "auth.attach",
  "auth.refresh",
  "auth.token",
  "daemon.hello",
  "device.pair.ready",
  "device.pair",
  "device.pair.sas",
  "device.pair.confirm",
  "device.push_token",
  "device.list",
  "device.rename",
  "device.revoke",
  "device.status",
  "session.resume",
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
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "pty.input",
  "pty.resize",
  "key.ratchet",
  "key.ratchet_ack",
  "session.start.result",
  "session.event",
  "replay.done",
  "danger.pending",
  "danger.result",
  "push.trigger",
  "fs.tree",
  "fs.file",
  "slash.list",
  "error",
]);
const TransportControlMessageTypes = new Set<string>([
  "auth.attach",
  "auth.refresh",
  "auth.token",
  "device.push_token",
  "device.list",
  "device.rename",
  "device.revoke",
  "session.start",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "templates.list",
]);
const RoutingPayloadPlaceholderMessageTypes = new Set<string>([
  "auth.attach",
  "auth.refresh",
  "auth.token",
  "daemon.hello",
  "device.pair.ready",
  "device.pair",
  "device.pair.sas",
  "device.pair.confirm",
  "device.push_token",
  "device.list",
  "device.rename",
  "device.revoke",
  "device.status",
  "error",
  "session.resume",
  "session.start.result",
  "replay.done",
]);
const StateTrackingRoutingPayloadMessageTypes = new Set<string>([
  "session.start",
  "session.event",
  "danger.pending",
  "danger.result",
  "push.trigger",
  "danger.allow",
  "danger.deny",
  "error",
]);
const NoiseRequiredEnvelopeMessageTypes = new Set<string>([
  "auth.attach",
  "auth.refresh",
  "daemon.hello",
  "device.pair.ready",
  "device.pair",
  "device.pair.sas",
  "device.pair.confirm",
  "device.push_token",
  "push.trigger",
  "device.list",
  "device.rename",
  "device.revoke",
  "session.resume",
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
  "pty.input",
  "pty.resize",
  "key.ratchet",
  "key.ratchet_ack",
]);
const DisallowedLegacyPlainMessageTypes = new Set<string>([
  "auth.attach",
  "auth.refresh",
  "daemon.hello",
  "device.push_token",
  "push.trigger",
  "device.list",
  "device.rename",
  "device.revoke",
  "session.resume",
  "session.start",
  "session.agent.add",
  "session.input",
  "session.input.image",
  "session.input.voice_text",
  "session.command.slash",
  "session.cancel",
  "danger.allow",
  "danger.deny",
  "danger.pending",
  "danger.result",
  "device.pair.ready",
  "device.pair",
  "device.pair.sas",
  "device.pair.confirm",
  "session.event",
  "fs.tree.req",
  "fs.file.req",
  "fs.tree",
  "fs.file",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "pty.input",
  "pty.resize",
  "key.ratchet",
  "key.ratchet_ack",
  "session.start.result",
  "replay.done",
  "error",
]);
const MetadataRequiredPlainEnvelopeMessageTypes = new Set<string>([
  ...NoiseRequiredEnvelopeMessageTypes,
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "session.start.result",
  "session.event",
  "danger.pending",
  "danger.result",
  "fs.tree",
  "fs.file",
  "replay.done",
  "error",
]);

export class RelayFrameDecodeError extends Error {
  constructor(
    message: string,
    codeOrContext:
      | "AUTH_INVALID"
      | "PROTOCOL_VERSION"
      | RelayFrameErrorContext = "PROTOCOL_VERSION",
    maybeContext?: RelayFrameErrorContext,
  ) {
    super(message);
    this.name = "RelayFrameDecodeError";
    if (typeof codeOrContext === "string") {
      this.code = codeOrContext;
      this.context = maybeContext;
    } else {
      this.code = "PROTOCOL_VERSION";
      this.context = codeOrContext;
    }
  }

  readonly code: "AUTH_INVALID" | "PROTOCOL_VERSION";
  readonly context?: RelayFrameErrorContext;
}

export function decodeRelayFrame(
  socket: WebSocket,
  raw: RawData,
): DecodeRelayFrameResult {
  const parsed = JSON.parse(raw.toString()) as unknown;
  const envelope = tryValidateEnvelope(parsed);

  if (envelope) {
    socketWireFormats.set(socket, "envelope");
    assertInboundEnvelopeSequence(socket, envelope);
    const cipherMode = envelope.cipher_mode ?? "plain";
    assertNoiseRequiredCipherMode(envelope, cipherMode);
    assertEncryptedEnvelopeSenderPubkey(envelope);

    if (cipherMode === "noise_static_v1") {
      return {
        envelope,
        forwardEnvelope: canForwardSourceEnvelope(envelope)
          ? envelope
          : undefined,
        wireFormat: "envelope",
        message: createEncryptedEnvelopePlaceholder(envelope),
      };
    }

    const innerRaw = JSON.parse(
      Buffer.from(envelope.ciphertext, "base64url").toString("utf8"),
    ) as unknown;
    const innerMessage = validateMessage(innerRaw);
    assertLegacyPlainEnvelopeMetadata(envelope, innerMessage);
    assertNoiseRequiredPlainEnvelopeMessage(envelope, innerMessage);

    return {
      envelope,
      forwardEnvelope: canForwardSourceEnvelope(
        envelope,
        innerRaw,
        innerMessage,
      )
        ? envelope
        : undefined,
      wireFormat: "envelope",
      message: innerMessage,
    };
  }

  const existingWireFormat = socketWireFormats.get(socket);
  if (existingWireFormat === "envelope") {
    throw new RelayFrameDecodeError(
      "Relay connection cannot switch from envelopes back to plain messages",
    );
  }
  const plainMessage = validateMessage(parsed);
  assertLegacyPlainRelayMessageAllowed(plainMessage);
  socketWireFormats.set(socket, "plain");
  return {
    wireFormat: "plain",
    message: plainMessage,
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
    canReuseSourceEnvelope(
      options.sourceEnvelope,
      message,
      wireMessage,
      options,
    )
  ) {
    rememberSentEnvelopeSequence(socket, options.sourceEnvelope.seq);
    sendJson(socket, options.sourceEnvelope);
    return;
  }

  const opaqueRoutingPayload = getOpaqueRoutingPayload(message);
  if (opaqueRoutingPayload) {
    const envelope = {
      from: options.from ?? "hellobug-server",
      to: options.to ?? "",
      session_id: getEnvelopeSessionId(message),
      seq: getEnvelopeSequence(socket, message),
      ts: Date.now(),
      sig: "",
      ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
      message_type: message.type,
      cipher_mode: "noise_static_v1",
      ...(getEnvelopeRequestId(message)
        ? { request_id: getEnvelopeRequestId(message) }
        : {}),
      routing_payload: opaqueRoutingPayload,
    } satisfies Envelope;

    sendJson(socket, envelope);
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
    ...(getEnvelopeRequestId(message)
      ? { request_id: getEnvelopeRequestId(message) }
      : {}),
  } satisfies Envelope;

  sendJson(socket, envelope);
}

function canForwardSourceEnvelope(
  envelope: Envelope,
  innerRaw?: unknown,
  message?: Message,
): boolean {
  if ((envelope.cipher_mode ?? "plain") === "noise_static_v1") {
    return canRouteEncryptedEnvelope(envelope);
  }

  return innerRaw !== undefined && message !== undefined
    ? isDeepStrictEqual(innerRaw, message)
    : false;
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
    const requestId = getEnvelopeRequestId(message);
    if (
      envelope.request_id !== undefined &&
      envelope.request_id !== (requestId ?? "")
    ) {
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

function assertNoiseRequiredCipherMode(
  envelope: Envelope,
  cipherMode: string,
): void {
  if (cipherMode === "noise_static_v1") {
    return;
  }

  if (
    typeof envelope.message_type !== "string" ||
    !NoiseRequiredEnvelopeMessageTypes.has(envelope.message_type)
  ) {
    return;
  }

  throw new RelayFrameDecodeError(
    `Envelope plaintext downgrade is not allowed for ${envelope.message_type}`,
    {
      request_id: envelope.request_id ?? envelope.message_type,
      session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
    },
  );
}

function assertLegacyPlainEnvelopeMetadata(
  envelope: Envelope,
  message: Message,
): void {
  if (
    typeof envelope.message_type === "string" &&
    envelope.message_type.length > 0 &&
    envelope.message_type !== message.type
  ) {
    throw new RelayFrameDecodeError(
      `Envelope message_type does not match inner message type for ${message.type}`,
      {
        request_id: envelope.request_id ?? message.id ?? message.type,
        session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
      },
    );
  }

  if (!MetadataRequiredPlainEnvelopeMessageTypes.has(message.type)) {
    return;
  }

  if (
    typeof envelope.message_type === "string" &&
    envelope.message_type.length > 0 &&
    envelope.cipher_mode !== undefined
  ) {
    return;
  }

  throw new RelayFrameDecodeError(
    `Legacy plain envelopes without outer metadata are no longer allowed for ${message.type}`,
    {
      request_id: envelope.request_id ?? message.id ?? message.type,
      session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
    },
  );
}

function assertNoiseRequiredPlainEnvelopeMessage(
  envelope: Envelope,
  message: Message,
): void {
  if ((envelope.cipher_mode ?? "plain") === "noise_static_v1") {
    return;
  }

  if (typeof envelope.message_type !== "string") {
    return;
  }

  if (!requiresNoiseForPlainEnvelopeMessage(message)) {
    return;
  }

  throw new RelayFrameDecodeError(
    `Envelope plaintext downgrade is not allowed for ${message.type}`,
    {
      request_id: envelope.request_id ?? message.id ?? message.type,
      session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
    },
  );
}

function requiresNoiseForPlainEnvelopeMessage(message: Message): boolean {
  switch (message.type) {
    case "workspace.list":
    case "history.list":
    case "templates.list":
      return !("items" in message.payload) && !("templates" in message.payload);
    case "workspace.resolve":
      return !("resolved_path" in message.payload) && !("status" in message.payload);
    case "history.get":
      return "limit" in message.payload;
    case "slash.list":
      return !("commands" in message.payload);
    default:
      return false;
  }
}

function assertLegacyPlainRelayMessageAllowed(message: Message): void {
  if (!DisallowedLegacyPlainMessageTypes.has(message.type)) {
    return;
  }

  throw new RelayFrameDecodeError(
    `Legacy raw relay messages are no longer allowed for ${message.type}`,
    {
      request_id: getEnvelopeRequestId(message) ?? message.type,
      session_id: getSessionIdForRelayError(message),
    },
  );
}

function assertEncryptedEnvelopeSenderPubkey(envelope: Envelope): void {
  if ((envelope.cipher_mode ?? "plain") !== "noise_static_v1") {
    return;
  }

  if (!requiresEncryptedSenderPubkey(envelope)) {
    return;
  }

  if (
    typeof envelope.sender_pubkey === "string" &&
    envelope.sender_pubkey.length > 0
  ) {
    return;
  }

  throw new RelayFrameDecodeError(
    `Encrypted ${envelope.message_type ?? "envelope"} requires sender_pubkey`,
    {
      request_id: envelope.request_id ?? envelope.message_type,
      session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
    },
  );
}

function requiresEncryptedSenderPubkey(envelope: Envelope): boolean {
  if (!envelope.message_type) {
    return false;
  }

  if (!EncryptedRoutableMessageTypes.has(envelope.message_type)) {
    return false;
  }

  if (RoutingPayloadPlaceholderMessageTypes.has(envelope.message_type)) {
    return false;
  }

  return true;
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

  const prefersRoutingPayload =
    RoutingPayloadPlaceholderMessageTypes.has(envelope.message_type) ||
    StateTrackingRoutingPayloadMessageTypes.has(envelope.message_type);
  const requiresRoutingPayload = requiresEncryptedRoutingPayload(envelope);
  const routingPayload =
    prefersRoutingPayload ? tryDecodeRoutingPayload(envelope) : null;

  if (requiresRoutingPayload && routingPayload === null) {
    throw new RelayFrameDecodeError(
      `Encrypted ${envelope.message_type} requires routing_payload`,
      "PROTOCOL_VERSION",
      {
        request_id: envelope.request_id ?? envelope.message_type,
        session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
      },
    );
  }

  const message = {
    v: 1,
    ...(envelope.request_id ? { id: envelope.request_id } : {}),
    type: envelope.message_type,
    payload:
      envelope.message_type === "session.start.result"
        ? createSessionStartResultPlaceholderPayload(envelope, routingPayload)
        : routingPayload ?? createEncryptedPayload(envelope),
  };
  return validateMessage(message);
}

function requiresEncryptedRoutingPayload(envelope: Envelope): boolean {
  if (!envelope.message_type) {
    return false;
  }

  if (StateTrackingRoutingPayloadMessageTypes.has(envelope.message_type)) {
    return true;
  }

  if (!RoutingPayloadPlaceholderMessageTypes.has(envelope.message_type)) {
    return false;
  }

  return true;
}

function createEncryptedPayload(envelope: Envelope): Record<string, unknown> {
  switch (envelope.message_type) {
    case "session.resume":
      throw new Error("Encrypted session.resume requires routing_payload");
    case "device.status":
      throw new Error("Encrypted device.status requires routing_payload");
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
    case "workspace.list":
      return {
        default_path: null,
        items: [],
      };
    case "workspace.resolve":
      return {
        workspace_path: "",
        resolved_path: "/encrypted",
        name: "encrypted",
        status: "ready",
        is_default: false,
        entry_count: null,
      };
    case "history.list":
      return {
        items: [],
      };
    case "history.get":
      return {
        session_id: envelope.session_id,
        offset: 0,
        total: 0,
        lines: [],
      };
    case "templates.list":
      return {
        templates: [],
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
    case "key.ratchet":
      return {
        session_id: envelope.session_id,
        next_pubkey: "encrypted-next-pubkey",
      };
    case "key.ratchet_ack":
      return {
        session_id: envelope.session_id,
      };
    case "session.start.result":
      return {
        request_id: envelope.request_id ?? "encrypted-request",
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
    case "replay.done":
      throw new Error("Encrypted replay.done requires routing_payload");
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
        status: "ready",
        mime_type: "application/octet-stream",
        chunk_index: 0,
        total_chunks: 1,
        data: "",
        total_size: 0,
      };
    case "error":
      return {
        request_id: envelope.request_id ?? "encrypted-request",
        session_id:
          envelope.session_id === TransportControlSessionId
            ? null
            : envelope.session_id.length > 0
              ? envelope.session_id
              : null,
        code: "PROTOCOL_VERSION",
        message: "encrypted",
      };
    default:
      throw new RelayFrameDecodeError(
        `Encrypted envelope type is not supported: ${envelope.message_type}`,
        "PROTOCOL_VERSION",
        {
          request_id: envelope.request_id ?? envelope.message_type,
          session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
        },
      );
  }
}

function tryDecodeRoutingPayload(
  envelope: Envelope,
): Record<string, unknown> | null {
  if (!envelope.routing_payload) {
    return null;
  }

  const decoded = JSON.parse(
    Buffer.from(envelope.routing_payload, "base64url").toString("utf8"),
  ) as unknown;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new RelayFrameDecodeError(
      "Envelope routing_payload must decode to an object",
      "PROTOCOL_VERSION",
      {
        request_id: envelope.request_id ?? envelope.message_type,
        session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
      },
    );
  }

  return decoded as Record<string, unknown>;
}

function createSessionStartResultPlaceholderPayload(
  envelope: Envelope,
  routingPayload: Record<string, unknown> | null,
): Record<string, unknown> {
  const status = routingPayload?.status;
  if (status === "rejected") {
    return {
      request_id: envelope.request_id ?? "encrypted-request",
      session_id: envelope.session_id,
      agent_type: "claude_code",
      workspace_path: "",
      status: "rejected",
      code: isKnownErrorCode(routingPayload?.code)
        ? routingPayload.code
        : "PROTOCOL_VERSION",
      message:
        typeof routingPayload?.message === "string" &&
        routingPayload.message.length > 0
          ? routingPayload.message
          : "encrypted",
    };
  }

  return {
    request_id: envelope.request_id ?? "encrypted-request",
    session_id: envelope.session_id,
    agent_type: "claude_code",
    workspace_path: "",
    status: "started",
    message:
      typeof routingPayload?.message === "string" &&
      routingPayload.message.length > 0
        ? routingPayload.message
        : "encrypted",
  };
}

function isKnownErrorCode(
  code: unknown,
): code is
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "DEVICE_REVOKED"
  | "SESSION_NOT_FOUND"
  | "RATE_LIMITED"
  | "WORKSPACE_FORBIDDEN"
  | "CHUNK_MISSING"
  | "PROTOCOL_VERSION" {
  return (
    code === "AUTH_EXPIRED" ||
    code === "AUTH_INVALID" ||
    code === "DEVICE_REVOKED" ||
    code === "SESSION_NOT_FOUND" ||
    code === "RATE_LIMITED" ||
    code === "WORKSPACE_FORBIDDEN" ||
    code === "CHUNK_MISSING" ||
    code === "PROTOCOL_VERSION"
  );
}

function getOpaqueRoutingPayload(message: Message): string | undefined {
  if (
    message.type === "auth.token" ||
    message.type === "device.pair.ready" ||
    message.type === "device.pair" ||
    message.type === "device.pair.sas" ||
    message.type === "device.pair.confirm" ||
    message.type === "device.list" ||
    message.type === "device.rename" ||
    message.type === "device.revoke" ||
    message.type === "session.start.result" ||
    message.type === "replay.done" ||
    message.type === "device.status" ||
    message.type === "error"
  ) {
    return Buffer.from(JSON.stringify(message.payload), "utf8").toString(
      "base64url",
    );
  }

  return undefined;
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

  if (TransportControlMessageTypes.has(message.type)) {
    return TransportControlSessionId;
  }

  if (
    message.type === "error" &&
    typeof message.payload.request_id === "string" &&
    message.payload.request_id.length > 0 &&
    (message.payload.session_id === null ||
      message.payload.session_id === TransportControlSessionId)
  ) {
    return TransportControlSessionId;
  }

  return "";
}

function getEnvelopeRequestId(message: Message): string | undefined {
  if (typeof message.id === "string" && message.id.length > 0) {
    return message.id;
  }

  if (
    typeof message.payload === "object" &&
    message.payload !== null &&
    "request_id" in message.payload &&
    typeof message.payload.request_id === "string" &&
    message.payload.request_id.length > 0
  ) {
    return message.payload.request_id;
  }

  return undefined;
}

function normalizeEnvelopeErrorSessionId(sessionId: string): string | null {
  if (sessionId.length === 0 || sessionId === TransportControlSessionId) {
    return null;
  }

  return sessionId;
}

function getSessionIdForRelayError(message: Message): string | null {
  if (
    typeof message.payload === "object" &&
    message.payload !== null &&
    "session_id" in message.payload &&
    typeof message.payload.session_id === "string"
  ) {
    return normalizeEnvelopeErrorSessionId(message.payload.session_id);
  }

  return null;
}

function getEnvelopeSequence(socket: WebSocket, message: Message): number {
  const state = socketEnvelopeStates.get(socket) ?? {
    nextSeq: 0,
    lastInboundSeq: null,
  };
  const nextSeq =
    message.type === "session.event" ? message.payload.seq : state.nextSeq + 1;
  state.nextSeq = Math.max(state.nextSeq, nextSeq);
  socketEnvelopeStates.set(socket, state);
  return nextSeq;
}

function assertInboundEnvelopeSequence(
  socket: WebSocket,
  envelope: Envelope,
): void {
  const state = socketEnvelopeStates.get(socket) ?? {
    nextSeq: 0,
    lastInboundSeq: null,
  };

  if (
    state.lastInboundSeq !== null &&
    envelope.seq <= state.lastInboundSeq
  ) {
    throw new RelayFrameDecodeError(
      `Envelope seq must strictly increase (last=${state.lastInboundSeq}, next=${envelope.seq})`,
      "PROTOCOL_VERSION",
      {
        request_id: envelope.request_id ?? envelope.message_type,
        session_id: normalizeEnvelopeErrorSessionId(envelope.session_id),
      },
    );
  }

  state.lastInboundSeq = envelope.seq;
  socketEnvelopeStates.set(socket, state);
}

function rememberSentEnvelopeSequence(socket: WebSocket, seq: number): void {
  const state = socketEnvelopeStates.get(socket) ?? {
    nextSeq: 0,
    lastInboundSeq: null,
  };
  state.nextSeq = Math.max(state.nextSeq, seq);
  socketEnvelopeStates.set(socket, state);
}

function toLegacyCompatibleWireMessage(
  message: Message,
): Record<string, unknown> {
  return message as unknown as Record<string, unknown>;
}
