import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';

import '../theme/index.dart';

class RootTabScaffold extends StatelessWidget {
  const RootTabScaffold({super.key, required this.navigationShell});
  final StatefulNavigationShell navigationShell;

  static const _tabs = [
    _TabItem(label: '工作区', icon: CupertinoIcons.folder),
    _TabItem(label: '设置', icon: CupertinoIcons.settings),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return ColoredBox(
      color: colors.bg,
      child: Column(
        children: [
          Expanded(child: navigationShell),
          DecoratedBox(
            decoration: BoxDecoration(
              color: colors.bg,
              border: Border(
                top: BorderSide(color: colors.separator, width: .5),
              ),
            ),
            child: CupertinoTabBar(
              currentIndex: navigationShell.currentIndex,
              backgroundColor: colors.bg,
              border: null,
              onTap:
                  (i) => navigationShell.goBranch(
                    i,
                    initialLocation: i == navigationShell.currentIndex,
                  ),
              items:
                  _tabs
                      .map(
                        (t) => BottomNavigationBarItem(
                          icon: Icon(t.icon),
                          label: t.label,
                        ),
                      )
                      .toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _TabItem {
  const _TabItem({required this.label, required this.icon});
  final String label;
  final IconData icon;
}
