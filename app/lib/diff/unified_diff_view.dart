import 'dart:math' show max;
import 'package:flutter/cupertino.dart';
import '../theme/index.dart';
import 'diff_parser.dart';

const _lineH = 22.0;
const _gutterW = 72.0;
const _minContentW = 1000.0;

class UnifiedDiffView extends StatelessWidget {
  const UnifiedDiffView({super.key, required this.hunks, required this.scrollController});
  final List<DiffHunk> hunks;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    final items = _flattenUnified(hunks);
    return _ScrollBox(
      scrollController: scrollController,
      itemCount: items.length,
      itemBuilder: (ctx, i) {
        final it = items[i];
        return it.header != null ? _HunkHeader(header: it.header!) : _UnifiedLine(line: it.line!);
      },
    );
  }
}

class SplitDiffView extends StatelessWidget {
  const SplitDiffView({super.key, required this.hunks, required this.scrollController});
  final List<DiffHunk> hunks;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    final rows = _flattenSplit(hunks);
    return _ScrollBox(
      scrollController: scrollController,
      itemCount: rows.length,
      itemBuilder: (ctx, i) {
        final r = rows[i];
        return r.header != null ? _HunkHeader(header: r.header!) : _SplitLine(left: r.left, right: r.right);
      },
    );
  }
}

class _ScrollBox extends StatelessWidget {
  const _ScrollBox({required this.scrollController, required this.itemCount, required this.itemBuilder});
  final ScrollController scrollController;
  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (ctx, constraints) {
      final w = max(constraints.maxWidth, _gutterW + _minContentW);
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: w,
          height: constraints.maxHeight,
          child: ListView.builder(
            controller: scrollController,
            itemCount: itemCount,
            itemExtent: _lineH,
            itemBuilder: itemBuilder,
          ),
        ),
      );
    });
  }
}

class _HunkHeader extends StatelessWidget {
  const _HunkHeader({required this.header});
  final String header;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return ColoredBox(
      color: c.bg3,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(header, style: TextStyle(fontSize: 11, color: c.tint, fontFamily: 'Menlo'), maxLines: 1, overflow: TextOverflow.clip),
        ),
      ),
    );
  }
}

class _UnifiedLine extends StatelessWidget {
  const _UnifiedLine({required this.line});
  final DiffLine line;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (bg, fg, sign) = _lineStyle(line.type, c);
    final noStyle = TextStyle(fontSize: 11, color: c.fg3, fontFamily: 'Menlo');
    return ColoredBox(
      color: bg,
      child: Row(children: [
        SizedBox(width: 28, child: Text(line.oldNo?.toString() ?? '', style: noStyle, textAlign: TextAlign.right)),
        SizedBox(width: 28, child: Text(line.newNo?.toString() ?? '', style: noStyle, textAlign: TextAlign.right)),
        SizedBox(width: 16, child: Text(sign, style: TextStyle(fontSize: 12, color: fg, fontFamily: 'Menlo'), textAlign: TextAlign.center)),
        Expanded(child: Text(line.content, style: TextStyle(fontSize: 13, color: fg, fontFamily: 'Menlo'), maxLines: 1, overflow: TextOverflow.clip)),
      ]),
    );
  }
}

class _SplitLine extends StatelessWidget {
  const _SplitLine({this.left, this.right});
  final DiffLine? left;
  final DiffLine? right;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Row(children: [
      Expanded(child: _SplitHalf(line: left, side: 'left', colors: c)),
      Container(width: 1, height: _lineH, color: c.separator),
      Expanded(child: _SplitHalf(line: right, side: 'right', colors: c)),
    ]);
  }
}

class _SplitHalf extends StatelessWidget {
  const _SplitHalf({required this.line, required this.side, required this.colors});
  final DiffLine? line;
  final String side;
  final ThemeColors colors;

  @override
  Widget build(BuildContext context) {
    if (line == null) return const SizedBox.expand();
    final (bg, fg, _) = _lineStyle(line!.type, colors);
    final no = side == 'left' ? line!.oldNo : line!.newNo;
    final noStyle = TextStyle(fontSize: 11, color: colors.fg3, fontFamily: 'Menlo');
    return ColoredBox(
      color: bg,
      child: Row(children: [
        SizedBox(width: 28, child: Text(no?.toString() ?? '', style: noStyle, textAlign: TextAlign.right)),
        const SizedBox(width: 8),
        Expanded(child: Text(line!.content, style: TextStyle(fontSize: 13, color: fg, fontFamily: 'Menlo'), maxLines: 1, overflow: TextOverflow.clip)),
      ]),
    );
  }
}

(Color, Color, String) _lineStyle(DiffLineType type, ThemeColors c) =>
    switch (type) {
      DiffLineType.added   => (AppColors.addBg, AppColors.addFg, '+'),
      DiffLineType.removed => (AppColors.delBg, AppColors.delFg, '-'),
      DiffLineType.context => (const Color(0x00000000), c.fg, ' '),
    };

class _FlatItem {
  const _FlatItem({this.header, this.line});
  final String? header;
  final DiffLine? line;
}

List<_FlatItem> _flattenUnified(List<DiffHunk> hunks) {
  final items = <_FlatItem>[];
  for (final h in hunks) {
    items.add(_FlatItem(header: h.header));
    for (final l in h.lines) { items.add(_FlatItem(line: l)); }
  }
  return items;
}

class _SplitRow {
  const _SplitRow({this.header, this.left, this.right});
  final String? header;
  final DiffLine? left;
  final DiffLine? right;
}

List<_SplitRow> _flattenSplit(List<DiffHunk> hunks) {
  final rows = <_SplitRow>[];
  for (final h in hunks) {
    rows.add(_SplitRow(header: h.header));
    final lines = h.lines;
    var i = 0;
    while (i < lines.length) {
      final l = lines[i];
      if (l.type == DiffLineType.removed && i + 1 < lines.length && lines[i + 1].type == DiffLineType.added) {
        rows.add(_SplitRow(left: l, right: lines[i + 1]));
        i += 2;
      } else if (l.type == DiffLineType.removed) {
        rows.add(_SplitRow(left: l));
        i++;
      } else if (l.type == DiffLineType.added) {
        rows.add(_SplitRow(right: l));
        i++;
      } else {
        rows.add(_SplitRow(left: l, right: l));
        i++;
      }
    }
  }
  return rows;
}

List<int> hunkHeaderIndices(List<DiffHunk> hunks) {
  final indices = <int>[];
  var idx = 0;
  for (final h in hunks) {
    indices.add(idx);
    idx += 1 + h.lines.length;
  }
  return indices;
}
