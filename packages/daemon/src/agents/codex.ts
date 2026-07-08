import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { createInterface } from "node:readline";

import type { SessionEventBody } from "@hellobug/protocol";

import type { SessionRuntime, SessionRuntimeEvents, SessionRuntimeStartOptions } from "../sessions/runtime.js";

type SpawnFn = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface CodexRuntimeOptions {
  command?: string;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
}

export class CodexSessionRuntime implements SessionRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startedAt = 0;
  private doneSent = false;
  private lineQueue = Promise.resolve();
  private inputQueue = Promise.resolve();
  private replyResolve: (() => void) | null = null;
  private codexSessionId: string | null = null;
  private workspacePath = "";
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_TIMEOUT_MS = 600_000; // 10 min

  constructor(
    private readonly events: SessionRuntimeEvents,
    private readonly options: CodexRuntimeOptions = {},
  ) {}

  async start(options: SessionRuntimeStartOptions): Promise<void> {
    this.startedAt = Date.now();
    this.workspacePath = options.workspacePath;
    this.codexSessionId = options.resumeSessionId;
  }

  async input(text: string): Promise<void> {
    this._resetIdleTimer();
    await this.inputQueue;
    let resolveInput: () => void;
    this.inputQueue = new Promise<void>((r) => { resolveInput = r; });
    this.replyResolve = resolveInput!;

    try {
      await this.runCodex(text);
    } finally {
      this.replyResolve?.();
      this.replyResolve = null;
    }
  }

  async inputImage(filePath: string, mimeType: string): Promise<void> {
    void mimeType;
    await this.input(filePath);
  }

  async inputVoiceText(text: string, confidence: number): Promise<void> {
    void confidence;
    await this.input(text);
  }

  async inputSlashCommand(command: string, args: string[]): Promise<void> {
    await this.input([command, ...args].join(" ").trim());
  }

  async inputPty(data: string): Promise<void> {
    void data;
    throw new Error("Codex runtime does not support PTY input");
  }

  async resizePty(cols: number, rows: number): Promise<void> {
    void cols;
    void rows;
    throw new Error("Codex runtime does not support PTY resize");
  }

  async cancel(): Promise<void> {
    if (this.child) {
      this.child.kill("SIGINT");
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.replyResolve?.();
    this.replyResolve = null;
  }

  private async runCodex(prompt: string): Promise<void> {
    const spawnFn = this.options.spawnFn ?? spawn;
    const args = ["exec", "--json"];

    if (this.codexSessionId) {
      args.push("resume", this.codexSessionId);
    }

    args.push(prompt);

    console.log(`[codex] running: codex exec --json${this.codexSessionId ? " resume " + this.codexSessionId : ""} "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`);
    this.child = spawnFn(
      this.options.command ?? "codex",
      args,
      { cwd: this.workspacePath, env: { ...process.env, ...this.options.env }, stdio: ["pipe", "pipe", "pipe"] },
    );

    this.child.stdin.end();

    const child = this.child;

    child.stdout.on("data", (data: Buffer) => {
      console.log(`[codex] stdout raw (${data.length}b):`, data.toString().slice(0, 300));
    });

    child.stderr.on("data", (data: Buffer) => {
      console.log("[codex] stderr:", data.toString().slice(0, 200));
    });

    const lineReader = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    lineReader.on("line", (line) => {
      if (!line.trim()) return;
      this.lineQueue = this.lineQueue.then(() => this.handleOutputLine(line));
    });

    await new Promise<void>((resolve) => {
      child.once("close", (code) => {
        lineReader.close();
        console.log(`[codex] process closed code=${code}`);
        if (!this.doneSent) {
          const exitCode = typeof code === "number" ? code : 1;
          if (exitCode !== 0) {
            this.emitEvent({ event_type: "assistant.delta", text: `[codex exited with code ${exitCode}]` }).finally(resolve);
          } else {
            resolve();
          }
        } else {
          resolve();
        }
        this.child = null;
      });
      child.once("error", () => resolve());
    });
  }

  private async handleOutputLine(line: string): Promise<void> {
    this._resetIdleTimer();
    try {
      const parsed = JSON.parse(line);
      console.log("[codex] <-", JSON.stringify(parsed).slice(0, 200));

      switch (parsed.type) {
        case "turn.started": {
          if (!this.codexSessionId && parsed.session_id) {
            this.codexSessionId = parsed.session_id as string;
            console.log(`[codex] session captured: ${this.codexSessionId}`);
          }
          break;
        }
        case "item.completed": {
          const item = parsed.item;
          if (!item) break;
          if (item.type === "agent_message") {
            const text = typeof item.text === "string" ? item.text : "";
            if (text) await this.emitEvent({ event_type: "assistant.delta", text });
          } else if (item.type === "tool_use" || item.type === "computer_call") {
            await this.emitEvent({ event_type: "tool.use", tool_use_id: item.id ?? "", tool_name: item.name ?? item.type ?? "unknown", tool_input: item.input ?? {} });
          } else if (item.type === "tool_result") {
            await this.emitEvent({ event_type: "tool.result", tool_use_id: item.tool_use_id ?? item.call_id ?? "", tool_name: item.tool_name ?? "unknown", content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? item), is_error: item.is_error ?? false });
          } else {
            console.log("[codex] unknown item type:", item.type, JSON.stringify(item).slice(0, 200));
          }
          break;
        }
        case "turn.completed": {
          if (!this.codexSessionId && parsed.session_id) {
            this.codexSessionId = parsed.session_id as string;
          }
          const usage = parsed.usage;
          await this.emitEvent({ event_type: "session.usage", input_tokens: (usage?.input_tokens as number) ?? 0, output_tokens: (usage?.output_tokens as number) ?? 0, cache_read_tokens: (usage?.cached_input_tokens as number) ?? 0, cost_usd: 0 });
          break;
        }
        case "error":
          await this.emitEvent({ event_type: "assistant.delta", text: `[codex error] ${parsed.message ?? "unknown error"}` });
          break;
      }
    } catch { /* ignore */ }
  }

  private async emitEvent(event: SessionEventBody): Promise<void> {
    if (this.replyResolve) {
      if (event.event_type === "session.usage" || event.event_type === "session.done") {
        this.replyResolve();
        this.replyResolve = null;
      }
    }
    await this.events.onSessionEvent?.(event);
  }

  private _resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log("[codex] idle timeout after 10min, killing process");
      this.child?.kill("SIGTERM");
      this.idleTimer = null;
    }, CodexSessionRuntime.IDLE_TIMEOUT_MS);
  }
}

export function createCodexSessionRuntime(
  events: SessionRuntimeEvents,
  options: CodexRuntimeOptions = {},
): CodexSessionRuntime {
  return new CodexSessionRuntime(events, options);
}
