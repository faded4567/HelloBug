import { describe, expect, it } from "vitest";

import { validateEnvelope } from "../src/envelope.js";
import { validateMessage, validateNotificationPushPayload } from "../src/messages.js";

describe("protocol message validation", () => {
  it("accepts a session.event with M5 agent attribution", () => {
    const message = validateMessage({
      type: "session.event",
      payload: {
        session_id: "sess-1",
        agent_id: "agent-1",
        agent_type: "codex",
        seq: 42,
        event: {
          event_type: "tool.use",
          tool_name: "Read",
          tool_input: { file_path: "src/index.ts" },
          tool_use_id: "tool-1",
        },
      },
    });

    expect(message.type).toBe("session.event");
    if (message.type !== "session.event") {
      throw new Error("expected session.event");
    }
    expect(message.payload.agent_type).toBe("codex");
  });

  it("requires target_agent_id when routing_mode is direct", () => {
    expect(() =>
      validateMessage({
        type: "session.input",
        payload: {
          session_id: "sess-1",
          text: "ping",
          routing_mode: "direct",
        },
      }),
    ).toThrow(/target_agent_id/);
  });

  it("allows nullable modified markers in fs.tree", () => {
    const message = validateMessage({
      type: "fs.tree",
      payload: {
        workspace_path: "/tmp/work",
        dir_path: "src",
        entries: [
          {
            name: "index.ts",
            path: "src/index.ts",
            type: "file",
            modified: null,
            size: 128,
          },
        ],
      },
    });

    expect(message.type).toBe("fs.tree");
    if (message.type !== "fs.tree") {
      throw new Error("expected fs.tree");
    }
    expect(message.payload.entries[0]?.modified).toBeNull();
  });

  it("accepts history.list request and response variants", () => {
    const request = validateMessage({
      type: "history.list",
      payload: {
        workspace_path: "/tmp/work",
      },
    });
    const response = validateMessage({
      type: "history.list",
      payload: {
        items: [
          {
            session_id: "sess-1",
            path: "~/.claude/projects/a.jsonl",
            created_at: 1718956800000,
            message_count: 3,
          },
        ],
      },
    });

    expect(request.type).toBe("history.list");
    expect(response.type).toBe("history.list");
  });

  it("validates push payload separately from runtime websocket messages", () => {
    const payload = validateNotificationPushPayload({
      aps: {
        alert: {
          title: "HelloBug",
          body: "任务已完成",
        },
        sound: "default",
      },
      session_id: "sess-1",
      event_type: "task_done",
    });

    expect(payload.event_type).toBe("task_done");
  });

  it("accepts development envelopes with an empty signature placeholder", () => {
    const envelope = validateEnvelope({
      from: "app-1",
      to: "",
      session_id: "",
      seq: 1,
      ts: 1718956800000,
      sig: "",
      ciphertext: "eyJ0eXBlIjoiYXV0aC5hdHRhY2gifQ",
    });

    expect(envelope.sig).toBe("");
  });
});
