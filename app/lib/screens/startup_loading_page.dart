import 'package:flutter/cupertino.dart';
import '../theme/index.dart';

/// Startup restore splash — wireframe 46
///
/// Variant A: restoring session (spinner)
/// Variant B: relay unreachable (warning + retry)
class StartupLoadingPage extends StatelessWidget {
  const StartupLoadingPage({
    super.key,
    this.relayUrl,
    this.pairedDeviceName,
    this.lastActiveText,
    this.error,
    this.onRetry,
    this.onEnterOffline,
    this.onGoToOnboarding,
  });

  /// Relay server hostname (variant A)
  final String? relayUrl;

  /// Paired device name (variant A)
  final String? pairedDeviceName;

  /// "3 分钟前" etc (variant A)
  final String? lastActiveText;

  /// Non-null → variant B (relay unreachable)
  final String? error;

  /// Variant B retry
  final VoidCallback? onRetry;

  /// Variant B offline mode
  final VoidCallback? onEnterOffline;

  /// Fallback: go to onboarding
  final VoidCallback? onGoToOnboarding;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final isError = error != null;

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // App icon
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0A84FF), Color(0xFF5E5CE6)],
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF0A84FF).withValues(alpha: .35),
                        blurRadius: 24,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  alignment: Alignment.center,
                  child: const Text('🐛', style: TextStyle(fontSize: 36)),
                ),
                const SizedBox(height: 16),
                const Text(
                  'HelloBug',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -.3,
                  ),
                ),

                if (isError) ...[
                  const SizedBox(height: 8),
                  const Text('⚠️', style: TextStyle(fontSize: 36)),
                  const SizedBox(height: 4),
                  Text(
                    '无法连接中继服务器',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.orange,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    error!,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      color: c.fg2,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (onRetry != null)
                    SizedBox(
                      width: 200,
                      child: CupertinoButton.filled(
                        onPressed: onRetry,
                        child: const Text('重试连接'),
                      ),
                    ),
                  if (onEnterOffline != null) ...[
                    const SizedBox(height: 4),
                    CupertinoButton(
                      onPressed: onEnterOffline,
                      child: Text(
                        '离线模式进入',
                        style: TextStyle(fontSize: 14, color: c.tint),
                      ),
                    ),
                  ],
                  if (onGoToOnboarding != null) ...[
                    const SizedBox(height: 4),
                    CupertinoButton(
                      onPressed: onGoToOnboarding,
                      child: Text(
                        '重新配对',
                        style: TextStyle(fontSize: 14, color: c.fg3),
                      ),
                    ),
                  ],
                ] else ...[
                  const SizedBox(height: 8),
                  const _Spinner(),
                  const SizedBox(height: 12),
                  Text(
                    '正在恢复会话…',
                    style: TextStyle(fontSize: 14, color: c.fg2),
                  ),
                  if (relayUrl != null) ...[
                    const SizedBox(height: 8),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: const BoxDecoration(
                            shape: BoxShape.circle,
                            color: AppColors.green,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          relayUrl!,
                          style: TextStyle(
                            fontSize: 12,
                            color: c.fg3,
                            fontFamily: 'SF Mono',
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (pairedDeviceName != null) ...[
                    const SizedBox(height: 24),
                    Text(
                      '已配对设备：$pairedDeviceName${lastActiveText != null ? '\n上次活跃：$lastActiveText' : ''}',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 12,
                        color: c.fg3,
                        height: 1.8,
                      ),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Spinner extends StatefulWidget {
  const _Spinner();

  @override
  State<_Spinner> createState() => _SpinnerState();
}

class _SpinnerState extends State<_Spinner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, __) => Transform.rotate(
        angle: _ctrl.value * 6.283185,
        child: Container(
          width: 28,
          height: 28,
          decoration: const BoxDecoration(
            shape: BoxShape.circle,
            border: Border(
              top: BorderSide(color: Color(0xFF0A84FF), width: 2.5),
              left: BorderSide(color: Color(0xFF3A3A3C), width: 2.5),
              bottom: BorderSide(color: Color(0xFF3A3A3C), width: 2.5),
              right: BorderSide(color: Color(0xFF3A3A3C), width: 2.5),
            ),
          ),
        ),
      ),
    );
  }
}
