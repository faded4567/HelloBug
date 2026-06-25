import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Message } from "@hellobug/protocol";
import { describe, expect, it } from "vitest";

import type { DeviceIdentity } from "../src/crypto/keys.js";
import { DaemonTranscriptService } from "../src/history/transcripts.js";
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

describe("daemon transcript service", () => {
  it("lists transcript files for an allowed workspace", async () => {
    const fixture = await createTranscriptFixture();
    const service = new DaemonTranscriptService({
      allowedPaths: [fixture.workspaceRoot],
      claudeProjectsDir: fixture.claudeProjectsDir,
    });

    const response = await service.handleListRequest({
      v: 1,
      id: "history-list-1",
      type: "history.list",
      payload: {
        workspace_path: fixture.workspaceRoot,
      },
    });

    expect(response).toMatchObject({
      type: "history.list",
      payload: {
        items: [
          {
            session_id: "sess-new",
            message_count: 2,
          },
          {
            session_id: "sess-old",
            message_count: 3,
          },
        ],
      },
    });
    expect(response.payload.items.map((item) => item.session_id)).toEqual([
      "sess-new",
      "sess-old",
    ]);
    expect(response.payload.items[0]?.path).toContain("sess-new.jsonl");
    expect(response.payload.items[0]?.created_at).toBe(Date.parse("2026-06-24T02:00:00.000Z"));
  });

  it("returns raw JSONL lines with offset and total", async () => {
    const fixture = await createTranscriptFixture();
    const service = new DaemonTranscriptService({
      allowedPaths: [fixture.workspaceRoot],
      claudeProjectsDir: fixture.claudeProjectsDir,
    });

    const response = await service.handleGetRequest({
      v: 1,
      id: "history-get-1",
      type: "history.get",
      payload: {
        session_id: "sess-old",
        offset: 1,
        limit: 2,
      },
    });

    expect(response).toEqual({
      v: 1,
      type: "history.get",
      payload: {
        session_id: "sess-old",
        offset: 1,
        total: 3,
        lines: [
          JSON.stringify({
            type: "assistant",
            timestamp: "2026-06-23T01:00:01.000Z",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "pong" }],
            },
            sessionId: "sess-old",
          }),
          JSON.stringify({
            type: "result",
            timestamp: "2026-06-23T01:00:02.000Z",
            sessionId: "sess-old",
          }),
        ],
      },
    });
  });

  it("returns a session not found error for unknown transcripts", async () => {
    const fixture = await createTranscriptFixture();
    const sent: Message[] = [];
    const service = new DaemonTranscriptService({
      allowedPaths: [fixture.workspaceRoot],
      claudeProjectsDir: fixture.claudeProjectsDir,
    });
    const router = createDaemonMessageRouter({
      identity: createIdentity(),
      history: service,
    });

    await router(
      {
        v: 1,
        id: "history-get-missing",
        type: "history.get",
        payload: {
          session_id: "missing-session",
          offset: 0,
          limit: 50,
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
          request_id: "history-get-missing",
          session_id: "missing-session",
          code: "SESSION_NOT_FOUND",
          message: expect.stringContaining("missing-session"),
        },
      },
    ]);
  });
});

async function createTranscriptFixture() {
  const root = await mkdtemp(join(tmpdir(), "hellobug-history-"));
  const claudeProjectsDir = join(root, ".claude-projects");
  const workspaceRoot = join(root, "workspace-a");
  const otherWorkspaceRoot = join(root, "workspace-b");
  await mkdir(claudeProjectsDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(otherWorkspaceRoot, { recursive: true });

  const workspaceTranscriptDir = join(
    claudeProjectsDir,
    workspaceRoot.replace(/[\\/]/g, "-"),
  );
  const otherTranscriptDir = join(
    claudeProjectsDir,
    otherWorkspaceRoot.replace(/[\\/]/g, "-"),
  );
  await mkdir(join(workspaceTranscriptDir, "memory"), { recursive: true });
  await mkdir(otherTranscriptDir, { recursive: true });

  await writeFile(
    join(workspaceTranscriptDir, "sess-old.jsonl"),
    [
      {
        type: "user",
        timestamp: "2026-06-23T01:00:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "ping" }],
        },
        sessionId: "sess-old",
      },
      {
        type: "assistant",
        timestamp: "2026-06-23T01:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "pong" }],
        },
        sessionId: "sess-old",
      },
      {
        type: "result",
        timestamp: "2026-06-23T01:00:02.000Z",
        sessionId: "sess-old",
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );

  await writeFile(
    join(workspaceTranscriptDir, "sess-new.jsonl"),
    [
      {
        type: "queue-operation",
        timestamp: "2026-06-24T02:00:00.000Z",
        sessionId: "sess-new",
      },
      {
        type: "assistant",
        timestamp: "2026-06-24T02:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
        },
        sessionId: "sess-new",
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );

  await writeFile(
    join(otherTranscriptDir, "sess-other.jsonl"),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-06-24T03:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hidden" }],
      },
      sessionId: "sess-other",
    }),
  );

  return {
    claudeProjectsDir,
    workspaceRoot,
  };
}
