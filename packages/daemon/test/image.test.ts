import { access, mkdtemp, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionImageUploadStore } from "../src/fs/image.js";
import { toBase64Url } from "../src/lib/base64url.js";

describe("session image upload store", () => {
  it("assembles chunks into a temp image file and cleans it up", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "hellobug-image-store-"));
    const store = new SessionImageUploadStore(rootDir);

    const first = await store.appendChunk({
      session_id: "session-1",
      image_id: "image-1",
      chunk_index: 0,
      total_chunks: 2,
      mime_type: "image/jpeg",
      data: toBase64Url(Buffer.from("hello ")),
    });
    expect(first).toBeNull();

    const completed = await store.appendChunk({
      session_id: "session-1",
      image_id: "image-1",
      chunk_index: 1,
      total_chunks: 2,
      mime_type: "image/jpeg",
      data: toBase64Url(Buffer.from("world")),
    });

    expect(completed).not.toBeNull();
    expect(completed?.mimeType).toBe("image/jpeg");
    expect(completed?.filePath).toContain("session-1");
    expect(completed?.filePath).toContain("image-1.jpg");
    expect(await readFile(completed!.filePath, "utf8")).toBe("hello world");

    await store.cleanupSession("session-1");
    await expect(access(completed!.filePath, constants.F_OK)).rejects.toThrow();
  });

  it("rejects inconsistent image upload metadata", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "hellobug-image-store-"));
    const store = new SessionImageUploadStore(rootDir);

    await store.appendChunk({
      session_id: "session-2",
      image_id: "image-2",
      chunk_index: 0,
      total_chunks: 2,
      mime_type: "image/png",
      data: toBase64Url(Buffer.from("part-1")),
    });

    await expect(
      store.appendChunk({
        session_id: "session-2",
        image_id: "image-2",
        chunk_index: 1,
        total_chunks: 3,
        mime_type: "image/png",
        data: toBase64Url(Buffer.from("part-2")),
      }),
    ).rejects.toThrow("total_chunks changed");
  });
});
