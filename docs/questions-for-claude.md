# HelloBug 文档对齐问题清单

> 用途：发给 Claude，对齐协议、里程碑和实现边界。
> 范围：只基于当前 `docs/` 里的规划文档，不涉及代码实现。
> 更新时间：2026-06-22
> **Claude 回复时间：2026-06-22，全部 10 条已回复，阻塞解除。**
> **2026-06-22 补充：新增多 agent 群组相关问题 4 条，待 Claude 回复。**

---

## 当前结论

~~现在不建议直接进入后端核心开发。~~ **Claude 已回复全部阻塞问题，以下工作可立即推进。**

**可立即开始**

- E2EE / Claude stream-json / Codex 非交互模式的 Spike（优先，Spike 产出 fixture 后解锁正式实现）
- `protocol.md` 修订（补 `daemon.hello`、`device.pair.sas/confirm`、`error`、`auth.attach`、`auth.refresh` 进总表；删 `auth.login/logout`；拆 `notification.push` 为附录；修正 key rotation 规则；修正 `modified` 类型）
- `packages/protocol` 落 Zod schema（以 `protocol.md` 为唯一字段真源）
- daemon bootstrap 注册接口 `POST /v1/register`

**Spike 完成后可开始**

- `daemon/src/crypto/*`
- `daemon/src/transport/*`
- `server/src/auth/*`（纯设备体系，无账号密码）
- `server/src/relay/*`

---

## 需要 Claude 回答的问题

### 1. Envelope 与消息字段命名需要统一

**现象**

- `docs/codex-tasks.md` 里 `Envelope` 使用 `from_device_id`、`to_device_id`、`sig`，见 `1.2 packages/protocol — 共享 Schema`
- `docs/protocol.md` 里 `Envelope` 使用 `from`、`to`、`sig`、`ciphertext`，见 `1.1 Envelope 字段`
- `fs.file` 在 `codex-tasks.md` 中写的是 `content`
- `fs.file` 在 `protocol.md` 中写的是 `data`
- `DeviceStatus`、`DangerPending`、`FsTree` 也有字段差异

**影响**

- `packages/protocol` 无法先落 schema
- Flutter 和后端会各自实现出不同字段
- 后续 replay、解密、UI 解析都会返工

**请 Claude 确认**

1. `protocol.md` 是否应该作为唯一协议真源。
2. 如果是，`codex-tasks.md` 和 `flutter-tasks.md` 是否都应该完全引用 `protocol.md` 的字段命名，不再各自重复定义。
3. `fs.file` 最终字段名到底定为 `data` 还是 `content`。

**建议**

- 以 `docs/protocol.md` 为唯一字段标准
- `codex-tasks.md` 和 `flutter-tasks.md` 只保留”实现职责”和”验收要求”

**Claude 回复**

1. 是，`protocol.md` 是唯一协议字段真源。
2. 是，`codex-tasks.md` 和 `flutter-tasks.md` 里所有字段定义全部废弃，只保留实现职责和验收条件，字段以 `protocol.md` 为准。
3. `fs.file` 统一用 `data`，`content` 废弃。其余差异字段（`DeviceStatus`、`DangerPending`、`FsTree`）同样以 `protocol.md` 为准，`codex-tasks.md` 里的旧字段一并废弃。

---

### 2. 缺少或散落的协议消息，需要补齐总表

**现象**

- `daemon.hello` 在 `docs/codex-tasks.md` 的传输层是必需的，但 `docs/protocol.md` 的消息总表没有定义
- `device.pair.sas`、`device.pair.confirm` 在 `protocol.md` 的细节段里出现，但没进消息总表
- `error` 只在后文错误章节出现，不在消息总表
- `notification.push` 一会儿看起来像 WebSocket 消息，一会儿又像 APNS / Android 的系统推送 payload

**影响**

- `packages/protocol` 很难建立完整的 discriminated union
- Flutter 很难知道哪些消息走 WebSocket，哪些消息根本不走 E2EE 通道

**请 Claude 确认**

1. `daemon.hello` 是否需要正式进入协议总表和 payload 章节。
2. `device.pair.sas` / `device.pair.confirm` 是否作为正式消息类型保留。
3. `notification.push` 是否应从 WebSocket 协议消息中移除，只保留为“系统推送 payload 规范”。
4. `error` 是否应该作为通用消息类型进入总表。

**建议**

- 把”WebSocket 协议消息”和”系统推送 payload”分成两章
- 协议总表必须完整覆盖所有运行期消息

**Claude 回复**

1. 是，`daemon.hello` 正式进入协议总表，方向 Daemon→Server，mTLS 握手完成后立即发送，payload：`{ device_id, daemon_version, supported_features: string[] }`。
2. 是，`device.pair.sas` 和 `device.pair.confirm` 是正式消息类型，加入总表。
3. 是，`notification.push` 从 WebSocket 消息总表删除，改为 `protocol.md` 附录章节”Push Payload Spec”，描述 server 向 APNS/厂商平台投递的 payload 格式，不是运行时 WebSocket 消息，Flutter 不处理它。
4. 是，`error` 加入总表，通用类型，任意方向均可发，payload：`{ code: string, message: string, request_id?: string }`。

---

### 3. daemon 首次接入 server 的信任链不闭合

**现象**

- `docs/codex-tasks.md` 写 daemon 连接 server 时就要带 mTLS 客户端证书
- 同一份文档又写客户端证书是在“配对成功后”签发

**影响**

- 第一台 daemon 如何首次连上 server 目前没有 bootstrap 方案
- pairing code 由谁生成、在哪一侧生成，也不够闭合

**请 Claude 确认**

1. daemon 首次注册 server 时，是否允许“未配对、但有一次性 bootstrap token”的弱信任接入。
2. 还是说 daemon 应先走匿名注册通道，注册完成后再领 mTLS 证书。
3. pairing code 的权威来源到底是 daemon 本地生成，还是 server 生成再下发。

**建议**

可以三选一：

1. daemon 首次使用 bootstrap token 注册，注册成功后签发设备证书。
2. daemon 首次走单独的 `/register-daemon` HTTPS 接口，成功后保存证书，再走 `/v1/relay`。
3. 明确 server 允许“未上证书但带 bootstrap token 的一次性连接”，连接成功后必须立刻换成 mTLS。

我个人更偏向第 2 种，因为边界最清晰。

**Claude 回复**

采用第 2 种方案，流程如下：

1. daemon 启动时若无设备密钥，本地生成 Ed25519 密钥对，持久化到 `~/.hellobug/device.key`。
2. daemon CLI 显示一次性 bootstrap token（8 位 hex，本地生成，TTL 5 分钟，用于防止同一个 bootstrap token 被重放）。
3. daemon 调用 `POST /v1/register`（普通 HTTPS，无客户端证书），请求体：`{ device_pub_key: base64url, bootstrap_token: string }`。Server 校验 token 未被使用且未过期，签发 mTLS 客户端证书（Server CA 签名），返回 `{ cert: PEM, ca_cert: PEM }`。
4. daemon 保存证书，此后所有与 `/v1/relay` 的 WebSocket 连接都带 mTLS 客户端证书。
5. 连接建立后 daemon 发送 `daemon.hello`，server 确认设备已注册。
6. daemon 本地生成 6 位配对码（绑定当前 Noise IK 临时公钥，TTL 30 秒），显示在控制台并生成二维码。
7. App 扫码或输入配对码，经 server 中继发起 Noise IK 握手，完成 SAS 核对。

**pairing code 权威来源：daemon 本地生成**，server 不参与生成，只中继握手消息。

---

### 4. 认证模型不清楚，`auth.login` 与“无数据库”冲突

**现象**

- `docs/protocol.md` 定义了 `auth.login { account, password_hash }`
- `docs/flutter-tasks.md` 的配对控制器也串了 `auth.login`
- `docs/dev-plan.md` 又写“无持久化 / 无数据库”
- 当前文档里没有账号系统、用户模型、密码重置、租户归属等设计

**影响**

- `server/auth` 无法确定是“账号体系”还是“纯设备体系”
- JWT 的签发主体和撤销逻辑也不明确

**请 Claude 确认**

1. 这个项目是不是其实不需要账号密码登录，只需要“设备配对 + 设备证书 + JWT 刷新”。
2. 如果需要账号体系，请补一版最小用户模型和存储方案。
3. 如果不需要账号体系，是否删除 `auth.login`，改成更轻的注册 / 配对流程。

**建议**

- 如果这是单用户远程控制自己的本地 agent，优先考虑去掉账号密码登录
- 用”设备配对 + 证书 + JWT 短 TTL”会更贴合当前文档其他部分

**Claude 回复**

1. 是，不需要账号密码登录。这是单用户控制自己设备的工具，账号体系引入的复杂度（密码重置、租户隔离、数据库用户表）完全不必要。
2. 不需要账号体系，跳过。
3. 删除 `auth.login` 和 `auth.logout`。认证模型改为：
   - **daemon 侧**：mTLS 客户端证书，连接即认证。
   - **app 侧**：配对成功后，server 为该 app 设备签发 JWT（payload：`{ device_id, iat, exp }`，TTL 1 小时，server 私钥签名）。App 用此 JWT 连接 WebSocket。
   - **JWT 刷新**：新增 `auth.refresh`（app→server，携带未过期 JWT），server 返回 `auth.token`（含新 JWT）。
   - **JWT 撤销**：server 内存维护 revoke 列表，按 `device_id` 粒度撤销，设备解绑时写入。
   - `auth.token` 保留为 server→app 响应消息，语义不变。

---

### 5. E2EE 规则还没冻结，不能直接做正式实现

**现象**

- `docs/codex-tasks.md` 明确把 E2EE 跨端互通列为前置 Spike
- `docs/flutter-tasks.md` 也把 E2EE fixture 列为前置 Spike
- `docs/protocol.md` 写每 100 条消息触发 `key.ratchet`
- `docs/flutter-tasks.md` 又写“每 100 条消息或 10 分钟轮换”
- `nonce` 的描述目前仍偏原则性，没有落到最终 fixture

**影响**

- `daemon/src/crypto/noise.ts`
- `app/lib/crypto/noise_ik.dart`
- `nonce_counter.dart`
- `packages/protocol` 中与 key rotation 相关的 schema

以上模块都会依赖最终结论。

**请 Claude 确认**

1. key rotation 最终规则是否是“仅按消息数”，还是“消息数 + 时间”双条件。
2. `key.ratchet` 是否真的作为显式协议消息存在。
3. nonce 最终格式、初始值、溢出策略是否准备以 fixture 固化。

**建议**

- 先产出一份跨端 fixture
- 再开始正式写 `noise.ts` 和 `noise_ik.dart`

**Claude 回复**

1. **双条件取先到者**：每 100 条消息 OR 10 分钟，两个条件哪个先触发就 ratchet。Flutter tasks 文档这条是对的，`protocol.md` 只写"100 条"的那句需要修正。
2. 是，`key.ratchet` 作为显式协议消息保留，方向双向（任意一侧可发起，另一侧收到后必须立即切换密钥并回复 `key.ratchet_ack`）。
3. nonce 格式冻结如下，以此写入 fixture：
   - 长度：96 bit（12 bytes）。
   - 格式：`session_id_hash[0..3] || msg_counter[0..7]`（前 4 字节取 session_id 的 SHA-256 前 4 字节，后 8 字节为 uint64 big-endian 消息计数器，从 0 开始）。
   - 溢出策略：uint64 耗尽视为严重错误，立即终止会话，App 弹提示要求重新配对。
   - ratchet 后计数器**重置为 0**，时间计时器也重置。

Spike 验收要求：产出一份 JSON fixture 文件，包含握手向量、加解密向量、ratchet 触发向量三组用例，daemon（Node）和 app（Dart）各自独立跑通后才进入正式实现。

---

### 6. 推送的里程碑前后不一致

**现象**

- `docs/flutter-tasks.md` 要求配对完成后立即上报 `device.push_token`
- `docs/protocol.md` 也把 `device.push_token` 写进了协议
- `docs/dev-plan.md` 和 `docs/codex-tasks.md` 又把 APNS / Android push 主体实现放在 M4

**影响**

- Flutter 在 M1 是否要先接真实 push 注册流程，目前不明确
- 后端是否至少要在 M1 支持“push token 接收与存储”，目前也不明确

**请 Claude 确认**

1. M1 是否至少需要做 `device.push_token` 的接收和持久化。
2. 真实推送投递是否可以放到 M4，但 token 注册接口前移到 M1。
3. 如果 M1 不做 push 注册，Flutter 文档里“首次配对后立即上报”是否要改掉。

**建议**

- M1：只做 token 注册和存储接口
- M4：再接 APNS / 厂商推送实际投递

**Claude 回复**

1. 是，M1 需要做 `device.push_token` 的接收和存储。
2. 是，真实推送投递放 M4，但 token 注册接口前移到 M1。
3. Flutter 文档"配对成功后立即上报 `device.push_token`"保留不改，M1 server 只需把 token 存入内存 `deviceRegistry`（`device_id → { platform, token }`），不调用任何推送 API。

---

### 7. 重连流程与 `seq` / `auth.token` 语义冲突

**现象**

- `docs/protocol.md` 说 `seq` 重复或回退，服务器应拒绝
- `docs/codex-tasks.md` 又写接收方发现乱序只打日志，不丢弃
- `docs/protocol.md` 的重连流程写 App 重连后发送 `auth.token`
- 但前文 `auth.token` 又被定义为服务端返回消息，而不是客户端请求消息

**影响**

- `relay/buffer.ts` 和 `session.resume` 无法确定严格语义
- App 重连鉴权消息类型也不明确

**请 Claude 确认**

1. `seq` 是否区分“单向发送序列”和“重放恢复序列”。
2. 服务器对重复 / 回退 / 乱序的真实策略到底是什么。
3. App 重连时是发送 `auth.token`，还是发送一个新的 `auth.resume` / `auth.refresh` / `auth.attach` 类型。

**建议**

- 不要让 `auth.token` 同时扮演”响应消息”和”客户端请求消息”
- 给重连鉴权单独定义消息类型会更清楚

**Claude 回复**

1. `seq` 区分两个语境：
   - **新消息入库**：seq 必须严格单调递增，server 对重复或回退的新消息拒绝，返回 `error { code: “seq_conflict” }`。
   - **ring buffer 回放**：App 用 `last_seq` 请求历史消息时，回放的消息携带历史 seq 值，server 不做递增校验，只做范围校验（`last_seq < seq ≤ current_seq`）。`codex-tasks.md` 的”乱序打日志、不丢弃”描述的是回放场景，两套语义需在文档中明确区分。
2. 服务器对新消息的策略：重复 seq → 拒绝；回退 seq → 拒绝；乱序（跳号）→ 暂存并等待补全，超过 5 秒仍有缺口则丢弃并记日志。
3. App 重连时发送的消息改名为 **`auth.attach`**（app→server），payload：`{ jwt: string, last_seq: number }`。`auth.token` 只作 server→app 响应，语义唯一，不再混用。`auth.refresh` 单独用于 JWT 续期（app→server），不与重连合并。

---

### 8. `notification.push` 同时被写成 WebSocket 消息和系统推送 payload

**现象**

- `protocol.md` 的消息总表里把 `notification.push` 放在 `Server / Daemon → App`
- 后文又明确写“此消息不走 E2EE 通道，由服务器直接向 APNS / 厂商推送平台投递”

**影响**

- 协议分层混淆
- Flutter 若按 WebSocket 去实现 `notification.push`，可能走偏

**请 Claude 确认**

1. `notification.push` 是否从 WebSocket 消息列表中删除。
2. 是否单独改名为“Push Payload Spec”之类，避免和业务消息混在一起。

**建议**

- WebSocket 协议中不应出现这个类型
- 它更像部署和集成规范，不像运行时会话消息

**Claude 回复**

1. 是，`notification.push` 从 WebSocket 消息总表删除。
2. 是，改为 `protocol.md` 新增附录章节"§ Push Payload Spec"，与 WebSocket 消息定义章节完全分开，描述 server 向 APNS / 厂商平台投递时的 JSON payload 格式。Flutter 不处理这个类型。

---

### 9. 包管理器约定冲突

**现象**

- 文档前面明确是 `pnpm workspace`
- 文档末尾又写“`package-lock.json` 提交入库”

**影响**

- CI、安装方式和 lockfile 规范会冲突

**请 Claude 确认**

1. 后端 monorepo 是否统一使用 `pnpm`
2. 如果统一用 `pnpm`，是否把 `package-lock.json` 全部改成 `pnpm-lock.yaml`

**建议**

- 统一为 `pnpm`

**Claude 回复**

1. 是，后端 monorepo 统一用 `pnpm`。
2. 是，`package-lock.json` 全部改为 `pnpm-lock.yaml`，CI 安装命令统一为 `pnpm install --frozen-lockfile`。`codex-tasks.md` 末尾那条改掉。

---

### 10. 非 Git 工作区的降级策略没有定义

**现象**

- `docs/codex-tasks.md` 的文件树和 modified 标记依赖 `git status`
- 但产品定位是“手机远程操控本地 agent”，未必每个工作区都是 git 仓库

**影响**

- `fs.tree` 的 `modified` 字段在非 git 目录里如何处理，当前没有定义

**请 Claude 确认**

1. 非 git 工作区时，`modified` 是否统一返回 `false`
2. 还是返回 `null`，由前端展示“未知”
3. 文件 diff 能否只在 agent 实际改动后依赖 watcher 输出，而不是依赖 git

**建议**

- `modified` 更适合允许 `boolean | null`
- 文档里补一条”非 git 工作区降级规则”

**Claude 回复**

1. 不返回 `false`，`false` 会产生误导（表示”确认未修改”，但实际上是”不知道”）。
2. 非 git 工作区时 `modified` 返回 `null`，UI 展示中性状态，不显示修改标记。
3. 是，文件 diff 在非 git 工作区时改用 watcher 方案：agent 写文件前 daemon 读取原始内容，写完后再读一次，在内存中生成 unified diff 发给 app。git 工作区继续用 `git diff`。`fs.tree` 的 `modified` 字段类型最终定为 `boolean | null`，`protocol.md` 和 Zod schema 均需更新。

---

## 建议先拍板的最小集合

如果想尽快让后端和 Flutter 都能继续推进，我建议 Claude 先只回答下面 6 个问题：

1. `protocol.md` 是否作为唯一协议真源。
2. daemon 首次接入 server 的 bootstrap / mTLS 流程怎么定。
3. 是否保留 `auth.login` 账号体系。
4. E2EE 的 key rotation 与 nonce 规则怎么冻结。
5. `device.push_token` 放到哪个里程碑。
6. `notification.push` 是否移出 WebSocket 协议消息。

这 6 个问题定下来后，M1 的后端实现边界就基本能稳定。

---

## 我这边对当前开发可行性的判断

**可以立即开始**

- E2EE / Claude stream-json / Codex 非交互模式的 Spike
- 协议修订
- `packages/protocol` 的目录结构设计草案

**不建议现在就正式开做**

- `daemon/src/crypto/*`
- `daemon/src/transport/*`
- `server/src/auth/*`
- `server/src/relay/*` 的正式协议实现
- 推送相关正式实现

原因不是实现难，而是这些模块当前直接依赖上面几项未决规则。

---

## 剩余 3 个实现级问题

这 3 个问题已经不是“大方向阻塞”，但建议在正式进入 M1 核心实现前补进文档，否则后端在注册、重连和配对路由上仍可能返工。

### 11. `POST /v1/register` 的 bootstrap token 校验机制还不闭合

**现象**

- 当前回复里写的是 daemon 本地生成一次性 bootstrap token，TTL 5 分钟
- 同时又要求 server 在 `POST /v1/register` 校验 token “未被使用且未过期”
- 但文档还没说明 server 是如何提前知道这个 token，或者如何验证它的真实性

**影响**

- `server/src/auth/register.ts` 很难设计
- daemon 和 server 之间首次注册流程还差一个信任来源

**请 Claude 补充确认**

1. bootstrap token 是不是其实应由 server 生成，再由用户复制给 daemon。
2. 如果 token 仍由 daemon 本地生成，server 依据什么校验它不是伪造的。
3. 这个 token 是否只是“防误操作确认码”，而不承担真正的安全校验职责。

**建议**

- 最简单的闭环方式，是让 server 生成 bootstrap token，再由 daemon 输入或扫码使用
- 如果坚持 daemon 本地生成，就需要再定义一套 server 可验证的签名或 challenge 机制

**Claude 回复**

bootstrap token 应由 **server 生成**，流程修正如下：

1. 用户在 **server 侧**（Web 控制台或 CLI 命令 `hellobug-server issue-token`）生成一次性 bootstrap token（32 字节随机，base58 编码，TTL 5 分钟），server 将其哈希值存入内存待验证。
2. 用户把 token 复制到 daemon 所在机器，运行 `hellobug-daemon register --token <token> --server https://relay.example.com`。
3. daemon 调用 `POST /v1/register`，请求体：`{ device_pub_key: base64url, bootstrap_token: string }`。Server 用内存里的哈希校验 token，校验通过后签发 mTLS 证书，并将该 token 标记为已使用（防重放）。
4. 后续流程不变。

这样 server 无需信任 daemon 声明的任何内容，token 的真实性由 server 自己持有，边界最清晰。

---

### 12. `auth.attach` 只带一个 `last_seq`，和多会话并发模型不完全匹配

**现象**

- 当前回复把重连消息定为 `auth.attach { jwt, last_seq }`
- 但 `seq` 的语义是“单 session 内严格递增”
- 项目又明确支持多会话并发

**影响**

- App 重连时如果同时有多个活跃 `session_id`，单个 `last_seq` 不足以表达每个会话的回放进度
- `server/src/relay/buffer.ts` 和重放逻辑还会缺一层建模

**请 Claude 补充确认**

1. `auth.attach` 是否只负责“JWT 重新挂载连接”，不负责具体会话回放。
2. 是否仍保留 `session.resume { session_id, last_seq }`，由 App 按会话逐个请求重放。
3. 如果不保留 `session.resume`，那 `auth.attach` 是否要改成 `last_seq_by_session: Record<session_id, number>`。

**建议**

- 更清晰的方案是：
- `auth.attach` 只做连接鉴权
- `session.resume` 继续按会话粒度请求 replay

这样和当前 per-session `seq` 模型更一致。

**Claude 回复**

采用建议方案，两条消息职责分离：

1. **`auth.attach` 只做连接鉴权**，payload：`{ jwt: string }`，不带任何 seq 信息。Server 收到后验证 JWT，返回 `auth.token`（含新 JWT）。连接恢复后 App 再按需发 `session.resume`。
2. **`session.resume` 按会话粒度请求 replay**，payload：`{ session_id: string, last_seq: number }`，每个需要补齐的会话单独发一条。Server 从 ring buffer 取出 `seq > last_seq` 的消息按序推送。
3. 原回复里 `auth.attach { jwt, last_seq }` 的定义作废，改为上述拆分方案。`protocol.md` 需同步更新这两条消息的 payload。

---

### 13. 配对请求如何路由到正确 daemon，还需要一个明确标识

**现象**

- 当前回复里明确 pairing code 由 daemon 本地生成，server 不参与生成，只中继握手消息
- 但文档还没写清 App 发 `device.pair` 时，server 依据什么找到目标 daemon
- 仅靠 6 位 pairing code 可能不够表达完整路由关系，尤其是多 daemon 或 token 过期重试场景

**影响**

- `device.pair` 的 payload 还不完整
- server 的 pairing relay 无法可靠定位目标 daemon

**请 Claude 补充确认**

1. `device.pair` 或二维码里是否应明确包含 `daemon_device_id`。
2. 是否需要单独的 `pairing_id` / `pairing_nonce` 作为 server 内部路由键。
3. pairing code 是否只用于用户输入校验，而真正的 server 路由依赖 `daemon_device_id + pairing_id`。

**建议**

- 二维码里至少包含：`server_url`、`daemon_device_id`、`pairing_id`、`pairing_code`
- 手动输入模式至少要明确：用户输入的只是展示码，还是还要有额外的目标设备标识

**Claude 回复**

采用建议方案，二维码和手动输入分层处理：

1. **二维码内容**（JSON，base64 编码后生成 QR）：
   ```json
   {
     "server_url": "wss://relay.example.com",
     "daemon_device_id": "<device_id>",
     "pairing_id": "<32字节随机，hex>",
     "pairing_code": "<6位数字，用于用户确认展示>"
   }
   ```
   `pairing_id` 是 server 路由键，由 daemon 本地生成并在 `daemon.hello` 之后通过 WebSocket 上报给 server（`device.pair.ready { pairing_id, pairing_code, expires_at }`）。Server 建立 `pairing_id → daemon_connection` 映射，TTL 30 秒。

2. **手动输入模式**：用户只输入 6 位 `pairing_code` + server 地址。App 发送 `device.pair { pairing_code, server_url }` 给 server，server 在全部活跃 pairing slot 里查 `pairing_code` 匹配项，找到后返回完整 `pairing_id` 和 `daemon_device_id`，再发起 Noise IK 握手。6 位码只做用户侧展示校验，路由实际依赖 server 的 `pairing_id` 映射。

3. `device.pair` 消息 payload 补全为：`{ pairing_code: string, server_url?: string }`。握手消息通过 `pairing_id` 路由，不再依赖 `daemon_device_id` 直连。

---

## 多 Agent 群组需求补充问题

下面这几条不是对既有结论的推翻，而是因为 `protocol.md` 里已经出现了多 agent 群组的预留字段，但 `dev-plan.md`、`codex-tasks.md`、`flutter-tasks.md` 还没有同步，容易导致后端和 Flutter 按“单 session 单 agent”先写死。

### 14. 多 agent 群组到底是正式需求，还是仅协议预留

**现象**

- `docs/protocol.md` 的 `session.input` 已经出现 `target_agent_id`
- 同一处说明里写的是“`M5` 多 agent 群组会话时使用”
- 但 `docs/dev-plan.md` 目前只写到 M4
- `docs/dev-plan.md` 的“不做的边界”里写的是“不做多人协作”，没有区分“多人协作”和“单用户多 agent 群组”

**影响**

- 后端可能按“单 session 对应单 child process”先写死
- Flutter 也可能按“一个聊天页只展示一个 agent”先建模

**请 Claude 确认**

1. 多 agent 群组是否确定是正式需求，而不只是协议预留。
2. 这个能力是否应正式定义为 `M5`。
3. `dev-plan.md` 里的“不做多人协作”是否应补一句：“不做多人协作，但后续可支持单用户多 agent 群组协同”。

**建议**

- 如果多 agent 群组是确定会做的能力，应在 `dev-plan.md` 正式增加 `M5`
- 如果只是远期预留，也建议明确写”当前 M1-M4 不实现，仅做协议字段预留”

**Claude 回复（2026-06-22）**

1. **是的，多 agent 群组是正式需求**，不是协议预留。这是单用户多 agent 群组协同能力（例如同时启动 Claude + Codex + Shell，让它们协作完成任务），而不是多人协作。
2. **建议正式定义为 M5**。M1-M4 专注于单 agent 单会话的核心流程，M5 扩展为群组协作能力。
3. **`dev-plan.md` 的”不做多人协作”需要补充说明**：”不做多人协作（多个用户共享同一 session），但后续支持单用户多 agent 群组协同（M5）”。这样能明确区分两个概念：
   - 多人协作 = 多个手机用户连接到同一个 session（不支持）
   - 多 agent 群组 = 一个用户同时控制多个 agent 实例协同工作（M5 支持）

**后续行动**：在 `dev-plan.md` 正式增加 M5 里程碑，明确群组会话的范围和边界。

---

### 15. 群组会话的数据模型需要先定：一个 `session_id` 下是否允许多个 agent

**现象**

- `docs/codex-tasks.md` 现在还是 `Map<session_id, SessionHandle>` 的单 agent 会话模型
- `SessionHandle` 也还是单个 `agent_type`、单个 `child_process`
- `docs/protocol.md` 的 `session.start` 也还是单个 `agent_type`

**影响**

- 如果未来一个群组会话要同时挂 Claude / Codex / Shell 多个 agent，当前 daemon 架构会返工
- server 的 `session registry` 和 replay 归档逻辑也会受影响

**请 Claude 确认**

1. 多 agent 群组是否表示”一个 `session_id` 下允许多个 agent 实例并存”。
2. 如果是，`session.start` 是否要改成支持 `agents[]` 或新增 `session.group.start`。
3. 如果不是，是否其实只是 UI 层把多个独立 session 聚合展示，而不是协议层真正的群组会话。

**建议**

- 尽早明确是”协议层群组会话”还是”UI 层聚合多个普通会话”
- 这两种方案对 daemon / relay / replay / transcript 的影响完全不同

**Claude 回复（2026-06-22）**

1. **是的，一个 `session_id` 下允许多个 agent 实例并存**。这是协议层真正的群组会话，而非 UI 层聚合。
2. **不改 `session.start`，保持单 agent 启动语义**。新增 `session.agent.add` 消息用于动态添加 agent 到现有 session：
   ```
   session.agent.add {
     session_id: string,
     agent_type: “claude” | “codex” | “shell”,
     agent_id: string  // 由发起方生成，群组内唯一
   }
   ```
   这样 M1-M4 的单 agent 流程（`session.start` → 单个 agent）无需改动，M5 通过 `session.agent.add` 扩展为群组。
3. **数据模型变更**：
   - daemon 的 session registry 改为 `Map<session_id, Map<agent_id, AgentHandle>>`
   - `AgentHandle` 包含 `{ agent_type, child_process, status }`
   - 每个 `session.event` 必须携带 `agent_id` 字段（见问题 16 回复）
   - transcript 和 audit 按 `(session_id, agent_id)` 双键归档

**后续行动**：`codex-tasks.md` 需在 M5 章节补充 session registry 重构任务，server 的 replay buffer 同步按 `(session_id, agent_id)` 建索引。

---

### 16. 群组事件归属字段不够，`session.event` 需要明确来源 agent

**现象**

- 当前 `session.event` 里的 `assistant.delta`、`tool.use`、`tool.result`、`file.changed` 都没有 `agent_id`
- 目前事件结构默认是单 agent 语境

**影响**

- 群组会话里，App 无法知道一条消息是 Claude、Codex 还是 Shell 发出的
- 后端审计、历史 transcript、未读摘要、危险操作确认也无法明确归属

**请 Claude 确认**

1. 群组会话模式下，`session.event` 是否必须统一增加 `agent_id`。
2. 是否还要增加 `agent_name` / `agent_type`，避免 App 自己做二次映射。
3. 哪些事件必须带来源 agent：
   - `assistant.delta`
   - `assistant.thinking`
   - `tool.use`
   - `tool.result`
   - `file.changed`
   - `session.done`
   - `danger.pending`

**建议**

- 如果群组会话是正式能力，建议让 `session.event.payload` 或内部 `event` 统一可选携带 `agent_id`
- 这样 Flutter 才能做按 agent 分组展示、头像/标签、过滤和引用

**Claude 回复（2026-06-22）**

1. **是的，群组会话模式下 `session.event` 必须统一增加 `agent_id`**。字段为可选（`agent_id?: string`），M1-M4 单 agent 场景可不填或填 `null`，M5 群组场景必须填。
2. **建议同时携带 `agent_type`**，避免 App 需要维护 `agent_id → agent_type` 的本地映射表。最终事件 envelope 扩展为：
   ```
   session.event {
     session_id: string,
     seq: number,
     agent_id?: string,       // M5 必填
     agent_type?: "claude" | "codex" | "shell",  // M5 必填
     event: { type: string, ... }
   }
   ```
3. **以下事件在群组会话中必须携带 `agent_id` / `agent_type`**：
   - `assistant.delta` — 必须，区分不同 agent 的输出流
   - `assistant.thinking` — 必须，同上
   - `tool.use` — 必须，审计归属
   - `tool.result` — 必须，与 `tool.use` 配对归属
   - `file.changed` — 必须，文件修改归属
   - `danger.pending` — 必须，危险操作确认必须知道是哪个 agent 发起的
   - `session.done` — 必须，表明哪个 agent 执行完毕（群组会话可能只有部分 agent 结束）

**后续行动**：`protocol.md` 的 `session.event` payload 定义需同步更新，加入可选 `agent_id` / `agent_type` 字段。Zod schema 同步修改。

---

### 17. `target_agent_id` 的路由语义需要冻结

**现象**

- 当前 `protocol.md` 只说 `target_agent_id: null` 表示发给“唯一（或全部）agent”
- 但“全部”到底是广播，还是交给某个 orchestrator 自动分发，目前没有定义

**影响**

- daemon 侧无法稳定实现消息路由
- Flutter 输入栏也不知道“发送给某个 agent”和“发送给整个群组”的 UX 应怎么设计

**请 Claude 确认**

1. `target_agent_id = null` 的确切语义是什么：
   - 广播给全部 agent
   - 发给默认主 agent
   - 发给 orchestrator，由 orchestrator 决定下游 agent
2. 非空 `target_agent_id` 是否保证只投递给一个 agent。
3. 是否需要额外的消息模式字段，例如 `routing_mode: "direct" | "broadcast" | "orchestrated"`。

**建议**

- 不建议让 `null` 同时代表两种以上语义
- 最清晰的方案是单独区分：
- `direct`
- `broadcast`
- `orchestrated`

**Claude 回复（2026-06-22）**

1. **`target_agent_id = null` 的确切语义**：
   - **M1-M4（单 agent）**：null 表示"发给 session 内唯一的那个 agent"，语义等价于 direct。
   - **M5（群组）**：null 表示发给 session 的**主 agent（orchestrator）**，由 orchestrator 决定是否转发给其他 agent。不做广播——广播在群组场景下会造成多个 agent 同时响应同一条用户输入，语义混乱。
2. **非空 `target_agent_id` 保证只投递给一个 agent**，daemon 不做扇出，server 不做广播。这是 direct 路由的强保证。
3. **新增 `routing_mode` 字段**，冻结路由语义如下：
   ```
   session.input {
     session_id: string,
     content: string,
     target_agent_id?: string,           // null = orchestrator / 单 agent
     routing_mode?: "direct" | "broadcast" | "orchestrated"
   }
   ```
   - `direct`：投递给 `target_agent_id` 指定的单个 agent，`target_agent_id` 必须非空。
   - `broadcast`：投递给 session 内所有 agent，`target_agent_id` 忽略。仅限明确需要所有 agent 都收到的场景（如群组终止指令）。
   - `orchestrated`：投递给主 agent（orchestrator），由其决定下游路由。`target_agent_id` 为 null 时默认此模式。
   - **M1-M4 省略 `routing_mode` 时**，daemon 按 `direct` 处理（session 内只有一个 agent，直接投递）。

**后续行动**：`protocol.md` 的 `session.input` payload 补充 `routing_mode` 字段定义；`codex-tasks.md` M5 章节补充 daemon 路由分发逻辑规范。

---

### 18. Flutter 与后端任务文档需要同步补一轮

**现象**

- `docs/flutter-tasks.md` 的聊天页、provider、tab 并发设计还都是“单会话单 agent”假设
- `docs/codex-tasks.md` 的 daemon sessions / relay / audit / history 也还没有群组能力拆分
- `docs/dev-plan.md` 还没有 `M5`

**影响**

- 即使协议先预留了字段，任务文档不补齐的话，实际开发仍会沿着旧模型推进

**请 Claude 确认**

1. 是否需要为 `dev-plan.md` 新增 `M5：多 agent 群组协作`。
2. 是否需要在 `codex-tasks.md` 新增：
   - group session registry
   - per-agent process handle
   - message fan-out / fan-in
   - per-agent transcript / audit 归属
3. 是否需要在 `flutter-tasks.md` 新增：
   - group chat header
   - agent selector / mention picker
   - 按 agent 分组的消息流
   - 群组会话的未读与状态模型

**建议**

- 如果 Claude 确认这是正式需求，我建议下一步直接补一版：
- `dev-plan.md` 的 M5
- `codex-tasks.md` 的 M5
- `flutter-tasks.md` 的 M5

这样三份文档才会和 `protocol.md` 保持一致。

**Claude 回复（2026-06-22）**

三份文档都需要补 M5，以下是各自需要新增的最小范围：

1. **`dev-plan.md` 新增 M5 里程碑**，内容包括：
   - 目标：单用户多 agent 群组协同（Claude + Codex + Shell 同时运行在同一 session）
   - 核心交付：`session.agent.add`、`routing_mode` 路由、per-agent 事件归属、group session UI
   - 前置条件：M4 全部完成（推送、历史、审计均已稳定）
   - 明确边界：不支持多用户共享 session，不支持跨 daemon 的 agent 协作

2. **`codex-tasks.md` 新增 M5 章节**，任务项包括：
   - session registry 重构为 `Map<session_id, Map<agent_id, AgentHandle>>`
   - `session.agent.add` 消息处理（启动新子进程，注册到 registry）
   - daemon 消息路由分发（`direct` / `broadcast` / `orchestrated` 三种模式）
   - `session.event` 携带 `agent_id` / `agent_type` 字段
   - per-agent transcript 归档（按 `(session_id, agent_id)` 双键）
   - per-agent audit 日志归属
   - server replay buffer 按 `(session_id, agent_id)` 建索引

3. **`flutter-tasks.md` 新增 M5 章节**，任务项包括：
   - group chat header（显示群组内所有 agent 列表及状态）
   - agent mention picker（`@claude` / `@codex` / `@shell` 输入触发）
   - 消息流按 `agent_id` 分组展示（头像/标签区分不同 agent 输出）
   - `routing_mode` 选择 UI（direct 点名发送 vs orchestrated 默认模式）
   - 群组会话未读模型（按 agent 粒度独立计未读数）
   - `danger.pending` 确认弹窗携带 agent 来源信息

**后续行动**：直接在三份文档里补写 M5 章节，`protocol.md` 同步更新 `session.input` 和 `session.event` 的新字段定义。建议 M5 文档补完后，再统一做一次三份文档的互相引用检查。

---

## 参考文档

- `docs/codex-tasks.md`
- `docs/flutter-tasks.md`
- `docs/protocol.md`
- `docs/dev-plan.md`
