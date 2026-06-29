import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/template_summary.dart';
import '../../theme/index.dart';
import '../../state/templates_provider.dart';
import '../../transport/ws_provider.dart';
import '../../models/inner_message.dart';
import '../../state/chat_provider.dart';
import '../../widgets/template_chip_bar.dart';
import '../../widgets/slash_palette/slash_palette.dart';
import '../../widgets/slash_palette/slash_palette_controller.dart';
import '../image_input/image_input_sheet.dart';
import '../voice_input/voice_input_sheet.dart';

class ChatInputBar extends ConsumerStatefulWidget {
  const ChatInputBar({
    super.key,
    required this.sessionId,
    this.enabled = true,
    this.disabledPlaceholder = '该会话暂时不可发送',
  });
  final String sessionId;
  final bool enabled;
  final String disabledPlaceholder;

  @override
  ConsumerState<ChatInputBar> createState() => _ChatInputBarState();
}

class _ChatInputBarState extends ConsumerState<ChatInputBar> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  bool _hasText = false;
  bool _showSlash = false;
  bool _hasFocus = false;
  SlashPaletteController? _slashCtrl;

  void _bindSlashController() {
    final ws = ref.read(wsClientProvider);
    final current = _slashCtrl;
    if (ws == null) {
      current?.dispose();
      _slashCtrl = null;
      return;
    }
    if (current != null &&
        current.sessionId == widget.sessionId &&
        identical(current.wsClient, ws)) {
      return;
    }

    current?.dispose();
    final next = SlashPaletteController(
      sessionId: widget.sessionId,
      wsClient: ws,
    );
    _slashCtrl = next;
    if (_showSlash) {
      unawaited(next.load());
      next.filter(_ctrl.text);
    }
  }

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() => _hasFocus = _focus.hasFocus));
    unawaited(ref.read(templatesProvider.notifier).load());
    _bindSlashController();
  }

  @override
  void didUpdateWidget(covariant ChatInputBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.sessionId != widget.sessionId) {
      _bindSlashController();
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    _slashCtrl?.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    final show = v.startsWith('/');
    if (show && !_showSlash) {
      _slashCtrl?.load();
    }
    if (show) _slashCtrl?.filter(v);
    setState(() {
      _hasText = v.trim().isNotEmpty;
      _showSlash = show;
    });
  }

  void _selectCommand(SlashCommand cmd) {
    _ctrl.text = '/${cmd.name} ';
    _ctrl.selection = TextSelection.collapsed(offset: _ctrl.text.length);
    setState(() {
      _showSlash = false;
      _hasText = true;
    });
    _focus.requestFocus();
  }

  Future<void> _send() async {
    if (!widget.enabled) {
      return;
    }
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    final slash = text.startsWith('/') ? _parseSlashCommand(text) : null;
    if (text.startsWith('/') && slash == null) {
      return;
    }
    _ctrl.clear();
    setState(() {
      _hasText = false;
      _showSlash = false;
    });
    ref.read(chatProvider.notifier).addUserMessage(widget.sessionId, text);
    final client = ref.read(wsClientProvider);
    if (slash != null) {
      await client?.send(
        InnerMessage.create('session.command.slash', {
          'session_id': widget.sessionId,
          'command': slash.command,
          'args': slash.args,
        }),
      );
    } else {
      await client?.send(
        InnerMessage.create('session.input', {
          'session_id': widget.sessionId,
          'text': text,
        }),
      );
    }
  }

  Future<void> _sendVoiceText(VoiceInputResult result) async {
    if (!widget.enabled) {
      return;
    }
    final text = result.text.trim();
    if (text.isEmpty) {
      return;
    }

    final client = ref.read(wsClientProvider);
    if (client == null) {
      throw StateError('未连接到服务器');
    }

    ref.read(chatProvider.notifier).addUserMessage(widget.sessionId, text);
    await client.send(
      InnerMessage.create('session.input.voice_text', {
        'session_id': widget.sessionId,
        'text': text,
        'confidence': result.confidence,
      }),
    );
  }

  void _insertTemplate(TemplateSummary t) {
    _ctrl.text = t.content;
    _ctrl.selection = TextSelection.collapsed(offset: t.content.length);
    setState(() {
      _hasText = true;
      _showSlash = false;
    });
    _focus.requestFocus();
  }

  void _showMediaSheet() {
    showCupertinoModalPopup<void>(
      context: context,
      builder:
          (ctx) => _MediaDrawer(
            onAlbum: () {
              Navigator.pop(ctx);
              showCupertinoModalPopup<void>(
                context: context,
                builder: (_) => ImageInputSheet(sessionId: widget.sessionId),
              );
            },
          ),
    );
  }

  _ParsedSlashCommand? _parseSlashCommand(String text) {
    final body = text.substring(1).trim();
    if (body.isEmpty) {
      return null;
    }
    final parts = body.split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) {
      return null;
    }
    return _ParsedSlashCommand(
      parts.first,
      parts.skip(1).toList(growable: false),
    );
  }

  @override
  Widget build(BuildContext context) {
    final wsClient = ref.watch(wsClientProvider);
    _bindSlashController();
    final c = context.colors;
    final templates = ref.watch(templatesProvider);
    final canSend = widget.enabled && _hasText && wsClient != null;
    final voiceHoldEnabled = widget.enabled && !_hasFocus && !_hasText;
    final inputPlaceholder =
        widget.enabled
            ? (voiceHoldEnabled ? '按住说话' : '发消息给 Agent…')
            : widget.disabledPlaceholder;

    return Container(
      color: c.bg,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(height: 1, color: c.separator),
          TemplateChipBar(
            templates: widget.enabled ? templates : const [],
            onSelect: _insertTemplate,
          ),
          Container(height: 1, color: c.separator),
          if (widget.enabled && _showSlash && _slashCtrl != null)
            SlashPalette(
              controller: _slashCtrl!,
              onSelect: _selectCommand,
              onQueryTap: _focus.requestFocus,
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: GestureDetector(
                    onLongPress:
                        voiceHoldEnabled
                            ? () =>
                                VoiceInputSheet.show(context, _sendVoiceText)
                            : null,
                    child: CupertinoTextField(
                      controller: _ctrl,
                      focusNode: _focus,
                      enabled: widget.enabled,
                      placeholder: inputPlaceholder,
                      placeholderStyle: TextStyle(color: c.fg3),
                      style: TextStyle(color: c.fg, fontSize: 15),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: c.bg2,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      maxLines: 6,
                      minLines: 1,
                      onChanged: _onChanged,
                      textInputAction: TextInputAction.newline,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                if (_hasFocus) ...[
                  CupertinoButton(
                    padding: const EdgeInsets.all(4),
                    onPressed:
                        widget.enabled
                            ? () =>
                                VoiceInputSheet.show(context, _sendVoiceText)
                            : null,
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: c.bg3,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(CupertinoIcons.mic, size: 18, color: c.fg2),
                    ),
                  ),
                  const SizedBox(width: 4),
                ],
                CupertinoButton(
                  padding: const EdgeInsets.all(4),
                  onPressed: widget.enabled ? _showMediaSheet : null,
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: c.bg3,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(CupertinoIcons.plus, size: 18, color: c.fg2),
                  ),
                ),
                if (_hasText) const SizedBox(width: 4),
                if (_hasText)
                  CupertinoButton(
                    padding: const EdgeInsets.all(4),
                    onPressed: canSend ? _send : null,
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: canSend ? c.tint : c.bg3,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        CupertinoIcons.arrow_up,
                        size: 18,
                        color: canSend ? const Color(0xFFFFFFFF) : c.fg3,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(height: MediaQuery.of(context).padding.bottom > 0 ? 4 : 8),
        ],
      ),
    );
  }
}

class _ParsedSlashCommand {
  const _ParsedSlashCommand(this.command, this.args);

  final String command;
  final List<String> args;
}

class _MediaDrawer extends StatelessWidget {
  const _MediaDrawer({required this.onAlbum});
  final VoidCallback onAlbum;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return SafeArea(
      top: false,
      child: Container(
        color: c.bg,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 36,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: c.fg3,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Row(
              children: [
                _MediaItem(
                  icon: CupertinoIcons.camera,
                  label: '相机',
                  onTap: () => Navigator.pop(context),
                ),
                const SizedBox(width: 8),
                _MediaItem(
                  icon: CupertinoIcons.photo,
                  label: '相册',
                  onTap: onAlbum,
                ),
                const SizedBox(width: 8),
                _MediaItem(
                  icon: CupertinoIcons.doc,
                  label: '文件',
                  onTap: () => Navigator.pop(context),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MediaItem extends StatelessWidget {
  const _MediaItem({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Expanded(
      child: CupertinoButton(
        padding: EdgeInsets.zero,
        onPressed: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(
            color: c.bg2,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Icon(icon, size: 28, color: c.fg),
              const SizedBox(height: 6),
              Text(label, style: TextStyle(fontSize: 13, color: c.fg)),
            ],
          ),
        ),
      ),
    );
  }
}
