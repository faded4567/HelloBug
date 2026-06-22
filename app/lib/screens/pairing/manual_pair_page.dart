import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';

import '../../theme/index.dart';

/// Placeholder used by router for /pairing/manual (QR camera scan).
/// Full implementation in M1 F3 spike.
class ManualPairPage extends StatelessWidget {
  const ManualPairPage({super.key});

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      backgroundColor: context.colors.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: context.colors.bg,
        border: null,
        middle: Text('扫描二维码', style: TextStyle(color: context.colors.fg)),
        leading: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: () => context.pop(),
          child: Text('取消', style: TextStyle(color: context.colors.tint)),
        ),
      ),
      child: const Center(child: Text('相机预览占位（M1 Spike F3）')),
    );
  }
}
