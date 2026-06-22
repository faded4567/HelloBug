import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class ToolUseCard extends StatefulWidget {
  const ToolUseCard({super.key, required this.toolName, this.input});
  final String toolName;
  final String? input;

  @override
  State<ToolUseCard> createState() => _ToolUseCardState();
}

class _ToolUseCardState extends State<ToolUseCard> {
  bool _expanded = false;

  String get _label {
    final parts = widget.toolName.split('_');
    return parts.map((p) => p.isEmpty ? '' : p[0].toUpperCase() + p.substring(1)).join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(10)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        GestureDetector(
          onTap: widget.input != null ? () => setState(() => _expanded = !_expanded) : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(children: [
              Text('⚙', style: TextStyle(fontSize: 13, color: c.fg2)),
              const SizedBox(width: 6),
              Text(_label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: c.fg2)),
              const Spacer(),
              if (widget.input != null)
                Icon(
                  _expanded ? CupertinoIcons.chevron_up : CupertinoIcons.chevron_down,
                  size: 12, color: c.fg3,
                ),
            ]),
          ),
        ),
        if (_expanded && widget.input != null) ...[
          Container(height: 1, color: c.separator),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(widget.input!, style: TextStyle(fontSize: 12, color: c.fg2, fontFamily: 'Menlo')),
          ),
        ],
      ]),
    );
  }
}

class ToolResultCard extends StatefulWidget {
  const ToolResultCard({super.key, required this.output});
  final String output;

  @override
  State<ToolResultCard> createState() => _ToolResultCardState();
}

class _ToolResultCardState extends State<ToolResultCard> {
  bool _expanded = false;
  static const _previewLen = 200;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final truncated = !_expanded && widget.output.length > _previewLen;
    final shown = truncated ? widget.output.substring(0, _previewLen) : widget.output;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.bg3, borderRadius: BorderRadius.circular(10)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(shown + (truncated ? '…' : ''),
          style: TextStyle(fontSize: 12, color: c.fg2, fontFamily: 'Menlo', height: 1.5)),
        if (widget.output.length > _previewLen) ...[
          const SizedBox(height: 6),
          GestureDetector(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Text(_expanded ? '收起' : '展开全部',
              style: TextStyle(fontSize: 12, color: c.tint)),
          ),
        ],
      ]),
    );
  }
}
