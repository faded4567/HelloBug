import 'package:flutter/cupertino.dart';
import '../../diff/diff_parser.dart';
import '../../diff/unified_diff_view.dart';
import '../../theme/index.dart';

class DiffPageArgs {
  final String filePath;
  final String diff;
  const DiffPageArgs({required this.filePath, required this.diff});
}

class DiffPage extends StatefulWidget {
  const DiffPage({super.key, required this.args});
  final DiffPageArgs args;

  @override
  State<DiffPage> createState() => _DiffPageState();
}

class _DiffPageState extends State<DiffPage> {
  late final List<DiffHunk> _hunks;
  late final List<int> _hunkOffsets;
  final _scroll = ScrollController();
  bool _splitMode = false;
  int _hunkIdx = 0;

  @override
  void initState() {
    super.initState();
    _hunks = parseDiff(widget.args.diff);
    _hunkOffsets = hunkHeaderIndices(_hunks);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _jump(int i) {
    if (i < 0 || i >= _hunks.length) return;
    setState(() => _hunkIdx = i);
    _scroll.jumpTo(_hunkOffsets[i] * _lineH);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final fileName = widget.args.filePath.split('/').last;
    var added = 0, removed = 0;
    for (final h in _hunks) {
      for (final l in h.lines) {
        if (l.type == DiffLineType.added) added++;
        if (l.type == DiffLineType.removed) removed++;
      }
    }
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(fileName, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.fg)),
          Row(mainAxisSize: MainAxisSize.min, children: [
            if (added > 0) Text('+$added', style: const TextStyle(fontSize: 11, color: AppColors.addFg)),
            if (added > 0 && removed > 0) const SizedBox(width: 4),
            if (removed > 0) Text('-$removed', style: const TextStyle(fontSize: 11, color: AppColors.delFg)),
          ]),
        ]),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: () => setState(() {
            _splitMode = !_splitMode;
            _scroll.jumpTo(0);
            _hunkIdx = 0;
          }),
          child: Text(_splitMode ? '统一' : '分栏', style: TextStyle(fontSize: 14, color: c.tint)),
        ),
      ),
      child: Column(children: [
        if (_hunks.length > 1)
          Container(
            height: 36,
            color: c.bg2,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(children: [
              Text('${_hunkIdx + 1} / ${_hunks.length} hunks',
                style: TextStyle(fontSize: 12, color: c.fg2, fontFamily: 'Menlo')),
              const Spacer(),
              CupertinoButton(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                onPressed: _hunkIdx > 0 ? () => _jump(_hunkIdx - 1) : null,
                child: Text('↑', style: TextStyle(fontSize: 18, color: _hunkIdx > 0 ? c.tint : c.fg3)),
              ),
              CupertinoButton(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                onPressed: _hunkIdx < _hunks.length - 1 ? () => _jump(_hunkIdx + 1) : null,
                child: Text('↓', style: TextStyle(fontSize: 18, color: _hunkIdx < _hunks.length - 1 ? c.tint : c.fg3)),
              ),
            ]),
          ),
        Expanded(
          child: _splitMode
              ? SplitDiffView(hunks: _hunks, scrollController: _scroll)
              : UnifiedDiffView(hunks: _hunks, scrollController: _scroll),
        ),
      ]),
    );
  }
}

const _lineH = 22.0;
