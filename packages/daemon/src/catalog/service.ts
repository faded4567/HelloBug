import type { AgentType } from "@hellobug/protocol";

import {
  DaemonSessionError,
  type SessionHandle,
} from "../sessions/manager.js";

export interface DaemonPromptTemplate {
  id: string;
  label: string;
  text: string;
}

export interface DaemonSlashCommand {
  name: string;
  desc: string;
}

interface SessionLookup {
  get(sessionId: string): SessionHandle | undefined;
}

type TemplatesListRequestMessage = {
  v: 1;
  id?: string;
  type: "templates.list";
  payload: Record<string, never>;
};

type TemplatesListResponseMessage = {
  v: 1;
  id?: string;
  type: "templates.list";
  payload: {
    templates: DaemonPromptTemplate[];
  };
};

type SlashListRequestMessage = {
  v: 1;
  id?: string;
  type: "slash.list";
  payload: {
    session_id: string;
  };
};

type SlashListResponseMessage = {
  v: 1;
  id?: string;
  type: "slash.list";
  payload: {
    commands: DaemonSlashCommand[];
  };
};

const DEFAULT_TEMPLATES: readonly DaemonPromptTemplate[] = [
  {
    id: "t1",
    label: "git status",
    text: "git status",
  },
  {
    id: "t2",
    label: "跑测试",
    text: "运行所有测试并报告结果",
  },
  {
    id: "t3",
    label: "最近提交",
    text: "查看最近 5 个 git commit",
  },
  {
    id: "t4",
    label: "列目录",
    text: "ls -la",
  },
];

const DEFAULT_SLASH_COMMANDS: Readonly<
  Record<AgentType, readonly DaemonSlashCommand[]>
> = {
  claude_code: [
    {
      name: "clear",
      desc: "清空当前会话上下文",
    },
    {
      name: "compact",
      desc: "压缩历史，只保留摘要",
    },
    {
      name: "init",
      desc: "初始化项目记忆文件",
    },
    {
      name: "model",
      desc: "切换模型",
    },
  ],
  codex: [
    {
      name: "clear",
      desc: "清空当前会话上下文",
    },
    {
      name: "compact",
      desc: "压缩历史，只保留摘要",
    },
    {
      name: "model",
      desc: "切换模型",
    },
  ],
  shell: [
    {
      name: "clear",
      desc: "清空终端输出",
    },
    {
      name: "pwd",
      desc: "显示当前工作目录",
    },
    {
      name: "ls",
      desc: "列出当前目录内容",
    },
  ],
};

export interface DaemonCatalogServiceOptions {
  sessions?: SessionLookup;
  templates?: readonly DaemonPromptTemplate[];
  slashCommandsByAgent?: Partial<Record<AgentType, readonly DaemonSlashCommand[]>>;
}

export class DaemonCatalogService {
  constructor(private readonly options: DaemonCatalogServiceOptions = {}) {}

  async handleTemplatesListRequest(
    message: TemplatesListRequestMessage,
  ): Promise<TemplatesListResponseMessage> {
    return {
      v: 1,
      id: message.id,
      type: "templates.list",
      payload: {
        templates: cloneTemplates(this.options.templates ?? DEFAULT_TEMPLATES),
      },
    };
  }

  async handleSlashListRequest(
    message: SlashListRequestMessage,
  ): Promise<SlashListResponseMessage> {
    if (!this.options.sessions) {
      throw new DaemonSessionError(
        "PROTOCOL_VERSION",
        "Session manager is not configured",
      );
    }

    const session = this.options.sessions.get(message.payload.session_id);
    if (!session) {
      throw new DaemonSessionError(
        "SESSION_NOT_FOUND",
        `Session not found: ${message.payload.session_id}`,
      );
    }

    return {
      v: 1,
      id: message.id,
      type: "slash.list",
      payload: {
        commands: cloneSlashCommands(
          this.options.slashCommandsByAgent?.[session.agentType] ??
            DEFAULT_SLASH_COMMANDS[session.agentType],
        ),
      },
    };
  }
}

function cloneTemplates(
  templates: readonly DaemonPromptTemplate[],
): DaemonPromptTemplate[] {
  return templates.map((template) => ({ ...template }));
}

function cloneSlashCommands(
  commands: readonly DaemonSlashCommand[],
): DaemonSlashCommand[] {
  return commands.map((command) => ({ ...command }));
}
