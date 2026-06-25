import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import { resolve } from "node:path";

import {
  createEnvelopeSigningPayload,
  type Message,
} from "@hellobug/protocol";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { decodeRelayFrame, sendRelayMessage } from "../src/relay/framing.js";

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

function encodeEnvelope(message: Record<string, unknown>) {
  const { privateKey } = generateKeyPairSync("ed25519");
  const envelope = {
    from: "app-device",
    to: "",
    session_id: "",
    seq: 1,
    ts: Date.now(),
    sig: "",
    ciphertext: Buffer.from(JSON.stringify(message), "utf8").toString(
      "base64url",
    ),
  };
  envelope.sig = sign(
    null,
    createEnvelopeSigningPayload(envelope),
    privateKey,
  ).toString("base64url");
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

describe("relay framing compatibility", () => {
  it("normalizes legacy fs.tree requests that only provide path", () => {
    const socket = {} as WebSocket;
    const decoded = decodeRelayFrame(
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
    );

    expect(decoded.wireFormat).toBe("plain");
    expect(decoded.message).toEqual({
      v: 1,
      id: "tree-1",
      type: "fs.tree.req",
      payload: {
        session_id: "sess-1",
        workspace_path: "/tmp/workspace/src",
        dir_path: "",
      },
    });
  });

  it("fills resume_session_id for legacy session.start payloads", () => {
    const socket = {} as WebSocket;
    const decoded = decodeRelayFrame(
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
    );

    expect(decoded.message).toEqual({
      v: 1,
      id: "start-1",
      type: "session.start",
      payload: {
        session_id: "sess-1",
        agent_type: "shell",
        workspace_path: "~/project",
        resume_session_id: null,
      },
    });
  });

  it("normalizes legacy slash commands that send args as a single string", () => {
    const socket = {} as WebSocket;
    const decoded = decodeRelayFrame(
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
    );

    expect(decoded.message).toEqual({
      v: 1,
      id: "slash-1",
      type: "session.command.slash",
      payload: {
        session_id: "sess-1",
        command: "open",
        args: ["src/main.dart", "--line", "10"],
      },
    });
  });

  it("adds legacy file-tree fields for app clients", () => {
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
          path: resolve("/tmp/workspace", "src"),
          items: [
            {
              name: "lib",
              path: resolve("/tmp/workspace", "src/lib"),
              is_dir: true,
              modified: null,
              size: 0,
            },
            {
              name: "index.ts",
              path: resolve("/tmp/workspace", "src/index.ts"),
              is_dir: false,
              modified: true,
              size: 128,
            },
          ],
        },
      },
    ]);
  });

  it("adds legacy text content fields when forwarding fs.file to app clients", () => {
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
        content?: string;
        data?: string;
        data_base64url?: string;
      };
    };

    expect(inner.type).toBe("fs.file");
    expect(inner.payload.session_id).toBe("sess-file-1");
    expect(inner.payload.data).toBe("# HelloBug\n");
    expect(inner.payload.data_base64url).toBe(
      Buffer.from("# HelloBug\n", "utf8").toString("base64url"),
    );
    expect(inner.payload.content).toBe("# HelloBug\n");
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

  it("repackages envelope traffic when legacy normalization changed the inner message", () => {
    const { socket, sent } = createSocketCapture();
    const raw = encodeEnvelope({
      v: 1,
      id: "replay-1",
      type: "session.replay",
      payload: {
        session_id: "sess-1",
        from_seq: 3,
      },
    });

    const decoded = decodeRelayFrame(socket, raw);
    expect(decoded.forwardEnvelope).toBeUndefined();

    sendRelayMessage(socket, decoded.message, {
      sourceEnvelope: decoded.forwardEnvelope,
    });

    expect(sent).toHaveLength(1);
    const envelope = sent[0] as { ciphertext: string; sig: string };
    expect(envelope.sig).toBe("");

    const inner = JSON.parse(
      Buffer.from(envelope.ciphertext, "base64url").toString("utf8"),
    ) as Message;
    expect(inner.type).toBe("session.resume");
    expect(inner.payload).toEqual({
      session_id: "sess-1",
      last_seq: 3,
    });
  });

  it("adds legacy description aliases when forwarding slash commands to app clients", () => {
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
              description: "Open a file",
            },
          ],
        },
      },
    ]);
  });
});
