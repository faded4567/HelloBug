import 'package:flutter/cupertino.dart';
import '../../models/session_summary.dart';
import '../../transport/connection_state.dart';
import '../../widgets/session_activity_banner.dart';

class ChatStatusBanner extends StatelessWidget {
  const ChatStatusBanner({
    super.key,
    required this.state,
    required this.sessionStatus,
  });
  final WsConnectionState state;
  final SessionStatus sessionStatus;

  @override
  Widget build(BuildContext context) => SessionActivityBanner(
    connectionState: state,
    sessionStatus: sessionStatus,
    offlineMessage: '该会话已失效，无法继续发送新消息',
    doneMessage: '该会话已结束，无法继续发送新消息',
  );
}
