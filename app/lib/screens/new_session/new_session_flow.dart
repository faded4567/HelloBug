import 'dart:math';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/session_summary.dart';
import '../../state/devices_provider.dart';
import '../../state/sessions_provider.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import '../../models/inner_message.dart';

class NewSessionFlow extends ConsumerStatefulWidget {
  const NewSessionFlow({super.key});

  @override
  ConsumerState<NewSessionFlow> createState() => _NewSessionFlowState();
}

class _NewSessionFlowState extends ConsumerState<NewSessionFlow> {
  int _step = 0;
  String _deviceId = '';
  String _workspacePath = '';
  String _agentType = 'claude_code';
  final _workspaceCtrl = TextEditingController();
  bool _busy = false;

  static const _agents = [
    ('claude_code', '🤖', 'Claude Code', '多文件编辑、代码分析、重构'),
    ('codex', '⚡', 'Codex', '代码生成、补全、解释'),
    ('shell', '🖥', 'Shell', '直接访问终端，运行任意命令'),
  ];

  @override
  void dispose() {
    _workspaceCtrl.dispose();
    super.dispose();
  }

  String _uuid() {
    final rng = Random.secure();
    final b = List<int>.generate(16, (_) => rng.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    String h(List<int> v) => v.map((e) => e.toRadixString(16).padLeft(2, '0')).join();
    return '${h(b.sublist(0, 4))}-${h(b.sublist(4, 6))}-${h(b.sublist(6, 8))}-${h(b.sublist(8, 10))}-${h(b.sublist(10))}';
  }

  Future<void> _finish() async {
    setState(() => _busy = true);
    final sid = _uuid();
    final session = SessionSummary(
      sessionId: sid,
      deviceId: _deviceId,
      workspacePath: _workspacePath.isEmpty ? '~' : _workspacePath,
      agentType: _agentType,
      status: SessionStatus.running,
      startedAt: DateTime.now(),
    );
    ref.read(sessionsProvider.notifier).add(session);
    final client = ref.read(wsClientProvider);
    await client?.send(InnerMessage.create('session.start', {
      'session_id': sid,
      'device_id': _deviceId,
      'workspace_path': session.workspacePath,
      'agent_type': _agentType,
    }));
    if (mounted) {
      context.pop();
      context.push('/session/$sid', extra: session);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        leading: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: _step == 0 ? () => context.pop() : () => setState(() => _step--),
          child: Text(_step == 0 ? '取消' : '返回', style: TextStyle(color: c.tint)),
        ),
        middle: Text(['选择设备', '工作区', '选择 Agent'][_step],
          style: TextStyle(color: c.fg)),
        trailing: _step < 2
            ? CupertinoButton(
                padding: EdgeInsets.zero,
                onPressed: _canProceed ? () => setState(() => _step++) : null,
                child: Text('下一步', style: TextStyle(
                  color: _canProceed ? c.tint : c.fg3,
                  fontWeight: FontWeight.w600,
                )),
              )
            : CupertinoButton(
                padding: EdgeInsets.zero,
                onPressed: _canProceed && !_busy ? _finish : null,
                child: _busy
                    ? CupertinoActivityIndicator(color: c.tint)
                    : Text('开始', style: TextStyle(
                        color: _canProceed ? c.tint : c.fg3,
                        fontWeight: FontWeight.w700,
                      )),
              ),
      ),
      child: SafeArea(
        child: [_buildStep0(c), _buildStep1(c), _buildStep2(c)][_step],
      ),
    );
  }

  bool get _canProceed => switch (_step) {
    0 => _deviceId.isNotEmpty,
    1 => true,
    _ => true,
  };

  Widget _buildStep0(ThemeColors c) {
    final devices = ref.watch(devicesProvider);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StepHint(text: '选择要控制的设备', colors: c),
        if (devices.isEmpty) ...[
          const SizedBox(height: 32),
          Center(child: Column(children: [
            Text('🖥', style: const TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text('没有在线设备', style: TextStyle(fontSize: 16, color: c.fg2)),
            const SizedBox(height: 6),
            Text('请先在设备上启动 HelloBug daemon', style: TextStyle(fontSize: 13, color: c.fg3)),
            const SizedBox(height: 20),
            // Dev stub: add a placeholder device for UI testing
            CupertinoButton(
              onPressed: () => setState(() => _deviceId = 'dev-stub'),
              child: Text('使用测试设备（开发用）', style: TextStyle(fontSize: 14, color: c.tint)),
            ),
          ])),
        ] else
          ...devices.values.map((d) => _SelectRow(
            icon: '💻',
            title: d.machineName,
            subtitle: d.os,
            selected: _deviceId == d.deviceId,
            online: d.online,
            onTap: d.online ? () => setState(() => _deviceId = d.deviceId) : null,
          )),
      ],
    );
  }

  Widget _buildStep1(ThemeColors c) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StepHint(text: '输入工作区路径', colors: c),
        const SizedBox(height: 12),
        CupertinoTextField(
          controller: _workspaceCtrl,
          placeholder: '例：/Users/me/projects/myapp',
          placeholderStyle: TextStyle(color: c.fg3),
          style: TextStyle(color: c.fg, fontFamily: 'Menlo', fontSize: 14),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: c.bg2, borderRadius: BorderRadius.circular(10)),
          onChanged: (v) => setState(() => _workspacePath = v),
          autocorrect: false,
          enableSuggestions: false,
        ),
        const SizedBox(height: 8),
        Text('留空则使用 daemon 默认工作区', style: TextStyle(fontSize: 13, color: c.fg3)),
      ],
    );
  }

  Widget _buildStep2(ThemeColors c) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StepHint(text: '选择 Agent 类型', colors: c),
        const SizedBox(height: 8),
        ..._agents.map((a) => _SelectRow(
          icon: a.$2,
          title: a.$3,
          subtitle: a.$4,
          selected: _agentType == a.$1,
          onTap: () => setState(() => _agentType = a.$1),
        )),
      ],
    );
  }
}

class _StepHint extends StatelessWidget {
  const _StepHint({required this.text, required this.colors});
  final String text;
  final ThemeColors colors;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Text(text, style: TextStyle(fontSize: 13, color: colors.fg2, letterSpacing: .2)),
    );
  }
}

class _SelectRow extends StatelessWidget {
  const _SelectRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
    this.onTap,
    this.online,
  });
  final String icon;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback? onTap;
  final bool? online;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final disabled = onTap == null;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected ? c.tintBg : c.bg2,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? c.tint : c.separator,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(children: [
          Text(icon, style: TextStyle(fontSize: 22, color: disabled ? const Color(0x66FFFFFF) : null)),
          const SizedBox(width: 12),
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: TextStyle(
                fontSize: 15, fontWeight: FontWeight.w600,
                color: disabled ? c.fg3 : c.fg,
              )),
              Text(subtitle, style: TextStyle(fontSize: 13, color: disabled ? c.fg3 : c.fg2)),
            ],
          )),
          if (online != null) ...[
            const SizedBox(width: 8),
            Container(
              width: 7, height: 7,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: online! ? AppColors.green : c.fg3,
              ),
            ),
          ],
          if (selected) ...[
            const SizedBox(width: 8),
            Icon(CupertinoIcons.checkmark_alt, size: 18, color: c.tint),
          ],
        ]),
      ),
    );
  }
}
