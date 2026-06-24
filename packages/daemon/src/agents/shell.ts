import { Buffer } from "node:buffer";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";

import type { SessionRuntime, SessionRuntimeEvents, SessionRuntimeStartOptions } from "../sessions/runtime.js";
import nodePty, {
  type IDisposable,
  type IPty,
  type IPtyForkOptions,
  type IWindowsPtyForkOptions,
} from "node-pty";

type PtySpawnOptions = IPtyForkOptions | IWindowsPtyForkOptions;
type PtySpawnFn = (
  file: string,
  args: string[] | string,
  options: PtySpawnOptions,
) => IPty;
type ProcessSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface ShellRuntimeOptions {
  shell?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  spawnPty?: PtySpawnFn;
  spawnProcess?: ProcessSpawnFn;
}

export class ShellSessionRuntime implements SessionRuntime {
  private pty: IPty | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private startedAt = 0;
  private doneSent = false;
  private dataSubscription: IDisposable | null = null;
  private exitSubscription: IDisposable | null = null;

  constructor(
    private readonly events: SessionRuntimeEvents,
    private readonly options: ShellRuntimeOptions = {},
  ) {}

  async start(options: SessionRuntimeStartOptions): Promise<void> {
    if (this.pty) {
      throw new Error("Shell runtime already started");
    }

    this.startedAt = Date.now();
    this.doneSent = false;

    const shell = this.options.shell ?? defaultShell();
    const spawnPty = this.options.spawnPty ?? nodePty.spawn;
    const env = {
      ...process.env,
      ...this.options.env,
    };

    try {
      const pty = spawnPty(shell, [], {
        name: "xterm-256color",
        cols: this.options.cols ?? 80,
        rows: this.options.rows ?? 24,
        cwd: options.workspacePath,
        env,
      });

      this.pty = pty;
      this.dataSubscription = pty.onData((data) => {
        void this.emitPtyData(data);
      });
      this.exitSubscription = pty.onExit((event) => {
        this.cleanupPty();
        void this.emitDone(event.exitCode);
      });
      return;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.warn(
        `[shell] node-pty unavailable, falling back to piped shell: ${text}`,
      );
    }

    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess(shell, fallbackShellArgs(shell), {
      cwd: options.workspacePath,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child = child;
    child.stdout.on("data", (data: Buffer | string) => {
      void this.emitPtyData(data.toString());
    });
    child.stderr.on("data", (data: Buffer | string) => {
      void this.emitPtyData(data.toString());
    });
    child.once("close", (code, signal) => {
      this.cleanupChild();
      const exitCode =
        typeof code === "number" ? code : signal === "SIGINT" ? 130 : 1;
      void this.emitDone(exitCode);
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
    if (this.child?.stdin.writable) {
      const line =
        text.length > 0 && !text.endsWith("\n") && !text.endsWith("\r")
          ? `${text}\n`
          : text;
      this.child.stdin.write(line);
      return;
    }

    if (!this.pty) {
      throw new Error("Shell runtime is not active");
    }

    const line = text.length > 0 && !text.endsWith("\n") && !text.endsWith("\r")
      ? `${text}\n`
      : text;
    this.pty.write(line);
  }

  async inputImage(filePath: string, mimeType: string): Promise<void> {
    void filePath;
    void mimeType;
    throw new Error("Shell runtime does not support image input");
  }

  async inputVoiceText(text: string, confidence: number): Promise<void> {
    void confidence;
    await this.input(text);
  }

  async inputSlashCommand(command: string, args: string[]): Promise<void> {
    await this.input([command, ...args].join(" ").trim());
  }

  async inputPty(data: string): Promise<void> {
    if (this.child?.stdin.writable) {
      this.child.stdin.write(normalizePipeInput(Buffer.from(data, "base64")));
      return;
    }

    if (!this.pty) {
      throw new Error("Shell runtime is not active");
    }

    this.pty.write(Buffer.from(data, "base64"));
  }

  async resizePty(cols: number, rows: number): Promise<void> {
    if (this.child) {
      return;
    }

    if (!this.pty) {
      throw new Error("Shell runtime is not active");
    }

    this.pty.resize(cols, rows);
  }

  async cancel(): Promise<void> {
    if (this.child) {
      this.child.kill();
      return;
    }

    if (!this.pty) {
      return;
    }

    this.pty.kill();
  }

  private async emitPtyData(data: string): Promise<void> {
    await this.events.onSessionEvent?.({
      event_type: "pty.data",
      bytes: Buffer.from(data, "utf8").toString("base64"),
    });
  }

  private async emitDone(exitCode: number): Promise<void> {
    if (this.doneSent) {
      return;
    }

    this.doneSent = true;
    await this.events.onSessionEvent?.({
      event_type: "session.done",
      exit_code: exitCode,
      duration_ms: Date.now() - this.startedAt,
    });
  }

  private cleanupPty(): void {
    this.dataSubscription?.dispose();
    this.exitSubscription?.dispose();
    this.dataSubscription = null;
    this.exitSubscription = null;
    this.pty = null;
  }

  private cleanupChild(): void {
    this.child = null;
  }
}

export function createShellSessionRuntime(
  events: SessionRuntimeEvents,
  options: ShellRuntimeOptions = {},
): ShellSessionRuntime {
  return new ShellSessionRuntime(events, options);
}

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "powershell.exe";
  }

  return process.env.SHELL || "/bin/bash";
}

function fallbackShellArgs(shell: string): string[] {
  void shell;
  if (process.platform === "win32") {
    return [];
  }

  return [];
}

function normalizePipeInput(data: Buffer): Buffer {
  const normalized: number[] = [];

  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (value !== 0x0d) {
      normalized.push(value);
      continue;
    }

    if (data[index + 1] === 0x0a) {
      normalized.push(0x0a);
      index += 1;
      continue;
    }

    normalized.push(0x0a);
  }

  return Buffer.from(normalized);
}
