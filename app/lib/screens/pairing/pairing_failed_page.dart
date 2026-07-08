import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import '../../theme/index.dart';

/// Pairing failed page — for non-expired errors (connection refused, SAS mismatch, etc).
///
/// Differs from PairingExpiredPage which shows expired-code-specific UI.
class PairingFailedPage extends StatelessWidget {
  const PairingFailedPage({
    super.key,
    required this.errorMessage,
    this.errorCode,
    this.serverUrl,
    this.onRetry,
  });

  final String errorMessage;
  final String? errorCode;
  final String? serverUrl;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final isSas = errorCode == 'SAS_MISMATCH' ||
        errorMessage.contains('SAS') ||
        errorMessage.contains('核对');

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
              Text(
                isSas ? '🔐' : '❌',
                style: const TextStyle(fontSize: 56),
              ),
              const SizedBox(height: 16),
              Text(
                isSas ? '安全校验未通过' : '配对失败',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: isSas ? AppColors.orange : AppColors.red,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                errorMessage,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color: c.fg2,
                  height: 1.7,
                ),
              ),
              if (serverUrl != null && serverUrl!.isNotEmpty) ...[
                const SizedBox(height: 8),
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
                        '服务器地址',
                        style: TextStyle(
                          fontSize: 11,
                          color: c.fg3,
                          fontWeight: FontWeight.w600,
                          letterSpacing: .6,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        serverUrl!,
                        style: TextStyle(
                          fontSize: 12,
                          color: c.fg3,
                          fontFamily: 'SF Mono',
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              if (!isSas) ...[
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: c.bg2,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '可能原因',
                        style: TextStyle(
                          fontSize: 11,
                          color: c.fg3,
                          fontWeight: FontWeight.w600,
                          letterSpacing: .6,
                        ),
                      ),
                      const SizedBox(height: 8),
                      _Reason(text: 'Daemon 未在电脑上运行'),
                      _Reason(text: '配对码输入错误或已失效'),
                      _Reason(text: '中继服务器地址不正确'),
                      _Reason(text: '网络连接不可用'),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: CupertinoButton.filled(
                  onPressed: () {
                    Navigator.of(context).pop();
                    onRetry?.call();
                  },
                  child: const Text('重新尝试'),
                ),
              ),
              CupertinoButton(
                onPressed: () => context.go('/pairing'),
                child: Text(
                  '返回手动输入',
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

class _Reason extends StatelessWidget {
  const _Reason({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Text(
        '• $text',
        style: TextStyle(
          fontSize: 13,
          color: context.colors.fg2,
          height: 1.8,
        ),
      ),
    );
  }
}
