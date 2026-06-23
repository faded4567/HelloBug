import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class SecurityPage extends StatefulWidget {
  const SecurityPage({super.key});

  @override
  State<SecurityPage> createState() => _SecurityPageState();
}

class _SecurityPageState extends State<SecurityPage> {
  bool _biometric = true;
  bool _clipboard = true;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('安全与隐私', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(
          children: [
            CupertinoListSection.insetGrouped(
              header: Text('生物识别锁', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('👆', c, tint: c.tintBg),
                  title: const Text('启动时 Face ID / 指纹验证'),
                  subtitle: const Text('冷启动 App 时验证一次，运行中不再打扰'),
                  trailing: CupertinoSwitch(
                    value: _biometric,
                    onChanged: (v) => setState(() => _biometric = v),
                    activeTrackColor: c.tint,
                  ),
                ),
                CupertinoListTile(
                  leading: _Ico('🔒', c, bg: AppColors.red.withValues(alpha: .12)),
                  title: const Text('截屏保护'),
                  additionalInfo: const Text('仅敏感页'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
                CupertinoListTile(
                  leading: _Ico('📋', c, bg: const Color(0xFF5E5CE6).withValues(alpha: .15)),
                  title: const Text('剪贴板读取保护'),
                  trailing: CupertinoSwitch(
                    value: _clipboard,
                    onChanged: (v) => setState(() => _clipboard = v),
                    activeTrackColor: c.tint,
                  ),
                ),
              ],
            ),

            CupertinoListSection.insetGrouped(
              header: Text('设备密钥', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('🔑', c, bg: AppColors.green.withValues(alpha: .12)),
                  title: const Text('Ed25519 公钥指纹'),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                        decoration: BoxDecoration(
                          color: c.bg3,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          'SHA256:xK9mP3vQ7nR2wZ8bH4cY1tE6aJ0dL5fN\n创建于 2026-06-01 · 存储在 iOS Keychain',
                          style: TextStyle(fontSize: 11, fontFamily: 'Menlo',
                            color: c.fg2, height: 1.6),
                        ),
                      ),
                    ],
                  ),
                  trailing: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.green.withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: const Text('活跃',
                      style: TextStyle(fontSize: 11, color: AppColors.green,
                        fontWeight: FontWeight.w600)),
                  ),
                ),
                CupertinoListTile(
                  leading: _Ico('🔄', c, bg: AppColors.orange.withValues(alpha: .12)),
                  title: const Text('轮换设备密钥'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
                CupertinoListTile(
                  leading: _Ico('📤', c, bg: const Color(0xFF5E5CE6).withValues(alpha: .15)),
                  title: const Text('导出公钥'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
              ],
            ),

            CupertinoListSection.insetGrouped(
              header: Text('最近配对的 SAS', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  title: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('MacBook Pro M3 · 2026-06-01 配对',
                        style: TextStyle(fontSize: 13, color: c.fg2)),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6, runSpacing: 6,
                        children: ['🐢 海龟', '🪐 土星', '🍵 绿茶', '🎷 萨克斯', '🌙 月亮']
                          .map((s) => Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: c.bg3,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(s, style: const TextStyle(fontSize: 14)),
                          )).toList(),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            CupertinoListSection.insetGrouped(
              header: Text('会话加密', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('🔐', c, tint: c.tintBg),
                  title: const Text('E2EE 协议'),
                  additionalInfo: const Text('Noise IK'),
                ),
                CupertinoListTile(
                  leading: _Ico('🔄', c, bg: AppColors.green.withValues(alpha: .12)),
                  title: const Text('密钥轮换间隔'),
                  additionalInfo: const Text('100 条消息'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
                CupertinoListTile(
                  leading: _Ico('⏳', c, bg: AppColors.orange.withValues(alpha: .12)),
                  title: const Text('云端缓冲 TTL'),
                  additionalInfo: const Text('24 小时'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
                CupertinoListTile(
                  leading: _Ico('🗑', c, bg: AppColors.red.withValues(alpha: .12)),
                  title: Text('清除所有会话密文缓存',
                    style: const TextStyle(color: AppColors.red)),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
              ],
            ),

            CupertinoListSection.insetGrouped(
              header: Text('越狱/Root 检测', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _Ico('✅', c, bg: AppColors.green.withValues(alpha: .12)),
                  title: const Text('设备状态'),
                  additionalInfo: const Text('正常',
                    style: TextStyle(color: AppColors.green)),
                ),
                CupertinoListTile(
                  leading: _Ico('⚠️', c),
                  title: const Text('检测到越狱时'),
                  additionalInfo: const Text('仅警告'),
                  trailing: const CupertinoListTileChevron(),
                  onTap: () {},
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Ico extends StatelessWidget {
  const _Ico(this.emoji, this.c, {this.bg, this.tint});
  final String emoji;
  final ThemeColors c;
  final Color? bg;
  final Color? tint;

  @override
  Widget build(BuildContext context) => Container(
    width: 30, height: 30,
    decoration: BoxDecoration(
      color: tint ?? bg ?? c.bg3,
      borderRadius: BorderRadius.circular(7),
    ),
    alignment: Alignment.center,
    child: Text(emoji, style: const TextStyle(fontSize: 16)),
  );
}
