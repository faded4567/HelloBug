import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import 'terminal_controller.dart';
import 'terminal_toolbar.dart';

class TerminalPage extends ConsumerStatefulWidget {
  const TerminalPage({super.key, required this.sessionId});
  final String sessionId;

  @override
  ConsumerState<TerminalPage> createState() => _TerminalPageState();
}

class _TerminalPageState extends ConsumerState<TerminalPage> {
  PtySessionController? _ctrl;

  @override
  void initState() {
    super.initState();
    final ws = ref.read(wsClientProvider);
    if (ws != null) {
      _ctrl = PtySessionController(sessionId: widget.sessionId, wsClient: ws);
      _ctrl!.start();
    }
  }

  @override
  void dispose() {
    _ctrl?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final ctrl = _ctrl;
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
                    Expanded(
                      child: TerminalView(
                        ctrl.terminal,
                        controller: ctrl.terminalCtrl,
                        autofocus: true,
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
                    TerminalToolbar(terminal: ctrl.terminal),
                  ],
                ),
      ),
    );
  }
}
