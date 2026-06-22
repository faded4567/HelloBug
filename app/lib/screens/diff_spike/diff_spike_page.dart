import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';
import 'diff_parser.dart';
import 'unified_diff_view.dart';

class DiffSpikePage extends StatefulWidget {
  const DiffSpikePage({super.key});

  @override
  State<DiffSpikePage> createState() => _DiffSpikePageState();
}

class _DiffSpikePageState extends State<DiffSpikePage> {
  late final List<DiffHunk> _hunks;
  late final List<int> _hunkOffsets;
  final _scrollCtrl = ScrollController();
  var _splitMode = false;
  var _hunkIndex = 0;

  @override
  void initState() {
    super.initState();
    _hunks = parseDiff(_generateDiff());
    _hunkOffsets = hunkHeaderIndices(_hunks);
  }

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _jumpToHunk(int i) {
    if (i < 0 || i >= _hunks.length) return;
    setState(() => _hunkIndex = i);
    _scrollCtrl.jumpTo(_hunkOffsets[i] * _lineH);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final totalLines = _hunks.fold(0, (s, h) => s + 1 + h.lines.length);

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('Spike F3 — Diff 渲染', style: TextStyle(color: c.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          child: Text(_splitMode ? '统一' : '分栏', style: TextStyle(fontSize: 14, color: c.tint)),
          onPressed: () => setState(() {
            _splitMode = !_splitMode;
            _scrollCtrl.jumpTo(0);
            _hunkIndex = 0;
          }),
        ),
      ),
      child: Column(children: [
        // stats + hunk navigation bar
        Container(
          height: 40,
          color: c.bg2,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(children: [
            Text(
              '${_hunks.length} hunks · $totalLines lines · hunk ${_hunkIndex + 1}/${_hunks.length}',
              style: TextStyle(fontSize: 12, color: c.fg2, fontFamily: 'Menlo'),
            ),
            const Spacer(),
            CupertinoButton(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              onPressed: _hunkIndex > 0 ? () => _jumpToHunk(_hunkIndex - 1) : null,
              child: Text('↑', style: TextStyle(fontSize: 18, color: _hunkIndex > 0 ? c.tint : c.fg3)),
            ),
            CupertinoButton(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              onPressed: _hunkIndex < _hunks.length - 1 ? () => _jumpToHunk(_hunkIndex + 1) : null,
              child: Text('↓', style: TextStyle(fontSize: 18, color: _hunkIndex < _hunks.length - 1 ? c.tint : c.fg3)),
            ),
          ]),
        ),
        Container(height: 1, color: c.separator),
        // diff view
        Expanded(
          child: _splitMode
              ? SplitDiffView(hunks: _hunks, scrollController: _scrollCtrl)
              : UnifiedDiffView(hunks: _hunks, scrollController: _scrollCtrl),
        ),
      ]),
    );
  }
}

const _lineH = 22.0;

String _generateDiff() {
  final sb = StringBuffer();
  var oldL = 1, newL = 1;
  for (var h = 0; h < 100; h++) {
    sb.writeln('@@ -$oldL,18 +$newL,19 @@ async function processChunk(batch: Batch<DataItem>, opts: ProcessOptions): Promise<Result[]> {');
    for (var i = 0; i < 5; i++) {
      sb.writeln('   const key$i = buildCacheKey({ namespace: "hellobug:v2", batchId: batch.id, index: ${oldL + i}, region: opts.region ?? "us-east-1" });');
      oldL++; newL++;
    }
    sb.writeln('-  const staleData = await legacyFetcher.get(key0, { timeout: 3000, retries: 2 });  // TODO: migrate to v3 API before 2026-07-01');
    sb.writeln('-  const output = JSON.stringify(staleData, null, 2);  // wasteful: stringify + re-parse downstream');
    oldL += 2;
    sb.writeln('+  const freshData = await modernFetcher.get(key0, { timeout: 5000, retries: 3, cachePolicy: "stale-while-revalidate", compress: true });');
    sb.writeln('+  const output = formatResponse(freshData, { indent: 2, sortKeys: true, stripNulls: false, maxDepth: 8 });');
    sb.writeln('+  logger.debug("fetch ok", { hunk: ${h + 1}, latency: performance.now() - t0, bytes: output.length, region: opts.region });');
    newL += 3;
    for (var i = 0; i < 8; i++) {
      sb.writeln('   await cache.set(key$i, output, { ttl: ${(h + 1) * 60}, compress: true, namespace: "hellobug:results:${h + 1}" });');
      oldL++; newL++;
    }
    sb.writeln(' ');
    oldL++; newL++;
  }
  return sb.toString();
}
