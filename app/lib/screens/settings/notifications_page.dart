import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  bool _agentDone = true;
  bool _dangerWait = true;
  bool _agentError = true;
  bool _agentInput = true;
  bool _deviceOnline = false;
  bool _tokenAlert = false;
  bool _hideDetails = true;
  bool _dnd = true;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('通知与推送', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          children: [
            _PushStatusCard(
              icon: '🔔',
              iconBg: AppColors.green.withValues(alpha: .15),
              title: 'APNS（iOS 推送）',
              subtitle: '设备 token 已注册 · 2026-06-01',
              status: '已就绪',
              statusColor: AppColors.green,
            ),
            _PushStatusCard(
              icon: '📦',
              iconBg: AppColors.orange.withValues(alpha: .15),
              title: '厂商推送（Android）',
              subtitle: '当前设备为 iOS，无需配置',
              status: 'N/A',
              statusColor: AppColors.orange,
            ),

            CupertinoListSection.insetGrouped(
              header: Text('推送事件', style: TextStyle(color: c.fg2)),
              children: [
                _EventTile('✅', 'Agent 任务完成', '任务正常结束时推送',
                  AppColors.green.withValues(alpha: .12), _agentDone,
                  (v) => setState(() => _agentDone = v), c),
                _EventTile('⚠️', '等待危险操作确认', '命中黑名单规则，需手动放行',
                  AppColors.orange.withValues(alpha: .15), _dangerWait,
                  (v) => setState(() => _dangerWait = v), c),
                _EventTile('❌', 'Agent 执行出错', '命令非零退出或 API 错误',
                  AppColors.red.withValues(alpha: .12), _agentError,
                  (v) => setState(() => _agentError = v), c),
                _EventTile('💬', 'Agent 需要输入', '询问模式下等待用户回复',
                  c.tintBg, _agentInput,
                  (v) => setState(() => _agentInput = v), c),
                _EventTile('🔌', '设备上下线', 'Daemon 连接或断开',
                  const Color(0xFF5E5CE6).withValues(alpha: .15), _deviceOnline,
                  (v) => setState(() => _deviceOnline = v), c),
                _EventTile('💰', 'Token 用量告警', '单次会话超过 50 k tokens',
                  AppColors.orange.withValues(alpha: .12), _tokenAlert,
                  (v) => setState(() => _tokenAlert = v), c),
              ],
            ),

            CupertinoListSection.insetGrouped(
              header: Text('推送内容隐私', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('🔒', c, AppColors.red.withValues(alpha: .12)),
                  title: const Text('隐藏推送详情'),
                  subtitle: const Text('通知仅显示"HelloBug 需要操作"，不含代码或路径'),
                  trailing: CupertinoSwitch(
                    value: _hideDetails,
                    onChanged: (v) => setState(() => _hideDetails = v),
                    activeTrackColor: c.tint,
                  ),
                ),
              ],
            ),

            CupertinoListSection.insetGrouped(
              header: Text('免打扰时段', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('🌙', c, c.tintBg),
                  title: const Text('开启免打扰'),
                  trailing: CupertinoSwitch(
                    value: _dnd,
                    onChanged: (v) => setState(() => _dnd = v),
                    activeTrackColor: c.tint,
                  ),
                ),
                if (_dnd) ...[
                  CupertinoListTile(
                    leading: _Ico('🕙', c, c.bg3),
                    title: const Text('开始时间'),
                    additionalInfo: const Text('22:00',
                      style: TextStyle(fontFamily: 'Menlo')),
                    trailing: const CupertinoListTileChevron(),
                    onTap: () {},
                  ),
                  CupertinoListTile(
                    leading: _Ico('🌅', c, c.bg3),
                    title: const Text('结束时间'),
                    additionalInfo: const Text('08:00',
                      style: TextStyle(fontFamily: 'Menlo')),
                    trailing: const CupertinoListTileChevron(),
                    onTap: () {},
                  ),
                  CupertinoListTile(
                    leading: _Ico('⚡', c, AppColors.orange.withValues(alpha: .15)),
                    title: const Text('危险操作不受免打扰限制'),
                    subtitle: const Text('命中黑名单规则始终推送'),
                    trailing: CupertinoSwitch(
                      value: true, onChanged: (_) {},
                      activeTrackColor: c.tint,
                    ),
                  ),
                ],
              ],
            ),

            CupertinoListSection.insetGrouped(
              header: Text('提示方式', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('🔈', c, c.tintBg),
                  title: const Text('声音'),
                  additionalInfo: const Text('Ping'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
                CupertinoListTile(
                  leading: _Ico('🔢', c, const Color(0xFF5E5CE6).withValues(alpha: .15)),
                  title: const Text('角标'),
                  trailing: CupertinoSwitch(
                    value: true, onChanged: (_) {},
                    activeTrackColor: c.tint,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PushStatusCard extends StatelessWidget {
  const _PushStatusCard({
    required this.icon,
    required this.iconBg,
    required this.title,
    required this.subtitle,
    required this.status,
    required this.statusColor,
  });
  final String icon, title, subtitle, status;
  final Color iconBg, statusColor;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(children: [
        Container(
          width: 44, height: 44,
          decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(12)),
          alignment: Alignment.center,
          child: Text(icon, style: const TextStyle(fontSize: 22)),
        ),
        const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.fg)),
          const SizedBox(height: 2),
          Text(subtitle, style: TextStyle(fontSize: 12, color: c.fg2)),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: statusColor.withValues(alpha: .15),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(status,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: statusColor)),
        ),
      ]),
    );
  }
}

CupertinoListTile _EventTile(
  String icon, String title, String desc, Color iconBg, bool value,
  ValueChanged<bool> onChanged, ThemeColors c,
) => CupertinoListTile(
  leading: _Ico(icon, c, iconBg),
  title: Text(title),
  subtitle: Text(desc),
  trailing: CupertinoSwitch(value: value, onChanged: onChanged, activeTrackColor: c.tint),
);

class _Ico extends StatelessWidget {
  const _Ico(this.emoji, this.c, this.bg);
  final String emoji;
  final ThemeColors c;
  final Color bg;

  @override
  Widget build(BuildContext context) => Container(
    width: 30, height: 30,
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(7)),
    alignment: Alignment.center,
    child: Text(emoji, style: const TextStyle(fontSize: 16)),
  );
}
