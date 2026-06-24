import type { AgentType, Message } from "@hellobug/protocol";
import { describe, expect, it, vi } from "vitest";

import { DaemonCatalogService } from "../src/catalog/service.js";
import type { DeviceIdentity } from "../src/crypto/keys.js";
import { DaemonSessionManager } from "../src/sessions/manager.js";
import type { SessionRuntime } from "../src/sessions/runtime.js";
import { createDaemonMessageRouter } from "../src/transport/message-router.js";

function createIdentity(): DeviceIdentity {
  return {
    deviceId: "daemon-1",
    createdAt: Date.now(),
    ed25519PrivateKeyPem: "priv-ed25519",
    ed25519PublicKeyPem: "pub-ed25519",
    x25519PrivateKeyPem: "priv-x25519",
    x25519PublicKeyPem: "pub-x25519",
    ed25519PublicKeyBase64Url: "pub-ed25519-b64",
    x25519PublicKeyBase64Url: "pub-x25519-b64",
  };
}

function createSessionLookup(agentType: AgentType = "claude_code") {
  return {
    get(sessionId: string) {
      if (sessionId !== "sess-1") {
        return undefined;
      }

      return {
        sessionId,
        workspacePath: "/tmp/workspace",
        agentType,
        seq: 0,
        createdAt: Date.now(),
      };
    },
  };
}

describe("daemon catalog service", () => {
  it("routes templates.list to the app with the default template set", async () => {
    const sent: Message[] = [];
    const router = createDaemonMessageRouter({
      identity: createIdentity(),
      catalog: new DaemonCatalogService(),
    });

    await router(
      {
        v: 1,
        id: "templates-1",
        type: "templates.list",
        payload: {},
      },
      {
        sendMessage(message: Message) {
          sent.push(message);
        },
      } as any,
    );

    expect(sent).toEqual([
      {
        v: 1,
        id: "templates-1",
        type: "templates.list",
        payload: {
          templates: [
            {
              id: "t1",
              label: "git status",
              text: "git status",
            },
            {
              id: "t2",
              label: "跑测试",
              text: "运行所有测试并报告结果",
            },
            {
              id: "t3",
              label: "最近提交",
              text: "查看最近 5 个 git commit",
            },
            {
              id: "t4",
              label: "列目录",
              text: "ls -la",
            },
          ],
        },
      },
    ]);
  });

  it("returns agent-specific slash commands for an active session", async () => {
    const sent: Message[] = [];
    const router = createDaemonMessageRouter({
      identity: createIdentity(),
      catalog: new DaemonCatalogService({
        sessions: createSessionLookup("claude_code"),
      }),
    });

    await router(
      {
        v: 1,
        id: "slash-list-1",
        type: "slash.list",
        payload: {
          session_id: "sess-1",
        },
      },
      {
        sendMessage(message: Message) {
          sent.push(message);
        },
      } as any,
    );

    expect(sent).toEqual([
      {
        v: 1,
        id: "slash-list-1",
        type: "slash.list",
        payload: {
          commands: [
            {
              name: "clear",
              desc: "清空当前会话上下文",
            },
            {
              name: "compact",
              desc: "压缩历史，只保留摘要",
            },
            {
              name: "init",
              desc: "初始化项目记忆文件",
            },
            {
              name: "model",
              desc: "切换模型",
            },
          ],
        },
      },
    ]);
  });

  it("returns SESSION_NOT_FOUND when slash.list targets an unknown session", async () => {
    const sent: Message[] = [];
    const router = createDaemonMessageRouter({
      identity: createIdentity(),
      catalog: new DaemonCatalogService({
        sessions: createSessionLookup("shell"),
      }),
    });

    await router(
      {
        v: 1,
        id: "slash-list-missing",
        type: "slash.list",
        payload: {
          session_id: "missing-session",
        },
      },
      {
        sendMessage(message: Message) {
          sent.push(message);
        },
      } as any,
    );

    expect(sent).toEqual([
      {
        v: 1,
        type: "error",
        payload: {
          request_id: "slash-list-missing",
          code: "SESSION_NOT_FOUND",
          message: "Session not found: missing-session",
        },
      },
    ]);
  });

  it("returns an explicit protocol error for session.agent.add until M5 lands", async () => {
    const sent: Message[] = [];
    const router = createDaemonMessageRouter({
      identity: createIdentity(),
    });

    await router(
      {
        v: 1,
        id: "agent-add-1",
        type: "session.agent.add",
        payload: {
          session_id: "sess-1",
          agent_id: "agent-2",
          agent_type: "codex",
        },
      },
      {
        sendMessage(message: Message) {
          sent.push(message);
        },
      } as any,
    );

    expect(sent).toEqual([
      {
        v: 1,
        type: "error",
        payload: {
          request_id: "agent-add-1",
          code: "PROTOCOL_VERSION",
          message: "session.agent.add is not implemented yet",
        },
      },
    ]);
  });
});

describe("daemon slash normalization", () => {
  it("adds the leading slash for app-style commands before reaching Claude-like runtimes", async () => {
    const slashInputs: Array<{ command: string; args: string[] }> = [];
    const runtimeFactory = vi.fn((): SessionRuntime => ({
      async start() {},
      async input() {},
      async inputImage() {},
      async inputVoiceText() {},
      async inputSlashCommand(command, args) {
        slashInputs.push({ command, args });
      },
      async inputPty() {},
      async resizePty() {},
      async cancel() {},
    }));

    const manager = new DaemonSessionManager({
      sendMessage() {},
      runtimeFactory,
      allowedPaths: ["/tmp/workspace"],
    });

    await manager.startSession({
      v: 1,
      id: "start-1",
      type: "session.start",
      payload: {
        session_id: "sess-1",
        agent_type: "claude_code",
        workspace_path: "/tmp/workspace",
        resume_session_id: null,
      },
    });

    await manager.handleSlashCommand({
      v: 1,
      id: "slash-1",
      type: "session.command.slash",
      payload: {
        session_id: "sess-1",
        command: "compact",
        args: ["focus"],
      },
    });

    expect(slashInputs).toEqual([
      {
        command: "/compact",
        args: ["focus"],
      },
    ]);
  });
});
