import 'package:flutter/cupertino.dart';
import '../theme/index.dart';

/// Push notification landing page — wireframe 53.
///
/// Shown briefly when the app is opened via a push notification,
/// while navigating to the target session/danger.
class PushLandingPage extends StatefulWidget {
  const PushLandingPage({
    super.key,
    this.message,
    this.sessionId,
  });

  final String? message;
  final String? sessionId;

  @override
  State<PushLandingPage> createState() => _PushLandingPageState();
}

class _PushLandingPageState extends State<PushLandingPage> {
  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CupertinoActivityIndicator(radius: 14),
                const SizedBox(height: 14),
                Text(
                  '正在跳转到会话…',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: c.fg,
                  ),
                ),
                if (widget.message != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    '来自推送通知：\n${widget.message}',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      color: c.fg3,
                      height: 1.6,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
