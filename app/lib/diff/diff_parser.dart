enum DiffLineType { context, added, removed }

class DiffLine {
  const DiffLine(this.type, this.content, {this.oldNo, this.newNo});
  final DiffLineType type;
  final String content;
  final int? oldNo;
  final int? newNo;
}

class DiffHunk {
  DiffHunk({required this.header, required this.oldStart, required this.newStart})
      : lines = [];
  final String header;
  final List<DiffLine> lines;
  final int oldStart;
  final int newStart;
}

List<DiffHunk> parseDiff(String unified) {
  final hunks = <DiffHunk>[];
  DiffHunk? cur;
  var oldNo = 0, newNo = 0;
  for (final raw in unified.split('\n')) {
    if (raw.startsWith('@@ ')) {
      if (cur != null) hunks.add(cur);
      final m = RegExp(r'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@').firstMatch(raw);
      oldNo = int.tryParse(m?.group(1) ?? '') ?? 1;
      newNo = int.tryParse(m?.group(2) ?? '') ?? 1;
      cur = DiffHunk(header: raw, oldStart: oldNo, newStart: newNo);
    } else if (cur != null) {
      if (raw.startsWith('+')) {
        cur.lines.add(DiffLine(DiffLineType.added, raw.substring(1), newNo: newNo++));
      } else if (raw.startsWith('-')) {
        cur.lines.add(DiffLine(DiffLineType.removed, raw.substring(1), oldNo: oldNo++));
      } else if (raw.startsWith(' ')) {
        cur.lines.add(DiffLine(DiffLineType.context, raw.substring(1), oldNo: oldNo++, newNo: newNo++));
      }
    }
  }
  if (cur != null) hunks.add(cur);
  return hunks;
}
