import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/template_summary.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import '../../models/inner_message.dart';
import '../../state/chat_provider.dart';
import '../../widgets/template_chip_bar.dart';
import '../../widgets/slash_palette/slash_palette.dart';
import '../../widgets/slash_palette/slash_palette_controller.dart';
import '../image_input/image_input_sheet.dart';
import '../voice_input/voice_input_sheet.dart';

class ChatInputBar extends ConsumerStatefulWidget {
  const ChatInputBar({super.key, required this.sessionId});
  final String sessionId;

  @override
  ConsumerState<ChatInputBar> createState() => _ChatInputBarState();
}

class _ChatInputBarState extends ConsumerState<ChatInputBar> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();
  bool _hasText = false;
  bool _showSlash = false;
  SlashPaletteController? _slashCtrl;

  @override
  void initState() {
    super.initState();
    final ws = ref.read(wsClientProvider);
    if (ws != null) {
      _slashCtrl = SlashPaletteController(sessionId: widget.sessionId, wsClient: ws);
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
    setState(() { _showSlash = false; _hasText = true; });
    _focus.requestFocus();
  }

  Future<void> _send() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    _ctrl.clear();
    setState(() { _hasText = false; _showSlash = false; });
    ref.read(chatProvider.notifier).addUserMessage(widget.sessionId, text);
    final client = ref.read(wsClientProvider);
    if (text.startsWith('/')) {
      final parts = text.substring(1).split(' ');
      await client?.send(InnerMessage.create('session.command.slash', {
        'session_id': widget.sessionId,
        'command': parts.first,
        'args': parts.skip(1).join(' '),
      }));
    } else {
      await client?.send(InnerMessage.create('session.input', {
        'session_id': widget.sessionId,
        'text': text,
      }));
    }
  }

  void _insertTemplate(TemplateSummary t) {
    _ctrl.text = t.content;
    _ctrl.selection = TextSelection.collapsed(offset: t.content.length);
    setState(() { _hasText = true; _showSlash = false; });
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final canSend = _hasText && ref.watch(wsClientProvider) != null;

    return Container(
      color: c.bg,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(height: 1, color: c.separator),
        TemplateChipBar(templates: kDefaultTemplates, onSelect: _insertTemplate),
        Container(height: 1, color: c.separator),
        if (_showSlash && _slashCtrl != null)
          SlashPalette(controller: _slashCtrl!, onSelect: _selectCommand),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 8, 8),
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            CupertinoButton(
              padding: const EdgeInsets.all(6),
              onPressed: () => showCupertinoModalPopup<void>(
                context: context,
                builder: (_) => ImageInputSheet(sessionId: widget.sessionId),
              ),
              child: Icon(CupertinoIcons.photo, size: 22, color: c.fg2),
            ),
            CupertinoButton(
              padding: const EdgeInsets.all(6),
              onPressed: () => VoiceInputSheet.show(context, (text) {
                  _ctrl.text = text;
                  _ctrl.selection = TextSelection.collapsed(offset: text.length);
                  setState(() { _hasText = true; });
                  _focus.requestFocus();
                }),
              child: Icon(CupertinoIcons.mic, size: 22, color: c.fg2),
            ),
            Expanded(
              child: CupertinoTextField(
                controller: _ctrl,
                focusNode: _focus,
                placeholder: '发消息给 Agent…',
                placeholderStyle: TextStyle(color: c.fg3),
                style: TextStyle(color: c.fg, fontSize: 15),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
            const SizedBox(width: 6),
            CupertinoButton(
              padding: const EdgeInsets.all(4),
              onPressed: canSend ? _send : null,
              child: Container(
                width: 36, height: 36,
                decoration: BoxDecoration(
                  color: canSend ? c.tint : c.bg3,
                  shape: BoxShape.circle,
                ),
                child: Icon(CupertinoIcons.arrow_up, size: 18,
                  color: canSend ? const Color(0xFFFFFFFF) : c.fg3),
              ),
            ),
          ]),
        ),
        SizedBox(height: MediaQuery.of(context).padding.bottom > 0 ? 4 : 8),
      ]),
    );
  }
}
