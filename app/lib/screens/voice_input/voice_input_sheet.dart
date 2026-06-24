import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../../theme/index.dart';

class VoiceInputResult {
  const VoiceInputResult({required this.text, required this.confidence});

  final String text;
  final double confidence;
}

class VoiceInputSheet extends StatefulWidget {
  const VoiceInputSheet({super.key, required this.onSend});
  final Future<void> Function(VoiceInputResult result) onSend;

  static Future<void> show(
    BuildContext context,
    Future<void> Function(VoiceInputResult result) onSend,
  ) => showCupertinoModalPopup<void>(
    context: context,
    builder: (_) => VoiceInputSheet(onSend: onSend),
  );

  @override
  State<VoiceInputSheet> createState() => _VoiceInputSheetState();
}

class _VoiceInputSheetState extends State<VoiceInputSheet>
    with SingleTickerProviderStateMixin {
  final SpeechToText _speech = SpeechToText();
  Timer? _ticker;

  bool _recording = false;
  bool _ready = false;
  bool _sending = false;
  int _seconds = 0;
  double _confidence = 0;
  String _transcript = '';
  String _localeLabel = '系统语言';
  String? _errorMsg;
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
    unawaited(_initSpeech());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    unawaited(_speech.cancel());
    _pulse.dispose();
    super.dispose();
  }

  String get _timer {
    final m = _seconds ~/ 60;
    final s = _seconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  Future<void> _initSpeech() async {
    try {
      final ready = await _speech.initialize(
        onError: _onSpeechError,
        onStatus: _onSpeechStatus,
      );
      final systemLocale = ready ? await _speech.systemLocale() : null;
      if (!mounted) {
        return;
      }
      setState(() {
        _ready = ready;
        _localeLabel = systemLocale?.name ?? _localeLabel;
        _errorMsg = ready ? null : '当前设备不支持语音识别';
      });
      if (ready) {
        await _startListening(reset: true);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _ready = false;
        _errorMsg = '语音识别初始化失败: $error';
      });
    }
  }

  Future<void> _startListening({bool reset = false}) async {
    if (!_ready || _sending) {
      return;
    }

    if (reset && mounted) {
      setState(() {
        _seconds = 0;
        _confidence = 0;
        _transcript = '';
        _errorMsg = null;
      });
    }

    if (_speech.isListening) {
      await _speech.cancel();
    }

    try {
      await _speech.listen(
        onResult: _onSpeechResult,
        listenOptions: SpeechListenOptions(
          listenMode: ListenMode.dictation,
          partialResults: true,
          cancelOnError: true,
          autoPunctuation: true,
          enableHapticFeedback: true,
          pauseFor: const Duration(seconds: 3),
          listenFor: const Duration(minutes: 2),
          localeId: null,
        ),
      );
      _setRecording(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMsg = '启动录音失败: $error';
      });
      _setRecording(false);
    }
  }

  Future<void> _stopListening() async {
    if (_speech.isListening) {
      await _speech.stop();
    }
    _setRecording(false);
  }

  void _onSpeechResult(SpeechRecognitionResult result) {
    if (!mounted) {
      return;
    }
    setState(() {
      _transcript = result.recognizedWords.trim();
      _confidence = _normalizedConfidence(result);
      _errorMsg = null;
    });
    if (result.finalResult) {
      _setRecording(false);
    }
  }

  void _onSpeechError(SpeechRecognitionError error) {
    if (!mounted) {
      return;
    }
    setState(() {
      _errorMsg = '语音识别失败: ${error.errorMsg}';
    });
    _setRecording(false);
  }

  void _onSpeechStatus(String status) {
    if (!mounted) {
      return;
    }
    if (status == SpeechToText.doneStatus ||
        status == SpeechToText.notListeningStatus) {
      _setRecording(false);
    }
  }

  void _setRecording(bool value) {
    if (!mounted) {
      return;
    }
    if (_recording == value) {
      return;
    }
    setState(() {
      _recording = value;
    });
    if (value) {
      _ticker?.cancel();
      _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted || !_recording) {
          return;
        }
        setState(() => _seconds++);
      });
      return;
    }
    _ticker?.cancel();
    _ticker = null;
  }

  Future<void> _send() async {
    final text = _transcript.trim();
    if (text.isEmpty || _sending) {
      return;
    }

    await _stopListening();

    setState(() {
      _sending = true;
      _errorMsg = null;
    });

    try {
      await widget.onSend(
        VoiceInputResult(text: text, confidence: _confidence),
      );
      if (mounted) {
        Navigator.of(context).pop();
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMsg = '发送失败: $error';
      });
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
        });
      }
    }
  }

  double _normalizedConfidence(SpeechRecognitionResult result) {
    if (!result.hasConfidenceRating) {
      return 0;
    }
    final value = result.confidence;
    if (value < 0) {
      return 0;
    }
    if (value > 1) {
      return 1;
    }
    return value;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final confidencePercent = (_confidence * 100).round();
    final transcript = _transcript.isEmpty ? '等待语音输入…' : _transcript;
    return Container(
      height: MediaQuery.of(context).size.height * .88,
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(
        children: [
          // nav
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
            child: Row(
              children: [
                CupertinoButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text('取消', style: TextStyle(color: c.tint)),
                ),
                Expanded(
                  child: Text(
                    '语音输入',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      color: c.fg,
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 16),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: c.bg2,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '🌐 $_localeLabel',
                      style: TextStyle(fontSize: 13, color: c.fg2),
                    ),
                  ),
                ),
              ],
            ),
          ),

          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                children: [
                  const SizedBox(height: 20),

                  // state label
                  Text(
                    _recording
                        ? '● 正在录音'
                        : (_transcript.isNotEmpty ? '✓ 录音完成' : '○ 等待开始'),
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      letterSpacing: .06 * 13,
                      color:
                          _recording
                              ? c.tint
                              : (_transcript.isNotEmpty
                                  ? AppColors.green
                                  : c.fg2),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // waveform (simplified)
                  if (_recording)
                    AnimatedBuilder(
                      animation: _pulse,
                      builder:
                          (_, __) => _WaveForm(progress: _pulse.value, c: c),
                    )
                  else
                    SizedBox(
                      height: 48,
                      child: Center(
                        child: Text(
                          '●●●●●●●●●●',
                          style: TextStyle(color: c.fg3, letterSpacing: 4),
                        ),
                      ),
                    ),
                  const SizedBox(height: 20),

                  // timer
                  Text(
                    _timer,
                    style: TextStyle(
                      fontSize: 40,
                      fontWeight: FontWeight.w200,
                      fontFamily: 'Menlo',
                      letterSpacing: .06 * 40,
                      color: c.fg,
                    ),
                  ),
                  const SizedBox(height: 20),

                  // mic button
                  GestureDetector(
                    onTap:
                        !_ready || _sending
                            ? null
                            : () {
                              if (_recording) {
                                unawaited(_stopListening());
                              } else {
                                unawaited(_startListening());
                              }
                            },
                    child: Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: !_ready ? c.bg3 : (_recording ? c.tint : c.bg3),
                        boxShadow:
                            _recording
                                ? [
                                  BoxShadow(
                                    color: c.tint.withValues(alpha: .15),
                                    blurRadius: 16,
                                    spreadRadius: 8,
                                  ),
                                ]
                                : null,
                      ),
                      alignment: Alignment.center,
                      child: Text('🎤', style: const TextStyle(fontSize: 36)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    !_ready ? '正在准备语音识别' : (_recording ? '点击停止录音' : '确认后发送'),
                    style: TextStyle(fontSize: 13, color: c.fg3),
                  ),
                  const SizedBox(height: 20),

                  // transcript
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '实时转写',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: c.fg3,
                          letterSpacing: .05 * 11,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: c.bg2,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          transcript,
                          style: TextStyle(
                            fontSize: 15,
                            color: _transcript.isEmpty ? c.fg3 : c.fg,
                            height: 1.6,
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '识别置信度',
                        style: TextStyle(fontSize: 11, color: c.fg3),
                      ),
                      Text(
                        '${confidencePercent.clamp(0, 100)}%',
                        style: TextStyle(fontSize: 11, color: c.fg3),
                      ),
                    ],
                  ),
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
                        widthFactor: _confidence.clamp(0.0, 1.0),
                        child: Container(
                          decoration: BoxDecoration(
                            color: c.tint,
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ),
                    ),
                  ),
                  if (_errorMsg != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _errorMsg!,
                      style: TextStyle(fontSize: 12, color: AppColors.red),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Text(
                    '仅发送转写文本，不上传原始音频',
                    style: TextStyle(fontSize: 12, color: c.fg3),
                  ),
                ],
              ),
            ),
          ),

          // action row
          Padding(
            padding: EdgeInsets.fromLTRB(
              24,
              8,
              24,
              MediaQuery.of(context).padding.bottom + 16,
            ),
            child: Row(
              children: [
                Expanded(
                  child: CupertinoButton(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    color: c.bg2,
                    borderRadius: BorderRadius.circular(12),
                    onPressed:
                        !_ready || _sending
                            ? null
                            : () => unawaited(_startListening(reset: true)),
                    child: Text(
                      '🔄 重录',
                      style: TextStyle(fontSize: 14, color: c.fg),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: CupertinoButton(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    color: c.tint,
                    borderRadius: BorderRadius.circular(12),
                    onPressed:
                        _transcript.trim().isEmpty || _sending ? null : _send,
                    child: const Text(
                      '发送 ➤',
                      style: TextStyle(
                        fontSize: 14,
                        color: Color(0xFFFFFFFF),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
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
    return x < 3.14159
        ? x * (3.14159 - x) * 4 / (3.14159 * 3.14159)
        : (x - 3.14159) * (x - 6.28318) * 4 / (3.14159 * 3.14159) - 1;
  }
}
