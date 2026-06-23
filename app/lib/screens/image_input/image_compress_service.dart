import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import '../../models/inner_message.dart';
import '../../transport/ws_client.dart';

const _maxBytes = 2 * 1024 * 1024; // 2MB
const _chunkSize = 64 * 1024;       // 64KB

class ImageCompressService {
  static Future<void> send({
    required File file,
    required String sessionId,
    required String imageId,
    required WsClient ws,
  }) async {
    final compressed = await FlutterImageCompress.compressWithFile(
      file.absolute.path,
      quality: 85,
      keepExif: false,
    );
    if (compressed == null) throw Exception('compress failed');

    final data = compressed.length > _maxBytes
        ? (await FlutterImageCompress.compressWithFile(
            file.absolute.path, quality: 50, keepExif: false))!
        : compressed;

    final chunks = <List<int>>[];
    for (var i = 0; i < data.length; i += _chunkSize) {
      chunks.add(data.sublist(i, (i + _chunkSize).clamp(0, data.length)));
    }
    final total = chunks.length;
    for (var i = 0; i < total; i++) {
      await ws.send(InnerMessage.create('session.input.image', {
        'session_id': sessionId,
        'image_id': imageId,
        'chunk_index': i,
        'total_chunks': total,
        'data': base64Encode(chunks[i]),
      }));
    }
  }
}
