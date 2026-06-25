# HelloBug 消息协议规范

> 本文档定义 App ↔ 云服务器 ↔ Daemon 之间的完整消息格式。  
> 更新：2026-06-22

---

## 一、三层结构

每条 WebSocket 帧由三层嵌套组成：

```
WebSocket Frame (binary / text)
└── Envelope (JSON, 明文)          ← 服务器可见，用于路由
    ├── routing fields
    ├── sig  (Ed25519, base64url)   ← 对 envelope 字段的签名
    └── ciphertext (base64url)      ← 端到端加密的 payload，服务器不可见
        └── InnerMessage (JSON)
            ├── v    (protocol version)
            ├── id   (message UUID)
            ├── type (消息类型字符串)
            └── payload (具体业务字段)
```

### 1.1 Envelope 字段

| 字段         | 类型         | 说明                                                                            |
| ------------ | ------------ | ------------------------------------------------------------------------------- |
| `from`       | string       | 发送方 `device_id`（UUID）                                                      |
| `to`         | string       | 接收方 `device_id`（UUID），服务器内部路由用                                    |
| `session_id` | string       | 会话 UUID（无关联会话时传空字符串）                                             |
| `seq`        | number (u64) | 单 session 内严格递增，从 1 开始；无会话上下文的消息（如 auth）使用全局递增序列 |
| `ts`         | number       | Unix 毫秒时间戳                                                                 |
| `sig`        | string       | 对 `from+to+session_id+seq+ts` 拼接后的 Ed25519 签名（base64url），防篡改与重放 |
| `ciphertext` | string       | base64url 编码的 AEAD 密文（InnerMessage 加密后）                               |

> 服务器拒绝条件：sig 无效 / seq 重复或回退 / ts 偏差超过 ±5 分钟。

### 1.2 InnerMessage 字段

| 字段      | 类型   | 说明                         |
| --------- | ------ | ---------------------------- |
| `v`       | number | 协议版本，当前为 `1`         |
| `id`      | string | 消息 UUID（用于去重与 ACK）  |
| `type`    | string | 消息类型，见下文             |
| `payload` | object | 具体业务字段，由 `type` 决定 |

---

## 二、E2EE 握手（Noise IK）

配对后的每条业务消息均走 Noise IK pattern 派生的会话密钥加密。

### 2.1 握手阶段

```
Initiator (App)                    Responder (Daemon)
─────────────────────────────────────────────────────
gen ephemeral key pair (e)
→  e, ES(e, rs)                   # 用 responder 静态公钥加密 ephemeral
                                   decrypt(e, ES)
                                   gen ephemeral key pair (e')
                       ←  e', SE(e', is), EE(e', e)
verify SE(e', is)
derive session keys
                                   derive session keys
```

- **静态密钥**：Ed25519（签名用）+ Curve25519（Noise 用），配对时交换公钥
- **会话密钥**：ChaCha20-Poly1305，sending_key / receiving_key 各一
- **密钥轮换**：每 100 条消息**或** 10 分钟（双条件取先到者）触发一次 ratchet（`type: key.ratchet`），发起方发送 `key.ratchet`，接收方立即切换密钥并回复 `key.ratchet_ack`；ratchet 后消息计数器和时间计时器同时重置，旧密钥立即销毁
- **nonce**：12 字节（96 bit），格式 `session_id_hash[0..3] || msg_counter[0..7]`，前 4 字节为 session_id 的 SHA-256 前 4 字节，后 8 字节为 uint64 big-endian 消息计数器（从 0 开始）；ratchet 后计数器重置为 0；uint64 耗尽（2^64 条消息）视为严重错误，立即终止会话并提示重新配对

### 2.2 `key.ratchet` 消息

```json
{
  "type": "key.ratchet",
  "payload": {
    "next_pubkey": "<base64url Curve25519 新临时公钥>"
  }
}
```

收到后接收方切换密钥，并立即回复 `key.ratchet_ack`，发起方收到 `ack` 后才销毁旧密钥。

```json
{
  "type": "key.ratchet_ack",
  "payload": {}
}
```

---

## 三、消息类型总表

### App → Server（转发给 Daemon）

| type                       | 说明                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `auth.attach`              | 重连时重新挂载连接（携带 JWT）                                       |
| `auth.refresh`             | JWT 续期请求                                                         |
| `device.pair`              | 首次配对请求                                                         |
| `device.pair.confirm`      | 用户确认 SAS 后发送                                                  |
| `device.push_token`        | 上报推送 token（配对完成后立即发送）                                 |
| `session.start`            | 启动新 agent 会话                                                    |
| `session.agent.add`        | 向既有会话动态添加一个 agent（M5）                                   |
| `session.resume`           | 断线重连后按会话粒度请求重放缺失消息                                 |
| `session.input`            | 发送文本指令（M5 支持 `direct` / `broadcast` / `orchestrated` 路由） |
| `session.input.image`      | 发送图片（分片）                                                     |
| `session.input.voice_text` | 发送语音转文字结果                                                   |
| `session.command.slash`    | 执行斜杠命令                                                         |
| `session.cancel`           | 中断当前 agent                                                       |
| `danger.allow`             | 允许危险操作                                                         |
| `danger.deny`              | 拒绝危险操作                                                         |
| `fs.tree.req`              | 请求文件树                                                           |
| `fs.file.req`              | 请求文件内容                                                         |
| `history.list`             | 列出本地 transcript                                                  |
| `history.get`              | 读取 transcript 分页                                                 |
| `templates.list`           | 拉取指令模板列表                                                     |
| `slash.list`               | 拉取斜杠命令列表                                                     |
| `pty.input`                | 向 PTY 写入原始输入字节（base64）                                    |
| `pty.resize`               | 调整 PTY 终端大小                                                    |

### Server / Daemon → App

| type              | 说明                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `server.hello`    | 连接建立后服务器第一条消息                                         |
| `auth.token`      | `auth.attach` / `auth.refresh` 的响应，返回新 JWT                  |
| `device.status`   | 设备在线状态变更                                                   |
| `device.pair.sas` | 配对 SAS 核对词（daemon 通过 server 中继返回）                     |
| `session.start.result` | `session.start` 的结构化成功/失败回执                          |
| `session.event`   | agent 事件流（见 §4），M5 起每个事件携带 `agent_id` / `agent_type` |
| `danger.pending`  | 等待用户确认危险操作                                               |
| `fs.tree`         | 文件树响应                                                         |
| `fs.file`         | 文件内容响应（支持分片）                                           |
| `history.list`    | transcript 列表响应                                                |
| `history.get`     | transcript 内容响应                                                |
| `replay.done`     | 断线重放完成标记                                                   |
| `key.ratchet`     | 密钥轮换通知（任意一侧均可发起）                                   |
| `key.ratchet_ack` | 密钥轮换确认（收到 key.ratchet 后立即回复）                        |

### Daemon → Server（不转发给 App）

| type                | 说明                                           |
| ------------------- | ---------------------------------------------- |
| `daemon.hello`      | mTLS 握手完成后 daemon 立即发送，上报自身信息  |
| `device.pair.ready` | daemon 就绪后上报配对槽信息，供 App 扫码后路由 |

### 通用（任意方向均可发）

| type    | 说明             |
| ------- | ---------------- |
| `error` | 消息处理失败响应 |

---

## 四、各消息 Payload 详细定义

### 4.1 server.hello

```json
{
  "type": "server.hello",
  "payload": {
    "protocol_version": 1,
    "server_id": "srv-uuid",
    "ts": 1718956800000,
    "min_client_version": 1
  }
}
```

App 收到后检查 `protocol_version`，若低于 `min_client_version` 则提示升级。

---

### 4.2 daemon.hello

mTLS 握手完成后 daemon 立即发送（方向：Daemon→Server，不加密，服务器可见）。

```json
{
  "type": "daemon.hello",
  "payload": {
    "device_id": "daemon-device-uuid",
    "daemon_version": "0.1.0",
    "supported_features": ["e2ee_noise_ik", "multi_session", "pty"]
  }
}
```

服务器验证 `device_id` 与 mTLS 证书匹配后将连接注册到设备路由表。

---

### 4.3 device.pair.ready

daemon 在 `daemon.hello` ACK 后发送，上报当前配对槽，服务器建立 `pairing_id → daemon_connection` 映射（默认 TTL 30 秒，可由 daemon 配置覆盖）。

```json
{
  "type": "device.pair.ready",
  "payload": {
    "pairing_id": "<32字节随机，hex>",
    "pairing_code": "428791",
    "expires_at": 1718957100000
  }
}
```

---

### 4.4 auth.attach

App 重连时发送（方向：App→Server），只做连接鉴权，不携带会话 seq。

```json
{
  "type": "auth.attach",
  "payload": {
    "jwt": "<JWT string>"
  }
}
```

Server 验证 JWT 后回复 `auth.token`（含新 JWT）。连接恢复后 App 按需逐会话发送 `session.resume`。

---

### 4.5 auth.refresh

JWT 即将过期时 App 主动续期（方向：App→Server），不依赖重连。

```json
{
  "type": "auth.refresh",
  "payload": {
    "jwt": "<未过期的旧 JWT>"
  }
}
```

响应（`type: auth.token`）：

```json
{
  "type": "auth.token",
  "payload": {
    "jwt": "<新 JWT，TTL 1 小时>",
    "expires_at": 1718960400000
  }
}
```

`auth.token` 只作 server→app 响应消息，不可由 App 主动发送。

---

### 4.6 device.pair

```json
{
  "type": "device.pair",
  "payload": {
    "pairing_code": "428791",
    "server_url": "wss://relay.example.com",
    "app_pubkey": "<base64url Curve25519 公钥>",
    "app_ed25519_pubkey": "<base64url Ed25519 公钥>",
    "app_device_name": "iPhone 16 Pro"
  }
}
```

服务器转发给对应 daemon，daemon 响应（`type: device.pair.sas`）：

```json
{
  "type": "device.pair.sas",
  "payload": {
    "sas": ["🐢", "🪐", "🍵", "🎷", "🌙"],
    "noise_handshake": "<base64url Noise IK message_1>",
    "daemon_pubkey": "<base64url Curve25519 公钥>",
    "daemon_ed25519_pubkey": "<base64url Ed25519 公钥>",
    "machine_name": "MacBook-Pro-M3",
    "os": "macOS 14.5"
  }
}
```

用户双端核对 SAS 后，App 发送：

```json
{
  "type": "device.pair.confirm",
  "payload": {
    "confirmed": true,
    "noise_handshake": "<base64url Noise IK message_2>"
  }
}
```

当前实现中，daemon 作为 `Noise IK` initiator，App 作为 responder。双方展示与核对的 `sas` 由握手中间态派生，因此 daemon 可以在收到 `message_2` 前先显示 SAS，App 也能基于同一握手阶段本地复算并校验。

`pairing_code` 仅作用户输入与展示校验。`server_url` 可选：扫码场景通常已由二维码提供，手动输入场景可随 `device.pair` 一并提交。Server 实际通过 `device.pair.ready` 预先登记的 `pairing_id` 槽位路由到对应 daemon：扫码流程可直接命中该 pairing slot，手动输入流程则先按 `pairing_code` 查回对应 `pairing_id`。

---

### 4.7 session.start

```json
{
  "type": "session.start",
  "payload": {
    "session_id": "sess-uuid",
    "agent_type": "claude_code",
    "workspace_path": "",
    "resume_session_id": null
  }
}
```

`agent_type` 枚举：`claude_code` / `codex` / `shell`  
`workspace_path`：可为空字符串；为空时表示“使用 daemon 默认工作区”  
`resume_session_id`：非空时 daemon 用 `claude --resume <id>` 续接历史会话。

### 4.7.1 session.start.result

daemon 在真正尝试启动 runtime 后返回 `session.start.result`。App 必须在收到 `status = "started"` 后，才把本地 session 加入列表并进入会话页。

成功示例：

```json
{
  "type": "session.start.result",
  "payload": {
    "request_id": "req-uuid",
    "session_id": "sess-uuid",
    "agent_type": "claude_code",
    "workspace_path": "/Users/me/projects/hello",
    "status": "started",
    "message": "Session started"
  }
}
```

失败示例：

```json
{
  "type": "session.start.result",
  "payload": {
    "request_id": "req-uuid",
    "session_id": "sess-uuid",
    "agent_type": "claude_code",
    "workspace_path": "/outside/workspace",
    "status": "rejected",
    "code": "WORKSPACE_FORBIDDEN",
    "message": "Workspace is outside allowed paths"
  }
}
```

说明：

- `request_id`：原始 `session.start` 的消息 id
- `workspace_path`：成功时为 daemon 最终采用的真实工作区路径；如果请求里传空字符串，这里会返回 daemon 默认工作区
- `status = "rejected"` 时必须携带 `code`，其枚举与通用 `error.code` 一致
- server 本地预检失败（例如 daemon 离线、app 未认证）也复用同一个拒绝结构，避免客户端只能靠超时判断失败

---

### 4.8 session.agent.add

`session.start` 在所有版本中都保持“启动单个 agent”的语义。M5 需要向既有会话追加 agent 时，使用 `session.agent.add`。

```json
{
  "type": "session.agent.add",
  "payload": {
    "session_id": "sess-uuid",
    "agent_id": "agent-reviewer",
    "agent_type": "codex"
  }
}
```

`agent_id`：由发起方生成，在同一 `session_id` 内唯一。  
`agent_type` 枚举：`claude_code` / `codex` / `shell`。
当前阶段 daemon 尚未真正落地多 agent runtime；收到该消息时应返回明确错误，而不是静默忽略。

---

### 4.9 session.input

```json
{
  "type": "session.input",
  "payload": {
    "session_id": "sess-uuid",
    "text": "帮我看看 login 接口有没有问题",
    "target_agent_id": null,
    "routing_mode": "orchestrated"
  }
}
```

`routing_mode` 语义冻结如下：

- `direct`：精确投递给 `target_agent_id` 指定的单个 agent；`target_agent_id` 必须非空。
- `broadcast`：显式广播给会话内所有 agent；`target_agent_id` 被忽略，仅用于少量明确需要群发的控制场景。
- `orchestrated`：投递给会话的主 agent（orchestrator），由其决定是否继续分发；M5 群组会话里 `target_agent_id = null` 时默认使用此模式。

兼容规则：

- M1-M4 单 agent 会话里，省略 `routing_mode` 等价于 `direct`，消息投递给会话内唯一 agent。
- M5 群组会话里，`target_agent_id = null` 不再表示广播；如需广播，必须显式传 `routing_mode: "broadcast"`。

PTY 会话的逐键输入统一走 `pty.input`，`session.input` 仍保留给普通 agent 文本消息。

---

### 4.10 session.input.image

图片先在 App 端压缩到 ≤2MB，按 64KB 分片发送。

```json
{
  "type": "session.input.image",
  "payload": {
    "session_id": "sess-uuid",
    "image_id": "img-uuid",
    "chunk_index": 0,
    "total_chunks": 3,
    "mime_type": "image/jpeg",
    "data": "<base64url 分片数据>"
  }
}
```

所有分片到齐后 daemon 组装，写临时文件，将路径注入 Claude Code。

---

### 4.11 session.input.voice_text

```json
{
  "type": "session.input.voice_text",
  "payload": {
    "session_id": "sess-uuid",
    "text": "列出当前目录下所有修改过的文件",
    "confidence": 0.97
  }
}
```

语音 STT 在手机本地完成，只传文字结果，不上传音频。

---

### 4.12 session.command.slash

```json
{
  "type": "session.command.slash",
  "payload": {
    "session_id": "sess-uuid",
    "command": "compact",
    "args": []
  }
}
```

App 侧 `command` 发送裸命令名，不带前导 `/`；UI 自己负责展示 `/compact` 这样的样式。
Daemon 会在目标 runtime 需要时再补前导 `/`（例如 Claude Code），shell agent 则可直接使用原始命令名。

---

### 4.13 session.cancel

```json
{
  "type": "session.cancel",
  "payload": {
    "session_id": "sess-uuid"
  }
}
```

Daemon 向 agent 子进程发 SIGINT。

---

### 4.14 danger.allow / danger.deny

```json
{
  "type": "danger.allow",
  "payload": {
    "session_id": "sess-uuid",
    "danger_id": "dng-uuid",
    "biometric_verified": true
  }
}
```

```json
{
  "type": "danger.deny",
  "payload": {
    "session_id": "sess-uuid",
    "danger_id": "dng-uuid"
  }
}
```

---

### 4.15 danger.pending

```json
{
  "type": "danger.pending",
  "payload": {
    "danger_id": "dng-uuid",
    "session_id": "sess-uuid",
    "agent_id": "agent-uuid",
    "agent_type": "codex",
    "command": "git push --force origin main",
    "tool_name": "Bash",
    "rule_matched": "force push",
    "workspace": "/Users/shuai/projects/HelloBug",
    "timeout_at": 1718957100000
  }
}
```

`timeout_at`：60 秒后 daemon 自动 deny，App 据此展示倒计时。  
`agent_id` / `agent_type`：M5 群组会话中必填，用于标识发起危险操作的 agent；M1-M4 单 agent 场景可省略或传 `null`。

---

### 4.16 danger.result

```json
{
  "type": "danger.result",
  "payload": {
    "danger_id": "dng-uuid",
    "session_id": "sess-uuid",
    "status": "timed_out",
    "message": "Danger approval timed out"
  }
}
```

`status` 枚举：
- `approved`
- `denied`
- `timed_out`
- `not_found`
- `biometric_required`

App 在发送 `danger.allow` / `danger.deny` 后，应该等待对应 `danger_id` 的 `danger.result`，再决定关闭确认层或展示错误提示。

---

### 4.17 session.event（agent 事件流）

`session.event` 是一个容器，内部 `event` 字段为联合类型：

```json
{
  "type": "session.event",
  "payload": {
    "session_id": "sess-uuid",
    "agent_id": "agent-uuid",
    "agent_type": "codex",
    "seq": 42,
    "event": { ... }
  }
}
```

`agent_id` / `agent_type`：M5 群组会话时必须同时携带，用于标识事件来源；M1-M4 单 agent 时可省略或传 `null`。

#### assistant.delta

```json
{
  "event_type": "assistant.delta",
  "text": "发现两处潜在问题："
}
```

流式文本片段，App 追加渲染。

#### assistant.thinking

```json
{
  "event_type": "assistant.thinking",
  "text": "我需要先读取 login.ts 的内容..."
}
```

默认折叠展示。

#### tool.use

```json
{
  "event_type": "tool.use",
  "tool_name": "Read",
  "tool_input": { "file_path": "src/auth/login.ts" },
  "tool_use_id": "toolu_01abc"
}
```

#### tool.result

```json
{
  "event_type": "tool.result",
  "tool_use_id": "toolu_01abc",
  "tool_name": "Read",
  "is_error": false,
  "content": "import { AuthError }..."
}
```

`content` 超过 2KB 时 App 自动折叠，提供"展开"按钮。

#### file.changed

```json
{
  "event_type": "file.changed",
  "file_path": "src/auth/login.ts",
  "diff": "@@ -12,8 +12,16 @@\n async function login...",
  "added": 12,
  "removed": 4
}
```

`diff` 为 unified diff 格式字符串（`git diff` 输出），App 展示 diff 卡片。  
文件归属使用外层 `session.event.payload.agent_id` / `agent_type` 标识，不在 `file.changed` 事件体内重复定义。

#### session.usage

```json
{
  "event_type": "session.usage",
  "input_tokens": 4821,
  "output_tokens": 312,
  "cache_read_tokens": 3200,
  "cost_usd": 0.0042
}
```

可选展示，App 在会话页底部小字显示。

#### session.done

```json
{
  "event_type": "session.done",
  "exit_code": 0,
  "duration_ms": 12400
}
```

#### pty.data（Shell / PTY 会话专用）

```json
{
  "event_type": "pty.data",
  "bytes": "<base64 PTY 原始字节>"
}
```

App 端 xterm.dart 直接写入。

---

### 4.17 fs.tree.req / fs.tree

请求：

```json
{
  "type": "fs.tree.req",
  "payload": {
    "session_id": "sess-uuid",
    "workspace_path": "/Users/shuai/projects/HelloBug",
    "dir_path": "src/auth"
  }
}
```

响应：

```json
{
  "type": "fs.tree",
  "payload": {
    "workspace_path": "/Users/shuai/projects/HelloBug",
    "dir_path": "src/auth",
    "entries": [
      {
        "name": "login.ts",
        "path": "src/auth/login.ts",
        "type": "file",
        "modified": true,
        "size": 1240
      },
      {
        "name": "register.ts",
        "path": "src/auth/register.ts",
        "type": "file",
        "modified": false,
        "size": 880
      },
      {
        "name": "utils",
        "path": "src/auth/utils",
        "type": "dir",
        "modified": false,
        "size": 0
      }
    ]
  }
}
```

`modified`：对应 `git status` 中出现的文件为 `true`，App 用橙色标记。

---

### 4.18 fs.file.req / fs.file

请求：

```json
{
  "type": "fs.file.req",
  "payload": {
    "session_id": "sess-uuid",
    "file_path": "src/auth/login.ts",
    "chunk_index": 0
  }
}
```

响应（单片或分片第一片）：

```json
{
  "type": "fs.file",
  "payload": {
    "file_path": "src/auth/login.ts",
    "mime_type": "text/typescript",
    "chunk_index": 0,
    "total_chunks": 1,
    "data": "<base64url 文件内容>",
    "total_size": 1240
  }
}
```

文件超过 200KB 时分片，每片最大 200KB（base64 前），App 按 `chunk_index` 顺序拼接。

---

### 4.19 device.status

```json
{
  "type": "device.status",
  "payload": {
    "device_id": "daemon-device-uuid",
    "online": true,
    "machine_name": "MacBook-Pro-M3",
    "ts": 1718956800000
  }
}
```

设备连接/断开时服务器立即推送给该设备关联的所有 App 连接。

---

### 4.20 pty.input

```json
{
  "type": "pty.input",
  "payload": {
    "session_id": "sess-uuid",
    "data": "<base64 PTY 输入字节>"
  }
}
```

---

### 4.21 pty.resize

```json
{
  "type": "pty.resize",
  "payload": {
    "session_id": "sess-uuid",
    "cols": 80,
    "rows": 24
  }
}
```

---

### 4.22 history.list / history.get

请求列表：

```json
{
  "type": "history.list",
  "payload": {
    "workspace_path": "/Users/shuai/projects/HelloBug"
  }
}
```

响应：

```json
{
  "type": "history.list",
  "payload": {
    "items": [
      {
        "session_id": "01JXXX",
        "path": "~/.claude/projects/abc123/01JXXX.jsonl",
        "created_at": 1718956800000,
        "message_count": 142
      }
    ]
  }
}
```

请求内容（分页）：

```json
{
  "type": "history.get",
  "payload": {
    "session_id": "01JXXX",
    "offset": 0,
    "limit": 100
  }
}
```

响应：

```json
{
  "type": "history.get",
  "payload": {
    "session_id": "01JXXX",
    "offset": 0,
    "total": 142,
    "lines": ["..raw jsonl line..", "..."]
  }
}
```

`lines` 为原始 JSONL 行数组，App 端自行解析渲染。

---

### 4.22 templates.list / slash.list

请求 `templates.list`（无额外字段，daemon 返回全局模板列表）：

```json
{
  "type": "templates.list",
  "payload": {}
}
```

请求 `slash.list`（需带 `session_id`，daemon 据此判断当前 agent 类型返回对应命令集）：

```json
{
  "type": "slash.list",
  "payload": {
    "session_id": "sess-uuid"
  }
}
```

响应示例：

```json
{
  "type": "templates.list",
  "payload": {
    "templates": [
      { "id": "t1", "label": "git status", "text": "git status" },
      { "id": "t2", "label": "跑测试", "text": "运行所有测试，失败的给我摘要" }
    ]
  }
}
```

```json
{
  "type": "slash.list",
  "payload": {
    "commands": [
      { "name": "clear", "desc": "清空当前会话上下文" },
      { "name": "compact", "desc": "压缩历史，只保留摘要" },
      { "name": "init", "desc": "生成 CLAUDE.md" },
      { "name": "model", "desc": "切换模型" }
    ]
  }
}
```

`slash.list.commands[].name` 也发送裸命令名；App 展示时自行加上 `/`。

---

### 4.23 replay.done

```json
{
  "type": "replay.done",
  "payload": {
    "session_id": "sess-uuid",
    "replayed_count": 17,
    "current_seq": 58
  }
}
```

App 收到后结束"重播中"状态，恢复正常 UI。

---

### 4.24 device.push_token

配对完成后 App 立即发送，服务器据此维护推送路由表。iOS 和 Android 字段不同：

```json
{
  "type": "device.push_token",
  "payload": {
    "platform": "ios",
    "apns_token": "<hex 设备 token>",
    "manufacturer": null,
    "vendor_token": null
  }
}
```

```json
{
  "type": "device.push_token",
  "payload": {
    "platform": "android",
    "apns_token": null,
    "manufacturer": "Xiaomi",
    "vendor_token": "<厂商推送 token>"
  }
}
```

`manufacturer` 枚举：`Xiaomi` / `OPPO` / `vivo` / `Other`。  
`manufacturer: "Other"` 时服务器不发厂商推送，依赖 App 前台轮询或 FCM（如可用）。  
无响应消息，服务器静默存储。

---

### 4.25 notification.push（推送 payload 详细格式）

此消息不走 E2EE 通道，由服务器直接向 APNS / 厂商推送平台投递：

```json
{
  "aps": {
    "alert": { "title": "HelloBug", "body": "任务已完成" },
    "sound": "default"
  },
  "session_id": "sess-uuid",
  "event_type": "task_done"
}
```

`event_type` 枚举：`task_done` / `danger_pending` / `session_error`

---

## 五、断线重连与重放

```
App 重连流程：
1. App 与服务器重建 WebSocket（App 侧不使用 mTLS）
2. App 发送 `auth.attach { jwt }`
3. Server 回复 `auth.token`（必要时返回续期后的 JWT）
4. App 按需逐会话发送 `session.resume { session_id, last_seq }`
5. 服务器推送 `[last_seq+1, current_seq]` 的所有密文 envelope
6. 服务器发送 `replay.done { status, message }`
7. App 解密重放消息，恢复 UI 状态
```

```json
{
  "type": "session.resume",
  "payload": {
    "session_id": "sess-uuid",
    "last_seq": 41
  }
}
```

服务器环形缓冲：每 session 最近 500 条密文 envelope，TTL 24 小时，超出后丢弃最旧条目。

`replay.done` 结构：

```json
{
  "type": "replay.done",
  "payload": {
    "session_id": "sess-uuid",
    "replayed_count": 3,
    "current_seq": 44,
    "status": "ok",
    "message": "Replay complete"
  }
}
```

`status` 枚举：

- `ok`：恢复完成，可继续使用该 session
- `session_not_found`：该 session 已失效、已被清理，或不归当前 App 设备所有；客户端应停止继续恢复这个 session，并清理本地恢复状态

---

## 六、错误响应

除 `session.start` 外，其他消息处理失败时，发送方回复：

```json
{
  "type": "error",
  "payload": {
    "request_id": "<原始消息 id>",
    "code": "AUTH_EXPIRED",
    "message": "JWT 已过期，请重新连接"
  }
}
```

| code                  | 含义                 |
| --------------------- | -------------------- |
| `AUTH_EXPIRED`        | JWT 过期             |
| `AUTH_INVALID`        | 签名验证失败         |
| `DEVICE_REVOKED`      | 设备已吊销           |
| `SESSION_NOT_FOUND`   | 会话不存在或已结束   |
| `RATE_LIMITED`        | 请求过于频繁         |
| `WORKSPACE_FORBIDDEN` | 工作区路径不在白名单 |
| `CHUNK_MISSING`       | 分片缺失，请重传     |
| `PROTOCOL_VERSION`    | 协议版本不兼容       |

`session.start` 是特例：成功与失败都统一走 `session.start.result`。失败态在 payload 里返回 `status = "rejected"` 与对应 `code / message`。

---

## 七、M5 多 Agent 群组会话

### 7.1 概述

M5 支持在单个会话内同时运行多个 agent，由单个用户在同一 daemon / 同一工作区内进行群组协作。它不是“多用户共享同一 session”的多人协作能力。所有 agent 共享同一工作区（`allowed_paths`、同一 fence）。

### 7.2 数据模型

Daemon 侧会话数据结构：

```typescript
interface SessionHandle {
  session_id: string;
  workspace_path: string;
  primary_agent_id: string;
  agents: Map<agent_id, AgentProcess>;
  writeLock: Mutex;
}
```

`session.start` 始终只启动一个 agent。需要扩展为群组会话时，通过 `session.agent.add` 为同一 `session_id` 追加 agent。每个 `AgentProcess` 独立运行，有独立的 transcript / audit 归属，但共享工作区文件系统访问权限。

### 7.3 消息路由

#### session.input 路由规则

`session.input` 使用 `routing_mode` 明确路由语义：

- **`direct`**：必须提供非空 `target_agent_id`，daemon 只投递给该单个 agent。
- **`broadcast`**：显式广播给会话内所有 agent，`target_agent_id` 被忽略。
- **`orchestrated`**：投递给 `primary_agent_id` 对应的主 agent，由其决定是否继续向其他 agent 分发。

兼容规则：

- M1-M4 单 agent 会话里，省略 `routing_mode` 时按 `direct` 处理。
- M5 群组会话里，`target_agent_id = null` 的默认含义是 `orchestrated`，不是广播。

示例：定向发送

```json
{
  "type": "session.input",
  "payload": {
    "session_id": "sess-uuid",
    "text": "@agent-A 帮我检查 login.ts",
    "target_agent_id": "agent-A",
    "routing_mode": "direct"
  }
}
```

#### session.event 事件归属

M5 群组会话中的所有 `session.event` 与 `danger.pending` 都必须携带 `agent_id` / `agent_type`。App、审计日志和历史记录据此区分事件来源。

### 7.4 并发写保护

Daemon 在会话级别维护一个写队列（`writeLock: Mutex`）：

- Agent 执行文件写操作前，先获取 `writeLock`
- 持有锁期间其他 agent 阻塞等待
- 操作完成后释放锁，唤醒下一个等待的 agent

此机制确保不会出现多个 agent 同时修改同一文件导致内容损坏。

### 7.5 实现约束

- M1-M4 不改变现有单 agent 协议；旧客户端可继续省略 `routing_mode`，daemon 将其视作投递给唯一 agent 的 direct 路由。
- M5 在同一 `session_id` 下扩展为 `Map<agent_id, AgentProcess>`，但不引入多用户共享 session，也不支持跨 daemon 的 agent 协作。
- 工作区围栏（`allowed_paths`）在会话级别生效，不需要为每个 agent 单独配置

---

## 八、版本兼容策略

- `InnerMessage.v` 当前为 `1`
- 新增可选字段向后兼容，旧客户端忽略未知字段
- 删除字段或修改语义需要升 `v`，同时 `server.hello` 的 `min_client_version` 同步更新
- 客户端版本低于 `min_client_version` 时，服务器发送 `error { code: "PROTOCOL_VERSION" }` 后断连
