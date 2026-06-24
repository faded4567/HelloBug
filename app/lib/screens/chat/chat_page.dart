import 'dart:async';

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
  StreamSubscription<WsConnectionState>? _statesSub;

  @override
  void initState() {
    super.initState();
    final client = ref.read(wsClientProvider);
    _statesSub = client?.states.listen((s) {
      if (mounted) setState(() => _connState = s);
    });
  }

  @override
  void dispose() {
    _statesSub?.cancel();
    super.dispose();
  }

  void _handleCancel() {
    // navigate back without ending session — session stays in list
    Navigator.of(context).pop();
  }

  void _showWorkspaceSwitch(String currentPath) {
    showCupertinoModalPopup<void>(
      context: context,
      builder:
          (_) => WorkspaceSwitchSheet(
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
    final sessions = ref.watch(sessionsProvider);
    final found = sessions.cast<SessionSummary?>().firstWhere(
      (s) => s!.sessionId == widget.sessionId,
      orElse: () => null,
    );
    final session = found ?? widget.initialSession;

    final c = context.colors;

    if (session == null) {
      return CupertinoPageScaffold(
        backgroundColor: c.bg,
        navigationBar: CupertinoNavigationBar(
          backgroundColor: c.bg,
          border: null,
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('会话不存在', style: TextStyle(fontSize: 17, color: c.fg)),
              const SizedBox(height: 8),
              CupertinoButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text('返回', style: TextStyle(color: c.tint)),
              ),
            ],
          ),
        ),
      );
    }

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: Column(
        children: [
          ChatHeader(
            session: session,
            onCancel: _handleCancel,
            onWorkspaceSwitch:
                () => _showWorkspaceSwitch(session.workspacePath),
          ),
          ChatStatusBanner(state: _connState),
          Expanded(child: ChatTimeline(sessionId: widget.sessionId)),
          ChatInputBar(sessionId: widget.sessionId),
        ],
      ),
    );
  }
}
