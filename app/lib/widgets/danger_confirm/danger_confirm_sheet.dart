import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import '../../../models/danger_request.dart';
import '../../../theme/index.dart';
import '../../../transport/ws_provider.dart';
import '../../../models/inner_message.dart';

class DangerConfirmSheet extends ConsumerStatefulWidget {
  const DangerConfirmSheet({super.key, required this.request});
  final DangerRequest request;

  @override
  ConsumerState<DangerConfirmSheet> createState() => _DangerConfirmSheetState();
}

class _DangerConfirmSheetState extends ConsumerState<DangerConfirmSheet> {
  Timer? _timer;
  late int _remaining;
  bool _authing = false;
  bool _resolved = false;

  @override
  void initState() {
    super.initState();
    _remaining = _computeRemainingSeconds();
    _startTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _allow() async {
    if (_resolved || _authing) return;
    if (_remaining <= 0) {
      await _deny();
      return;
    }
    _stopTimer();
    if (mounted) {
      setState(() => _authing = true);
    }
    final auth = LocalAuthentication();
    bool ok = false;
    try {
      ok = await auth.authenticate(
        localizedReason: '确认允许执行此操作',
        options: const AuthenticationOptions(biometricOnly: false),
      );
    } catch (_) {
      ok = false;
    }
    if (!mounted || _resolved) return;
    final remaining = _computeRemainingSeconds();
    setState(() {
      _authing = false;
      _remaining = remaining;
    });
    if (remaining <= 0) {
      await _deny();
      return;
    }
    if (!ok) {
      _startTimer();
      return;
    }
    _resolved = true;
    await ref
        .read(wsClientProvider)
        ?.send(
          InnerMessage.create('danger.allow', {
            'danger_id': widget.request.dangerId,
            'biometric_verified': true,
          }),
        );
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _deny() async {
    if (_resolved) return;
    _resolved = true;
    _stopTimer();
    await ref
        .read(wsClientProvider)
        ?.send(
          InnerMessage.create('danger.deny', {
            'danger_id': widget.request.dangerId,
          }),
        );
    if (mounted) Navigator.of(context).pop();
  }

  int _computeRemainingSeconds() {
    final now = DateTime.now();
    final remainingMs =
        widget.request.timeoutAt.millisecondsSinceEpoch -
        now.millisecondsSinceEpoch;
    if (remainingMs <= 0) {
      return 0;
    }
    return (remainingMs / 1000).ceil();
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _resolved) return;
      final remaining = _computeRemainingSeconds();
      setState(() => _remaining = remaining);
      if (remaining <= 0) {
        unawaited(_deny());
      }
    });
  }

  void _stopTimer() {
    _timer?.cancel();
    _timer = null;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: c.bg4,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Text('⚠️', style: TextStyle(fontSize: 20)),
              const SizedBox(width: 8),
              Text(
                '危险操作请求',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: AppColors.orange,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color:
                      _remaining <= 10
                          ? AppColors.red.withValues(alpha: .15)
                          : c.bg3,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '$_remaining s',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: _remaining <= 10 ? AppColors.red : c.fg2,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _LabelRow(
            label: '命令',
            value: widget.request.command,
            mono: true,
            colors: c,
          ),
          _LabelRow(label: '规则', value: widget.request.ruleName, colors: c),
          _LabelRow(
            label: '工作区',
            value: widget.request.workspacePath,
            mono: true,
            colors: c,
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: CupertinoButton(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  color: c.bg3,
                  borderRadius: BorderRadius.circular(12),
                  onPressed: _resolved || _authing ? null : _deny,
                  child: Text(
                    '拒绝',
                    style: TextStyle(
                      color: AppColors.red,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: CupertinoButton.filled(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  borderRadius: BorderRadius.circular(12),
                  onPressed: _resolved || _authing ? null : _allow,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(CupertinoIcons.lock_open, size: 16),
                      const SizedBox(width: 6),
                      Text(
                        _authing ? '验证中…' : '验证并允许',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LabelRow extends StatelessWidget {
  const _LabelRow({
    required this.label,
    required this.value,
    required this.colors,
    this.mono = false,
  });
  final String label;
  final String value;
  final ThemeColors colors;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 48,
            child: Text(
              label,
              style: TextStyle(fontSize: 13, color: colors.fg3),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 13,
                color: colors.fg,
                fontFamily: mono ? 'Menlo' : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
