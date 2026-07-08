import type { SessionRuntimeFactory } from "../sessions/runtime.js";
import { createMemorySessionRuntime } from "../sessions/memory-runtime.js";
import { createClaudeSessionRuntime, type ClaudeRuntimeOptions } from "./claude.js";
import { createCodexSessionRuntime, type CodexRuntimeOptions } from "./codex.js";
import { createShellSessionRuntime, type ShellRuntimeOptions } from "./shell.js";

export interface AgentRuntimeFactoryOptions {
  claude?: ClaudeRuntimeOptions;
  codex?: CodexRuntimeOptions;
  shell?: ShellRuntimeOptions;
}

export function createAgentRuntimeFactory(
  options: AgentRuntimeFactoryOptions = {},
): SessionRuntimeFactory {
  return ({ events, agentType }) => {
    if (agentType === "claude_code") {
      return createClaudeSessionRuntime(events, options.claude);
    }

    if (agentType === "codex") {
      return createCodexSessionRuntime(events, options.codex);
    }

    if (agentType === "shell") {
      return createShellSessionRuntime(events, options.shell);
    }

    return createMemorySessionRuntime(events);
  };
}
