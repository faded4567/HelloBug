import { z } from "zod";

import {
  AgentTypeSchema,
  RoutingModeSchema,
  SessionEventBodySchema,
} from "./events.js";
import {
  OptionalNullableStringSchema,
  ProtocolVersion,
  SequenceSchema,
  StringIdSchema,
  TimestampMsSchema,
} from "./envelope.js";

const ErrorCodeSchema = z.enum([
  "AUTH_EXPIRED",
  "AUTH_INVALID",
  "DEVICE_REVOKED",
  "SESSION_NOT_FOUND",
  "RATE_LIMITED",
  "WORKSPACE_FORBIDDEN",
  "CHUNK_MISSING",
  "PROTOCOL_VERSION",
]);

const ManufacturerSchema = z.enum(["Xiaomi", "OPPO", "vivo", "Other"]);
const PushEventTypeSchema = z.enum(["task_done", "danger_pending", "session_error"]);

const createMessageSchema = <TType extends string, TPayload extends z.ZodTypeAny>(
  type: TType,
  payload: TPayload,
) =>
  z.object({
    v: z.literal(ProtocolVersion).default(ProtocolVersion),
    id: StringIdSchema.optional(),
    type: z.literal(type),
    payload,
  });

export const ServerHelloSchema = createMessageSchema(
  "server.hello",
  z.object({
    protocol_version: z.literal(ProtocolVersion),
    server_id: StringIdSchema,
    ts: TimestampMsSchema,
    min_client_version: z.number().int().positive(),
  }),
);

export const DaemonHelloSchema = createMessageSchema(
  "daemon.hello",
  z.object({
    device_id: StringIdSchema,
    daemon_version: z.string().min(1),
    supported_features: z.array(z.string().min(1)),
  }),
);

export const DevicePairReadySchema = createMessageSchema(
  "device.pair.ready",
  z.object({
    pairing_id: z.string().min(1),
    pairing_code: z.string().min(1),
    expires_at: TimestampMsSchema,
  }),
);

export const AuthAttachSchema = createMessageSchema(
  "auth.attach",
  z.object({
    jwt: z.string().min(1),
  }),
);

export const AuthRefreshSchema = createMessageSchema(
  "auth.refresh",
  z.object({
    jwt: z.string().min(1),
  }),
);

export const AuthTokenSchema = createMessageSchema(
  "auth.token",
  z.object({
    jwt: z.string().min(1),
    expires_at: TimestampMsSchema,
  }),
);

export const DevicePairSchema = createMessageSchema(
  "device.pair",
  z.object({
    pairing_code: z.string().min(1),
    server_url: z.string().min(1).optional(),
    app_pubkey: z.string().min(1),
    app_ed25519_pubkey: z.string().min(1),
    app_device_name: z.string().min(1),
  }),
);

export const DevicePairSasSchema = createMessageSchema(
  "device.pair.sas",
  z.object({
    sas: z.array(z.string().min(1)).length(5),
    daemon_pubkey: z.string().min(1),
    daemon_ed25519_pubkey: z.string().min(1),
    machine_name: z.string().min(1),
    os: z.string().min(1),
  }),
);

export const DevicePairConfirmSchema = createMessageSchema(
  "device.pair.confirm",
  z.object({
    confirmed: z.boolean(),
  }),
);

export const SessionStartSchema = createMessageSchema(
  "session.start",
  z.object({
    session_id: StringIdSchema,
    agent_type: AgentTypeSchema,
    workspace_path: z.string().min(1),
    resume_session_id: z.string().min(1).nullable(),
  }),
);

export const SessionAgentAddSchema = createMessageSchema(
  "session.agent.add",
  z.object({
    session_id: StringIdSchema,
    agent_id: z.string().min(1),
    agent_type: AgentTypeSchema,
  }),
);

export const SessionResumeSchema = createMessageSchema(
  "session.resume",
  z.object({
    session_id: StringIdSchema,
    last_seq: SequenceSchema,
  }),
);

export const SessionInputSchema = createMessageSchema(
  "session.input",
  z
    .object({
      session_id: StringIdSchema,
      text: z.string(),
      target_agent_id: z.string().min(1).nullable().optional(),
      routing_mode: RoutingModeSchema.optional(),
    })
    .superRefine((value, ctx) => {
      if (value.routing_mode === "direct" && !value.target_agent_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "routing_mode=direct requires target_agent_id",
          path: ["target_agent_id"],
        });
      }
    }),
);

export const SessionInputImageSchema = createMessageSchema(
  "session.input.image",
  z.object({
    session_id: StringIdSchema,
    image_id: StringIdSchema,
    chunk_index: z.number().int().nonnegative(),
    total_chunks: z.number().int().positive(),
    mime_type: z.string().min(1),
    data: z.string().min(1),
  }),
);

export const SessionInputVoiceTextSchema = createMessageSchema(
  "session.input.voice_text",
  z.object({
    session_id: StringIdSchema,
    text: z.string(),
    confidence: z.number().min(0).max(1),
  }),
);

export const SessionCommandSlashSchema = createMessageSchema(
  "session.command.slash",
  z.object({
    session_id: StringIdSchema,
    command: z.string().min(1),
    args: z.array(z.string()),
  }),
);

export const SessionCancelSchema = createMessageSchema(
  "session.cancel",
  z.object({
    session_id: StringIdSchema,
  }),
);

export const DangerAllowSchema = createMessageSchema(
  "danger.allow",
  z.object({
    danger_id: StringIdSchema,
    biometric_verified: z.boolean(),
  }),
);

export const DangerDenySchema = createMessageSchema(
  "danger.deny",
  z.object({
    danger_id: StringIdSchema,
  }),
);

export const DangerPendingSchema = createMessageSchema(
  "danger.pending",
  z.object({
    danger_id: StringIdSchema,
    session_id: StringIdSchema,
    agent_id: OptionalNullableStringSchema,
    agent_type: AgentTypeSchema.nullable().optional(),
    command: z.string().min(1),
    tool_name: z.string().min(1),
    rule_matched: z.string().min(1),
    workspace: z.string().min(1),
    timeout_at: TimestampMsSchema,
  }),
);

export const SessionEventSchema = createMessageSchema(
  "session.event",
  z.object({
    session_id: StringIdSchema,
    agent_id: OptionalNullableStringSchema,
    agent_type: AgentTypeSchema.nullable().optional(),
    seq: SequenceSchema,
    event: SessionEventBodySchema,
  }),
);

export const FsTreeReqSchema = createMessageSchema(
  "fs.tree.req",
  z.object({
    session_id: StringIdSchema,
    workspace_path: z.string().min(1),
    dir_path: z.string(),
  }),
);

export const FsTreeEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  type: z.enum(["file", "dir"]),
  modified: z.boolean().nullable(),
  size: z.number().int().nonnegative(),
});

export const FsTreeSchema = createMessageSchema(
  "fs.tree",
  z.object({
    workspace_path: z.string().min(1),
    dir_path: z.string(),
    entries: z.array(FsTreeEntrySchema),
  }),
);

export const FsFileReqSchema = createMessageSchema(
  "fs.file.req",
  z.object({
    session_id: StringIdSchema,
    file_path: z.string().min(1),
    chunk_index: z.number().int().nonnegative().optional(),
  }),
);

export const FsFileSchema = createMessageSchema(
  "fs.file",
  z.object({
    file_path: z.string().min(1),
    mime_type: z.string().min(1),
    chunk_index: z.number().int().nonnegative(),
    total_chunks: z.number().int().positive(),
    data: z.string().min(1),
    total_size: z.number().int().nonnegative(),
  }),
);

export const DeviceStatusSchema = createMessageSchema(
  "device.status",
  z.object({
    device_id: StringIdSchema,
    online: z.boolean(),
    machine_name: z.string().min(1),
    ts: TimestampMsSchema,
  }),
);

export const PtyResizeSchema = createMessageSchema(
  "pty.resize",
  z.object({
    session_id: StringIdSchema,
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
);

export const HistoryListRequestSchema = createMessageSchema(
  "history.list",
  z.object({
    workspace_path: z.string().min(1),
  }),
);

export const HistoryListResponseSchema = createMessageSchema(
  "history.list",
  z.object({
    items: z.array(
      z.object({
        session_id: z.string().min(1),
        path: z.string().min(1),
        created_at: TimestampMsSchema,
        message_count: z.number().int().nonnegative(),
      }),
    ),
  }),
);

export const HistoryGetRequestSchema = createMessageSchema(
  "history.get",
  z.object({
    session_id: z.string().min(1),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }),
);

export const HistoryGetResponseSchema = createMessageSchema(
  "history.get",
  z.object({
    session_id: z.string().min(1),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    lines: z.array(z.string()),
  }),
);

export const TemplatesListRequestSchema = createMessageSchema(
  "templates.list",
  z.object({}),
);

export const TemplatesListResponseSchema = createMessageSchema(
  "templates.list",
  z.object({
    templates: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        text: z.string(),
      }),
    ),
  }),
);

export const SlashListRequestSchema = createMessageSchema(
  "slash.list",
  z.object({
    session_id: StringIdSchema,
  }),
);

export const SlashListResponseSchema = createMessageSchema(
  "slash.list",
  z.object({
    commands: z.array(
      z.object({
        name: z.string().min(1),
        desc: z.string().min(1),
      }),
    ),
  }),
);

export const ReplayDoneSchema = createMessageSchema(
  "replay.done",
  z.object({
    session_id: StringIdSchema,
    replayed_count: z.number().int().nonnegative(),
    current_seq: SequenceSchema,
  }),
);

export const DevicePushTokenSchema = createMessageSchema(
  "device.push_token",
  z.union([
    z.object({
      platform: z.literal("ios"),
      apns_token: z.string().min(1),
      manufacturer: z.null(),
      vendor_token: z.null(),
    }),
    z.object({
      platform: z.literal("android"),
      apns_token: z.null(),
      manufacturer: ManufacturerSchema,
      vendor_token: z.string().min(1),
    }),
  ]),
);

export const KeyRatchetSchema = createMessageSchema(
  "key.ratchet",
  z.object({
    next_pubkey: z.string().min(1),
  }),
);

export const KeyRatchetAckSchema = createMessageSchema(
  "key.ratchet_ack",
  z.object({}),
);

export const ErrorSchema = createMessageSchema(
  "error",
  z.object({
    request_id: z.string().min(1),
    code: ErrorCodeSchema,
    message: z.string().min(1),
  }),
);

export const NotificationPushPayloadSchema = z.object({
  aps: z.object({
    alert: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
    }),
    sound: z.string().min(1),
  }),
  session_id: StringIdSchema,
  event_type: PushEventTypeSchema,
});

export const messageSchemasByType = {
  "server.hello": ServerHelloSchema,
  "daemon.hello": DaemonHelloSchema,
  "device.pair.ready": DevicePairReadySchema,
  "auth.attach": AuthAttachSchema,
  "auth.refresh": AuthRefreshSchema,
  "auth.token": AuthTokenSchema,
  "device.pair": DevicePairSchema,
  "device.pair.sas": DevicePairSasSchema,
  "device.pair.confirm": DevicePairConfirmSchema,
  "session.start": SessionStartSchema,
  "session.agent.add": SessionAgentAddSchema,
  "session.resume": SessionResumeSchema,
  "session.input": SessionInputSchema,
  "session.input.image": SessionInputImageSchema,
  "session.input.voice_text": SessionInputVoiceTextSchema,
  "session.command.slash": SessionCommandSlashSchema,
  "session.cancel": SessionCancelSchema,
  "danger.allow": DangerAllowSchema,
  "danger.deny": DangerDenySchema,
  "danger.pending": DangerPendingSchema,
  "session.event": SessionEventSchema,
  "fs.tree.req": FsTreeReqSchema,
  "fs.tree": FsTreeSchema,
  "fs.file.req": FsFileReqSchema,
  "fs.file": FsFileSchema,
  "device.status": DeviceStatusSchema,
  "pty.resize": PtyResizeSchema,
  "history.list": z.union([HistoryListRequestSchema, HistoryListResponseSchema]),
  "history.get": z.union([HistoryGetRequestSchema, HistoryGetResponseSchema]),
  "templates.list": z.union([TemplatesListRequestSchema, TemplatesListResponseSchema]),
  "slash.list": z.union([SlashListRequestSchema, SlashListResponseSchema]),
  "replay.done": ReplayDoneSchema,
  "device.push_token": DevicePushTokenSchema,
  "key.ratchet": KeyRatchetSchema,
  "key.ratchet_ack": KeyRatchetAckSchema,
  error: ErrorSchema,
} as const;

export const MessageSchema = z.union([
  ServerHelloSchema,
  DaemonHelloSchema,
  DevicePairReadySchema,
  AuthAttachSchema,
  AuthRefreshSchema,
  AuthTokenSchema,
  DevicePairSchema,
  DevicePairSasSchema,
  DevicePairConfirmSchema,
  SessionStartSchema,
  SessionAgentAddSchema,
  SessionResumeSchema,
  SessionInputSchema,
  SessionInputImageSchema,
  SessionInputVoiceTextSchema,
  SessionCommandSlashSchema,
  SessionCancelSchema,
  DangerAllowSchema,
  DangerDenySchema,
  DangerPendingSchema,
  SessionEventSchema,
  FsTreeReqSchema,
  FsTreeSchema,
  FsFileReqSchema,
  FsFileSchema,
  DeviceStatusSchema,
  PtyResizeSchema,
  HistoryListRequestSchema,
  HistoryListResponseSchema,
  HistoryGetRequestSchema,
  HistoryGetResponseSchema,
  TemplatesListRequestSchema,
  TemplatesListResponseSchema,
  SlashListRequestSchema,
  SlashListResponseSchema,
  ReplayDoneSchema,
  DevicePushTokenSchema,
  KeyRatchetSchema,
  KeyRatchetAckSchema,
  ErrorSchema,
]);

export type Message = z.infer<typeof MessageSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type NotificationPushPayload = z.infer<typeof NotificationPushPayloadSchema>;
export type SessionEventMessage = z.infer<typeof SessionEventSchema>;

export function validateMessage(raw: unknown): Message {
  const value = z
    .object({
      type: z.string().min(1),
    })
    .parse(raw);

  const schema = messageSchemasByType[value.type as keyof typeof messageSchemasByType];
  if (!schema) {
    throw new Error(`Unknown message type: ${value.type}`);
  }

  return schema.parse(raw) as Message;
}

export function validateNotificationPushPayload(raw: unknown): NotificationPushPayload {
  return NotificationPushPayloadSchema.parse(raw);
}

