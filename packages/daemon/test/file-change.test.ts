import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Message, SessionEventBody } from "@hellobug/protocol";
import { describe, expect, it } from "vitest";

import { DaemonSessionManager } from "../src/sessions/manager.js";
import type {
  SessionRuntime,
  SessionRuntimeEvents,
  SessionRuntimeFactory,
  SessionRuntimeStartOptions,
} from "../src/sessions/runtime.js";

describe("daemon derived file.changed events", () => {
  it("emits file.changed after a successful in-workspace write tool result", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "hellobug-diff-ok-"));
    const targetFile = join(workspaceRoot, "notes.txt");
    await writeFile(targetFile, "alpha\nbeta\n", "utf8");

    const sent: Message[] = [];
    const manager = new DaemonSessionManager({
      sendMessage: (message) => {
        sent.push(message);
      },
      allowedPaths: [workspaceRoot],
      runtimeFactory: createFileMutationRuntimeFactory(async () => {
        await writeFile(targetFile, "alpha\ngamma\n", "utf8");
      }),
    });

    await manager.startSession({
      v: 1,
      type: "session.start",
      payload: {
        session_id: "session-diff-ok",
        agent_type: "claude_code",
        workspace_path: workspaceRoot,
        resume_session_id: null,
      },
    });

    await manager.handleInput({
      v: 1,
      type: "session.input",
      payload: {
        session_id: "session-diff-ok",
        text: "update notes",
      },
    });

    const events = sessionEvents(sent);
    expect(events.map((event) => event.event_type)).toEqual([
      "tool.use",
      "tool.result",
      "file.changed",
      "session.done",
    ]);

    expect(events[2]).toEqual(
      expect.objectContaining({
        event_type: "file.changed",
        file_path: "notes.txt",
        added: 1,
        removed: 1,
      }),
    );
    expect((events[2] as Extract<SessionEventBody, { event_type: "file.changed" }>).diff).toContain(
      "@@ -1,2 +1,2 @@",
    );
    expect((events[2] as Extract<SessionEventBody, { event_type: "file.changed" }>).diff).toContain(
      "-beta",
    );
    expect((events[2] as Extract<SessionEventBody, { event_type: "file.changed" }>).diff).toContain(
      "+gamma",
    );
    expect(await readFile(targetFile, "utf8")).toBe("alpha\ngamma\n");
  });

  it("does not emit file.changed when the write tool result is an error", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "hellobug-diff-error-"));
    const targetFile = join(workspaceRoot, "notes.txt");
    await writeFile(targetFile, "alpha\nbeta\n", "utf8");

    const sent: Message[] = [];
    const manager = new DaemonSessionManager({
      sendMessage: (message) => {
        sent.push(message);
      },
      allowedPaths: [workspaceRoot],
      runtimeFactory: createFileMutationRuntimeFactory(async () => {
        // Simulate a failed mutation attempt that leaves the file unchanged.
      }, { isError: true }),
    });

    await manager.startSession({
      v: 1,
      type: "session.start",
      payload: {
        session_id: "session-diff-error",
        agent_type: "claude_code",
        workspace_path: workspaceRoot,
        resume_session_id: null,
      },
    });

    await manager.handleInput({
      v: 1,
      type: "session.input",
      payload: {
        session_id: "session-diff-error",
        text: "update notes",
      },
    });

    const events = sessionEvents(sent);
    expect(events.map((event) => event.event_type)).toEqual([
      "tool.use",
      "tool.result",
      "session.done",
    ]);
    expect(events.some((event) => event.event_type === "file.changed")).toBe(false);
  });

  it("does not emit file.changed when the write leaves content unchanged", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "hellobug-diff-same-"));
    const targetFile = join(workspaceRoot, "notes.txt");
    await writeFile(targetFile, "alpha\nbeta\n", "utf8");

    const sent: Message[] = [];
    const manager = new DaemonSessionManager({
      sendMessage: (message) => {
        sent.push(message);
      },
      allowedPaths: [workspaceRoot],
      runtimeFactory: createFileMutationRuntimeFactory(async () => {
        await writeFile(targetFile, "alpha\nbeta\n", "utf8");
      }),
    });

    await manager.startSession({
      v: 1,
      type: "session.start",
      payload: {
        session_id: "session-diff-same",
        agent_type: "claude_code",
        workspace_path: workspaceRoot,
        resume_session_id: null,
      },
    });

    await manager.handleInput({
      v: 1,
      type: "session.input",
      payload: {
        session_id: "session-diff-same",
        text: "update notes",
      },
    });

    const events = sessionEvents(sent);
    expect(events.map((event) => event.event_type)).toEqual([
      "tool.use",
      "tool.result",
      "session.done",
    ]);
    expect(events.some((event) => event.event_type === "file.changed")).toBe(false);
  });
});

class FileMutationFixtureRuntime implements SessionRuntime {
  constructor(
    private readonly events: SessionRuntimeEvents,
    private readonly mutateFile: () => Promise<void>,
    private readonly options: { isError?: boolean } = {},
  ) {}

  async start(options: SessionRuntimeStartOptions): Promise<void> {
    void options;
  }

  async input(text: string): Promise<void> {
    void text;
    await this.events.onSessionEvent?.({
      event_type: "tool.use",
      tool_name: "Write",
      tool_input: {
        file_path: "notes.txt",
      },
      tool_use_id: "tool-write-1",
    });
    await this.mutateFile();
    await this.events.onSessionEvent?.({
      event_type: "tool.result",
      tool_use_id: "tool-write-1",
      tool_name: "Write",
      is_error: this.options.isError ?? false,
      content: this.options.isError ? "permission denied" : "ok",
    });
    await this.events.onSessionEvent?.({
      event_type: "session.done",
      exit_code: 0,
      duration_ms: 1,
    });
  }

  async inputImage(filePath: string, mimeType: string): Promise<void> {
    void filePath;
    void mimeType;
    throw new Error("not implemented");
  }

  async inputVoiceText(text: string, confidence: number): Promise<void> {
    void text;
    void confidence;
    throw new Error("not implemented");
  }

  async inputSlashCommand(command: string, args: string[]): Promise<void> {
    void command;
    void args;
    throw new Error("not implemented");
  }

  async inputPty(data: string): Promise<void> {
    void data;
    throw new Error("not implemented");
  }

  async resizePty(cols: number, rows: number): Promise<void> {
    void cols;
    void rows;
    throw new Error("not implemented");
  }

  async cancel(): Promise<void> {
    await this.events.onSessionEvent?.({
      event_type: "session.done",
      exit_code: 130,
      duration_ms: 1,
    });
  }
}

function createFileMutationRuntimeFactory(
  mutateFile: () => Promise<void>,
  options: { isError?: boolean } = {},
): SessionRuntimeFactory {
  return ({ events }) =>
    new FileMutationFixtureRuntime(events, mutateFile, options);
}

function sessionEvents(messages: Message[]): SessionEventBody[] {
  return messages
    .filter(
      (message): message is Extract<Message, { type: "session.event" }> =>
        message.type === "session.event",
    )
    .map((message) => message.payload.event);
}
