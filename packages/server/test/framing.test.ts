import { Buffer } from "node:buffer";
import { resolve } from "node:path";

import type { Message } from "@hellobug/protocol";
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
  return Buffer.from(
    JSON.stringify({
      from: "app-device",
      to: "",
      session_id: "",
      seq: 1,
      ts: Date.now(),
      sig: "",
      ciphertext: Buffer.from(JSON.stringify(message), "utf8").toString(
        "base64url",
      ),
    }),
    "utf8",
  );
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
    expect(inner.payload.data).toBe("# HelloBug\n");
    expect(inner.payload.data_base64url).toBe(
      Buffer.from("# HelloBug\n", "utf8").toString("base64url"),
    );
    expect(inner.payload.content).toBe("# HelloBug\n");
  });

  it("adds legacy description aliases when forwarding slash commands to app clients", () => {
    const { socket, sent } = createSocketCapture();

    sendRelayMessage(socket, {
      v: 1,
      id: "slash-list-1",
      type: "slash.list",
      payload: {
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
