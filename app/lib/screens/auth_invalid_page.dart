import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import '../theme/index.dart';

/// Auth invalid / session expired page.
///
/// Shown when JWT is expired or invalid, before returning to onboarding.
class AuthInvalidPage extends StatelessWidget {
  const AuthInvalidPage({
    super.key,
    this.deviceName,
    this.lastActiveText,
  });

  final String? deviceName;
  final String? lastActiveText;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final name = deviceName ?? '未知设备';

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.orange.withValues(alpha: .15),
                ),
                alignment: Alignment.center,
                child: const Text('⏳', style: TextStyle(fontSize: 36)),
              ),
              const SizedBox(height: 16),
              Text(
                '登录已失效',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.orange,
                ),
              ),
              const SizedBox(height: 12),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '与 ',
                      style: TextStyle(fontSize: 14, color: c.fg2),
                    ),
                    TextSpan(
                      text: name,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: c.fg,
                      ),
                    ),
                    TextSpan(
                      text:
                          ' 的会话凭证已过期或失效。\n为安全起见，需要重新配对以建立新连接。',
                      style: TextStyle(
                        fontSize: 14,
                        color: c.fg2,
                        height: 1.7,
                      ),
                    ),
                  ],
                ),
                textAlign: TextAlign.center,
              ),
              if (lastActiveText != null) ...[
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: c.bg2,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '上次活跃',
                        style: TextStyle(fontSize: 13, color: c.fg3),
                      ),
                      Text(
                        lastActiveText!,
                        style: TextStyle(fontSize: 13, color: c.fg),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: CupertinoButton.filled(
                  onPressed: () => context.go('/onboarding'),
                  child: const Text('重新配对新设备'),
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
