import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { WorkspaceFence } from "../guard/fence.js";
import { resolveUserPath } from "../lib/user-path.js";
import { DaemonSessionError } from "../sessions/manager.js";

type HistoryListRequestMessage = {
  v: 1;
  id?: string;
  type: "history.list";
  payload: {
    workspace_path: string;
  };
};
type HistoryListResponseMessage = {
  v: 1;
  id?: string;
  type: "history.list";
  payload: {
    items: Array<{
      session_id: string;
      path: string;
      created_at: number;
      message_count: number;
    }>;
  };
};
type HistoryGetRequestMessage = {
  v: 1;
  id?: string;
  type: "history.get";
  payload: {
    session_id: string;
    offset: number;
    limit: number;
  };
};
type HistoryGetResponseMessage = {
  v: 1;
  id?: string;
  type: "history.get";
  payload: {
    session_id: string;
    offset: number;
    total: number;
    lines: string[];
  };
};

export interface DaemonTranscriptServiceOptions {
  allowedPaths?: string[];
  claudeProjectsDir?: string;
}

export class DaemonTranscriptService {
  private readonly workspaceFence: WorkspaceFence;
  private readonly claudeProjectsDir: string;
  private readonly transcriptPathBySessionId = new Map<string, string>();

  constructor(private readonly options: DaemonTranscriptServiceOptions) {
    this.workspaceFence = new WorkspaceFence(options.allowedPaths ?? []);
    this.claudeProjectsDir = resolve(
      options.claudeProjectsDir ?? join(homedir(), ".claude", "projects"),
    );
  }

  async handleListRequest(
    message: HistoryListRequestMessage,
  ): Promise<HistoryListResponseMessage> {
    const workspacePath = this.resolveAllowedWorkspace(
      message.payload.workspace_path,
    );
    const transcriptDir = this.getTranscriptDirForWorkspace(workspacePath);
    const fileEntries = await this.readTranscriptDirectory(transcriptDir);
    const items = await Promise.all(
      fileEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map(async (entry) =>
          this.buildHistorySummary(join(transcriptDir, entry.name)),
        ),
    );

    items.sort(
      (
        left: HistoryListResponseMessage["payload"]["items"][number],
        right: HistoryListResponseMessage["payload"]["items"][number],
      ) => right.created_at - left.created_at,
    );

    return {
      v: 1,
      id: message.id,
      type: "history.list",
      payload: {
        items,
      },
    };
  }

  async handleGetRequest(
    message: HistoryGetRequestMessage,
  ): Promise<HistoryGetResponseMessage> {
    const transcriptPath = await this.findTranscriptPath(
      message.payload.session_id,
    );
    const lines = await this.readTranscriptLines(transcriptPath);
    const offset = Math.min(message.payload.offset, lines.length);
    const limit = Math.max(0, message.payload.limit);

    return {
      v: 1,
      id: message.id,
      type: "history.get",
      payload: {
        session_id: message.payload.session_id,
        offset,
        total: lines.length,
        lines: lines.slice(offset, offset + limit),
      },
    };
  }

  private resolveAllowedWorkspace(workspacePath: string): string {
    const resolvedWorkspace = resolveUserPath(workspacePath);
    if (!this.workspaceFence.isAllowed(resolvedWorkspace)) {
      throw new DaemonSessionError(
        "WORKSPACE_FORBIDDEN",
        `Workspace is outside allowed paths: ${workspacePath}`,
      );
    }

    return resolvedWorkspace;
  }

  private getTranscriptDirForWorkspace(workspacePath: string): string {
    return join(this.claudeProjectsDir, toClaudeProjectSlug(workspacePath));
  }

  private async readTranscriptDirectory(directoryPath: string) {
    try {
      return await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      const code = getFsErrorCode(error);
      if (code === "ENOENT") {
        return [];
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new DaemonSessionError(
          "WORKSPACE_FORBIDDEN",
          `Unable to read transcript directory: ${directoryPath}`,
        );
      }
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Unable to read transcript directory: ${directoryPath}`,
      );
    }
  }

  private async buildHistorySummary(
    transcriptPath: string,
  ): Promise<HistoryListResponseMessage["payload"]["items"][number]> {
    const transcriptLines = await this.readTranscriptLines(transcriptPath);
    const transcriptStat = await this.readStat(transcriptPath);
    const sessionId = basename(transcriptPath, ".jsonl");
    this.transcriptPathBySessionId.set(sessionId, transcriptPath);

    return {
      session_id: sessionId,
      path: formatTranscriptPathForApp(transcriptPath),
      created_at:
        parseCreatedAtFromLines(transcriptLines) ??
        Math.round(transcriptStat.mtimeMs),
      message_count: transcriptLines.length,
    };
  }

  private async findTranscriptPath(sessionId: string): Promise<string> {
    const cachedPath = this.transcriptPathBySessionId.get(sessionId);
    if (cachedPath) {
      return cachedPath;
    }

    const transcriptFileName = `${sessionId}.jsonl`;
    const allowedPaths = this.options.allowedPaths ?? [];
    for (const allowedWorkspace of allowedPaths) {
      const transcriptPath = join(
        this.getTranscriptDirForWorkspace(resolveUserPath(allowedWorkspace)),
        transcriptFileName,
      );
      try {
        const transcriptStat = await stat(transcriptPath);
        if (transcriptStat.isFile()) {
          this.transcriptPathBySessionId.set(sessionId, transcriptPath);
          return transcriptPath;
        }
      } catch (error) {
        const code = getFsErrorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") {
          continue;
        }
        if (code === "EACCES" || code === "EPERM") {
          throw new DaemonSessionError(
            "WORKSPACE_FORBIDDEN",
            `Unable to read transcript: ${sessionId}`,
          );
        }
        throw new DaemonSessionError(
          "PROTOCOL_VERSION",
          `Unable to read transcript: ${sessionId}`,
        );
      }
    }

    throw new DaemonSessionError(
      "SESSION_NOT_FOUND",
      `Transcript not found: ${sessionId}`,
    );
  }

  private async readTranscriptLines(transcriptPath: string): Promise<string[]> {
    try {
      const raw = await readFile(transcriptPath, "utf8");
      return splitJsonl(raw);
    } catch (error) {
      const code = getFsErrorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new DaemonSessionError(
          "SESSION_NOT_FOUND",
          `Transcript not found: ${transcriptPath}`,
        );
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new DaemonSessionError(
          "WORKSPACE_FORBIDDEN",
          `Unable to read transcript: ${transcriptPath}`,
        );
      }
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Unable to read transcript: ${transcriptPath}`,
      );
    }
  }

  private async readStat(transcriptPath: string) {
    try {
      return await stat(transcriptPath);
    } catch (error) {
      const code = getFsErrorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new DaemonSessionError(
          "SESSION_NOT_FOUND",
          `Transcript not found: ${transcriptPath}`,
        );
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new DaemonSessionError(
          "WORKSPACE_FORBIDDEN",
          `Unable to stat transcript: ${transcriptPath}`,
        );
      }
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        `Unable to stat transcript: ${transcriptPath}`,
      );
    }
  }
}

function toClaudeProjectSlug(workspacePath: string): string {
  return workspacePath.replace(/[\\/]/g, "-");
}

function formatTranscriptPathForApp(transcriptPath: string): string {
  const homeDirectory = homedir();
  if (transcriptPath === homeDirectory) {
    return "~";
  }
  if (transcriptPath.startsWith(`${homeDirectory}/`)) {
    return `~/${transcriptPath.slice(homeDirectory.length + 1)}`;
  }
  return transcriptPath;
}

function splitJsonl(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseCreatedAtFromLines(lines: string[]): number | null {
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const timestamp = (parsed as Record<string, unknown>).timestamp;
      if (typeof timestamp !== "string") {
        continue;
      }

      const createdAt = Date.parse(timestamp);
      if (Number.isFinite(createdAt)) {
        return createdAt;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getFsErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" ? code : null;
}
