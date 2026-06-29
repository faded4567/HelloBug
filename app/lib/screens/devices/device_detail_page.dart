import 'dart:async';
import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/device_summary.dart';
import '../../models/workspace_summary.dart';
import '../../state/devices_provider.dart';
import '../../state/sessions_provider.dart';
import '../../state/workspaces_provider.dart';
import '../../theme/index.dart';
import '../../transport/app_runtime_store.dart';
import '../../transport/ws_provider.dart';

class DeviceDetailPage extends ConsumerStatefulWidget {
  const DeviceDetailPage({
    super.key,
    required this.deviceId,
    this.initialDevice,
  });

  final String deviceId;
  final DeviceSummary? initialDevice;

  @override
  ConsumerState<DeviceDetailPage> createState() => _DeviceDetailPageState();
}

class _DeviceDetailPageState extends ConsumerState<DeviceDetailPage> {
  AppRuntimeState? _runtime;
  String? _fingerprint;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadRuntime());
  }

  Future<void> _loadRuntime() async {
    final runtime = await AppRuntimeStore.load();
    if (!mounted) {
      return;
    }
    final fingerprint =
        runtime?.pairedDaemonId == widget.deviceId
            ? await _buildFingerprint(runtime?.pairedDaemonEd25519PubKey)
            : null;
    if (!mounted) {
      return;
    }
    setState(() {
      _runtime = runtime;
      _fingerprint = fingerprint;
    });
  }

  @override
  Widget build(BuildContext context) {
    final device =
        ref.watch(devicesProvider)[widget.deviceId] ?? widget.initialDevice;
    final c = context.colors;
    if (device == null) {
      return CupertinoPageScaffold(
        backgroundColor: c.bg,
        navigationBar: CupertinoNavigationBar(
          backgroundColor: c.bg,
          border: null,
          middle: Text('设备详情', style: TextStyle(color: c.fg)),
        ),
        child: Center(
          child: Text('设备不存在', style: TextStyle(fontSize: 16, color: c.fg2)),
        ),
      );
    }

    final sessions = ref.watch(sessionsProvider);
    final workspaceCatalog = ref.watch(workspacesProvider);
    final workspaceItems = workspaceCatalog.valueOrNull?.items ?? const [];
    final sessionCount =
        sessions.where((session) => session.deviceId == device.deviceId).length;
    final lastSeenText = _formatLastSeen(device);
    final heroMeta = [
      if (device.pairedAt != null) '配对于 ${_formatDateTime(device.pairedAt!)}',
      '上次在线 $lastSeenText',
    ].join(' · ');

    return CupertinoPageScaffold(
      backgroundColor: c.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: c.bg,
        border: null,
        middle: Text('设备详情', style: TextStyle(color: c.fg)),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: _busy ? null : () => _showRenameDialog(device),
          child:
              _busy
                  ? CupertinoActivityIndicator(color: c.tint)
                  : Text('重命名', style: TextStyle(color: c.tint)),
        ),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 48),
          children: [
            Container(
              margin: const EdgeInsets.only(top: 16, bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
              decoration: BoxDecoration(
                color: c.bg2,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF1C3A5E), Color(0x220A84FF)],
                      ),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: c.separator),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      device.isRevoked
                          ? '🚫'
                          : device.online
                          ? '💻'
                          : '🖥',
                      style: const TextStyle(fontSize: 34),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    device.machineName,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: c.fg,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _deviceStatusColor(device, c),
                          boxShadow:
                              device.online && !device.isRevoked
                                  ? [
                                    BoxShadow(
                                      color: AppColors.green.withValues(
                                        alpha: .25,
                                      ),
                                      blurRadius: 4,
                                      spreadRadius: 2,
                                    ),
                                  ]
                                  : null,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        _deviceStatusText(device),
                        style: TextStyle(fontSize: 13, color: c.fg2),
                      ),
                      if (device.os.isNotEmpty) ...[
                        const Text(
                          '  ·  ',
                          style: TextStyle(color: Color(0x40FFFFFF)),
                        ),
                        Text(
                          device.os,
                          style: TextStyle(fontSize: 13, color: c.fg2),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(heroMeta, style: TextStyle(fontSize: 13, color: c.fg2)),
                ],
              ),
            ),
            Row(
              children: [
                _statCard('${device.activeSessions}', '活跃会话', c.tint, c),
                const SizedBox(width: 8),
                _statCard('${workspaceItems.length}', '工作区', c.fg, c),
                const SizedBox(width: 8),
                _statCard('$sessionCount', '会话', c.fg, c),
              ],
            ),
            const SizedBox(height: 8),
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('系统信息', style: TextStyle(color: c.fg2)),
              children: [
                _infoRow('🧩', 'Daemon 版本', _orDash(device.daemonVersion), c),
                _infoRow('🖥', '操作系统', _orDash(device.os), c),
                _infoRow(
                  '🕓',
                  '配对时间',
                  device.pairedAt != null
                      ? _formatDateTime(device.pairedAt!)
                      : (_runtime?.pairedDaemonId == device.deviceId
                          ? '已配对'
                          : '--'),
                  c,
                ),
                _infoRow(
                  '🌐',
                  '访问状态',
                  _deviceStatusText(device),
                  c,
                  valueColor: _deviceStatusColor(device, c),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('工作区', style: TextStyle(color: c.fg2)),
              children: [
                if (workspaceCatalog.isLoading && workspaceItems.isEmpty)
                  const CupertinoListTile(
                    title: Text('正在读取工作区'),
                    trailing: CupertinoActivityIndicator(),
                  )
                else if (workspaceCatalog.hasError && workspaceItems.isEmpty)
                  CupertinoListTile(
                    leading: _ico('⚠️', c.bg3),
                    title: const Text('工作区列表读取失败'),
                    subtitle: Text(
                      '${workspaceCatalog.error}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  )
                else if (workspaceItems.isEmpty)
                  CupertinoListTile(
                    leading: _ico('📂', c.bg3),
                    title: const Text('暂无工作区'),
                    subtitle: const Text('daemon 尚未返回可访问工作区'),
                  )
                else
                  for (final workspace in workspaceItems)
                    _WorkspaceRow(workspace: workspace, colors: c),
              ],
            ),
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('设备密钥', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _ico('🔑', AppColors.green.withValues(alpha: .12)),
                  title: const Text('Ed25519 指纹'),
                  subtitle: Text(
                    _fingerprint ?? '暂未读取到设备公钥',
                    style: const TextStyle(fontFamily: 'Menlo', fontSize: 11),
                  ),
                  trailing:
                      _fingerprint == null
                          ? null
                          : CupertinoButton(
                            padding: EdgeInsets.zero,
                            onPressed:
                                () => Clipboard.setData(
                                  ClipboardData(text: _fingerprint!),
                                ),
                            child: Text(
                              '复制',
                              style: TextStyle(fontSize: 13, color: c.tint),
                            ),
                          ),
                ),
                CupertinoListTile(
                  leading: _ico('🔄', AppColors.orange.withValues(alpha: .12)),
                  title: const Text('轮换设备密钥'),
                  subtitle: const Text('后端接口尚未接入'),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              margin: EdgeInsets.zero,
              header: Text('危险操作', style: TextStyle(color: c.fg2)),
              children: [
                CupertinoListTile(
                  leading: _ico('🔓', AppColors.red.withValues(alpha: .12)),
                  title: const Text(
                    '解绑此设备',
                    style: TextStyle(color: AppColors.red),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap:
                      _busy
                          ? null
                          : () => _confirmDanger(
                            title: '解绑此设备',
                            message: '确认后当前 App 会断开连接，并返回配对流程。',
                            onConfirm:
                                () => _revokeDevice(device, mode: 'unlink'),
                          ),
                ),
                CupertinoListTile(
                  leading: _ico('🚫', AppColors.red.withValues(alpha: .12)),
                  title: const Text(
                    '吊销设备密钥',
                    style: TextStyle(color: AppColors.red),
                  ),
                  trailing: const CupertinoListTileChevron(),
                  onTap:
                      _busy
                          ? null
                          : () => _confirmDanger(
                            title: '吊销设备密钥',
                            message: '吊销后 daemon 会立即断开，后续需要重新配对。',
                            onConfirm:
                                () => _revokeDevice(device, mode: 'revoke'),
                          ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showRenameDialog(DeviceSummary device) async {
    final controller = TextEditingController(text: device.machineName);
    try {
      await showCupertinoDialog<void>(
        context: context,
        builder:
            (dialogContext) => CupertinoAlertDialog(
              title: const Text('重命名设备'),
              content: Padding(
                padding: const EdgeInsets.only(top: 12),
                child: CupertinoTextField(
                  controller: controller,
                  autofocus: true,
                  placeholder: '输入设备名称',
                ),
              ),
              actions: [
                CupertinoDialogAction(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('取消'),
                ),
                CupertinoDialogAction(
                  onPressed: () {
                    final nextName = controller.text.trim();
                    if (nextName.isEmpty) {
                      return;
                    }
                    Navigator.of(dialogContext).pop();
                    unawaited(_renameDevice(device.deviceId, nextName));
                  },
                  child: const Text('保存'),
                ),
              ],
            ),
      );
    } finally {
      controller.dispose();
    }
  }

  Future<void> _renameDevice(String deviceId, String machineName) async {
    if (_busy) {
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(devicesProvider.notifier)
          .renameDevice(deviceId, machineName);
    } catch (error) {
      if (!mounted) {
        return;
      }
      await _showMessage('重命名失败', _friendlyError(error));
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _confirmDanger({
    required String title,
    required String message,
    required Future<void> Function() onConfirm,
  }) {
    return showCupertinoDialog<void>(
      context: context,
      builder:
          (dialogContext) => CupertinoAlertDialog(
            title: Text(title),
            content: Text(message),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('取消'),
              ),
              CupertinoDialogAction(
                isDestructiveAction: true,
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                  unawaited(onConfirm());
                },
                child: const Text('确认'),
              ),
            ],
          ),
    );
  }

  Future<void> _revokeDevice(
    DeviceSummary device, {
    required String mode,
  }) async {
    if (_busy) {
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(devicesProvider.notifier)
          .revokeDevice(device.deviceId, mode: mode);
      if (mode == 'unlink') {
        final client = ref.read(wsClientProvider);
        ref.read(wsClientProvider.notifier).state = null;
        client?.dispose();
        ref.read(devicesProvider.notifier).clear();
        ref.read(sessionsProvider.notifier).clear();
        await AppRuntimeStore.clear();
        if (mounted) {
          context.go('/onboarding');
        }
        return;
      }

      ref.read(sessionsProvider.notifier).markDeviceOffline(device.deviceId);
      if (mounted) {
        await _showMessage('设备已吊销', '该设备已断开，重新配对后才能继续使用。');
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      await _showMessage('操作失败', _friendlyError(error));
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _showMessage(String title, String message) {
    return showCupertinoDialog<void>(
      context: context,
      builder:
          (dialogContext) => CupertinoAlertDialog(
            title: Text(title),
            content: Text(message),
            actions: [
              CupertinoDialogAction(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('知道了'),
              ),
            ],
          ),
    );
  }

  String _friendlyError(Object error) {
    if (error is TimeoutException) {
      return '等待服务器响应超时，请稍后重试';
    }
    if (error is StateError) {
      return error.message.toString();
    }
    return error.toString();
  }
}

Widget _statCard(String value, String label, Color valueColor, ThemeColors c) =>
    Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: c.bg2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: valueColor,
              ),
            ),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 12, color: c.fg2)),
          ],
        ),
      ),
    );

CupertinoListTile _infoRow(
  String icon,
  String label,
  String value,
  ThemeColors c, {
  Color? valueColor,
}) => CupertinoListTile(
  leading: _ico(icon, c.bg3),
  title: Text(label),
  additionalInfo: Text(
    value,
    style: TextStyle(color: valueColor ?? c.fg2, fontSize: 14),
  ),
);

class _WorkspaceRow extends StatelessWidget {
  const _WorkspaceRow({required this.workspace, required this.colors});

  final WorkspaceSummary workspace;
  final ThemeColors colors;

  @override
  Widget build(BuildContext context) {
    final subtitle = switch (workspace.status) {
      WorkspaceStatus.ready =>
        workspace.entryCount == null
            ? workspace.path
            : '${workspace.path} · ${workspace.entryCount} 项',
      WorkspaceStatus.missing => '${workspace.path} · 目录不存在',
      WorkspaceStatus.forbidden => '${workspace.path} · 无访问权限',
      WorkspaceStatus.notDir => '${workspace.path} · 不是文件夹',
    };
    return CupertinoListTile(
      leading: _ico('📂', _workspaceIconBg(workspace, colors)),
      title: Text(
        workspace.name,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        subtitle,
        style: TextStyle(fontSize: 12, color: colors.fg3),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: _workspaceChipBg(workspace, colors),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          _workspaceChipText(workspace),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: _workspaceChipFg(workspace, colors),
          ),
        ),
      ),
    );
  }
}

Widget _ico(String emoji, Color bg) => Container(
  width: 30,
  height: 30,
  decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(7)),
  alignment: Alignment.center,
  child: Text(emoji, style: const TextStyle(fontSize: 16)),
);

Color _deviceStatusColor(DeviceSummary device, ThemeColors colors) {
  if (device.isRevoked) {
    return AppColors.red;
  }
  return device.online ? AppColors.green : colors.fg3;
}

String _deviceStatusText(DeviceSummary device) {
  if (device.isRevoked) {
    return '已吊销';
  }
  return device.online ? '在线' : '离线';
}

String _formatLastSeen(DeviceSummary device) {
  if (device.lastSeen == null) {
    return '未知';
  }
  final diff = DateTime.now().difference(device.lastSeen!);
  if (diff.inMinutes < 1) {
    return '刚刚';
  }
  if (diff.inHours < 1) {
    return '${diff.inMinutes} 分钟前';
  }
  if (diff.inDays < 1) {
    return '${diff.inHours} 小时前';
  }
  return _formatDateTime(device.lastSeen!);
}

String _formatDateTime(DateTime value) {
  final local = value.toLocal();
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} '
      '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

String _orDash(String value) => value.trim().isEmpty ? '--' : value;

Color _workspaceIconBg(WorkspaceSummary workspace, ThemeColors colors) {
  return switch (workspace.status) {
    WorkspaceStatus.ready =>
      workspace.isDefault
          ? colors.tintBg
          : const Color(0xFF5E5CE6).withValues(alpha: .10),
    WorkspaceStatus.missing => AppColors.orange.withValues(alpha: .12),
    WorkspaceStatus.forbidden => AppColors.red.withValues(alpha: .12),
    WorkspaceStatus.notDir => colors.bg3,
  };
}

Color _workspaceChipBg(WorkspaceSummary workspace, ThemeColors colors) {
  return switch (workspace.status) {
    WorkspaceStatus.ready => AppColors.green.withValues(alpha: .15),
    WorkspaceStatus.missing => AppColors.orange.withValues(alpha: .12),
    WorkspaceStatus.forbidden => AppColors.red.withValues(alpha: .12),
    WorkspaceStatus.notDir => colors.bg3,
  };
}

Color _workspaceChipFg(WorkspaceSummary workspace, ThemeColors colors) {
  return switch (workspace.status) {
    WorkspaceStatus.ready => AppColors.green,
    WorkspaceStatus.missing => AppColors.orange,
    WorkspaceStatus.forbidden => AppColors.red,
    WorkspaceStatus.notDir => colors.fg2,
  };
}

String _workspaceChipText(WorkspaceSummary workspace) {
  if (workspace.isDefault && workspace.status == WorkspaceStatus.ready) {
    return '默认';
  }
  return switch (workspace.status) {
    WorkspaceStatus.ready => '可用',
    WorkspaceStatus.missing => '缺失',
    WorkspaceStatus.forbidden => '无权限',
    WorkspaceStatus.notDir => '非目录',
  };
}

Future<String?> _buildFingerprint(String? base64PublicKey) async {
  if (base64PublicKey == null || base64PublicKey.isEmpty) {
    return null;
  }
  try {
    final bytes = base64Url.decode(base64Url.normalize(base64PublicKey));
    final digest = await Sha256().hash(bytes);
    final encoded = base64Url.encode(digest.bytes).replaceAll('=', '');
    return 'SHA256:$encoded';
  } catch (_) {
    return null;
  }
}
