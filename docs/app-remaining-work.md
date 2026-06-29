# HelloBug — 全量剩余工作总表

更新：2026-06-28

> 这份文档是当前阶段的总任务清单，覆盖 `app / server / daemon / protocol` 四块。
> 这份文档也是当前阶段唯一的任务状态真源；其他文档只做规划、分工、规格或启动上下文，不单独维护一套完成状态。
> Flutter 客户端任务明确标记为 **Claude**，协议、后端、daemon、部署与联调总控任务明确标记为 **Codex**。
> 相关支持文档：
>
> - V1 过滤视图：`docs/v1-checklist.md`
> - Server/daemon 启动与回归命令：`docs/backend-runbook.md`
> - Flutter 规划/验收：`docs/flutter-tasks.md`
> - Claude Flutter 范围说明（沿用历史文件名）：`docs/claude-ui-tasks.md`
> - Codex 后端细分：`docs/codex-tasks.md`
> - Claude 启动记忆：`memory/claude-current.md`
> - Codex 启动记忆：`memory/codex-current.md`

## 标记说明

- `[x]` 已完成
- `[~]` 已有骨架 / 部分完成 / 还不能完整交付
- `[ ]` 尚未完成

## 负责边界

- `Claude`：整个 Flutter 客户端，包含 `app/lib/**` 下的页面、状态、Provider、transport、crypto、models、router、bootstrap 与客户端联调
- `Codex`：`packages/protocol`、`packages/server`、`packages/daemon`、部署、测试、跨端联调总控
- `Shared`：需要 app 与 server/daemon 一起对齐的跨端协议、fixture、恢复语义与安全边界

## 当前真实现状

- `[~]` Flutter 端大部分主页面已经有第一版 UI，不再是“缺页面”的问题。
- `[~]` Flutter 当前的核心缺口已经不只是 UI，而是 `transport / crypto / state / runtime wiring` 还没有完全收口。
- `[~]` Flutter 与 wireframe 的根导航已经切到 2-tab 方向，但当前第一分支仍实际挂在 `SessionsPage`；工作区主页这层信息架构还没有完全落地。
- `[~]` app / server / daemon 现在都已接到签名版 `Envelope` 主链路；server 能校验 app / daemon 来向签名，拒绝 `ts` 偏差超过 ±5 分钟或在有效时间窗内原样重放的 signed envelope，并尽量保留原始 envelope 做转发 / replay；同时，已带现代 outer metadata 的 `auth.attach / auth.refresh / daemon.hello / device.pair.* / device.push_token / device.list / device.rename / device.revoke / session.resume / key.ratchet / key.ratchet_ack` 现在也不再允许回退成 `cipher_mode=plain` 的 envelope。
- `[~]` server 对 modern envelope request 的明文降级又收紧了一轮：除上面那批控制消息外，`session.start / session.agent.add / session.input* / session.command.slash / session.cancel / danger.allow / danger.deny / fs.tree.req / fs.file.req / pty.input / pty.resize`，以及 request 变体 `workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list` 现在也不再允许 `cipher_mode=plain`；同时 raw JSON `auth.attach`、`auth.refresh`、`daemon.hello`、`device.push_token`、`device.list / device.rename / device.revoke`、`session.resume`、`session.start`、`session.agent.add`、`session.input*`、`session.command.slash`、`session.cancel`、`danger.allow / danger.deny`、`workspace.list / workspace.resolve`、`history.list / history.get`、`templates.list`、`key.ratchet / key.ratchet_ack`、`danger.pending / danger.result`、`session.event`、`fs.tree.req / fs.file.req / fs.tree / fs.file`、`slash.list`、`pty.input / pty.resize` 也已被移除，V1 主路径中的 raw JSON bootstrap / 直连控制流已基本清空；此外 `workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list` 之外，`session.start / danger.allow / session.event / replay.done / session.start.result / danger.result / fs.tree / fs.file` 这批 plain envelope 现在也必须带 outer metadata 且 `message_type` 必须与 inner message 对齐，剩余兼容进一步收敛到少量开发态 plain envelope 分支。
- `[~]` 已启用一轮 staged E2EE：会话流量 `session.start / session.input / session.input.image / session.input.voice_text / session.command.slash / session.cancel / pty.input / pty.resize -> session.start.result / session.event / danger.pending` 已走 `noise_static_v1`；无会话的 `workspace.list / workspace.resolve / history.list / templates.list` 也已收进保留控制通道 `transport.control.v1`，server 依赖外层 `message_type / cipher_mode / session_id / request_id / seq` 做路由，不再解密这些业务消息。
- `[~]` 这批无会话直连控制请求，以及 session utility `history.get / slash.list` 也已补第二轮 downgrade 收口：metadata-bearing 的 plain request 会被 server 直接拒绝；若 app 发出的是加密请求，daemon 侧也不能再回 plain response，否则 server 会拦下并回 `error(PROTOCOL_VERSION)`，避免把明文结果重新发回 app。
- `[~]` `session.start.result` 这条回包链路也已补到同一收口级别：若 app 的 `session.start` 已走 `noise_static_v1`，daemon 侧回 `session.start.result` 时也必须继续保持 `noise_static_v1`；plain downgrade 不会再被透传，而是由 server 改回结构化 `session.start.result(rejected, code=PROTOCOL_VERSION)`。同时 daemon 会在 outer `routing_payload` 暴露最小 `status/code` 提示，server 现已把它视为必需路由提示而非可选兼容字段；Flutter 在有 `sender_pubkey` 时会优先解密真实 ciphertext。
- `[~]` 同一个已确认的加密 session 进入运行态后，daemon→app 的后续 session-scoped 流量也开始强制保持 `noise_static_v1`：`session.event / danger.pending / danger.result / fs.tree / fs.file / history.get / slash.list / key.ratchet / key.ratchet_ack / error(session-scoped)` 若退回 plain，server 会拦下并改回结构化 `error(PROTOCOL_VERSION)`，避免把明文 runtime 数据重新发回 app；同时 daemon 现已给加密 `session.event`、`danger.pending / result` 以及 session-scoped `error` 补 outer `routing_payload`，server 不再依赖伪造 placeholder payload 猜业务状态，能直接依据这些提示处理 `session.done`、pending danger 与错误路由。
- `[x]` `replay.done` 已明确收口为 server-only 恢复哨兵：app 的 `session.resume` 仍由 server 生成 `replay.done`，但 daemon 侧现在不能再主动上行这条消息，避免恢复链路被伪造或走出多份“完成”语义。
- `[~]` 这批真正需要目标端解密的 `noise_static_v1` envelope，server 现在也会要求带 `sender_pubkey`：缺失时会在 framing 阶段直接拒绝，而不是继续盲转发一个目标端无法解密的坏包；placeholder 控制消息仍保留“不必带 sender_pubkey”的兼容边界。
- `[x]` staged 显式 `key.ratchet` 已双向打通：daemon / app 任一侧都可发起 `key.ratchet`，对端切换会话密钥并回 `key.ratchet_ack`，server 按 `session_id` 定向路由；这两个控制消息本身现在也已走加密 session transport，`key.ratchet` 使用旧 cipher 发出，`key.ratchet_ack` 使用新 cipher 返回，daemon / protocol / server / Flutter 目标验证已通过。
- `[x]` Flutter `WsClient` 已补本地 fallback 收口：未注入 transport crypto 时，只允许 `auth/device/pairing/session.resume` 这类带 outer `routing_payload` 的 bootstrap / control 消息继续发送；`workspace.* / history.get / slash.list / session.* / pty.*` 等 runtime 消息会本地快速失败，不再静默回退成 plain envelope。
- `[~]` 这还不等于“全链路完全 opaque”：虽然正式 pairing 已经走真实两消息 `Noise IK` transcript 并做本地 SAS 校验，且首个加密会话已优先使用 pairing-derived keys，Flutter IO 也已接入 TOFU + server pin 持久化，`session.resume / replay.done`、`device.status / error`，以及 `daemon.hello / auth / device.push_token / device.list / device.rename / device.revoke / device.pair.*` 这批控制消息也已补到 envelope placeholder 形态，但更严格的 relay 安全边界、Web 侧 pinning 与残余开发态兼容仍未完成。
- `[~]` pairing、SAS、`auth.attach/auth.token`、`session.start`、`session.input`、`danger.allow/deny`、replay 基础闭环已存在；server 已能在 `auth.attach` 后补发仍未处理的 `danger.pending`，app 也已按 `danger_id` 做前台去重。
- `[x]` `session.start -> session.start.result` 已补结构化启动结果：daemon 会返回 `started / rejected`，server 只在 daemon 确认成功后注册 session，Flutter `NewSessionFlow` 现在会等待正式回执后再落本地会话并跳转。
- `[x]` server 自产的 `session.start.result(rejected)` 对 envelope 客户端也已切到 opaque placeholder；timeout / offline / 未认证这类启动失败路径不再回退成 plain inner message。
- `[x]` `session.resume -> replay.done` 已补结构化恢复结果：server 会校验 session 归属并返回 `ok / session_not_found`，app 会停止继续恢复失效 session，避免卡在“同步中”。
- `[x]` `session.resume / replay.done` 已补 envelope 恢复态收口：恢复请求现在会带 outer `routing_payload` 并继续走 `noise_static_v1`，server 可在不解密 inner 的前提下执行 replay；`replay.done` 对 envelope 客户端会走 opaque placeholder envelope，避免恢复哨兵重新退回 plain inner message。
- `[x]` `session.done` 现在会把 session 标记为 inactive 而不是直接删除：`device.status.active_session_count` 会在会话结束时立即回落，且 daemon 后续离线后，app 仍可通过 `session.resume` 回放已完成会话的缓存事件。
- `[x]` daemon 中途掉线，或保持在线但迟迟不回包时，挂起中的 `session.start` / `workspace.list` / `workspace.resolve` / `history.list` / `templates.list` / `history.get` / `slash.list` 现在都会由 server 主动回失败，不再只能等客户端本地超时；迟到回包也会被 server 丢弃，不再误广播给其他 app。
- `[x]` `workspace.list / workspace.resolve / history.list / templates.list` 已补进加密 envelope 控制通道：app / daemon 侧统一使用保留 `session_id=transport.control.v1` 与外层 `request_id`，server 可在不解密 payload 的前提下定向转发这类直连请求/响应。
- `[x]` 已在局域网 `ws://192.168.18.8:3000/v1/relay` 验证一轮开发态联调：`pairing -> SAS -> session.start(shell) -> pty.input/pty.resize -> terminal output`，`pwd` 已返回真实工作区路径。
- `[x]` daemon 已补上 `fs.tree.req` / `fs.file.req` / `history.list` / `history.get` / `pty.input` / `pty.resize` / `templates.list` / `slash.list`。
- `[~]` `session.agent.add` 当前已收口为明确错误响应，避免静默失败；真实多 agent runtime 仍未实现。
- `[~]` `device.push_token` 已补 server 持久化，Flutter runtime 也已在本地 token 存在且 `auth.token` / pairing 成功后自动上报；iOS 侧 native APNS token bridge 已接上，Android 侧也已接入 native FCM token bridge（当前按 `manufacturer=Other` 上报，运行时仍需提供 `app/android/app/google-services.json` 才能取到真 token），生产推送服务仍待补齐。
- `[~]` app / daemon 已新增共享 `noise_ik_fixture.json`，Node / Flutter 跨端测试已对齐；正式配对流现已接入真实两消息握手与本地 SAS 校验，但会话初始化仍主要走 staged `noise_static_v1` / static HKDF 派生，且 relay 端仍保留更早期开发态兼容入口，不能宣称所有消息都已端到端加密。

## 总执行顺序

1. 继续推进真正的安全边界：`Envelope`、Noise IK、签名/验签、pinning、relay 安全边界。
2. 继续收口 Flutter 端模板 / slash 的错误态与本地覆盖语义，以及仍保留的少量旧客户端兼容。
3. 再补生产推送服务、设备管理、工作区状态与恢复闭环。
4. 最后进入多会话、多 agent、生产化硬化。

---

## P0：必须先做的任务

### 1. 安全与传输链路

- `[x] [Codex]` 让 daemon 传输层正式切到 `Envelope`，不再以 plain `Message` 为主路径。
- `[~] [Codex]` 为 server / daemon 侧 envelope 补真实签名、验签、seq 管理、错误处理；会话流量与 `workspace/history/templates` 直连控制流量都已接进 opaque relay。
- `[x] [Shared]` 完成 app / daemon 跨端最小 E2EE fixture，对齐 X25519、HKDF、nonce、AEAD 细节。
- `[~] [Shared]` app / daemon 已把 `session_cipher`、双向显式 `key.ratchet`、共享 fixture、真实两消息握手原语与 pairing-derived 首会话引导接到真实会话消息传输；所有消息去除 plain 回退与 pinning 仍未完成。
- `[~] [Codex]` 完成 server 侧真正的 relay 安全边界，而不是“解包后按明文转发”的兼容模式。
- `[~] [Shared]` app 侧 pinning 已补基础接线：Flutter IO 现已支持首次连接记录证书、持久化 server pin、后续连接校验与失败提示；多 pin 轮换策略和 Web 侧能力边界仍待补充。

### 2. Daemon 业务能力补齐

- `[x] [Codex]` 实现 `fs.tree.req -> fs.tree`。
- `[x] [Codex]` 实现 `fs.file.req -> fs.file`。
- `[x] [Codex]` 实现 `history.list` / `history.get`。
- `[x] [Codex]` 实现 `templates.list`。
- `[x] [Codex]` 实现 `slash.list`。
- `[x] [Codex]` 实现 `pty` 会话与 `pty.resize`。
- `[~] [Codex]` `session.agent.add` 当前返回明确 `PROTOCOL_VERSION` 错误，真实多 agent runtime 语义仍待实现。

### 3. Pairing / 设备注册闭环

- `[x] [Codex]` server 持久化 `device.push_token`。
- `[~] [Shared]` app 现在会在 pairing 成功装载 live `WsClient` 后，或后续收到 `auth.token` 时，对当前本地 push token 自动上报 `device.push_token`；iOS 侧 native APNS token bridge 与 Android 侧 native FCM token bridge 都已接入，Android 当前按 `manufacturer=Other` 上报，且运行时仍需提供 `app/android/app/google-services.json`；生产推送服务仍待补齐。
- `[ ] [Shared]` 补齐配对后设备元数据的采集、持久化与展示链路。
- `[~] [Shared]` 已有 `auth.attach -> auth.token -> session.resume/replay.done` 恢复闭环，Flutter 端也已补 `auth.refresh` 定时续期，以及收到 `DEVICE_REVOKED` / `auth.attach|auth.refresh -> AUTH_INVALID` 时清 runtime、返回 onboarding；更完整的恢复页与异常兜底仍待继续打磨。
- `[ ] [Claude]` 补齐配对失败/过期/吊销等状态页与客户端恢复路径。

---

## 功能分项总表

### 1. 协议与共享类型

- `[~] [Codex]` `packages/protocol` 已有主 schema 和测试。
- `[ ] [Codex]` 继续把真实运行时已经用到的字段和 `docs/protocol.md` 完全收口。
- `[x] [Codex]` 已清掉这批 legacy 兼容命名漂移：`fs.read -> fs.file.req`、`content -> data`、`from_seq -> last_seq`，并进一步移除了 relay 对旧版 `session.start` 缺省 `resume_session_id`、旧版 slash 字符串 `args`、旧版 `fs.tree.req.path` 的自动归一化兼容；`auth.attach`、`auth.refresh`、`daemon.hello`、`device.push_token`、`device.list / device.rename / device.revoke`、`session.resume`、`session.start`、`session.agent.add`、`session.input*`、`session.command.slash`、`session.cancel`、`danger.allow / danger.deny`、`workspace.list / workspace.resolve`、`history.list / history.get`、`templates.list`、`key.ratchet*`、`danger.pending / danger.result`、`session.event`、`fs.tree.req / fs.file.req / fs.tree / fs.file`、`slash.list`、`pty.input / pty.resize` 的 raw JSON relay 入口也已收掉，且 `session.start / danger.allow / session.event / replay.done / session.start.result / danger.result / fs.tree / fs.file` 与 `workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list` 也不再接受无 outer metadata 的 plain envelope；当前剩余兼容主要收敛到更少量的开发态 plain envelope 分支。

### 2. 配对与绑定

- `[~] [Claude]` 配对入口、扫码、SAS 页已存在。
- `[~] [Claude]` app 已能发 `device.pair` / 等 SAS / `device.pair.confirm` / 接 `auth.token`。
- `[~] [Shared]` pairing 后真实握手、SAS 校验与首会话初始化都已切到 pairing-derived 材料，但 pin 信任与更广泛的 opaque 控制消息仍未完成。
- `[~] [Shared]` pairing 成功后已写入服务器 pin 与设备显示名；若本地已有 push token 也会自动上报，且 iOS 侧可直接从原生桥接拿到 APNS token，Android 侧可通过原生 FCM bridge 拿到 token（需 Firebase 配置）。设备指纹及更多元数据仍待补齐。
- `[~] [Claude]` `manual_pair_page.dart` 已有完整首版 UI，但真实手输配对流程仍要继续接活。
- `[ ] [Claude]` 配对异常页、异常恢复路径和本地持久化语义统一收口。

### 3. 设备列表 / 设备详情 / 吊销

- `[~] [Claude]` 设备列表页、进入设备详情入口、设备详情页首版 UI 已存在。
- `[x] [Shared]` Flutter 设备列表 / 设备详情现已接上真实 `device.list`、`device.rename`、`device.revoke`，并继续消费 live `device.status`；详情页也已读取真实 `daemon_version / paired_at / last_seen_at`、本地会话计数与 daemon 返回的工作区列表。
- `[x] [Codex]` server 已补设备管理消息第一版：`device.list`、`device.rename`、`device.revoke(mode=unlink|revoke)`；同时会返回真实 `daemon_version / online / paired_at / last_seen_at / active_session_count`，`device.status` 也已补齐这些 live 元数据并在重命名、上下线、会话启动/结束导致的活跃会话数变化后继续广播。
- `[~] [Codex]` presence / 多 app 一致性已补第一轮：`device.status.ts` 现表示本次状态广播时间，`last_seen_at` 不再被重命名或会话数变化伪刷新；离线设备重命名也会同步广播给该 daemon 关联的所有 App。更复杂的多端竞争与恢复语义仍待继续补。
- `[~] [Claude]` 设备列表 / 详情剩余主要是刷新 affordance、失败视觉、更多多设备态与已吊销态的最终视觉收口。

### 4. 启动、解锁、生命周期

- `[~] [Claude]` `UnlockGate`、`UnlockPage`、`UnlockController` 已存在；前台 transport reconnect 已接上，但超时重锁当前保持关闭。
- `[ ] [Claude]` 如果要恢复“后台超过阈值重新上锁”，需要先重新定义规则并重新接线，不要直接依赖旧草稿里的实现假设。
- `[ ] [Claude]` 定义客户端侧解锁状态与敏感操作可用性的真实业务规则。
- `[ ] [Claude]` 启动恢复中、设备吊销、重新解锁、认证失败兜底等状态页与恢复逻辑补齐。

### 5. 会话列表 / 新建会话 / 会话恢复

- `[~] [Claude]` `SessionsPage`、`NewSessionFlow` 已存在。
- `[x] [Shared]` `session.start` 已补正式确认闭环：`session.start.result` 成功后才创建本地会话，失败会返回结构化拒绝结果。
- `[x] [Claude]` 去掉新建会话里的 dev fallback 设备逻辑，切到真实设备/工作区来源。
- `[~] [Shared]` `session.resume` 与 `session_not_found` 基础恢复路径已明确；历史页“继续会话”入口已接上 `session.start + resume_session_id`，Flutter 端也已补第一轮自动恢复跟踪、`replaying` 状态，并把聊天 / 终端输入收口为“仅 `running + online` 可写”；更完整的恢复策略仍待补。
- `[~] [Claude]` 会话不存在、恢复中、空会话列表等 UI 与客户端状态已补第一轮收口；更完整的恢复/空态页面表达仍待继续打磨。

### 6. 聊天主链路

- `[~] [Claude]` chat timeline、input bar、tool card、thinking card、diff card 基本都在。
- `[~] [Shared]` session input、cancel、image chunk upload、voice text、slash command 基础通路已存在；daemon 现已给图片上传补基础失败语义（非 `image/*` MIME、超 2MB、runtime 不支持图片输入等会返回结构化错误），并且入站加密消息若解密后 schema 不合法，也会回结构化错误而不是只在 daemon 终端打日志；但 App 侧发送前确认与更细的失败视觉仍待继续收口。
- `[~] [Claude]` `danger.pending` 已接到 app 全局监听，能自动弹出确认层，且重连补发同一 `danger_id` 时会做前台去重；确认层现在会等待 `danger.result` 再关闭，失败类结果在无活动确认层时也会走全局 alert 兜底，但视觉层状态收口还没完全做完。
- `[ ] [Shared]` 收口 provider 事件模型与 daemon payload，避免继续漂移。
- `[~] [Claude]` 聊天页与聊天状态机：空会话空态 / 等待首条回复 spinner / 会话结束（已有 `done` item）/ session not found 页已接入；`done / session_not_found / replaying / 断线` 下的 banner 与输入禁用已补第一轮语义，仍待继续收口更完整的恢复/错误页面状态。

### 7. 危险操作确认

- `[~] [Claude]` `DangerConfirmSheet` 已存在。
- `[x] [Codex]` daemon `dangerInterceptor`、server 侧待审批缓存、`danger.result` 结构化回执，以及 app 重连后的 `danger.pending` 恢复已接通。
- `[~] [Claude]` app 侧对 `danger.pending` 的全局订阅、弹层路由、重复 `danger_id` 去重、allow/deny 正式 payload、`danger.result` 等待，以及失败结果的全局 alert 兜底已接通；状态收口仍未完成。
- `[~] [Shared]` danger request 生命周期已定义结构化回执：`approved / denied / timed_out / not_found / biometric_required`；仍需继续收口更多客户端视觉状态与跨页提示。
- `[ ] [Claude]` 补确认失败、已超时、已被其他端处理等视觉与客户端状态。

### 8. 文件树与文件预览

- `[~] [Claude]` 文件树页和文件预览页已有第一版 UI。
- `[x] [Codex]` daemon 已实现 `fs.tree.req` / `fs.file.req`，server 也已补当前 Flutter 所需的兼容桥接与测试。
- `[x] [Claude]` app 已改为发送正式 `fs.tree.req { session_id, workspace_path, dir_path }`，`applyResponse` 已解析 `entries/type` 字段；文件预览已改为自行解码 `fs.file.data` base64url，移除 `content` 兼容回退。
- `[x] [Shared]` 已定义文件预览正式返回语义：daemon `fs.file` 现在会显式返回 `ready / binary / too_large / permission_denied / not_found`，文本文件继续按分片 `data(base64url)` 返回。
- `[~] [Claude]` 文件预览页已有 `loading / empty / error`，并已承接 `binary / too_large / permission_denied / not_found` 与 `SESSION_NOT_FOUND / WORKSPACE_FORBIDDEN`；后续剩余主要是高亮、虚拟滚动和更细的视觉收口。
- `[~] [Claude]` 文件树页已补工作区失效 / 会话失效的基础错误态与返回 / 重试分流；更完整的空态、权限受限态与客户端缓存行为仍待继续收口。

### 9. Diff

- `[~] [Claude]` diff 页面、diff 卡片、spike 页面已存在。
- `[x] [Codex]` daemon 现已基于 Claude `Write / Edit / MultiEdit` 工具的前后快照输出 `file.changed { file_path, diff, added, removed }`，并补了回归测试与审计接线。
- `[~] [Shared]` 已定义当前基础降级：越界路径、非文本、超大文件、无实际变更、工具失败时不发 diff；更细的超大 diff 截断、分页与显式失败反馈语义仍待继续收口。
- `[ ] [Claude]` 补 diff 过大、加载失败、无变更、跳转文件预览等 UI 与客户端交互状态。

### 10. 历史记录

- `[~] [Claude]` 历史列表和详情页已有 UI。
- `[x] [Codex]` daemon 已实现 `history.list` / `history.get`，按工作区映射 Claude transcript 目录并返回原始 JSONL 分页。
- `[x] [Codex]` transcript 存储来源、分页与基础读取规则已收口到 `~/.claude/projects/<workspace-slug>/*.jsonl`。
- `[~] [Claude]` 历史页已切到正式协议并能解析基础 Claude JSONL，且 `SESSION_NOT_FOUND / WORKSPACE_FORBIDDEN` 已有基础错误分流与重试/返回；筛选/搜索态和更完整的恢复失败态仍待补。

### 11. 终端

- `[~] [Claude]` terminal 页面、toolbar、status bar UI 基本存在。
- `[x] [Codex]` daemon 已实现真实 PTY runtime、输出流转发、`pty.input` / `pty.resize`、关闭。
- `[~] [Shared]` 终端只读模式与会话结束 / 失效后的基础状态回执已接通；权限拒绝等更细语义仍待继续定义。
- `[~] [Claude]` 终端页已切到 `session.event -> pty.data` 正式事件形态，并补上恢复中 / 失效 / 已结束时的只读 gating；未连接细节、权限拒绝和更多宿主行为仍待补。

### 12. 模板、Slash、图片、语音

- `[~] [Claude]` 模板页、slash palette、图片输入、语音输入 UI 已存在。
- `[x] [Codex]` `templates.list`、`slash.list` 已有 daemon 默认后端来源。
- `[~] [Shared]` Flutter 模板列表与输入栏芯片已经接到 `templates.list`，并支持本地 override / delete 持久化；模板 CRUD 是否最终落 app 本地还是 daemon/server 仍需正式定下来。
- `[ ] [Shared]` 图片输入最终链路继续完善，包括上传完成确认、失败回执、服务端限制。
- `[~] [Claude]` 语音输入已接上真实 STT、权限声明和 `session.input.voice_text` 发送；更完整的权限拒绝恢复与状态抽象仍待收口。
- `[~] [Claude]` 聊天输入栏图片/语音入口已完成；发送前确认、异常状态和本地交互仍待收口。

### 13. 设置

- `[~] [Claude]` 设置主页、安全、通知、模板、中继、外观、关于页都已经有第一版 UI。
- `[ ] [Claude]` 这些设置页背后的真实 app 数据源、Provider 与本地持久化大多还未接上。
- `[ ] [Claude]` 安全页中的密钥指纹、SAS 历史、加密状态改为真实数据。
- `[ ] [Claude]` 通知页中的 push 注册状态、token 状态、DND 配置接上真实业务。
- `[ ] [Shared]` relay settings 页接上真实 server 配置、pin 信息和连接测试。
- `[ ] [Claude]` 统一补 loading / saving / saved / error 四类设置页状态，并收口设置状态机。

### 14. 通知与推送

- `[~] [Claude]` 通知设置页、push landing 设计稿都已具备方向。
- `[x] [Codex]` server 已支持 `device.push_token` 存储。
- `[~] [Codex]` daemon -> server 的 `push.trigger` 已正式落地：协议、relay/framing、离线 app 设备过滤调度骨架，以及 daemon 对 `session.done / danger.pending / error(session-scoped)` 的自动触发都已接通，并补了 `protocol/server/daemon/test:v1:backend` 回归；剩余是 APNS / Android 厂商推送 provider 真正出网。
- `[~] [Codex]` 推送触发策略已明确第一版：任务完成、danger pending、agent error 已落地；`need_input`、设备上下线等是否进入 V1 仍待后续定口径。
- `[~] [Shared]` app runtime 已补 `device.push_token` 自动上报；push 打开后的 deep link、会话恢复、danger 跳转已补骨架，iOS 原生 token bridge 与 Android 原生 FCM token bridge 都已接入，剩余是生产推送服务与 Android 厂商通道细化。
- `[ ] [Claude]` push landing 页、通知权限被拒绝后的 banner / 状态页补齐。

### 15. 工作区管理

- `[~] [Claude]` 工作区切换 sheet 已存在，且现在会优先读取 `workspace.list`、对手输路径和本地历史路径调用 `workspace.resolve` 预检；根导航也已经转向 2-tab，但设计稿里的工作区主页体系还没真正落地。
- `[~] [Codex]` daemon / server 已补工作区发现消息增强版：`workspace.list`、`workspace.resolve`，除 `ready / missing / forbidden / not_dir` 与 `entry_count` 外，现在还会返回 `status_reason / access_mode / repair_hint`，并继续补 `is_empty / repo_root / git_branch` 基础元数据；`history.list` 也已保留 request id，且这批无 session 请求/响应现已统一走加密控制通道并由 server 定向回发起 app，而不是广播。
- `[~] [Shared]` 会话、历史与当前工作区现在已有统一客户端状态：`workspace_history_provider` 会持久化 `currentPath`，聊天页“切换工作区”会保留旧会话并带新路径进入 `NewSessionFlow`，文件树 / 文件预览 / diff / 终端打开时也会同步当前工作区；切换 sheet 与 daemon 工作区状态已接通，更完整的文件树 / diff / 分支上下文联动规则仍待继续收口。
- `[~] [Shared]` 文件树 / 文件预览 / 历史页已补 `SESSION_NOT_FOUND`、`WORKSPACE_FORBIDDEN` 基础错误承接；更完整的工作区失效/权限受限状态仍待继续收口。
- `[ ] [Claude]` 工作区主页、工作区设置、路径失效、空工作区、新建工作区、权限受限页接入 `workspace.list / workspace.resolve`，并把新的 2-tab 工作区入口、路由和页面语义收口一致。

### 16. 多会话 / 横屏 / 多布局

- `[~] [Claude]` 设计稿已有多 tab、横屏双栏，Flutter 侧也已有部分壳。
- `[ ] [Shared]` 会话并发、后台保活、不同会话状态同步需要真实业务支持。
- `[ ] [Claude]` 多会话 tab 容器、横屏双栏容器、从聊天切终端/文件树的布局一致性和客户端状态同步收口。

### 17. 多 Agent / 群组会话

- `[ ] [Codex]` 扩展 session 数据模型，落地真正的 `session.agent.add`、agent routing、agent 归属事件。
- `[ ] [Codex]` 收口多 agent 的 replay、danger、history、audit 规则。
- `[ ] [Claude]` 群组 agent 列表、添加 agent、@mention、agent routing、agent status、按 agent 看历史的 UI。
- `[ ] [Shared]` 这是后置阶段，不应阻塞前面单 agent 主链路。

### 18. 生产化与运维

- `[ ] [Codex]` 把内存 registry / buffer 逐步收口为更稳的持久化方案或至少可恢复状态方案。
- `[ ] [Codex]` 增加限流、审计、日志、重试、观测、崩溃恢复。
- `[ ] [Codex]` 真正接上 Caddy / TLS / mTLS / systemd 的部署闭环。
- `[x] [Codex]` 已形成第一版本地开发、联调与回归命令：新增 `docs/backend-runbook.md`，并在 `packages/package.json` 收好 `test:server:relay / test:daemon:v1 / test:v1:backend`；daemon 也已支持用环境变量直接覆盖 `server_url / bootstrap_token / allowed_paths`，不再强依赖先写配置文件。

---

## Claude 当前应接的 Flutter 任务

> Claude 现在负责整个 Flutter 客户端，不只 UI。这里优先列客户端仍未收口的关键任务。

### 客户端运行时 P0

- `[~] [Claude]` app 侧 `noise_ik.dart` / `session_cipher.dart`、真实配对 transcript、pairing-derived 首会话引导与双向显式 `key.ratchet` 已接入会话传输；仍需继续移除剩余 plain envelope 回退并补 pinning 收口
- `[ ] [Claude]` app 侧 pinning、JWT 恢复、`bootstrap()` 生命周期接线补齐
- `[~] [Shared]` pairing 成功后 / 后续 `auth.token` 时已会自动上报当前本地 push token；Android 当前通过 FCM bridge 上报并按 `manufacturer=Other` 落库，本地 runtime 其余元数据、设备指纹与更多持久化收口仍待补
- `[~] [Claude]` `danger.pending` 全局监听、弹层路由和 allow/deny 正式 payload 已接通；状态回执处理仍未完成
- `[x] [Claude]` 文件树 / 文件预览最终切到正式 payload：`fs.tree.req { workspace_path, dir_path }`，并在客户端自行解码 `fs.file.data`
- `[x] [Claude]` 去掉 new session 的 dev fallback 设备逻辑
- `[ ] [Claude]` 2-tab 根导航下第一分支从“会话页过渡态”收口到真正的工作区语义

### 已完成的 Flutter 基础

### 已完成

- `[x] [Claude]` 手动配对页 `34` 首版 UI
- `[x] [Claude]` 安全与隐私页 `18`
- `[x] [Claude]` 通知与推送页 `20`
- `[x] [Claude]` 快捷模板页 `22` 与模板表单 Sheet `38`
- `[x] [Claude]` 中继服务器设置页 `39`
- `[x] [Claude]` 设备详情页 `23` 与设备列表进入详情入口
- `[x] [Claude]` 会话信息 Sheet `40`
- `[x] [Claude]` 语音输入 Sheet `16`
- `[x] [Claude]` 消息操作 Sheet `29`
- `[x] [Claude]` 危险规则表单 Sheet `30`
- `[x] [Claude]` 终端状态栏 UI 组件 `31`
- `[x] [Claude]` 设置主页入口补齐：安全 / 通知 / 模板 / 中继
- `[x] [Claude]` 聊天输入栏图片入口、语音入口
- `[x] [Claude]` 会话页头部“会话信息”入口
- `[~] [Claude]` 文件预览基础态：`loading / empty / error`
- `[~] [Claude]` 历史页基础态：`loading / empty`

### UI / 状态 P0

- `[ ] [Claude]` 启动恢复中页 `46`
- `[ ] [Claude]` 重连状态页 `41` 的最终状态 UI
- `[ ] [Claude]` 设备吊销页 `47`
- `[ ] [Claude]` 配对过期页 `48`
- `[ ] [Claude]` 工作区路径失效 / 空工作区 / 新建工作区 / 权限受限页 `49/50/51/60`
- `[ ] [Claude]` push landing 页 `53`
- `[~] [Claude]` 聊天页内“会话结束 / 空态 / 恢复中 / 错误态”已补第一轮行为，专门状态页与更完整视觉仍待继续
- `[x] [Claude]` 文件预览页的 `large-file / binary / permission` 状态补齐
- `[ ] [Claude]` 设备列表右上角设置入口与刷新 / 失败视觉收口

### UI / 状态 P1

- `[ ] [Claude]` 工作区主页 `43` 与工作区设置页 `45`
- `[ ] [Claude]` 多会话 tab UI `35`
- `[ ] [Claude]` 横屏双栏 UI `36`
- `[ ] [Claude]` 设备详情页和设备列表的刷新/错误/已吊销视觉状态
- `[ ] [Claude]` 历史记录页的失败态、筛选态、搜索态
- `[~] [Claude]` 终端页只读/已结束状态已补，权限拒绝仍待继续
- `[ ] [Claude]` 通知权限被拒绝后的设置内状态提示

### P2

- `[ ] [Claude]` 群组 agent 全套 UI `54-59`

---

## Codex 当前应接的开发任务

### P0

- `[x] [Codex]` daemon 实现 `fs.tree.req` / `fs.file.req`
- `[x] [Codex]` daemon 实现 `history.list` / `history.get`
- `[x] [Codex]` daemon 实现 `templates.list` / `slash.list`
- `[x] [Codex]` daemon 实现 PTY runtime 和 `pty.resize`
- `[x] [Codex]` server 持久化 `device.push_token`
- `[~] [Codex]` app / server / daemon 统一 envelope 正式链路：会话流量、`workspace/history/templates` 直连控制流量、恢复请求 `session.resume`、server 自产的 `device.status / error`，以及 `daemon.hello / auth / device.push_token / device.list / device.rename / device.revoke` 控制链路已完成；`workspace/history/templates` 这批直连控制消息的 raw JSON 与 no-metadata plain envelope fallback 也已收掉，剩余主要是更早期 `session.start / danger / runtime` 分支收口

### P1

- `[x] [Codex]` server 补设备重命名 / 吊销 / 元数据刷新消息
- `[~] [Codex]` push backend：daemon -> server `push.trigger`、离线 app 设备过滤与 dispatch 记录已落地；APNS / Android 厂商推送 provider 仍待补齐
- `[~] [Codex]` 工作区真实管理：`workspace.list / workspace.resolve` 已落地，并已补 `is_empty / repo_root / git_branch`、`status_reason / access_mode / repair_hint`；更深仓库上下文与客户端最终消费这些修复提示的闭环还没做完

### P2

- `[ ] [Codex]` relay 安全边界、签名验签、seq 与可恢复状态继续硬化
  当前已额外移除 legacy envelope signing fallback，并收掉 raw JSON `session.start.result / replay.done / error` 与缺少 `routing_payload` 的加密 `error` 兼容入口
- `[ ] [Codex]` 多 agent / 多会话后端模型扩展
- `[ ] [Codex]` 多会话并发
- `[ ] [Codex]` 多 agent

---

## 完成标准

- 单设备单会话主链路跑通：
  - 配对成功
  - 会话创建成功
  - 聊天消息双向正常
  - danger confirm 生效
  - 文件树、文件预览、历史、终端均可联调
- 安全链路达标：
  - app 到 daemon 不再依赖明文 `Message`
  - `Envelope` 真正签名、验签、加解密
  - pinning、生物识别、push token 至少有基础闭环
- 页面完整度达标：
  - 所有主流程页面都有 loading / empty / error / not-found / revoked 等必要状态
  - 没有仍挂在路由里的明显占位页面
