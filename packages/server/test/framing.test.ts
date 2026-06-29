import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  TransportControlSessionId,
  createEnvelopeSigningPayload,
  type Message,
} from "@hellobug/protocol";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { decodeRelayFrame, sendRelayMessage } from "../src/relay/framing.js";

const defaultOpaquePlaceholderTypes = new Set([
  "auth.attach",
  "auth.refresh",
  "daemon.hello",
  "device.pair.ready",
  "device.pair",
  "device.pair.sas",
  "device.pair.confirm",
  "device.push_token",
  "device.list",
  "device.rename",
  "device.revoke",
  "session.resume",
  "session.start",
  "session.agent.add",
  "session.input",
  "session.input.image",
  "session.input.voice_text",
  "session.command.slash",
  "session.cancel",
  "fs.tree.req",
  "fs.file.req",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "history.get",
  "templates.list",
  "slash.list",
  "pty.input",
  "pty.resize",
]);
const transportControlPlaceholderTypes = new Set([
  "auth.attach",
  "auth.refresh",
  "daemon.hello",
  "device.push_token",
  "device.list",
  "device.rename",
  "device.revoke",
  "workspace.list",
  "workspace.resolve",
  "history.list",
  "templates.list",
]);
const encryptedRoutingHintTypes = new Set([
  "session.start",
  "session.start.result",
  "session.event",
  "danger.pending",
  "danger.result",
  "push.trigger",
  "danger.allow",
  "danger.deny",
]);

function createSocketCapture() {
  const sent: unknown[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send(raw: string) {
      sent.push(JSON.parse(raw));
    },
  } as unknown as WebSocket;

  return { socket, sent };
}

function encodeEnvelope(
  message: Record<string, unknown>,
  options: {
    sessionId?: string;
    messageType?: string;
    cipherMode?: "plain" | "noise_static_v1";
    senderPubkey?: string;
    requestId?: string;
    routingPayload?: Record<string, unknown>;
    omitRoutingPayload?: boolean;
    ciphertext?: string;
    legacyOmitOuterMetadata?: boolean;
  } = {},
) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const inferredMessageType =
    typeof message.type === "string" ? message.type : undefined;
  const shouldUseDefaultOpaquePlaceholder =
    !options.legacyOmitOuterMetadata &&
    inferredMessageType !== undefined &&
    defaultOpaquePlaceholderTypes.has(inferredMessageType) &&
    options.cipherMode === undefined &&
    options.ciphertext === undefined &&
    options.routingPayload === undefined;
  const payloadSessionId =
    message.payload &&
    typeof message.payload === "object" &&
    !Array.isArray(message.payload) &&
    typeof (message.payload as { session_id?: unknown }).session_id === "string"
      ? ((message.payload as { session_id: string }).session_id ?? "")
      : "";
  const sessionId =
    options.sessionId ??
    (payloadSessionId.length > 0
      ? payloadSessionId
      : shouldUseDefaultOpaquePlaceholder &&
          inferredMessageType !== undefined &&
          transportControlPlaceholderTypes.has(inferredMessageType)
        ? TransportControlSessionId
        : "");
  const requestId =
    options.requestId ??
    (typeof message.id === "string" ? message.id : undefined);
  const routingPayload =
    options.omitRoutingPayload
      ? undefined
      : options.routingPayload ??
    (shouldUseDefaultOpaquePlaceholder &&
    message.payload &&
    typeof message.payload === "object" &&
    !Array.isArray(message.payload)
      ? (message.payload as Record<string, unknown>)
      : options.cipherMode === "noise_static_v1" &&
            inferredMessageType !== undefined &&
            encryptedRoutingHintTypes.has(inferredMessageType) &&
            message.payload &&
            typeof message.payload === "object" &&
            !Array.isArray(message.payload)
        ? (message.payload as Record<string, unknown>)
      : undefined);
  const ciphertext =
    options.ciphertext ??
    (shouldUseDefaultOpaquePlaceholder
      ? Buffer.from("opaque", "utf8").toString("base64url")
      : Buffer.from(JSON.stringify(message), "utf8").toString("base64url"));
  const envelope = {
    from: "app-device",
    to: "",
    session_id: sessionId,
    seq: 1,
    ts: Date.now(),
    sig: "",
    ciphertext,
    ...(!options.legacyOmitOuterMetadata &&
    (options.messageType ?? inferredMessageType)
      ? {
          message_type: options.messageType ?? inferredMessageType,
        }
      : {}),
    ...(!options.legacyOmitOuterMetadata
      ? {
          cipher_mode:
            options.cipherMode ??
            (shouldUseDefaultOpaquePlaceholder ? "noise_static_v1" : "plain"),
        }
      : {}),
    ...(options.senderPubkey ? { sender_pubkey: options.senderPubkey } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(routingPayload
      ? {
          routing_payload: Buffer.from(
            JSON.stringify(routingPayload),
            "utf8",
          ).toString("base64url"),
        }
      : {}),
  };
  envelope.sig = sign(
    null,
    createEnvelopeSigningPayload(envelope),
    privateKey,
  ).toString("base64url");
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

describe("relay framing compatibility", () => {
  it("rejects legacy fs.tree requests that only provide path", () => {
    const socket = {} as WebSocket;
    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "tree-1",
            type: "fs.tree.req",
            payload: {
              session_id: "sess-1",
              path: "/tmp/workspace/src",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow();
  });

  it("rejects legacy session.start payloads without resume_session_id", () => {
    const socket = {} as WebSocket;
    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "start-1",
            type: "session.start",
            payload: {
              session_id: "sess-1",
              agent_type: "shell",
              workspace_path: "~/project",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow();
  });

  it("rejects legacy slash commands that send args as a single string", () => {
    const socket = {} as WebSocket;
    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "slash-1",
            type: "session.command.slash",
            payload: {
              session_id: "sess-1",
              command: "open",
              args: "src/main.dart  --line  10",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow();
  });

  it("rejects plain messages after a socket has switched to envelope mode", () => {
    const socket = {} as WebSocket;

    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "plain-after-envelope-1",
            type: "workspace.list",
            payload: {},
          }),
          "utf8",
        ),
      ),
    ).toThrow("Relay connection cannot switch from envelopes back to plain messages");
  });

  it("rejects legacy raw session.resume relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "session-resume-legacy-1",
            type: "session.resume",
            payload: {
              session_id: "sess-legacy-1",
              last_seq: 3,
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for session.resume",
    );
  });

  it("rejects legacy raw auth.attach relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "auth-attach-legacy-1",
            type: "auth.attach",
            payload: {
              jwt: "token",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for auth.attach",
    );
  });

  it("rejects legacy raw auth.refresh relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "auth-refresh-legacy-1",
            type: "auth.refresh",
            payload: {
              jwt: "token",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for auth.refresh",
    );
  });

  it("rejects legacy raw daemon.hello relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "daemon-hello-legacy-1",
            type: "daemon.hello",
            payload: {
              device_id: "daemon-device-legacy-1",
              daemon_version: "0.1.0",
              supported_features: ["e2ee_noise_ik", "multi_session"],
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for daemon.hello",
    );
  });

  it("rejects legacy raw session.start relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "session-start-legacy-1",
            type: "session.start",
            payload: {
              session_id: "sess-legacy-1",
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for session.start",
    );
  });

  it("rejects legacy raw session.input relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "session-input-legacy-1",
            type: "session.input",
            payload: {
              session_id: "sess-input-legacy-1",
              text: "legacy input",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for session.input",
    );
  });

  it("rejects legacy raw danger.allow relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "danger-allow-legacy-1",
            type: "danger.allow",
            payload: {
              session_id: "sess-danger-legacy-1",
              danger_id: "danger-legacy-1",
              biometric_verified: true,
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for danger.allow",
    );
  });

  it("rejects legacy raw key.ratchet relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "ratchet-legacy-1",
            type: "key.ratchet",
            payload: {
              session_id: "sess-ratchet-legacy-1",
              next_pubkey: "next-pubkey",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for key.ratchet",
    );
  });

  it("rejects legacy raw history.get relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "history-get-legacy-1",
            type: "history.get",
            payload: {
              session_id: "sess-history-legacy-1",
              offset: 0,
              total: 1,
              lines: ['{"type":"assistant","message":"hello"}'],
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for history.get",
    );
  });

  it("rejects legacy raw workspace.list relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "workspace-list-legacy-1",
            type: "workspace.list",
            payload: {},
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for workspace.list",
    );
  });

  it("rejects legacy raw danger.pending relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            type: "danger.pending",
            payload: {
              danger_id: "danger-legacy-1",
              session_id: "sess-danger-legacy-1",
              agent_id: null,
              agent_type: null,
              command: "rm -rf /tmp/demo",
              tool_name: "bash",
              rule_matched: "dangerous bash",
              workspace: "/tmp/workspace",
              timeout_at: Date.now() + 60_000,
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for danger.pending",
    );
  });

  it("rejects legacy raw danger.result relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            type: "danger.result",
            payload: {
              danger_id: "danger-legacy-result-1",
              session_id: "sess-danger-legacy-result-1",
              status: "timed_out",
              message: "Danger approval timed out",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for danger.result",
    );
  });

  it("rejects legacy raw session.start.result relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            type: "session.start.result",
            payload: {
              request_id: "session-start-result-legacy-1",
              session_id: "sess-start-result-legacy-1",
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              status: "started",
              message: "legacy started",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for session.start.result",
    );
  });

  it("rejects legacy raw replay.done relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            type: "replay.done",
            payload: {
              session_id: "sess-replay-legacy-1",
              replayed_count: 0,
              current_seq: 4,
              status: "ok",
              message: "Replay complete",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for replay.done",
    );
  });

  it("rejects legacy raw error relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            type: "error",
            payload: {
              request_id: "error-legacy-1",
              session_id: "sess-error-legacy-1",
              code: "SESSION_NOT_FOUND",
              message: "legacy error",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow("Legacy raw relay messages are no longer allowed for error");
  });

  it("rejects legacy raw fs.tree relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "fs-tree-legacy-1",
            type: "fs.tree",
            payload: {
              session_id: "sess-fs-tree-legacy-1",
              workspace_path: "/tmp/workspace",
              dir_path: "",
              entries: [],
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for fs.tree",
    );
  });

  it("rejects legacy raw fs.file relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "fs-file-legacy-1",
            type: "fs.file",
            payload: {
              session_id: "sess-fs-file-legacy-1",
              file_path: "/tmp/workspace/README.md",
              status: "ready",
              mime_type: "text/markdown",
              chunk_index: 0,
              total_chunks: 1,
              data: Buffer.from("# HelloBug\n", "utf8").toString("base64url"),
              total_size: 11,
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for fs.file",
    );
  });

  it("rejects legacy raw slash.list relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "slash-list-legacy-1",
            type: "slash.list",
            payload: {
              session_id: "sess-slash-legacy-1",
              commands: [],
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for slash.list",
    );
  });

  it("rejects legacy raw session.event relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "session-event-legacy-1",
            type: "session.event",
            payload: {
              session_id: "sess-event-legacy-1",
              agent_id: null,
              agent_type: null,
              seq: 1,
              event: {
                event_type: "assistant.delta",
                text: "legacy raw event",
              },
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for session.event",
    );
  });

  it("rejects legacy raw device.pair relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "pair-legacy-1",
            type: "device.pair",
            payload: {
              pairing_code: "428791",
              server_url: "ws://127.0.0.1:3000/v1/relay",
              app_pubkey: "app-pub-key",
              app_ed25519_pubkey: "app-ed25519-pub-key",
              app_device_name: "Legacy App",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for device.pair",
    );
  });

  it("rejects legacy raw device.pair.confirm relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "pair-confirm-legacy-1",
            type: "device.pair.confirm",
            payload: {
              confirmed: true,
              noise_handshake: "noise-message-2",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for device.pair.confirm",
    );
  });

  it("rejects legacy raw device.pair.ready relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            type: "device.pair.ready",
            payload: {
              pairing_id: "pairing-legacy-1",
              pairing_code: "428791",
              expires_at: Date.now() + 30_000,
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for device.pair.ready",
    );
  });

  it("rejects legacy raw device.pair.sas relay messages", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            v: 1,
            id: "pair-sas-legacy-1",
            type: "device.pair.sas",
            payload: {
              sas: ["🐢", "🪐", "🍵", "🎷", "🌙"],
              noise_handshake: "noise-message-1",
              daemon_pubkey: "daemon-pub-key",
              daemon_ed25519_pubkey: "daemon-ed25519-pub-key",
              machine_name: "Legacy Mac",
              os: "darwin",
            },
          }),
          "utf8",
        ),
      ),
    ).toThrow(
      "Legacy raw relay messages are no longer allowed for device.pair.sas",
    );
  });

  it("rejects envelope messages whose seq does not strictly increase", () => {
    const socket = {} as WebSocket;

    decodeRelayFrame(socket, encodeEnvelope({
      v: 1,
      id: "auth-1",
      type: "auth.attach",
      payload: {
        jwt: "token",
      },
    }));

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope({
          v: 1,
          id: "auth-2",
          type: "auth.refresh",
          payload: {
            jwt: "token-2",
          },
        }),
      ),
    ).toThrow("Envelope seq must strictly increase");
  });

  it("rejects legacy plain envelopes without outer metadata", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "auth-attach-legacy-envelope-1",
            type: "auth.attach",
            payload: {
              jwt: "token",
            },
          },
          {
            sessionId: TransportControlSessionId,
            requestId: "auth-attach-legacy-envelope-1",
            legacyOmitOuterMetadata: true,
          },
        ),
      ),
    ).toThrow(
      "Legacy plain envelopes without outer metadata are no longer allowed for auth.attach",
    );
  });

  it("rejects legacy plain workspace.list envelopes without outer metadata", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "workspace-list-legacy-envelope-1",
            type: "workspace.list",
            payload: {},
          },
          {
            sessionId: TransportControlSessionId,
            requestId: "workspace-list-legacy-envelope-1",
            legacyOmitOuterMetadata: true,
          },
        ),
      ),
    ).toThrow(
      "Legacy plain envelopes without outer metadata are no longer allowed for workspace.list",
    );
  });

  it("rejects legacy plain session.start envelopes without outer metadata", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "session-start-legacy-envelope-1",
            type: "session.start",
            payload: {
              session_id: "session-legacy-1",
              agent_type: "claude_code",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
          {
            sessionId: "session-legacy-1",
            requestId: "session-start-legacy-envelope-1",
            legacyOmitOuterMetadata: true,
          },
        ),
      ),
    ).toThrow(
      "Legacy plain envelopes without outer metadata are no longer allowed for session.start",
    );
  });

  it("rejects legacy plain danger.allow envelopes without outer metadata", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "danger-allow-legacy-envelope-1",
            type: "danger.allow",
            payload: {
              session_id: "session-legacy-danger-1",
              danger_id: "danger-legacy-1",
              biometric_verified: true,
            },
          },
          {
            sessionId: "session-legacy-danger-1",
            requestId: "danger-allow-legacy-envelope-1",
            legacyOmitOuterMetadata: true,
          },
        ),
      ),
    ).toThrow(
      "Legacy plain envelopes without outer metadata are no longer allowed for danger.allow",
    );
  });

  it("rejects legacy plain session.event envelopes without outer metadata", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "session-event-legacy-envelope-1",
            type: "session.event",
            payload: {
              session_id: "session-event-legacy-1",
              agent_id: null,
              agent_type: null,
              seq: 1,
              event: {
                event_type: "assistant.delta",
                text: "hello",
              },
            },
          },
          {
            sessionId: "session-event-legacy-1",
            requestId: "session-event-legacy-envelope-1",
            legacyOmitOuterMetadata: true,
          },
        ),
      ),
    ).toThrow(
      "Legacy plain envelopes without outer metadata are no longer allowed for session.event",
    );
  });

  it("rejects legacy plain error envelopes without outer metadata", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "error-legacy-envelope-1",
            type: "error",
            payload: {
              request_id: "error-legacy-envelope-1",
              session_id: null,
              code: "PROTOCOL_VERSION",
              message: "legacy error envelope",
            },
          },
          {
            sessionId: TransportControlSessionId,
            requestId: "error-legacy-envelope-1",
            legacyOmitOuterMetadata: true,
          },
        ),
      ),
    ).toThrow(
      "Legacy plain envelopes without outer metadata are no longer allowed for error",
    );
  });

  it("rejects plain envelopes whose outer message_type does not match the inner message", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "workspace-list-mismatch-1",
            type: "workspace.list",
            payload: {},
          },
          {
            sessionId: TransportControlSessionId,
            requestId: "workspace-list-mismatch-1",
            messageType: "history.list",
            cipherMode: "plain",
          },
        ),
      ),
    ).toThrow(
      "Envelope message_type does not match inner message type for workspace.list",
    );
  });

  it("rejects plaintext downgrade for auth.attach metadata envelopes", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "auth-attach-plain-1",
            type: "auth.attach",
            payload: {
              jwt: "token",
            },
          },
          {
            sessionId: TransportControlSessionId,
            requestId: "auth-attach-plain-1",
            messageType: "auth.attach",
            cipherMode: "plain",
          },
        ),
      ),
    ).toThrow("Envelope plaintext downgrade is not allowed for auth.attach");
  });

  it("rejects plaintext downgrade for session.resume metadata envelopes", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "resume-plain-1",
            type: "session.resume",
            payload: {
              session_id: "sess-plain-1",
              last_seq: 4,
            },
          },
          {
            sessionId: "sess-plain-1",
            requestId: "resume-plain-1",
            messageType: "session.resume",
            cipherMode: "plain",
          },
        ),
      ),
    ).toThrow("Envelope plaintext downgrade is not allowed for session.resume");
  });

  it("rejects plaintext downgrade for session.start metadata envelopes", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "start-plain-1",
            type: "session.start",
            payload: {
              session_id: "sess-start-plain-1",
              agent_type: "claude_code",
              workspace_path: "~/project",
              resume_session_id: null,
            },
          },
          {
            sessionId: "sess-start-plain-1",
            requestId: "start-plain-1",
            messageType: "session.start",
            cipherMode: "plain",
          },
        ),
      ),
    ).toThrow("Envelope plaintext downgrade is not allowed for session.start");
  });

  it("rejects plaintext downgrade for history.get metadata envelopes", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "history-get-plain-1",
            type: "history.get",
            payload: {
              session_id: "sess-history-plain-1",
              offset: 0,
              limit: 100,
            },
          },
          {
            sessionId: "sess-history-plain-1",
            requestId: "history-get-plain-1",
            messageType: "history.get",
            cipherMode: "plain",
          },
        ),
      ),
    ).toThrow("Envelope plaintext downgrade is not allowed for history.get");
  });

  it("rejects plaintext downgrade for key.ratchet metadata envelopes", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "ratchet-plain-1",
            type: "key.ratchet",
            payload: {
              session_id: "sess-ratchet-1",
              next_pubkey: "next-pubkey",
            },
          },
          {
            sessionId: "sess-ratchet-1",
            requestId: "ratchet-plain-1",
            messageType: "key.ratchet",
            cipherMode: "plain",
          },
        ),
      ),
    ).toThrow("Envelope plaintext downgrade is not allowed for key.ratchet");
  });

  it("forwards fs.tree without legacy file-tree compatibility fields", () => {
    const { socket, sent } = createSocketCapture();

    sendRelayMessage(socket, {
      v: 1,
      id: "tree-2",
      type: "fs.tree",
      payload: {
        session_id: "sess-tree-1",
        workspace_path: "/tmp/workspace",
        dir_path: "src",
        entries: [
          {
            name: "lib",
            path: "src/lib",
            type: "dir",
            modified: null,
            size: 0,
          },
          {
            name: "index.ts",
            path: "src/index.ts",
            type: "file",
            modified: true,
            size: 128,
          },
        ],
      },
    });

    expect(sent).toEqual([
      {
        v: 1,
        id: "tree-2",
        type: "fs.tree",
        payload: {
          session_id: "sess-tree-1",
          workspace_path: "/tmp/workspace",
          dir_path: "src",
          entries: [
            {
              name: "lib",
              path: "src/lib",
              type: "dir",
              modified: null,
              size: 0,
            },
            {
              name: "index.ts",
              path: "src/index.ts",
              type: "file",
              modified: true,
              size: 128,
            },
          ],
        },
      },
    ]);
  });

  it("forwards fs.file using the formal base64url payload", () => {
    const { socket, sent } = createSocketCapture();

    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sent.length = 0;
    sendRelayMessage(socket, {
      v: 1,
      id: "file-1",
      type: "fs.file",
      payload: {
        session_id: "sess-file-1",
        file_path: "/tmp/workspace/README.md",
        status: "ready",
        mime_type: "text/markdown",
        chunk_index: 0,
        total_chunks: 1,
        data: Buffer.from("# HelloBug\n", "utf8").toString("base64url"),
        total_size: 11,
      },
    });

    expect(sent).toHaveLength(1);
    const envelope = sent[0] as {
      ciphertext: string;
    };
    const inner = JSON.parse(
      Buffer.from(envelope.ciphertext, "base64url").toString("utf8"),
    ) as Message & {
      payload: {
        data?: string;
      };
    };

    expect(inner.type).toBe("fs.file");
    expect(inner.payload.session_id).toBe("sess-file-1");
    expect(inner.payload.data).toBe(
      Buffer.from("# HelloBug\n", "utf8").toString("base64url"),
    );
  });

  it("reuses the original envelope when forwarding compatible envelope traffic", () => {
    const { socket, sent } = createSocketCapture();
    const raw = encodeEnvelope({
      v: 1,
      id: "pair-1",
      type: "device.pair",
      payload: {
        pairing_code: "123456",
        server_url: "ws://relay",
        app_pubkey: "app-pub-key",
        app_ed25519_pubkey: "app-ed25519-pub-key",
        app_device_name: "Test iPhone",
      },
    });

    const decoded = decodeRelayFrame(socket, raw);
    expect(decoded.forwardEnvelope).toBeTruthy();

    sendRelayMessage(socket, decoded.message, {
      to: "daemon-1",
      sourceEnvelope: decoded.forwardEnvelope,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(JSON.parse(raw.toString("utf8")));
  });

  it("routes encrypted pairing placeholders by outer metadata", () => {
    const { socket, sent } = createSocketCapture();
    const envelope = {
      from: "app-device",
      to: "",
      session_id: "",
      seq: 2,
      ts: Date.now(),
      sig: "signature",
      ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
      message_type: "device.pair",
      cipher_mode: "noise_static_v1",
      request_id: "pair-1",
      routing_payload: Buffer.from(
        JSON.stringify({
          pairing_code: "123456",
          server_url: "ws://relay",
          app_pubkey: "app-pub-key",
          app_ed25519_pubkey: "app-ed25519-pub-key",
          app_device_name: "Test iPhone",
        }),
        "utf8",
      ).toString("base64url"),
    };

    const decoded = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(envelope), "utf8"),
    );

    expect(decoded.message).toEqual({
      v: 1,
      id: "pair-1",
      type: "device.pair",
      payload: {
        pairing_code: "123456",
        server_url: "ws://relay",
        app_pubkey: "app-pub-key",
        app_ed25519_pubkey: "app-ed25519-pub-key",
        app_device_name: "Test iPhone",
      },
    });
    expect(decoded.forwardEnvelope).toEqual(envelope);

    sendRelayMessage(socket, decoded.message, {
      to: "daemon-1",
      sourceEnvelope: decoded.forwardEnvelope,
    });

    expect(sent).toEqual([envelope]);
  });

  it("emits device.pair as an opaque placeholder for envelope clients", () => {
    const { socket, sent } = createSocketCapture();
    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sendRelayMessage(socket, {
      v: 1,
      id: "pair-emit-1",
      type: "device.pair",
      payload: {
        pairing_code: "123456",
        server_url: "ws://relay",
        app_pubkey: "app-pub-key",
        app_ed25519_pubkey: "app-ed25519-pub-key",
        app_device_name: "Test iPhone",
      },
    });

    expect(sent).toEqual([
      {
        from: "hellobug-server",
        to: "",
        session_id: "",
        seq: 1,
        ts: expect.any(Number),
        sig: "",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        message_type: "device.pair",
        cipher_mode: "noise_static_v1",
        request_id: "pair-emit-1",
        routing_payload: Buffer.from(
          JSON.stringify({
            pairing_code: "123456",
            server_url: "ws://relay",
            app_pubkey: "app-pub-key",
            app_ed25519_pubkey: "app-ed25519-pub-key",
            app_device_name: "Test iPhone",
          }),
          "utf8",
        ).toString("base64url"),
      },
    ]);
  });

  it("routes encrypted envelopes by outer metadata without decoding ciphertext", () => {
    const { socket, sent } = createSocketCapture();
    const envelope = {
      from: "app-device",
      to: "",
      session_id: "sess-encrypted-1",
      seq: 7,
      ts: Date.now(),
      sig: "signature",
      ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
      message_type: "session.start",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "app-x25519-pubkey",
      routing_payload: Buffer.from(
        JSON.stringify({
          session_id: "sess-encrypted-1",
          agent_type: "claude_code",
          workspace_path: "",
          resume_session_id: null,
        }),
        "utf8",
      ).toString("base64url"),
    };

    const decoded = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(envelope), "utf8"),
    );

    expect(decoded.message.type).toBe("session.start");
    expect(decoded.message.payload.session_id).toBe("sess-encrypted-1");
    expect(decoded.forwardEnvelope).toEqual(envelope);

    sendRelayMessage(socket, decoded.message, {
      to: "daemon-1",
      sourceEnvelope: decoded.forwardEnvelope,
    });

    expect(sent).toEqual([envelope]);
  });

  it("prefers routing payload hints for encrypted session.start envelopes", () => {
    const socket = {} as WebSocket;
    const decoded = decodeRelayFrame(
      socket,
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-routing-1",
          type: "session.start",
          payload: {
            session_id: "session-routing-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
        {
          sessionId: "session-routing-1",
          requestId: "session-start-routing-1",
          messageType: "session.start",
          cipherMode: "noise_static_v1",
          senderPubkey: "app-routing-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
          routingPayload: {
            session_id: "session-routing-1",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            resume_session_id: null,
          },
        },
      ),
    );

    expect(decoded.message).toEqual({
      v: 1,
      id: "session-start-routing-1",
      type: "session.start",
      payload: {
        session_id: "session-routing-1",
        agent_type: "shell",
        workspace_path: "/tmp/workspace",
        resume_session_id: null,
      },
    });
    expect(decoded.forwardEnvelope?.message_type).toBe("session.start");
  });

  it("rejects encrypted session.start envelopes without routing_payload", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "session-start-missing-routing-1",
            type: "session.start",
            payload: {
              session_id: "session-start-missing-routing-1",
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
          {
            sessionId: "session-start-missing-routing-1",
            requestId: "session-start-missing-routing-1",
            messageType: "session.start",
            cipherMode: "noise_static_v1",
            senderPubkey: "app-routing-x25519-pubkey",
            ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
            omitRoutingPayload: true,
          },
        ),
      ),
    ).toThrow("Encrypted session.start requires routing_payload");
  });

  it("rejects encrypted session.start envelopes without sender_pubkey", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "session-start-missing-sender-1",
            type: "session.start",
            payload: {
              session_id: "session-start-missing-sender-1",
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
          {
            sessionId: "session-start-missing-sender-1",
            requestId: "session-start-missing-sender-1",
            messageType: "session.start",
            cipherMode: "noise_static_v1",
            ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tc3RhcnQ",
            routingPayload: {
              session_id: "session-start-missing-sender-1",
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              resume_session_id: null,
            },
          },
        ),
      ),
    ).toThrow("Encrypted session.start requires sender_pubkey");
  });

  it("routes encrypted session-scoped utility messages by outer metadata", () => {
    const { socket, sent } = createSocketCapture();

    const fsTreeEnvelope = {
      from: "daemon-device",
      to: "",
      session_id: "sess-tree-enc-1",
      seq: 8,
      ts: Date.now(),
      sig: "signature",
      ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
      message_type: "fs.tree",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "daemon-x25519-pubkey",
    };

    const decodedTree = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(fsTreeEnvelope), "utf8"),
    );
    expect(decodedTree.message.type).toBe("fs.tree");
    expect(decodedTree.message.payload.session_id).toBe("sess-tree-enc-1");

    sendRelayMessage(socket, decodedTree.message, {
      sourceEnvelope: decodedTree.forwardEnvelope,
    });

    const errorEnvelope = {
      from: "daemon-device",
      to: "",
      session_id: "sess-error-enc-1",
      seq: 9,
      ts: Date.now(),
      sig: "signature",
      ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
      message_type: "error",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "daemon-x25519-pubkey",
      routing_payload: Buffer.from(
        JSON.stringify({
          request_id: "error-enc-1",
          session_id: "sess-error-enc-1",
          code: "SESSION_NOT_FOUND",
          message: "encrypted",
        }),
        "utf8",
      ).toString("base64url"),
    };

    const decodedError = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(errorEnvelope), "utf8"),
    );
    expect(decodedError.message.type).toBe("error");
    expect(decodedError.message.payload.session_id).toBe("sess-error-enc-1");

    sendRelayMessage(socket, decodedError.message, {
      sourceEnvelope: decodedError.forwardEnvelope,
    });

    const dangerResultEnvelope = {
      from: "daemon-device",
      to: "",
      session_id: "sess-danger-result-enc-1",
      seq: 10,
      ts: Date.now(),
      sig: "signature",
      ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
      message_type: "danger.result",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "daemon-x25519-pubkey",
      routing_payload: Buffer.from(
        JSON.stringify({
          danger_id: "encrypted-danger",
          session_id: "sess-danger-result-enc-1",
          status: "approved",
          message: "encrypted",
        }),
        "utf8",
      ).toString("base64url"),
    };

    const decodedDangerResult = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(dangerResultEnvelope), "utf8"),
    );
    expect(decodedDangerResult.message.type).toBe("danger.result");
    expect(decodedDangerResult.message.payload.session_id).toBe(
      "sess-danger-result-enc-1",
    );

    sendRelayMessage(socket, decodedDangerResult.message, {
      sourceEnvelope: decodedDangerResult.forwardEnvelope,
    });

    expect(sent).toEqual([fsTreeEnvelope, errorEnvelope, dangerResultEnvelope]);
  });

  it("rejects encrypted session.event envelopes without routing_payload", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "session-event-missing-routing-1",
            type: "session.event",
            payload: {
              session_id: "sess-event-missing-routing-1",
              agent_id: null,
              agent_type: null,
              seq: 1,
              event: {
                event_type: "assistant.delta",
                text: "missing routing payload",
              },
            },
          },
          {
            sessionId: "sess-event-missing-routing-1",
            requestId: "session-event-missing-routing-1",
            messageType: "session.event",
            cipherMode: "noise_static_v1",
            senderPubkey: "daemon-x25519-pubkey",
            ciphertext: "ZW5jcnlwdGVkLXNlc3Npb24tZXZlbnQ",
            omitRoutingPayload: true,
          },
        ),
      ),
    ).toThrow("Encrypted session.event requires routing_payload");
  });

  it("rejects encrypted danger.result envelopes without routing_payload", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "danger-result-missing-routing-1",
            type: "danger.result",
            payload: {
              danger_id: "danger-result-missing-routing-1",
              session_id: "sess-danger-result-missing-routing-1",
              status: "approved",
              message: "ok",
            },
          },
          {
            sessionId: "sess-danger-result-missing-routing-1",
            requestId: "danger-result-missing-routing-1",
            messageType: "danger.result",
            cipherMode: "noise_static_v1",
            senderPubkey: "daemon-x25519-pubkey",
            ciphertext: "ZW5jcnlwdGVkLWRhbmdlci1yZXN1bHQ",
            omitRoutingPayload: true,
          },
        ),
      ),
    ).toThrow("Encrypted danger.result requires routing_payload");
  });

  it("routes encrypted key ratchet control envelopes by outer metadata", () => {
    const { socket, sent } = createSocketCapture();

    const ratchetEnvelope = {
      from: "daemon-device",
      to: "",
      session_id: "sess-ratchet-enc-1",
      seq: 11,
      ts: Date.now(),
      sig: "signature",
      ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
      message_type: "key.ratchet",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "daemon-x25519-pubkey",
    };

    const decodedRatchet = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(ratchetEnvelope), "utf8"),
    );
    expect(decodedRatchet.message.type).toBe("key.ratchet");
    expect(decodedRatchet.message.payload.session_id).toBe("sess-ratchet-enc-1");

    sendRelayMessage(socket, decodedRatchet.message, {
      sourceEnvelope: decodedRatchet.forwardEnvelope,
    });

    const ratchetAckEnvelope = {
      from: "app-device",
      to: "",
      session_id: "sess-ratchet-enc-1",
      seq: 12,
      ts: Date.now(),
      sig: "signature",
      ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
      message_type: "key.ratchet_ack",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "app-x25519-pubkey",
    };

    const decodedRatchetAck = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(ratchetAckEnvelope), "utf8"),
    );
    expect(decodedRatchetAck.message.type).toBe("key.ratchet_ack");
    expect(decodedRatchetAck.message.payload.session_id).toBe("sess-ratchet-enc-1");

    sendRelayMessage(socket, decodedRatchetAck.message, {
      sourceEnvelope: decodedRatchetAck.forwardEnvelope,
    });

    expect(sent).toEqual([ratchetEnvelope, ratchetAckEnvelope]);
  });

  it("routes encrypted transport control envelopes by outer request metadata", () => {
    const { socket, sent } = createSocketCapture();

    const controlEnvelope = {
      from: "daemon-device",
      to: "",
      session_id: TransportControlSessionId,
      seq: 11,
      ts: Date.now(),
      sig: "signature",
      ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
      message_type: "workspace.list",
      cipher_mode: "noise_static_v1",
      sender_pubkey: "daemon-x25519-pubkey",
      request_id: "workspace-list-enc-1",
    };

    const decoded = decodeRelayFrame(
      socket,
      Buffer.from(JSON.stringify(controlEnvelope), "utf8"),
    );
    expect(decoded.message.type).toBe("workspace.list");
    expect(decoded.message.id).toBe("workspace-list-enc-1");
    expect(decoded.forwardEnvelope).toEqual(controlEnvelope);

    sendRelayMessage(socket, decoded.message, {
      sourceEnvelope: decoded.forwardEnvelope,
    });

    expect(sent).toEqual([controlEnvelope]);
  });

  it("adds control-channel routing metadata when creating direct envelopes", () => {
    const { socket, sent } = createSocketCapture();

    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-2",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sent.length = 0;
    sendRelayMessage(socket, {
      v: 1,
      id: "workspace-list-2",
      type: "workspace.list",
      payload: {
        default_path: null,
        items: [],
      },
    });

    expect(sent).toEqual([
      {
        from: "hellobug-server",
        to: "",
        session_id: TransportControlSessionId,
        seq: 1,
        ts: expect.any(Number),
        sig: "",
        ciphertext: Buffer.from(
          JSON.stringify({
            v: 1,
            id: "workspace-list-2",
            type: "workspace.list",
            payload: {
              default_path: null,
              items: [],
            },
          }),
          "utf8",
        ).toString("base64url"),
        message_type: "workspace.list",
        cipher_mode: "plain",
        request_id: "workspace-list-2",
      },
    ]);
  });

  it("forwards session resume envelopes unchanged when the inner message is formal", () => {
    const { socket, sent } = createSocketCapture();
    const raw = encodeEnvelope(
      {
        v: 1,
        id: "resume-1",
        type: "session.resume",
        payload: {
          session_id: "sess-1",
          last_seq: 3,
        },
      },
      {
        sessionId: "sess-1",
        requestId: "resume-1",
        messageType: "session.resume",
        cipherMode: "noise_static_v1",
        routingPayload: {
          session_id: "sess-1",
          last_seq: 3,
        },
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
      },
    );

    const decoded = decodeRelayFrame(socket, raw);
    expect(decoded.forwardEnvelope).toBeDefined();

    sendRelayMessage(socket, decoded.message, {
      sourceEnvelope: decoded.forwardEnvelope,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(JSON.parse(raw.toString("utf8")));
  });

  it("decodes encrypted session.resume via routing payload metadata", () => {
    const socket = {} as WebSocket;
    const decoded = decodeRelayFrame(
      socket,
      encodeEnvelope(
        {
          v: 1,
          id: "resume-encrypted-inner",
          type: "session.resume",
          payload: {
            session_id: "sess-opaque-1",
            last_seq: 9,
          },
        },
        {
          sessionId: "sess-opaque-1",
          requestId: "resume-encrypted-1",
          messageType: "session.resume",
          cipherMode: "noise_static_v1",
          senderPubkey: "sender-pubkey",
          routingPayload: {
            session_id: "sess-opaque-1",
            last_seq: 3,
          },
        },
      ),
    );

    expect(decoded.message).toEqual({
      v: 1,
      id: "resume-encrypted-1",
      type: "session.resume",
      payload: {
        session_id: "sess-opaque-1",
        last_seq: 3,
      },
    });
  });

  it("decodes encrypted auth.attach via routing payload metadata", () => {
    const socket = {} as WebSocket;
    const decoded = decodeRelayFrame(
      socket,
      encodeEnvelope(
        {
          v: 1,
          id: "auth-attach-inner",
          type: "auth.attach",
          payload: {
            jwt: "inner-token",
          },
        },
        {
          sessionId: TransportControlSessionId,
          requestId: "auth-attach-1",
          messageType: "auth.attach",
          cipherMode: "noise_static_v1",
          ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
          routingPayload: {
            jwt: "routing-token",
          },
        },
      ),
    );

    expect(decoded.message).toEqual({
      v: 1,
      id: "auth-attach-1",
      type: "auth.attach",
      payload: {
        jwt: "routing-token",
      },
    });
  });

  it("decodes encrypted push.trigger via routing payload metadata", () => {
    const socket = {} as WebSocket;
    const frame = encodeEnvelope(
      {
        type: "push.trigger",
        payload: {
          session_id: "sess-push-1",
          event_type: "task_done",
        },
      },
      {
        sessionId: "sess-push-1",
        cipherMode: "noise_static_v1",
        senderPubkey: "daemon-session-pubkey-1",
        routingPayload: {
          session_id: "sess-push-1",
          event_type: "task_done",
        },
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
      },
    );

    const decoded = decodeRelayFrame(socket, frame);
    expect(decoded.message).toMatchObject({
      type: "push.trigger",
      payload: {
        session_id: "sess-push-1",
        event_type: "task_done",
      },
    });
  });

  it("emits auth.token as an opaque placeholder for envelope clients", () => {
    const { socket, sent } = createSocketCapture();
    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sendRelayMessage(socket, {
      v: 1,
      type: "auth.token",
      payload: {
        jwt: "next-token",
        expires_at: 1_718_956_800_000,
      },
    });

    expect(sent).toEqual([
      {
        from: "hellobug-server",
        to: "",
        session_id: TransportControlSessionId,
        seq: 1,
        ts: expect.any(Number),
        sig: "",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        message_type: "auth.token",
        cipher_mode: "noise_static_v1",
        routing_payload: Buffer.from(
          JSON.stringify({
            jwt: "next-token",
            expires_at: 1_718_956_800_000,
          }),
          "utf8",
        ).toString("base64url"),
      },
    ]);
  });

  it("emits replay.done as an opaque placeholder for envelope clients", () => {
    const { socket, sent } = createSocketCapture();
    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sendRelayMessage(socket, {
      v: 1,
      type: "replay.done",
      payload: {
        session_id: "sess-replay-1",
        replayed_count: 2,
        current_seq: 7,
        status: "ok",
        message: "Replay complete",
      },
    });

    expect(sent).toEqual([
      {
        from: "hellobug-server",
        to: "",
        session_id: "sess-replay-1",
        seq: 1,
        ts: expect.any(Number),
        sig: "",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        message_type: "replay.done",
        cipher_mode: "noise_static_v1",
        routing_payload: Buffer.from(
          JSON.stringify({
            session_id: "sess-replay-1",
            replayed_count: 2,
            current_seq: 7,
            status: "ok",
            message: "Replay complete",
          }),
          "utf8",
        ).toString("base64url"),
      },
    ]);
  });

  it("emits session.start.result as an opaque placeholder for envelope clients", () => {
    const { socket, sent } = createSocketCapture();
    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sendRelayMessage(socket, {
      v: 1,
      type: "session.start.result",
      payload: {
        request_id: "session-start-result-1",
        session_id: "sess-start-result-1",
        agent_type: "claude_code",
        workspace_path: "/tmp/workspace",
        status: "rejected",
        code: "SESSION_NOT_FOUND",
        message: "Target daemon timed out before session started",
      },
    });

    expect(sent).toEqual([
      {
        from: "hellobug-server",
        to: "",
        session_id: "sess-start-result-1",
        seq: 1,
        ts: expect.any(Number),
        sig: "",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        message_type: "session.start.result",
        cipher_mode: "noise_static_v1",
        request_id: "session-start-result-1",
        routing_payload: Buffer.from(
          JSON.stringify({
            request_id: "session-start-result-1",
            session_id: "sess-start-result-1",
            agent_type: "claude_code",
            workspace_path: "/tmp/workspace",
            status: "rejected",
            code: "SESSION_NOT_FOUND",
            message: "Target daemon timed out before session started",
          }),
          "utf8",
        ).toString("base64url"),
      },
    ]);
  });

  it("uses routing status hints for encrypted session.start.result envelopes", () => {
    const socket = {} as WebSocket;

    const decoded = decodeRelayFrame(
      socket,
      encodeEnvelope(
        {
          v: 1,
          id: "session-start-result-enc-2",
          type: "session.start.result",
          payload: {
            request_id: "session-start-enc-2",
            session_id: "sess-start-result-enc-2",
            agent_type: "shell",
            workspace_path: "/tmp/workspace",
            status: "rejected",
            code: "WORKSPACE_FORBIDDEN",
            message: "Workspace is not accessible",
          },
        },
        {
          sessionId: "sess-start-result-enc-2",
          requestId: "session-start-enc-2",
          messageType: "session.start.result",
          cipherMode: "noise_static_v1",
          senderPubkey: "daemon-x25519-pubkey",
          ciphertext: "ZW5jcnlwdGVkLXN0YXJ0LXJlc3VsdC0y",
          routingPayload: {
            status: "rejected",
            code: "WORKSPACE_FORBIDDEN",
          },
        },
      ),
    );

    expect(decoded.message).toEqual({
      v: 1,
      id: "session-start-enc-2",
      type: "session.start.result",
      payload: {
        request_id: "session-start-enc-2",
        session_id: "sess-start-result-enc-2",
        agent_type: "claude_code",
        workspace_path: "",
        status: "rejected",
        code: "WORKSPACE_FORBIDDEN",
        message: "encrypted",
      },
    });
  });

  it("rejects encrypted session.start.result envelopes without routing_payload", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "session-start-result-missing-routing-1",
            type: "session.start.result",
            payload: {
              request_id: "session-start-result-missing-routing-1",
              session_id: "sess-start-result-missing-routing-1",
              agent_type: "shell",
              workspace_path: "/tmp/workspace",
              status: "started",
              message: "Session started",
            },
          },
          {
            sessionId: "sess-start-result-missing-routing-1",
            requestId: "session-start-result-missing-routing-1",
            messageType: "session.start.result",
            cipherMode: "noise_static_v1",
            senderPubkey: "daemon-x25519-pubkey",
            ciphertext: "ZW5jcnlwdGVkLXN0YXJ0LXJlc3VsdA",
            omitRoutingPayload: true,
          },
        ),
      ),
    ).toThrow("Encrypted session.start.result requires routing_payload");
  });

  it("rejects encrypted error envelopes without routing_payload", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        encodeEnvelope(
          {
            v: 1,
            id: "error-missing-routing-1",
            type: "error",
            payload: {
              request_id: "error-missing-routing-1",
              session_id: "sess-error-missing-routing-1",
              code: "SESSION_NOT_FOUND",
              message: "encrypted error",
            },
          },
          {
            sessionId: "sess-error-missing-routing-1",
            requestId: "error-missing-routing-1",
            messageType: "error",
            cipherMode: "noise_static_v1",
            senderPubkey: "daemon-error-x25519-pubkey",
            ciphertext: "ZW5jcnlwdGVkLWVycm9y",
            omitRoutingPayload: true,
          },
        ),
      ),
    ).toThrow("Encrypted error requires routing_payload");
  });

  it("rejects encrypted key.ratchet envelopes without sender_pubkey", () => {
    const socket = {} as WebSocket;

    expect(() =>
      decodeRelayFrame(
        socket,
        Buffer.from(
          JSON.stringify({
            from: "daemon-device",
            to: "",
            session_id: "sess-ratchet-missing-sender-1",
            seq: 21,
            ts: Date.now(),
            sig: "signature",
            ciphertext: "ZmFrZS1jaXBoZXJ0ZXh0",
            message_type: "key.ratchet",
            cipher_mode: "noise_static_v1",
          }),
          "utf8",
        ),
      ),
    ).toThrow("Encrypted key.ratchet requires sender_pubkey");
  });

  it("emits device.status as an opaque placeholder for envelope clients", () => {
    const { socket, sent } = createSocketCapture();
    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sendRelayMessage(socket, {
      v: 1,
      type: "device.status",
      payload: {
        device_id: "daemon-1",
        online: true,
        machine_name: "MacBook Pro",
        ts: 1_718_956_800_000,
        os: "darwin",
        daemon_version: "0.1.0",
        paired_at: 1_718_956_700_000,
        last_seen_at: 1_718_956_800_000,
        revoked_at: null,
        active_session_count: 2,
      },
    });

    expect(sent).toEqual([
      {
        from: "hellobug-server",
        to: "",
        session_id: "",
        seq: 1,
        ts: expect.any(Number),
        sig: "",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        message_type: "device.status",
        cipher_mode: "noise_static_v1",
        routing_payload: Buffer.from(
          JSON.stringify({
            device_id: "daemon-1",
            online: true,
            machine_name: "MacBook Pro",
            ts: 1_718_956_800_000,
            os: "darwin",
            daemon_version: "0.1.0",
            paired_at: 1_718_956_700_000,
            last_seen_at: 1_718_956_800_000,
            revoked_at: null,
            active_session_count: 2,
          }),
          "utf8",
        ).toString("base64url"),
      },
    ]);
  });

  it("emits control-channel errors as opaque placeholders for envelope clients", () => {
    const { socket, sent } = createSocketCapture();
    decodeRelayFrame(
      socket,
      encodeEnvelope({
        v: 1,
        id: "auth-1",
        type: "auth.attach",
        payload: {
          jwt: "token",
        },
      }),
    );

    sendRelayMessage(socket, {
      v: 1,
      type: "error",
      payload: {
        request_id: "workspace-list-1",
        session_id: null,
        code: "SESSION_NOT_FOUND",
        message: "Target daemon is offline",
      },
    });

    expect(sent).toEqual([
      {
        from: "hellobug-server",
        to: "",
        session_id: TransportControlSessionId,
        seq: 1,
        ts: expect.any(Number),
        sig: "",
        ciphertext: Buffer.from("opaque", "utf8").toString("base64url"),
        message_type: "error",
        cipher_mode: "noise_static_v1",
        request_id: "workspace-list-1",
        routing_payload: Buffer.from(
          JSON.stringify({
            request_id: "workspace-list-1",
            session_id: null,
            code: "SESSION_NOT_FOUND",
            message: "Target daemon is offline",
          }),
          "utf8",
        ).toString("base64url"),
      },
    ]);
  });

  it("forwards slash commands with the formal desc field only", () => {
    const { socket, sent } = createSocketCapture();

    sendRelayMessage(socket, {
      v: 1,
      id: "slash-list-1",
      type: "slash.list",
      payload: {
        session_id: "sess-slash-1",
        commands: [
          {
            name: "open",
            desc: "Open a file",
          },
        ],
      },
    });

    expect(sent).toEqual([
      {
        v: 1,
        id: "slash-list-1",
        type: "slash.list",
        payload: {
          session_id: "sess-slash-1",
          commands: [
            {
              name: "open",
              desc: "Open a file",
            },
          ],
        },
      },
    ]);
  });
});
