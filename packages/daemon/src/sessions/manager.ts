import { createHash } from "node:crypto";
import type {
  AgentType,
  ErrorCode,
  Message,
  SessionEventBody,
} from "@hellobug/protocol";

import type { AuditLogger } from "../audit/logger.js";
import { SessionImageUploadStore } from "../fs/image.js";
import { WorkspaceFence } from "../guard/fence.js";
import type { DangerApprovalInterceptor } from "../guard/interceptor.js";
import { resolveUserPath } from "../lib/user-path.js";
import { SessionEventEmitter } from "./events.js";
import {
  buildFileChangedEvent,
  capturePendingFileChange,
  type PendingFileChange,
} from "./file-change.js";
import type { SessionRuntimeFactory } from "./runtime.js";
import { createMemorySessionRuntime } from "./memory-runtime.js";

type SessionStartMessage = Extract<Message, { type: "session.start" }>;
type SessionInputMessage = Extract<Message, { type: "session.input" }>;
type SessionInputImageMessage = Extract<
  Message,
  { type: "session.input.image" }
>;
type SessionInputVoiceTextMessage = Extract<
  Message,
  { type: "session.input.voice_text" }
>;
type SessionCommandSlashMessage = Extract<
  Message,
  { type: "session.command.slash" }
>;
type SessionCancelMessage = Extract<Message, { type: "session.cancel" }>;
type PtyInputMessage = Extract<Message, { type: "pty.input" }>;
type PtyResizeMessage = Extract<Message, { type: "pty.resize" }>;
type DangerAllowMessage = Extract<Message, { type: "danger.allow" }>;
type DangerDenyMessage = Extract<Message, { type: "danger.deny" }>;

export interface SessionHandle {
  sessionId: string;
  workspacePath: string;
  agentType: AgentType;
  seq: number;
  createdAt: number;
}

interface InternalSessionHandle extends SessionHandle {
  runtime: ReturnType<SessionRuntimeFactory>;
  eventQueue: Promise<void>;
  suppressedToolUseIds: Set<string>;
  pendingFileChanges: Map<string, PendingFileChange>;
}

export interface DaemonSessionManagerOptions {
  sendMessage: (message: Message) => void;
  runtimeFactory?: SessionRuntimeFactory;
  maxSessions?: number;
  allowedPaths?: string[];
  imageUploadStore?: SessionImageUploadStore;
  auditLogger?: AuditLogger;
  dangerInterceptor?: DangerApprovalInterceptor;
}

export class DaemonSessionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DaemonSessionError";
  }
}

export class DaemonSessionManager {
  private readonly sessions = new Map<string, InternalSessionHandle>();
  private readonly eventEmitter: SessionEventEmitter;
  private readonly runtimeFactory: SessionRuntimeFactory;
  private readonly maxSessions: number;
  private readonly workspaceFence: WorkspaceFence;
  private readonly imageUploadStore: SessionImageUploadStore;
  private readonly auditLogger?: AuditLogger;
  private readonly dangerInterceptor?: DangerApprovalInterceptor;

  constructor(private readonly options: DaemonSessionManagerOptions) {
    this.eventEmitter = new SessionEventEmitter({
      sendMessage: options.sendMessage,
    });
    this.runtimeFactory =
      options.runtimeFactory ??
      ((runtimeOptions) => createMemorySessionRuntime(runtimeOptions.events));
    this.maxSessions = options.maxSessions ?? 10;
    this.workspaceFence = new WorkspaceFence(options.allowedPaths ?? []);
    this.imageUploadStore =
      options.imageUploadStore ?? new SessionImageUploadStore();
    this.auditLogger = options.auditLogger;
    this.dangerInterceptor = options.dangerInterceptor;
  }

  private resolveWorkspacePath(rawPath: string): string {
    const trimmed = rawPath.trim();
    if (trimmed.length > 0) {
      return resolveUserPath(trimmed);
    }

    const fallback = this.options.allowedPaths?.[0];
    if (fallback && fallback.trim().length > 0) {
      return resolveUserPath(fallback);
    }

    return resolveUserPath("~");
  }

  async startSession(message: SessionStartMessage): Promise<SessionHandle> {
    const sessionId = message.payload.session_id;
    const workspacePath = this.resolveWorkspacePath(
      message.payload.workspace_path,
    );
    console.log(
      `[daemon-session] start requested session=${sessionId} workspace=${workspacePath} agent=${message.payload.agent_type}`,
    );
    if (!this.workspaceFence.isAllowed(workspacePath)) {
      throw new DaemonSessionError(
        "WORKSPACE_FORBIDDEN",
        `Workspace is outside allowed paths: ${message.payload.workspace_path}`,
      );
    }
    if (this.sessions.has(sessionId)) {
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Session already exists: ${sessionId}`,
      );
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new DaemonSessionError("RATE_LIMITED", "Session limit reached");
    }

    let handle: InternalSessionHandle | null = null;
    const runtime = this.runtimeFactory({
      events: {
        onSessionEvent: async (event) => {
          if (!handle) {
            return;
          }
          await this.enqueueRuntimeEvent(handle, event);
        },
      },
      agentType: message.payload.agent_type,
    });

    handle = {
      sessionId,
      workspacePath,
      agentType: message.payload.agent_type,
      seq: 0,
      createdAt: Date.now(),
      runtime,
      eventQueue: Promise.resolve(),
      suppressedToolUseIds: new Set<string>(),
      pendingFileChanges: new Map<string, PendingFileChange>(),
    };

    this.sessions.set(sessionId, handle);

    try {
      await runtime.start({
        sessionId,
        workspacePath,
        resumeSessionId: message.payload.resume_session_id,
        agentType: message.payload.agent_type,
      });
    } catch (error) {
      this.sessions.delete(sessionId);
      if (error instanceof DaemonSessionError) {
        throw error;
      }
      const text =
        error instanceof Error ? error.message : "Unknown runtime start error";
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Failed to start ${message.payload.agent_type} runtime: ${text}`,
      );
    }

    console.log(
      `[daemon-session] started session=${sessionId} workspace=${workspacePath} agent=${handle.agentType}`,
    );
    await this.auditLogger?.appendAuditEntry({
      session_id: sessionId,
      event_type: "session.start",
      summary: `agent=${handle.agentType} workspace=${handle.workspacePath}`,
    });
    return {
      sessionId: handle.sessionId,
      workspacePath: handle.workspacePath,
      agentType: handle.agentType,
      seq: handle.seq,
      createdAt: handle.createdAt,
    };
  }

  async handleInput(message: SessionInputMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    console.log(
      `[daemon-session] input session=${handle.sessionId} length=${message.payload.text.length}`,
    );
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "session.input",
      summary: `text_sha256=${sha256Hex(message.payload.text)} length=${message.payload.text.length}`,
    });
    await handle.runtime.input(message.payload.text);
  }

  async handleImageInput(message: SessionInputImageMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    let completedUpload;

    try {
      completedUpload = await this.imageUploadStore.appendChunk(
        message.payload,
      );
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Invalid image upload";
      throw new DaemonSessionError("PROTOCOL_VERSION", text);
    }

    if (!completedUpload) {
      return;
    }

    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "session.input.image",
      summary: `image_id=${completedUpload.imageId} mime=${completedUpload.mimeType}`,
    });
    await handle.runtime.inputImage(
      completedUpload.filePath,
      completedUpload.mimeType,
    );
  }

  async handleVoiceText(message: SessionInputVoiceTextMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "session.input.voice_text",
      summary: `text_sha256=${sha256Hex(message.payload.text)} confidence=${message.payload.confidence.toFixed(2)}`,
    });
    await handle.runtime.inputVoiceText(
      message.payload.text,
      message.payload.confidence,
    );
  }

  async handleSlashCommand(message: SessionCommandSlashMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    const command = normalizeSlashCommand(
      handle.agentType,
      message.payload.command,
    );
    console.log(
      `[daemon-session] slash session=${handle.sessionId} command=${command} args=${message.payload.args.join(" ")}`,
    );
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "session.command.slash",
      summary: `command=${command} args=${message.payload.args.join(" ")}`,
    });
    await handle.runtime.inputSlashCommand(
      command,
      message.payload.args,
    );
  }

  async handlePtyInput(message: PtyInputMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "pty.input",
      summary: `base64_bytes=${message.payload.data.length}`,
    });
    await handle.runtime.inputPty(message.payload.data);
  }

  async handlePtyResize(message: PtyResizeMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    console.log(
      `[daemon-session] pty.resize session=${handle.sessionId} cols=${message.payload.cols} rows=${message.payload.rows}`,
    );
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "pty.resize",
      summary: `cols=${message.payload.cols} rows=${message.payload.rows}`,
    });
    await handle.runtime.resizePty(message.payload.cols, message.payload.rows);
  }

  async cancelSession(message: SessionCancelMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "session.cancel",
      summary: "cancel requested by app",
    });
    await handle.runtime.cancel();
  }

  async allowDanger(message: DangerAllowMessage): Promise<void> {
    if (!this.dangerInterceptor) {
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        "Danger interceptor is not configured",
      );
    }

    const resolution = await this.dangerInterceptor.resolveFromApp(
      message.payload.danger_id,
      message.payload.biometric_verified,
      true,
    );
    this.emitDangerResult(
      message.payload.session_id,
      message.payload.danger_id,
      resolution.status,
      resolution.message,
    );
  }

  async denyDanger(message: DangerDenyMessage): Promise<void> {
    if (!this.dangerInterceptor) {
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        "Danger interceptor is not configured",
      );
    }

    const resolution = await this.dangerInterceptor.resolveFromApp(
      message.payload.danger_id,
      null,
      false,
    );
    this.emitDangerResult(
      message.payload.session_id,
      message.payload.danger_id,
      resolution.status,
      resolution.message,
    );
  }

  get(sessionId: string): SessionHandle | undefined {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      return undefined;
    }

    return {
      sessionId: handle.sessionId,
      workspacePath: handle.workspacePath,
      agentType: handle.agentType,
      seq: handle.seq,
      createdAt: handle.createdAt,
    };
  }

  private enqueueRuntimeEvent(
    handle: InternalSessionHandle,
    event: SessionEventBody,
  ): Promise<void> {
    handle.eventQueue = handle.eventQueue.then(async () => {
      await this.processRuntimeEvent(handle, event);
    });
    return handle.eventQueue;
  }

  private async processRuntimeEvent(
    handle: InternalSessionHandle,
    event: SessionEventBody,
  ): Promise<void> {
    if (event.event_type === "tool.use") {
      await this.captureFileChangeSnapshot(handle, event);
      const decision = await this.dangerInterceptor?.requestApproval({
        sessionId: handle.sessionId,
        workspacePath: handle.workspacePath,
        agentType: handle.agentType,
        toolName: event.tool_name,
        toolInput: event.tool_input,
      });

      await this.auditLogger?.appendAuditEntry({
        session_id: handle.sessionId,
        event_type: "tool.use",
        summary: `tool=${event.tool_name} input_sha256=${sha256Hex(JSON.stringify(event.tool_input))} verdict=${decision?.allowed === false ? "denied" : "allowed"}`,
      });

      if (decision && !decision.allowed) {
        handle.suppressedToolUseIds.add(event.tool_use_id);
        handle.pendingFileChanges.delete(event.tool_use_id);
        this.eventEmitter.emitSessionEvent({
          sessionId: handle.sessionId,
          seq: this.nextSeq(handle),
          agentType: handle.agentType,
          event: {
            event_type: "tool.result",
            tool_use_id: event.tool_use_id,
            tool_name: event.tool_name,
            is_error: true,
            content: decision.reason,
          },
        });
        await this.auditLogger?.appendAuditEntry({
          session_id: handle.sessionId,
          event_type: "tool.result",
          summary: `tool=${event.tool_name} denied=true`,
        });
        return;
      }
    }

    if (
      event.event_type === "tool.result" &&
      handle.suppressedToolUseIds.delete(event.tool_use_id)
    ) {
      handle.pendingFileChanges.delete(event.tool_use_id);
      return;
    }

    this.eventEmitter.emitSessionEvent({
      sessionId: handle.sessionId,
      seq: this.nextSeq(handle),
      event,
      agentType: handle.agentType,
    });

    if (event.event_type === "tool.result") {
      await this.emitDerivedFileChange(handle, event);
    }

    await this.auditRuntimeEvent(handle, event);

    if (event.event_type === "session.done") {
      await this.dangerInterceptor?.clearSession(handle.sessionId);
      await this.imageUploadStore.cleanupSession(handle.sessionId);
      handle.pendingFileChanges.clear();
      this.sessions.delete(handle.sessionId);
    }
  }

  private async captureFileChangeSnapshot(
    handle: InternalSessionHandle,
    event: Extract<SessionEventBody, { event_type: "tool.use" }>,
  ): Promise<void> {
    const pending = await capturePendingFileChange(
      handle.workspacePath,
      event.tool_name,
      event.tool_input,
    );
    if (!pending) {
      handle.pendingFileChanges.delete(event.tool_use_id);
      return;
    }
    handle.pendingFileChanges.set(event.tool_use_id, pending);
  }

  private async emitDerivedFileChange(
    handle: InternalSessionHandle,
    event: Extract<SessionEventBody, { event_type: "tool.result" }>,
  ): Promise<void> {
    const pending = handle.pendingFileChanges.get(event.tool_use_id);
    if (!pending) {
      return;
    }

    handle.pendingFileChanges.delete(event.tool_use_id);
    if (event.is_error) {
      return;
    }

    const fileChangedEvent = await buildFileChangedEvent(pending);
    if (!fileChangedEvent) {
      return;
    }

    this.eventEmitter.emitSessionEvent({
      sessionId: handle.sessionId,
      seq: this.nextSeq(handle),
      event: fileChangedEvent,
      agentType: handle.agentType,
    });
    await this.auditRuntimeEvent(handle, fileChangedEvent);
  }

  private async auditRuntimeEvent(
    handle: InternalSessionHandle,
    event: SessionEventBody,
  ): Promise<void> {
    if (!this.auditLogger) {
      return;
    }

    if (event.event_type === "tool.result") {
      await this.auditLogger.appendAuditEntry({
        session_id: handle.sessionId,
        event_type: "tool.result",
        summary: `tool=${event.tool_name} is_error=${event.is_error}`,
      });
      return;
    }

    if (event.event_type === "file.changed") {
      await this.auditLogger.appendAuditEntry({
        session_id: handle.sessionId,
        event_type: "file.changed",
        summary: `file=${event.file_path} added=${event.added} removed=${event.removed}`,
      });
      return;
    }

    if (event.event_type === "session.done") {
      await this.auditLogger.appendAuditEntry({
        session_id: handle.sessionId,
        event_type: "session.done",
        summary: `exit_code=${event.exit_code} duration_ms=${event.duration_ms}`,
      });
    }
  }

  private nextSeq(handle: InternalSessionHandle): number {
    handle.seq += 1;
    return handle.seq;
  }

  private emitDangerResult(
    sessionId: string,
    dangerId: string,
    status: "approved" | "denied" | "timed_out" | "not_found" | "biometric_required",
    message: string,
  ): void {
    this.options.sendMessage({
      v: 1,
      type: "danger.result",
      payload: {
        danger_id: dangerId,
        session_id: sessionId,
        status,
        message,
      },
    });
  }

  private getRequiredSession(sessionId: string): InternalSessionHandle {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      throw new DaemonSessionError(
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
      );
    }
    return handle;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSlashCommand(agentType: AgentType, command: string): string {
  const trimmed = command.trim();
  if (agentType === "shell" || trimmed.startsWith("/")) {
    return trimmed;
  }

  return `/${trimmed}`;
}
