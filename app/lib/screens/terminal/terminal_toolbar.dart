import 'package:flutter/cupertino.dart';
import 'package:xterm/xterm.dart';
import '../../theme/index.dart';

class TerminalToolbar extends StatelessWidget {
  const TerminalToolbar({
    super.key,
    required this.terminal,
    this.enabled = true,
  });
  final Terminal terminal;
  final bool enabled;

  void _send(String seq) => terminal.paste(seq);

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final keys = [
      ('ESC', '\x1b'),
      ('TAB', '\t'),
      ('CTRL', null),
      ('↑', '\x1b[A'),
      ('↓', '\x1b[B'),
      ('←', '\x1b[D'),
      ('→', '\x1b[C'),
      ('↖', '\x1b[H'),
      ('↘', '\x1b[F'),
    ];
    return Container(
      height: 44,
      color: c.bg2,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        itemCount: keys.length,
        separatorBuilder: (_, __) => const SizedBox(width: 4),
        itemBuilder: (_, i) {
          final (label, seq) = keys[i];
          return CupertinoButton(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            minimumSize: const Size(36, 36),
            onPressed: enabled && seq != null ? () => _send(seq) : null,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontFamily: 'Menlo',
                color: enabled ? c.fg : c.fg3,
              ),
            ),
          );
        },
      ),
    );
  }
}
