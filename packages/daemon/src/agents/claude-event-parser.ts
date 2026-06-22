import { randomUUID } from "node:crypto";

import type { SessionEventBody } from "@hellobug/protocol";

export interface ClaudeParsedResult {
  events: SessionEventBody[];
  completion?: {
    exitCode: number;
  };
}

export function parseClaudeStreamEvent(raw: unknown): ClaudeParsedResult {
  const record = asRecord(raw);
  if (!record) {
    return { events: [] };
  }

  const type = getString(record.type);
  if (!type || type === "system" || type === "init" || type === "stream_event") {
    return { events: [] };
  }

  if (type === "assistant") {
    return {
      events: extractAssistantEvents(record),
    };
  }

  if (type === "user") {
    return {
      events: extractUserEvents(record),
    };
  }

  if (type === "tool_use") {
    const event = extractToolUseEvent(record);
    if (!event) {
      return { events: [] };
    }

    return {
      events: [event],
    };
  }

  if (type === "tool_result") {
    const event = extractToolResultEvent(record);
    return {
      events: event ? [event] : [],
    };
  }

  if (type === "result") {
    const events: SessionEventBody[] = [];
    const usage = asRecord(record.usage);
    const inputTokens =
      getNumber(usage?.input_tokens) ??
      getNumber(usage?.inputTokens) ??
      getNumber(record.input_tokens);
    const outputTokens =
      getNumber(usage?.output_tokens) ??
      getNumber(usage?.outputTokens) ??
      getNumber(record.output_tokens);
    const cacheReadTokens =
      getNumber(usage?.cache_read_tokens) ??
      getNumber(usage?.cacheReadTokens) ??
      getNumber(usage?.cache_read_input_tokens) ??
      getNumber(record.cache_read_tokens) ??
      0;
    const costUsd =
      getNumber(record.cost_usd) ??
      getNumber(record.total_cost_usd) ??
      getNumber(usage?.cost_usd) ??
      0;

    if (inputTokens !== null || outputTokens !== null) {
      events.push({
        event_type: "session.usage",
        input_tokens: inputTokens ?? 0,
        output_tokens: outputTokens ?? 0,
        cache_read_tokens: cacheReadTokens,
        cost_usd: costUsd,
      });
    }

    const exitCode = getNumber(record.exit_code) ?? getNumber(record.code);

    return {
      events,
      completion: exitCode === null ? undefined : { exitCode },
    };
  }

  return { events: [] };
}

function extractAssistantEvents(record: Record<string, unknown>): SessionEventBody[] {
  const events: SessionEventBody[] = [];
  const directThinking = getString(record.thinking);
  if (directThinking) {
    events.push({
      event_type: "assistant.thinking",
      text: directThinking,
    });
  }

  const directText = getString(record.text) ?? getString(record.delta);
  if (directText) {
    events.push({
      event_type: "assistant.delta",
      text: directText,
    });
  }

  const content =
    asArray(record.content) ??
    asArray(asRecord(record.message)?.content) ??
    asArray(asRecord(record.delta)?.content);

  for (const item of content ?? []) {
    const entry = asRecord(item);
    if (!entry) {
      continue;
    }

    events.push(...extractAssistantContentEntryEvents(entry));
  }

  return events;
}

function extractUserEvents(record: Record<string, unknown>): SessionEventBody[] {
  const events: SessionEventBody[] = [];
  const content = getContentEntries(record);

  for (const item of content ?? []) {
    const entry = asRecord(item);
    if (!entry || getString(entry.type) !== "tool_result") {
      continue;
    }

    const event = extractToolResultEvent(entry);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

function extractAssistantContentEntryEvents(entry: Record<string, unknown>): SessionEventBody[] {
  const entryType = getString(entry.type);

  if (entryType === "tool_use") {
    const event = extractToolUseEvent(entry);
    return event ? [event] : [];
  }

  if (entryType === "tool_result") {
    const event = extractToolResultEvent(entry);
    return event ? [event] : [];
  }

  const text = extractText(entry);
  if (!text) {
    return [];
  }

  if (entryType === "thinking") {
    return [
      {
        event_type: "assistant.thinking",
        text,
      },
    ];
  }

  return [
    {
      event_type: "assistant.delta",
      text,
    },
  ];
}

function extractToolUseEvent(record: Record<string, unknown>): SessionEventBody | null {
  const toolName = getString(record.name) ?? getString(record.tool_name);
  if (!toolName) {
    return null;
  }

  return {
    event_type: "tool.use",
    tool_name: toolName,
    tool_input: asRecord(record.input) ?? asRecord(record.tool_input) ?? {},
    tool_use_id:
      getString(record.tool_use_id) ??
      getString(record.id) ??
      getString(record.uuid) ??
      randomUUID(),
  };
}

function extractToolResultEvent(record: Record<string, unknown>): SessionEventBody | null {
  const toolUseId =
    getString(record.tool_use_id) ??
    getString(record.id) ??
    getString(record.uuid) ??
    randomUUID();

  return {
    event_type: "tool.result",
    tool_use_id: toolUseId,
    tool_name: getString(record.tool_name) ?? getString(record.name) ?? "unknown",
    is_error: getBoolean(record.is_error) ?? getBoolean(record.error) ?? false,
    content: stringifyValue(record.content ?? record.output ?? record.result ?? ""),
  };
}

function getContentEntries(record: Record<string, unknown>): unknown[] | null {
  return (
    asArray(record.content) ??
    asArray(asRecord(record.message)?.content) ??
    asArray(asRecord(record.delta)?.content)
  );
}

function extractText(record: Record<string, unknown>): string | null {
  return (
    getString(record.text) ??
    getString(record.delta) ??
    getString(record.content) ??
    getString(record.value)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const textParts = value
      .map((entry) => {
        const record = asRecord(entry);
        if (!record) {
          return stringifyValue(entry);
        }
        return getString(record.text) ?? getString(record.content) ?? JSON.stringify(record);
      })
      .filter((entry) => entry.length > 0);

    return textParts.join("\n");
  }

  if (value === null || value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}
