# HelloBug — V1 可用版清单

更新：2026-06-28

> 这份文档只回答一个问题：为了交付首个“真实可用”的 HelloBug 版本，还差什么。
> 总任务状态仍以 `docs/app-remaining-work.md` 为准；本文件是基于当前代码与总表整理出的 **V1 过滤视图**。

## 1. V1 定义

V1 指“首个可持续使用的版本”，不是最终完整版，也不是生产级部署版。

V1 范围约束：

- Android 真机优先作为首轮验收平台
- Web 继续作为联调与调试平台，不作为最终体验标准
- iOS 不作为首轮阻塞项，但现有代码不应主动破坏 iOS
- 单用户、单 daemon、单已绑定设备、单活跃会话
- 单 agent 主链路优先，不把多 agent 作为首版阻塞项
- 允许局域网 / 单台云服务器部署，不要求首版就完成生产级运维体系

V1 必须让用户稳定完成这些事情：

- 首次启动 App，完成配对、SAS 确认与绑定
- 绑定后进入 App，不因认证、恢复、重连状态而白屏或卡死
- 选择工作区并创建新会话
- 在聊天页持续发送文本，接收回复，处理危险操作确认
- 打开终端并执行输入 / resize
- 打开文件树与文件预览
- 查看历史记录，并从历史继续会话
- 查看设备详情、设备在线状态、重命名与吊销
- 在 daemon 暂时断开、会话恢复、认证失效等常见异常下得到明确反馈和可恢复路径

## 2. 当前判断

当前项目已经不是“没有功能”，而是“主链路基本打通，但还没有把首版使用体验收口完整”。

已经具备的基础：

- app / server / daemon 的 `Envelope` 主链路已接通
- pairing、SAS、`auth.attach/auth.token`、`session.start`、`session.resume/replay.done`、`danger.pending/result` 基础闭环已在
- daemon 已具备 `history.list / history.get / templates.list / slash.list / fs.tree.req / fs.file.req / pty.input / pty.resize`
- server 已具备设备状态、设备管理、工作区发现、超时失败快返、控制流量定向回发、降级拦截
- Flutter 大部分主页面与组件已经有第一版实现，不再是“从 0 画页面”的阶段

当前离 V1 还差的，不是单点协议功能，而是下面三类收口：

- App 生命周期、恢复状态、错误状态与工作区入口语义还没有统一
- 文件 / Diff / 工作区这些“可见功能”还缺少几块真实后端语义或正式状态承接
- 还缺一次面向 Android 真机的完整回归，把跨页切换、重连恢复、异常态走通

## 3. V1 已完成能力

- `[x]` 配对主链路：`device.pair -> device.pair.sas -> device.pair.confirm -> auth.token`
- `[x]` 会话启动确认：`session.start -> session.start.result`
- `[x]` 会话恢复确认：`session.resume -> replay.done`
- `[x]` 聊天主链路第一版：文本输入、slash、基础语音入口、danger confirm
- `[x]` 终端主链路第一版：真实 PTY、输入、resize、只读 gating 基础版
- `[x]` 文件能力第一版：文件树、文件预览正式协议已接通
- `[x]` 历史能力第一版：`history.list / history.get` 已接通，并能从历史继续会话
- `[x]` 工作区发现第一版：`workspace.list / workspace.resolve` 已接通
- `[x]` 工作区发现已补基础元数据：`is_empty / repo_root / git_branch`
- `[x]` 工作区发现已补第一版修复提示：`status_reason / access_mode / repair_hint`
- `[x]` 设备能力第一版：`device.list / device.rename / device.revoke` 与 live `device.status`
- `[x]` relay 安全边界已完成一大段：签名、时钟偏差校验、重放拦截、控制流量 downgrade 拦截、挂起请求超时失败快返
- `[x]` relay 安全边界再收一轮：legacy envelope signature fallback、raw JSON `session.start.result / replay.done / error`，以及缺少 `routing_payload` 的加密 `error` 兼容已移除

## 4. V1 阻塞项

下面这些是 **V1 必做**，不做完就仍然更像“开发联调版”，还不能算“首个可用版”。

### 4.1 Claude：Flutter 侧必须收口的项

- `[ ]` 配对异常 / 恢复页收口
  - 配对失败
  - 配对过期
  - 设备被吊销
  - 认证失效
  - 启动恢复中
  - 重连中
- `[ ]` App 生命周期与 runtime 收口
  - `bootstrap()`、JWT 恢复、重连后的重新附着
  - 避免 tab 切换、页面恢复、异常回退时出现白屏或悬空状态
- `[ ]` 2-tab 根导航第一分支改成真正的“工作区入口”
  - 不能继续只是 `SessionsPage` 的过渡壳
  - 工作区主页、工作区设置、路径失效、空工作区、权限受限这些状态要接真实数据
- `[ ]` 会话 / 聊天状态机收口
  - `replaying`
  - `session_not_found`
  - `done`
  - `offline`
  - `danger.result` 的失败 / 超时 / 已处理
- `[x]` 文件预览状态补齐
  - `large-file`
  - `binary-file`
  - `permission-denied`
- `[ ]` 设备列表 / 详情页的刷新、失败、已吊销状态收口

### 4.2 Codex：后端 / daemon 侧 V1 必做项

- `[x]` 补上可持续使用的 Diff 真后端第一版
  - daemon 现已基于 Claude `Write / Edit / MultiEdit` 工具的前后快照持续输出 `file.changed`
  - `file.changed` 现已正式包含 `file_path / diff / added / removed`
  - 当前基础降级策略已定：越界路径、非文本、超大文件、无实际变更、工具失败时不发 diff 事件
- `[~]` 把 pre-pair bootstrap 与剩余 fallback 再收紧一轮
  - `auth/device/pairing/session.resume` 主链路已完成 placeholder 收口
  - `workspace/history/templates` 直连控制流的 raw JSON 与 no-metadata plain envelope 入口也已收掉
  - `session.start / danger.allow / session.event` 这批 V1 主路径消息也已补 outer `routing_payload` 提示与 no-metadata plain envelope 收口
  - `replay.done` 现已明确为 server-only；daemon 主动上行这条恢复哨兵会被 server 直接拒绝
  - `fs.tree.req / fs.file.req` 现在也已进入 pending request 跟踪：daemon 在线但不回包时会超时失败，plain downgrade response 也会被 server 改回结构化错误
  - relay framing 阶段的协议形态错误现在统一回 `PROTOCOL_VERSION`，不再把 downgrade / 缺 metadata / 缺 sender_pubkey 这类问题误报成 `AUTH_INVALID`
  - 剩余兼容主要收敛到少量更早期开发态 plain envelope 分支
- `[x]` 把 V1 实际用到的协议字段与 `docs/protocol.md` 再收口一轮
  - 当前已同步 relay 的 raw JSON 收口、plain envelope outer metadata 约束、placeholder 覆盖范围与 downgrade 边界
- `[x]` 给 server / daemon 形成最小可复用的启动与回归命令
  - 已补 `docs/backend-runbook.md`，并在 `packages/package.json` 收好 `test:server:relay / test:daemon:v1 / test:v1:backend`

### 4.3 Shared：跨端一起定下来的项

- `[x]` 文件预览的返回语义定稿
  - 大文件
  - 二进制文件
  - 不可读文件
- `[~]` Diff 的降级 / 截断 / 失败语义第一版已定
  - daemon 当前会对越界路径、非文本、超大文件、无变更、失败结果直接静默降级为“不发 `file.changed`”
  - App 侧针对 `diff` 过大 / 加载失败 / 无变更的显式状态仍待继续补
- `[x]` 图片输入后端失败语义第一版已补
  - daemon 现在会拒绝非 `image/*` MIME 与超过 2MB 的图片上传
  - 运行时不支持图片输入等普通异常也会回结构化 `error`，不再只在 daemon 终端打日志
  - 入站加密 envelope 若解密后 payload/schema 非法，也会回结构化 `error`，方便联调定位
- `[ ]` provider 事件模型与 daemon payload 再对齐一轮
  - 减少 Flutter 状态层与 server/daemon 消息层继续漂移
- `[ ]` 做一轮 Android 真机端到端回归
  - 配对
  - 工作区切换
  - 新建会话
  - 聊天
  - danger confirm
  - 终端
  - 文件树 / 文件预览
  - 历史 / 继续会话
  - 设备管理
  - 断线 / 重连 / 恢复

## 5. V1 最好做，但不阻塞首版

这些很重要，但可以放到 V1 后半段或 V1.1：

- `[ ]` 设置页真实数据源与保存状态机收口
- `[ ]` 模板最终存储归属定稿
- `[ ]` 图片输入的上传完成确认与失败回执
- `[~]` 更完整的工作区路径修复流
  - daemon `workspace.resolve` 已能区分 `not_found / not_directory / outside_allowed_paths / permission_denied`
  - 并在可行时返回默认工作区、最近存在祖先目录、同名允许目录或修权限提示
  - Flutter 侧对这些提示的最终消费与页面收口仍未完成
- `[ ]` 设备元数据进一步补齐：更多指纹 / 宿主信息 / 本地持久化细节
- `[~]` push backend provider-ready 骨架
  - `push.trigger`、离线 app 过滤、provider 接口、noop provider、invalid token 清理与持久化钩子已完成
  - APNS / Android 厂商 provider 真正出网不纳入 V1 阻塞

## 6. 明确不纳入 V1

下面这些不该再混进“V1 是否可用”的判断里：

- 多 agent / `session.agent.add` 真正落地
- 多会话并发与多 tab 容器
- 横屏双栏与复杂布局体系
- APNS / Android 厂商推送正式后端
- 生产级 Caddy / TLS / mTLS / systemd / 观测 / 限流 / 崩溃恢复
- 完整持久化 registry / buffer 替换内存实现

## 7. V1 验收清单

当下面这组检查全部通过时，才算 V1 达标：

- `[ ]` 新安装 App 后，用户能成功完成一次配对与绑定
- `[ ]` 绑定成功后，重新打开 App 能自动恢复到可用状态
- `[ ]` 设备列表与设备详情能稳定显示 live 状态，不出现空白或错乱
- `[ ]` 用户能进入工作区主入口并选择 / 切换工作区
- `[ ]` 用户能成功创建新会话并持续聊天
- `[ ]` danger pending 到达时，用户能完成 allow / deny，且失败态明确
- `[ ]` 用户能进入终端、输入命令并看到回显
- `[ ]` 用户能浏览文件树并打开文件预览
- `[ ]` 用户能浏览历史记录，并从历史继续会话
- `[ ]` daemon 暂时断线、session 失效、认证失效时，App 有明确提示和恢复路径
- `[ ]` tab 切换、页面切换、恢复流程中不再出现白屏、`GlobalKey` 冲突或明显卡死

## 8. 推荐执行顺序

建议按下面顺序推进，不要再并发过多大块任务：

1. 先收 Flutter 生命周期 / 恢复状态 / 工作区根入口
2. 再收 Flutter 生命周期 / 聊天 / danger / 文件 / 设备页的异常状态闭环
3. 接着把 pre-pair bootstrap、剩余 fallback 与启动/回归命令文档再收紧一轮
4. 最后做 Android 真机全链路回归，按回归结果回补协议与状态机

## 9. 一句话结论

当前项目已经具备 V1 的大部分底座；真正还缺的是 **状态机收口、工作区入口收口、剩余 fallback/恢复链路收紧，以及一次完整 Android 真机回归**。
