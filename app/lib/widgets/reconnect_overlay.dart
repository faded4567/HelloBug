import 'dart:async';
import 'dart:ui';

import 'package:flutter/cupertino.dart';

import '../theme/index.dart';
import '../transport/connection_state.dart';
import '../transport/ws_client.dart';

/// Full-screen reconnect overlay — wireframe 41.
///
/// Listens to [client.states] and overlays the app with:
/// - 41-A: reconnecting spinner + attempt counter + cancel
/// - 41-B: connection failed after max retries + retry/switch server
/// - 41-C: global offline banner (shown via [showBannerOnly])
///
/// Usage: wrap the entire app content in a Stack with this on top.
class ReconnectOverlay extends StatefulWidget {
  const ReconnectOverlay({
    super.key,
    required this.client,
    required this.child,
    this.relayHost,
    this.maxAttempts = 5,
    this.onSwitchServer,
  });

  final WsClient client;
  final Widget child;
  final String? relayHost;
  final int maxAttempts;
  final VoidCallback? onSwitchServer;

  @override
  State<ReconnectOverlay> createState() => _ReconnectOverlayState();
}

class _ReconnectOverlayState extends State<ReconnectOverlay> {
  WsConnectionState _state = WsConnectionState.online;
  int _attemptCount = 0;
  StreamSubscription<WsConnectionState>? _sub;

  @override
  void initState() {
    super.initState();
    _state = WsConnectionState.online;
    _sub = widget.client.states.listen((s) {
      if (!mounted) return;
      setState(() {
        if (s == WsConnectionState.connecting) {
          _attemptCount++;
        } else if (s == WsConnectionState.online) {
          _attemptCount = 0;
        }
        _state = s;
      });
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  bool get _showOverlay =>
      _state == WsConnectionState.connecting &&
      _attemptCount > 0 ||
      (_state == WsConnectionState.offline && _attemptCount >= widget.maxAttempts) ||
      _state == WsConnectionState.authExpired;

  bool get _isFailed =>
      _state == WsConnectionState.offline && _attemptCount >= widget.maxAttempts;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_showOverlay) _buildOverlay(context),
      ],
    );
  }

  Widget _buildOverlay(BuildContext context) {
    return Positioned.fill(
      child: ColoredBox(
        color: const Color(0x8C000000), // ~55% black
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 3, sigmaY: 3),
          child: Center(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 28),
              constraints: const BoxConstraints(minWidth: 220),
              padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
              decoration: BoxDecoration(
                color: context.colors.bg2,
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0x66000000),
                    blurRadius: 32,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: _isFailed ? _buildFailed(context) : _buildReconnecting(context),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildReconnecting(BuildContext context) {
    final c = context.colors;
    final attempts = _attemptCount.clamp(1, widget.maxAttempts);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const _ReconnectSpinner(),
        const SizedBox(height: 10),
        Text(
          '正在重连…',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: c.fg,
          ),
        ),
        const SizedBox(height: 6),
        if (widget.relayHost != null)
          Text(
            widget.relayHost!,
            style: TextStyle(fontSize: 13, color: c.fg2),
          ),
        Text(
          '第 $attempts 次尝试，共 ${widget.maxAttempts} 次',
          style: TextStyle(fontSize: 13, color: c.fg3),
        ),
        const SizedBox(height: 4),
        // attempt dots
        Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(widget.maxAttempts, (i) {
            Color dotColor;
            if (i < attempts - 1) {
              dotColor = AppColors.green;
            } else if (i == attempts - 1) {
              dotColor = AppColors.orange;
            } else {
              dotColor = c.bg4;
            }
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: dotColor,
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 6),
        CupertinoButton(
          onPressed: () {
            setState(() => _attemptCount = 0);
          },
          child: Text('取消', style: TextStyle(fontSize: 14, color: c.fg3)),
        ),
      ],
    );
  }

  Widget _buildFailed(BuildContext context) {
    final c = context.colors;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Text('📡', style: TextStyle(fontSize: 36)),
        const SizedBox(height: 10),
        Text(
          '连接已断开',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: c.fg,
          ),
        ),
        const SizedBox(height: 8),
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: '已重试 ${widget.maxAttempts} 次，均失败\n',
                style: TextStyle(fontSize: 13, color: c.fg2, height: 1.6),
              ),
              TextSpan(
                text: 'ECONNREFUSED',
                style: TextStyle(
                  fontSize: 12,
                  color: c.fg3,
                  fontFamily: 'SF Mono',
                ),
              ),
            ],
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: CupertinoButton.filled(
            onPressed: () {
              setState(() => _attemptCount = 0);
              widget.client.reconnectIfNeeded();
            },
            child: const Text('立即重试'),
          ),
        ),
        CupertinoButton(
          onPressed: widget.onSwitchServer,
          child: Text(
            '切换服务器',
            style: TextStyle(fontSize: 14, color: c.fg2),
          ),
        ),
      ],
    );
  }
}

class _ReconnectSpinner extends StatefulWidget {
  const _ReconnectSpinner();

  @override
  State<_ReconnectSpinner> createState() => _ReconnectSpinnerState();
}

class _ReconnectSpinnerState extends State<_ReconnectSpinner>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, __) => Transform.rotate(
        angle: _ctrl.value * 6.283185,
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: const Border(
              top: BorderSide(color: AppColors.orange, width: 3),
              left: BorderSide(color: Color(0x00000000), width: 3),
              bottom: BorderSide(color: Color(0x00000000), width: 3),
              right: BorderSide(color: Color(0x00000000), width: 3),
            ),
          ),
        ),
      ),
    );
  }
}
