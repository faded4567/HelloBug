import 'dart:ui';
import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';

import '../../theme/index.dart';

class UnlockPage extends StatefulWidget {
  const UnlockPage({super.key});

  @override
  State<UnlockPage> createState() => _UnlockPageState();
}

class _UnlockPageState extends State<UnlockPage> with SingleTickerProviderStateMixin {
  final _auth = LocalAuthentication();
  late final AnimationController _pulse;
  late final Animation<double> _scale;
  late final Animation<double> _opacity;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();
    _scale   = Tween(begin: 1.0, end: 1.08).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut));
    _opacity = Tween(begin: 0.5, end: 0.15).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut));
    // auto-trigger on first frame
    WidgetsBinding.instance.addPostFrameCallback((_) => _authenticate());
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _authenticate() async {
    try {
      final ok = await _auth.authenticate(
        localizedReason: '验证身份以继续使用 HelloBug',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: false),
      );
      if (ok && mounted) context.go('/devices');
    } catch (_) {
      // show fallback passcode option
    }
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final timeStr = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final dateStr = '${now.year}年${now.month}月${now.day}日';

    return CupertinoPageScaffold(
      child: Stack(
        fit: StackFit.expand,
        children: [
          // gradient background
          const _LockBackground(),
          // decorative blurred cards
          Positioned(top: 140, left: 20, child: _BlurCard(width: 200, height: 80, color: const Color(0xFF0A84FF).withValues(alpha: .15))),
          Positioned(top: 240, left: 60, child: _BlurCard(width: 180, height: 60, color: const Color(0xFF34C759).withValues(alpha: .10))),
          Positioned(top: 320, right: 10, child: _BlurCard(width: 220, height: 70, color: const Color(0xFFFF9F0A).withValues(alpha: .08))),
          // time + date visible through blur
          Positioned(
            top: 90, left: 0, right: 0,
            child: Text(timeStr, textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 52, fontWeight: FontWeight.w200, letterSpacing: -.02 * 52, color: Color(0xE6FFFFFF))),
          ),
          Positioned(
            top: 154, left: 0, right: 0,
            child: Text(dateStr, textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, color: Color(0x99FFFFFF))),
          ),
          // frosted overlay
          ClipRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(color: const Color(0xFF000000).withValues(alpha: .6)),
            ),
          ),
          // lock UI
          SafeArea(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // app icon
                Container(
                  width: 72, height: 72,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF0A84FF), Color(0xFF5E5CE6)],
                    ),
                    borderRadius: BorderRadius.circular(18),
                    boxShadow: const [BoxShadow(color: Color(0x660A84FF), blurRadius: 20, offset: Offset(0, 4))],
                  ),
                  child: const Center(child: Text('🐛', style: TextStyle(fontSize: 38))),
                ),
                const SizedBox(height: 20),
                const Text('HelloBug 已锁定',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: CupertinoColors.white)),
                const SizedBox(height: 6),
                Text('后台超过 5 分钟，请验证身份\n以继续使用',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: context.colors.fg2, height: 1.6)),
                const SizedBox(height: 48),
                // Face ID ring with pulse animation
                GestureDetector(
                  onTap: _authenticate,
                  child: SizedBox(
                    width: 100, height: 100,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        // pulsing outer ring
                        AnimatedBuilder(
                          animation: _pulse,
                          builder: (_, __) => Transform.scale(
                            scale: _scale.value,
                            child: Container(
                              width: 100, height: 100,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: context.colors.tint.withValues(alpha: _opacity.value),
                                  width: 2,
                                ),
                              ),
                            ),
                          ),
                        ),
                        // inner ring
                        Container(
                          width: 88, height: 88,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(0x33FFFFFF), width: 3),
                          ),
                          child: const Center(child: Text('🔐', style: TextStyle(fontSize: 44))),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Text('Face ID 解锁', style: TextStyle(fontSize: 14, color: context.colors.fg2)),
                const SizedBox(height: 48),
                CupertinoButton(
                  onPressed: _authenticate,
                  child: Text('使用密码解锁', style: TextStyle(fontSize: 15, color: context.colors.tint)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LockBackground extends StatelessWidget {
  const _LockBackground();

  @override
  Widget build(BuildContext context) {
    final isDark = CupertinoTheme.brightnessOf(context) == Brightness.dark;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          stops: const [0, .6, 1],
          colors: isDark
              ? const [Color(0xFF0D0D0F), Color(0xFF1A1A2E), Color(0xFF0D0D0F)]
              : const [Color(0xFFDDE6F0), Color(0xFFC9D8EC), Color(0xFFDDE6F0)],
        ),
      ),
    );
  }
}

class _BlurCard extends StatelessWidget {
  const _BlurCard({required this.width, required this.height, required this.color});
  final double width;
  final double height;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(width: width, height: height, color: color),
      ),
    );
  }
}
