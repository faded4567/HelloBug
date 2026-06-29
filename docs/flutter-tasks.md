# HelloBug — Flutter 任务清单

> 本文件只包含 **Claude 负责的整个 Flutter 客户端任务，更新：2026-06-26**。
> 任务完成状态以 `docs/app-remaining-work.md` 为准；本文档主要用于规划与验收。
> 后端与基础设施由 Codex 负责，见 `docs/codex-tasks.md`。
> 协议格式规范见 `docs/protocol.md`。
> Claude 如需快速获取真实现状，请先读 `memory/claude-current.md` 与 `memory/shared/flutter-status.md`；本文档不保证每个里程碑描述都和当前代码完全同步。

## 进度总览

| 里程碑 | 状态 | 说明 |
|---|---|---|
| **Spike F1** E2EE 跨端互通 | ⬜ 未完成 | 阻塞：需 Node 端输出跨端 fixture，`noise_ik` / `session_cipher` 仍为占位 |
| **Spike F2** iOS 后台保活验证 | ⬜ 未开始 | 可与 F1 并行启动；完整验证依赖 F1 完成（加密回放链路） |
| **Spike F3** Diff 渲染可行性 | ⚠️ 已有 Demo，结论未冻结 | `screens/diff_spike/` 与 `screens/diff/` 已存在，但性能结论和最终路径未正式收口 |
| **Spike F4** TLS Pinning + JWT 重连 | ⚠️ IO 侧已接入，完整验证未完成 | Flutter IO 已接入 TOFU + pin 持久化、`auth.attach` replay 恢复、`auth.refresh` 定时续期，以及 `DEVICE_REVOKED` / `auth.attach|auth.refresh -> AUTH_INVALID` 的 runtime reset；Web 端受浏览器限制仍无原生 pinning |
| **M1** 安全骨架 | ⚠️ UI 骨架已深度落地，运行时未闭环 | crypto 仍有 stub；pairing 已部分联调但未闭环；`wsClientProvider` 仍默认 `null` 但 bootstrap / pairing 已能注入真实 client；unlock / devices 仍有未接线处 |
| **M2** 聊天闭环 | ⚠️ 第一版页面与 Provider 已存在，未形成真实闭环 | sessions / new-session / chat / history / danger rules / workspace switch 等已在代码中，但大多仍缺真实 transport 接线 |
| **M3** Diff + 文件树 | ⚠️ 第一版实现已存在，大文件与状态能力未收口 | diff、file tree、file preview 已有代码，文件预览正式协议已对齐，剩余主要是大文件/二进制/权限态 |
| **M4** 多并发 + 输入增强 + 推送 | ⚠️ 部分模块已落地，后半段仍未开始 | terminal、image input、voice input、slash palette、security、notifications、device detail、appearance、about 已存在；push wiring 与 multi-tab 仍未完成 |

## 现状说明（2026-06-24）

- 本文档仍是 **Flutter 侧任务规划与验收文档**，但当前 `app/` 代码已经明显超前于其中不少“M2/M3/M4 未开始”的描述。
- 当前最需要 Claude 理解的不是“哪些页面还没写”，而是“哪些页面已经有了第一版 UI / 本地逻辑，但还没有真正接上运行时链路”。
- Claude 当前负责的是整个 Flutter 客户端，不只是页面层；因此这里的重点同时包含 `state / transport / crypto / bootstrap / router`。
- 核心阻塞不是 UI 数量，而是：
  1. `wsClientProvider` 默认仍为 `null`，但 `bootstrap()` 与配对成功后都已能注入真实 `WsClient`
  2. 前台 transport lifecycle observer 已接上，但 local auth 生命周期、Web 侧 pinning、超时重锁规则仍未收口
  3. 配对流程已部分打通，server pin 持久化与 `device.push_token` 自动上报已补上，但仍缺真实平台推送接线与更完整的 E2EE 收口
  4. app 与 server / daemon 当前更主要的边界问题是安全链路未完成、模板仍未切到真实后端来源，以及 `session.agent.add` 还没有真正的多 agent runtime

---

## 后续工作执行顺序

```
当前优先收口：
  ├── Spike F1（E2EE 跨端互通）
  ├── M1 运行时接线：真实 WsClient 注入、bootstrap 初始化、pairing 联调
  ├── App 与 daemon 对接面：`slash.list` 错误态 / `templates.list` 本地覆盖语义 / `session.agent.add` / 真实平台 push token 接入
  ├── 现有页面接活：devices / danger.pending 状态收口 / file preview 补态 / history / reconnect
  └── Spike F4（pinning + JWT 恢复）

完成以上收口后：
  ├── 把已存在的 M2 页面和 Provider 接成真实闭环
  ├── 结束 Spike F3 结论，并把已存在的 diff / filetree 实现收口到 M3 标准
  └── 再进入 M4 后半段（voice / push / security / device detail / multi-tab）
```

> **Spike F4 现状**：Flutter IO 已切到“首次连接记住证书（TOFU）+ 后续严格校验”的开发态方案；若后续需要生产化轮换，还要再补多 pin / 证书轮换策略与 Web 端约束说明。

---

## 前置 Spike（开始其他工作前必须完成）

这几个 spike 的结论会直接影响 Flutter 侧的加密、连接、推送和渲染实现路径，必须优先跑通。

### ⬜ Spike F1：E2EE 跨端互通（Flutter 侧，1-2 天）
**目标**：Flutter 端与 Node 端完成一次 Noise IK 握手，并成功加解密一条消息。

- Flutter 端：`cryptography` + `flutter_secure_storage`
- Node 端对齐目标：`libsodium-wrappers`
- 验证项：
  - X25519 / Curve25519 共享密钥结果一致
  - HKDF 派生顺序、salt / info、send_key / recv_key 对齐
  - AEAD 算法、tag 长度、base64 编码一致
  - nonce 计数器递增规则、初始值与溢出策略一致
- 产出：`app/test/fixtures/e2ee_vectors/` 下的 fixture，包含公钥、握手输入、期望密文、期望明文

### ⬜ Spike F2：iOS 后台 WebSocket 保活验证（1-2 天）
> **未开始原因**：可与 Spike F1 并行推进；但最终"后台锁屏 → 推送唤醒 → 带密文回放"链路依赖 Spike F1 完成（E2EE 通道稳定）才能完整验证。前半段（前台/后台切换、`last_seq` 重放）可先跑，加密部分留 F1 后补。

**目标**：确认 iPhone 锁屏 30 分钟后，推送唤醒与会话重放链路是否可靠。

- Flutter 端：`flutter_apns_only` + `AppLifecycleState` + `last_seq` 重放
- 验证项：
  - 前台连 WebSocket，切后台并锁屏 30 分钟
  - 期间 daemon 继续输出，服务器写入环形缓冲
  - 收到推送后进入 App，是否能靠 `last_seq` 拉齐缺失消息
  - 未点开推送、纯手动回前台时，重放是否完整
- 产出：一份 iOS 后台行为记录表，明确哪些场景必须依赖推送而不是保活

### ⬜ Spike F3：Flutter 端 diff 渲染可行性（1 天）
> **未开始原因**：与其他 Spike 完全独立，可随时启动。M3 开工前必须完成，建议在 M2 开发期间穿插进行。

**目标**：确认窄屏手机上自写 diff 视图的可读性，避免过早押注第三方 diff 包。

- Flutter 端：`CustomScrollView` + `flutter_highlight` + 自写行 gutter
- 验证项：
  - 390pt 宽屏幕下长行 diff 是否可横向滚动阅读
  - 统一视图与分栏视图在 2000 行 diff 下是否流畅
  - 行号、增删色块、hunk 导航在深色主题下是否清晰
- 产出：一个静态 demo 页面，确认移动端最终走自写渲染而非桌面 diff 组件

### ⬜ Spike F4：TLS Pinning + JWT 重连恢复（1-2 天）
> **现状说明**：Flutter IO 已接上 `PinnedHttpClient`、证书观察与 pin 持久化，`auth.attach` / `auth.refresh` / `session.resume` 也已具备基础闭环；剩余主要是完整集成验证、生产化轮换策略和 Web 侧能力边界收口。
**目标**：验证服务器证书 pin、JWT 续期和恢复连接的完整路径。

- Flutter 端：`dio` + `http_certificate_pinning` + `SecurityContext`
- 验证项：
  - pin 过的 `HttpClient` / WebSocket 自定义 client 可稳定连接 server
  - JWT 过期或连接恢复后，`auth.attach` / `auth.refresh` 流程正确
  - 续期成功后自动恢复 `dio` 请求与 WebSocket 连接
  - pin 新旧两把公钥时，证书轮换不中断
- 产出：一套 server pin + JWT 存储与恢复策略，供 M1 / M4 共用；以及一个可重现的集成测试，模拟"连接断开 / JWT 临期 → 续期或重新挂载 → 恢复 WebSocket 连接"全流程

---

## M1：安全骨架（约 5-7 天）

### ✅ 1.1 Flutter 工程骨架与 `pubspec`
> **现状补充**：工程骨架、路由、主题、模型与依赖已经落地；`bootstrap.dart` 已能恢复持久化 runtime、安装 `WsClient` 并自动连接，但仍未串起本地生物识别生命周期、证书 pin 与 transport lifecycle observer。

```
app/
├── lib/
│   ├── main.dart
│   ├── bootstrap.dart
│   ├── app.dart
│   ├── theme/
│   ├── transport/
│   ├── crypto/
│   ├── state/
│   ├── models/
│   ├── screens/
│   └── widgets/
├── test/
├── integration_test/
├── analysis_options.yaml
└── pubspec.yaml
```

- `app/pubspec.yaml`：固定 Flutter 3.27+ / Dart 3.7+ 约束，补齐 `freezed`、`Riverpod`、加密、推送、终端、diff 等核心依赖
- `app/lib/main.dart`：只负责 `WidgetsFlutterBinding.ensureInitialized()`、错误上报入口、调用 `bootstrap()`
- `app/lib/bootstrap.dart`：初始化 `flutter_secure_storage`、本地生物识别、证书 pin、日志、根 ProviderScope
- `app/lib/app.dart`：实现根 `CupertinoApp.router`，统一路由表、深浅主题，并通过 `GoRouter` 壳接出根导航
- `app/lib/models/`：建立 `Envelope`、`Payload`、`SessionEvent`、`DeviceSummary` 等 `freezed` 模型与 `json_serializable` 代码生成链路
- `analysis_options.yaml`：打开严格 lint，禁止 UI 层直接拼协议 JSON，要求经 model / mapper 统一转换

### ✅ 1.2 `app/lib/theme/` — 主题系统

文件结构：
```
app/lib/theme/
  tokens.dart
  typography.dart
  app_theme.dart
  code_theme.dart
  theme_controller.dart
```

具体要实现：
- `tokens.dart`：统一维护颜色、间距、圆角、边框、阴影、导航高度、消息泡 padding 等 design tokens
- `typography.dart`：正文、标题、caption、代码字体全部集中定义；代码字体优先 `JetBrains Mono / SF Mono`，字号只允许 13 / 14 / 15 三档
- `app_theme.dart`：输出深色和浅色两套 `CupertinoThemeData`，默认深色，跟随系统切换
- `code_theme.dart`：为 `flutter_highlight` 单独定义深浅代码高亮色，不直接复用正文主题
- `theme_controller.dart`：用 Riverpod 暴露 `themeMode`、`codeFontScale`、`diffViewMode` 等可持久化设置
- Android 侧仍以 `Cupertino` 为主，不额外做一套 `Material` UI；Material 仅用于必须的宿主能力桥接
- 根级导航当前已切到 2-tab 方向，视觉上以 `工作区 | 设置` 为准；但当前第一 branch 仍挂在 `/sessions`，真正的工作区主页语义还未完全落地
- 根级导航的色彩和选中态也由 token 控制，不允许各页各自定义

### ✅ 1.3 `app/lib/transport/` — WebSocket 网络层骨架
> **现状补充**：`WsClient`、reconnect、`auth.attach`、`last_seq` bookkeeping 等骨架都已存在；`PinnedHttpClient` 仍为占位实现，`wsClientProvider` 仍默认返回 `null`，但应用已经有两条真实 client 注入路径：`bootstrap()` 恢复已持久化 runtime，以及配对成功后直接安装 live client。

文件结构：
```
app/lib/transport/
  ws_client.dart
  framed_codec.dart
  heartbeat.dart
  reconnect_policy.dart
  connection_state.dart
  pinned_http_client.dart
```

具体要实现：
- `ws_client.dart`：只连接云服务器，不直连 daemon；对外暴露 `connect()`、`disconnect()`、`sendMessage()`、`stream`
- `framed_codec.dart`：实现 NDJSON 编解码，确保每条 WebSocket 文本帧可拆成多行协议消息
- `heartbeat.dart`：实现 ping / pong 心跳，30 秒主动保活，60 秒未响应判定断线
- `reconnect_policy.dart`：指数退避重连（1s → 2s → 4s → 8s → 30s 上限），支持网络恢复后立即重试
- `connection_state.dart`：对 UI 暴露 `connecting / online / replaying / offline / authExpired` 等状态
- `pinned_http_client.dart`：统一管理 pin 过的 `HttpClient`，供 `dio` 与 `IOWebSocketChannel` 共用
- 断线后要保留每个 `session_id` 的 `last_seq`，重连成功后自动请求回放缺失消息
- 网络层必须能区分“服务器在线但 daemon 离线”和“App 自己离线”两类状态，避免 UI 误导

### ⚠️ 1.4 `app/lib/crypto/` — E2EE 客户端与密钥存储
> **未完成项**：`noise_ik.dart` 和 `session_cipher.dart` 为 Spike F1 占位符，抛 `UnimplementedError`。Spike F1 fixture 核对完成后实现。其余文件（`keys.dart`、`secure_store.dart`、`nonce_counter.dart`、`envelope_signer.dart`）已完成。

文件结构：
```
app/lib/crypto/
  keys.dart
  secure_store.dart
  noise_ik.dart
  session_cipher.dart
  nonce_counter.dart
  envelope_signer.dart
```

具体要实现：
- `keys.dart`：生成 Ed25519 身份密钥与 X25519 会话协商密钥
- `secure_store.dart`：将私钥、JWT、server pin 材料、已配对设备指纹存入 `flutter_secure_storage`
- `noise_ik.dart`：实现 Noise IK initiator 侧逻辑，输入 daemon 公钥，输出会话级 `sendKey` / `recvKey`
- `session_cipher.dart`：用 `ChaCha20-Poly1305` 完成加解密；不能把密钥或明文打到日志
- `nonce_counter.dart`：维护与 Node 端完全一致的 nonce 递增规则，支持每 100 条消息或 10 分钟轮换会话密钥
- `envelope_signer.dart`：对路由层关键字段做 Ed25519 签名，避免中继篡改
- 注意事项：
  - iOS Keychain / Android Keystore 不可用时要给出明确错误，而不是静默降级到明文存储
  - 私钥只允许在解锁状态下取用；锁屏态不应自动签发危险操作确认
  - server pin 材料、App JWT 与 E2EE 密钥是三类资产，存储与轮换要分别建模

### ✅ 1.5 `app/lib/screens/onboarding/` — 引导页（三屏）

- `onboarding_intro_page.dart`：介绍“手机远程操控本地 agent”的核心场景
- `onboarding_security_page.dart`：解释双层加密、SAS 核对、生物识别解锁，不要只写营销文案
- `onboarding_capabilities_page.dart`：展示聊天、diff、文件树、终端四类能力
- `onboarding_flow.dart`：承载三页滑动、页码指示器、跳过与开始配对 CTA
- 视觉要求：
  - 继续使用 `CupertinoPageScaffold`
  - 深色默认，避免大面积纯黑；用 token 管理卡片背景和渐变
  - 文案要和真实能力对齐，不提前承诺未做完的多人协作或云端持久化

### ⚠️ 1.6 `app/lib/screens/pairing/` — 配对页（扫码 + 手动）与 SAS 核对页
> **现状补充**：配对页骨架已齐，且 `pairing_controller.dart` 已经会发送 `device.pair`、等待 `device.pair.sas`、发送 `device.pair.confirm`、等待 `auth.token`、持久化 runtime 并安装 live `WsClient`。App runtime 现在也会在 pairing 成功装载 live client 后，或后续收到 `auth.token` 时，自动上报当前本地 `device.push_token`。未完成项主要是真实平台 token 初始化、设备元数据持久化与更广泛的 E2EE 收口。另：`manual_pair_page.dart` 当前仍是命名/职责错位的占位页，真实手输流程已内嵌在 `pairing_entry_page.dart`。

文件结构：
```
app/lib/screens/pairing/
  pairing_entry_page.dart
  qr_scan_page.dart
  manual_pair_page.dart
  sas_verify_page.dart
  pairing_controller.dart
```

具体要实现：
- `pairing_entry_page.dart`：提供“扫码”与“手动输入”两个入口
- `qr_scan_page.dart`：用 `mobile_scanner` 扫 daemon 输出的二维码或配对链接
- `manual_pair_page.dart`：输入配对码、服务器地址、可选高级选项；有效期文案需跟随 daemon 当前配置，避免硬编码
- `sas_verify_page.dart`：显示 5 个 emoji / 5 个词的 SAS，明确“不一致立即取消”
- `pairing_controller.dart`：串起 `device.pair`、`device.pair.sas`、`device.pair.confirm`、`auth.token`、pin 保存、E2EE 握手；`device.push_token` 改由 app runtime 在 pairing/auth 成功后自动上报
- 错误态必须完整：
  - 配对码过期
  - 服务器证书 pin 不匹配
  - SAS 校验失败
  - 设备已被吊销
- 配对成功后要把设备别名、服务器地址、公钥指纹持久化，供设备列表页显示
- 配对完成后立即向服务器上报推送注册信息：iOS 上报 `apns_token`，Android 上报 `manufacturer`（Xiaomi / OPPO / vivo / Other）和对应的厂商推送 token；服务器依赖这两个字段路由推送，必须在首次配对时完成，不能延迟到 M4

### ⚠️ 1.7 `app/lib/screens/unlock/` — 启动锁屏页与生命周期锁
> **现状补充**：`UnlockPage`、`UnlockController`、`UnlockGate` 都已存在，`HelloBugApp` 也已经接上前台 `TransportLifecycleObserver`；但当前 app 仍默认从“已解锁”状态启动，旧的“后台超过 5 分钟重新上锁”链路当前保持关闭，若要恢复需重新定义真实规则。

- `unlock_gate.dart`：应用启动时统一拦截，未解锁前不进入 Tab 主界面
- `unlock_page.dart`：展示 Face ID / 指纹解锁按钮和失败态
- `unlock_controller.dart`：管理“后台超过 5 分钟重新上锁”的规则
- `app_lifecycle_observer.dart`：在 `paused` / `resumed` 时记录时间戳，回前台时判断是否强制解锁
- 细节要求：
  - 切后台后立即给敏感界面加模糊遮罩
  - 生物识别失败时允许密码兜底，但不允许直接绕过
  - 解锁成功后恢复上一页状态，不清空当前会话草稿

### ⚠️ 1.8 `app/lib/screens/devices/` — 设备列表页与根 Tab 壳
> **现状补充**：`devices_provider.dart` 现在已经会拉 `device.list`、持续消费 `device.status`，`devices_page.dart` / `device_detail_page.dart` 也已接上 `device.rename`、`device.revoke(mode=unlink|revoke)`、真实 `daemon_version / paired_at / last_seen_at`、本地会话数与 daemon 返回的工作区列表。当前缺口主要剩设备页刷新 affordance、失败视觉、更多多设备语义与已吊销态的最终收口。

- `devices_page.dart`：显示已绑定设备、在线/离线、系统版本、活跃会话数、最近在线时间
- `device_card.dart`：设备卡片样式统一，在线状态与颜色来自 token，不在业务层硬编码
- `root_tab_scaffold.dart`：根导航壳；当前已切成 2 个 tab，但第一 branch 仍暂时承载 `SessionsPage`
- `devices_provider.dart`：拉取设备状态，订阅 `device.status` 变化并驱动 UI
- 交互要求：
  - 支持下拉刷新
  - 离线设备显示最近在线时间
  - 右滑解绑或进入详情页的入口留好位置
  - 没有设备时给出重新配对 CTA，而不是空白页
  - 设备详情页中的“重命名 / 解绑 / 吊销”分别对接 `device.rename`、`device.revoke(mode=unlink)`、`device.revoke(mode=revoke)`

---

## M2：聊天闭环（约 5-7 天）⚠️ 第一版代码已落地，未形成真实闭环

> **现状说明**：M2 的多数页面、widgets 与 providers 已经存在于 `app/lib/` 中，不应再按“从零开始”理解；当前工作重点是把它们接上真实 transport、补协议对齐、补全全局交互链路。

### ⚠️ 2.1 `app/lib/state/` — 会话领域模型与 Riverpod Provider
> **现状补充**：`sessions_provider.dart`、`chat_provider.dart`、`devices_provider.dart`、`drafts_provider.dart`、`settings_provider.dart` 已存在；`chat_item.dart`、`danger_request.dart`、`template_summary.dart` 也已创建。当前主要缺口是 provider 仍缺少真实 `WsClient` 来源、持久化与更完整的事件建模。

文件结构：
```
app/lib/state/
  devices_provider.dart
  sessions_provider.dart
  chat_provider.dart
  drafts_provider.dart
  settings_provider.dart
```

具体要实现：
- `sessions_provider.dart`：管理会话列表、未读数、进行中状态、最近消息预览
- `chat_provider.dart`：按 `session_id` 聚合 `session.event`，把协议事件映射成 UI 消息模型
- `drafts_provider.dart`：保存每个会话的输入草稿、滚动锚点、最近使用模板
- `settings_provider.dart`：统一暴露通知、外观、危险规则、本地锁等开关
- `models/` 需要新增：
  - `chat_item.dart`
  - `tool_use_item.dart`
  - `tool_result_item.dart`
  - `danger_request.dart`
  - `template_summary.dart`
- 要求：
  - 流式 `assistant.delta` 必须增量拼接，不能每个 token 新建一个气泡
  - `assistant.thinking` 与 `tool.use` 要保留原始事件结构，方便后续跳转与调试

### ⚠️ 2.2 `app/lib/screens/sessions/` — 会话列表页
> **现状补充**：`SessionsPage` 与 `SessionTile` 已存在，可显示空态、未读数与进入聊天页；搜索页、过滤能力与真实后台更新链路仍未完成。

- `sessions_page.dart`：显示进行中与最近会话，两类信息流可混排但视觉上要区分
- `session_tile.dart`：每项包含项目名、agent 类型、最后一条摘要、未读点、进行中标记
- `sessions_search_page.dart`：预留搜索和过滤入口，支持按工作区或 agent 类型过滤
- 会话列表要支持：
  - 断线状态横幅
  - 空态引导去“新建会话”
  - 最近查看的置顶
  - 后台会话继续流式更新未读数

### ⚠️ 2.3 `app/lib/screens/new_session/` — 新建会话向导（三步）
> **现状补充**：`new_session_flow.dart` 已实现三步设备 / 工作区 / agent 选择，并会 optimistic 创建本地会话后发送正式 `session.start`；dev stub device 兜底已经去掉，剩余主要是更完整的确认项、失败处理与恢复语义。

文件结构：
```
app/lib/screens/new_session/
  new_session_flow.dart
  select_device_step.dart
  select_workspace_step.dart
  select_agent_step.dart
  confirm_options_step.dart
```

具体要实现：
- Step 1：选设备，展示在线状态与默认工作区
- Step 2：选工作区，优先展示最近使用与置顶项
- Step 3：选 agent（`claude_code` / `codex` / `shell`）
- `confirm_options_step.dart`：展示模板、危险规则摘要、是否恢复历史会话等附加选项
- 点击创建后发送 `session.start`，成功即进入聊天主页
- 注意事项：
  - 新建会话过程中如果设备离线，要明确提示而不是静默失败
  - 如果协议最终把工作区选择拆为单独消息，向导层要可兼容，不把协议细节写死在 widget 内

### ⚠️ 2.4 `app/lib/screens/chat/` — 聊天主页骨架
> **现状补充**：`ChatPage`、`ChatTimeline`、`ChatInputBar`、`ChatHeader`、`ChatStatusBanner` 均已存在，并能消费第一版 provider；全局 `danger.pending` 与图片 / 语音入口已经接通，且 `session.done / session_not_found / replaying / 断线` 下的基础 banner 与输入 gating 已补一轮，剩余主要是更完整的状态页、恢复语义和更多正式数据源对齐。

文件结构：
```
app/lib/screens/chat/
  chat_page.dart
  chat_header.dart
  chat_timeline.dart
  chat_input_bar.dart
  chat_status_banner.dart
```

具体要实现：
- `chat_page.dart`：会话主页容器，负责订阅指定 `session_id`
- `chat_header.dart`：顶部显示工作区、agent 名、操作菜单（取消、清屏、导出预留）
- `chat_timeline.dart`：消息流容器，支持流式更新、自动滚底、用户手动滚动后暂停自动跟随
- `chat_status_banner.dart`：显示“重连中… / daemon 离线 / 回放中…”等状态
- `chat_input_bar.dart`：承载文本输入、多行自适应、发送按钮、模板栏、图像/语音/斜杠入口占位
- 关键行为：
  - 用户消息先本地 optimistic echo，再等待服务端事件回填状态
  - `session.cancel` 能从 header 或输入栏快捷触发
  - `session.done` 到达后正确收口“处理中”状态，不遗留 loading

### ⚠️ 2.5 `app/lib/widgets/` — 消息泡与折叠卡片
> **现状补充**：`message_bubble.dart`、`tool_use_card.dart`、`tool_result_card.dart`、`thinking_card.dart`、`diff_card.dart` 已存在；`message_actions_sheet.dart` 尚未实现，折叠状态持久化也还不完整。

文件结构：
```
app/lib/widgets/
  message_bubble.dart
  tool_use_card.dart
  tool_result_card.dart
  thinking_card.dart
  diff_card.dart
  message_actions_sheet.dart
```

具体要实现：
- `message_bubble.dart`：用户与 assistant 气泡，支持流式文本逐字增长
- `tool_use_card.dart`：默认折叠，标题如 `Read main.py`、`Bash git status`
- `tool_result_card.dart`：长输出自动折叠，可展开查看全文
- `thinking_card.dart`：默认折叠，灰阶弱化，但保留展开入口
- `diff_card.dart`：聊天内展示 `file.changed` 缩略卡，显示文件路径与 ± 行数
- `message_actions_sheet.dart`：长按操作，支持复制、引用、跳转 diff、查看原始事件
- 注意事项：
  - 所有折叠态都要持久到 provider，不要因为列表重建而丢失展开状态
  - `tool_input` / `tool_result` 可能很大，卡片内必须有截断和懒展开机制

### ⚠️ 2.6 输入栏、模板芯片与消息发送流
> **现状补充**：`chat_input_bar.dart`、`template_chip_bar.dart`、`slash_palette/` 已存在，文本发送、斜杠命令发送与 optimistic echo 已有第一版逻辑；Flutter 模板列表与输入栏芯片已经接到 `templates.list`，并支持本地 override / delete 持久化，slash 也已补第一轮超时 / 错误 / 重试。剩余主要是模板最终存储归属和更完整的 slash 参数 UI。

- `template_chip_bar.dart`：横向滚动模板芯片，至少支持 `git status`、`跑测试`、`看最近 5 个 commit`
- `chat_input_controller.dart`：管理草稿、发送态、禁用态、多行高度
- 文本发送统一走 `session.input`
- 发送失败时保留草稿与重试按钮，不自动清空输入
- 模板点击后先插入输入框，由用户确认再发，不要直接无提示发送
- 后续 M4 的图片、语音、斜杠入口在这里扩展，M2 先把插槽和布局留好

### ⚠️ 2.7 `app/lib/widgets/danger_confirm/` 与 `workspace_switch/`
> **现状补充**：`danger_confirm_sheet.dart`、`workspace_switch_sheet.dart` 与工作区历史持久化都已存在；`danger.pending` 现在已经有全局监听并能自动弹出确认框。工作区切换 sheet 现已优先使用 `workspace.list`，并会对手输路径与本地历史路径调用 `workspace.resolve` 做预检；剩余主要是与聊天 / 文件树 / 分支上下文的更深联动，以及工作区主页体系的最终收口。

文件结构：
```
app/lib/widgets/danger_confirm/
  danger_confirm_sheet.dart
  danger_countdown.dart
  danger_auth_button.dart

app/lib/widgets/workspace_switch/
  workspace_switch_sheet.dart
  workspace_list_tile.dart
```

具体要实现：
- `danger_confirm_sheet.dart`：展示危险命令、命中规则、工作区、倒计时
- `danger_auth_button.dart`：点击后走 `local_auth`，成功才允许发 `danger.allow`
- 失败、取消或超时统一发 `danger.deny`
- `workspace_switch_sheet.dart`：从聊天页切换工作区，展示当前分支、最近使用、置顶项
- 注意事项：
  - `danger.pending` 到来时要能从任何前台页弹出，不要求用户先回聊天页
  - 超时 60 秒自动拒绝的 UI 反馈要明显，不能用户以为还在等待
  - 手输路径前可先调 `workspace.resolve` 做预检；工作区列表页和切换 sheet 应优先使用 `workspace.list`

### ⚠️ 2.8 `app/lib/screens/settings/danger_rules_page.dart` — 危险规则设置页
> **现状补充**：页面、增删改 UI 与正则基础校验已存在；当前规则仍主要存于 app 侧内存 settings state，尚未完成持久化深度与 daemon 侧同步约定。

- `danger_rules_page.dart`：黑白名单列表页
- `danger_rule_form_sheet.dart`：新建 / 编辑规则，支持 pattern、mode、desc
- `danger_rule_preview.dart`：用样例命令展示规则命中效果，避免正则误配
- 需要支持：
  - 新增、编辑、删除、启用、禁用
  - 默认规则与自定义规则分组显示
  - 不允许保存明显非法的正则
- 页面文案要强调：规则实际执行在 daemon 侧，Flutter 只负责管理与确认

### ⚠️ 2.9 `app/lib/screens/history/` — 历史 Transcript 浏览
> **现状补充**：`HistoryListPage` 与 `HistoryDetailPage` 已存在，并具备 `history.list` / `history.get` 的分页读取第一版逻辑；历史页“继续会话”入口已接通到 `session.start + resume_session_id`，会话恢复第一轮状态也已接到 `replaying / session_not_found`，`SESSION_NOT_FOUND / WORKSPACE_FORBIDDEN` 也已有基础错误承接，但专门的 controller 分层与更完整的恢复策略仍未收口。

文件结构：
```
app/lib/screens/history/
  history_list_page.dart
  history_detail_page.dart
  history_controller.dart
```

具体要实现：
- `history_controller.dart`：发送 `history.list` 拉取当前工作区的 transcript 文件列表，按 mtime 倒序
- `history_list_page.dart`：展示 transcript 摘要（创建时间、消息条数、工作区路径），点击进入详情
- `history_detail_page.dart`：通过 `history.get`（分页，每次 100 条）加载历史消息，渲染成与聊天主页相同的消息样式
- 关键注意事项：
  - 历史 transcript 是只读的，不允许在历史页触发新的 `session.input`
  - 历史页支持从某条会话"继续"（发 `session.start` 附带 `--resume session_id`），跳到新建的聊天页
  - 分页加载时滚动位置不能因新数据插入而跳动

---

## M3：Diff + 文件树（约 5-7 天）⚠️ 第一版代码已存在，需继续收口

> **现状说明**：`app/lib/diff/`、`screens/diff/`、`screens/diff_spike/`、`screens/filetree/` 已经不是空白目录；当前重点是把现有实现和 Spike F3 结论、后端协议、超大文件体验收敛一致。

### ⚠️ 3.1 `app/lib/screens/diff/` — Diff 全屏页
> **现状补充**：`DiffPage`、diff parser、统一/分栏视图与 hunk 跳转第一版都已存在；但专门 controller / navigator 分层尚未独立，F3 的正式结论也还没有冻结。

文件结构：
```
app/lib/screens/diff/
  diff_page.dart
  diff_controller.dart
  diff_parser.dart
  unified_diff_view.dart
  split_diff_view.dart
  hunk_navigator.dart
```

具体要实现：
- `diff_parser.dart`：把 unified diff string 解析成 hunk / line view model
- `diff_page.dart`：承载统一/分栏切换、文件标题、字号控制、hunk 跳转
- `unified_diff_view.dart`：单栏模式，保留行号、增删背景色、横向滚动
- `split_diff_view.dart`：分栏模式，在窄屏上允许左右滑动而不是强行压缩
- `hunk_navigator.dart`：底部或浮层展示上一处 / 下一处导航
- `flutter_highlight` 只用于代码内容高亮；行号、gutter、背景色必须自绘
- 注意事项：
  - 长行默认横向滚动，不自动软换行破坏 diff 对齐
  - 深色主题下增删颜色要对比清楚，但不能刺眼
  - 空白行、仅改缩进、无换行符结尾等边界要正确显示

### ⚠️ 3.2 `app/lib/widgets/diff_card.dart` — 聊天内 diff 内联卡片
> **现状补充**：`diff_card.dart` 已存在并可在聊天流中展示；后续主要是与真实 `file.changed` 数据、全屏 diff 跳转和多文件改动样式继续收口。

- 卡片信息至少包含：`file_path`、新增行数、删除行数、首个 hunk 摘要
- 点击进入 `diff_page.dart`
- 卡片在消息流中默认紧凑，不抢正文视觉焦点
- 如果同一轮修改多个文件，卡片样式要支持连续列表展示
- 与 `session.event` 的 `file.changed` 字段严格对齐，不自己猜 diff

### ⚠️ 3.3 `app/lib/screens/filetree/` — 文件树页
> **现状补充**：`FileTreePage`、`FileTreeController`、`TreeNodeTile`、`TreeCache` 均已存在，支持第一版懒加载与展开，且 `SESSION_NOT_FOUND / WORKSPACE_FORBIDDEN` 已有基础错误承接；会话信息页现在已有文件树入口，打开文件树 / 文件预览时也会同步当前工作区。完整工作区上下文联动、权限细分态与缓存语义仍未完成。

文件结构：
```
app/lib/screens/filetree/
  file_tree_page.dart
  file_tree_controller.dart
  tree_node_tile.dart
  tree_cache.dart
```

具体要实现：
- `file_tree_page.dart`：工作区目录树主页
- `file_tree_controller.dart`：发 `fs.tree.req`，维护按目录懒加载的缓存
- `tree_node_tile.dart`：支持文件夹展开、文件点击、修改橙标、加载中骨架
- `tree_cache.dart`：缓存已展开目录，避免来回切换频繁重复请求
- 要求：
  - `.git/`、`node_modules/` 等后端已过滤的情况下，前端仍要容忍异常返回
  - 目录展开状态在横竖屏切换时保持
  - 修改文件用橙色点或标记，不要用整行强色块压住层级结构

### ⚠️ 3.4 `app/lib/screens/filetree/file_preview_page.dart` — 单文件只读预览
> **现状补充**：`file_preview_page.dart` 已存在并能做第一版分片拼装，且已切到正式 `fs.file.req` + `data/data_base64url`，`SESSION_NOT_FOUND / WORKSPACE_FORBIDDEN` 也已分流到结构化错误态；当前剩余主要是高亮、虚拟滚动，以及 `large-file / binary / permission` 等状态补口。

- `file_preview_page.dart`：只读内容页，支持代码高亮和文本类文件预览
- `chunked_file_controller.dart`：处理 `fs.file` 分片拼装、base64 解码、大文件分段加载
- `virtual_code_view.dart`：为 >1MB 文件做虚拟滚动，避免一次构建全量行 widget
- 关键技术点：
  - 根据 MIME 类型决定是否高亮或纯文本显示
  - 大文件滚动位置要稳定，不因后续 chunk 到达而跳动
  - 内容只读，不开放编辑入口，避免越过项目边界

### ⚠️ 3.5 工作区切换与聊天 / 文件树联动补全
> **现状补充**：工作区切换 sheet 与 `workspace_history_provider.dart` 已存在，并且最近 / 置顶历史与 `currentPath` 都可持久化；切换 sheet 现已接到 `workspace.list / workspace.resolve`，聊天页选择其他工作区后会保留旧会话并带新路径进入 `NewSessionFlow`，历史页也会优先读取当前工作区，文件树 / 文件预览 / diff / 终端打开时也会回写当前工作区。文件树、Diff、分支上下文之间的完整联动仍是半成品。

- 把 M2 的 `workspace_switch_sheet.dart` 扩展成完整工作区上下文入口
- 聊天页、文件树页、Diff 页都要感知当前工作区与当前分支
- 切换工作区时要保留旧会话在后台，不要清空 session list
- 最近工作区、置顶工作区与最后浏览文件路径需要持久化

---

## M4：多并发 + 输入增强 + 推送（约 7-10 天）⚠️ 前半段部分已落地

> **现状说明**：terminal、image input、voice input、slash palette、security、notifications、device detail、appearance、about 等已经不再是空白；M4 当前更像“前半段已有第一版实现，后半段推送 wiring / 多会话并发 / 若干运行时接线还未收口”。

### ⚠️ 4.1 `app/lib/screens/terminal/` — 终端页
> **现状补充**：`TerminalPage`、`PtySessionController`、`TerminalToolbar` 已存在，并能通过 `pty.input` / `pty.data` 走第一版消息链路；会话恢复后的只读 gating 已接到 `running + online`，但权限拒绝、字号与更多宿主行为仍未收口。

文件结构：
```
app/lib/screens/terminal/
  terminal_page.dart
  terminal_controller.dart
  terminal_toolbar.dart
  terminal_status_bar.dart
```

具体要实现：
- `terminal_page.dart`：集成 `xterm`，渲染 daemon 转发的 `pty.data`
- `terminal_controller.dart`：处理输入、光标、滚动、`pty.resize`
- `terminal_toolbar.dart`：提供 `Esc / Tab / ↑ / ↓ / ← / → / Ctrl / Alt / 粘贴 / 回车`
- `terminal_status_bar.dart`：展示连接状态、字号、当前工作区
- 注意事项：
  - `pty.data` 是 base64 字节流，必须按字节而不是按字符拼接
  - 竖屏优先展示内容，工具栏固定在键盘上方
  - 横屏时尽量减少 chrome，让 terminal 可视区足够大

### ⚠️ 4.2 `app/lib/screens/image_input/` — 图片输入页
> **现状补充**：`image_input_sheet.dart` 与 `image_compress_service.dart` 已存在，可完成选择、压缩与分片发送；但当前是 inline 预览流程，尚未实现独立 preview page，也还未补终止帧等更严格协议细节。

- `image_input_sheet.dart`：相机 / 相册入口
- `image_preview_page.dart`：预览、裁剪、旋转、压缩结果确认
- `image_compress_service.dart`：把图片压到 ≤2MB，再按 64KB 为单位切片，以 `session.input.image`（含 `image_id`、`chunk_index`、`total_chunks`、`data: base64`）逐片发送；全部片发完后发一条 `image_id` 相同的终止帧（`total_chunks` 与 `chunk_index` 相等）通知 daemon 组装
- 关键技术点：
  - 保留 MIME 类型，修正 EXIF 方向
  - 压缩失败或图片过大时要有明确提示
  - 发送前预览必须可取消，不能拍完即自动上行

### ⚠️ 4.3 `app/lib/screens/voice_input/` — 语音输入页
> **现状补充**：`voice_input_sheet.dart` 已接上 `speech_to_text`、基础权限声明、实时转写与 `session.input.voice_text` 发送；当前主要缺口是权限拒绝后的恢复路径、状态抽象拆分和更完整的失败兜底。

- `voice_input_sheet.dart`：按住录音、取消、重试入口
- `speech_session_controller.dart`：封装 `speech_to_text` 的权限、开始、停止、错误恢复
- `waveform_view.dart`：本地录音波形或能量条反馈
- 发送策略：
  - 音频不上传
  - 只把最终转写文本通过 `session.input.voice_text` 发给服务器
  - 如有置信度则一起上送，供后端和 UI 决策
- 注意事项：
  - 部分转写与最终转写要区分显示
  - 权限被拒后要能回到手动输入，不阻塞聊天

### ⚠️ 4.4 `app/lib/widgets/slash_palette/` — 斜杠命令浮动面板
> **现状补充**：`slash_palette.dart` 与 `slash_palette_controller.dart` 已存在，可通过 `slash.list` 拉当前命令集并做筛选 / 插入；更完整的参数 UI 与不同 agent 差异化体验仍待补强。

文件结构：
```
app/lib/widgets/slash_palette/
  slash_palette.dart
  slash_palette_controller.dart
  slash_command_tile.dart
```

具体要实现：
- 输入框检测到 `/` 时拉起浮层
- 通过 `slash.list` 获取当前 agent 支持的命令
- 命令项展示 `name / description / args`，支持筛选与插入
- 选中命令后填入输入框或直接形成 `session.command.slash`
- 注意事项：
  - Claude Code / Codex / shell 的命令集不同，面板不能写死
  - 浮层要兼容软键盘、横屏和外接键盘焦点切换

### ⚠️ 4.5 通知、推送注册与设置页收口
> **现状补充**：`settings_home_page.dart`、`notifications_page.dart`、`security_page.dart`、`appearance_page.dart`、`templates_page.dart`、`danger_rules_page.dart`、`device_detail_page.dart`、`about_page.dart` 都已经有第一版页面；当前缺口主要在推送注册、真实权限状态、真实设备/安全数据源，以及设置页状态机收口。

文件结构：
```
app/lib/screens/settings/
  settings_home_page.dart
  notifications_page.dart
  appearance_page.dart
  templates_page.dart
  danger_rules_page.dart
  security_page.dart
  device_detail_page.dart
  about_page.dart

app/lib/notifications/
  push_service.dart
  push_registration.dart
  android_push_channel.dart
```

具体要实现：
- `notifications_page.dart`：推送开关、静默时段（DND）、通知预览策略
- `push_service.dart`：iOS 用 `flutter_apns_only` 注册 token，上报服务器
- `android_push_channel.dart`：通过 `MethodChannel` 对接厂商推送 SDK
- `appearance_page.dart`：主题、代码字号、Diff 默认视图、是否禁止敏感页截屏
- `templates_page.dart`：模板 CRUD、变量占位符说明、排序
- `about_page.dart`：版本号、构建号、协议版本、开源组件入口
- `security_page.dart`：安全与隐私设置，包含：当前设备公钥指纹展示、历次 SAS 核对记录、生物识别解锁开关、后台超时时长、敏感页截屏开关（Android `FLAG_SECURE`、iOS 模糊遮罩）、越狱/Root 检测状态
- `device_detail_page.dart`：单台设备详情，展示设备名、OS 版本、daemon 版本、首次配对时间、当前证书有效期；提供"重命名"与"立即吊销该设备"操作；吊销需二次确认，成功后立即更新设备列表并跳回
- 注意事项：
  - 推送 payload 只展示高层事件，不泄漏代码或用户输入
  - M2 已实现的 `danger_rules_page.dart` 在 M4 需要归档进完整设置体系

### ⬜ 4.6 多 tab 并发会话 UI 与横屏双栏布局

文件结构：
```
app/lib/screens/sessions/
  session_tabs_page.dart
  session_tab_bar.dart

app/lib/widgets/
  adaptive_split_view.dart
  landscape_scaffold.dart
```

具体要实现：
- `session_tabs_page.dart`：支持多个进行中会话在底部或顶部 tab 间切换
- `session_tab_bar.dart`：显示项目名、agent 类型、未读点、进行中态
- `adaptive_split_view.dart`：横屏下把聊天 + 文件树、聊天 + diff、terminal + 辅助面板做成双栏
- `landscape_scaffold.dart`：统一处理横屏布局、SafeArea、键盘避让
- 注意事项：
  - 多会话后台保活时不能串消息，provider 必须按 `session_id` 隔离
  - 横屏双栏只在会话页、文件树页、终端页打开，避免所有页面都复杂化
  - 旋转屏幕后滚动位置、展开态、输入草稿都要保持

---

## 接口约定（与 Codex 的边界）

Flutter App **只通过 WebSocket 与云服务器通信**，所有消息格式以 `docs/protocol.md` 为准。  
Flutter 不直连 daemon，不直接访问本地文件系统，也不假设 daemon 常驻于某个固定局域网地址。

### Codex 需要为 Flutter 提供的保证

1. 连接建立后，服务器先发送 `server.hello`，其中必须包含 `protocol_version`。
2. 所有 `session.event` 在单个 `session_id` 内按 `seq` 严格递增，Flutter 依赖 `last_seq` 做断线重放。
3. `session.event` 至少稳定包含：
   - `assistant.delta`
   - `assistant.thinking`
   - `tool.use`
   - `tool.result`
   - `file.changed`
   - `session.done`
   - `session.usage`
4. M5 群组会话中，`session.event` 与 `danger.pending` 必须携带 `agent_id` / `agent_type`，Flutter 不自行猜测来源 agent。
5. `file.changed` 必须包含 `file_path` 与 unified diff 字符串。
6. `fs.file` 超过 200KB 时必须分片返回，并附 `chunk_index` / `total_chunks`。
7. `danger.pending` 发出后，若 60 秒内未收到 `danger.allow` / `danger.deny`，后端自动 deny。
8. 系统推送 payload 只含 `session_id` 与 `event_type`，不含明文代码、命令或用户输入；它不是 WebSocket 运行时消息。
9. M4 终端模式下，`pty.data` 必须是 base64 字节流，`pty.resize` 的响应时序需要稳定。

### Flutter 调用的 WebSocket 消息（完整列表见 `docs/protocol.md`）

> **当前代码偏差（待统一，2026-06-24）**：
> - `WsClient` 重放当前已经发送 `session.resume`
> - `slash.list` / `templates.list` 的 daemon 后端已补完；Flutter 模板入口已经接到真实来源，剩余主要是本地覆盖语义与最终存储归属

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
  device.status
  device.pair.sas
  session.event
  danger.pending
  fs.tree / fs.file
  replay.done
  error
```

Flutter 对这些消息的 UI 映射必须固定：
- `assistant.delta` → 流式 assistant 气泡
- `assistant.thinking` → 折叠思考卡片
- `tool.use` → 折叠工具卡
- `tool.result` → 折叠结果卡
- `file.changed` → 聊天内 diff 卡 + 全屏 diff 页跳转
- `danger.pending` → 全局危险确认 bottom sheet
- `device.status` → 设备列表页在线态即时刷新

---

## 测试要求

每个模块需要对应 `flutter_test` / `dart test` / golden test，必要时补 `integration_test`：

| 模块 | 测试重点 |
|---|---|
| `theme/` | token 默认值、深浅切换、代码字号 13-15 档位约束 |
| `crypto/` | 与 Node 端对齐的 E2EE 向量、key rotation、nonce 递增、签名验证 |
| `transport/` | NDJSON 编解码、心跳超时、指数退避重连、`last_seq` 重放 |
| `screens/pairing/` | 配对码过期、SAS 不一致、扫码与手输两条路径 |
| `screens/unlock/` | 启动解锁、后台 5 分钟回前台再锁、失败兜底 |
| `widgets/message_bubble` | 用户 / assistant / tool / thinking / diff 多种消息样式 golden snapshot |
| `screens/chat/` | 流式消息追加、自动滚底、断网横幅、取消会话 |
| `screens/diff/` | unified / split 视图、长行横向滚动、hunk 跳转 |
| `widgets/danger_confirm/` | Face ID 成功 / 失败 / 超时自动拒绝整条流程 |
| `screens/filetree/` | 懒加载目录、修改橙标、超大文件分片拼装 |
| `screens/terminal/` | `pty.data` 字节流渲染、工具栏按键映射、`pty.resize` |
| `screens/image_input/` | 压缩阈值、旋转修正、超大图片失败态 |
| `screens/voice_input/` | 权限拒绝、partial/final transcript 合并、取消录入 |
| `notifications/` | token 注册、开关状态持久化、点击推送恢复到目标会话 |

集成测试：
- M1 完成后：跑一次 Flutter ↔ Node 的 E2EE echo round-trip
- M2 完成后：用录制的 `session.event` fixture 回放完整聊天闭环
- M3 完成后：加载 1MB+ 文件与 2000 行 diff，验证不卡顿且状态稳定
- M4 完成后：同时打开两个会话 tab，确保消息、未读数、终端输入不串台

---

## 依赖清单

```yaml
app/pubspec.yaml 关键依赖:
dependencies:
  web_socket_channel: ^3.0.2
  cryptography: ^2.7.0
  flutter_riverpod: ^2.6.1
  riverpod_annotation: ^2.6.1
  freezed_annotation: ^3.0.0
  json_annotation: ^4.9.0
  mobile_scanner: ^7.0.1
  flutter_secure_storage: ^9.2.4
  local_auth: ^2.3.0
  dio: ^5.8.0+1
  xterm: 4.0.0
  flutter_highlight: 0.7.0
  image_picker: ^1.1.2
  flutter_image_compress: ^2.3.0
  speech_to_text: ^7.0.0
  go_router: ^14.6.3

dev_dependencies:
  build_runner: ^2.4.13
  freezed: ^3.0.0
  json_serializable: ^6.8.0
  riverpod_generator: ^2.6.5
```

当前仓库实际依赖以上述 `pubspec.yaml` 为准；F4 / 推送相关依赖（如 `http_certificate_pinning`、`flutter_apns_only`）尚未进入当前代码快照，待相应 Spike / M4 收口后再固定。  
`pubspec.lock` 应继续一并提交入库；加密、网络与推送相关依赖升级前必须重新跑 Spike F1 / F2 / F4。  
`golden_toolkit` 已不再维护，golden test 直接使用 `flutter_test` 内置的 `matchesGoldenFile`，删除该依赖。  
`http_certificate_pinning` 与 `dio 5.x` 的兼容性需在 Spike F4 中验证；若不兼容，替换为直接操作 `SecurityContext` 的自写方案，版本号待 Spike 确认后固定。
