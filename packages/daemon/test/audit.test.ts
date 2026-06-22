import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EncryptedAuditLogger } from "../src/audit/logger.js";
import { DeviceKeyStore } from "../src/crypto/keys.js";

describe("encrypted audit logger", () => {
  it("writes encrypted daily jsonl records and can read them back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-audit-"));
    const identity = await new DeviceKeyStore(join(dir, "device.key")).loadOrCreate();
    const logger = new EncryptedAuditLogger(identity, {
      rootDir: join(dir, "audit"),
      now: () => new Date("2026-06-22T12:00:00.000Z"),
    });

    await logger.appendAuditEntry({
      session_id: "session-1",
      event_type: "session.start",
      summary: "agent=claude_code workspace=/tmp/workspace",
    });
    await logger.appendAuditEntry({
      session_id: "session-1",
      event_type: "tool.use",
      summary: "tool=Bash input_sha256=abc verdict=allowed",
    });

    const filePath = join(dir, "audit", "2026-06-22.jsonl");
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("session.start");
    expect(raw).not.toContain("/tmp/workspace");

    const entries = await logger.readAuditLog("2026-06-22");
    expect(entries).toEqual([
      expect.objectContaining({
        session_id: "session-1",
        event_type: "session.start",
        summary: "agent=claude_code workspace=/tmp/workspace",
      }),
      expect.objectContaining({
        session_id: "session-1",
        event_type: "tool.use",
        summary: "tool=Bash input_sha256=abc verdict=allowed",
      }),
    ]);
  });

  it("removes expired log files during append", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-audit-retention-"));
    const identity = await new DeviceKeyStore(join(dir, "device.key")).loadOrCreate();
    const auditDir = join(dir, "audit");
    const logger = new EncryptedAuditLogger(identity, {
      rootDir: auditDir,
      retentionDays: 30,
      now: () => new Date("2026-06-22T12:00:00.000Z"),
    });

    await mkdir(auditDir, { recursive: true });
    await writeFile(join(auditDir, "2026-05-01.jsonl"), "stale\n", "utf8");
    await logger.appendAuditEntry({
      session_id: "session-2",
      event_type: "session.done",
      summary: "exit_code=0 duration_ms=1",
    });

    await expect(readFile(join(auditDir, "2026-05-01.jsonl"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
