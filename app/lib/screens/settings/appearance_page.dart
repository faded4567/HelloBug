import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../state/settings_provider.dart';
import '../../theme/index.dart';

class AppearancePage extends ConsumerWidget {
  const AppearancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final s = ref.watch(settingsProvider);
    final notifier = ref.read(settingsProvider.notifier);

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg, border: null,
        middle: Text('外观', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(children: [
          CupertinoListSection.insetGrouped(
            header: Text('代码字号', style: TextStyle(color: c.fg2)),
            children: [
              for (final (label, scale) in [('小 (13pt)', 0.92), ('中 (14pt)', 1.0), ('大 (15pt)', 1.08)])
                CupertinoListTile(
                  title: Text(label),
                  trailing: s.codeFontScale == scale
                      ? Icon(CupertinoIcons.checkmark_alt, color: c.tint)
                      : null,
                  onTap: () => notifier.update((s) => s.copyWith(codeFontScale: scale)),
                ),
            ],
          ),
          CupertinoListSection.insetGrouped(
            header: Text('Diff 默认视图', style: TextStyle(color: c.fg2)),
            children: [
              CupertinoListTile(
                title: const Text('统一视图'),
                trailing: s.diffViewMode == DiffViewMode.unified
                    ? Icon(CupertinoIcons.checkmark_alt, color: c.tint) : null,
                onTap: () => notifier.update((s) => s.copyWith(diffViewMode: DiffViewMode.unified)),
              ),
              CupertinoListTile(
                title: const Text('分栏视图'),
                trailing: s.diffViewMode == DiffViewMode.split
                    ? Icon(CupertinoIcons.checkmark_alt, color: c.tint) : null,
                onTap: () => notifier.update((s) => s.copyWith(diffViewMode: DiffViewMode.split)),
              ),
            ],
          ),
        ]),
      ),
    );
  }
}
