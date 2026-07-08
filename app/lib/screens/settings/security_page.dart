import 'dart:async';
import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../crypto/keys.dart';
import '../../state/settings_provider.dart';
import '../../theme/index.dart';

class SecurityPage extends ConsumerStatefulWidget {
  const SecurityPage({super.key});

  @override
  ConsumerState<SecurityPage> createState() => _SecurityPageState();
}

class _SecurityPageState extends ConsumerState<SecurityPage> {
  String? _fingerprint;

  @override
  void initState() {
    super.initState();
    _loadFingerprint();
  }

  Future<void> _loadFingerprint() async {
    try {
      final keys = await DeviceKeys.loadOrCreate();
      final pubBytes = (await keys.ed25519.extractPublicKey()).bytes;
      final digest = await Sha256().hash(pubBytes);
      final fp = 'SHA256:${base64Url.encode(digest.bytes).replaceAll('=', '')}';
      if (mounted) setState(() => _fingerprint = fp);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final settings = ref.watch(settingsProvider);

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
                    value: settings.biometric,
                    onChanged: (v) => ref.read(settingsProvider.notifier).update((s) => s.copyWith(biometric: v)),
                    activeTrackColor: c.tint,
                  ),
                ),
                CupertinoListTile(
                  leading: _Ico('📋', c, bg: const Color(0xFF5E5CE6).withValues(alpha: .15)),
                  title: const Text('剪贴板读取保护'),
                  trailing: CupertinoSwitch(
                    value: settings.clipboardProtect,
                    onChanged: (v) => ref.read(settingsProvider.notifier).update((s) => s.copyWith(clipboardProtect: v)),
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
                  subtitle: _fingerprint != null
                      ? Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(_fingerprint!, style: TextStyle(fontSize: 10, fontFamily: 'Menlo', color: c.fg2)),
                      )
                      : null,
                  additionalInfo: Text(
                    _fingerprint != null ? '已安全存储' : '加载中…',
                    style: TextStyle(fontSize: 12, color: c.fg3),
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
                  leading: _Ico('⏳', c, bg: AppColors.orange.withValues(alpha: .12)),
                  title: const Text('云端缓冲 TTL'),
                  additionalInfo: const Text('24 小时'),
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
