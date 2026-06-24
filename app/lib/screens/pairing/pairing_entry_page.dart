import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../theme/index.dart';
import '../../transport/app_runtime_store.dart';
import '../../transport/ws_provider.dart';
import 'pairing_controller.dart';

class PairingEntryPage extends ConsumerStatefulWidget {
  const PairingEntryPage({super.key});

  @override
  ConsumerState<PairingEntryPage> createState() => _PairingEntryPageState();
}

class _PairingEntryPageState extends ConsumerState<PairingEntryPage> {
  static const _debugServerUrl = String.fromEnvironment(
    'HELLOBUG_DEBUG_SERVER_URL',
    defaultValue: 'ws://10.0.2.2:3000/v1/relay',
  );
  static const _debugPairingCode = String.fromEnvironment(
    'HELLOBUG_DEBUG_PAIRING_CODE',
    defaultValue: '',
  );

  // 6-digit PIN split into two groups of 3
  final List<String> _digits = List.filled(6, '');
  late final _serverController = TextEditingController(
    text: kDebugMode ? _debugServerUrl : 'wss://relay.example.com',
  );

  @override
  void initState() {
    super.initState();
    unawaited(_loadServerUrl());
    if (kDebugMode && _debugPairingCode.length == 6) {
      for (var i = 0; i < 6; i++) {
        _digits[i] = _debugPairingCode[i];
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        unawaited(_connect(debugCodeOverride: _debugPairingCode));
      });
    }
  }

  bool _canConnect(PairingState pairing) =>
      _digits.every((d) => d.isNotEmpty) && !pairing.isBusy;

  void _onPinChanged(int index, String value) {
    setState(
      () => _digits[index] = value.isEmpty ? '' : value[value.length - 1],
    );
  }

  Future<void> _loadServerUrl() async {
    final liveClient = ref.read(wsClientProvider);
    final runtime = await AppRuntimeStore.load();
    final serverUrl = liveClient?.serverUri.toString() ?? runtime?.serverUrl;
    if (!mounted || serverUrl == null || serverUrl.isEmpty) {
      return;
    }
    _serverController.text = serverUrl;
  }

  Future<void> _connect({String? debugCodeOverride}) async {
    final pairing = ref.read(pairingControllerProvider);
    if (!_canConnect(pairing)) return;
    final pin = debugCodeOverride ?? _digits.join();
    final success = await ref
        .read(pairingControllerProvider.notifier)
        .startManual(pin, _serverController.text);
    if (!mounted || !success) return;
    context.push('/pairing/sas');
  }

  Future<void> _scanQr() async {
    final payload = await context.push<String>('/pairing/qr');
    if (!mounted || payload == null || payload.isEmpty) return;
    final success = await ref
        .read(pairingControllerProvider.notifier)
        .startFromQr(payload);
    if (!mounted || !success) return;
    context.push('/pairing/sas');
  }

  @override
  void dispose() {
    _serverController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pairing = ref.watch(pairingControllerProvider);
    return CupertinoPageScaffold(
      backgroundColor: context.colors.bg,
      navigationBar: CupertinoNavigationBar(
        backgroundColor: context.colors.bg,
        border: null,
        middle: Text('配对设备', style: TextStyle(color: context.colors.fg)),
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // context banner
              Container(
                margin: const EdgeInsets.only(top: 8, bottom: 4),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 11,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFF34C759).withValues(alpha: .1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('💡', style: TextStyle(fontSize: 16)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: '只需配对一次',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: const Color(0xFF34C759),
                                fontSize: 13,
                              ),
                            ),
                            TextSpan(
                              text:
                                  '，在家里电脑旁完成。\n之后在外面通过云中继发指令，Daemon 在你桌面机上执行，结果流回手机——看到的是 Claude Code 的文字输出，不是屏幕画面。',
                              style: TextStyle(
                                color: const Color(0xFF34C759),
                                fontSize: 13,
                                height: 1.55,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text(
                '在电脑上运行 HelloBug daemon\n后扫码或输入控制台显示的配对码',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color: context.colors.fg2,
                  height: 1.6,
                ),
              ),
              const SizedBox(height: 4),
              // QR zone
              GestureDetector(
                onTap: _scanQr,
                child: Container(
                  width: double.infinity,
                  height: 200,
                  margin: const EdgeInsets.only(top: 12, bottom: 8),
                  decoration: BoxDecoration(
                    color: context.colors.bg3,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: context.colors.separator,
                      width: 2,
                      style: BorderStyle.solid,
                    ),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('⬛', style: TextStyle(fontSize: 48)),
                      const SizedBox(height: 12),
                      Text(
                        '点击扫描二维码',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: context.colors.fg,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '需要相机权限',
                        style: TextStyle(
                          fontSize: 14,
                          color: context.colors.fg2,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              // divider
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: Container(
                        height: .5,
                        color: context.colors.separator,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(
                        '或手动输入',
                        style: TextStyle(
                          fontSize: 13,
                          color: context.colors.fg3,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Container(
                        height: .5,
                        color: context.colors.separator,
                      ),
                    ),
                  ],
                ),
              ),
              // PIN input label
              Text(
                '配对码（daemon 控制台显示，时效以 daemon 当前配置为准）',
                style: TextStyle(fontSize: 13, color: context.colors.fg2),
              ),
              const SizedBox(height: 8),
              _PinRow(digits: _digits, onChanged: _onPinChanged),
              const SizedBox(height: 16),
              // server address
              Text(
                '中继服务器地址',
                style: TextStyle(fontSize: 13, color: context.colors.fg2),
              ),
              const SizedBox(height: 6),
              CupertinoTextField(
                controller: _serverController,
                style: TextStyle(fontSize: 15, color: context.colors.fg),
                decoration: BoxDecoration(
                  color: context.colors.bg3,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: context.colors.separator),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                keyboardType: TextInputType.url,
                autocorrect: false,
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: CupertinoButton(
                  onPressed: _canConnect(pairing) ? _connect : null,
                  color: context.colors.tint,
                  borderRadius: BorderRadius.circular(12),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    pairing.step == PairingStep.connecting ? '连接中...' : '连接',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      color: CupertinoColors.white,
                    ),
                  ),
                ),
              ),
              if (pairing.errorMessage != null) ...[
                const SizedBox(height: 12),
                Text(
                  pairing.errorMessage!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xFFFF3B30),
                    height: 1.5,
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Text(
                '配对完成后需在双端核对安全短串以防止中间人攻击',
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, color: context.colors.fg3),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── PIN row ─────────────────────────────────────────────────────────────────

class _PinRow extends StatefulWidget {
  const _PinRow({required this.digits, required this.onChanged});
  final List<String> digits;
  final void Function(int index, String value) onChanged;

  @override
  State<_PinRow> createState() => _PinRowState();
}

class _PinRowState extends State<_PinRow> {
  late final List<TextEditingController> _controllers;
  late final List<FocusNode> _nodes;

  @override
  void initState() {
    super.initState();
    _controllers = List.generate(
      6,
      (i) => TextEditingController(text: widget.digits[i]),
    );
    _nodes = List.generate(6, (_) => FocusNode());
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    for (final n in _nodes) {
      n.dispose();
    }
    super.dispose();
  }

  void _handleInput(int i, String v) {
    final char = v.isEmpty ? '' : v[v.length - 1];
    _controllers[i].text = char;
    widget.onChanged(i, char);
    if (char.isNotEmpty && i < 5) _nodes[i + 1].requestFocus();
    if (char.isEmpty && i > 0) _nodes[i - 1].requestFocus();
  }

  @override
  void didUpdateWidget(covariant _PinRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    for (var i = 0; i < 6; i++) {
      final next = widget.digits[i];
      if (_controllers[i].text != next) {
        _controllers[i].text = next;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (int i = 0; i < 6; i++) ...[
          if (i == 3)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: Text(
                '—',
                style: TextStyle(fontSize: 20, color: context.colors.fg3),
              ),
            ),
          _PinBox(
            controller: _controllers[i],
            focusNode: _nodes[i],
            onChanged: (v) => _handleInput(i, v),
          ),
          if (i < 5 && i != 2) const SizedBox(width: 8),
        ],
      ],
    );
  }
}

class _PinBox extends StatelessWidget {
  const _PinBox({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
  });
  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 44,
      height: 52,
      child: CupertinoTextField(
        controller: controller,
        focusNode: focusNode,
        onChanged: onChanged,
        textAlign: TextAlign.center,
        maxLength: 2,
        style: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          color: context.colors.tint,
          fontFamily: 'SF Mono',
        ),
        decoration: BoxDecoration(
          color: context.colors.bg3,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: context.colors.separator),
        ),
        keyboardType: TextInputType.number,
      ),
    );
  }
}
