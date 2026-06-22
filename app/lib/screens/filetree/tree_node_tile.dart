import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';
import 'file_tree_controller.dart';

class TreeNodeTile extends StatelessWidget {
  const TreeNodeTile({super.key, required this.entry, required this.onTap});
  final FlatTreeEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final node = entry.node;
    final indent = 16.0 + entry.depth * 18.0;

    Widget leading;
    if (node.isDir) {
      if (node.loading) {
        leading = const SizedBox(width: 16, height: 16, child: CupertinoActivityIndicator(radius: 7));
      } else {
        leading = Icon(
          node.expanded ? CupertinoIcons.folder_open : CupertinoIcons.folder,
          size: 16, color: c.tint,
        );
      }
    } else {
      leading = Icon(CupertinoIcons.doc_text, size: 15, color: c.fg3);
    }

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        height: 38,
        padding: EdgeInsets.only(left: indent, right: 16),
        child: Row(children: [
          leading,
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              node.name,
              style: TextStyle(
                fontSize: 13,
                fontFamily: 'Menlo',
                color: c.fg,
                fontWeight: node.isDir ? FontWeight.w600 : FontWeight.normal,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (node.modified)
            Container(
              width: 7, height: 7,
              decoration: BoxDecoration(color: CupertinoColors.systemOrange, shape: BoxShape.circle),
            ),
        ]),
      ),
    );
  }
}
