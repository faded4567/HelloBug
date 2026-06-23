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
  bool loaded = false;

  Future<void> load() async {
    if (loaded) return;
    await wsClient.send(InnerMessage.create('slash.list', {'session_id': sessionId}));
    final msg = await wsClient.messages.firstWhere((m) => m.type == 'slash.list');
    final items = (msg.payload['commands'] as List?)?.cast<Map<String, dynamic>>() ?? [];
    _all = items.map((j) => SlashCommand(
      name: j['name'] as String,
      description: j['description'] as String? ?? '',
    )).toList();
    loaded = true;
    filter('');
  }

  void filter(String query) {
    final q = query.toLowerCase().replaceFirst('/', '');
    filtered = q.isEmpty
        ? _all
        : _all.where((c) => c.name.toLowerCase().contains(q)).toList();
    notifyListeners();
  }
}
