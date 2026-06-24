# HelloBug — Claude Flutter 范围说明

更新：2026-06-23

## 用途

这份文档定义 Claude 当前对整个 Flutter 客户端的负责边界和阅读方式。

> 文件名 `docs/claude-ui-tasks.md` 沿用历史命名，但当前语义已经不是“只做 UI”，而是 **Claude 负责整个 `app/` Flutter 客户端**。

- 任务完成状态真源：`docs/app-remaining-work.md`
- Claude 启动记忆：`memory/claude-current.md`
- Flutter 真实运行时现状：`memory/shared/flutter-status.md`

## Claude 负责什么

- `app/lib/**` 下的页面、Sheet、Dialog、状态页
- `app/lib/state/**` 的 Provider、客户端状态机、事件映射
- `app/lib/transport/**` 的 WebSocket、重连、重放、pinning、push token 上报
- `app/lib/crypto/**` 的客户端加密、签名、密钥存储
- `app/lib/models/**`、`bootstrap.dart`、`router.dart`、`app.dart`
- 现有页面的空态、错误态、加载态、视觉补口，以及 Flutter 侧联调

## Claude 不负责什么

- `packages/server/**`
- `packages/daemon/**`
- `packages/protocol/**`
- Caddy / systemd / 云端部署脚本
- daemon runtime、server relay、设备注册表、PTY、历史存储、推送服务本身

说明：

- Claude 可以为 Flutter 联调去改 app 里的协议接线、Provider、transport、crypto。
- 如果问题需要 server / daemon / protocol 一起改，则由 Codex 负责对应后端改动。

## 阅读顺序

1. `memory/claude-current.md`
2. `docs/app-remaining-work.md`
3. `memory/shared/flutter-status.md`
4. `docs/wireframes/index.html`
5. 对应的 `docs/wireframes/*.html`
6. 最后只打开当前要改的 `app/lib/**`

## 当前 Flutter 重点

- 当前根导航方向以 2-tab 为准；旧 3-tab / 4-tab 底栏只当历史稿，不再作为根导航真源。
- P0 运行时：app crypto、pinning、push token 上报、JWT 恢复、`danger.pending` 全局监听、文件树/文件预览正式 payload 收口、工作区 2-tab 语义收口
- P0 状态/UI：启动加载、重连、设备吊销、配对过期、会话不存在、工作区状态页、push landing、聊天页关键状态、文件预览补态、设备列表刷新/失败视觉
- P1：工作区主页/设置、终端状态、历史搜索/筛选/失败、通知权限被拒绝提示、设备详情错误/吊销承接、客户端状态持久化补口
- P2：多会话 tab、横屏双栏
- P3：群组 / 多 Agent UI

具体优先级、完成情况和剩余项，都以 `docs/app-remaining-work.md` 为准。

## Flutter 修改原则

- 已经有第一版 UI 的页面，不要整页推倒重做。
- 需要做的是在现有页面基础上继续补状态、补入口、补缺失子界面，并把对应的 Provider / transport / crypto / routing 接活。
- 保持现有主题和 token，不要为了接业务把视觉系统拆乱。
- 如果只是在已有页面上加一个错误态、空态或加载态，不需要另建一套业务逻辑；如果状态来自真实协议，就直接在 Flutter 侧把状态机补齐。

## 交付要求

1. 页面能在 Flutter 工程中编译通过。
2. Provider / transport / crypto 的修改要和 `docs/protocol.md` 与当前 server/daemon 现状保持一致。
3. 页面遵循现有主题与 token。
4. 页面具备基本导航壳。
5. 页面至少覆盖 wireframe 的主要视觉结构。
6. 允许用 mock / placeholder 支撑展示，但不要伪造新的协议实现。
