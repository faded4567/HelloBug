import 'dart:async';
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

class NewSessionFlowArgs {
  const NewSessionFlowArgs({
    this.preferredDeviceId,
    this.workspacePath,
    this.agentType,
    this.resumeSessionId,
  });

  final String? preferredDeviceId;
  final String? workspacePath;
  final String? agentType;
  final String? resumeSessionId;

  bool get isResumeFlow =>
      (resumeSessionId != null && resumeSessionId!.trim().isNotEmpty);
}

class NewSessionFlow extends ConsumerStatefulWidget {
  const NewSessionFlow({super.key, this.initialArgs});

  final NewSessionFlowArgs? initialArgs;

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

  @override
  void initState() {
    super.initState();
    _deviceId = widget.initialArgs?.preferredDeviceId?.trim() ?? '';
    _workspacePath = widget.initialArgs?.workspacePath?.trim() ?? '';
    _agentType = _resolveInitialAgentType();
    _workspaceCtrl.text = _workspacePath;
  }

  bool get _isResumeFlow => widget.initialArgs?.isResumeFlow ?? false;

  String? get _resumeSessionId {
    final raw = widget.initialArgs?.resumeSessionId?.trim() ?? '';
    return raw.isEmpty ? null : raw;
  }

  String _resolveInitialAgentType() {
    if (_isResumeFlow) {
      return 'claude_code';
    }
    final candidate = widget.initialArgs?.agentType?.trim() ?? '';
    final matched = _agents.where((agent) => agent.$1 == candidate);
    if (matched.isNotEmpty) {
      return matched.first.$1;
    }
    return 'claude_code';
  }

  bool get _selectedDeviceOnline {
    if (_deviceId.isEmpty) {
      return false;
    }
    final device = ref.read(devicesProvider)[_deviceId];
    return device?.online ?? false;
  }

  List<(String, String, String, String)> get _visibleAgents {
    if (!_isResumeFlow) {
      return _agents;
    }
    return _agents
        .where((agent) => agent.$1 == 'claude_code')
        .toList(growable: false);
  }

  String _uuid() {
    final rng = Random.secure();
    final b = List<int>.generate(16, (_) => rng.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    String h(List<int> v) =>
        v.map((e) => e.toRadixString(16).padLeft(2, '0')).join();
    return '${h(b.sublist(0, 4))}-${h(b.sublist(4, 6))}-${h(b.sublist(6, 8))}-${h(b.sublist(8, 10))}-${h(b.sublist(10))}';
  }

  Future<void> _finish() async {
    if (_busy) {
      return;
    }
    setState(() => _busy = true);
    final sid = _uuid();
    final workspacePath = _workspacePath.trim();
    final agentType = _isResumeFlow ? 'claude_code' : _agentType;
    final startMessage = InnerMessage.create('session.start', {
      'session_id': sid,
      'workspace_path': workspacePath,
      'agent_type': agentType,
      'resume_session_id': _resumeSessionId,
    });
    debugPrint(
      '[NewSession] start session_id=$sid request_id=${startMessage.id} device=$_deviceId workspace=$workspacePath agent=$agentType resume=${_resumeSessionId ?? ''}',
    );
    final client = ref.read(wsClientProvider);
    if (client == null) {
      debugPrint('[NewSession] aborted because ws client is null');
      if (mounted) {
        setState(() => _busy = false);
        await _showStartError('中继连接未建立，请稍后重试');
      }
      return;
    }

    final responseFuture = client.messages
        .firstWhere(
          (message) =>
              (message.type == 'session.start.result' ||
                  message.type == 'error') &&
              message.payload['request_id'] == startMessage.id,
        )
        .timeout(const Duration(seconds: 15));

    try {
      await client.send(startMessage);
      debugPrint(
        '[NewSession] session.start sent session_id=$sid request_id=${startMessage.id}',
      );
      final response = await responseFuture;
      if (response.type == 'error') {
        throw StateError(response.payload['message'] as String? ?? '启动失败');
      }

      final status = response.payload['status'] as String? ?? 'rejected';
      final resolvedWorkspacePath =
          response.payload['workspace_path'] as String? ?? workspacePath;
      final resolvedAgentType =
          response.payload['agent_type'] as String? ?? agentType;
      final resultMessage =
          response.payload['message'] as String? ?? '会话启动失败';
      if (status != 'started') {
        throw StateError(resultMessage);
      }

      final session = SessionSummary(
        sessionId: sid,
        deviceId: _deviceId,
        workspacePath: resolvedWorkspacePath,
        agentType: resolvedAgentType,
        status: SessionStatus.running,
        startedAt: DateTime.now(),
      );
      ref.read(sessionsProvider.notifier).add(session);
      debugPrint(
        '[NewSession] session.start confirmed session_id=$sid workspace=$resolvedWorkspacePath agent=$resolvedAgentType',
      );

      if (!mounted) {
        return;
      }
      context.pop();
      context.push(
        session.agentType == 'shell' ? '/terminal/$sid' : '/session/$sid',
        extra: session,
      );
    } catch (error) {
      debugPrint('[NewSession] start failed session_id=$sid error=$error');
      if (mounted) {
        setState(() => _busy = false);
        await _showStartError(_friendlyStartError(error));
      }
    }
  }

  Future<void> _showStartError(String message) {
    return showCupertinoDialog<void>(
      context: context,
      builder:
          (_) => CupertinoAlertDialog(
            title: const Text('启动失败'),
            content: Text(message),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('知道了'),
              ),
            ],
          ),
    );
  }

  String _friendlyStartError(Object error) {
    if (error is TimeoutException) {
      return '等待电脑端确认超时，请检查 daemon 是否在线后重试';
    }
    if (error is StateError) {
      return error.message.toString();
    }
    return error.toString();
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
          onPressed:
              _step == 0 ? () => context.pop() : () => setState(() => _step--),
          child: Text(
            _step == 0 ? '取消' : '返回',
            style: TextStyle(color: c.tint),
          ),
        ),
        middle: Text(
          ['选择设备', '工作区', '选择 Agent'][_step],
          style: TextStyle(color: c.fg),
        ),
        trailing:
            _step < 2
                ? CupertinoButton(
                  padding: EdgeInsets.zero,
                  onPressed: _canProceed ? () => setState(() => _step++) : null,
                  child: Text(
                    '下一步',
                    style: TextStyle(
                      color: _canProceed ? c.tint : c.fg3,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                )
                : CupertinoButton(
                  padding: EdgeInsets.zero,
                  onPressed: _canProceed && !_busy ? _finish : null,
                  child:
                      _busy
                          ? CupertinoActivityIndicator(color: c.tint)
                          : Text(
                            '开始',
                            style: TextStyle(
                              color: _canProceed ? c.tint : c.fg3,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                ),
      ),
      child: SafeArea(
        child: [_buildStep0(c), _buildStep1(c), _buildStep2(c)][_step],
      ),
    );
  }

  bool get _canProceed => switch (_step) {
    0 => _selectedDeviceOnline,
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
          Center(
            child: Column(
              children: [
                Text('🖥', style: const TextStyle(fontSize: 40)),
                const SizedBox(height: 12),
                Text('没有在线设备', style: TextStyle(fontSize: 16, color: c.fg2)),
                const SizedBox(height: 6),
                Text(
                  '请先在设备上启动 HelloBug daemon',
                  style: TextStyle(fontSize: 13, color: c.fg3),
                ),
              ],
            ),
          ),
        ] else
          ...devices.values.map(
            (d) => _SelectRow(
              icon: '💻',
              title: d.machineName,
              subtitle: d.os,
              selected: _deviceId == d.deviceId,
              online: d.online,
              onTap:
                  d.online
                      ? () => setState(() => _deviceId = d.deviceId)
                      : null,
            ),
          ),
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
          decoration: BoxDecoration(
            color: c.bg2,
            borderRadius: BorderRadius.circular(10),
          ),
          onChanged:
              _isResumeFlow ? null : (v) => setState(() => _workspacePath = v),
          readOnly: _isResumeFlow,
          autocorrect: false,
          enableSuggestions: false,
        ),
        const SizedBox(height: 8),
        Text(
          _isResumeFlow
              ? '继续历史会话时会沿用原 transcript 的工作区路径'
              : '留空则使用 daemon 默认工作区',
          style: TextStyle(fontSize: 13, color: c.fg3),
        ),
        if (_isResumeFlow) ...[
          const SizedBox(height: 8),
          Text(
            '历史 session: ${_resumeSessionId ?? ''}',
            style: TextStyle(fontSize: 12, color: c.fg3),
          ),
        ],
      ],
    );
  }

  Widget _buildStep2(ThemeColors c) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StepHint(text: '选择 Agent 类型', colors: c),
        const SizedBox(height: 8),
        ..._visibleAgents.map(
          (a) => _SelectRow(
            icon: a.$2,
            title: a.$3,
            subtitle: a.$4,
            selected: _agentType == a.$1,
            onTap:
                _isResumeFlow ? null : () => setState(() => _agentType = a.$1),
          ),
        ),
        if (_isResumeFlow) ...[
          const SizedBox(height: 8),
          Text(
            '历史 transcript 续接当前只支持 Claude Code runtime',
            style: TextStyle(fontSize: 13, color: c.fg3),
          ),
        ],
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
      child: Text(
        text,
        style: TextStyle(fontSize: 13, color: colors.fg2, letterSpacing: .2),
      ),
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
        child: Row(
          children: [
            Text(
              icon,
              style: TextStyle(
                fontSize: 22,
                color: disabled ? const Color(0x66FFFFFF) : null,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: disabled ? c.fg3 : c.fg,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 13,
                      color: disabled ? c.fg3 : c.fg2,
                    ),
                  ),
                ],
              ),
            ),
            if (online != null) ...[
              const SizedBox(width: 8),
              Container(
                width: 7,
                height: 7,
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
          ],
        ),
      ),
    );
  }
}
