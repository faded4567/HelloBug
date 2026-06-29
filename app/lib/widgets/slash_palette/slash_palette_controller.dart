import 'dart:async';

import 'package:flutter/foundation.dart';
import '../../models/inner_message.dart';
import '../../transport/ws_client.dart';

class SlashCommand {
  final String name;
  final String description;
  const SlashCommand({required this.name, required this.description});
}

class SlashPaletteController extends ChangeNotifier {
  SlashPaletteController({required this.sessionId, required this.wsClient});

  final String sessionId;
  final WsClient wsClient;

  List<SlashCommand> _all = [];
  List<SlashCommand> filtered = [];
  bool loading = false;
  bool loaded = false;
  String? errorMessage;
  String _query = '';
  Future<void>? _pendingLoad;
  String? _activeRequestId;
  bool _disposed = false;

  String get query => _query;

  Future<void> load({bool force = false}) {
    if (loading) {
      return _pendingLoad ?? Future.value();
    }
    if (loaded && !force) {
      return Future.value();
    }

    final future = _loadInternal();
    _pendingLoad = future;
    return future;
  }

  void filter(String query) {
    if (_disposed) {
      return;
    }
    _query = query;
    final q = query.toLowerCase().replaceFirst('/', '');
    filtered =
        q.isEmpty
            ? _all
            : _all.where((c) => c.name.toLowerCase().contains(q)).toList();
    _notifySafely();
  }

  Future<void> _loadInternal() async {
    final request = InnerMessage.create('slash.list', {
      'session_id': sessionId,
    });
    _activeRequestId = request.id;
    loading = true;
    errorMessage = null;
    _notifySafely();

    try {
      final response = wsClient.messages
          .firstWhere(
            (message) =>
                (message.type == 'slash.list' &&
                    message.id == request.id &&
                    message.payload['session_id'] == sessionId) ||
                (message.type == 'error' &&
                    message.payload['request_id'] == request.id),
          )
          .timeout(const Duration(seconds: 5));
      await wsClient.send(request);
      final msg = await response;
      if (msg.type == 'error') {
        throw StateError(msg.payload['message'] as String? ?? '命令列表读取失败');
      }

      final rawItems = msg.payload['commands'] as List? ?? const [];
      if (_activeRequestId != request.id) {
        return;
      }
      _all = rawItems
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .map(
            (json) => SlashCommand(
              name: json['name'] as String? ?? '',
              description: json['desc'] as String? ?? '',
            ),
          )
          .where((command) => command.name.isNotEmpty)
          .toList(growable: false);
      loaded = true;
      errorMessage = null;
    } catch (error) {
      loaded = false;
      errorMessage = _friendlyError(error);
    } finally {
      if (_activeRequestId == request.id) {
        _activeRequestId = null;
      }
      loading = false;
      _pendingLoad = null;
      filter(_query);
    }
  }

  String _friendlyError(Object error) {
    if (error is TimeoutException) {
      return '读取命令列表超时';
    }
    if (error is StateError) {
      return error.message.toString();
    }
    return '读取命令列表失败';
  }

  void _notifySafely() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
