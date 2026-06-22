import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';

import '../theme/index.dart';

class RootTabScaffold extends StatelessWidget {
  const RootTabScaffold({super.key, required this.child});
  final Widget child;

  static const _tabs = [
    _TabItem(label: '设备',   icon: CupertinoIcons.device_laptop,      path: '/devices'),
    _TabItem(label: '会话',   icon: CupertinoIcons.chat_bubble_2,       path: '/sessions'),
    _TabItem(label: '设置',   icon: CupertinoIcons.settings,            path: '/settings'),
  ];

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    final activeIndex = _tabs.indexWhere((t) => location.startsWith(t.path));

    return CupertinoTabScaffold(
      tabBar: CupertinoTabBar(
        currentIndex: activeIndex < 0 ? 0 : activeIndex,
        backgroundColor: context.colors.bg,
        border: Border(top: BorderSide(color: context.colors.separator, width: .5)),
        onTap: (i) => context.go(_tabs[i].path),
        items: _tabs.map((t) => BottomNavigationBarItem(
          icon: Icon(t.icon),
          label: t.label,
        )).toList(),
      ),
      tabBuilder: (_, __) => child,
    );
  }
}

class _TabItem {
  const _TabItem({required this.label, required this.icon, required this.path});
  final String label;
  final IconData icon;
  final String path;
}
