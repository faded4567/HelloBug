import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../theme/index.dart';
import 'pairing_controller.dart';

const _sasLabels = <String, String>{
  '🐢': '海龟',
  '🪐': '土星',
  '🍵': '绿茶',
  '🎷': '萨克斯',
  '🌙': '月亮',
  '🧭': '罗盘',
  '🛠️': '工具',
  '📦': '包裹',
  '🧪': '试管',
  '🌲': '松树',
  '🔥': '火焰',
  '🌊': '海浪',
};

class SasVerifyPage extends ConsumerWidget {
  const SasVerifyPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pairing = ref.watch(pairingControllerProvider);
    final words = pairing.sasEmojis
        .map((emoji) => (emoji: emoji, word: _sasLabels[emoji] ?? emoji))
        .toList(growable: false);

    Future<void> handleConfirm(bool confirmed) async {
      final success = await ref
          .read(pairingControllerProvider.notifier)
          .confirmSas(confirmed);
      if (!context.mounted) return;

      if (!confirmed) {
        context.go('/pairing');
        return;
      }

      if (!success) {
        return;
      }

      context.go('/devices');
      unawaited(ref.read(pairingControllerProvider.notifier).reset());
    }

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
                style: TextStyle(
                  fontSize: 14,
                  color: context.colors.fg2,
                  height: 1.6,
                ),
              ),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '完全一致',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: context.colors.fg,
                      ),
                    ),
                    TextSpan(
                      text: '后再点确认',
                      style: TextStyle(fontSize: 14, color: context.colors.fg2),
                    ),
                  ],
                ),
              ),
              if ((pairing.machineName ?? '').isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  '${pairing.machineName}${(pairing.os ?? '').isEmpty ? '' : ' · ${pairing.os}'}',
                  style: TextStyle(fontSize: 13, color: context.colors.fg3),
                ),
              ],
              Container(
                margin: const EdgeInsets.symmetric(vertical: 20),
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 24,
                ),
                decoration: BoxDecoration(
                  color: context.colors.bg2,
                  borderRadius: BorderRadius.circular(18),
                ),
                child:
                    words.isEmpty
                        ? Text(
                          '当前没有待确认的安全短串',
                          style: TextStyle(
                            fontSize: 14,
                            color: context.colors.fg2,
                          ),
                        )
                        : Column(
                          children:
                              words
                                  .map(
                                    (w) =>
                                        _SasItem(emoji: w.emoji, word: w.word),
                                  )
                                  .toList(),
                        ),
              ),
              Container(
                margin: const EdgeInsets.only(bottom: 20),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFFF3B30).withValues(alpha: .1),
                  border: Border.all(
                    color: const Color(0xFFFF3B30).withValues(alpha: .25),
                  ),
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
                        style: const TextStyle(
                          fontSize: 13,
                          color: Color(0xFFFF3B30),
                          height: 1.55,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              if (pairing.errorMessage != null) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    pairing.errorMessage!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFFFF3B30),
                      height: 1.5,
                    ),
                  ),
                ),
              ],
              Row(
                children: [
                  Expanded(
                    child: CupertinoButton(
                      onPressed:
                          pairing.isBusy ? null : () => handleConfirm(false),
                      color: context.colors.bg3,
                      borderRadius: BorderRadius.circular(12),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: const Text(
                        '取消',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFFFF3B30),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: CupertinoButton(
                      onPressed:
                          pairing.isBusy || words.length != 5
                              ? null
                              : () => handleConfirm(true),
                      color: context.colors.tint,
                      borderRadius: BorderRadius.circular(12),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Text(
                        pairing.step == PairingStep.confirming
                            ? '确认中...'
                            : '一致，确认',
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          color: CupertinoColors.white,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '完成后双端建立加密通道',
                style: TextStyle(fontSize: 13, color: context.colors.fg2),
              ),
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
            Text(
              word,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: context.colors.fg,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
