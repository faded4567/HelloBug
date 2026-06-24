# Codex Current

Updated: 2026-06-24

## Role

Codex 负责：

- `packages/protocol`、`packages/server`、`packages/daemon`
- server / daemon / protocol 的实现、测试、部署与联调总控
- 与 Flutter 的跨端协议收口、fixture、恢复语义与后端能力输出
- 在 Claude 改完后继续直接修正 Flutter 业务逻辑 / 协议对齐问题，不再把 Flutter 完全排除在 Codex 工作范围外

## Start Order

1. `docs/app-remaining-work.md`：唯一任务状态真源
2. `memory/shared/current-status.md`：跨端现状与关键现实约束
3. `memory/shared/protocol-decisions.md`：涉及协议/安全边界时再读
4. 最后只打开当前任务相关的 `packages/**` 或 `app/lib/**` 逻辑文件

## Current Backend Priorities

- 先清理当前仍在运行时兜底的 legacy 兼容漂移，并推动 Flutter 接入 daemon `templates.list` / `slash.list`
- 清掉当前仍在运行时兜底的 legacy 兼容漂移：`fs.read`、`content`、`from_seq`
- 再统一 server / daemon 到真实 `Envelope` 主链路，并完成真实签名、验签、`seq`、Noise IK fixture
- 再补 server / daemon 业务缺口：设备重命名/吊销、push backend、workspace/restore、relay 安全边界
- 为 Claude 提供稳定的 app 对接面：`danger.pending`、push token、replay、workspace、PTY、templates、slash

## Current Runtime Reality

- server 已能桥接 app 侧 `Envelope`，但仍是开发态解包/回包，不是最终 E2EE relay。
- daemon 传输层仍以 plain `Message` 为主。
- daemon 已实现 `fs.tree.req` / `fs.file.req` / `history.list` / `history.get` / `pty.input` / `pty.resize`，server 也已兼容当前 Flutter 的 legacy 文件树请求、`session.start` 缺省字段、slash args 以及文件预览过渡字段。
- daemon 已实现 `templates.list` / `slash.list` 默认来源；`session.agent.add` 当前返回明确 `PROTOCOL_VERSION` 错误。
- daemon 会把 Flutter 发来的 app-style slash command（如 `compact`）归一化成 Claude-like runtime 需要的 `/compact`。
- shell agent 已切到真实 `node-pty` runtime；terminal 输出统一通过 `session.event { event_type: "pty.data" }` 下发。
- 已在局域网 `ws://192.168.18.8:3000/v1/relay` 验证 `pairing/SAS/auth.token -> session.start(shell) -> pty.input/pty.resize -> terminal output` 开发态闭环。
- Flutter 当前已完成这批关键协议收口：`session.event` 改为读取嵌套 `payload.event`，slash command 改为 `args: string[]`，shell 会话路由到 `/terminal/:sessionId`，文件预览兼容 `data_base64url`，danger allow/deny race 已修正。
- daemon 现已支持 `~` 路径展开，文件树响应对外保留 app 传入的 `workspace_path` 形态，便于 Flutter 继续用 `~` 作为会话工作区标识。
- app 侧 `noise_ik.dart` 与 `session_cipher.dart` 仍是 stub。
