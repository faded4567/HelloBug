import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';
import '../../models/session_summary.dart';
import '../../state/sessions_provider.dart';
import '../../state/workspace_history_provider.dart';
import '../../theme/index.dart';
import '../../transport/connection_state.dart';
import '../../transport/ws_provider.dart';
import '../../widgets/session_activity_banner.dart';
import 'terminal_controller.dart';
import 'terminal_toolbar.dart';

class TerminalPage extends ConsumerStatefulWidget {
  const TerminalPage({super.key, required this.sessionId, this.initialSession});
  final String sessionId;
  final SessionSummary? initialSession;

  @override
  ConsumerState<TerminalPage> createState() => _TerminalPageState();
}

class _TerminalPageState extends ConsumerState<TerminalPage> {
  PtySessionController? _ctrl;
  WsConnectionState _connState = WsConnectionState.online;
  StreamSubscription<WsConnectionState>? _statesSub;
  String? _lastSyncedWorkspacePath;

  @override
  void initState() {
    super.initState();
    final ws = ref.read(wsClientProvider);
    if (ws != null) {
      _ctrl = PtySessionController(sessionId: widget.sessionId, wsClient: ws);
      _ctrl!.start();
      _statesSub = ws.states.listen((state) {
        if (mounted) {
          setState(() => _connState = state);
        }
      });
    }
  }

  @override
  void dispose() {
    _statesSub?.cancel();
    _ctrl?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final sessions = ref.watch(sessionsProvider);
    final found = sessions.cast<SessionSummary?>().firstWhere(
      (session) => session!.sessionId == widget.sessionId,
      orElse: () => null,
    );
    final session = found ?? widget.initialSession;
    if (session == null) {
      return CupertinoPageScaffold(
        backgroundColor: CupertinoColors.black,
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

    final terminalEnabled =
        session.status == SessionStatus.running &&
        _connState == WsConnectionState.online;
    final ctrl = _ctrl;
    if (ctrl != null && ctrl.enabled != terminalEnabled) {
      ctrl.setEnabled(terminalEnabled);
    }
    _scheduleWorkspaceSync(session.workspacePath);
    return CupertinoPageScaffold(
      backgroundColor: CupertinoColors.black,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('终端', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child:
            ctrl == null
                ? Center(
                  child: Text(
                    '终端未连接',
                    style: TextStyle(fontSize: 15, color: c.fg2),
                  ),
                )
                : Column(
                  children: [
                    SessionActivityBanner(
                      connectionState: _connState,
                      sessionStatus: session.status,
                      offlineMessage: '该终端会话已失效，无法继续输入命令',
                      doneMessage: '该终端会话已结束，无法继续输入命令',
                    ),
                    Expanded(
                      child: TerminalView(
                        ctrl.terminal,
                        controller: ctrl.terminalCtrl,
                        autofocus: terminalEnabled,
                        readOnly: !terminalEnabled,
                        keyboardType: TextInputType.visiblePassword,
                        keyboardAppearance: Brightness.dark,
                        theme: const TerminalTheme(
                          cursor: Color(0xFF30D158),
                          selection: Color(0x6630D158),
                          foreground: Color(0xFFE5E5EA),
                          background: Color(0xFF000000),
                          black: Color(0xFF1C1C1E),
                          white: Color(0xFFE5E5EA),
                          red: Color(0xFFFF453A),
                          green: Color(0xFF30D158),
                          yellow: Color(0xFFFFD60A),
                          blue: Color(0xFF0A84FF),
                          magenta: Color(0xFFBF5AF2),
                          cyan: Color(0xFF5AC8FA),
                          brightBlack: Color(0xFF3A3A3C),
                          brightWhite: Color(0xFFFFFFFF),
                          brightRed: Color(0xFFFF6961),
                          brightGreen: Color(0xFF6CD97E),
                          brightYellow: Color(0xFFFFE55C),
                          brightBlue: Color(0xFF409CFF),
                          brightMagenta: Color(0xFFDA8FFF),
                          brightCyan: Color(0xFF70D7FF),
                          searchHitBackground: Color(0xFFFFD60A),
                          searchHitBackgroundCurrent: Color(0xFFFF9F0A),
                          searchHitForeground: Color(0xFF000000),
                        ),
                        onKeyEvent: (node, event) => KeyEventResult.ignored,
                      ),
                    ),
                    TerminalToolbar(
                      terminal: ctrl.terminal,
                      enabled: terminalEnabled,
                    ),
                  ],
                ),
      ),
    );
  }

  void _scheduleWorkspaceSync(String workspacePath) {
    final normalized = workspacePath.trim();
    if (normalized.isEmpty || normalized == _lastSyncedWorkspacePath) {
      return;
    }
    _lastSyncedWorkspacePath = normalized;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      unawaited(ref.read(workspaceHistoryProvider.notifier).visit(normalized));
    });
  }
}
