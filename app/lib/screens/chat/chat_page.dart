import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/session_summary.dart';
import '../../state/chat_provider.dart';
import '../../state/sessions_provider.dart';
import '../new_session/new_session_flow.dart';
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
    // Load history for completed sessions
    if (widget.initialSession != null &&
        widget.initialSession!.status != SessionStatus.running) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(chatProvider.notifier).loadHistory(
              widget.sessionId,
              widget.initialSession!.workspacePath,
            );
      });
    }
  }

  @override
  void dispose() {
    _statesSub?.cancel();
    super.dispose();
  }

  void _handleCancel() {
    final sessions = ref.read(sessionsProvider);
    final found = sessions.cast<SessionSummary?>().firstWhere(
      (s) => s!.sessionId == widget.sessionId,
      orElse: () => null,
    );
    if (found != null && found.status == SessionStatus.running) {
      showCupertinoDialog<void>(
        context: context,
        builder: (_) => CupertinoAlertDialog(
          title: const Text('会话仍在运行'),
          content: const Text('确定要离开吗？会话将在后台继续运行。'),
          actions: [
            CupertinoDialogAction(child: const Text('留在会话'), onPressed: () => Navigator.pop(context)),
            CupertinoDialogAction(isDestructiveAction: true, child: const Text('离开'), onPressed: () => Navigator.of(context).pop()),
          ],
        ),
      );
      return;
    }
    Navigator.of(context).pop();
  }

  void _showWorkspaceSwitch(SessionSummary session) {
    showCupertinoModalPopup<void>(
      context: context,
      builder:
          (_) => WorkspaceSwitchSheet(
            currentPath: session.workspacePath,
            onSwitch: (newPath) {
              final normalized = newPath.trim();
              if (normalized.isEmpty || normalized == session.workspacePath) {
                return;
              }
              context.push(
                '/new-session',
                extra: NewSessionFlowArgs(
                  preferredDeviceId: session.deviceId,
                  workspacePath: normalized,
                  agentType: session.agentType,
                ),
              );
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

    final inputEnabled =
        session.status == SessionStatus.running &&
        _connState == WsConnectionState.online;

    final isDone = session.status == SessionStatus.done;

    // Compute total tokens
    final items = ref.watch(chatProvider.select((m) => m[widget.sessionId] ?? []));
    int totalIn = 0, totalOut = 0;
    for (final item in items) {
      totalIn += item.inputTokens ?? 0;
      totalOut += item.outputTokens ?? 0;
    } 

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      child: Column(
        children: [
          ChatHeader(
            session: session,
            onCancel: _handleCancel,
            onWorkspaceSwitch: () => _showWorkspaceSwitch(session),
            totalInputTokens: totalIn > 0 ? totalIn : null,
            totalOutputTokens: totalOut > 0 ? totalOut : null,
          ),
          ChatStatusBanner(state: _connState, sessionStatus: session.status),
          Expanded(
            child: ChatTimeline(
              sessionId: widget.sessionId,
              workspacePath: session.workspacePath,
            ),
          ),
          if (isDone)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: SizedBox(
                width: double.infinity,
                child: CupertinoButton.filled(
                  onPressed: () {
                    context.push(
                      '/new-session',
                      extra: NewSessionFlowArgs(
                        workspacePath: session.workspacePath,
                        agentType: session.agentType,
                        resumeSessionId: widget.sessionId,
                      ),
                    );
                  },
                  child: const Text('继续对话'),
                ),
              ),
            ),
          ChatInputBar(
            sessionId: widget.sessionId,
            enabled: inputEnabled,
            disabledPlaceholder: _disabledPlaceholder(session.status),
          ),
        ],
      ),
    );
  }

  String _disabledPlaceholder(SessionStatus sessionStatus) {
    switch (sessionStatus) {
      case SessionStatus.offline:
        return '该会话已失效';
      case SessionStatus.done:
        return '该会话已结束';
      case SessionStatus.replaying:
        return '同步消息中…';
      case SessionStatus.running:
        break;
    }
    return switch (_connState) {
      WsConnectionState.connecting => '连接中…',
      WsConnectionState.replaying => '同步消息中…',
      WsConnectionState.offline => '已断线，正在重连',
      WsConnectionState.authExpired => '会话已过期，请重新配对',
      _ => '该会话暂时不可发送',
    };
  }
}
