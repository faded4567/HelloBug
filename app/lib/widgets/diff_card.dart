import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';
import '../diff/diff_parser.dart';
import '../screens/diff/diff_page.dart';
import '../theme/index.dart';

class DiffCard extends StatelessWidget {
  const DiffCard({super.key, required this.filePath, required this.diff});
  final String filePath;
  final String diff;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final hunks = parseDiff(diff);
    var added = 0, removed = 0;
    for (final h in hunks) {
      for (final l in h.lines) {
        if (l.type == DiffLineType.added) added++;
        if (l.type == DiffLineType.removed) removed++;
      }
    }
    final fileName = filePath.split('/').last;

    return GestureDetector(
      onTap: () => context.push('/diff', extra: DiffPageArgs(filePath: filePath, diff: diff)),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: c.bg2,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: c.separator),
        ),
        child: Row(children: [
          const Text('📄', style: TextStyle(fontSize: 16)),
          const SizedBox(width: 8),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(fileName,
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.fg, fontFamily: 'Menlo'),
              maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            Row(children: [
              if (added > 0) Text('+$added', style: const TextStyle(fontSize: 12, color: AppColors.addFg)),
              if (added > 0 && removed > 0) const SizedBox(width: 6),
              if (removed > 0) Text('-$removed', style: const TextStyle(fontSize: 12, color: AppColors.delFg)),
            ]),
          ])),
          Icon(CupertinoIcons.chevron_right, size: 14, color: c.fg3),
        ]),
      ),
    );
  }
}
