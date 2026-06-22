import type { AgentType, Message, SessionDoneEvent, SessionEventBody } from "@hellobug/protocol";

export interface SessionEventEmitterOptions {
  sendMessage: (message: Message) => void;
}

export class SessionEventEmitter {
  constructor(private readonly options: SessionEventEmitterOptions) {}

  emitSessionEvent(params: {
    sessionId: string;
    seq: number;
    event: SessionEventBody;
    agentId?: string | null;
    agentType?: AgentType | null;
  }): void {
    this.options.sendMessage({
      v: 1,
      type: "session.event",
      payload: {
        session_id: params.sessionId,
        agent_id: params.agentId ?? null,
        agent_type: params.agentType ?? null,
        seq: params.seq,
        event: params.event,
      },
    });
  }

  emitAssistantDelta(params: {
    sessionId: string;
    seq: number;
    text: string;
    agentId?: string | null;
    agentType?: AgentType | null;
  }): void {
    this.emitSessionEvent({
      sessionId: params.sessionId,
      seq: params.seq,
      agentId: params.agentId,
      agentType: params.agentType,
      event: {
        event_type: "assistant.delta",
        text: params.text,
      },
    });
  }

  emitSessionDone(params: {
    sessionId: string;
    seq: number;
    payload: { exitCode: number; durationMs: number };
    agentId?: string | null;
    agentType?: AgentType | null;
  }): void {
    const event: SessionDoneEvent = {
      event_type: "session.done",
      exit_code: params.payload.exitCode,
      duration_ms: params.payload.durationMs,
    };

    this.emitSessionEvent({
      sessionId: params.sessionId,
      seq: params.seq,
      agentId: params.agentId,
      agentType: params.agentType,
      event,
    });
  }
}
