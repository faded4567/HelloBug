import type { AgentType, SessionEventBody } from "@hellobug/protocol";

export interface SessionRuntimeEvents {
  onSessionEvent?: (event: SessionEventBody) => void | Promise<void>;
}

export interface SessionRuntimeStartOptions {
  sessionId: string;
  workspacePath: string;
  resumeSessionId: string | null;
  agentType: AgentType;
}

export interface SessionRuntime {
  start(options: SessionRuntimeStartOptions): Promise<void>;
  input(text: string): Promise<void>;
  inputImage(filePath: string, mimeType: string): Promise<void>;
  inputVoiceText(text: string, confidence: number): Promise<void>;
  inputSlashCommand(command: string, args: string[]): Promise<void>;
  cancel(): Promise<void>;
}

export interface SessionRuntimeFactoryOptions {
  events: SessionRuntimeEvents;
  agentType: AgentType;
}

export type SessionRuntimeFactory = (options: SessionRuntimeFactoryOptions) => SessionRuntime;
