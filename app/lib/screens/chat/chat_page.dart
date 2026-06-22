import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/session_summary.dart';
import '../../state/sessions_provider.dart';
import '../../theme/index.dart';
import '../../transport/connection_state.dart';
import '../../transport/ws_provider.dart';
import '../../widgets/workspace_switch/workspace_switch_sheet.dart';
import 'chat_header.dart';
import 'chat_input_bar.dart';
import 'chat_status_banner.dart';
import 'chat_timeline.dart';

class ChatPage extends ConsumerStatefulWidget {
  const ChatPage({super.key, required this.sessionId, this.initialSession});
  final String sessionId;
  final SessionSummary? initialSession;

  @override
  ConsumerState<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends ConsumerState<ChatPage> {
  WsConnectionState _connState = WsConnectionState.online;

  @override
  void initState() {
    super.initState();
    final client = ref.read(wsClientProvider);
    client?.states.listen((s) {
      if (mounted) setState(() => _connState = s);
    });
  }

  void _handleCancel() {
    // navigate back without ending session — session stays in list
    Navigator.of(context).pop();
  }

  void _showWorkspaceSwitch(String currentPath) {
    showCupertinoModalPopup<void>(
      context: context,
      builder: (_) => WorkspaceSwitchSheet(
        currentPath: currentPath,
        onSwitch: (newPath) {
          // record visit; actual session re-routing handled by daemon side
          // UI just reflects the new path in the header via session update
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionsProvider).firstWhere(
      (s) => s.sessionId == widget.sessionId,
      orElse: () => widget.initialSession ?? SessionSummary(
        sessionId: widget.sessionId,
        deviceId: '',
        workspacePath: '~',
        agentType: 'shell',
      ),
    );

    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: Column(children: [
        ChatHeader(
          session: session,
          onCancel: _handleCancel,
          onWorkspaceSwitch: () => _showWorkspaceSwitch(session.workspacePath),
        ),
        ChatStatusBanner(state: _connState),
        Expanded(child: ChatTimeline(sessionId: widget.sessionId)),
        ChatInputBar(sessionId: widget.sessionId),
      ]),
    );
  }
}
