# Codex Current

Updated: 2026-06-29

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

- 继续推进真正的安全边界：扩大 opaque ciphertext 覆盖面，逐步移除 plain / static HKDF fallback，并收口 pinning 与 relay 边界
- 继续补 server / daemon 业务缺口：push backend、workspace/restore 深层语义、presence 与多端一致性
- 为 Flutter 提供稳定对接面：`danger.pending`、push token、replay、workspace、PTY、templates、slash
- 维护文档口径一致，避免任务状态和运行时现实再次漂移

## Current Runtime Reality

- server 已能桥接 app / daemon 侧 `Envelope`，并对带签名 envelope 做验签；但整体仍是开发态 relay，不是最终生产级 E2EE 边界。
- daemon 传输层已默认发送签名 `Envelope`；命中会话白名单消息时会进一步切到 `noise_static_v1`。
- app 侧 `Envelope` 签名、`noise_ik.dart`、`session_cipher.dart`、显式 `key.ratchet` 与 pairing-derived 首会话引导都已落地；`workspace.list / workspace.resolve / history.list / templates.list` 已走保留控制通道 `transport.control.v1`，`session.resume` 也已改为 outer `routing_payload` + `noise_static_v1` 的恢复请求，server 可不解密 inner 执行 replay；`key.ratchet / key.ratchet_ack` 本身也已走加密 session transport，其中 `ratchet` 用旧 cipher，`ack` 用新 cipher。
- 已清掉这批 legacy 命名漂移：`fs.read`、`fs.file.content|data_base64url`、`session.replay/from_seq`；relay 现已不再自动兼容旧版 `session.start` 缺省 `resume_session_id`、旧版 slash 字符串参数和 `fs.tree.req.path`，并且 raw JSON `auth.attach`、`auth.refresh`、`daemon.hello`、`device.push_token`、`device.list / device.rename / device.revoke`、`session.resume`、`session.start`、`session.agent.add`、`session.input*`、`session.command.slash`、`session.cancel`、`danger.allow / danger.deny`、`workspace.list / workspace.resolve`、`history.list / history.get`、`templates.list`、`key.ratchet / key.ratchet_ack`、`danger.pending / danger.result`、`session.event`、`fs.tree.req / fs.file.req / fs.tree / fs.file`、`slash.list`、`pty.input / pty.resize` 也已收掉；`workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list / session.start / danger.allow / session.event / replay.done / session.start.result / danger.result / fs.tree / fs.file` 这批 plain envelope 现在也必须带 outer metadata 且 `message_type` 必须与 inner 对齐，V1 主路径中的 raw JSON bootstrap / 直连控制流已基本清空，剩余兼容主要收敛到少量开发态 plain envelope 分支。
- daemon 已实现 `templates.list` / `slash.list` 默认来源；`session.agent.add` 当前返回明确 `PROTOCOL_VERSION` 错误。
- daemon 会把 Flutter 发来的 app-style slash command（如 `compact`）归一化成 Claude-like runtime 需要的 `/compact`。
- shell agent 已切到真实 `node-pty` runtime；terminal 输出统一通过 `session.event { event_type: "pty.data" }` 下发。
- 已在局域网 `ws://192.168.18.8:3000/v1/relay` 验证 `pairing/SAS/auth.token -> session.start(shell) -> pty.input/pty.resize -> terminal output` 开发态闭环。
- Flutter 侧已补 `device.list / device.rename / device.revoke`、`workspace.list / workspace.resolve`，并且本地 push token 会在 pairing 成功或后续 `auth.token` 时自动上报 `device.push_token`；iOS native APNS bridge 与 Android native FCM bridge 都已接入，Android 当前按 `manufacturer=Other` 上报，运行时仍需 `app/android/app/google-services.json`。
- server `push.trigger` 现已不只是 dispatch 记录：`packages/server/src/push/` 已有 `PushProvider` 接口、默认 noop provider、按 iOS / Android 厂商可路由的 target 描述，以及 `invalid_token` 自动清理 app push token 并持久化；当前 `manufacturer=Other` 仍不会走 Android 厂商推送。
- daemon `fs.file` 现已补正式预览状态：`ready / binary / too_large / permission_denied / not_found`；Flutter 文件预览页也已改为优先按 `status` 承接，不再只靠 `data(base64url)` 解码失败判断“不是文本”。
- daemon 图片输入链路现已补第一轮失败语义：非 `image/*` MIME、超 2MB 上传会在落盘前被拒绝；若 runtime 本身不支持图片输入，daemon 也会回结构化 `error(PROTOCOL_VERSION)`，不再只在本地终端打印异常。
- daemon 现在还会对另一类联调常见失败给出结构化回包：如果加密 envelope 能到达但解密后的 inner message 不符合 schema，会直接回 `error(PROTOCOL_VERSION)`，而不是只在本地日志打印 `ZodError`。
- daemon 现已补 `file.changed` 真后端第一版：对 Claude `Write / Edit / MultiEdit` 在工作区内的成功文本修改，会基于前后快照生成 unified diff，并下发 `file.changed { file_path, diff, added, removed }`；越界路径、非文本、超大文件、无实际变更、工具失败时会保守跳过 diff 事件。
- server 当前会在 `session.start.result(started)` 后把 `device.status.active_session_count` 加一，在 `session.done` 时回落到零；session 记录不会立刻删除，因此 daemon 离线后 `session.resume` 仍可回放已完成会话。
- server 现在已修正 `device.status` 时间语义：`ts` 表示这次状态广播时间，`last_seen_at` 仅在设备实际在线/离线切换时更新，不会再被 `device.rename` 或 `active_session_count` 变化伪刷新；离线设备重命名也会广播给该 daemon 关联的所有 app。
- server 当前会主动冲掉挂起请求：daemon 中途断线时会立刻失败；daemon 保持在线但不回包时，pending `session.start` 会超时回 `session.start.result(rejected)`，pending `workspace.* / history.list / templates.list` 会超时回 `error(SESSION_NOT_FOUND)`；超时后的迟到回包也会被丢弃，避免误广播到其他 app。
- server 现在还会继续跟踪 `fs.tree.req / fs.file.req` 这类加密文件请求：daemon 在线但不回包时也会结构化超时失败，迟到的 `fs.tree / fs.file` 不再误投递；其中 `fs.file` 已按多 chunk 响应做了 request 生命周期收口。
- Flutter 当前已完成这批关键协议收口：`session.event` 改为读取嵌套 `payload.event`，slash command 改为 `args: string[]`，shell 会话路由到 `/terminal/:sessionId`，模板改为真实 `templates.list` 来源，文件预览按正式 `fs.file.data(base64url)` 读取，danger allow/deny race 已修正。
- daemon 现已支持 `~` 路径展开，文件树响应对外保留 app 传入的 `workspace_path` 形态，便于 Flutter 继续用 `~` 作为会话工作区标识。
- daemon 配置加载现已支持环境变量直接覆盖或纯 env 启动：`HELLOBUG_DAEMON_SERVER_URL / HELLOBUG_DAEMON_BOOTSTRAP_TOKEN / HELLOBUG_DAEMON_ALLOWED_PATHS / HELLOBUG_DAEMON_*` 可在缺少 `~/.hellobug/daemon.json` 时直接拉起；后端联调/回归命令已集中到 `docs/backend-runbook.md` 与 `packages/package.json`。
- `replay.done` 对 envelope 客户端现已改为 opaque placeholder envelope，Flutter 会优先读 outer `routing_payload`，且 `session.resume` 不再触发 session ratchet。
- `replay.done` 现在还被明确限定为 server-only：恢复完成哨兵仍由 server 在处理 `session.resume` 后生成，但 daemon 主动上行 `replay.done` 会被 server 直接拒绝。
- `device.status` 与 server 自产 `error` 现在也已改为 envelope placeholder；错误回执会优先回原始请求 `id`，可用时附带 `session_id`。
- server 自产 `session.start.result(rejected)` 现在也已改为 envelope placeholder；启动超时、daemon 离线或未认证时，不再对 envelope 客户端回 plain inner message。
- `daemon.hello / auth.attach / auth.refresh / auth.token / device.push_token / device.list / device.rename / device.revoke` 也已切到 envelope placeholder。
- `device.pair.ready / device.pair / device.pair.sas / device.pair.confirm` 现在也已切到 placeholder envelope：pairing bootstrap 仍是 pre-session 阶段，但 outer metadata + `routing_payload` 已统一，不再回退 plain inner message。
- relay 现在拒绝同一 socket 从 `Envelope` 再回退到 plain message。
- relay 现在对入站 envelope 强制单连接 `seq` 严格递增；`session.resume.last_seq` / `replay.done.current_seq` 则统一按 replay 流里的 transport `Envelope.seq` 解释，不再混用 `session.event.payload.seq`。
- relay 现在还会拒绝 `ts` 偏差超过 ±5 分钟的 signed envelope，以及在有效时间窗内跨连接原样重放的同一份 signed envelope。
- relay 现在还会拒绝现代 metadata envelope 的明文降级：`auth.attach / auth.refresh / daemon.hello / device.pair.* / device.push_token / device.list / device.rename / device.revoke / session.resume / key.ratchet / key.ratchet_ack` 一旦带 outer metadata，就必须走 `noise_static_v1`，不再允许 `cipher_mode=plain`。
- relay 现在也不再接受 raw JSON 的 `auth.attach / auth.refresh / daemon.hello / device.push_token / device.list / device.rename / device.revoke / session.resume / session.start / workspace.list / workspace.resolve / history.list / history.get / templates.list / key.ratchet / key.ratchet_ack / danger.pending / danger.result / session.event / fs.tree / fs.file / slash.list`，相关 auth、bootstrap、设备管理、工作区发现、恢复、ratchet、danger replay、session replay、文件浏览与 session utility 回归测试已切到签名 envelope 主路径。
- relay 现在还会进一步卡住控制链路的降级：`workspace.list / workspace.resolve / history.list / templates.list` 这批无会话 metadata-bearing plain request 会被直接拒绝；若 `workspace.list / workspace.resolve / history.list / templates.list / history.get / slash.list` 请求本来就是加密的，daemon plain response 也不会再被转发给 app，而是改回 `error(PROTOCOL_VERSION)`，其中 `history.get / slash.list` 会保留原始 `session_id`。
- relay 现在也不再接受 `workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list` 这批 no-metadata plain envelope；plain envelope 若保留这条控制链路，必须显式带 outer `message_type + cipher_mode=plain`，且 outer `message_type` 必须与 inner `Message.type` 一致。
- relay 现在也会拒绝带 modern outer metadata 的 plain app runtime request envelope：`session.start / session.agent.add / session.input* / session.command.slash / session.cancel / danger.allow / danger.deny / fs.tree.req / fs.file.req / pty.input / pty.resize`，以及 request 变体 `workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list` 都必须走 `noise_static_v1`；无 outer metadata 的旧 plain envelope / raw JSON 兼容仍暂时保留。
- relay 现在也开始收紧加密 `session.start` 的返回边界：pending session 会记住 `requiresEncryptedTransport`，如果 app 的 `session.start` 已走 `noise_static_v1`，daemon 回 `session.start.result` 时也必须继续保持 `noise_static_v1`；plain downgrade 会被 server 拦下并改回结构化 `session.start.result(rejected, code=PROTOCOL_VERSION)`。
- relay 现在也会把这个边界继续延伸到已确认的加密 session 运行态：`session.event / danger.pending / danger.result / fs.tree / fs.file / history.get / slash.list / key.ratchet / key.ratchet_ack / error(session-scoped)` 若从 daemon 退回 plain，也会被 server 拦下并改回 `error(PROTOCOL_VERSION)`，不再透传明文 session 数据。
- relay framing 阶段的协议错误现在也统一按 `PROTOCOL_VERSION` 返回：包括 legacy raw/plain envelope 被拒、metadata 缺失、明文 downgrade、缺少 `sender_pubkey` 等，不再混报为 `AUTH_INVALID`；签名无效、JWT 无效这类真正鉴权失败仍保持 `AUTH_INVALID`。
- daemon 现在会给加密 `session.start.result` 附最小 outer `routing_payload`（只暴露 `status`，rejected 时再带 `code`）供 server 路由；Flutter `WsClient` 在检测到 `sender_pubkey` 时会优先解密真实 ciphertext，而不是直接消费这个提示，所以不会把真实 payload 再次退化成 placeholder。
- daemon 现在也会给加密 `session.event` 附最小 outer `routing_payload`，server 在不解密业务正文的前提下也能识别 `session.done` 并及时回落 `device.status.active_session_count`；completed-session replay 回归已切到这条真实路径。
- server 现在已把关键加密会话消息的 outer routing hint 进一步收紧成必需字段：`session.start / session.start.result / session.event / danger.allow / danger.deny / danger.pending / danger.result` 若缺少 `routing_payload`，会在 framing 阶段直接拒绝，不再靠伪造 placeholder payload 猜业务状态。
- daemon 现在也会给加密 session-scoped `error` 附 outer `routing_payload`，server 也已把它收紧为必需字段；缺失 session、协议错误等运行态失败在 opaque relay 下能继续被结构化消费，同时旧的 missing-routing fallback 已移除。
- server 现已移除 legacy envelope signing fallback，只接受覆盖 `routing_payload` 在内的现代签名 payload。
- relay 现在也不再接受 raw JSON `session.start.result / replay.done / error`；这些回包路径已完全收口到 envelope 主链路。
- server 现在也会拒绝缺少 `sender_pubkey` 的真 `noise_static_v1` 业务 envelope，避免把“目标端无法解密”的坏包继续盲转发；placeholder 控制消息仍可不带 `sender_pubkey`。
- daemon `workspace.list / workspace.resolve` 现在会额外返回 `is_empty / repo_root / git_branch`，供后续 Flutter 工作区主页与空工作区状态直接消费。
- daemon `workspace.resolve` 现已补第一版路径修复提示：除 `status` 外，还会返回 `status_reason / access_mode / repair_hint`，用于区分 `not_found / not_directory / outside_allowed_paths / permission_denied`，并在可行时给出默认工作区、最近存在祖先目录、同名允许目录或修权限提示。
- Flutter `WsClient` 现已把剩余本地明文回退收紧到 bootstrap placeholder：未注入 transport crypto 时，只有带 outer `routing_payload` 的 `auth/device/pairing/session.resume` 控制消息还能发出；`workspace.* / history.get / slash.list / session.* / pty.*` 等 runtime 消息会本地快速失败。
- 当前剩余的安全边界重点主要收敛到更严格的 relay/pinning 行为与进一步减少开发态 fallback。
