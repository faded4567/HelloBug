import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Message } from "@hellobug/protocol";
import { describe, expect, it } from "vitest";

import type { DeviceIdentity } from "../src/crypto/keys.js";
import { DaemonWorkspaceService } from "../src/fs/workspace.js";
import { createDaemonMessageRouter } from "../src/transport/message-router.js";

const execFileAsync = promisify(execFile);

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
      id: "tree-1",
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

  it("streams text file chunks and preserves zero-byte files", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "hellobug-workspace-file-"),
    );
    const chunkedFilePath = join(workspaceRoot, "chunked.txt");
    const emptyFilePath = join(workspaceRoot, "empty.txt");
    const chunkedContent = "a".repeat(210_000) + "b".repeat(40_000);
    await writeFile(chunkedFilePath, chunkedContent);
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
        file_path: chunkedFilePath,
      },
    });

    expect(chunked).toHaveLength(2);
    expect(chunked.every((message) => message.payload.status === "ready")).toBe(
      true,
    );
    expect(chunked.map((message) => message.payload.chunk_index)).toEqual([
      0, 1,
    ]);
    expect(chunked.every((message) => message.payload.total_chunks === 2)).toBe(
      true,
    );
    expect(
      chunked.every((message) => message.payload.file_path === chunkedFilePath),
    ).toBe(true);
    const reconstructed = chunked
      .map((message) =>
        Buffer.from(message.payload.data, "base64url").toString("utf8"),
      )
      .join("");
    expect(reconstructed).toBe(chunkedContent);

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
        id: "file-2",
        type: "fs.file",
        payload: {
          session_id: "sess-1",
          file_path: emptyFilePath,
          status: "ready",
          mime_type: "text/plain",
          chunk_index: 0,
          total_chunks: 1,
          data: "",
          total_size: 0,
        },
      },
    ]);
  });

  it("returns explicit binary and too-large file preview states", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "hellobug-workspace-file-state-"),
    );
    const binaryFilePath = join(workspaceRoot, "archive.bin");
    const hugeTextPath = join(workspaceRoot, "huge.log");
    await writeFile(
      binaryFilePath,
      Buffer.from([0, 159, 146, 150, 0, 1, 2, 3, 4, 5]),
    );
    await writeFile(hugeTextPath, "x".repeat(1_048_577));

    const service = new DaemonWorkspaceService({
      allowedPaths: [workspaceRoot],
      sessions: createSessionLookup(workspaceRoot),
    });

    const binary = await service.handleFileRequest({
      v: 1,
      id: "file-binary-1",
      type: "fs.file.req",
      payload: {
        session_id: "sess-1",
        file_path: binaryFilePath,
      },
    });
    const tooLarge = await service.handleFileRequest({
      v: 1,
      id: "file-too-large-1",
      type: "fs.file.req",
      payload: {
        session_id: "sess-1",
        file_path: hugeTextPath,
      },
    });

    expect(binary).toEqual([
      {
        v: 1,
        id: "file-binary-1",
        type: "fs.file",
        payload: {
          session_id: "sess-1",
          file_path: binaryFilePath,
          status: "binary",
          mime_type: "application/octet-stream",
          total_size: 10,
          message: `Binary file cannot be previewed as text: ${binaryFilePath}`,
        },
      },
    ]);

    expect(tooLarge).toEqual([
      {
        v: 1,
        id: "file-too-large-1",
        type: "fs.file",
        payload: {
          session_id: "sess-1",
          file_path: hugeTextPath,
          status: "too_large",
          mime_type: "text/plain",
          total_size: 1_048_577,
          max_preview_size: 1_048_576,
          message: `File is too large to preview: ${hugeTextPath}`,
        },
      },
    ]);
  });

  it("returns not_found state for missing files inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "hellobug-workspace-file-missing-"),
    );
    const missingFilePath = join(workspaceRoot, "missing.txt");

    const service = new DaemonWorkspaceService({
      allowedPaths: [workspaceRoot],
      sessions: createSessionLookup(workspaceRoot),
    });

    const response = await service.handleFileRequest({
      v: 1,
      id: "file-missing-1",
      type: "fs.file.req",
      payload: {
        session_id: "sess-1",
        file_path: missingFilePath,
      },
    });

    expect(response).toEqual([
      {
        v: 1,
        id: "file-missing-1",
        type: "fs.file",
        payload: {
          session_id: "sess-1",
          file_path: missingFilePath,
          status: "not_found",
          mime_type: null,
          total_size: null,
          message: `File not found: ${missingFilePath}`,
        },
      },
    ]);
  });

  it("lists configured workspaces with readiness metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "hellobug-workspace-list-"));
    const readyWorkspace = join(root, "ready");
    const emptyWorkspace = join(root, "empty");
    const missingWorkspace = join(root, "missing");
    await mkdir(readyWorkspace, { recursive: true });
    await mkdir(emptyWorkspace, { recursive: true });
    await writeFile(join(readyWorkspace, "README.md"), "ready\n");

    const service = new DaemonWorkspaceService({
      allowedPaths: [readyWorkspace, emptyWorkspace, missingWorkspace],
    });

    const response = await service.handleWorkspaceListRequest({
      v: 1,
      id: "workspace-list-1",
      type: "workspace.list",
      payload: {},
    });

    expect(response).toEqual({
      v: 1,
      id: "workspace-list-1",
      type: "workspace.list",
      payload: {
        default_path: readyWorkspace,
        items: [
          {
            path: readyWorkspace,
            name: "ready",
            status: "ready",
            status_reason: "ok",
            is_default: true,
            entry_count: 1,
            is_empty: false,
            repo_root: null,
            git_branch: null,
            access_mode: "read_write",
          },
          {
            path: emptyWorkspace,
            name: "empty",
            status: "ready",
            status_reason: "ok",
            is_default: false,
            entry_count: 0,
            is_empty: true,
            repo_root: null,
            git_branch: null,
            access_mode: "read_write",
          },
          {
            path: missingWorkspace,
            name: "missing",
            status: "missing",
            status_reason: "not_found",
            is_default: false,
            entry_count: null,
            is_empty: null,
            repo_root: null,
            git_branch: null,
            access_mode: "unknown",
          },
        ],
      },
    });
  });

  it("resolves custom workspaces into ready and forbidden statuses", async () => {
    const root = await mkdtemp(join(tmpdir(), "hellobug-workspace-resolve-"));
    const readyWorkspace = join(root, "ready");
    const outsideWorkspace = join(tmpdir(), "hellobug-workspace-outside");
    await mkdir(readyWorkspace, { recursive: true });
    await writeFile(join(readyWorkspace, "main.dart"), "void main() {}\n");

    const service = new DaemonWorkspaceService({
      allowedPaths: [readyWorkspace],
    });

    const ready = await service.handleWorkspaceResolveRequest({
      v: 1,
      id: "workspace-resolve-1",
      type: "workspace.resolve",
      payload: {
        workspace_path: "",
      },
    });
    const forbidden = await service.handleWorkspaceResolveRequest({
      v: 1,
      id: "workspace-resolve-2",
      type: "workspace.resolve",
      payload: {
        workspace_path: outsideWorkspace,
      },
    });

    expect(ready).toEqual({
      v: 1,
      id: "workspace-resolve-1",
      type: "workspace.resolve",
      payload: {
        workspace_path: "",
        resolved_path: readyWorkspace,
        name: "ready",
        status: "ready",
        status_reason: "ok",
        is_default: true,
        entry_count: 1,
        is_empty: false,
        repo_root: null,
        git_branch: null,
        access_mode: "read_write",
      },
    });
    expect(forbidden).toEqual({
      v: 1,
      id: "workspace-resolve-2",
      type: "workspace.resolve",
      payload: {
        workspace_path: outsideWorkspace,
        resolved_path: outsideWorkspace,
        name: "hellobug-workspace-outside",
        status: "forbidden",
        status_reason: "outside_allowed_paths",
        is_default: false,
        entry_count: null,
        is_empty: null,
        repo_root: null,
        git_branch: null,
        access_mode: "no_access",
        repair_hint: {
          reason: "first_allowed_workspace",
          suggested_path: readyWorkspace,
          message:
            "Requested path is unavailable. Try the daemon default workspace instead.",
        },
      },
    });
  });

  it("returns nearest existing ancestor repair hints for missing workspaces", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "hellobug-workspace-resolve-missing-"),
    );
    const readyWorkspace = join(root, "ready");
    const movedWorkspace = join(readyWorkspace, "moved-project");
    await mkdir(readyWorkspace, { recursive: true });

    const service = new DaemonWorkspaceService({
      allowedPaths: [readyWorkspace],
    });

    const response = await service.handleWorkspaceResolveRequest({
      v: 1,
      id: "workspace-resolve-missing-1",
      type: "workspace.resolve",
      payload: {
        workspace_path: join(movedWorkspace, "src"),
      },
    });

    expect(response).toEqual({
      v: 1,
      id: "workspace-resolve-missing-1",
      type: "workspace.resolve",
      payload: {
        workspace_path: join(movedWorkspace, "src"),
        resolved_path: join(movedWorkspace, "src"),
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
          suggested_path: readyWorkspace,
          message:
            "Requested path is unavailable. Try the nearest existing directory instead.",
        },
      },
    });
  });

  it("reports git branch metadata for ready workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "hellobug-workspace-git-"));
    const gitDir = join(root, ".git");
    await mkdir(join(gitDir, "refs", "heads", "feature"), { recursive: true });
    await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/feature/pairing\n");
    await writeFile(join(gitDir, "refs", "heads", "feature", "pairing"), "abc");
    await writeFile(join(root, "pubspec.yaml"), "name: demo\n");

    const service = new DaemonWorkspaceService({
      allowedPaths: [root],
    });

    const response = await service.handleWorkspaceResolveRequest({
      v: 1,
      id: "workspace-resolve-git-1",
      type: "workspace.resolve",
      payload: {
        workspace_path: root,
      },
    });

    expect(response.payload.repo_root).toBe(root);
    expect(response.payload.git_branch).toBe("feature/pairing");
    expect(response.payload.is_empty).toBe(false);
    expect(response.payload.status_reason).toBe("ok");
    expect(response.payload.access_mode).toBe("read_write");
  });

  it("marks fs.tree entries as modified when git status reports changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "hellobug-workspace-tree-git-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export const answer = 42;\n");
    await writeFile(join(root, "README.md"), "# HelloBug\n");
    await writeFile(join(root, "notes.txt"), "clean\n");
    await execFileAsync("git", ["-C", root, "init", "-q"]);
    await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", root, "config", "user.name", "HelloBug Test"]);
    await execFileAsync("git", ["-C", root, "add", "."]);
    await execFileAsync("git", ["-C", root, "commit", "-qm", "init"]);
    await writeFile(join(root, "src", "index.ts"), "export const answer = 43;\n");
    await writeFile(join(root, "README.md"), "# HelloBug modified\n");

    const service = new DaemonWorkspaceService({
      allowedPaths: [root],
      sessions: createSessionLookup(root),
    });

    const tree = await service.handleTreeRequest({
      v: 1,
      id: "tree-git-1",
      type: "fs.tree.req",
      payload: {
        session_id: "sess-1",
        workspace_path: root,
        dir_path: "",
      },
    });

    expect(tree.payload.entries).toEqual([
      {
        name: "src",
        path: "src",
        type: "dir",
        modified: true,
        size: 0,
      },
      {
        name: "notes.txt",
        path: "notes.txt",
        type: "file",
        modified: false,
        size: 6,
      },
      {
        name: "README.md",
        path: "README.md",
        type: "file",
        modified: true,
        size: 20,
      },
    ]);

    const nestedTree = await service.handleTreeRequest({
      v: 1,
      id: "tree-git-2",
      type: "fs.tree.req",
      payload: {
        session_id: "sess-1",
        workspace_path: root,
        dir_path: "src",
      },
    });

    expect(nestedTree.payload.entries).toEqual([
      {
        name: "index.ts",
        path: "src/index.ts",
        type: "file",
        modified: true,
        size: 26,
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
