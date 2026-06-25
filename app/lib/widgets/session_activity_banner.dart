import 'package:flutter/cupertino.dart';

import '../models/session_summary.dart';
import '../theme/index.dart';
import '../transport/connection_state.dart';

class SessionActivityBanner extends StatelessWidget {
  const SessionActivityBanner({
    super.key,
    required this.connectionState,
    required this.sessionStatus,
    required this.offlineMessage,
    required this.doneMessage,
  });

  final WsConnectionState connectionState;
  final SessionStatus sessionStatus;
  final String offlineMessage;
  final String doneMessage;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (text, color) = switch (sessionStatus) {
      SessionStatus.offline => (offlineMessage, AppColors.red),
      SessionStatus.done => (doneMessage, c.fg2),
      _ => _connectionBanner(c),
    };
    if (text.isEmpty) {
      return const SizedBox.shrink();
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 6),
      color: color.withValues(alpha: .12),
      child: Text(
        text,
        style: TextStyle(fontSize: 12, color: color),
        textAlign: TextAlign.center,
      ),
    );
  }

  (String, Color) _connectionBanner(ThemeColors colors) {
    return switch (connectionState) {
      WsConnectionState.connecting => ('连接中…', colors.fg2),
      WsConnectionState.replaying => ('同步消息中…', colors.tint),
      WsConnectionState.offline => ('已断线，正在重连', AppColors.orange),
      WsConnectionState.authExpired => ('会话已过期，请重新配对', AppColors.red),
      _ => ('', colors.fg2),
    };
  }
}
