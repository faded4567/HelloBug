import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import '../theme/index.dart';

/// Device revoked page — wireframe 47
class DeviceRevokedPage extends StatelessWidget {
  const DeviceRevokedPage({
    super.key,
    this.deviceName,
    this.revokedAt,
    this.revokedBy,
  });

  final String? deviceName;
  final String? revokedAt;
  final String? revokedBy;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final name = deviceName ?? '未知设备';
    final at = revokedAt ?? '—';
    final by = revokedBy ?? '另一台设备';

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              // icon
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.red.withValues(alpha: .15),
                ),
                alignment: Alignment.center,
                child:
                    const Text('🔐', style: TextStyle(fontSize: 36)),
              ),
              const SizedBox(height: 16),
              Text(
                '设备访问已吊销',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.red,
                ),
              ),
              const SizedBox(height: 12),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: name,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: c.fg,
                      ),
                    ),
                    TextSpan(
                      text: ' 的访问权限已在 ',
                      style: TextStyle(color: c.fg2),
                    ),
                    TextSpan(
                      text: by,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: c.fg,
                      ),
                    ),
                    TextSpan(
                      text: ' 上撤销。\n出于安全考虑，本次连接已终止。',
                      style: TextStyle(color: c.fg2),
                    ),
                  ],
                ),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14, height: 1.7),
              ),
              const SizedBox(height: 8),
              // details card
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '吊销详情',
                      style: TextStyle(
                        fontSize: 11,
                        color: c.fg3,
                        letterSpacing: .6,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _DetailRow(label: '设备名称', value: name, c: c),
                    _DetailRow(label: '吊销时间', value: at, c: c),
                    _DetailRow(label: '操作来源', value: by, c: c),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: CupertinoButton.filled(
                  onPressed: () => context.go('/onboarding'),
                  child: const Text('重新配对新设备'),
                ),
              ),
              CupertinoButton(
                onPressed: () {},
                child: Text(
                  '了解为什么会发生这种情况',
                  style: TextStyle(fontSize: 13, color: c.fg3),
                ),
              ),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value, required this.c});
  final String label;
  final String value;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(
            '$label：',
            style: TextStyle(fontSize: 13, color: c.fg2),
          ),
          Text(
            value,
            style: TextStyle(fontSize: 13, color: c.fg),
          ),
        ],
      ),
    );
  }
}
