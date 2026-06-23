import 'package:flutter/cupertino.dart';
import '../../theme/index.dart';

class VoiceInputSheet extends StatefulWidget {
  const VoiceInputSheet({super.key, required this.onSend});
  final ValueChanged<String> onSend;

  static Future<void> show(BuildContext context, ValueChanged<String> onSend) =>
      showCupertinoModalPopup<void>(
        context: context,
        builder: (_) => VoiceInputSheet(onSend: onSend),
      );

  @override
  State<VoiceInputSheet> createState() => _VoiceInputSheetState();
}

class _VoiceInputSheetState extends State<VoiceInputSheet>
    with SingleTickerProviderStateMixin {
  bool _recording = true;
  int _seconds = 0;
  late final AnimationController _pulse;

  static const _mockTranscript =
      '帮我看一下 login.ts 里的 retry 逻辑有没有问题，尤其是超时处理那一块';

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
    // fake timer — UI only
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted || !_recording) return false;
      setState(() => _seconds++);
      return true;
    });
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  String get _timer {
    final m = _seconds ~/ 60;
    final s = _seconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      height: MediaQuery.of(context).size.height * .88,
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(children: [
        // nav
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
          child: Row(children: [
            CupertinoButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('取消', style: TextStyle(color: c.tint)),
            ),
            Expanded(child: Text('语音输入',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.fg))),
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: c.bg2, borderRadius: BorderRadius.circular(20)),
                child: Text('🌐 普通话',
                  style: TextStyle(fontSize: 13, color: c.fg2)),
              ),
            ),
          ]),
        ),

        Expanded(child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(children: [
            const SizedBox(height: 20),

            // state label
            Text(
              _recording ? '● 正在录音' : '✓ 录音完成',
              style: TextStyle(
                fontSize: 13, fontWeight: FontWeight.w600, letterSpacing: .06 * 13,
                color: _recording ? c.tint : AppColors.green,
              ),
            ),
            const SizedBox(height: 20),

            // waveform (simplified)
            if (_recording)
              AnimatedBuilder(
                animation: _pulse,
                builder: (_, __) => _WaveForm(progress: _pulse.value, c: c),
              )
            else
              SizedBox(height: 48, child: Center(
                child: Text('●●●●●●●●●●',
                  style: TextStyle(color: c.fg3, letterSpacing: 4)),
              )),
            const SizedBox(height: 20),

            // timer
            Text(_timer,
              style: TextStyle(fontSize: 40, fontWeight: FontWeight.w200,
                fontFamily: 'Menlo', letterSpacing: .06 * 40, color: c.fg)),
            const SizedBox(height: 20),

            // mic button
            GestureDetector(
              onTap: () => setState(() => _recording = false),
              child: Container(
                width: 80, height: 80,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _recording ? c.tint : c.bg3,
                  boxShadow: _recording ? [
                    BoxShadow(color: c.tint.withValues(alpha: .15), blurRadius: 16, spreadRadius: 8),
                  ] : null,
                ),
                alignment: Alignment.center,
                child: Text('🎤', style: const TextStyle(fontSize: 36)),
              ),
            ),
            const SizedBox(height: 12),
            Text(_recording ? '点击停止录音' : '确认后发送',
              style: TextStyle(fontSize: 13, color: c.fg3)),
            const SizedBox(height: 20),

            // transcript
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('实时转写',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                  color: c.fg3, letterSpacing: .05 * 11)),
              const SizedBox(height: 4),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: c.bg2, borderRadius: BorderRadius.circular(12)),
                child: Text(_mockTranscript,
                  style: TextStyle(fontSize: 15, color: c.fg, height: 1.6)),
              ),
            ]),

            const SizedBox(height: 8),
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text('识别置信度',
                style: TextStyle(fontSize: 11, color: c.fg3)),
              Text('88%', style: TextStyle(fontSize: 11, color: c.fg3)),
            ]),
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(2),
              child: Container(
                height: 3,
                decoration: BoxDecoration(
                  color: c.bg3,
                  borderRadius: BorderRadius.circular(2),
                ),
                alignment: Alignment.centerLeft,
                child: FractionallySizedBox(
                  widthFactor: .88,
                  child: Container(
                    decoration: BoxDecoration(
                      color: c.tint,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text('本地识别，音频不上传 · iOS Speech / Android STT',
              style: TextStyle(fontSize: 12, color: c.fg3)),
          ]),
        )),

        // action row
        Padding(
          padding: EdgeInsets.fromLTRB(24, 8, 24,
            MediaQuery.of(context).padding.bottom + 16),
          child: Row(children: [
            Expanded(child: CupertinoButton(
              padding: const EdgeInsets.symmetric(vertical: 14),
              color: c.bg2,
              borderRadius: BorderRadius.circular(12),
              onPressed: () => setState(() { _recording = true; _seconds = 0; }),
              child: Text('🔄 重录', style: TextStyle(fontSize: 14, color: c.fg)),
            )),
            const SizedBox(width: 10),
            Expanded(flex: 2, child: CupertinoButton(
              padding: const EdgeInsets.symmetric(vertical: 14),
              color: c.tint,
              borderRadius: BorderRadius.circular(12),
              onPressed: () {
                widget.onSend(_mockTranscript);
                Navigator.of(context).pop();
              },
              child: const Text('发送 ➤',
                style: TextStyle(fontSize: 14, color: Color(0xFFFFFFFF),
                  fontWeight: FontWeight.w600)),
            )),
          ]),
        ),
      ]),
    );
  }
}

class _WaveForm extends StatelessWidget {
  const _WaveForm({required this.progress, required this.c});
  final double progress;
  final ThemeColors c;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: List.generate(20, (i) {
          final phase = (i / 20 + progress) % 1.0;
          final h = 6.0 + 36.0 * (0.5 + 0.5 * _sin(phase * 6.28318));
          return Container(
            width: 3,
            height: h,
            margin: const EdgeInsets.symmetric(horizontal: 2),
            decoration: BoxDecoration(
              color: c.tint.withValues(alpha: .7 + .3 * (i % 3 / 2)),
              borderRadius: BorderRadius.circular(2),
            ),
          );
        }),
      ),
    );
  }

  static double _sin(double x) {
    // Simple approximation
    x = x % 6.28318;
    if (x < 0) x += 6.28318;
    return x < 3.14159 ? x * (3.14159 - x) * 4 / (3.14159 * 3.14159)
        : (x - 3.14159) * (x - 6.28318) * 4 / (3.14159 * 3.14159) - 1;
  }
}
