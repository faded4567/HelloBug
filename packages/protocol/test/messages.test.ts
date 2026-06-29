import { describe, expect, it } from "vitest";

import {
  createEnvelopeSigningPayload,
  validateEnvelope,
} from "../src/envelope.js";
import {
  validateMessage,
  validateNotificationPushPayload,
} from "../src/messages.js";

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
        session_id: "sess-1",
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

  it("accepts empty fs.file chunks for zero-byte files", () => {
    const message = validateMessage({
      type: "fs.file",
      payload: {
        session_id: "sess-1",
        file_path: "README.md",
        status: "ready",
        mime_type: "text/markdown",
        chunk_index: 0,
        total_chunks: 1,
        data: "",
        total_size: 0,
      },
    });

    expect(message.type).toBe("fs.file");
    if (message.type !== "fs.file") {
      throw new Error("expected fs.file");
    }
    expect(message.payload.data).toBe("");
    expect(message.payload.total_size).toBe(0);
  });

  it("accepts fs.file metadata-only states for binary and oversized files", () => {
    const binary = validateMessage({
      type: "fs.file",
      payload: {
        session_id: "sess-1",
        file_path: "logo.png",
        status: "binary",
        mime_type: "application/octet-stream",
        total_size: 4096,
        message: "Binary file cannot be previewed as text: logo.png",
      },
    });
    const tooLarge = validateMessage({
      type: "fs.file",
      payload: {
        session_id: "sess-1",
        file_path: "huge.log",
        status: "too_large",
        mime_type: "text/plain",
        total_size: 2_000_000,
        max_preview_size: 1_048_576,
        message: "File is too large to preview: huge.log",
      },
    });

    expect(binary.type).toBe("fs.file");
    if (binary.type !== "fs.file") {
      throw new Error("expected fs.file");
    }
    expect(binary.payload.status).toBe("binary");

    expect(tooLarge.type).toBe("fs.file");
    if (tooLarge.type !== "fs.file") {
      throw new Error("expected fs.file");
    }
    expect(tooLarge.payload.status).toBe("too_large");
  });

  it("accepts pty.input frames with base64 payload bytes", () => {
    const message = validateMessage({
      type: "pty.input",
      payload: {
        session_id: "sess-pty-1",
        data: Buffer.from("ls -la\r", "utf8").toString("base64"),
      },
    });

    expect(message.type).toBe("pty.input");
    if (message.type !== "pty.input") {
      throw new Error("expected pty.input");
    }
    expect(message.payload.session_id).toBe("sess-pty-1");
  });

  it("accepts session.start with an empty workspace to request daemon default workspace", () => {
    const message = validateMessage({
      type: "session.start",
      payload: {
        session_id: "sess-default-workspace",
        agent_type: "claude_code",
        workspace_path: "",
        resume_session_id: null,
      },
    });

    expect(message.type).toBe("session.start");
    if (message.type !== "session.start") {
      throw new Error("expected session.start");
    }
    expect(message.payload.workspace_path).toBe("");
  });

  it("accepts structured session.start.result outcomes", () => {
    const started = validateMessage({
      type: "session.start.result",
      payload: {
        request_id: "req-start-1",
        session_id: "sess-1",
        agent_type: "shell",
        workspace_path: "/tmp/workspace",
        status: "started",
        message: "Session started",
      },
    });
    const rejected = validateMessage({
      type: "session.start.result",
      payload: {
        request_id: "req-start-2",
        session_id: "sess-2",
        agent_type: "claude_code",
        workspace_path: "/outside",
        status: "rejected",
        code: "WORKSPACE_FORBIDDEN",
        message: "Workspace is outside allowed paths",
      },
    });

    expect(started.type).toBe("session.start.result");
    if (started.type !== "session.start.result") {
      throw new Error("expected session.start.result");
    }
    expect(started.payload.status).toBe("started");

    expect(rejected.type).toBe("session.start.result");
    if (rejected.type !== "session.start.result") {
      throw new Error("expected session.start.result");
    }
    expect(rejected.payload.status).toBe("rejected");
    if (rejected.payload.status !== "rejected") {
      throw new Error("expected rejected start result");
    }
    expect(rejected.payload.code).toBe("WORKSPACE_FORBIDDEN");
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

  it("accepts device management request and response variants", () => {
    const listRequest = validateMessage({
      type: "device.list",
      payload: {},
    });
    const listResponse = validateMessage({
      type: "device.list",
      payload: {
        devices: [
          {
            device_id: "daemon-1",
            machine_name: "MacBook Pro",
            os: "darwin",
            daemon_version: "0.1.0",
            online: true,
            paired_at: 1718956800000,
            last_seen_at: 1718956805000,
            revoked_at: null,
            active_session_count: 2,
          },
        ],
      },
    });
    const rename = validateMessage({
      type: "device.rename",
      payload: {
        device_id: "daemon-1",
        machine_name: "Office Mac",
      },
    });
    const revoke = validateMessage({
      type: "device.revoke",
      payload: {
        device_id: "daemon-1",
        mode: "revoke",
      },
    });

    expect(listRequest.type).toBe("device.list");
    expect(listResponse.type).toBe("device.list");
    expect(rename.type).toBe("device.rename");
    expect(revoke.type).toBe("device.revoke");
  });

  it("accepts workspace discovery request and response variants", () => {
    const listRequest = validateMessage({
      type: "workspace.list",
      payload: {},
    });
    const listResponse = validateMessage({
      type: "workspace.list",
      payload: {
        default_path: "/tmp/work",
        items: [
          {
            path: "/tmp/work",
            name: "work",
            status: "ready",
            status_reason: "ok",
            is_default: true,
            entry_count: 3,
            is_empty: false,
            repo_root: "/tmp/work",
            git_branch: "main",
            access_mode: "read_write",
          },
        ],
      },
    });
    const resolveRequest = validateMessage({
      type: "workspace.resolve",
      payload: {
        workspace_path: "",
      },
    });
    const resolveResponse = validateMessage({
      type: "workspace.resolve",
      payload: {
        workspace_path: "",
        resolved_path: "/tmp/work",
        name: "work",
        status: "ready",
        status_reason: "ok",
        is_default: true,
        entry_count: 3,
        is_empty: false,
        repo_root: "/tmp/work",
        git_branch: "main",
        access_mode: "read_write",
      },
    });
    const resolveMissing = validateMessage({
      type: "workspace.resolve",
      payload: {
        workspace_path: "/tmp/work-old/src",
        resolved_path: "/tmp/work-old/src",
        name: "src",
        status: "missing",
        status_reason: "not_found",
        is_default: false,
        entry_count: null,
        is_empty: null,
        repo_root: null,
        git_branch: null,
        access_mode: "unknown",
        repair_hint: {
          reason: "nearest_existing_ancestor",
          suggested_path: "/tmp",
          message:
            "Requested path is unavailable. Try the nearest existing directory instead.",
        },
      },
    });

    expect(listRequest.type).toBe("workspace.list");
    expect(listResponse.type).toBe("workspace.list");
    expect(resolveRequest.type).toBe("workspace.resolve");
    expect(resolveResponse.type).toBe("workspace.resolve");
    expect(resolveMissing.type).toBe("workspace.resolve");
  });

  it("accepts session-scoped slash.list responses and danger approvals", () => {
    const slash = validateMessage({
      type: "slash.list",
      payload: {
        session_id: "sess-1",
        commands: [
          {
            name: "compact",
            desc: "Compress history",
          },
        ],
      },
    });
    const dangerAllow = validateMessage({
      type: "danger.allow",
      payload: {
        session_id: "sess-1",
        danger_id: "danger-1",
        biometric_verified: true,
      },
    });
    const error = validateMessage({
      type: "error",
      payload: {
        request_id: "req-1",
        session_id: "sess-1",
        code: "SESSION_NOT_FOUND",
        message: "missing",
      },
    });

    expect(slash.type).toBe("slash.list");
    expect(dangerAllow.type).toBe("danger.allow");
    expect(error.type).toBe("error");
  });

  it("accepts structured danger result outcomes", () => {
    const result = validateMessage({
      type: "danger.result",
      payload: {
        danger_id: "danger-1",
        session_id: "sess-1",
        status: "timed_out",
        message: "Danger approval timed out",
      },
    });

    expect(result.type).toBe("danger.result");
    if (result.type !== "danger.result") {
      throw new Error("expected danger.result");
    }
    expect(result.payload.status).toBe("timed_out");
  });

  it("accepts structured replay.done outcomes", () => {
    const result = validateMessage({
      type: "replay.done",
      payload: {
        session_id: "sess-1",
        replayed_count: 2,
        current_seq: 4,
        status: "ok",
        message: "Replay complete",
      },
    });

    expect(result.type).toBe("replay.done");
    if (result.type !== "replay.done") {
      throw new Error("expected replay.done");
    }
    expect(result.payload.status).toBe("ok");
  });

  it("accepts pairing handshake payloads on SAS and confirm messages", () => {
    const sas = validateMessage({
      type: "device.pair.sas",
      payload: {
        sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
        noise_handshake: "noise-message-1",
        daemon_pubkey: "daemon-pubkey",
        daemon_ed25519_pubkey: "daemon-ed25519-pubkey",
        machine_name: "CI-Mac",
        os: "darwin",
      },
    });
    const confirm = validateMessage({
      type: "device.pair.confirm",
      payload: {
        confirmed: true,
        noise_handshake: "noise-message-2",
      },
    });

    expect(sas.type).toBe("device.pair.sas");
    expect(confirm.type).toBe("device.pair.confirm");
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

  it("accepts push.trigger runtime messages for daemon initiated push hints", () => {
    const message = validateMessage({
      type: "push.trigger",
      payload: {
        session_id: "sess-push-1",
        event_type: "danger_pending",
      },
    });

    expect(message.type).toBe("push.trigger");
    if (message.type !== "push.trigger") {
      throw new Error("expected push.trigger");
    }
    expect(message.payload.session_id).toBe("sess-push-1");
    expect(message.payload.event_type).toBe("danger_pending");
  });

  it("builds a stable signing payload for envelopes", () => {
    const envelope = validateEnvelope({
      from: "app-1",
      to: "",
      session_id: "",
      seq: 1,
      ts: 1718956800000,
      sig: "signature",
      ciphertext: "eyJ0eXBlIjoiYXV0aC5hdHRhY2gifQ",
    });

    expect(
      Buffer.from(createEnvelopeSigningPayload(envelope)).toString("utf8"),
    ).toBe(
      '["app-1","","",1,1718956800000,"eyJ0eXBlIjoiYXV0aC5hdHRhY2gifQ","","","","",""]',
    );
  });

  it("includes routing metadata in the stable signing payload when present", () => {
    const envelope = validateEnvelope({
      from: "app-1",
      to: "daemon-1",
      session_id: "sess-1",
      seq: 9,
      ts: 1718956800001,
      sig: "signature",
      ciphertext: "ciphertext",
      message_type: "session.start",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "sender-pubkey",
    });

    expect(
      Buffer.from(createEnvelopeSigningPayload(envelope)).toString("utf8"),
    ).toBe(
      '["app-1","daemon-1","sess-1",9,1718956800001,"ciphertext","session.start","noise_static_v1","sender-pubkey","",""]',
    );
  });

  it("includes routing_payload in the stable signing payload when present", () => {
    const envelope = validateEnvelope({
      from: "app-1",
      to: "",
      session_id: "sess-2",
      seq: 5,
      ts: 1718956800002,
      sig: "signature",
      ciphertext: "ciphertext",
      message_type: "session.resume",
      cipher_mode: "noise_static_v1",
      request_id: "resume-1",
      routing_payload: "eyJsYXN0X3NlcSI6Mn0",
    });

    expect(
      Buffer.from(createEnvelopeSigningPayload(envelope)).toString("utf8"),
    ).toBe(
      '["app-1","","sess-2",5,1718956800002,"ciphertext","session.resume","noise_static_v1","","resume-1","eyJsYXN0X3NlcSI6Mn0"]',
    );
  });

  it("requires session_id on key ratchet control messages", () => {
    const ratchet = validateMessage({
      type: "key.ratchet",
      payload: {
        session_id: "sess-ratchet-1",
        next_pubkey: "next-pubkey",
      },
    });
    const ack = validateMessage({
      type: "key.ratchet_ack",
      payload: {
        session_id: "sess-ratchet-1",
      },
    });

    expect(ratchet.type).toBe("key.ratchet");
    expect(ack.type).toBe("key.ratchet_ack");
  });
});
