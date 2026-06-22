import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { z } from "zod";

export const DefaultDangerRulesPath = resolve(homedir(), ".hellobug/danger-rules.json");

const DangerRuleSchema = z.object({
  pattern: z.string().min(1),
  mode: z.enum(["block", "allow"]),
  desc: z.string().min(1),
});

const DangerRulesFileSchema = z.array(DangerRuleSchema);

const ReadOnlyToolNames = new Set(["Read", "Glob", "Grep", "LS"]);
const ReviewByDefaultToolNames = new Set(["Bash", "Write", "Edit", "MultiEdit"]);
const ReadOnlyBashPatterns = [
  /^git\s+(status|diff|log)\b/i,
  /^(ls|pwd|cat|head|tail|grep)\b/i,
  /^sed\s+-n\b/i,
];

const BuiltInBlockRules: DangerRule[] = [
  {
    pattern: String.raw`\bgit\s+push\b.*\s--force(?:-with-lease)?\b`,
    mode: "block",
    desc: "force push",
  },
  {
    pattern: String.raw`\brm\s+-rf\b`,
    mode: "block",
    desc: "recursive delete",
  },
  {
    pattern: String.raw`\bsudo\b`,
    mode: "block",
    desc: "sudo command",
  },
  {
    pattern: String.raw`\b(chmod|chown)\b\s+-R\b`,
    mode: "block",
    desc: "recursive permission change",
  },
  {
    pattern: String.raw`\b(mkfs|diskutil\s+eraseDisk|dd\s+if=)\b`,
    mode: "block",
    desc: "disk mutation",
  },
];

export type DangerRule = z.infer<typeof DangerRuleSchema>;

export interface DangerEvaluation {
  verdict: "allow" | "review";
  command: string;
  ruleMatched: string;
}

interface CompiledDangerRule {
  rule: DangerRule;
  matcher: RegExp;
}

export interface ToolUseContext {
  toolName: string;
  toolInput: Record<string, unknown>;
}

export class DangerRuleSet {
  private readonly customRules: CompiledDangerRule[];
  private readonly builtInRules: CompiledDangerRule[];

  constructor(rules: DangerRule[] = []) {
    this.customRules = rules.map(compileRule);
    this.builtInRules = BuiltInBlockRules.map(compileRule);
  }

  evaluateToolUse(context: ToolUseContext): DangerEvaluation {
    const command = formatToolCommand(context.toolName, context.toolInput);

    if (ReadOnlyToolNames.has(context.toolName)) {
      return {
        verdict: "allow",
        command,
        ruleMatched: "built-in read-only tool",
      };
    }

    if (
      context.toolName === "Bash" &&
      ReadOnlyBashPatterns.some((pattern) => pattern.test(command))
    ) {
      return {
        verdict: "allow",
        command,
        ruleMatched: "built-in read-only bash command",
      };
    }

    for (const rule of this.customRules) {
      if (rule.matcher.test(command)) {
        return {
          verdict: rule.rule.mode === "allow" ? "allow" : "review",
          command,
          ruleMatched: rule.rule.desc,
        };
      }
    }

    for (const rule of this.builtInRules) {
      if (rule.matcher.test(command)) {
        return {
          verdict: "review",
          command,
          ruleMatched: rule.rule.desc,
        };
      }
    }

    if (ReviewByDefaultToolNames.has(context.toolName)) {
      return {
        verdict: "review",
        command,
        ruleMatched: `${context.toolName} requires confirmation`,
      };
    }

    return {
      verdict: "allow",
      command,
      ruleMatched: "no review rule matched",
    };
  }
}

export async function loadDangerRuleSet(filePath = DefaultDangerRulesPath): Promise<DangerRuleSet> {
  try {
    const raw = await readFile(filePath, "utf8");
    return new DangerRuleSet(DangerRulesFileSchema.parse(JSON.parse(raw)));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return new DangerRuleSet();
    }
    throw error;
  }
}

function compileRule(rule: DangerRule): CompiledDangerRule {
  return {
    rule,
    matcher: new RegExp(rule.pattern, "iu"),
  };
}

function formatToolCommand(toolName: string, toolInput: Record<string, unknown>): string {
  const explicitCommand =
    getString(toolInput.command) ??
    getString(toolInput.cmd) ??
    getString(toolInput.text) ??
    getString(toolInput.file_path) ??
    getString(toolInput.path);

  if (explicitCommand) {
    return truncateForDisplay(explicitCommand);
  }

  const body = JSON.stringify(toolInput);
  return truncateForDisplay(body.length > 0 ? `${toolName} ${body}` : toolName);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function truncateForDisplay(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
