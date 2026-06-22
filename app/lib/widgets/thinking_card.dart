import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class ThinkingCard extends StatefulWidget {
  const ThinkingCard({super.key, required this.thinking});
  final String thinking;

  @override
  State<ThinkingCard> createState() => _ThinkingCardState();
}

class _ThinkingCardState extends State<ThinkingCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      decoration: BoxDecoration(color: c.bg3, borderRadius: BorderRadius.circular(10)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        GestureDetector(
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(children: [
              Text('💭', style: const TextStyle(fontSize: 13)),
              const SizedBox(width: 6),
              Text('思考过程', style: TextStyle(fontSize: 13, color: c.fg3)),
              const Spacer(),
              Icon(_expanded ? CupertinoIcons.chevron_up : CupertinoIcons.chevron_down,
                size: 12, color: c.fg3),
            ]),
          ),
        ),
        if (_expanded) ...[
          Container(height: 1, color: c.separator),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(widget.thinking,
              style: TextStyle(fontSize: 13, color: c.fg3, height: 1.5, fontStyle: FontStyle.italic)),
          ),
        ],
      ]),
    );
  }
}
