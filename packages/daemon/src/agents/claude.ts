import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { createInterface } from "node:readline";

import type { SessionEventBody } from "@hellobug/protocol";

import { parseClaudeStreamEvent } from "./claude-event-parser.js";
import type { SessionRuntime, SessionRuntimeEvents, SessionRuntimeStartOptions } from "../sessions/runtime.js";

type SpawnFn = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

interface ClaudeInputMessage {
  type: "user";
  message: {
    role: "user";
    content: string;
  };
}

export interface ClaudeRuntimeOptions {
  command?: string;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
}

export class ClaudeSessionRuntime implements SessionRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startedAt = 0;
  private doneSent = false;
  private lineQueue = Promise.resolve();
  private readonly toolNamesById = new Map<string, string>();

  constructor(
    private readonly events: SessionRuntimeEvents,
    private readonly options: ClaudeRuntimeOptions = {},
  ) {}

  async start(options: SessionRuntimeStartOptions): Promise<void> {
    if (this.child) {
      throw new Error("Claude runtime already started");
    }

    this.startedAt = Date.now();
    const spawnFn = this.options.spawnFn ?? spawn;
    const child = spawnFn(
      this.options.command ?? "claude",
      this.buildArgs(options),
      {
        cwd: options.workspacePath,
        env: {
          ...process.env,
          ...this.options.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.child = child;

    child.stderr.on("data", () => {
      // Keep stderr reserved for future diagnostics and audit capture.
    });

    const lineReader = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    lineReader.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      this.lineQueue = this.lineQueue.then(() => this.handleOutputLine(line));
    });

    child.once("close", async (code, signal) => {
      lineReader.close();
      if (!this.doneSent) {
        const exitCode = typeof code === "number" ? code : signal === "SIGINT" ? 130 : 1;
        await this.emitDone(exitCode);
      }
      this.child = null;
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      child.once("spawn", () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      });

      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });
    });
  }

  async input(text: string): Promise<void> {
    await this.writeUserMessage(text);
  }

  async inputImage(filePath: string, mimeType: string): Promise<void> {
    void mimeType;
    await this.writeUserMessage(filePath);
  }

  async inputVoiceText(text: string, confidence: number): Promise<void> {
    void confidence;
    await this.writeUserMessage(text);
  }

  async inputSlashCommand(command: string, args: string[]): Promise<void> {
    await this.writeUserMessage([command, ...args].join(" ").trim());
  }

  async cancel(): Promise<void> {
    if (!this.child) {
      return;
    }

    this.child.kill("SIGINT");
  }

  private async writeUserMessage(text: string): Promise<void> {
    await this.writeMessage({
      type: "user",
      message: {
        role: "user",
        content: text,
      },
    });
  }

  private async writeMessage(message: ClaudeInputMessage): Promise<void> {
    if (!this.child?.stdin.writable) {
      throw new Error("Claude runtime is not writable");
    }

    await new Promise<void>((resolve, reject) => {
      this.child?.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private buildArgs(options: SessionRuntimeStartOptions): string[] {
    const args = [
      ...(this.options.extraArgs ?? []),
      "-p",
      "",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ];

    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }

    return args;
  }

  private normalizeEvent(event: SessionEventBody): SessionEventBody {
    if (event.event_type === "tool.use") {
      this.toolNamesById.set(event.tool_use_id, event.tool_name);
      return event;
    }

    if (event.event_type === "tool.result") {
      const toolName =
        event.tool_name === "unknown"
          ? this.toolNamesById.get(event.tool_use_id) ?? event.tool_name
          : event.tool_name;

      if (toolName !== "unknown") {
        this.toolNamesById.set(event.tool_use_id, toolName);
      }

      if (toolName === event.tool_name) {
        return event;
      }

      return {
        ...event,
        tool_name: toolName,
      };
    }

    return event;
  }

  private async handleOutputLine(line: string): Promise<void> {
    try {
      const parsed = parseClaudeStreamEvent(JSON.parse(line));
      for (const event of parsed.events) {
        await this.emitEvent(this.normalizeEvent(event));
      }
    } catch {
      // Ignore malformed scaffolding lines so long-running sessions stay alive.
    }
  }

  private async emitEvent(event: SessionEventBody): Promise<void> {
    await this.events.onSessionEvent?.(event);
  }

  private async emitDone(exitCode: number): Promise<void> {
    this.doneSent = true;
    this.toolNamesById.clear();
    await this.emitEvent({
      event_type: "session.done",
      exit_code: exitCode,
      duration_ms: Date.now() - this.startedAt,
    });
  }
}

export function createClaudeSessionRuntime(
  events: SessionRuntimeEvents,
  options: ClaudeRuntimeOptions = {},
): ClaudeSessionRuntime {
  return new ClaudeSessionRuntime(events, options);
}
