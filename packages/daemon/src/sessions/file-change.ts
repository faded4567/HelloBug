import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";

import type { FileChangedEvent } from "@hellobug/protocol";

const MutatingToolNames = new Set(["Write", "Edit", "MultiEdit"]);
const Utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const MaxDiffTextBytes = 256 * 1024;
const MaxDiffLineCount = 2_000;
const HunkContextLineCount = 3;

type ComparableSnapshot =
  | {
      kind: "missing";
    }
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "unsupported";
    };

interface DiffOperation {
  type: "context" | "add" | "remove";
  line: string;
}

interface AnnotatedDiffOperation extends DiffOperation {
  oldAnchor: number;
  newAnchor: number;
}

export interface PendingFileChange {
  absolutePath: string;
  relativePath: string;
  before: ComparableSnapshot;
}

export async function capturePendingFileChange(
  workspacePath: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<PendingFileChange | null> {
  const rawFilePath = extractMutatedFilePath(toolName, toolInput);
  if (!rawFilePath) {
    return null;
  }

  const absolutePath = isAbsolute(rawFilePath)
    ? resolve(rawFilePath)
    : resolve(workspacePath, rawFilePath);
  const relativePath = toWorkspaceRelativePath(workspacePath, absolutePath);
  if (!relativePath) {
    return null;
  }

  return {
    absolutePath,
    relativePath,
    before: await captureComparableSnapshot(absolutePath),
  };
}

export async function buildFileChangedEvent(
  pending: PendingFileChange,
): Promise<FileChangedEvent | null> {
  const after = await captureComparableSnapshot(pending.absolutePath);
  return createFileChangedEvent(pending.relativePath, pending.before, after);
}

function extractMutatedFilePath(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  if (!MutatingToolNames.has(toolName)) {
    return null;
  }

  const rawFilePath =
    getNonEmptyString(toolInput.file_path) ?? getNonEmptyString(toolInput.path);
  return rawFilePath ? rawFilePath.trim() : null;
}

async function captureComparableSnapshot(
  absolutePath: string,
): Promise<ComparableSnapshot> {
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.size > MaxDiffTextBytes) {
      return { kind: "unsupported" };
    }
  } catch (error) {
    if (isMissingFsError(error)) {
      return { kind: "missing" };
    }
    return { kind: "unsupported" };
  }

  let content: Buffer;
  try {
    content = await readFile(absolutePath);
  } catch (error) {
    if (isMissingFsError(error)) {
      return { kind: "missing" };
    }
    return { kind: "unsupported" };
  }

  if (content.byteLength > MaxDiffTextBytes || content.includes(0)) {
    return { kind: "unsupported" };
  }

  try {
    return {
      kind: "text",
      text: normalizeNewlines(Utf8Decoder.decode(content)),
    };
  } catch {
    return { kind: "unsupported" };
  }
}

function createFileChangedEvent(
  relativePath: string,
  before: ComparableSnapshot,
  after: ComparableSnapshot,
): FileChangedEvent | null {
  if (before.kind === "unsupported" || after.kind === "unsupported") {
    return null;
  }

  if (before.kind === "missing" && after.kind === "missing") {
    return null;
  }

  const beforeText = before.kind === "text" ? before.text : "";
  const afterText = after.kind === "text" ? after.text : "";
  if (beforeText === afterText) {
    return null;
  }

  const beforeLines = splitTextLines(beforeText);
  const afterLines = splitTextLines(afterText);
  if (
    beforeLines.length > MaxDiffLineCount ||
    afterLines.length > MaxDiffLineCount
  ) {
    return null;
  }

  const operations = diffLines(beforeLines, afterLines);
  const added = operations.filter((operation) => operation.type === "add").length;
  const removed = operations.filter((operation) => operation.type === "remove").length;
  if (added === 0 && removed === 0) {
    return null;
  }

  const hunks = buildUnifiedDiffHunks(operations);
  if (hunks.length === 0) {
    return null;
  }

  return {
    event_type: "file.changed",
    file_path: relativePath,
    diff: [
      `--- a/${relativePath}`,
      `+++ b/${relativePath}`,
      ...hunks,
    ].join("\n"),
    added,
    removed,
  };
}

function diffLines(beforeLines: string[], afterLines: string[]): DiffOperation[] {
  const rowCount = beforeLines.length;
  const columnCount = afterLines.length;
  const directions = Array.from(
    { length: rowCount + 1 },
    () => new Uint8Array(columnCount + 1),
  );

  let previous = new Uint32Array(columnCount + 1);
  let current = new Uint32Array(columnCount + 1);

  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      if (
        beforeLines[rowIndex - 1] === afterLines[columnIndex - 1]
      ) {
        current[columnIndex] = previous[columnIndex - 1] + 1;
        directions[rowIndex][columnIndex] = 1;
      } else if (previous[columnIndex] >= current[columnIndex - 1]) {
        current[columnIndex] = previous[columnIndex];
        directions[rowIndex][columnIndex] = 2;
      } else {
        current[columnIndex] = current[columnIndex - 1];
        directions[rowIndex][columnIndex] = 3;
      }
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  const operations: DiffOperation[] = [];
  let rowIndex = rowCount;
  let columnIndex = columnCount;

  while (rowIndex > 0 || columnIndex > 0) {
    if (
      rowIndex > 0 &&
      columnIndex > 0 &&
      directions[rowIndex][columnIndex] === 1
    ) {
      operations.push({
        type: "context",
        line: beforeLines[rowIndex - 1],
      });
      rowIndex -= 1;
      columnIndex -= 1;
      continue;
    }

    if (
      columnIndex > 0 &&
      (rowIndex === 0 || directions[rowIndex][columnIndex] === 3)
    ) {
      operations.push({
        type: "add",
        line: afterLines[columnIndex - 1],
      });
      columnIndex -= 1;
      continue;
    }

    operations.push({
      type: "remove",
      line: beforeLines[rowIndex - 1],
    });
    rowIndex -= 1;
  }

  operations.reverse();
  return operations;
}

function buildUnifiedDiffHunks(operations: DiffOperation[]): string[] {
  const annotatedOperations = annotateOperations(operations);
  const lines: string[] = [];
  let cursor = 0;

  while (true) {
    const firstChangeIndex = findNextChangeIndex(annotatedOperations, cursor);
    if (firstChangeIndex === -1) {
      return lines;
    }

    let sliceStart = Math.max(0, firstChangeIndex - HunkContextLineCount);
    let sliceEnd = Math.min(
      annotatedOperations.length - 1,
      firstChangeIndex + HunkContextLineCount,
    );

    while (true) {
      const nextChangeIndex = findNextChangeIndex(
        annotatedOperations,
        sliceEnd + 1,
      );
      if (
        nextChangeIndex === -1 ||
        nextChangeIndex > sliceEnd + HunkContextLineCount
      ) {
        break;
      }
      sliceEnd = Math.min(
        annotatedOperations.length - 1,
        nextChangeIndex + HunkContextLineCount,
      );
    }

    const slice = annotatedOperations.slice(sliceStart, sliceEnd + 1);
    const oldStart = slice[0]?.oldAnchor ?? 1;
    const newStart = slice[0]?.newAnchor ?? 1;
    const oldCount = slice.filter((operation) => operation.type !== "add").length;
    const newCount = slice.filter((operation) => operation.type !== "remove").length;
    lines.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`);
    for (const operation of slice) {
      const prefix =
        operation.type === "context"
          ? " "
          : operation.type === "add"
            ? "+"
            : "-";
      lines.push(`${prefix}${operation.line}`);
    }

    cursor = sliceEnd + 1;
  }
}

function annotateOperations(
  operations: DiffOperation[],
): AnnotatedDiffOperation[] {
  const annotated: AnnotatedDiffOperation[] = [];
  let oldAnchor = 1;
  let newAnchor = 1;

  for (const operation of operations) {
    const currentOldAnchor = oldAnchor;
    const currentNewAnchor = newAnchor;
    if (operation.type === "context") {
      oldAnchor += 1;
      newAnchor += 1;
    } else if (operation.type === "remove") {
      oldAnchor += 1;
    } else {
      newAnchor += 1;
    }

    annotated.push({
      ...operation,
      oldAnchor: currentOldAnchor,
      newAnchor: currentNewAnchor,
    });
  }

  return annotated;
}

function findNextChangeIndex(
  operations: DiffOperation[],
  startIndex: number,
): number {
  for (let index = startIndex; index < operations.length; index += 1) {
    if (operations[index]?.type !== "context") {
      return index;
    }
  }
  return -1;
}

function formatRange(start: number, count: number): string {
  if (count === 0) {
    return `${Math.max(start - 1, 0)},0`;
  }
  if (count === 1) {
    return `${start}`;
  }
  return `${start},${count}`;
}

function splitTextLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const lines = text.split("\n");
  if (text.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function toWorkspaceRelativePath(
  workspacePath: string,
  targetPath: string,
): string | null {
  const diff = relative(workspacePath, targetPath);
  if (!diff || diff === "." || diff.startsWith("..") || diff.startsWith("/")) {
    return null;
  }
  return diff.split("\\").join("/");
}

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isMissingFsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
}
