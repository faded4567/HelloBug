import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

/// Danger result notification sheet.
///
/// Shown as a bottom sheet when a danger.result arrives
/// that the user needs to be aware of (timed_out, not_found, biometric_required, etc).
class DangerResultSheet extends StatelessWidget {
  const DangerResultSheet({
    super.key,
    required this.status,
    required this.message,
    this.toolName,
    this.toolPath,
  });

  final String status;
  final String message;
  final String? toolName;
  final String? toolPath;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (icon, title, color) = _statusStyle(status);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // handle
            Container(
              width: 36,
              height: 5,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: c.fg3,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            // icon
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color.withValues(alpha: .15),
              ),
              alignment: Alignment.center,
              child: Text(icon, style: const TextStyle(fontSize: 28)),
            ),
            const SizedBox(height: 12),
            // title
            Text(
              title,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            const SizedBox(height: 8),
            // message
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: c.fg2, height: 1.6),
            ),
            if (toolName != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: c.bg2,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('📖', style: TextStyle(fontSize: 14)),
                    const SizedBox(width: 6),
                    Text(
                      toolName!,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: c.fg,
                      ),
                    ),
                    if (toolPath != null && toolPath!.isNotEmpty) ...[
                      const SizedBox(width: 6),
                      Text(
                        toolPath!,
                        style: TextStyle(
                          fontSize: 11,
                          color: c.fg3,
                          fontFamily: 'SF Mono',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: CupertinoButton.filled(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('知道了'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  (String icon, String title, Color color) _statusStyle(String status) {
    switch (status) {
      case 'timed_out':
        return ('⏱️', '危险操作已超时', AppColors.orange);
      case 'not_found':
        return ('❓', '操作已失效', AppColors.orange);
      case 'biometric_required':
        return ('🔐', '需要生物验证', AppColors.orange);
      case 'denied':
        return ('🚫', '操作已拒绝', AppColors.red);
      case 'approved':
        return ('✅', '操作已批准', AppColors.green);
      default:
        return ('⚠️', '操作未完成', AppColors.orange);
    }
  }
}
