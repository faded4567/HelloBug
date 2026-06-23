import 'dart:io';
import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../theme/index.dart';
import '../../transport/ws_provider.dart';
import 'image_compress_service.dart';

class ImageInputSheet extends ConsumerStatefulWidget {
  const ImageInputSheet({super.key, required this.sessionId});
  final String sessionId;

  @override
  ConsumerState<ImageInputSheet> createState() => _ImageInputSheetState();
}

class _ImageInputSheetState extends ConsumerState<ImageInputSheet> {
  File? _picked;
  bool _sending = false;
  String? _error;

  Future<void> _pick(ImageSource source) async {
    final xfile = await ImagePicker().pickImage(source: source, imageQuality: 100);
    if (xfile == null) return;
    setState(() { _picked = File(xfile.path); _error = null; });
  }

  Future<void> _send() async {
    if (_picked == null) return;
    final ws = ref.read(wsClientProvider);
    if (ws == null) return;
    setState(() => _sending = true);
    try {
      final imageId = DateTime.now().millisecondsSinceEpoch.toString();
      await ImageCompressService.send(
        file: _picked!,
        sessionId: widget.sessionId,
        imageId: imageId,
        ws: ws,
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() { _sending = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).viewInsets.bottom + 32),
      decoration: BoxDecoration(
        color: c.bg2,
        borderRadius: const BorderRadius.vertical(top: AppRadius.lg),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Center(child: Container(width: 36, height: 4,
          decoration: BoxDecoration(color: c.bg4, borderRadius: BorderRadius.circular(2)))),
        const SizedBox(height: 16),
        if (_picked == null) ...[
          Row(children: [
            Expanded(child: _PickButton(
              icon: CupertinoIcons.camera,
              label: '相机',
              onTap: () => _pick(ImageSource.camera),
              colors: c,
            )),
            const SizedBox(width: 12),
            Expanded(child: _PickButton(
              icon: CupertinoIcons.photo_on_rectangle,
              label: '相册',
              onTap: () => _pick(ImageSource.gallery),
              colors: c,
            )),
          ]),
        ] else ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.file(_picked!, height: 200, width: double.infinity, fit: BoxFit.cover),
          ),
          const SizedBox(height: 12),
          if (_error != null)
            Text(_error!, style: TextStyle(fontSize: 13, color: AppColors.red)),
          Row(children: [
            Expanded(child: CupertinoButton(
              padding: const EdgeInsets.symmetric(vertical: 14),
              onPressed: _sending ? null : () => setState(() { _picked = null; _error = null; }),
              child: Text('重选', style: TextStyle(fontSize: 15, color: c.tint)),
            )),
            const SizedBox(width: 8),
            Expanded(child: CupertinoButton(
              color: c.tint,
              padding: const EdgeInsets.symmetric(vertical: 14),
              onPressed: _sending ? null : _send,
              child: _sending
                  ? const CupertinoActivityIndicator(color: CupertinoColors.white)
                  : const Text('发送', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            )),
          ]),
        ],
      ]),
    );
  }
}

class _PickButton extends StatelessWidget {
  const _PickButton({required this.icon, required this.label, required this.onTap, required this.colors});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final ThemeColors colors;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 24),
        decoration: BoxDecoration(color: colors.bg3, borderRadius: BorderRadius.circular(12)),
        child: Column(children: [
          Icon(icon, size: 32, color: colors.tint),
          const SizedBox(height: 8),
          Text(label, style: TextStyle(fontSize: 14, color: colors.fg)),
        ]),
      ),
    );
  }
}
