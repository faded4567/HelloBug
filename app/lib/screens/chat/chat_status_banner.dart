import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';
import '../../transport/connection_state.dart';

class ChatStatusBanner extends StatelessWidget {
  const ChatStatusBanner({super.key, required this.state});
  final WsConnectionState state;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (text, color) = switch (state) {
      WsConnectionState.connecting  => ('连接中…', c.fg2),
      WsConnectionState.replaying   => ('同步消息中…', c.tint),
      WsConnectionState.offline     => ('已断线 — 正在重连', AppColors.orange),
      WsConnectionState.authExpired => ('会话已过期，请重新配对', AppColors.red),
      _                             => ('', c.fg2),
    };
    if (text.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 6),
      color: color.withValues(alpha: .12),
      child: Text(text, style: TextStyle(fontSize: 12, color: color), textAlign: TextAlign.center),
    );
  }
}
