import 'package:flutter/cupertino.dart';
import '../theme/index.dart';

/// Empty workspace guide — wireframe 50
class WorkspaceEmptyPage extends StatelessWidget {
  const WorkspaceEmptyPage({super.key, this.onAddManual});

  final VoidCallback? onAddManual;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('工作区', style: TextStyle(color: c.fg)),
        trailing: GestureDetector(
          onTap: onAddManual,
          child: Text('+ 新建', style: TextStyle(fontSize: 14, color: c.tint)),
        ),
      ),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('📂', style: TextStyle(fontSize: 64, color: c.fg3.withValues(alpha: .25))),
                const SizedBox(height: 20),
                Text(
                  '还没有工作区',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: c.fg),
                ),
                const SizedBox(height: 10),
                Text(
                  '工作区对应你电脑上的一个项目目录，Agent 在其中运行。',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: c.fg2, height: 1.7),
                ),
                const SizedBox(height: 4),
                // How to start card
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: c.bg2,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '如何开始',
                        style: TextStyle(
                          fontSize: 12,
                          color: c.fg3,
                          fontWeight: FontWeight.w600,
                          letterSpacing: .6,
                        ),
                      ),
                      const SizedBox(height: 12),
                      _Step(number: '1', text: '在 Mac 上打开终端，进入项目目录'),
                      const SizedBox(height: 12),
                      _Step(number: '2', text: '运行 ', code: 'hellobug init', postText: ' 注册工作区'),
                      const SizedBox(height: 12),
                      _Step(number: '3', text: '回到此页面刷新即可看到工作区'),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: CupertinoButton.filled(
                    onPressed: onAddManual,
                    child: const Text('手动添加工作区'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.text, this.code, this.postText});
  final String number;
  final String text;
  final String? code;
  final String? postText;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: c.tint,
          ),
          alignment: Alignment.center,
          child: Text(
            number,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: CupertinoColors.white,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(text: text, style: TextStyle(fontSize: 13, color: c.fg2)),
                if (code != null)
                  TextSpan(
                    text: code,
                    style: TextStyle(fontSize: 13, color: c.tint, fontFamily: 'SF Mono'),
                  ),
                if (postText != null)
                  TextSpan(text: postText, style: TextStyle(fontSize: 13, color: c.fg2)),
              ],
            ),
            style: const TextStyle(height: 1.5),
          ),
        ),
      ],
    );
  }
}
