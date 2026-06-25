import { readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import type { Message } from "@hellobug/protocol";

import { WorkspaceFence } from "../guard/fence.js";
import { toBase64Url } from "../lib/base64url.js";
import { resolveUserPath } from "../lib/user-path.js";
import { DaemonSessionError, type SessionHandle } from "../sessions/manager.js";

type FsTreeReqMessage = Extract<Message, { type: "fs.tree.req" }>;
type FsFileReqMessage = Extract<Message, { type: "fs.file.req" }>;
type FsTreeMessage = Extract<Message, { type: "fs.tree" }>;
type FsFileMessage = Extract<Message, { type: "fs.file" }>;

const FILE_CHUNK_SIZE = 200 * 1024;

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

export class DaemonWorkspaceService {
  private readonly workspaceFence: WorkspaceFence;

  constructor(private readonly options: DaemonWorkspaceServiceOptions) {
    this.workspaceFence = new WorkspaceFence(options.allowedPaths ?? []);
  }

  async handleTreeRequest(message: FsTreeReqMessage): Promise<FsTreeMessage> {
    const workspaceRoot = this.getWorkspaceRoot(message.payload.session_id);
    const requestedDir = this.resolveRequestedDir(message, workspaceRoot);
    this.assertWithinWorkspace(workspaceRoot, requestedDir);

    const dirEntries = await this.readDirectory(requestedDir);
    const entries = await Promise.all(
      dirEntries.map(async (entry) => {
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
          modified: null,
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

    const fileStat = await this.readStat(
      requestedFile,
      `Unable to stat file: ${message.payload.file_path}`,
    );
    if (!fileStat.isFile()) {
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Not a file: ${message.payload.file_path}`,
      );
    }

    const content = await this.readFile(
      requestedFile,
      `Unable to read file: ${message.payload.file_path}`,
    );
    const totalSize = content.byteLength;
    const totalChunks = Math.max(1, Math.ceil(totalSize / FILE_CHUNK_SIZE));
    const startChunk = Math.min(
      message.payload.chunk_index ?? 0,
      Math.max(totalChunks - 1, 0),
    );
    const filePath = message.payload.file_path;
    const mimeType = guessMimeType(requestedFile);

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
        type: "fs.file",
        payload: {
          session_id: message.payload.session_id,
          file_path: filePath,
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

function getFsErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : undefined;
}
