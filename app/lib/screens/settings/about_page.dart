import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class AboutPage extends StatelessWidget {
  const AboutPage({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg, border: null,
        middle: Text('关于', style: TextStyle(color: c.fg)),
      ),
      child: SafeArea(
        child: ListView(children: [
          const SizedBox(height: 40),
          Center(child: ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: Image.asset('assets/images/logo.png', width: 88, height: 88),
          )),
          const SizedBox(height: 16),
          Center(child: Text('HelloBug',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: c.fg))),
          const SizedBox(height: 4),
          Center(child: Text('v0.1.0 (1)',
            style: TextStyle(fontSize: 14, color: c.fg3))),
          const SizedBox(height: 32),
          CupertinoListSection.insetGrouped(children: [
            CupertinoListTile(
              title: const Text('协议版本'),
              additionalInfo: Text('hellobug/1.0', style: TextStyle(color: c.fg3, fontFamily: 'Menlo')),
            ),
            CupertinoListTile(
              title: const Text('加密'),
              additionalInfo: Text('Noise IK · ChaCha20', style: TextStyle(color: c.fg3, fontFamily: 'Menlo')),
            ),
          ]),
          CupertinoListSection.insetGrouped(children: [
            CupertinoListTile(
              title: const Text('开源组件'),
              trailing: const CupertinoListTileChevron(),
              onTap: () {},
            ),
          ]),
        ]),
      ),
    );
  }
}
