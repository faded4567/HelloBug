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
const PushEventTypeSchema = z.enum([
  "task_done",
  "danger_pending",
  "session_error",
]);

const createMessageSchema = <
  TType extends string,
  TPayload extends z.ZodTypeAny,
>(
  type: TType,
  payload: TPayload,
) =>
  z.object({
    v: z.literal(ProtocolVersion).default(ProtocolVersion),
    id: StringIdSchema.optional(),
    type: z.literal(type),
    payload,
  });

export const PushTriggerSchema = createMessageSchema(
  "push.trigger",
  z.object({
    session_id: StringIdSchema,
    event_type: PushEventTypeSchema,
  }),
);

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
    noise_handshake: z.string().min(1).optional(),
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
    noise_handshake: z.string().min(1).optional(),
  }),
);

export const SessionStartSchema = createMessageSchema(
  "session.start",
  z.object({
    session_id: StringIdSchema,
    agent_type: AgentTypeSchema,
    workspace_path: z.string(),
    resume_session_id: z.string().min(1).nullable(),
  }),
);

const SessionStartResultStatusSchema = z.enum(["started", "rejected"]);

export const SessionStartResultSchema = createMessageSchema(
  "session.start.result",
  z.discriminatedUnion("status", [
    z.object({
      request_id: z.string().min(1),
      session_id: StringIdSchema,
      agent_type: AgentTypeSchema,
      workspace_path: z.string(),
      status: z.literal("started"),
      message: z.string().min(1),
    }),
    z.object({
      request_id: z.string().min(1),
      session_id: StringIdSchema,
      agent_type: AgentTypeSchema,
      workspace_path: z.string(),
      status: z.literal("rejected"),
      code: ErrorCodeSchema,
      message: z.string().min(1),
    }),
  ]),
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
    session_id: StringIdSchema,
    danger_id: StringIdSchema,
    biometric_verified: z.boolean(),
  }),
);

export const DangerDenySchema = createMessageSchema(
  "danger.deny",
  z.object({
    session_id: StringIdSchema,
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

const DangerResultStatusSchema = z.enum([
  "approved",
  "denied",
  "timed_out",
  "not_found",
  "biometric_required",
]);

const ReplayDoneStatusSchema = z.enum(["ok", "session_not_found"]);

export const DangerResultSchema = createMessageSchema(
  "danger.result",
  z.object({
    danger_id: StringIdSchema,
    session_id: StringIdSchema,
    status: DangerResultStatusSchema,
    message: z.string().min(1),
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
    session_id: StringIdSchema,
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

const FsFileBasePayloadSchema = z.object({
  session_id: StringIdSchema,
  file_path: z.string().min(1),
});

const FsFileReadyPayloadSchema = FsFileBasePayloadSchema.extend({
  status: z.literal("ready"),
  mime_type: z.string().min(1),
  chunk_index: z.number().int().nonnegative(),
  total_chunks: z.number().int().positive(),
  data: z.string(),
  total_size: z.number().int().nonnegative(),
});

const FsFileBinaryPayloadSchema = FsFileBasePayloadSchema.extend({
  status: z.literal("binary"),
  mime_type: z.string().min(1),
  total_size: z.number().int().nonnegative(),
  message: z.string().min(1),
});

const FsFileTooLargePayloadSchema = FsFileBasePayloadSchema.extend({
  status: z.literal("too_large"),
  mime_type: z.string().min(1),
  total_size: z.number().int().nonnegative(),
  max_preview_size: z.number().int().positive(),
  message: z.string().min(1),
});

const FsFilePermissionDeniedPayloadSchema = FsFileBasePayloadSchema.extend({
  status: z.literal("permission_denied"),
  mime_type: z.string().min(1).nullable(),
  total_size: z.number().int().nonnegative().nullable(),
  message: z.string().min(1),
});

const FsFileNotFoundPayloadSchema = FsFileBasePayloadSchema.extend({
  status: z.literal("not_found"),
  mime_type: z.string().min(1).nullable(),
  total_size: z.number().int().nonnegative().nullable(),
  message: z.string().min(1),
});

export const FsFileSchema = createMessageSchema(
  "fs.file",
  z.discriminatedUnion("status", [
    FsFileReadyPayloadSchema,
    FsFileBinaryPayloadSchema,
    FsFileTooLargePayloadSchema,
    FsFilePermissionDeniedPayloadSchema,
    FsFileNotFoundPayloadSchema,
  ]),
);

export const DeviceStatusSchema = createMessageSchema(
  "device.status",
  z.object({
    device_id: StringIdSchema,
    online: z.boolean(),
    machine_name: z.string().min(1),
    ts: TimestampMsSchema,
    os: z.string().min(1).nullable().optional(),
    daemon_version: z.string().min(1).nullable().optional(),
    paired_at: TimestampMsSchema.nullable().optional(),
    last_seen_at: TimestampMsSchema.nullable().optional(),
    revoked_at: TimestampMsSchema.nullable().optional(),
    active_session_count: z.number().int().nonnegative().optional(),
  }),
);

export const DeviceListItemSchema = z.object({
  device_id: StringIdSchema,
  machine_name: z.string().min(1),
  os: z.string().min(1).nullable(),
  daemon_version: z.string().min(1).nullable(),
  online: z.boolean(),
  paired_at: TimestampMsSchema,
  last_seen_at: TimestampMsSchema.nullable(),
  revoked_at: TimestampMsSchema.nullable(),
  active_session_count: z.number().int().nonnegative(),
});

export const DeviceListRequestSchema = createMessageSchema(
  "device.list",
  z.object({}),
);

export const DeviceListResponseSchema = createMessageSchema(
  "device.list",
  z.object({
    devices: z.array(DeviceListItemSchema),
  }),
);

export const DeviceRenameRequestSchema = createMessageSchema(
  "device.rename",
  z.object({
    device_id: StringIdSchema,
    machine_name: z.string().min(1),
  }),
);

export const DeviceRenameResponseSchema = createMessageSchema(
  "device.rename",
  z.object({
    device: DeviceListItemSchema,
  }),
);

const DeviceRevokeModeSchema = z.enum(["unlink", "revoke"]);

export const DeviceRevokeRequestSchema = createMessageSchema(
  "device.revoke",
  z.object({
    device_id: StringIdSchema,
    mode: DeviceRevokeModeSchema,
  }),
);

export const DeviceRevokeResponseSchema = createMessageSchema(
  "device.revoke",
  z.object({
    device_id: StringIdSchema,
    mode: DeviceRevokeModeSchema,
    revoked_at: TimestampMsSchema,
    disconnected: z.boolean(),
  }),
);

export const PtyInputSchema = createMessageSchema(
  "pty.input",
  z.object({
    session_id: StringIdSchema,
    data: z.string(),
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

const WorkspaceStatusSchema = z.enum([
  "ready",
  "missing",
  "forbidden",
  "not_dir",
]);

const WorkspaceStatusReasonSchema = z.enum([
  "ok",
  "not_found",
  "not_directory",
  "outside_allowed_paths",
  "permission_denied",
]);

const WorkspaceAccessModeSchema = z.enum([
  "read_write",
  "read_only",
  "no_access",
  "unknown",
]);

const WorkspaceRepairHintSchema = z.object({
  reason: z.enum([
    "default_workspace",
    "nearest_existing_ancestor",
    "first_allowed_workspace",
    "same_name_match",
    "fix_permissions",
  ]),
  suggested_path: z.string().min(1).nullable(),
  message: z.string().min(1),
});

export const WorkspaceSummarySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  status: WorkspaceStatusSchema,
  status_reason: WorkspaceStatusReasonSchema.optional(),
  is_default: z.boolean(),
  entry_count: z.number().int().nonnegative().nullable(),
  is_empty: z.boolean().nullable().optional(),
  repo_root: z.string().min(1).nullable().optional(),
  git_branch: z.string().min(1).nullable().optional(),
  access_mode: WorkspaceAccessModeSchema.optional(),
});

export const WorkspaceListRequestSchema = createMessageSchema(
  "workspace.list",
  z.object({}),
);

export const WorkspaceListResponseSchema = createMessageSchema(
  "workspace.list",
  z.object({
    default_path: z.string().min(1).nullable(),
    items: z.array(WorkspaceSummarySchema),
  }),
);

export const WorkspaceResolveRequestSchema = createMessageSchema(
  "workspace.resolve",
  z.object({
    workspace_path: z.string(),
  }),
);

export const WorkspaceResolveResponseSchema = createMessageSchema(
  "workspace.resolve",
  z.object({
    workspace_path: z.string(),
    resolved_path: z.string().min(1),
    name: z.string().min(1),
    status: WorkspaceStatusSchema,
    status_reason: WorkspaceStatusReasonSchema.optional(),
    is_default: z.boolean(),
    entry_count: z.number().int().nonnegative().nullable(),
    is_empty: z.boolean().nullable().optional(),
    repo_root: z.string().min(1).nullable().optional(),
    git_branch: z.string().min(1).nullable().optional(),
    access_mode: WorkspaceAccessModeSchema.optional(),
    repair_hint: WorkspaceRepairHintSchema.optional(),
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
    session_id: StringIdSchema,
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
    status: ReplayDoneStatusSchema,
    message: z.string().min(1),
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
    session_id: StringIdSchema,
    next_pubkey: z.string().min(1),
  }),
);

export const KeyRatchetAckSchema = createMessageSchema(
  "key.ratchet_ack",
  z.object({
    session_id: StringIdSchema,
  }),
);

export const ErrorSchema = createMessageSchema(
  "error",
  z.object({
    request_id: z.string().min(1),
    session_id: OptionalNullableStringSchema,
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
  "session.start.result": SessionStartResultSchema,
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
  "danger.result": DangerResultSchema,
  "session.event": SessionEventSchema,
  "fs.tree.req": FsTreeReqSchema,
  "fs.tree": FsTreeSchema,
  "fs.file.req": FsFileReqSchema,
  "fs.file": FsFileSchema,
  "device.status": DeviceStatusSchema,
  "device.list": z.union([DeviceListResponseSchema, DeviceListRequestSchema]),
  "device.rename": z.union([
    DeviceRenameResponseSchema,
    DeviceRenameRequestSchema,
  ]),
  "device.revoke": z.union([
    DeviceRevokeResponseSchema,
    DeviceRevokeRequestSchema,
  ]),
  "pty.input": PtyInputSchema,
  "pty.resize": PtyResizeSchema,
  "workspace.list": z.union([
    WorkspaceListResponseSchema,
    WorkspaceListRequestSchema,
  ]),
  "workspace.resolve": z.union([
    WorkspaceResolveResponseSchema,
    WorkspaceResolveRequestSchema,
  ]),
  "history.list": z.union([
    HistoryListResponseSchema,
    HistoryListRequestSchema,
  ]),
  "history.get": z.union([HistoryGetRequestSchema, HistoryGetResponseSchema]),
  "templates.list": z.union([
    TemplatesListResponseSchema,
    TemplatesListRequestSchema,
  ]),
  "slash.list": z.union([SlashListResponseSchema, SlashListRequestSchema]),
  "replay.done": ReplayDoneSchema,
  "device.push_token": DevicePushTokenSchema,
  "push.trigger": PushTriggerSchema,
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
  SessionStartResultSchema,
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
  DangerResultSchema,
  SessionEventSchema,
  FsTreeReqSchema,
  FsTreeSchema,
  FsFileReqSchema,
  FsFileSchema,
  DeviceStatusSchema,
  DeviceListRequestSchema,
  DeviceListResponseSchema,
  DeviceRenameRequestSchema,
  DeviceRenameResponseSchema,
  DeviceRevokeRequestSchema,
  DeviceRevokeResponseSchema,
  PtyInputSchema,
  PtyResizeSchema,
  WorkspaceListRequestSchema,
  WorkspaceListResponseSchema,
  WorkspaceResolveRequestSchema,
  WorkspaceResolveResponseSchema,
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
  PushTriggerSchema,
  KeyRatchetSchema,
  KeyRatchetAckSchema,
  ErrorSchema,
]);

export type Message = z.infer<typeof MessageSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type NotificationPushPayload = z.infer<
  typeof NotificationPushPayloadSchema
>;
export type SessionEventMessage = z.infer<typeof SessionEventSchema>;

export function validateMessage(raw: unknown): Message {
  const value = z
    .object({
      type: z.string().min(1),
    })
    .parse(raw);

  const schema =
    messageSchemasByType[value.type as keyof typeof messageSchemasByType];
  if (!schema) {
    throw new Error(`Unknown message type: ${value.type}`);
  }

  return schema.parse(raw) as Message;
}

export function validateNotificationPushPayload(
  raw: unknown,
): NotificationPushPayload {
  return NotificationPushPayloadSchema.parse(raw);
}
