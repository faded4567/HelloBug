import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { Message } from "@hellobug/protocol";

import { WorkspaceFence } from "../guard/fence.js";
import { toBase64Url } from "../lib/base64url.js";
import { resolveUserPath } from "../lib/user-path.js";
import { DaemonSessionError, type SessionHandle } from "../sessions/manager.js";

type FsTreeReqMessage = Extract<Message, { type: "fs.tree.req" }>;
type FsFileReqMessage = Extract<Message, { type: "fs.file.req" }>;
type FsTreeMessage = Extract<Message, { type: "fs.tree" }>;
type FsFileMessage = Extract<Message, { type: "fs.file" }>;
type WorkspaceListReqMessage = Extract<Message, { type: "workspace.list" }>;
type WorkspaceResolveReqMessage = Extract<
  Message,
  { type: "workspace.resolve" }
>;
type WorkspaceListMessage = Extract<Message, { type: "workspace.list" }>;
type WorkspaceResolveMessage = Extract<Message, { type: "workspace.resolve" }>;

type WorkspaceStatus = "ready" | "missing" | "forbidden" | "not_dir";
type WorkspaceStatusReason =
  | "ok"
  | "not_found"
  | "not_directory"
  | "outside_allowed_paths"
  | "permission_denied";
type WorkspaceAccessMode = "read_write" | "read_only" | "no_access" | "unknown";
type WorkspaceRepairHintReason =
  | "default_workspace"
  | "nearest_existing_ancestor"
  | "first_allowed_workspace"
  | "same_name_match"
  | "fix_permissions";
type WorkspaceRepairHint = {
  reason: WorkspaceRepairHintReason;
  suggested_path: string | null;
  message: string;
};
type DaemonWorkspaceSummary = {
  path: string;
  name: string;
  status: WorkspaceStatus;
  status_reason: WorkspaceStatusReason;
  is_default: boolean;
  entry_count: number | null;
  is_empty: boolean | null;
  repo_root: string | null;
  git_branch: string | null;
  access_mode: WorkspaceAccessMode;
};

const FILE_CHUNK_SIZE = 200 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const execFileAsync = promisify(execFile);
const FILTERED_TREE_ENTRY_NAMES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".DS_Store",
]);

const TEXT_MIME_TYPES = new Map<string, string>([
  [".c", "text/x-c"],
  [".cc", "text/x-c++"],
  [".cpp", "text/x-c++"],
  [".css", "text/css"],
  [".dart", "text/x-dart"],
  [".go", "text/x-go"],
  [".h", "text/x-c"],
  [".html", "text/html"],
  [".java", "text/x-java-source"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".jsx", "text/jsx"],
  [".kt", "text/x-kotlin"],
  [".log", "text/plain"],
  [".m", "text/x-objective-c"],
  [".md", "text/markdown"],
  [".py", "text/x-python"],
  [".rb", "text/x-ruby"],
  [".rs", "text/x-rust"],
  [".sh", "text/x-shellscript"],
  [".sql", "text/x-sql"],
  [".svg", "image/svg+xml"],
  [".swift", "text/x-swift"],
  [".toml", "application/toml"],
  [".ts", "text/typescript"],
  [".tsx", "text/tsx"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

interface SessionLookup {
  get(sessionId: string): SessionHandle | undefined;
}

export interface DaemonWorkspaceServiceOptions {
  allowedPaths?: string[];
  sessions?: SessionLookup;
}

interface WorkspaceGitMetadata {
  repo_root: string | null;
  git_branch: string | null;
  modified_paths: Set<string> | null;
}

export class DaemonWorkspaceService {
  private readonly workspaceFence: WorkspaceFence;

  constructor(private readonly options: DaemonWorkspaceServiceOptions) {
    this.workspaceFence = new WorkspaceFence(options.allowedPaths ?? []);
  }

  async handleTreeRequest(message: FsTreeReqMessage): Promise<FsTreeMessage> {
    const workspaceRoot = this.getWorkspaceRoot(message.payload.session_id);
    const requestedDir = this.resolveRequestedDir(message, workspaceRoot);
    this.assertWithinWorkspace(workspaceRoot, requestedDir);
    const gitMetadata = await inspectWorkspaceGitMetadata(workspaceRoot);

    const dirEntries = await this.readDirectory(requestedDir);
    const entries = await Promise.all(
      dirEntries.map(async (entry) => {
        if (FILTERED_TREE_ENTRY_NAMES.has(entry.name)) {
          return null;
        }

        if (!entry.isDirectory() && !entry.isFile()) {
          return null;
        }

        const absolutePath = resolve(requestedDir, entry.name);
        const entryStat = await this.readStat(
          absolutePath,
          `Unable to stat path: ${toPortableRelativePath(workspaceRoot, absolutePath) || "."}`,
        );
        return {
          name: entry.name,
          path: toPortableRelativePath(workspaceRoot, absolutePath),
          type: entry.isDirectory() ? "dir" : "file",
          modified: getTreeEntryModifiedState(
            gitMetadata,
            absolutePath,
            entry.isDirectory() ? "dir" : "file",
          ),
          size: entry.isDirectory() ? 0 : entryStat.size,
        } satisfies FsTreeMessage["payload"]["entries"][number];
      }),
    );

    const sortedEntries = entries
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === "dir" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    return {
      v: 1,
      id: message.id,
      type: "fs.tree",
      payload: {
        session_id: message.payload.session_id,
        workspace_path: message.payload.workspace_path,
        dir_path: toPortableRelativePath(workspaceRoot, requestedDir),
        entries: sortedEntries,
      },
    };
  }

  async handleFileRequest(message: FsFileReqMessage): Promise<FsFileMessage[]> {
    const workspaceRoot = this.getWorkspaceRoot(message.payload.session_id);
    const requestedFile = this.resolveRequestedFile(
      message.payload.file_path,
      workspaceRoot,
    );
    this.assertWithinWorkspace(workspaceRoot, requestedFile);

    const mimeType = guessMimeType(requestedFile);

    let fileStat;
    try {
      fileStat = await stat(requestedFile);
    } catch (error) {
      const fileStatus = mapFilePreviewStatus(error);
      if (fileStatus) {
        return [
          this.buildFileStateMessage(message, {
            status: fileStatus,
            mimeType: null,
            totalSize: null,
            message:
              fileStatus === "permission_denied"
                ? `Unable to read file: ${message.payload.file_path}`
                : `File not found: ${message.payload.file_path}`,
          }),
        ];
      }
      throw this.mapFsError(
        error,
        `Unable to stat file: ${message.payload.file_path}`,
      );
    }

    if (!fileStat.isFile()) {
      return [
        this.buildFileStateMessage(message, {
          status: "not_found",
          mimeType,
          totalSize: null,
          message: `Not a file: ${message.payload.file_path}`,
        }),
      ];
    }

    if (fileStat.size > MAX_TEXT_PREVIEW_BYTES) {
      return [
        {
          v: 1,
          id: message.id,
          type: "fs.file",
          payload: {
            session_id: message.payload.session_id,
            file_path: message.payload.file_path,
            status: "too_large",
            mime_type: mimeType,
            total_size: fileStat.size,
            max_preview_size: MAX_TEXT_PREVIEW_BYTES,
            message: `File is too large to preview: ${message.payload.file_path}`,
          },
        },
      ];
    }

    let content;
    try {
      content = await readFile(requestedFile);
    } catch (error) {
      const fileStatus = mapFilePreviewStatus(error);
      if (fileStatus) {
        return [
          this.buildFileStateMessage(message, {
            status: fileStatus,
            mimeType,
            totalSize: fileStat.size,
            message:
              fileStatus === "permission_denied"
                ? `Unable to read file: ${message.payload.file_path}`
                : `File not found: ${message.payload.file_path}`,
          }),
        ];
      }
      throw this.mapFsError(
        error,
        `Unable to read file: ${message.payload.file_path}`,
      );
    }

    if (isBinaryContent(content)) {
      return [
        {
          v: 1,
          id: message.id,
          type: "fs.file",
          payload: {
            session_id: message.payload.session_id,
            file_path: message.payload.file_path,
            status: "binary",
            mime_type: mimeType,
            total_size: content.byteLength,
            message: `Binary file cannot be previewed as text: ${message.payload.file_path}`,
          },
        },
      ];
    }

    const totalSize = content.byteLength;
    const totalChunks = Math.max(1, Math.ceil(totalSize / FILE_CHUNK_SIZE));
    const startChunk = Math.min(
      message.payload.chunk_index ?? 0,
      Math.max(totalChunks - 1, 0),
    );
    const filePath = message.payload.file_path;

    const messages: FsFileMessage[] = [];
    for (
      let chunkIndex = startChunk;
      chunkIndex < totalChunks;
      chunkIndex += 1
    ) {
      const start = chunkIndex * FILE_CHUNK_SIZE;
      const end = Math.min(start + FILE_CHUNK_SIZE, totalSize);
      messages.push({
        v: 1,
        id: message.id,
        type: "fs.file",
        payload: {
          session_id: message.payload.session_id,
          file_path: filePath,
          status: "ready",
          mime_type: mimeType,
          chunk_index: chunkIndex,
          total_chunks: totalChunks,
          data: toBase64Url(content.subarray(start, end)),
          total_size: totalSize,
        },
      });
    }

    return messages;
  }

  async handleWorkspaceListRequest(
    message: WorkspaceListReqMessage,
  ): Promise<WorkspaceListMessage> {
    const items = await Promise.all(
      this.getAllowedWorkspaceRoots().map((workspacePath, index) =>
        this.inspectWorkspace(workspacePath, {
          isDefault: index === 0,
        }),
      ),
    );

    return {
      v: 1,
      id: message.id,
      type: "workspace.list",
      payload: {
        default_path: items[0]?.path ?? null,
        items,
      },
    };
  }

  async handleWorkspaceResolveRequest(
    message: WorkspaceResolveReqMessage,
  ): Promise<WorkspaceResolveMessage> {
    const resolvedPath = this.resolveWorkspaceCandidate(
      message.payload.workspace_path,
    );
    const defaultPath = this.getDefaultWorkspaceRoot();
    const summary = await this.inspectWorkspace(resolvedPath, {
      isDefault: defaultPath === resolvedPath,
    });
    const repairHint = await this.buildWorkspaceRepairHint({
      requestedPath: message.payload.workspace_path,
      resolvedPath,
      defaultPath,
      summary,
    });

    return {
      v: 1,
      id: message.id,
      type: "workspace.resolve",
      payload: {
        workspace_path: message.payload.workspace_path,
        resolved_path: resolvedPath,
        name: summary.name,
        status: summary.status,
        status_reason: summary.status_reason,
        is_default: summary.is_default,
        entry_count: summary.entry_count,
        is_empty: summary.is_empty,
        repo_root: summary.repo_root,
        git_branch: summary.git_branch,
        access_mode: summary.access_mode,
        ...(repairHint ? { repair_hint: repairHint } : {}),
      },
    };
  }

  private getWorkspaceRoot(sessionId: string): string {
    const session = this.options.sessions?.get(sessionId);
    if (!session) {
      throw new DaemonSessionError(
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
      );
    }

    const workspaceRoot = resolveUserPath(session.workspacePath);
    this.assertAllowedPath(
      workspaceRoot,
      `Workspace is outside allowed paths: ${workspaceRoot}`,
    );
    return workspaceRoot;
  }

  private getAllowedWorkspaceRoots(): string[] {
    const roots = this.options.allowedPaths ?? [];
    const unique = new Set<string>();
    for (const root of roots) {
      const resolvedRoot = resolveUserPath(root);
      unique.add(resolvedRoot);
    }
    return Array.from(unique);
  }

  private getDefaultWorkspaceRoot(): string | null {
    return this.getAllowedWorkspaceRoots()[0] ?? null;
  }

  private resolveWorkspaceCandidate(workspacePath: string): string {
    const trimmed = workspacePath.trim();
    if (trimmed.length > 0) {
      return resolveUserPath(trimmed);
    }

    const fallback = this.getDefaultWorkspaceRoot();
    if (fallback) {
      return fallback;
    }

    return resolveUserPath("~");
  }

  private resolveRequestedDir(
    message: FsTreeReqMessage,
    workspaceRoot: string,
  ): string {
    const requestedWorkspace = resolveUserPath(message.payload.workspace_path);
    if (message.payload.dir_path.trim().length > 0) {
      return resolve(workspaceRoot, message.payload.dir_path);
    }

    if (requestedWorkspace !== workspaceRoot) {
      return requestedWorkspace;
    }

    return workspaceRoot;
  }

  private resolveRequestedFile(
    filePath: string,
    workspaceRoot: string,
  ): string {
    if (
      isAbsolute(filePath) ||
      filePath === "~" ||
      filePath.startsWith("~/") ||
      filePath.startsWith("~\\")
    ) {
      return resolveUserPath(filePath);
    }

    return resolve(workspaceRoot, filePath);
  }

  private assertWithinWorkspace(
    workspaceRoot: string,
    targetPath: string,
  ): void {
    this.assertAllowedPath(
      targetPath,
      `Path is outside allowed paths: ${targetPath}`,
    );

    const diff = relative(workspaceRoot, targetPath);
    if (diff.startsWith("..") || diff.startsWith("/")) {
      throw new DaemonSessionError(
        "WORKSPACE_FORBIDDEN",
        `Path is outside workspace: ${targetPath}`,
      );
    }
  }

  private assertAllowedPath(targetPath: string, message: string): void {
    if (!this.workspaceFence.isAllowed(targetPath)) {
      throw new DaemonSessionError("WORKSPACE_FORBIDDEN", message);
    }
  }

  private async readDirectory(directoryPath: string) {
    try {
      return await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw this.mapFsError(
        error,
        `Unable to read directory: ${directoryPath}`,
      );
    }
  }

  private async readStat(targetPath: string, message: string) {
    try {
      return await stat(targetPath);
    } catch (error) {
      throw this.mapFsError(error, message);
    }
  }

  private async readFile(targetPath: string, message: string) {
    try {
      return await readFile(targetPath);
    } catch (error) {
      throw this.mapFsError(error, message);
    }
  }

  private mapFsError(error: unknown, message: string): DaemonSessionError {
    if (error instanceof DaemonSessionError) {
      return error;
    }

    const code = getFsErrorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      return new DaemonSessionError("WORKSPACE_FORBIDDEN", message);
    }

    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return new DaemonSessionError("PROTOCOL_VERSION", message);
    }

    return new DaemonSessionError("PROTOCOL_VERSION", message);
  }

  private buildFileStateMessage(
    message: FsFileReqMessage,
    options: {
      status: "binary" | "too_large" | "permission_denied" | "not_found";
      mimeType: string | null;
      totalSize: number | null;
      message: string;
    },
  ): FsFileMessage {
    if (options.status === "too_large") {
      return {
        v: 1,
        id: message.id,
        type: "fs.file",
        payload: {
          session_id: message.payload.session_id,
          file_path: message.payload.file_path,
          status: "too_large",
          mime_type: options.mimeType ?? "application/octet-stream",
          total_size: options.totalSize ?? 0,
          max_preview_size: MAX_TEXT_PREVIEW_BYTES,
          message: options.message,
        },
      };
    }

    if (options.status === "binary") {
      return {
        v: 1,
        id: message.id,
        type: "fs.file",
        payload: {
          session_id: message.payload.session_id,
          file_path: message.payload.file_path,
          status: "binary",
          mime_type: options.mimeType ?? "application/octet-stream",
          total_size: options.totalSize ?? 0,
          message: options.message,
        },
      };
    }

    return {
      v: 1,
      id: message.id,
      type: "fs.file",
      payload: {
        session_id: message.payload.session_id,
        file_path: message.payload.file_path,
        status: options.status,
        mime_type: options.mimeType,
        total_size: options.totalSize,
        message: options.message,
      },
    };
  }

  private async buildWorkspaceRepairHint(options: {
    requestedPath: string;
    resolvedPath: string;
    defaultPath: string | null;
    summary: DaemonWorkspaceSummary;
  }): Promise<WorkspaceRepairHint | undefined> {
    if (options.summary.status === "ready") {
      return undefined;
    }

    if (
      options.summary.status === "forbidden" &&
      options.summary.status_reason === "permission_denied"
    ) {
      return {
        reason: "fix_permissions",
        suggested_path: options.resolvedPath,
        message:
          "Workspace exists but daemon lacks permission to access it. Fix permissions on this path and retry.",
      };
    }

    if (
      options.summary.status === "missing" ||
      options.summary.status === "not_dir"
    ) {
      const nearestAncestor = await findNearestExistingDirectory(
        options.resolvedPath,
      );
      if (
        nearestAncestor &&
        nearestAncestor !== options.resolvedPath &&
        this.workspaceFence.isAllowed(nearestAncestor)
      ) {
        return {
          reason: "nearest_existing_ancestor",
          suggested_path: nearestAncestor,
          message:
            "Requested path is unavailable. Try the nearest existing directory instead.",
        };
      }
    }

    const allowedRoots = this.getAllowedWorkspaceRoots();
    const sameNameMatch = findSameNameWorkspaceMatch(
      options.resolvedPath,
      allowedRoots,
    );
    if (sameNameMatch && sameNameMatch !== options.resolvedPath) {
      return {
        reason: "same_name_match",
        suggested_path: sameNameMatch,
        message:
          "Found an allowed workspace with the same folder name. Try switching to that path.",
      };
    }

    if (
      options.defaultPath &&
      options.defaultPath !== options.resolvedPath &&
      allowedRoots.includes(options.defaultPath)
    ) {
      return {
        reason: options.requestedPath.trim().length === 0
          ? "default_workspace"
          : "first_allowed_workspace",
        suggested_path: options.defaultPath,
        message:
          "Requested path is unavailable. Try the daemon default workspace instead.",
      };
    }

    return undefined;
  }

  private async inspectWorkspace(
    resolvedPath: string,
    options: {
      isDefault: boolean;
    },
  ): Promise<DaemonWorkspaceSummary> {
    const name = getWorkspaceName(resolvedPath);
    const base = {
      path: resolvedPath,
      name,
      is_default: options.isDefault,
    } as const;

    if (!this.workspaceFence.isAllowed(resolvedPath)) {
      return {
        ...base,
        status: "forbidden",
        status_reason: "outside_allowed_paths",
        entry_count: null,
        is_empty: null,
        repo_root: null,
        git_branch: null,
        access_mode: "no_access",
      };
    }

    let workspaceStat;
    try {
      workspaceStat = await stat(resolvedPath);
    } catch (error) {
      const failure = mapWorkspaceInspectionFailure(error);
      if (failure) {
        return {
          ...base,
          status: failure.status,
          status_reason: failure.status_reason,
          entry_count: null,
          is_empty: null,
          repo_root: null,
          git_branch: null,
          access_mode:
            failure.status === "forbidden" ? "no_access" : "unknown",
        };
      }
      throw this.mapFsError(error, `Unable to inspect workspace: ${resolvedPath}`);
    }

    if (!workspaceStat.isDirectory()) {
      return {
        ...base,
        status: "not_dir",
        status_reason: "not_directory",
        entry_count: null,
        is_empty: null,
        repo_root: null,
        git_branch: null,
        access_mode: "unknown",
      };
    }

    try {
      const entries = await readdir(resolvedPath, { withFileTypes: true });
      const gitMetadata = await inspectWorkspaceGitMetadata(resolvedPath);
      const accessMode = await detectWorkspaceAccessMode(resolvedPath);
      return {
        ...base,
        status: "ready",
        status_reason: "ok",
        entry_count: entries.length,
        is_empty: isWorkspaceEmpty(entries.map((entry) => entry.name)),
        repo_root: gitMetadata.repo_root,
        git_branch: gitMetadata.git_branch,
        access_mode: accessMode,
      };
    } catch (error) {
      const failure = mapWorkspaceInspectionFailure(error);
      if (failure) {
        return {
          ...base,
          status: failure.status,
          status_reason: failure.status_reason,
          entry_count: null,
          is_empty: null,
          repo_root: null,
          git_branch: null,
          access_mode:
            failure.status === "forbidden" ? "no_access" : "unknown",
        };
      }
      throw this.mapFsError(error, `Unable to inspect workspace: ${resolvedPath}`);
    }
  }
}

async function inspectWorkspaceGitMetadata(workspacePath: string): Promise<{
  repo_root: string | null;
  git_branch: string | null;
  modified_paths: Set<string> | null;
}> {
  let current = workspacePath;
  while (true) {
    const gitDir = await resolveGitDir(current);
    if (gitDir) {
      const modifiedPaths = await readGitModifiedPaths(current);
      return {
        repo_root: current,
        git_branch: await readGitBranch(gitDir),
        modified_paths: modifiedPaths,
      };
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      return {
        repo_root: null,
        git_branch: null,
        modified_paths: null,
      };
    }
    current = parent;
  }
}

async function readGitModifiedPaths(repoRoot: string): Promise<Set<string> | null> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      repoRoot,
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]);
    const paths = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      if (line.length < 4) {
        continue;
      }

      const rawPath = line.slice(3).trim();
      if (!rawPath) {
        continue;
      }

      const normalizedPath = normalizePorcelainPath(rawPath);
      if (!normalizedPath) {
        continue;
      }

      paths.add(resolve(repoRoot, normalizedPath));
    }
    return paths;
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (text.includes("not a git repository") || text.includes("command not found")) {
      return null;
    }
    return null;
  }
}

async function resolveGitDir(repoRoot: string): Promise<string | null> {
  const gitPath = join(repoRoot, ".git");
  try {
    const gitStat = await stat(gitPath);
    if (gitStat.isDirectory()) {
      return gitPath;
    }
    if (!gitStat.isFile()) {
      return null;
    }

    const raw = await readFile(gitPath, "utf8");
    const match = /^gitdir:\s*(.+)\s*$/im.exec(raw);
    if (!match?.[1]) {
      return null;
    }
    return resolve(repoRoot, match[1].trim());
  } catch (error) {
    const code = getFsErrorCode(error);
    if (
      code === "ENOENT" ||
      code === "ENOTDIR" ||
      code === "EACCES" ||
      code === "EPERM"
    ) {
      return null;
    }
    throw error;
  }
}

async function readGitBranch(gitDir: string): Promise<string | null> {
  try {
    const head = (await readFile(join(gitDir, "HEAD"), "utf8")).trim();
    if (head.startsWith("ref:")) {
      const refName = head.slice("ref:".length).trim();
      return refName.startsWith("refs/heads/")
        ? refName.slice("refs/heads/".length)
        : refName;
    }
    return head.length >= 7 ? `detached:${head.slice(0, 7)}` : null;
  } catch (error) {
    const code = getFsErrorCode(error);
    if (
      code === "ENOENT" ||
      code === "ENOTDIR" ||
      code === "EACCES" ||
      code === "EPERM"
    ) {
      return null;
    }
    throw error;
  }
}

function isWorkspaceEmpty(entryNames: string[]): boolean {
  return entryNames.every((name) => FILTERED_TREE_ENTRY_NAMES.has(name));
}

async function detectWorkspaceAccessMode(
  workspacePath: string,
): Promise<WorkspaceAccessMode> {
  try {
    await access(workspacePath, fsConstants.R_OK | fsConstants.W_OK);
    return "read_write";
  } catch {
    try {
      await access(workspacePath, fsConstants.R_OK);
      return "read_only";
    } catch (error) {
      const code = getFsErrorCode(error);
      if (code === "EACCES" || code === "EPERM") {
        return "no_access";
      }
      return "unknown";
    }
  }
}

async function findNearestExistingDirectory(
  targetPath: string,
): Promise<string | null> {
  let current = targetPath;
  while (true) {
    try {
      const currentStat = await stat(current);
      if (currentStat.isDirectory()) {
        return current;
      }
    } catch (error) {
      const code = getFsErrorCode(error);
      if (code === "EACCES" || code === "EPERM") {
        return null;
      }
      if (
        code !== "ENOENT" &&
        code !== "ENOTDIR" &&
        code !== "EISDIR"
      ) {
        throw error;
      }
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findSameNameWorkspaceMatch(
  requestedPath: string,
  candidates: string[],
): string | null {
  const requestedName = basename(requestedPath).trim().toLowerCase();
  if (!requestedName) {
    return null;
  }

  for (const candidate of candidates) {
    if (basename(candidate).trim().toLowerCase() === requestedName) {
      return candidate;
    }
  }
  return null;
}

function getTreeEntryModifiedState(
  gitMetadata: WorkspaceGitMetadata,
  absolutePath: string,
  type: "file" | "dir",
): boolean | null {
  if (!gitMetadata.repo_root || !gitMetadata.modified_paths) {
    return null;
  }

  if (type === "file") {
    return gitMetadata.modified_paths.has(absolutePath);
  }

  const prefix = `${absolutePath}/`;
  for (const modifiedPath of gitMetadata.modified_paths) {
    if (modifiedPath === absolutePath || modifiedPath.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function toPortableRelativePath(
  workspaceRoot: string,
  targetPath: string,
): string {
  const diff = relative(workspaceRoot, targetPath);
  if (!diff || diff === ".") {
    return "";
  }
  return diff.split("\\").join("/");
}

function guessMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return TEXT_MIME_TYPES.get(ext) ?? "application/octet-stream";
}

function normalizePorcelainPath(rawPath: string): string {
  const renamed = rawPath.split(" -> ").pop()?.trim() ?? "";
  const unquoted =
    renamed.startsWith('"') && renamed.endsWith('"')
      ? renamed.slice(1, -1)
      : renamed;
  return unquoted.replaceAll("\\/", "/");
}

function getWorkspaceName(workspacePath: string): string {
  return basename(workspacePath) || workspacePath;
}

function isBinaryContent(content: Buffer): boolean {
  if (content.length === 0) {
    return false;
  }

  const sampleSize = Math.min(content.length, 8 * 1024);
  let suspicious = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const byte = content[index];
    if (byte === undefined) {
      continue;
    }
    if (byte === 0) {
      return true;
    }
    const isCommonWhitespace =
      byte === 9 || byte === 10 || byte === 13 || byte === 12;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isUtf8LeadOrTrail = byte >= 128;
    if (!isCommonWhitespace && !isPrintableAscii && !isUtf8LeadOrTrail) {
      suspicious += 1;
    }
  }

  return suspicious / sampleSize > 0.1;
}

function getFsErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : undefined;
}

function mapWorkspaceInspectionFailure(error: unknown): {
  status: WorkspaceStatus;
  status_reason: WorkspaceStatusReason;
} | null {
  const code = getFsErrorCode(error);
  if (code === "ENOENT") {
    return {
      status: "missing",
      status_reason: "not_found",
    };
  }
  if (code === "ENOTDIR" || code === "EISDIR") {
    return {
      status: "not_dir",
      status_reason: "not_directory",
    };
  }
  if (code === "EACCES" || code === "EPERM") {
    return {
      status: "forbidden",
      status_reason: "permission_denied",
    };
  }
  return null;
}

function mapFilePreviewStatus(
  error: unknown,
): "permission_denied" | "not_found" | null {
  const code = getFsErrorCode(error);
  if (code === "EACCES" || code === "EPERM") {
    return "permission_denied";
  }
  if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
    return "not_found";
  }
  return null;
}
