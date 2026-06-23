# HelloBug 开发规划总览

> 当前最准确的“剩余工作总表”请优先看 `docs/app-remaining-work.md`。

> 手机远程操控本地 Claude Code / Codex Agent  
> 更新：2026-06-22

---

## 一、项目结构

```
HelloBug/
├── packages/
│   ├── package.json        # 后端 Node workspace 根
│   ├── pnpm-workspace.yaml
│   ├── tsconfig.base.json
│   ├── protocol/          # 共享 TypeScript 类型 + Zod schema
│   ├── daemon/            # 本地常驻进程（Node.js + TypeScript）
│   └── server/            # 云中继服务器（Node.js + TypeScript）
├── app/                   # Flutter 客户端（iOS + Android）
└── docs/
    ├── dev-plan.md        # 本文件：总览与分工
    ├── codex-tasks.md     # Codex 负责的后端任务
    ├── flutter-tasks.md   # Claude 负责的 Flutter 任务
    ├── protocol.md        # 消息协议与格式规范
    └── wireframes/        # 界面线框图（HTML 静态原型）
```

补充说明：后端 `pnpm` workspace 根位于 `packages/`，这样仓库外层只保留 `app / docs / packages` 三个主目录，Flutter 与 Node 生态互不混杂。

---

## 二、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| Flutter App | Flutter 3.27+ / Dart 3.7+ | iOS 17+ / Android 12+ |
| UI 风格 | Cupertino 统一双端 | 深色默认，跟随系统切换 |
| 终端渲染 | xterm.dart | PTY 字节流渲染 |
| 语音输入 | speech_to_text | 本地 STT，不上传音频 |
| 图片处理 | image_picker + flutter_image_compress | 压缩至 ≤2MB |
| E2EE (Flutter) | cryptography (Dart) | Noise IK + ChaCha20-Poly1305 |
| 推送 (iOS) | flutter_apns_only | APNS 直连 |
| 推送 (Android) | 厂商 SDK platform channel | 小米/OPPO/vivo |
| Daemon | Node.js 22 + TypeScript | 本地常驻，反向连云 |
| Agent 接入 | claude-agent-sdk + codex CLI | stream-json 事件流 |
| Server | Fastify 5 + ws 8 | WebSocket 中继 |
| 加密 (Node) | libsodium-wrappers | Noise IK + Ed25519 |
| 数据库 | 无持久化 | 仅内存环形缓冲（TTL 24h） |
| 部署 | Caddy + systemd | TLS 1.3 + Let's Encrypt |

---

## 三、分工总表

### Codex 负责（后端 + 基础设施）

| 模块 | 文件位置 | 说明 |
|---|---|---|
| 共享协议 schema | `packages/protocol/` | Zod 类型定义，双端共用 |
| Daemon 主进程 | `packages/daemon/src/` | 连云、心跳、重连 |
| Daemon 安全层 | `packages/daemon/src/crypto/` | Ed25519 密钥生成、Noise IK 握手、消息签名 |
| Claude Code 适配器 | `packages/daemon/src/agents/claude.ts` | 子进程 + stream-json 解析 |
| Codex 适配器 | `packages/daemon/src/agents/codex.ts` | codex exec / PTY 兜底 |
| Shell PTY 适配器 | `packages/daemon/src/agents/shell.ts` | node-pty 全双工 |
| 文件系统模块 | `packages/daemon/src/fs/` | 工作区扫描、diff 监听、文件读取 |
| 传输层 | `packages/daemon/src/transport/` | 反向 WebSocket、envelope 签名、重连 |
| 云服务器主进程 | `packages/server/src/` | Fastify + ws，mTLS，设备认证 |
| 服务器中继逻辑 | `packages/server/src/relay/` | envelope 路由、环形缓冲、seq 重放 |
| 服务器认证 | `packages/server/src/auth/` | 配对码、设备公钥注册、JWT、吊销 |
| APNS 推送服务 | `packages/server/src/push/apns.ts` | token 鉴权 + 推送触发 |
| Android 推送服务 | `packages/server/src/push/android.ts` | 厂商 HTTP API 封装 |
| 审计日志 | `packages/daemon/src/audit/` | append-only 加密本地日志 |
| 危险操作拦截 | `packages/daemon/src/guard/` | 黑白名单匹配、工作区围栏 |
| 部署配置 | `deploy/` | Caddyfile、systemd unit、docker-compose |

### Claude 负责（Flutter 全部前端）

| 模块 | 文件位置 | 说明 |
|---|---|---|
| 项目初始化 | `app/` | Flutter 工程骨架、pubspec、设计 token |
| 主题系统 | `app/lib/theme/` | 深浅双主题、Cupertino token、动态切换 |
| 网络层 | `app/lib/transport/` | WebSocket 客户端、E2EE 包装、断线重连 |
| E2EE 客户端 | `app/lib/crypto/` | Noise IK、Ed25519、Keychain 存储 |
| 状态管理 | `app/lib/state/` | Riverpod providers（会话、设备、设置） |
| 引导页 | `app/lib/screens/onboarding/` | 三屏特性介绍 |
| 配对页 | `app/lib/screens/pairing/` | 扫码 + 手动 + SAS 核对 |
| 锁屏页 | `app/lib/screens/unlock/` | 启动时 Face ID / 指纹 |
| 设备列表 | `app/lib/screens/devices/` | 在线状态、配对管理 |
| 会话列表 | `app/lib/screens/sessions/` | 多项目并发，未读标记 |
| 聊天主页 | `app/lib/screens/chat/` | 流式渲染、tool_use、diff 卡片、输入栏 |
| Diff 全屏 | `app/lib/screens/diff/` | 统一/分栏、语法高亮、行号 |
| 文件树 | `app/lib/screens/filetree/` | 目录树 + 只读预览 |
| 终端页 | `app/lib/screens/terminal/` | xterm.dart + 虚拟键盘工具栏 |
| 新建会话向导 | `app/lib/screens/new_session/` | 三步向导 |
| 图片输入 | `app/lib/screens/image_input/` | 预览、压缩、发送 |
| 语音输入 | `app/lib/screens/voice_input/` | 波形、STT、转写 |
| 斜杠命令面板 | `app/lib/widgets/slash_palette/` | 浮动面板 |
| 危险操作确认 | `app/lib/widgets/danger_confirm/` | Bottom sheet + Face ID |
| 工作区切换 | `app/lib/widgets/workspace_switch/` | Bottom sheet |
| 设置主页 | `app/lib/screens/settings/` | 入口列表 |
| 安全与隐私设置 | `app/lib/screens/settings/security.dart` | 密钥、SAS 记录 |
| 外观设置 | `app/lib/screens/settings/appearance.dart` | 主题、字号、diff 视图 |
| 通知设置 | `app/lib/screens/settings/notifications.dart` | 推送开关、DND |
| 危险规则设置 | `app/lib/screens/settings/danger_rules.dart` | 黑白名单 CRUD |
| 模板设置 | `app/lib/screens/settings/templates.dart` | 快捷模板 CRUD |
| 设备详情 | `app/lib/screens/settings/device_detail.dart` | 系统信息、吊销 |
| 关于页 | `app/lib/screens/settings/about.dart` | 版本、开源 |

---

## 四、Milestone 计划

### M1：安全骨架（约 5-7 天）
**目标：** 两端能建立 E2EE 加密连接，配对流程跑通，在线/离线状态正确显示。

Codex 任务：
- 搭后端 workspace 骨架（pnpm workspace 根位于 `packages/`）
- `packages/protocol`：基础 envelope 类型 + Zod schema
- `packages/daemon`：连云、心跳、Ed25519 密钥生成、Noise IK 握手
- `packages/server`：WebSocket 端点、mTLS、配对码生成/验证、设备公钥注册
- 配对码限流（5次/分钟/IP）、30 秒过期

Claude 任务：
- Flutter 工程初始化，pubspec，设计 token（颜色/字号/圆角）
- 主题系统（深浅切换，Cupertino 风格）
- 网络层骨架：WebSocket 客户端、心跳、断线重连
- E2EE 客户端：Noise IK 握手、Keychain/Keystore 密钥存储
- 引导页（三屏）
- 配对页（扫码 + 手动输入）
- SAS 核对页
- 启动锁屏页（Face ID/指纹）
- 设备列表页（在线/离线状态展示）

**M1 验收：**
- 拔网线 30 秒内 App 显示"离线"，恢复后自动重连
- 抓包可见 envelope 路由头但 payload 为密文
- 吊销设备后立即断连

---

### M2：聊天闭环（约 5-7 天）
**目标：** 手机能向 Claude Code 发指令并看到流式回复、tool_use 摘要。

Codex 任务：
- Claude Code 适配器（stream-json 子进程 + 事件解析）
- Shell PTY 适配器（node-pty）
- 危险操作拦截（黑白名单匹配、工作区围栏）
- 服务器环形缓冲（500 条密文，TTL 24h）
- 断线重放（`last_seq` 机制）
- 审计日志（append-only）

Claude 任务：
- 会话列表页
- 新建会话向导（三步）
- 聊天主页核心：
  - 消息泡渲染（用户/assistant/tool_use 折叠卡/thinking 折叠）
  - 流式文本渲染（逐 token 追加）
  - 输入栏（文本 + 发送）
  - 模板芯片横滑栏
  - 取消/清屏操作
- 危险操作确认 bottom sheet（命令展示 + Face ID 按钮）
- 工作区切换 bottom sheet
- 危险规则设置页（黑白名单 CRUD）

**M2 验收：**
- 手机发"列出当前目录"，能看到 Bash 工具调用 + 输出
- 锁屏过 1 分钟回来，agent 跑完历史回放完整
- 危险命令触发 Face ID 确认弹窗

---

### M3：Diff + 文件树（约 5-7 天）
**目标：** 能在手机上看代码 diff 和工作区文件。

Codex 任务：
- `file.changed` 事件推送（监听 agent 修改文件，附 diff 内容）
- 文件树接口（`fs.tree.req` / `fs.file.req`，按目录懒加载）
- 工作区切换时历史会话保留后台

Claude 任务：
- Diff 全屏页（统一/分栏切换、语法高亮、行号、hunk 跳转）
- 聊天内 diff 内联卡片（缩略 + 点击跳转全屏）
- 文件树页（目录懒加载、修改文件橙标）
- 单文件只读预览（代码高亮、虚拟滚动大文件）
- 工作区切换 bottom sheet 完整实现

**M3 验收：**
- agent 改 5 个文件，手机端 diff 列表全显示
- 浏览 >1MB 文件不卡，懒加载分块
- 统一/分栏模式均可横向滚动

---

### M4：多并发 + 输入增强 + 推送（约 7-10 天）
**目标：** 多项目并发、Codex 接入、图片/语音输入、终端、推送通知。

Codex 任务：
- Codex CLI 适配器（exec JSON 或 PTY 兜底）
- 多会话并发（同一 daemon 跑多个 agent 子进程，消息不串台）
- APNS 推送服务（token 鉴权、触发时机：任务完成/需确认/出错）
- Android 厂商推送（小米/OPPO/vivo HTTP API 封装）
- 图片分片上传接口（daemon 接收后落临时文件，传给 Claude Code）
- 历史 transcript 读取接口（`history.list` / `history.get`）

Claude 任务：
- 终端页（xterm.dart PTY 渲染 + 虚拟键盘工具栏：Esc/Tab/方向键/Ctrl/Alt）
- 图片输入页（相机/相册、压缩预览、裁剪旋转、E2EE 发送）
- 语音输入页（本地 STT、波形动画、实时转写、置信度）
- 斜杠命令浮动面板（`/` 触发、动态列表、快捷键）
- 通知设置页（推送开关、DND 时段）
- 模板设置页（CRUD + 变量占位符）
- 外观设置页（主题/字号/diff 视图）
- 关于页
- 多 tab 并发会话 UI（底部切换、后台保留）
- 横屏双栏布局（聊天 + 文件树）

**M4 验收：**
- 同时跑 ProjectA-Claude + ProjectB-Codex，消息不串
- 终端能跑 `top`、`vim`，控制序列正常
- 手机锁屏收到推送，点击直达对应会话
- 图片/语音输入完整链路跑通

---

### M5：多 Agent 群组会话（约 5-7 天）
**目标：** 单个会话内同时运行多个 agent，支持 @mention 路由，共享工作区。

Codex 任务：
- 会话数据模型扩展：`SessionHandle` 从单 `AgentProcess` 变为 `Map<agent_id, AgentHandle>`，并维护主 agent / orchestrator
- 协议扩展：保持 `session.start` 单 agent 语义，新增 `session.agent.add`
- 消息路由逻辑：实现 `routing_mode = direct | broadcast | orchestrated`
- 事件归属：所有 `session.event` 与 `danger.pending` 携带 `agent_id` / `agent_type`
- 并发写保护：会话级 `writeLock: Mutex`，agent 写文件前获取锁，完成后释放
- 审计日志：按 agent 区分，每个 agent 的操作单独记录，历史与 replay 内部索引可按 `(session_id, agent_id)` 聚合

Claude 任务：
- 群组会话 UI：聊天页头部展示所有 agent（头像 + 名称），点击切换焦点
- @mention 输入：输入框支持 `@` 触发 agent 选择器，选中后填充 `target_agent_id`
- 消息归属展示：每条 assistant 消息和 diff 卡片显示来源 agent（头像/标签）
- 多 agent 并发状态：同一会话内多个 agent 同时执行时，各自显示独立加载状态
- 新建会话向导：第三步新增"是否启用多 agent 模式"开关

**M5 验收：**
- 单个会话内同时跑 agent-A 和 agent-B，`routing_mode: "direct"` 且 `target_agent_id = "agent-A"` 的消息只有 A 收到
- 默认消息（`target_agent_id: null`，`routing_mode` 省略或为 `orchestrated`）先进入主 agent，由主 agent 决定下游编排
- 显式广播消息（`routing_mode: "broadcast"`）两个 agent 都收到
- A 修改 `login.ts`，B 修改 `register.ts`，diff 卡片正确显示各自 agent 标识
- 并发写同一文件时不出现内容损坏（写队列生效）

---

## 五、接口约定（Codex ↔ Claude 边界）

### Flutter 调用 Daemon 的方式
Flutter App **只通过 WebSocket 与云服务器通信**，所有消息格式见 `docs/protocol.md`。  
Flutter 不直连 Daemon，不调用任何本地 API。

### Codex 需要为 Flutter 提供的保证

1. **连接建立后**，服务器发送 `server.hello`，包含协议版本，Flutter 据此判断兼容性。
2. **所有事件必须按 `seq` 严格递增**，Flutter 用 `last_seq` 请求重放缺失消息。
3. **`session.event` 里的事件类型**必须与 `packages/protocol` 里的 Zod schema 完全一致，Flutter 侧按此解析。
4. **`file.changed` 事件**必须包含 `diff` 字段（unified diff 格式字符串）和 `file_path`。
5. **`fs.file` 响应**超过 200KB 时必须分片，每片附 `chunk_index` 和 `total_chunks`。
6. **危险操作**在 daemon 侧拦截后，向 App 发送 `danger.pending` 事件，等待 App 回复 `danger.allow` 或 `danger.deny`，超时 60 秒自动 deny。
7. **推送通知内容**只含 `session_id` + `event_type`（如 `"task_done"`），不含代码或用户输入。

### Flutter 调用的 WebSocket 消息（完整列表见 protocol.md）

```
App → Server:
  auth.attach / auth.refresh
  device.pair / device.pair.confirm / device.push_token
  session.start / session.agent.add / session.resume
  session.input / session.cancel
  session.input.image / session.input.voice_text
  session.command.slash
  danger.allow / danger.deny
  fs.tree.req / fs.file.req
  history.list / history.get
  templates.list
  slash.list
  pty.resize

Server → App:
  server.hello
  auth.token
  device.pair.sas
  device.status (在线/离线变化)
  session.event (assistant.delta / tool.use / tool.result /
                 file.changed / session.done / session.usage)
  danger.pending
  fs.tree / fs.file (含分片)
  history.list / history.get
  replay.done
  error
```

---

## 六、不做的边界

- 不做手机端直接编辑并保存文件
- 不做多人协作（多用户同时编辑同一工作区），但**支持单用户多 agent 群组会话**（M5，同一会话内多个 agent 共享工作区）
- 不做云端持久化业务内容（以本地 transcript 为真源）
- 不做 App Store 上架（TestFlight / 自签 APK 分发）
- 不做屏幕共享或远程桌面（只转发 agent 的文字 I/O）
- 不做手机端运行 AI 推理

---

## 七、开发顺序建议

```
Codex 先行：
  M1: monorepo 骨架 → protocol schema → daemon/server E2EE 骨架

Claude 并行：
  M1: Flutter 工程 → 主题 → 网络层骨架 → 配对 UI

两侧对齐（M1 完成后联调）：
  跑通配对 → E2EE echo 测试 → 在线状态展示

后续 M2-M4 同理：Codex 先暴露接口 → Claude 对接 UI
M5 在 M4 的推送、历史、审计链路稳定后进入开发
```

参考文档：
- `docs/codex-tasks.md` — Codex 完整任务清单（可直接发给 Codex）
- `docs/flutter-tasks.md` — Flutter 完整任务清单
- `docs/protocol.md` — 消息格式规范
- `docs/wireframes/index.html` — 所有界面原型
