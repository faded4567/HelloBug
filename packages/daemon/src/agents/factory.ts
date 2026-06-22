import type { SessionRuntimeFactory } from "../sessions/runtime.js";
import { createMemorySessionRuntime } from "../sessions/memory-runtime.js";
import { createClaudeSessionRuntime, type ClaudeRuntimeOptions } from "./claude.js";

export interface AgentRuntimeFactoryOptions {
  claude?: ClaudeRuntimeOptions;
}

export function createAgentRuntimeFactory(
  options: AgentRuntimeFactoryOptions = {},
): SessionRuntimeFactory {
  return ({ events, agentType }) => {
    if (agentType === "claude_code") {
      return createClaudeSessionRuntime(events, options.claude);
    }

    return createMemorySessionRuntime(events);
  };
}
