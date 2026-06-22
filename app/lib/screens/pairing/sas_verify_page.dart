import 'package:flutter/cupertino.dart';
import 'package:go_router/go_router.dart';

import '../../theme/index.dart';

class SasVerifyPage extends StatelessWidget {
  const SasVerifyPage({super.key, required this.words});
  final List<({String emoji, String word})> words;

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      backgroundColor: context.colors.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: context.colors.bg,
        border: null,
        middle: Text('安全核对', style: TextStyle(color: context.colors.fg)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            children: [
              const SizedBox(height: 20),
              Text(
                '请确认电脑终端显示的安全短串\n与下方',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: context.colors.fg2, height: 1.6),
              ),
              Text.rich(
                TextSpan(children: [
                  TextSpan(
                    text: '完全一致',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: context.colors.fg),
                  ),
                  TextSpan(
                    text: '后再点确认',
                    style: TextStyle(fontSize: 14, color: context.colors.fg2),
                  ),
                ]),
              ),
              // SAS card
              Container(
                margin: const EdgeInsets.symmetric(vertical: 20),
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                decoration: BoxDecoration(
                  color: context.colors.bg2,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Column(
                  children: words.map((w) => _SasItem(emoji: w.emoji, word: w.word)).toList(),
                ),
              ),
              // warning box
              Container(
                margin: const EdgeInsets.only(bottom: 20),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFF3B30).withValues(alpha: .1),
                  border: Border.all(color: const Color(0xFFFF3B30).withValues(alpha: .25)),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('⚠️', style: TextStyle(fontSize: 18)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        '若与电脑端显示不一致，请立即取消。可能存在中间人攻击，连接不安全。',
                        style: const TextStyle(fontSize: 13, color: Color(0xFFFF3B30), height: 1.55),
                      ),
                    ),
                  ],
                ),
              ),
              // buttons
              Row(
                children: [
                  Expanded(
                    child: CupertinoButton(
                      onPressed: () => context.go('/pairing'),
                      color: context.colors.bg3,
                      borderRadius: BorderRadius.circular(12),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: const Text('取消', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFFFF3B30))),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: CupertinoButton(
                      onPressed: () => context.go('/devices'),
                      color: context.colors.tint,
                      borderRadius: BorderRadius.circular(12),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: const Text('一致，确认', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: CupertinoColors.white)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text('完成后双端建立加密通道', style: TextStyle(fontSize: 13, color: context.colors.fg2)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SasItem extends StatelessWidget {
  const _SasItem({required this.emoji, required this.word});
  final String emoji;
  final String word;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: context.colors.bg3,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Text(emoji, style: const TextStyle(fontSize: 28)),
            const SizedBox(width: 14),
            Text(word, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: context.colors.fg)),
          ],
        ),
      ),
    );
  }
}
