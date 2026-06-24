# Claude Current

Updated: 2026-06-24

## Role

Claude 负责整个 Flutter 客户端：

- `app/lib/screens/**`、`widgets/**`
- `app/lib/state/**`、`transport/**`、`crypto/**`、`models/**`
- `app/lib/bootstrap.dart`、`router.dart`、`app.dart`
- 页面、Provider、客户端状态机、WebSocket、pinning、push token 上报、客户端加密、Flutter 联调

说明：

- Claude 仍是 Flutter 主要开发者，尤其负责页面、交互和大块业务实现。
- 但 Codex 现在也会直接修改 Flutter 中的协议、联调和业务逻辑问题；后续新会话不要再假设 “Codex 不改 app/”。

## Start Order

1. `docs/app-remaining-work.md`：唯一任务状态真源
2. `memory/shared/flutter-status.md`：Flutter 当前真实现状
3. `docs/flutter-tasks.md`：需要看里程碑、验收与协议边界时再读
4. `docs/wireframes/index.html` 和目标 `docs/wireframes/*.html`
5. 最后只打开当前要改的 `app/lib/**`

## Current Flutter Priorities

- 当前根导航方向以 2-tab 为准，不再按旧的 3/4 tab 根壳继续扩展
- 但现在第一 tab 仍是“工作区”文案 + `SessionsPage` 内容的过渡态，后续页面实现要注意这个事实
- app 侧 `noise_ik.dart` / `session_cipher.dart` 仍未完成
- app 侧 pinning、JWT 恢复仍未完成；前台重连观察器已接上，但超时锁定当前保持关闭
- pairing 后 push token 正式上报仍未完成；`machineName / os` 已开始持久化
- `danger.pending` 全局监听、弹层路由和正式 allow/deny payload 已接通，但 timeout / 已处理 / 失败状态仍未完成
- 文件链路协议已基本收口：`fs.tree.req` / `fs.file.req` 正式字段、`data_base64url` 兼容、重试订阅回收、错误匹配 `request_id` 已接通；剩余主要是大文件 / 二进制 / 权限态
- 历史记录已切到正式 `history.list { workspace_path }` / `history.get { session_id, offset, limit }`，并已能解析基础 Claude transcript（`user / assistant / thinking / tool_use / tool_result`）
- terminal 协议已收口到 `pty.input` + `session.event(event_type = pty.data)`，不要再监听旧的顶层 `pty.data`
- `session.event` 现在必须统一按 `payload.event.event_type` 读取，不要再写旧的扁平 `payload['event_type']` / `payload['text']`
- new session 已改为正式 `session.start { session_id, workspace_path, agent_type, resume_session_id }`，shell 会话进入 `/terminal/:sessionId`
- new session 的 dev fallback 测试设备入口已移除
- daemon 已有 `slash.list` / `templates.list` 默认来源；下一步是把 Flutter 从静态 `kDefaultTemplates` 切到真实数据，不要再伪造新的协议或偷偷写死命令集
- 启动加载、重连、设备吊销、配对过期、会话不存在等状态页
- 工作区状态页：`49 / 50 / 51 / 60`
- 推送落地页 `53`
- 聊天页状态补口：空态、等待首条回复、恢复中、结束态、错误态
- 文件预览状态补口：`large-file / binary / permission`
- 设备列表刷新/失败视觉与设置入口
- 其次再做：工作区主页/设置、终端状态、历史搜索/筛选/失败、多会话 tab、横屏双栏

## Session Hygiene

- 不要把 `docs/claude-ui-tasks.md` 或 `docs/flutter-tasks.md` 当成完成状态真源。
- 如果旧 wireframe 里还出现 3 个或 4 个底部 tab，把它视为历史残留，不要当成当前根导航真相。
- 尽量按需小片段读代码，不要反复整篇重读长文档。
- 如果会话开始变重或出现 `Prompt is too long`，直接开新会话并从本文件开始，不要在超长上下文里继续堆。
