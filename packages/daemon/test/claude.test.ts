import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseClaudeStreamEvent } from "../src/agents/claude-event-parser.js";
import { createClaudeSessionRuntime } from "../src/agents/claude.js";
import type { SessionEventBody } from "@hellobug/protocol";

describe("claude runtime", () => {
  it("maps real stream-json frames to protocol session events", () => {
    const assistant = parseClaudeStreamEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            text: "inspect files",
          },
          {
            type: "text",
            text: "hello",
          },
          {
            type: "tool_use",
            name: "Read",
            input: {
              file_path: "README.md",
            },
            id: "tool-1",
          },
        ],
      },
    });
    expect(assistant.events).toEqual([
      {
        event_type: "assistant.thinking",
        text: "inspect files",
      },
      {
        event_type: "assistant.delta",
        text: "hello",
      },
      {
        event_type: "tool.use",
        tool_name: "Read",
        tool_input: {
          file_path: "README.md",
        },
        tool_use_id: "tool-1",
      },
    ]);

    const toolResult = parseClaudeStreamEvent({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "ok",
            is_error: false,
          },
        ],
      },
    });
    expect(toolResult.events).toEqual([
      {
        event_type: "tool.result",
        tool_use_id: "tool-1",
        tool_name: "unknown",
        is_error: false,
        content: "ok",
      },
    ]);

    const replayedUserMessage = parseClaudeStreamEvent({
      type: "user",
      message: {
        role: "user",
        content: "hello",
      },
    });
    expect(replayedUserMessage.events).toEqual([]);

    const result = parseClaudeStreamEvent({
      type: "result",
      usage: {
        input_tokens: 12,
        output_tokens: 34,
        cache_read_input_tokens: 5,
      },
      total_cost_usd: 0.25,
      exit_code: 0,
    });
    expect(result.events).toEqual([
      {
        event_type: "session.usage",
        input_tokens: 12,
        output_tokens: 34,
        cache_read_tokens: 5,
        cost_usd: 0.25,
      },
    ]);
    expect(result.completion).toEqual({
      exitCode: 0,
    });
  });

  it("spawns a claude-like child process and emits events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-claude-"));
    const scriptPath = join(dir, "fake-claude.mjs");
    await writeFile(
      scriptPath,
      [
        'import { createInterface } from "node:readline";',
        'const resumeIndex = process.argv.indexOf("--resume");',
        'const resumeId = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : "none";',
        'const verbose = process.argv.includes("--verbose");',
        'const inputFormatIndex = process.argv.indexOf("--input-format");',
        'const inputFormat = inputFormatIndex >= 0 ? process.argv[inputFormatIndex + 1] : "missing";',
        'const outputFormatIndex = process.argv.indexOf("--output-format");',
        'const outputFormat = outputFormatIndex >= 0 ? process.argv[outputFormatIndex + 1] : "missing";',
        'process.stdout.write(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", text: `resume=${resumeId};verbose=${verbose};input=${inputFormat};output=${outputFormat}` }] } }) + "\\n");',
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        "let lineCount = 0;",
        'rl.on("line", (line) => {',
        "  const frame = JSON.parse(line);",
        '  const content = typeof frame?.message?.content === "string"',
        "    ? frame.message.content",
        '    : Array.isArray(frame?.message?.content)',
        '      ? frame.message.content.map((entry) => entry?.text ?? entry?.type ?? "").join("|")',
        '      : "unknown";',
        "  lineCount += 1;",
        '  const toolId = `tool-${lineCount}`;',
        '  process.stdout.write(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `echo:${content}` }, { type: "tool_use", name: "Read", input: { file_path: "README.md" }, id: toolId }] } }) + "\\n");',
        '  process.stdout.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok", is_error: false }] } }) + "\\n");',
        '  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, usage: { input_tokens: lineCount, output_tokens: lineCount + 1, cache_read_input_tokens: lineCount + 2 }, total_cost_usd: lineCount / 100 }) + "\\n");',
        "  if (lineCount >= 3) {",
        "    setTimeout(() => process.exit(0), 10);",
        "  }",
        "});",
        'process.on("SIGINT", () => process.exit(130));',
      ].join("\n"),
      "utf8",
    );

    const events: SessionEventBody[] = [];
    const runtime = createClaudeSessionRuntime(
      {
        onSessionEvent: async (event) => {
          events.push(event);
        },
      },
      {
        command: process.execPath,
        extraArgs: [scriptPath],
      },
    );

    await runtime.start({
      sessionId: "session-1",
      workspacePath: dir,
      resumeSessionId: "resume-123",
      agentType: "claude_code",
    });
    await runtime.input("hello");

    await expect
      .poll(() => events.filter((event) => event.event_type === "session.usage").length)
      .toBe(1);
    expect(events.map((event) => event.event_type)).not.toContain("session.done");

    await runtime.inputVoiceText("voice input", 0.98);
    await runtime.inputSlashCommand("/compact", []);

    await expect
      .poll(() => events.map((event) => event.event_type))
      .toContain("session.done");

    expect(events).toEqual([
      {
        event_type: "assistant.thinking",
        text: "resume=resume-123;verbose=true;input=stream-json;output=stream-json",
      },
      {
        event_type: "assistant.delta",
        text: "echo:hello",
      },
      {
        event_type: "tool.use",
        tool_name: "Read",
        tool_input: {
          file_path: "README.md",
        },
        tool_use_id: "tool-1",
      },
      {
        event_type: "tool.result",
        tool_use_id: "tool-1",
        tool_name: "Read",
        is_error: false,
        content: "ok",
      },
      {
        event_type: "session.usage",
        input_tokens: 1,
        output_tokens: 2,
        cache_read_tokens: 3,
        cost_usd: 0.01,
      },
      {
        event_type: "assistant.delta",
        text: "echo:voice input",
      },
      {
        event_type: "tool.use",
        tool_name: "Read",
        tool_input: {
          file_path: "README.md",
        },
        tool_use_id: "tool-2",
      },
      {
        event_type: "tool.result",
        tool_use_id: "tool-2",
        tool_name: "Read",
        is_error: false,
        content: "ok",
      },
      {
        event_type: "session.usage",
        input_tokens: 2,
        output_tokens: 3,
        cache_read_tokens: 4,
        cost_usd: 0.02,
      },
      {
        event_type: "assistant.delta",
        text: "echo:/compact",
      },
      {
        event_type: "tool.use",
        tool_name: "Read",
        tool_input: {
          file_path: "README.md",
        },
        tool_use_id: "tool-3",
      },
      {
        event_type: "tool.result",
        tool_use_id: "tool-3",
        tool_name: "Read",
        is_error: false,
        content: "ok",
      },
      {
        event_type: "session.usage",
        input_tokens: 3,
        output_tokens: 4,
        cache_read_tokens: 5,
        cost_usd: 0.03,
      },
      expect.objectContaining({
        event_type: "session.done",
        exit_code: 0,
      }),
    ]);
  });

  it("sends SIGINT on cancel and emits session.done", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-claude-cancel-"));
    const scriptPath = join(dir, "fake-claude-idle.mjs");
    await writeFile(
      scriptPath,
      [
        'setInterval(() => {}, 1000);',
        'process.on("SIGINT", () => process.exit(130));',
      ].join("\n"),
      "utf8",
    );

    const events: SessionEventBody[] = [];
    const runtime = createClaudeSessionRuntime(
      {
        onSessionEvent: async (event) => {
          events.push(event);
        },
      },
      {
        command: process.execPath,
        extraArgs: [scriptPath],
      },
    );

    await runtime.start({
      sessionId: "session-2",
      workspacePath: dir,
      resumeSessionId: null,
      agentType: "claude_code",
    });

    await runtime.cancel();

    await expect
      .poll(() => events.find((event) => event.event_type === "session.done"))
      .toEqual(
        expect.objectContaining({
          event_type: "session.done",
          exit_code: 130,
        }),
      );
  });

  it("writes image file paths into claude stdin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hellobug-claude-image-"));
    const scriptPath = join(dir, "fake-claude-image.mjs");
    await writeFile(
      scriptPath,
      [
        'import { createInterface } from "node:readline";',
        "const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        'rl.once("line", (line) => {',
        "  const frame = JSON.parse(line);",
        '  const content = typeof frame?.message?.content === "string" ? frame.message.content : "unknown";',
        '  process.stdout.write(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `echo:${content}` }] } }) + "\\n");',
        "  setTimeout(() => process.exit(0), 10);",
        "});",
      ].join("\n"),
      "utf8",
    );

    const events: SessionEventBody[] = [];
    const runtime = createClaudeSessionRuntime(
      {
        onSessionEvent: async (event) => {
          events.push(event);
        },
      },
      {
        command: process.execPath,
        extraArgs: [scriptPath],
      },
    );

    await runtime.start({
      sessionId: "session-image",
      workspacePath: dir,
      resumeSessionId: null,
      agentType: "claude_code",
    });
    await runtime.inputImage("/tmp/hellobug/session-image/photo.jpg", "image/jpeg");

    await expect
      .poll(() => events.map((event) => event.event_type))
      .toContain("session.done");

    expect(events).toEqual([
      {
        event_type: "assistant.delta",
        text: "echo:/tmp/hellobug/session-image/photo.jpg",
      },
      expect.objectContaining({
        event_type: "session.done",
        exit_code: 0,
      }),
    ]);
  });
});
