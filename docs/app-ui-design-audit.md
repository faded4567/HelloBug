# HelloBug App UI Design Audit

更新日期：2026-06-23

## 目的

这份文档只回答一个问题：

当前 `docs/wireframes/index.html`、各独立 HTML 线框稿、以及 `app/lib/` 现状对照后，哪些 App 界面已经有设计稿，哪些已经有 Flutter 页面，哪些仍只有设计或只有代码。

这里的“界面”既包括完整页面，也包括对功能闭环有明显影响的 sheet、modal、搜索页、详情页和横屏容器。

## 当前索引状态

- `docs/wireframes/index.html` 当前是有效状态
- 共 57 个节点、70 条连线
- 无缺失文件
- 无错误引用
- 无孤立节点

## 状态说明

- `已设计 + 已有代码`：独立 HTML 线框稿存在，Flutter 里也已有对应页面/组件
- `已设计 + 未落地`：独立 HTML 线框稿存在，但 Flutter 里还没有对应页面/路由
- `已有代码 + 未独立设计`：Flutter 已有页面/组件，但没有对应独立 HTML 线框稿
- `仅状态变体`：不需要单独页面，通常应并入既有页面的 error/loading/empty 变体

## 结论

- 设计稿层面现在已经不是“主流程缺页”，而是“主流程基本齐了，Flutter 落地还不完整”。
- 当前最重要的缺口不是继续补很多新页面，而是把已存在设计稿对应的 Flutter 页面和协议闭环接上。
- 真正还明显缺的是少数运行时页面/能力，而不是 `index.html` 主图谱本身。

## 一、已设计 + 已有代码

这些页面或能力，设计和 Flutter 两边都已经有了第一版落地：

| 功能域 | 设计稿 | Flutter 现状 |
| --- | --- | --- |
| 引导 | `10-onboarding.html` | 已有 `onboarding_flow.dart` |
| 配对入口 | `01-pairing.html` | 已有 `pairing_entry_page.dart` |
| SAS 核对 | `02-sas.html` | 已有 `sas_verify_page.dart` |
| 扫码页 | `33-qr-scan.html` | 已有 `qr_scan_page.dart` |
| 解锁 | `11-unlock.html` | 已有 `unlock_page.dart` / `unlock_gate.dart` |
| 设备列表 | `03-devices.html` | 已有 `devices_page.dart` |
| 会话列表 | `08-session-list.html` | 已有 `sessions_page.dart` |
| 新建会话 | `12-new-session.html` | 已有 `new_session_flow.dart` |
| 聊天主页 | `04-chat.html` | 已有 `chat_page.dart` |
| Diff | `05-diff.html` | 已有 `diff_page.dart` |
| 文件树 | `06-filetree.html` | 已有 `file_tree_page.dart` |
| 文件预览 | `37-file-preview.html` | 已有 `file_preview_page.dart` |
| 历史列表 | `27-history-list.html` | 已有 `HistoryListPage` |
| 历史详情 | `28-history-detail.html` | 已有 `HistoryDetailPage` |
| 危险确认 | `09-danger-confirm.html` | 已有 `DangerConfirmSheet` |
| 斜杠命令 | `14-slash-palette.html` | 已有 `slash_palette/` |
| 图片输入 | `15-image-input.html` | 已有 `image_input_sheet.dart` |
| 设置主页 | `17-settings.html` | 已有 `settings_home_page.dart` |
| 外观 | `19-settings-appearance.html` | 已有 `appearance_page.dart` |
| 危险规则 | `21-settings-danger-rules.html` | 已有 `danger_rules_page.dart` |
| 关于 | `24-about.html` | 已有 `about_page.dart` |
| 工作区切换 | `44-workspace-switcher.html` | 已有 `workspace_switch_sheet.dart` |
| 根部三栏 | `42-tab-scaffold-3tab.html` | 已有 `root_tab_scaffold.dart` |

## 二、已设计 + 未落地

这些页面在线框稿中已经有，但 Flutter 里还没有对应 screen/route：

| 设计稿 | 当前缺口 |
| --- | --- |
| `18-settings-security.html` | 无 `security_page.dart` |
| `20-settings-notifications.html` | 无 `notifications_page.dart` |
| `22-settings-templates.html` | 无 `templates_page.dart` |
| `23-device-detail.html` | 无 `device_detail_page.dart` |
| `16-voice-input.html` | 无 `voice_input/` 实现 |
| `39-relay-settings.html` | Flutter 设置体系中未落地 |
| `40-session-info.html` | 无独立页面或入口 |
| `43-workspace-home.html` | 无 Flutter 页面 |
| `45-workspace-settings.html` | 无 Flutter 页面 |
| `31-terminal-status-bar.html` | 无独立终端状态层实现 |
| `35-session-tabs.html` | 无多会话 tab UI |
| `36-landscape-split.html` | 无横屏双栏容器实现 |
| `38-template-form.html` | 无模板编辑页/表单 |
| `46-60` 多数状态页 | 仍未在 Flutter 中体现为完整状态页或状态变体 |

## 三、已有代码 + 未独立设计

这些不是“没做”，而是 Flutter 里已经有，但没有必要或尚没有独立 HTML 页：

| Flutter 代码 | 说明 |
| --- | --- |
| `manual_pair_page.dart` | 当前是命名/职责错位的占位页，不是实际手输配对流程 |
| `image_input_sheet.dart` inline 预览流 | 有代码，但未拆成独立预览页 |
| `DangerConfirmSheet` 的倒计时/认证交互 | 属于弹层行为，不必独立成页面 |
| `workspace_history_provider.dart` | 逻辑已存在，但不对应独立设计页 |
| `ChatStatusBanner` | 状态层已在代码中，但不是独立线框页 |

## 四、仅状态变体，不需要独立页面

这部分更适合做成既有页面的状态变体，而不是继续单建 wireframe：

- 协议版本不兼容
- 服务器证书 pin 不匹配
- JWT 过期后重连中
- 会话不存在 / 已异常结束
- 超大文件加载中 / 加载失败
- Diff 过大降级 / 加载失败
- 终端只读 / 权限不足
- 生物识别失败后的 inline 错误
- 设备吊销成功或失败反馈

## 五、最值得继续补齐的 Flutter 落地项

如果目标是“完整 App 功能”，当前最值得优先实现的不是补新设计稿，而是把下面这些已经有设计、但 Flutter 还没落地的内容补上：

1. 安全与隐私页
2. 通知与推送页
3. 模板页
4. 设备详情页
5. 语音输入
6. 中继服务器设置
7. 工作区主页 / 工作区设置
8. 多会话 tab
9. 横屏双栏
10. 终端状态栏

## 六、设计层面当前真正缺的最小集合

如果只从“是否还缺设计稿”来讲，目前最明确还缺、且之前已确认值得独立保留的，主要就是：

1. `60-workspace-permission.html` 对应的工作区权限受限场景补充说明

除此之外，绝大多数剩余缺口更像 Flutter 落地缺口或协议闭环缺口，而不是 `index.html` 继续缺页。
