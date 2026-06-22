import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

import type { Message } from "@hellobug/protocol";

type SessionInputImagePayload = Extract<Message, { type: "session.input.image" }>["payload"];

export interface CompletedImageUpload {
  filePath: string;
  imageId: string;
  mimeType: string;
  totalChunks: number;
  totalSize: number;
}

interface PendingImageUpload {
  sessionId: string;
  imageId: string;
  mimeType: string;
  totalChunks: number;
  chunks: Array<Buffer | undefined>;
  totalSize: number;
}

export class SessionImageUploadStore {
  private readonly uploads = new Map<string, PendingImageUpload>();
  private readonly rootDir: string;

  constructor(rootDir = join(tmpdir(), "hellobug")) {
    this.rootDir = resolve(rootDir);
  }

  async appendChunk(payload: SessionInputImagePayload): Promise<CompletedImageUpload | null> {
    if (payload.chunk_index >= payload.total_chunks) {
      throw new Error(
        `Image chunk index ${payload.chunk_index} is outside total_chunks ${payload.total_chunks}`,
      );
    }

    const key = this.getUploadKey(payload.session_id, payload.image_id);
    const upload =
      this.uploads.get(key) ??
      this.createUpload(payload.session_id, payload.image_id, payload.mime_type, payload.total_chunks);

    if (upload.totalChunks !== payload.total_chunks) {
      throw new Error(`Image upload total_chunks changed for ${payload.image_id}`);
    }
    if (upload.mimeType !== payload.mime_type) {
      throw new Error(`Image upload mime_type changed for ${payload.image_id}`);
    }

    const chunk = Buffer.from(payload.data, "base64url");
    const existing = upload.chunks[payload.chunk_index];
    if (existing) {
      upload.totalSize -= existing.byteLength;
    }

    upload.chunks[payload.chunk_index] = chunk;
    upload.totalSize += chunk.byteLength;
    this.uploads.set(key, upload);

    if (upload.chunks.some((item) => item === undefined)) {
      return null;
    }

    const completed = await this.persistUpload(upload);
    this.uploads.delete(key);
    return completed;
  }

  async cleanupSession(sessionId: string): Promise<void> {
    for (const key of this.uploads.keys()) {
      if (key.startsWith(`${sessionId}::`)) {
        this.uploads.delete(key);
      }
    }

    await rm(this.getSessionDir(sessionId), {
      recursive: true,
      force: true,
    });
  }

  private createUpload(
    sessionId: string,
    imageId: string,
    mimeType: string,
    totalChunks: number,
  ): PendingImageUpload {
    return {
      sessionId,
      imageId,
      mimeType,
      totalChunks,
      chunks: Array.from({ length: totalChunks }),
      totalSize: 0,
    };
  }

  private async persistUpload(upload: PendingImageUpload): Promise<CompletedImageUpload> {
    const sessionDir = this.getSessionDir(upload.sessionId);
    await mkdir(sessionDir, { recursive: true });

    const extension = getExtensionFromMime(upload.mimeType);
    const filePath = join(sessionDir, `${safeFileSegment(upload.imageId)}${extension}`);
    await writeFile(filePath, Buffer.concat(upload.chunks as Buffer[]));

    return {
      filePath,
      imageId: upload.imageId,
      mimeType: upload.mimeType,
      totalChunks: upload.totalChunks,
      totalSize: upload.totalSize,
    };
  }

  private getUploadKey(sessionId: string, imageId: string): string {
    return `${sessionId}::${imageId}`;
  }

  private getSessionDir(sessionId: string): string {
    return join(this.rootDir, safeFileSegment(sessionId));
  }
}

function getExtensionFromMime(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
  };

  if (extensions[mimeType]) {
    return extensions[mimeType];
  }

  const fallback = mimeType.split("/")[1]?.trim();
  if (!fallback) {
    return ".bin";
  }

  const normalized = fallback.replace(/[^a-zA-Z0-9.-]/g, "");
  if (!normalized) {
    return ".bin";
  }

  return extname(`file.${normalized}`) || `.${normalized}`;
}

function safeFileSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}
