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
  late Timer _timer;
  int _remaining = 60;
  bool _authed = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() => _remaining--);
      if (_remaining <= 0) _deny(auto: true);
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  Future<void> _allow() async {
    final auth = LocalAuthentication();
    final ok = await auth.authenticate(
      localizedReason: '确认允许执行此操作',
      options: const AuthenticationOptions(biometricOnly: false),
    );
    if (!ok) return;
    setState(() => _authed = true);
    _timer.cancel();
    await ref.read(wsClientProvider)?.send(
      InnerMessage.create('danger.allow', {'session_id': widget.request.sessionId}),
    );
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _deny({bool auto = false}) async {
    _timer.cancel();
    await ref.read(wsClientProvider)?.send(
      InnerMessage.create('danger.deny', {'session_id': widget.request.sessionId}),
    );
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      decoration: BoxDecoration(color: c.bg2, borderRadius: const BorderRadius.vertical(top: AppRadius.lg)),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: Container(
          width: 36, height: 4,
          decoration: BoxDecoration(color: c.bg4, borderRadius: BorderRadius.circular(2)),
        )),
        const SizedBox(height: 16),
        Row(children: [
          const Text('⚠️', style: TextStyle(fontSize: 20)),
          const SizedBox(width: 8),
          Text('危险操作请求', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.orange)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: _remaining <= 10 ? AppColors.red.withValues(alpha: .15) : c.bg3,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text('$_remaining s',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                color: _remaining <= 10 ? AppColors.red : c.fg2)),
          ),
        ]),
        const SizedBox(height: 12),
        _LabelRow(label: '命令', value: widget.request.command, mono: true, colors: c),
        _LabelRow(label: '规则', value: widget.request.ruleName, colors: c),
        _LabelRow(label: '工作区', value: widget.request.workspacePath, mono: true, colors: c),
        const SizedBox(height: 20),
        Row(children: [
          Expanded(child: CupertinoButton(
            padding: const EdgeInsets.symmetric(vertical: 14),
            color: c.bg3,
            borderRadius: BorderRadius.circular(12),
            onPressed: () => _deny(),
            child: Text('拒绝', style: TextStyle(color: AppColors.red, fontWeight: FontWeight.w600)),
          )),
          const SizedBox(width: 12),
          Expanded(child: CupertinoButton.filled(
            padding: const EdgeInsets.symmetric(vertical: 14),
            borderRadius: BorderRadius.circular(12),
            onPressed: _authed ? null : _allow,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(CupertinoIcons.lock_open, size: 16),
              const SizedBox(width: 6),
              const Text('验证并允许', style: TextStyle(fontWeight: FontWeight.w600)),
            ]),
          )),
        ]),
      ]),
    );
  }
}

class _LabelRow extends StatelessWidget {
  const _LabelRow({required this.label, required this.value, required this.colors, this.mono = false});
  final String label;
  final String value;
  final ThemeColors colors;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(
          width: 48,
          child: Text(label, style: TextStyle(fontSize: 13, color: colors.fg3)),
        ),
        Expanded(child: Text(value,
          style: TextStyle(
            fontSize: 13, color: colors.fg,
            fontFamily: mono ? 'Menlo' : null,
          ))),
      ]),
    );
  }
}
