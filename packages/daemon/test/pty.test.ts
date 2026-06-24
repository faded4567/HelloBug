import { describe, expect, it, vi } from "vitest";

import { createShellSessionRuntime } from "../src/agents/shell.js";
import { createDaemonMessageRouter } from "../src/transport/message-router.js";
import { DaemonSessionManager } from "../src/sessions/manager.js";
import type { SessionRuntime, SessionRuntimeFactory } from "../src/sessions/runtime.js";

describe("shell PTY runtime", () => {
  it("writes newline-terminated commands, forwards raw PTY bytes, and resizes", async () => {
    const events: Array<Record<string, unknown>> = [];
    const writes: Array<string | Buffer> = [];
    const resizes: Array<{ cols: number; rows: number }> = [];
    const killSignals: Array<string | undefined> = [];
    const dataListeners = new Set<(value: string) => void>();
    const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

    const runtime = createShellSessionRuntime(
      {
        onSessionEvent: async (event) => {
          events.push(event as Record<string, unknown>);
        },
      },
      {
        shell: "/bin/bash",
        spawnPty: (file, args, options) => {
          expect(file).toBe("/bin/bash");
          expect(args).toEqual([]);
          expect(options.cwd).toBe("/tmp/pty-workspace");
          expect(options.cols).toBe(80);
          expect(options.rows).toBe(24);

          return {
            pid: 1,
            cols: options.cols ?? 80,
            rows: options.rows ?? 24,
            process: "bash",
            handleFlowControl: false,
            onData(listener) {
              dataListeners.add(listener);
              return {
                dispose() {
                  dataListeners.delete(listener);
                },
              };
            },
            onExit(listener) {
              exitListeners.add(listener);
              return {
                dispose() {
                  exitListeners.delete(listener);
                },
              };
            },
            resize(cols, rows) {
              resizes.push({ cols, rows });
            },
            clear() {},
            write(data) {
              writes.push(data);
            },
            kill(signal) {
              killSignals.push(signal);
            },
            pause() {},
            resume() {},
          };
        },
      },
    );

    await runtime.start({
      sessionId: "sess-pty-1",
      workspacePath: "/tmp/pty-workspace",
      resumeSessionId: null,
      agentType: "shell",
    });

    await runtime.input("ls -la");
    await runtime.inputPty(Buffer.from("pwd\r", "utf8").toString("base64"));
    await runtime.resizePty(120, 40);
    await runtime.cancel();

    expect(writes[0]).toBe("ls -la\n");
    expect(Buffer.isBuffer(writes[1])).toBe(true);
    expect((writes[1] as Buffer).toString("utf8")).toBe("pwd\r");
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(killSignals).toEqual([undefined]);

    for (const listener of dataListeners) {
      listener("hello from pty");
    }

    expect(events).toContainEqual({
      event_type: "pty.data",
      bytes: Buffer.from("hello from pty", "utf8").toString("base64"),
    });

    for (const listener of exitListeners) {
      listener({ exitCode: 130 });
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        event_type: "session.done",
        exit_code: 130,
      }),
    );
  });

  it("falls back to a piped shell when node-pty spawn fails", async () => {
    const events: Array<Record<string, unknown>> = [];
    const stdinWrites: Array<string | Buffer> = [];
    let killed = false;
    const stdoutListeners = new Set<(value: Buffer) => void>();
    const stderrListeners = new Set<(value: Buffer) => void>();
    const closeListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
    const spawnListeners = new Set<() => void>();
    const errorListeners = new Set<(error: Error) => void>();

    const runtime = createShellSessionRuntime(
      {
        onSessionEvent: async (event) => {
          events.push(event as Record<string, unknown>);
        },
      },
      {
        shell: "/bin/bash",
        spawnPty() {
          throw new Error("posix_spawnp failed");
        },
        spawnProcess: (command, args, options) => {
          expect(command).toBe("/bin/bash");
          expect(args).toEqual([]);
          expect(options.cwd).toBe("/tmp/fallback-workspace");

          const child = {
            stdin: {
              writable: true,
              write(data: string | Buffer) {
                stdinWrites.push(data);
                return true;
              },
            },
            stdout: {
              on(event: string, listener: (value: Buffer) => void) {
                if (event === "data") {
                  stdoutListeners.add(listener);
                }
                return this;
              },
            },
            stderr: {
              on(event: string, listener: (value: Buffer) => void) {
                if (event === "data") {
                  stderrListeners.add(listener);
                }
                return this;
              },
            },
            once(event: string, listener: (...args: any[]) => void) {
              if (event === "close") {
                closeListeners.add(listener as (code: number | null, signal: NodeJS.Signals | null) => void);
              }
              if (event === "spawn") {
                spawnListeners.add(listener as () => void);
              }
              if (event === "error") {
                errorListeners.add(listener as (error: Error) => void);
              }
              return this;
            },
            kill() {
              killed = true;
              return true;
            },
          };

          queueMicrotask(() => {
            for (const listener of spawnListeners) {
              listener();
            }
          });

          return child as never;
        },
      },
    );

    await runtime.start({
      sessionId: "sess-fallback-1",
      workspacePath: "/tmp/fallback-workspace",
      resumeSessionId: null,
      agentType: "shell",
    });

    await runtime.input("pwd");
    await runtime.inputPty(Buffer.from("echo hi\r", "utf8").toString("base64"));
    await runtime.resizePty(120, 40);
    await runtime.cancel();

    expect(stdinWrites[0]).toBe("pwd\n");
    expect(Buffer.isBuffer(stdinWrites[1])).toBe(true);
    expect((stdinWrites[1] as Buffer).toString("utf8")).toBe("echo hi\n");
    expect(killed).toBe(true);
    expect(errorListeners.size).toBe(1);

    for (const listener of stdoutListeners) {
      listener(Buffer.from("stdout line\n", "utf8"));
    }
    for (const listener of stderrListeners) {
      listener(Buffer.from("stderr line\n", "utf8"));
    }
    for (const listener of closeListeners) {
      listener(0, null);
    }

    expect(events).toContainEqual({
      event_type: "pty.data",
      bytes: Buffer.from("stdout line\n", "utf8").toString("base64"),
    });
    expect(events).toContainEqual({
      event_type: "pty.data",
      bytes: Buffer.from("stderr line\n", "utf8").toString("base64"),
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        event_type: "session.done",
        exit_code: 0,
      }),
    );
  });
});

describe("daemon PTY routing", () => {
  it("routes pty.input and pty.resize into the session runtime", async () => {
    const calls = {
      ptyInputs: [] as string[],
      ptyResizes: [] as Array<{ cols: number; rows: number }>,
    };

    const runtimeFactory: SessionRuntimeFactory = () =>
      ({
        async start() {},
        async input() {},
        async inputImage() {},
        async inputVoiceText() {},
        async inputSlashCommand() {},
        async inputPty(data: string) {
          calls.ptyInputs.push(data);
        },
        async resizePty(cols: number, rows: number) {
          calls.ptyResizes.push({ cols, rows });
        },
        async cancel() {},
      }) satisfies SessionRuntime;

    const manager = new DaemonSessionManager({
      sendMessage: vi.fn(),
      allowedPaths: ["/tmp/workspace"],
      runtimeFactory,
    });

    await manager.startSession({
      v: 1,
      type: "session.start",
      payload: {
        session_id: "sess-route-1",
        agent_type: "shell",
        workspace_path: "/tmp/workspace",
        resume_session_id: null,
      },
    });

    const payload = Buffer.from("git status\r", "utf8").toString("base64");
    await manager.handlePtyInput({
      v: 1,
      type: "pty.input",
      payload: {
        session_id: "sess-route-1",
        data: payload,
      },
    });
    await manager.handlePtyResize({
      v: 1,
      type: "pty.resize",
      payload: {
        session_id: "sess-route-1",
        cols: 132,
        rows: 43,
      },
    });

    expect(calls.ptyInputs).toEqual([payload]);
    expect(calls.ptyResizes).toEqual([{ cols: 132, rows: 43 }]);
  });

  it("message router dispatches pty.input and pty.resize", async () => {
    const handled = {
      input: [] as string[],
      resize: [] as Array<{ cols: number; rows: number }>,
    };

    const router = createDaemonMessageRouter({
      identity: {} as never,
      sessions: {
        handlePtyInput: vi.fn(async (message) => {
          handled.input.push(message.payload.data);
        }),
        handlePtyResize: vi.fn(async (message) => {
          handled.resize.push({
            cols: message.payload.cols,
            rows: message.payload.rows,
          });
        }),
      } as never,
    });

    const connection = {
      sendMessage: vi.fn(),
    };

    await router(
      {
        v: 1,
        id: "pty-input-1",
        type: "pty.input",
        payload: {
          session_id: "sess-router-1",
          data: "ZWNobyBoZWxsbw==",
        },
      },
      connection as never,
    );
    await router(
      {
        v: 1,
        id: "pty-resize-1",
        type: "pty.resize",
        payload: {
          session_id: "sess-router-1",
          cols: 100,
          rows: 30,
        },
      },
      connection as never,
    );

    expect(handled.input).toEqual(["ZWNobyBoZWxsbw=="]);
    expect(handled.resize).toEqual([{ cols: 100, rows: 30 }]);
  });
});
