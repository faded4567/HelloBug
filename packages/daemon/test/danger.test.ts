import type { Message } from "@hellobug/protocol";
import { describe, expect, it, vi } from "vitest";

import { DangerApprovalInterceptor } from "../src/guard/interceptor.js";
import { DangerRuleSet } from "../src/guard/rules.js";
import { DaemonSessionManager } from "../src/sessions/manager.js";
import type {
  SessionRuntime,
  SessionRuntimeEvents,
  SessionRuntimeFactory,
  SessionRuntimeStartOptions,
} from "../src/sessions/runtime.js";

describe("danger rules", () => {
  it("allows read-only tools and reviews dangerous bash commands", () => {
    const rules = new DangerRuleSet([
      {
        pattern: String.raw`^npm test$`,
        mode: "allow",
        desc: "allow tests",
      },
    ]);

    expect(
      rules.evaluateToolUse({
        toolName: "Read",
        toolInput: {
          file_path: "README.md",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        verdict: "allow",
        ruleMatched: "built-in read-only tool",
      }),
    );

    expect(
      rules.evaluateToolUse({
        toolName: "Bash",
        toolInput: {
          command: "git push --force origin main",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        verdict: "review",
        ruleMatched: "force push",
      }),
    );

    expect(
      rules.evaluateToolUse({
        toolName: "Bash",
        toolInput: {
          command: "npm test",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        verdict: "allow",
        ruleMatched: "allow tests",
      }),
    );
  });
});

describe("danger approval interceptor", () => {
  it("emits danger.pending and auto denies on timeout", async () => {
    vi.useFakeTimers();
    try {
      const sent: Message[] = [];
      const interceptor = new DangerApprovalInterceptor({
        sendMessage: (message) => {
          sent.push(message);
        },
        rules: new DangerRuleSet(),
        timeoutMs: 50,
        now: () => Date.now(),
      });

      const approvalPromise = interceptor.requestApproval({
        sessionId: "session-timeout",
        workspacePath: "/tmp/workspace",
        toolName: "Bash",
        toolInput: {
          command: "rm -rf build",
        },
      });

      expect(sent).toEqual([
        expect.objectContaining({
          type: "danger.pending",
          payload: expect.objectContaining({
            session_id: "session-timeout",
            tool_name: "Bash",
          }),
        }),
      ]);

      await vi.advanceTimersByTimeAsync(50);

      await expect(approvalPromise).resolves.toEqual({
        allowed: false,
        reason: "Danger approval timed out",
        ruleMatched: "recursive delete",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("daemon session danger flow", () => {
  it("holds dangerous tool use until app allows it", async () => {
    const sent: Message[] = [];
    const manager = new DaemonSessionManager({
      sendMessage: (message) => {
        sent.push(message);
      },
      allowedPaths: ["/tmp/workspace"],
      runtimeFactory: createBashFixtureRuntimeFactory(),
      dangerInterceptor: new DangerApprovalInterceptor({
        sendMessage: (message) => {
          sent.push(message);
        },
        rules: new DangerRuleSet(),
      }),
    });

    await manager.startSession({
      v: 1,
      type: "session.start",
      payload: {
        session_id: "session-allow",
        agent_type: "claude_code",
        workspace_path: "/tmp/workspace",
        resume_session_id: null,
      },
    });

    const inputPromise = manager.handleInput({
      v: 1,
      type: "session.input",
      payload: {
        session_id: "session-allow",
        text: "git push --force origin main",
      },
    });

    await expect
      .poll(() => sent.find((message) => message.type === "danger.pending"))
      .toBeDefined();
    const pendingMessage = sent.find(
      (message): message is Extract<Message, { type: "danger.pending" }> =>
        message.type === "danger.pending",
    );
    expect(pendingMessage).toBeDefined();
    expect(sent.filter((message) => message.type === "session.event")).toHaveLength(0);

    await manager.allowDanger({
      v: 1,
      type: "danger.allow",
      payload: {
        danger_id: pendingMessage!.payload.danger_id,
        biometric_verified: true,
      },
    });

    await inputPromise;

    const events = sent.filter(
      (message): message is Extract<Message, { type: "session.event" }> =>
        message.type === "session.event",
    );
    expect(events.map((message) => message.payload.event.event_type)).toEqual([
      "tool.use",
      "tool.result",
      "session.done",
    ]);
    expect(events[0]?.payload.event).toEqual(
      expect.objectContaining({
        event_type: "tool.use",
        tool_name: "Bash",
      }),
    );
  });

  it("replaces denied tool use with a synthetic error result", async () => {
    const sent: Message[] = [];
    const manager = new DaemonSessionManager({
      sendMessage: (message) => {
        sent.push(message);
      },
      allowedPaths: ["/tmp/workspace"],
      runtimeFactory: createBashFixtureRuntimeFactory(),
      dangerInterceptor: new DangerApprovalInterceptor({
        sendMessage: (message) => {
          sent.push(message);
        },
        rules: new DangerRuleSet(),
      }),
    });

    await manager.startSession({
      v: 1,
      type: "session.start",
      payload: {
        session_id: "session-deny",
        agent_type: "claude_code",
        workspace_path: "/tmp/workspace",
        resume_session_id: null,
      },
    });

    const inputPromise = manager.handleInput({
      v: 1,
      type: "session.input",
      payload: {
        session_id: "session-deny",
        text: "rm -rf tmp/build",
      },
    });

    await expect
      .poll(() => sent.find((message) => message.type === "danger.pending"))
      .toBeDefined();
    const pendingMessage = sent.find(
      (message): message is Extract<Message, { type: "danger.pending" }> =>
        message.type === "danger.pending",
    );
    expect(pendingMessage).toBeDefined();

    await manager.denyDanger({
      v: 1,
      type: "danger.deny",
      payload: {
        danger_id: pendingMessage!.payload.danger_id,
      },
    });

    await inputPromise;

    const events = sent.filter(
      (message): message is Extract<Message, { type: "session.event" }> =>
        message.type === "session.event",
    );
    expect(events.map((message) => message.payload.event.event_type)).toEqual([
      "tool.result",
      "session.done",
    ]);
    expect(events[0]?.payload.event).toEqual({
      event_type: "tool.result",
      tool_use_id: "tool-1",
      tool_name: "Bash",
      is_error: true,
      content: "Operation denied by user approval policy",
    });
  });
});

class BashFixtureRuntime implements SessionRuntime {
  constructor(private readonly events: SessionRuntimeEvents) {}

  async start(options: SessionRuntimeStartOptions): Promise<void> {
    void options;
  }

  async input(text: string): Promise<void> {
    await this.events.onSessionEvent?.({
      event_type: "tool.use",
      tool_name: "Bash",
      tool_input: {
        command: text,
      },
      tool_use_id: "tool-1",
    });
    await this.events.onSessionEvent?.({
      event_type: "tool.result",
      tool_use_id: "tool-1",
      tool_name: "Bash",
      is_error: false,
      content: "ok",
    });
    await this.events.onSessionEvent?.({
      event_type: "session.done",
      exit_code: 0,
      duration_ms: 1,
    });
  }

  async inputImage(): Promise<void> {
    throw new Error("not implemented");
  }

  async inputVoiceText(): Promise<void> {
    throw new Error("not implemented");
  }

  async inputSlashCommand(): Promise<void> {
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

function createBashFixtureRuntimeFactory(): SessionRuntimeFactory {
  return ({ events }) => new BashFixtureRuntime(events);
}
