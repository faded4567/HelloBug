import { z } from "zod";

export const AgentTypeSchema = z.enum(["claude_code", "codex", "shell"]);
export const RoutingModeSchema = z.enum(["direct", "broadcast", "orchestrated"]);

export const AssistantDeltaEventSchema = z.object({
  event_type: z.literal("assistant.delta"),
  text: z.string(),
});

export const AssistantThinkingEventSchema = z.object({
  event_type: z.literal("assistant.thinking"),
  text: z.string(),
});

export const ToolUseEventSchema = z.object({
  event_type: z.literal("tool.use"),
  tool_name: z.string().min(1),
  tool_input: z.record(z.string(), z.unknown()),
  tool_use_id: z.string().min(1),
});

export const ToolResultEventSchema = z.object({
  event_type: z.literal("tool.result"),
  tool_use_id: z.string().min(1),
  tool_name: z.string().min(1),
  is_error: z.boolean(),
  content: z.string(),
});

export const FileChangedEventSchema = z.object({
  event_type: z.literal("file.changed"),
  file_path: z.string().min(1),
  diff: z.string(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});

export const SessionUsageEventSchema = z.object({
  event_type: z.literal("session.usage"),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
});

export const SessionDoneEventSchema = z.object({
  event_type: z.literal("session.done"),
  exit_code: z.number().int(),
  duration_ms: z.number().int().nonnegative(),
});

export const PtyDataEventSchema = z.object({
  event_type: z.literal("pty.data"),
  bytes: z.string().min(1),
});

export const SessionEventBodySchema = z.discriminatedUnion("event_type", [
  AssistantDeltaEventSchema,
  AssistantThinkingEventSchema,
  ToolUseEventSchema,
  ToolResultEventSchema,
  FileChangedEventSchema,
  SessionUsageEventSchema,
  SessionDoneEventSchema,
  PtyDataEventSchema,
]);

export type AgentType = z.infer<typeof AgentTypeSchema>;
export type RoutingMode = z.infer<typeof RoutingModeSchema>;
export type AssistantDeltaEvent = z.infer<typeof AssistantDeltaEventSchema>;
export type AssistantThinkingEvent = z.infer<typeof AssistantThinkingEventSchema>;
export type ToolUseEvent = z.infer<typeof ToolUseEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type FileChangedEvent = z.infer<typeof FileChangedEventSchema>;
export type SessionUsageEvent = z.infer<typeof SessionUsageEventSchema>;
export type SessionDoneEvent = z.infer<typeof SessionDoneEventSchema>;
export type PtyDataEvent = z.infer<typeof PtyDataEventSchema>;
export type SessionEventBody = z.infer<typeof SessionEventBodySchema>;

