# HelloBug — Codex 任务清单

> 总任务完成状态以 `docs/app-remaining-work.md` 为准。
> 本文件只包含 **Codex 负责的后端与基础设施任务**。
> 整个 Flutter 客户端由 Claude 负责，见 `docs/flutter-tasks.md`。
> 协议格式规范见 `docs/protocol.md`。
> 更新：2026-06-23

---

## 状态标记

- `[x]` 已完成
- `[~]` 进行中 / 已有基础骨架
- `[ ]` 未开始

## 开发准则

- 路由层只负责协议校验、连接接线、返回响应，不直接承载核心业务编排。
- 核心业务逻辑优先放到独立 `service` / `router` / `registry` 模块，避免巨型 `route` 或巨型 `connection` 文件。
- 状态存储与连接路由分离：在线状态、配对状态、session 路由分别独立维护，便于未来替换为持久化实现。
- daemon 侧传输层只负责连、收、发；配对、agent、session 等业务能力拆到各自模块。
- 只有稳定复用的公共能力才抽共享组件，避免为抽象而抽象。

## 当前开发状态

- `[x]` 已完成后端 workspace 基础设施：`packages/` 根下的 workspace、TypeScript、ESLint、Prettier、脚本
- `[x]` 已完成 `packages/protocol` 基础实现：Zod schema、类型导出、基础测试
- `[~]` 已完成 `packages/server` 第一版骨架：`/health`、`/v1/register`、JWT/证书、配对服务、在线状态广播、session 级 relay 路由骨架
- `[~]` 已完成 `packages/daemon` 第一版骨架：配置、设备密钥、配对槽位、注册流程、WebSocket 连接、消息路由、工作区围栏、可替换的 session manager / runtime 基础闭环、图片分片临时文件组装、危险操作审批骨架、加密审计日志，以及已对齐真实 Claude Code CLI 多轮 `stream-json` 行为的子进程 runtime
- `[x]` 当前已验证 `packages/protocol`、`packages/server`、`packages/daemon` 的单包 `build` / `test` / `lint` 通过；`packages/` 根脚本仍依赖 `pnpm`，当前 shell 无 `pnpm`
- `[ ]` 尚未完成真实 E2EE、Noise IK、mTLS 校验、完整生产级 Agent 集成、文件系统、推送与多 Agent 群组能力

## 后续开发顺序

1. 先补完 M1 剩余核心能力：Noise IK、真正的 envelope 签名/验签、relay 路由与基础配对确认闭环。
2. 继续推进 M2，在当前已对齐真实 CLI 行为的 Claude runtime 之上补危险操作拦截、审计、断线重放与真实录制回放。
3. 之后按 M3 文件系统、M4 多并发/推送、M5 多 Agent 群组顺序推进，避免范围同时膨胀。

---

## 前置 Spike（开始其他工作前必须完成，状态：[~] 进行中）

这几个 spike 的结论会影响后续实现路径，必须优先跑通。

### Spike 1：E2EE 跨端互通（1-2 天）
**目标**：Node 端 + Flutter 端之间，用 Noise IK 握手后加解密一条消息。

- Node 端：`libsodium-wrappers`（当前已在 `packages/daemon` workspace 中引入）
- Flutter 端：`cryptography`（pub.dev，Dart）
- 验证：两端密钥派生、nonce 处理、AEAD 标签长度完全一致
- 产出：一个能跑的 test fixture，包含公钥对、握手向量、加密消息、期望密文

### Spike 2：Claude Code stream-json 稳定性（1-2 天）
**目标**：确定 daemon 接入 Claude Code 的主路径。

状态：`[x]` 当前阶段已完成，M2 主路径已选定为 CLI `stream-json` 子进程；SDK 记录为后续替换候选。

- 本机验证环境：
  - Claude Code CLI：`2.1.185`
  - Claude Agent SDK：`@anthropic-ai/claude-agent-sdk@0.3.185`
- 路径 A：`claude -p "" --verbose --input-format stream-json --output-format stream-json`
  - `--print` 配合 `--output-format stream-json` 时必须同时带 `--verbose`
  - 多轮长会话必须启用 `--input-format stream-json`，stdin 不能再写纯文本行，必须写 NDJSON user message
  - 已确认可接受的 stdin 形态至少包括：
    - `{"type":"user","message":{"role":"user","content":"..."}}`
    - `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`
  - `result` 表示单轮结束，不表示整个 Claude 子进程会话结束；daemon 必须把它映射为 `session.usage`，`session.done` 只在子进程退出时发送
  - 常见输出事件族：
    - `system/init`
    - `system/api_retry`
    - `assistant`
    - `user`
    - `result`
  - 真实工具调用主形态不是顶层 `tool_use / tool_result`，而是：
    - `assistant.message.content[]` 中出现 `tool_use`
    - `user.message.content[]` 中出现 `tool_result`
  - `--include-partial-messages` 会引入 `stream_event` / `content_block_delta` 等额外帧；M2 当前不启用，先保持协议与 parser 收敛
- 路径 B：`@anthropic-ai/claude-agent-sdk`
  - npm 包、README 与类型声明已核对，主入口是 `query({ prompt, options }) -> AsyncGenerator<SDKMessage>`
  - SDK 原生提供 `streamInput()`、`interrupt()`、`CanUseTool`、`includePartialMessages` 等高层控制能力，长期看更适合做权限守卫和多端控制
  - 但当前 daemon 会话层已经基于 CLI 子进程打通，M2 为避免再次整体换接线，先选路径 A 落地；路径 B 作为后续重构候选，不阻塞当前开发
- 已落地到代码：
  - `packages/daemon/src/agents/claude.ts` 已改为真实 `stream-json` JSON stdin、多轮 session、串行 stdout 处理与 `--verbose/--input-format` 参数组合
  - `packages/daemon/src/agents/claude-event-parser.ts` 已支持从 `assistant.message.content[]` 提取 `thinking/text/tool_use`，从 `user.message.content[]` 提取 `tool_result`
  - `packages/daemon/test/claude.test.ts` 已覆盖嵌入式工具事件、多轮 `result != session.done`、JSON stdin 与图片路径输入

### Spike 3：Codex 非交互模式（1 天）
**目标**：确认 `codex exec` / JSON 输出是否可靠。

- 跑 `codex exec` 看输出格式与稳定性
- 若 JSON 不稳定，记录哪些边界情况
- 产出：决定 M4 的 Codex 适配器走 JSON 还是 PTY 兜底

---

## M1：安全骨架（约 5-7 天，状态：[~] 进行中）

### 1.1 Monorepo 骨架

状态：`[x]` 已完成

```
HelloBug/
├── app/
├── docs/
└── packages/
    ├── package.json
    ├── pnpm-workspace.yaml
    ├── tsconfig.base.json
    ├── protocol/      pnpm workspace
    ├── daemon/        pnpm workspace
    └── server/        pnpm workspace
```

- `packages/pnpm-workspace.yaml`：声明三个 workspace 包
- `packages/package.json`：`dev`、`build`、`test`、`lint` 脚本
- `packages/tsconfig.base.json`：`strict: true`，`target: ES2022`，`moduleResolution: bundler`
- ESLint + Prettier 配置位于 `packages/` 根，避免污染仓库外层
- `packages/protocol/`：独立 tsconfig，编译产物供 daemon 和 server 引用

### 1.2 packages/protocol — 共享 Schema

状态：`[x]` 已完成基础协议落地与测试；后续如 `docs/protocol.md` 继续变更，再同步补字段。

文件结构：
```
packages/protocol/src/
  envelope.ts       # 路由层类型
  messages.ts       # 所有业务消息类型（App↔Server↔Daemon）
  events.ts         # agent 事件类型（assistant.delta 等）
  index.ts          # re-export
```

具体要实现：
- **`docs/protocol.md` 是唯一字段真源**。`packages/protocol` 只负责把协议文档逐字落成 Zod schema 与 TypeScript 类型，不在本文件重复定义字段名，避免再次漂移。
- `messages.ts` 需完整覆盖当前协议中的消息：
  - 鉴权：`auth.attach` / `auth.refresh` / `auth.token`
  - 配对：`device.pair` / `device.pair.ready` / `device.pair.sas` / `device.pair.confirm` / `device.push_token`
  - 会话：`session.start` / `session.agent.add` / `session.resume` / `session.input` / `session.cancel`
  - 文件 / 历史 / PTY / 模板 / 错误响应等其余消息
- `events.ts` 需完整覆盖 `session.event` 联合类型，并同步 M5 扩展：
  - 外层 envelope 支持 `agent_id?` / `agent_type?`
  - `file.changed` 的归属字段取外层 envelope，不再在事件体内重复定义
  - `fs.tree.modified` 类型固定为 `boolean | null`
- `notification.push` 仅作为 push payload DTO / appendix schema 保留，不进入运行时 WebSocket 消息总表。
- 所有类型用 Zod 定义，导出 TypeScript 类型（`z.infer<typeof Xxx>`）与统一 `validate(raw)` 入口。

### 1.3 packages/daemon — 主进程骨架

#### 1.3.1 密钥生成与存储（`src/crypto/keys.ts`）
状态：`[x]` 已完成基础实现（本地生成、持久化、恢复、导出公钥）。

- 生成 Ed25519 长期身份密钥对（签名用）
- 生成 Curve25519 密钥对（Noise IK 密钥协商用）
- 首次启动自动生成，持久化到 `~/.hellobug/device.key`（0600 权限），重启后从本地文件恢复
- 导出公钥（Base64），供配对流程展示

#### 1.3.2 Noise IK 握手（`src/crypto/noise.ts`）
状态：`[ ]` 未开始。

- 使用 `libsodium-wrappers` 实现 Noise IK pattern
- initiator 侧（daemon 发起）和 responder 侧（App 发起）均实现
- 握手完成后派生 sending_key + receiving_key（ChaCha20-Poly1305）
- 会话密钥每 100 条消息**或** 10 分钟自动轮换（双条件取先到者），旧密钥立即销毁
- 对外暴露：`encrypt(plaintext: Buffer, key: SessionKey): Buffer`、`decrypt(ciphertext: Buffer, key: SessionKey): Buffer`

#### 1.3.3 配对码生成（`src/pairing/code.ts`）
状态：`[~]` 已完成 pairing slot / code / SAS 响应基础能力；真实 Noise 握手与完整确认后本地绑定逻辑未完成。

- daemon 本地生成 `pairing_id`（32 字节随机 hex）+ 6 位 `pairing_code`
- 30 秒过期（setTimeout + Map 存储），并通过 `device.pair.ready { pairing_id, pairing_code, expires_at }` 上报 server
- SAS 生成：从握手完成后的共享密钥派生 5 个 emoji（固定 emoji 列表，HMAC-SHA256 切片）
- 提供 `issuePairingSlot()`、`consumePairingSlot()`、`getSas(sessionKey)` 函数

#### 1.3.4 传输层（`src/transport/connection.ts`）
状态：`[~]` 已完成注册、WebSocket 连接、消息路由拆分，以及 `session.start / session.input / session.cancel` 接入 daemon 会话层；真实 E2EE、签名、seq 校验、mTLS 验证未完成。

- **daemon 主动 outbound 连服务器**（反向 WebSocket）
- 若本地尚无设备证书，先调用 `POST /v1/register`（普通 HTTPS）完成 bootstrap 注册，拿到 `{ cert, ca_cert }` 后再连接 `/v1/relay`
- 连接参数：服务器 wss:// 地址 + 设备 mTLS 客户端证书
- 发送 `daemon.hello`，附设备公钥
- 心跳：每 30 秒发 ping，收到 pong 确认；60 秒无响应断线
- 自动重连：指数退避（1s → 2s → 4s → … → 60s 上限），网络恢复后立即连
- 消息发送：`send(envelope: Envelope, plaintext: Buffer)`，自动封装 E2EE + 签名
- 消息接收：解包 envelope → 验签 → 解密 → 路由到对应 handler
- seq 管理：发送方递增，接收方检测乱序（乱序打日志，不丢弃）

#### 1.3.5 主进程入口（`src/index.ts`）
状态：`[~]` 已完成基础启动流程与 session manager 接线；优雅关闭细节、watchdog、真实 agent runtime 未完成。

- 解析 config（`~/.hellobug/daemon.json`）：服务器地址、工作区白名单
- 初始化密钥 → 启动传输层 → 注册消息处理器
- 监听 SIGTERM / SIGINT，优雅关闭（回收所有子进程）
- systemd watchdog 心跳（`WATCHDOG_USEC` 环境变量检测）

#### 1.3.6 会话层骨架（`src/sessions/`）
状态：`[~]` 已完成模块化 session manager、事件发射器和可替换 runtime 接口；当前 runtime 为内存 echo stub，用于打通 daemon 会话主链路。

- `manager.ts`：维护 `session_id -> SessionHandle`，负责 `start / input / cancel` 编排与基础并发上限
- `events.ts`：统一构造 `session.event`，集中维护 seq 递增与事件封装
- `runtime.ts`：定义可插拔 agent runtime 接口，后续 Claude / Codex / shell PTY 直接按此接入
- `memory-runtime.ts`：当前最小运行时，实现输入回显与取消后发送 `session.done`
- 已接入 `allowed_paths` 工作区围栏，`session.start` 若越界会返回 `WORKSPACE_FORBIDDEN`

### 1.4 packages/server — 主进程骨架

#### 1.4.1 Fastify 服务器（`src/index.ts`）
状态：`[~]` 已完成 Fastify 应用骨架与 `GET /health`；`/v1/relay` 仅基础接线。

- Fastify 5 + `@fastify/websocket`
- HTTP 端点：`GET /health`（返回 `{ok: true}`）
- WebSocket 端点：`/v1/relay`
- TLS 由 Caddy 处理，服务器监听 localhost:3000
- mTLS 客户端证书验证（从 Caddy 透传 `X-Client-Cert` header，服务器验证签名）

#### 1.4.2 认证模块（`src/auth/`）
状态：`[~]` 已完成 bootstrap token、JWT、证书签发、pairing service 基础结构；设备吊销与更完整绑定流程未完成。

- `register.ts`：实现 `POST /v1/register`，校验 server 侧签发的一次性 bootstrap token（哈希存内存，TTL 5 分钟），为 daemon 签发 mTLS 证书
- `pairing.ts`：处理 `device.pair` / `device.pair.confirm`，通过 `pairing_id` 槽位把 App 配对请求路由到对应 daemon，完成 SAS 校验与设备绑定
- `device.ts`：设备注册表（daemon 证书身份、App 设备 JWT 身份、吊销状态）
- `jwt.ts`：签发短 TTL JWT（建议 1 小时），提供 `auth.attach` / `auth.refresh` 验证与续期；JWT payload 只含 `device_id`
- `cert.ts`：维护 server 自签 CA 与 daemon mTLS 客户端证书签发；App 不参与 mTLS

#### 1.4.3 中继逻辑（`src/relay/`）
状态：`[~]` 已完成 relay handler / registry / session registry，以及 app ↔ daemon 的配对、会话消息转发、`session.event` 环形缓冲与 `session.resume` 重放；消息签名验证未完成。

- `router.ts`：根据 envelope 的 `to_device_id` 找到对应 WebSocket 连接，转发
- `buffer.ts`：每个 session_id 对应一个环形缓冲（最近 500 条，TTL 24h）
  - 当前已实现 `session.event` 的最近 500 条缓存、TTL 清理与 `replay(session_id, last_seq)` 查询
  - 现阶段先缓存协议中已定义 `seq` 的 `session.event`，其余消息类型待补充明确重放语义后再纳入
- `session.ts`：会话注册表（`session_id → {app_device_id, daemon_device_id}`）
- 消息签名验证：验证 envelope 的 Ed25519 签名（用发送方已注册的公钥）

#### 1.4.4 设备在线状态（`src/state/presence.ts`）
状态：`[~]` 已完成基础在线状态记录与 `device.status` 广播骨架；真实多设备场景与重放一致性仍待补全。

- WebSocket 连接时标记设备在线，断线时标记离线
- 状态变化推送：给该设备关联的所有 App 连接发 `device.status` 事件
- 提供 `isOnline(device_id)` 查询

---

## M2：聊天闭环（约 5-7 天，状态：[~] 进行中）

### 2.1 Claude Code 适配器（`packages/daemon/src/agents/claude.ts`）
状态：`[~]` 已完成子进程 runtime、真实 CLI `stream-json` 对齐、runtime factory 与 fixture 测试；真实危险工具握手、录制回放 fixture 与更完整错误恢复仍待补全。

- 子进程模式（根据 Spike 2 结果选定）：
  ```
  claude -p "" --verbose --input-format stream-json --output-format stream-json [--resume session_id]
  ```
- 管理子进程生命周期（spawn / kill / exit 处理）
- 解析 stdout NDJSON 流：
  - `system` / `init` → 忽略或记录
  - `assistant` → 解析 `message.content[]` 中的 `thinking / text / tool_use`
  - `user` → 解析 `message.content[]` 中的 `tool_result`
  - `result` → 发 `session.usage`，表示单轮完成但 session 继续存活
  - `session.done` → 只在 Claude 子进程退出时发送
- stdin 转发：收到 `session.input` 时写入 JSON user message，而不是纯文本行
- 输入扩展：`session.input.voice_text`、`session.command.slash` 与 `session.input.image` 已接入 runtime；图片分片会在 daemon 侧组装为临时文件，并作为用户消息内容把路径注入 Claude
- 取消：收到 `session.cancel` 时向子进程发 SIGINT
- 多会话隔离：每个 session_id 对应独立子进程，消息不串台
- `--resume`：恢复历史会话时传 `--resume <session-id>`
- 当前实现说明：
  - 已新增 `agents/claude-event-parser.ts`，把真实 `assistant / user / result` 帧映射为协议事件，并兼容顶层 `tool_use / tool_result`
  - 已新增 `agents/factory.ts`，由 `agent_type` 选择 runtime；当前 `claude_code` 走子进程 runtime，`shell` / `codex` 仍暂用内存 stub
  - 已新增 `fs/image.ts`，支持 `session.input.image` 分片组装、临时文件落盘与按 session 清理
  - Claude stdout 现已在 daemon 内部按行串行处理，避免 `tool.use / tool.result` 在异步边界上乱序
  - 已用假 fixture 子进程覆盖 `assistant.thinking`、`assistant.delta`、`tool.use`、`tool.result`、`session.usage`、多轮 `result != session.done`、`cancel -> SIGINT` 与图片路径注入

### 2.2 危险操作拦截（`packages/daemon/src/guard/`）
状态：`[~]` 已完成规则加载、审批队列、`danger.pending / allow / deny` 路由与 60 秒自动 deny；真实 Claude CLI 原生工具拦截握手仍待结合 Spike 2 继续补强。

- `rules.ts`：规则加载（从 `~/.hellobug/danger-rules.json`）
  - 黑名单：正则列表，命中 → 拦截，等待手机确认
  - 白名单工具：`Read / Glob / Grep / LS / git log / git diff / git status` → 直接放行
  - 规则格式：`{ pattern: string, mode: "block" | "allow", desc: string }`
- `interceptor.ts`：
  - hook 进 Claude Code 的 tool_use 事件
  - 命中黑名单：生成 `danger_id`（UUID），发 `danger.pending` 给 App
  - 等待 App 回 `danger.allow` 或 `danger.deny`（60 秒超时自动 deny）
  - 超时 deny：向 Claude Code stdin 发工具结果（`"操作被用户拒绝"`）
  - 收到 allow：放行该次 tool_use，继续执行
- `fence.ts`：工作区路径围栏
  - daemon 启动时声明 `allowed_paths[]`（来自 config）
  - 任何文件操作（Read/Write/Edit/Bash cd）检测路径是否在白名单内
  - 越界路径直接拒绝，不转发给 Claude Code
- 当前实现说明：
  - 已新增 `guard/rules.ts`，内置只读工具放行、危险 Bash 默认拦截和 `danger-rules.json` 自定义规则加载
  - 已新增 `guard/interceptor.ts`，维护 `danger_id` 待确认队列、超时自动 deny、session 结束自动清理
  - 已把 `danger.allow` / `danger.deny` 接入 `transport/message-router.ts` 与 `sessions/manager.ts`
  - 当前 daemon 会在 `tool.use` 事件层暂停向 App 继续透传，等待审批结果；若被拒绝，则向 App 注入合成的 `tool.result` 错误事件，并丢弃对应真实结果

### 2.3 审计日志（`packages/daemon/src/audit/`）
状态：`[~]` 已完成本地加密 JSONL、按天轮转、30 天清理与会话/危险操作审计接线；`file.changed`、多 Agent 维度和历史读取接口仍待后续补齐。

- append-only 日志文件：`~/.hellobug/audit/<date>.jsonl`
- 每条记录：`{ts, session_id, device_id, event_type, summary}`
  - tool_use：记录工具名 + 参数 hash（不记原始参数，防止密码/密钥落日志）
  - file_changed：记录文件路径 + diff hash
  - danger_pending / allow / deny：完整记录
- 日志按天轮转，保留 30 天
- 日志文件加密（用 daemon 设备密钥的衍生密钥，XChaCha20-Poly1305）
- 提供 `appendAuditEntry(entry)` 和 `readAuditLog(date)` 接口
- 当前实现说明：
  - 已新增 `audit/logger.ts`，使用 daemon 设备密钥派生对称密钥，对每条 JSONL 记录单独加密
  - 已把 `session.start`、`session.input*`、`session.cancel`、`tool.use`、`tool.result`、`session.done`、`danger.pending / allow / deny` 接入审计
  - 当前实现已避免把原始文本输入和工具原始参数直接落盘，优先记录 hash 或摘要

### 2.4 服务器：环形缓冲与重放（`packages/server/src/relay/buffer.ts`）

- 状态：`[x]` 已完成首版服务端重放闭环（当前范围：`session.event`）
- App 重连时携带 `last_seq`
- 服务器批量推送 `[last_seq+1, current_seq]` 的 `session.event`
- 批量推送完成后发 `replay.done`（含当前 seq）
- 缓冲满（>500 条）时丢弃最旧的，不阻塞新消息
- 后续待补：
  - 是否把 `danger.pending` / 其他带 `session_id` 的消息纳入重放
  - 与未来真实 E2EE envelope / 签名校验的结合

---

## M3：文件系统（约 5-7 天，状态：[ ] 未开始）

### 3.1 文件变更监听（`packages/daemon/src/fs/watcher.ts`）

- 用 `chokidar` 监听工作区目录变化
- 仅监听 Claude Code 子进程正在操作的工作区（避免全局文件系统监听）
- 检测到文件变化后：
  - 用 `diff` 工具（`unified-diff` npm 包）生成 unified diff string
  - 构造 `file.changed` 事件：`{file_path, diff, ts}`
  - 推送到对应 session 的 App 端

### 3.2 文件树（`packages/daemon/src/fs/tree.ts`）

- 收到 `fs.tree.req`：扫描指定目录（`dir_path`，默认工作区根）
- 返回一级目录内容（不递归，懒加载）
- 标注已修改文件（对比 git status 的 modified 列表）
- 过滤 `.git/`、`node_modules/`、`__pycache__/`、`.DS_Store` 等
- 每次请求从磁盘重新读（不缓存），保证实时性
- 响应格式：`FsTree { entries: [{name, path, type, modified}] }`

### 3.3 文件读取（`packages/daemon/src/fs/reader.ts`）

- 收到 `fs.file.req`：读取指定文件内容
- 分片策略：单片最大 200KB（base64 后约 267KB）
  - 文件 ≤200KB：单片返回，`chunk_index=0, total_chunks=1`
  - 文件 >200KB：按 200KB 切片，每片单独响应
  - App 端请求时可指定 `chunk_index` 获取特定片
- 路径安全检查：必须在 `fence.ts` 白名单内
- MIME 类型检测（简单扩展名映射，`.ts` → `text/typescript` 等）

---

## M4：多并发 + Codex + 推送（约 7-10 天，状态：[ ] 未开始）

### 4.1 多会话并发（`packages/daemon/src/sessions/`）

- `manager.ts`：会话注册表（`Map<session_id, SessionHandle>`）
- 每个 SessionHandle 包含：`agent_type`, `child_process`, `workspace`, `seq`, `created_at`
- 同一 daemon 最多支持 10 个并发会话（可配置）
- 超出限制时返回错误，不静默丢弃
- 会话结束时（`session.done`）从注册表移除，回收子进程

### 4.2 Codex 适配器（`packages/daemon/src/agents/codex.ts`）

根据 Spike 3 结果二选一：

**方案 A（JSON 模式，Spike 3 确认稳定后用）**：
- `codex exec --json ...` 子进程
- 解析 JSON 输出，映射到 protocol 事件类型

**方案 B（PTY 兜底）**：
- `node-pty` 开 PTY 运行 `codex`
- 原始字节流封装为 `pty.data` 事件
- App 端用 xterm.dart 渲染（等同终端会话）

### 4.3 Shell PTY 适配器（`packages/daemon/src/agents/shell.ts`）

- `node-pty` 创建 PTY（shell = `$SHELL` 或 `/bin/bash`）
- 工作目录 = 选定的工作区路径
- 收到 `session.input`：写入 PTY stdin（`pty.write(text)`）
- PTY 输出：监听 `data` 事件，封装为 `pty.data { bytes: base64 }` 推给 App
- PTY resize：收到 `pty.resize { cols, rows }` 时调用 `pty.resize(cols, rows)`
- 会话结束：监听 `exit` 事件，发 `session.done`

### 4.4 图片分片上传（`packages/daemon/src/fs/image.ts`）
状态：`[~]` 已完成 daemon 侧分片组装、临时文件落盘、Claude runtime 路径注入与 session 结束清理；App 端联调与更完整图片生命周期仍待补全。

- 收到 `session.input.image`（分片）：
  - 按 `chunk_index` 组装到内存缓冲
  - 所有片到齐后写临时文件（`/tmp/hellobug/<session_id>/<image_id>.jpg`）
- 将临时文件路径注入 Claude Code stdin（Claude Code 支持图片路径输入）
- 会话结束后清理临时文件

### 4.5 历史 Transcript 读取（`packages/daemon/src/history/`）

- `finder.ts`：扫描 Claude Code 的 transcript 目录（`~/.claude/projects/<hash>/`）
  - 路径探测：先尝试默认路径，找不到打日志告警（见 Spike 说明）
  - 列出所有 `.jsonl` 文件，按 mtime 倒序
- `reader.ts`：读取指定 transcript JSONL 文件
  - 支持分页（`offset` + `limit`，默认最近 100 条）
  - 返回原始 JSONL 行（App 端负责渲染）
- 响应：`history.list`（文件列表 + 元数据），`history.get`（分页内容）

### 4.6 服务器：APNS 推送（`packages/server/src/push/apns.ts`）

触发时机（daemon 发 `push.trigger` 给服务器）：
- `session.done`（任务完成）
- `danger.pending`（需要确认危险操作）
- `session.error`（agent 出错）

实现：
- Apple APNS HTTP/2 API（token-based auth，`.p8` 私钥）
- 每个 App 设备注册 APNS token，服务器维护 `device_id → apns_token` 映射
- 推送内容：**只含** `session_id` + `event_type`（不含任何代码或用户输入）
  ```json
  { "aps": { "alert": { "title": "HelloBug", "body": "任务已完成" }, "sound": "default" },
    "session_id": "xxx", "event_type": "task_done" }
  ```
- 失败处理：410 Gone → 清除 token；5xx → 重试 3 次（指数退避）

### 4.7 服务器：Android 厂商推送（`packages/server/src/push/android.ts`）

根据 Spike 预研结果，实现对应厂商 HTTP API：
- 小米推送（Mi Push）：`https://api.xmpush.xiaomi.com/v3/message/regid`
- OPPO Push：`https://api.push.oppomobile.com/server/v1/message/notification/unicast`
- vivo Push：`https://api-push.vivo.com.cn/message/send`

封装统一接口：`sendAndroidPush(device_id, payload)`，内部按 `manufacturer` 字段路由到对应实现。

服务器收到 App 注册时，App 上报 `manufacturer`（Xiaomi/OPPO/vivo/Other）和对应的推送 token。

### 4.8 部署配置（`deploy/`）

`deploy/Caddyfile`：
```
relay.yourdomain.com {
  reverse_proxy localhost:3000
  tls {
    protocols tls1.3
  }
}
```

`deploy/hellobug-server.service`（systemd）：
```ini
[Unit]
Description=HelloBug Relay Server
After=network.target

[Service]
User=hellobug
ExecStart=/usr/bin/node /opt/hellobug/server/dist/index.js
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
PrivateTmp=yes
MemoryDenyWriteExecute=yes
ReadWritePaths=/opt/hellobug/data

[Install]
WantedBy=multi-user.target
```

`deploy/hellobug-daemon.service`（macOS launchd plist 或 Linux systemd，二选一）。

`deploy/docker-compose.yml`：可选，用于开发环境快速启动服务器。

---

## M5：多 Agent 群组会话（约 5-7 天，状态：[ ] 未开始）

### 5.1 会话数据模型扩展（`packages/daemon/src/sessions/manager.ts`）

- 当前 SessionHandle 从单 `AgentProcess` 扩展为 `Map<agent_id, AgentHandle>`
  ```typescript
  interface SessionHandle {
    session_id: string;
    workspace_path: string;
    primary_agent_id: string;
    agents: Map<agent_id, AgentHandle>;
    writeLock: Mutex;
    created_at: number;
  }
  ```
- `AgentHandle` 至少包含 `{ agent_id, agent_type, child_process, status }`
- 每个 agent 独立子进程、独立 transcript / audit 归属，共享工作区
- M1-M4 兼容：单 agent 时 `agents` Map 只含一个条目，旧逻辑无需理解群组语义

### 5.2 消息路由逻辑（`packages/daemon/src/routing/`）

- `router.ts`：解析 `session.input` 的 `routing_mode` + `target_agent_id`
  - `direct`：`target_agent_id` 必须非空，只写入对应子进程 stdin
  - `broadcast`：显式广播给会话内所有 agent，`target_agent_id` 被忽略
  - `orchestrated`：投递给 `primary_agent_id`；`target_agent_id = null` 时默认此模式
  - M1-M4 单 agent 场景省略 `routing_mode` 时，按 direct 投递给唯一 agent
- `mention_parser.ts`：可选，提供 @mention 解析逻辑（从文本中提取 `@agent-name`，映射到 `agent_id`）
- 路由日志：记录每条消息路由决策（`routing_mode`、`target_agent_id`、实际投递的 agent 列表）

### 5.3 事件归属标识（`packages/daemon/src/events/`）

- 所有 `session.event` 消息统一添加外层 `agent_id` / `agent_type`
  - M1-M4 单 agent 时可省略或传 `null`
  - M5 多 agent 时必须填实际 agent UUID 与类型
- `danger.pending` 同步补齐 `agent_id` / `agent_type`
- assistant.delta / assistant.thinking / tool.use / tool.result / file.changed / session.done 等事件统一复用外层来源字段
- 事件构造时自动从 AgentHandle 上下文注入来源信息，避免业务代码手填

### 5.4 并发写保护（`packages/daemon/src/fs/write-queue.ts`）

- 会话级 `writeLock: Mutex`（初始化 SessionHandle 时创建）
- agent 执行文件写操作前流程：
  1. 检测到 tool_use 为 Write/Edit（或其他文件修改工具）
  2. 获取 `sessionHandle.writeLock.acquire()`
  3. 转发 tool_use 到 agent 子进程（执行实际文件写）
  4. 监听 tool_result（写操作完成）
  5. 释放 `sessionHandle.writeLock.release()`
- 其他 agent 写请求在步骤 2 阻塞，排队等待
- 超时保护：单次写操作持有锁最长 60 秒（防止死锁），超时强制释放并记录异常

### 5.5 审计日志按 agent 区分（`packages/daemon/src/audit/`）

- 扩展审计日志条目格式：`{ts, session_id, agent_id, device_id, event_type, summary}`
- 每个 agent 的操作单独记录（`agent_id` 字段区分）
- 日志文件仍按天轮转（`<date>.jsonl`），不按 agent 分文件
- 查询接口：`readAuditLog(date, filters?: {session_id?, agent_id?})`
- transcript / replay 内部索引支持按 `(session_id, agent_id)` 聚合，但对 App 暴露的回放协议仍保持 `session.resume { session_id, last_seq }`

### 5.6 Agent 生命周期管理（`packages/daemon/src/sessions/lifecycle.ts`）

- `session.start` 继续保持单 agent 语义，不扩展 `agents[]`
- 新增 `session.agent.add { session_id, agent_id, agent_type }`
  - daemon 启动新子进程并注册到 `SessionHandle.agents`
  - 首个 agent 作为 `primary_agent_id`；后续新增 agent 不改变主 agent，除非明确实现迁移逻辑
- `session.agent.remove` 不属于当前 M5 必做范围，如要加只能作为后续增强项
- Agent 崩溃处理：监听子进程 exit，崩溃时发 `session.event { event_type: agent.crashed, agent_id }`

### 5.7 测试要求（M5 专项）

| 测试场景 | 验证点 |
|---|---|
| 单会话多 agent | 同时启动 agent-A 和 agent-B，两者子进程独立运行 |
| 动态加 agent | `session.start` 启动主 agent 后，`session.agent.add` 能成功追加 agent-B |
| @mention 精确路由 | `target_agent_id: "agent-A"` 的消息只有 A 收到，B 不收到 |
| 默认编排路由 | `target_agent_id: null` 且未显式 broadcast 时，只有主 agent 收到 |
| 显式广播路由 | `routing_mode: "broadcast"` 的消息 A 和 B 都收到 |
| 并发写保护 | A 和 B 同时尝试写同一文件，后者等待前者完成，文件内容无损坏 |
| 事件归属 | session.event / danger.pending 正确携带 `agent_id` / `agent_type` |
| Agent 独立审计 | A 和 B 的操作在审计日志中可按 agent_id 区分 |

---

## 接口约定（与 Flutter 的边界）

Flutter App **只通过 WebSocket 与云服务器通信**，所有消息格式见 `docs/protocol.md`。

以下是 Codex 必须保证的合约：

1. 连接建立后，服务器发送 `server.hello`（含 `protocol_version`），Flutter 据此判断兼容性。
2. 所有 `session.event` 的 `seq` 严格递增（单 session 内）。
3. `file.changed` 事件必须包含 `diff`（unified diff string）和 `file_path`。
4. `fs.file` 响应超过 200KB 时必须分片，每片附 `chunk_index` 和 `total_chunks`。
5. `danger.pending` 后等待 `danger.allow` / `danger.deny`，**60 秒超时自动 deny**。
6. 推送通知内容不含任何代码、文件内容、或用户输入。
7. `device.status` 在设备连接/断开时立即发送，不缓存延迟。

---

## 测试要求

### 当前测试完成情况

- `[x]` `packages/protocol` 已有 schema 基础测试
- `[x]` `packages/server` 已有基础接口测试与 WebSocket 配对 / 鉴权 / relay 集成测试
- `[x]` `packages/daemon` 已有配置、配对码、SAS 响应路由、图片分片、危险审批、加密审计日志测试
- `[x]` 当前 `packages/protocol`、`packages/server`、`packages/daemon` 的单包 `build` / `test` / `lint` 可通过；workspace 根脚本待在具备 `pnpm` 的环境复跑
- `[ ]` 尚无真实 E2EE 跨端向量测试
- `[~]` 已有 Claude stream-json fixture 测试；仍缺真实录制事件流的长会话回放
- `[ ]` 尚无多 Agent 群组专项测试

每个模块需要对应测试文件（`*.test.ts`，使用 Vitest）：

| 模块 | 测试重点 |
|---|---|
| `protocol/` | 每种消息类型的 Zod 验证通过/失败 |
| `daemon/crypto/` | E2EE 加解密向量（与 Flutter 端对齐） |
| `daemon/pairing/` | 配对码过期、限流、SAS 生成 |
| `daemon/transport/` | 重连退避、心跳超时、签名验证 |
| `daemon/guard/` | 黑名单命中、白名单放行、路径越界 |
| `daemon/agents/claude` | stream-json 解析（用录制的 fixture） |
| `server/relay/` | 路由转发、环形缓冲、断线重放 |
| `server/auth/` | 配对流程、JWT 签发/验证、设备吊销 |
| `server/push/` | APNS token 失效处理、Android 厂商路由 |

集成测试：
- M1 完成后：E2EE echo round-trip（Node → Flutter 模拟端）
- M2 完成后：完整聊天闭环（用预录的 Claude Code 事件流回放）
- M4 完成后：多并发会话不串消息

---

## 依赖清单

```json
packages/daemon/package.json 关键依赖:
{
  "@hellobug/protocol": "workspace:*",
  "libsodium-wrappers": "^0.7",
  "ws": "^8",
  "zod": "^3"
}

packages/server/package.json 关键依赖:
{
  "fastify": "^5",
  "@fastify/websocket": "^11",
  "@hellobug/protocol": "workspace:*",
  "ws": "^8",
  "zod": "^3",
  "jose": "^5",
  "node-forge": "^1"
}
```

后续阶段按需补充：

- `packages/daemon`：`node-pty`、`chokidar`、`unified-diff`、`@anthropic-ai/claude-agent-sdk`
- `packages/server`：`apn`（进入推送阶段时补入）

所有依赖版本固定（`packages/pnpm-lock.yaml` 提交入库），`pnpm audit` 纳入 CI。
