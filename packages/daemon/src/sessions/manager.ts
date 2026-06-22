import { createHash } from "node:crypto";

import type { AgentType, ErrorCode, Message, SessionEventBody } from "@hellobug/protocol";

import type { AuditLogger } from "../audit/logger.js";
import { SessionImageUploadStore } from "../fs/image.js";
import { WorkspaceFence } from "../guard/fence.js";
import type { DangerApprovalInterceptor } from "../guard/interceptor.js";
import { SessionEventEmitter } from "./events.js";
import type { SessionRuntimeFactory } from "./runtime.js";
import { createMemorySessionRuntime } from "./memory-runtime.js";

type SessionStartMessage = Extract<Message, { type: "session.start" }>;
type SessionInputMessage = Extract<Message, { type: "session.input" }>;
type SessionInputImageMessage = Extract<Message, { type: "session.input.image" }>;
type SessionInputVoiceTextMessage = Extract<Message, { type: "session.input.voice_text" }>;
type SessionCommandSlashMessage = Extract<Message, { type: "session.command.slash" }>;
type SessionCancelMessage = Extract<Message, { type: "session.cancel" }>;
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
    this.imageUploadStore = options.imageUploadStore ?? new SessionImageUploadStore();
    this.auditLogger = options.auditLogger;
    this.dangerInterceptor = options.dangerInterceptor;
  }

  async startSession(message: SessionStartMessage): Promise<void> {
    const sessionId = message.payload.session_id;
    if (!this.workspaceFence.isAllowed(message.payload.workspace_path)) {
      throw new DaemonSessionError(
        "WORKSPACE_FORBIDDEN",
        `Workspace is outside allowed paths: ${message.payload.workspace_path}`,
      );
    }
    if (this.sessions.has(sessionId)) {
      throw new DaemonSessionError("PROTOCOL_VERSION", `Session already exists: ${sessionId}`);
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
      workspacePath: message.payload.workspace_path,
      agentType: message.payload.agent_type,
      seq: 0,
      createdAt: Date.now(),
      runtime,
      eventQueue: Promise.resolve(),
      suppressedToolUseIds: new Set<string>(),
    };

    this.sessions.set(sessionId, handle);
    await this.auditLogger?.appendAuditEntry({
      session_id: sessionId,
      event_type: "session.start",
      summary: `agent=${handle.agentType} workspace=${handle.workspacePath}`,
    });

    try {
      await runtime.start({
        sessionId,
        workspacePath: message.payload.workspace_path,
        resumeSessionId: message.payload.resume_session_id,
        agentType: message.payload.agent_type,
      });
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }

  async handleInput(message: SessionInputMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
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
      completedUpload = await this.imageUploadStore.appendChunk(message.payload);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Invalid image upload";
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
    await handle.runtime.inputImage(completedUpload.filePath, completedUpload.mimeType);
  }

  async handleVoiceText(message: SessionInputVoiceTextMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "session.input.voice_text",
      summary: `text_sha256=${sha256Hex(message.payload.text)} confidence=${message.payload.confidence.toFixed(2)}`,
    });
    await handle.runtime.inputVoiceText(message.payload.text, message.payload.confidence);
  }

  async handleSlashCommand(message: SessionCommandSlashMessage): Promise<void> {
    const handle = this.getRequiredSession(message.payload.session_id);
    await this.auditLogger?.appendAuditEntry({
      session_id: handle.sessionId,
      event_type: "session.command.slash",
      summary: `command=${message.payload.command} args=${message.payload.args.join(" ")}`,
    });
    await handle.runtime.inputSlashCommand(message.payload.command, message.payload.args);
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
      throw new DaemonSessionError("PROTOCOL_VERSION", "Danger interceptor is not configured");
    }

    const resolved = await this.dangerInterceptor.allow(
      message.payload.danger_id,
      message.payload.biometric_verified,
    );
    if (!resolved) {
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Danger request not found: ${message.payload.danger_id}`,
      );
    }
  }

  async denyDanger(message: DangerDenyMessage): Promise<void> {
    if (!this.dangerInterceptor) {
      throw new DaemonSessionError("PROTOCOL_VERSION", "Danger interceptor is not configured");
    }

    const resolved = await this.dangerInterceptor.deny(message.payload.danger_id);
    if (!resolved) {
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Danger request not found: ${message.payload.danger_id}`,
      );
    }
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

  private enqueueRuntimeEvent(handle: InternalSessionHandle, event: SessionEventBody): Promise<void> {
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

    if (event.event_type === "tool.result" && handle.suppressedToolUseIds.delete(event.tool_use_id)) {
      return;
    }

    this.eventEmitter.emitSessionEvent({
      sessionId: handle.sessionId,
      seq: this.nextSeq(handle),
      event,
      agentType: handle.agentType,
    });

    await this.auditRuntimeEvent(handle, event);

    if (event.event_type === "session.done") {
      await this.dangerInterceptor?.clearSession(handle.sessionId);
      await this.imageUploadStore.cleanupSession(handle.sessionId);
      this.sessions.delete(handle.sessionId);
    }
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

  private getRequiredSession(sessionId: string): InternalSessionHandle {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      throw new DaemonSessionError("SESSION_NOT_FOUND", `Session not found: ${sessionId}`);
    }
    return handle;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
