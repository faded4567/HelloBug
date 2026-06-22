import 'dart:convert';

// Splits a WebSocket text frame on newlines; each non-empty line is one JSON message.
class FramedCodec {
  Iterable<Map<String, dynamic>> decode(String frame) sync* {
    for (final line in frame.split('\n')) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;
      yield jsonDecode(trimmed) as Map<String, dynamic>;
    }
  }

  String encode(Map<String, dynamic> message) => '${jsonEncode(message)}\n';
}
