import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../state/workspace_history_provider.dart';
import '../../theme/index.dart';

class WorkspaceSwitchSheet extends ConsumerStatefulWidget {
  const WorkspaceSwitchSheet({
    super.key,
    required this.currentPath,
    required this.onSwitch,
  });
  final String currentPath;
  final void Function(String path) onSwitch;

  @override
  ConsumerState<WorkspaceSwitchSheet> createState() => _WorkspaceSwitchSheetState();
}

class _WorkspaceSwitchSheetState extends ConsumerState<WorkspaceSwitchSheet> {
  final _textCtrl = TextEditingController();
  bool _showInput = false;

  @override
  void dispose() {
    _textCtrl.dispose();
    super.dispose();
  }

  void _select(String path) {
    ref.read(workspaceHistoryProvider.notifier).visit(path);
    widget.onSwitch(path);
    Navigator.of(context).pop();
  }

  void _submitCustom() {
    final path = _textCtrl.text.trim();
    if (path.isEmpty) return;
    _select(path);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final history = ref.watch(workspaceHistoryProvider).valueOrNull ?? WorkspaceHistory.empty;

    final pinned = history.pinned.toList();
    final recents = history.recents.where((p) => !history.pinned.contains(p)).toList();

    return Container(
      padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).viewInsets.bottom + 32),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: Container(
          width: 36, height: 4,
          decoration: BoxDecoration(color: c.bg4, borderRadius: BorderRadius.circular(2)),
        )),
        const SizedBox(height: 16),
        Text('切换工作区', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: c.fg)),
        const SizedBox(height: 12),
        if (pinned.isNotEmpty) ...[
          Text('置顶', style: TextStyle(fontSize: 12, color: c.fg3)),
          const SizedBox(height: 6),
          for (final p in pinned)
            _WorkspaceTile(
              path: p, isActive: p == widget.currentPath, isPinned: true, colors: c,
              onTap: () => _select(p),
              onLongPress: () => ref.read(workspaceHistoryProvider.notifier).togglePin(p),
            ),
          const SizedBox(height: 10),
        ],
        if (recents.isNotEmpty) ...[
          Text('最近', style: TextStyle(fontSize: 12, color: c.fg3)),
          const SizedBox(height: 6),
          for (final p in recents)
            _WorkspaceTile(
              path: p, isActive: p == widget.currentPath, isPinned: false, colors: c,
              onTap: () => _select(p),
              onLongPress: () => ref.read(workspaceHistoryProvider.notifier).togglePin(p),
            ),
          const SizedBox(height: 10),
        ],
        if (pinned.isEmpty && recents.isEmpty) ...[
          Center(child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text('暂无最近工作区', style: TextStyle(fontSize: 14, color: c.fg3)),
          )),
        ],
        Container(height: 1, color: c.separator),
        const SizedBox(height: 12),
        if (_showInput) ...[
          CupertinoTextField(
            controller: _textCtrl,
            autofocus: true,
            placeholder: '/Users/xxx/projects/my-app',
            style: TextStyle(fontSize: 14, fontFamily: 'Menlo', color: c.fg),
            placeholderStyle: TextStyle(fontSize: 14, color: c.fg3),
            decoration: BoxDecoration(color: c.bg3, borderRadius: BorderRadius.circular(8)),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            onSubmitted: (_) => _submitCustom(),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: CupertinoButton.filled(
              padding: const EdgeInsets.symmetric(vertical: 12),
              onPressed: _submitCustom,
              child: const Text('确认', style: TextStyle(fontSize: 15)),
            ),
          ),
        ] else
          GestureDetector(
            onTap: () => setState(() => _showInput = true),
            child: Row(children: [
              Container(
                width: 40, height: 40,
                decoration: BoxDecoration(color: c.tintBg, borderRadius: BorderRadius.circular(10)),
                alignment: Alignment.center,
                child: Text('＋', style: TextStyle(fontSize: 20, color: c.tint)),
              ),
              const SizedBox(width: 12),
              Text('输入其他路径…', style: TextStyle(fontSize: 15, color: c.tint)),
            ]),
          ),
      ]),
    );
  }
}

class _WorkspaceTile extends StatelessWidget {
  const _WorkspaceTile({
    required this.path, required this.isActive, required this.isPinned,
    required this.colors, required this.onTap, required this.onLongPress,
  });
  final String path;
  final bool isActive;
  final bool isPinned;
  final ThemeColors colors;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final name = path.split('/').lastWhere((p) => p.isNotEmpty, orElse: () => path);
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isActive ? colors.tintBg : colors.bg3,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive ? colors.tint : colors.separator,
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: Row(children: [
          Text(isPinned ? '📌' : '📁', style: const TextStyle(fontSize: 18)),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(name, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: colors.fg)),
            Text(path, style: TextStyle(fontSize: 12, color: colors.fg3, fontFamily: 'Menlo'),
              maxLines: 1, overflow: TextOverflow.ellipsis),
          ])),
          if (isActive)
            Icon(CupertinoIcons.checkmark_alt, size: 16, color: colors.tint),
        ]),
      ),
    );
  }
}
