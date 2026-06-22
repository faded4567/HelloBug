import { randomUUID } from "node:crypto";

import type { AgentType, Message } from "@hellobug/protocol";

import type { AuditLogger } from "../audit/logger.js";
import { DangerRuleSet, type ToolUseContext } from "./rules.js";

export interface DangerApprovalRequest extends ToolUseContext {
  sessionId: string;
  workspacePath: string;
  agentId?: string | null;
  agentType?: AgentType | null;
}

export interface DangerApprovalDecision {
  allowed: boolean;
  reason: string;
  ruleMatched: string;
}

export interface DangerApprovalInterceptorOptions {
  sendMessage: (message: Message) => void;
  rules?: DangerRuleSet;
  timeoutMs?: number;
  now?: () => number;
  auditLogger?: AuditLogger;
}

interface PendingDangerRequest {
  dangerId: string;
  sessionId: string;
  agentId: string | null;
  agentType: AgentType | null;
  toolName: string;
  command: string;
  ruleMatched: string;
  timeoutAt: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (decision: DangerApprovalDecision) => void;
}

export class DangerApprovalInterceptor {
  private readonly rules: DangerRuleSet;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly pendingById = new Map<string, PendingDangerRequest>();
  private readonly pendingIdsBySession = new Map<string, Set<string>>();

  constructor(private readonly options: DangerApprovalInterceptorOptions) {
    this.rules = options.rules ?? new DangerRuleSet();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  async requestApproval(request: DangerApprovalRequest): Promise<DangerApprovalDecision> {
    const evaluation = this.rules.evaluateToolUse(request);
    if (evaluation.verdict === "allow") {
      return {
        allowed: true,
        reason: "allowed",
        ruleMatched: evaluation.ruleMatched,
      };
    }

    const dangerId = randomUUID();
    const timeoutAt = this.now() + this.timeoutMs;

    return new Promise<DangerApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        void this.resolvePendingDanger(dangerId, {
          allowed: false,
          reason: "Danger approval timed out",
          ruleMatched: evaluation.ruleMatched,
        });
      }, this.timeoutMs);

      const pending: PendingDangerRequest = {
        dangerId,
        sessionId: request.sessionId,
        agentId: request.agentId ?? null,
        agentType: request.agentType ?? null,
        toolName: request.toolName,
        command: evaluation.command,
        ruleMatched: evaluation.ruleMatched,
        timeoutAt,
        timer,
        resolve,
      };

      this.pendingById.set(dangerId, pending);
      const sessionPendings = this.pendingIdsBySession.get(request.sessionId) ?? new Set<string>();
      sessionPendings.add(dangerId);
      this.pendingIdsBySession.set(request.sessionId, sessionPendings);

      this.options.sendMessage({
        v: 1,
        type: "danger.pending",
        payload: {
          danger_id: dangerId,
          session_id: request.sessionId,
          agent_id: request.agentId ?? null,
          agent_type: request.agentType ?? null,
          command: evaluation.command,
          tool_name: request.toolName,
          rule_matched: evaluation.ruleMatched,
          workspace: request.workspacePath,
          timeout_at: timeoutAt,
        },
      });

      void this.options.auditLogger?.appendAuditEntry({
        session_id: request.sessionId,
        agent_id: request.agentId ?? null,
        event_type: "danger.pending",
        summary: `tool=${request.toolName} rule=${evaluation.ruleMatched} command=${evaluation.command}`,
      });
    });
  }

  async allow(dangerId: string, biometricVerified: boolean): Promise<boolean> {
    if (!biometricVerified) {
      return this.resolvePendingDanger(dangerId, {
        allowed: false,
        reason: "Biometric verification required",
        ruleMatched: "biometric verification required",
      });
    }

    return this.resolvePendingDanger(dangerId, {
      allowed: true,
      reason: "approved",
      ruleMatched: "user approved",
    });
  }

  async deny(dangerId: string): Promise<boolean> {
    return this.resolvePendingDanger(dangerId, {
      allowed: false,
      reason: "Operation denied by user approval policy",
      ruleMatched: "user denied",
    });
  }

  async clearSession(sessionId: string): Promise<void> {
    const dangerIds = this.pendingIdsBySession.get(sessionId);
    if (!dangerIds) {
      return;
    }

    await Promise.all(
      [...dangerIds].map(async (dangerId) => {
        await this.resolvePendingDanger(dangerId, {
          allowed: false,
          reason: "Session closed before approval",
          ruleMatched: "session closed",
        });
      }),
    );
  }

  private async resolvePendingDanger(
    dangerId: string,
    decision: DangerApprovalDecision,
  ): Promise<boolean> {
    const pending = this.pendingById.get(dangerId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingById.delete(dangerId);

    const sessionPendings = this.pendingIdsBySession.get(pending.sessionId);
    sessionPendings?.delete(dangerId);
    if (sessionPendings && sessionPendings.size === 0) {
      this.pendingIdsBySession.delete(pending.sessionId);
    }

    pending.resolve(decision);

    await this.options.auditLogger?.appendAuditEntry({
      session_id: pending.sessionId,
      agent_id: pending.agentId,
      event_type: decision.allowed ? "danger.allow" : "danger.deny",
      summary: `tool=${pending.toolName} rule=${pending.ruleMatched} command=${pending.command}`,
    });

    return true;
  }
}
