import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

/// Pairing code expired page — wireframe 48.
///
/// Shown when the daemon-side pairing code has timed out.
/// Pushed on top of the pairing flow.
class PairingExpiredPage extends StatelessWidget {
  const PairingExpiredPage({
    super.key,
    this.expiredCode,
    this.renewCommand = 'hellobug pair --renew',
    this.macShortName,
  });

  /// The expired code, e.g. "ABCD-1234-EFGH"
  final String? expiredCode;

  /// Command to run on Mac
  final String renewCommand;

  /// Optional short Mac hostname (unused in UI, reserved)
  final String? macShortName;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('配对', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              const Text('⏱️', style: TextStyle(fontSize: 56)),
              const SizedBox(height: 16),
              const Text(
                '配对码已过期',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              Text(
                '二维码或配对码已超时失效。\n请在 Mac 端重新生成配对码。',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color: c.fg2,
                  height: 1.7,
                ),
              ),
              if (expiredCode != null && expiredCode!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.orange.withValues(alpha: .1),
                    border: Border.all(
                      color: AppColors.orange.withValues(alpha: .25),
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '已输入的配对码：',
                        style: TextStyle(
                          fontSize: 13,
                          color: AppColors.orange,
                          height: 1.6,
                        ),
                      ),
                      Text(
                        expiredCode!,
                        style: TextStyle(
                          fontSize: 16,
                          color: c.fg3,
                          letterSpacing: 1.5,
                          fontFamily: 'SF Mono',
                          decoration: TextDecoration.lineThrough,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                alignment: Alignment.centerLeft,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '在 Mac 上执行：',
                      style: TextStyle(fontSize: 13, color: c.fg3),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      renewCommand,
                      style: TextStyle(
                        fontSize: 12,
                        color: c.tint,
                        fontFamily: 'SF Mono',
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: CupertinoButton.filled(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('重新扫码'),
                ),
              ),
              CupertinoButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text(
                  '手动输入新配对码',
                  style: TextStyle(fontSize: 14, color: c.tint),
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
