import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { Message } from "@hellobug/protocol";
import { describe, expect, it } from "vitest";

import type { DeviceIdentity } from "../src/crypto/keys.js";
import { DaemonWorkspaceService } from "../src/fs/workspace.js";
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

function createSessionLookup(workspacePath: string) {
  return {
    get(sessionId: string) {
      if (sessionId !== "sess-1") {
        return undefined;
      }

      return {
        sessionId,
        workspacePath,
        agentType: "claude_code" as const,
        seq: 0,
        createdAt: Date.now(),
      };
    },
  };
}

describe("daemon workspace service", () => {
  it("lists directory entries with workspace-relative paths", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "hellobug-workspace-tree-"),
    );
    await mkdir(join(workspaceRoot, "src"));
    await writeFile(join(workspaceRoot, "README.md"), "# HelloBug\n");
    await writeFile(
      join(workspaceRoot, "src", "index.ts"),
      "export const answer = 42;\n",
    );

    const service = new DaemonWorkspaceService({
      allowedPaths: [workspaceRoot],
      sessions: createSessionLookup(workspaceRoot),
    });

    const message = await service.handleTreeRequest({
      v: 1,
      id: "tree-1",
      type: "fs.tree.req",
      payload: {
        session_id: "sess-1",
        workspace_path: workspaceRoot,
        dir_path: "",
      },
    });

    expect(message).toMatchObject({
      type: "fs.tree",
      payload: {
        session_id: "sess-1",
        workspace_path: workspaceRoot,
        dir_path: "",
      },
    });
    expect(message.payload.entries.map((entry) => entry.name)).toEqual([
      "src",
      "README.md",
    ]);
    expect(message.payload.entries).toEqual([
      {
        name: "src",
        path: "src",
        type: "dir",
        modified: null,
        size: 0,
      },
      {
        name: "README.md",
        path: "README.md",
        type: "file",
        modified: null,
        size: 11,
      },
    ]);
  });

  it("streams file chunks and preserves zero-byte files", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "hellobug-workspace-file-"),
    );
    const largeFilePath = join(workspaceRoot, "large.txt");
    const emptyFilePath = join(workspaceRoot, "empty.txt");
    const largeContent = "a".repeat(210_000) + "b".repeat(40_000);
    await writeFile(largeFilePath, largeContent);
    await writeFile(emptyFilePath, "");

    const service = new DaemonWorkspaceService({
      allowedPaths: [workspaceRoot],
      sessions: createSessionLookup(workspaceRoot),
    });

    const chunked = await service.handleFileRequest({
      v: 1,
      id: "file-1",
      type: "fs.file.req",
      payload: {
        session_id: "sess-1",
        file_path: largeFilePath,
      },
    });

    expect(chunked).toHaveLength(2);
    expect(chunked.map((message) => message.payload.chunk_index)).toEqual([
      0, 1,
    ]);
    expect(chunked.every((message) => message.payload.total_chunks === 2)).toBe(
      true,
    );
    expect(
      chunked.every((message) => message.payload.file_path === largeFilePath),
    ).toBe(true);
    const reconstructed = chunked
      .map((message) =>
        Buffer.from(message.payload.data, "base64url").toString("utf8"),
      )
      .join("");
    expect(reconstructed).toBe(largeContent);

    const empty = await service.handleFileRequest({
      v: 1,
      id: "file-2",
      type: "fs.file.req",
      payload: {
        session_id: "sess-1",
        file_path: emptyFilePath,
      },
    });

    expect(empty).toEqual([
      {
        v: 1,
        type: "fs.file",
        payload: {
          session_id: "sess-1",
          file_path: emptyFilePath,
          mime_type: "text/plain",
          chunk_index: 0,
          total_chunks: 1,
          data: "",
          total_size: 0,
        },
      },
    ]);
  });

  it("expands tilde-prefixed workspace paths while echoing the app-visible path", async () => {
    const workspaceRoot = await mkdtemp(
      join(homedir(), "hellobug-home-workspace-"),
    );
    const workspaceLabel = `~/${workspaceRoot.slice(homedir().length + 1)}`;
    await writeFile(join(workspaceRoot, "hello.txt"), "tilde path\n");

    const service = new DaemonWorkspaceService({
      allowedPaths: [homedir()],
      sessions: createSessionLookup(workspaceLabel),
    });

    const tree = await service.handleTreeRequest({
      v: 1,
      id: "tree-tilde-1",
      type: "fs.tree.req",
      payload: {
        session_id: "sess-1",
        workspace_path: workspaceLabel,
        dir_path: "",
      },
    });

    expect(tree.payload.workspace_path).toBe(workspaceLabel);
    expect(tree.payload.entries).toEqual([
      {
        name: "hello.txt",
        path: "hello.txt",
        type: "file",
        modified: null,
        size: 11,
      },
    ]);

    const file = await service.handleFileRequest({
      v: 1,
      id: "file-tilde-1",
      type: "fs.file.req",
      payload: {
        session_id: "sess-1",
        file_path: `${workspaceLabel}/hello.txt`,
      },
    });

    expect(file).toHaveLength(1);
    expect(file[0]?.payload.file_path).toBe(`${workspaceLabel}/hello.txt`);
    expect(
      Buffer.from(file[0]?.payload.data ?? "", "base64url").toString("utf8"),
    ).toBe("tilde path\n");
  });

  it("returns a protocol error when file access escapes the workspace", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "hellobug-workspace-guard-"),
    );
    const sent: Message[] = [];
    const service = new DaemonWorkspaceService({
      allowedPaths: [workspaceRoot],
      sessions: createSessionLookup(workspaceRoot),
    });

    const router = createDaemonMessageRouter({
      identity: createIdentity(),
      workspace: service,
    });

    await router(
      {
        v: 1,
        id: "file-escape-1",
        type: "fs.file.req",
        payload: {
          session_id: "sess-1",
          file_path: "../outside.txt",
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
          request_id: "file-escape-1",
          session_id: "sess-1",
          code: "WORKSPACE_FORBIDDEN",
          message: expect.stringContaining("outside"),
        },
      },
    ]);
  });
});
