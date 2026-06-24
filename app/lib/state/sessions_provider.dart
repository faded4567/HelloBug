import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/inner_message.dart';
import '../models/session_summary.dart';
import '../transport/ws_provider.dart';

final sessionsProvider =
    NotifierProvider<SessionsNotifier, List<SessionSummary>>(
      SessionsNotifier.new,
    );

class SessionsNotifier extends Notifier<List<SessionSummary>> {
  StreamSubscription<InnerMessage>? _subscription;

  @override
  List<SessionSummary> build() {
    _subscription?.cancel();
    final client = ref.watch(wsClientProvider);
    if (client != null) {
      _subscription = client.messages.listen(_handle);
    }
    ref.onDispose(() => _subscription?.cancel());
    return [];
  }

  void add(SessionSummary session) => state = [session, ...state];

  void markRead(String sessionId) =>
      state =
          state
              .map((s) => s.sessionId == sessionId ? s.copyWith(unread: 0) : s)
              .toList();

  void _handle(InnerMessage msg) {
    if (msg.type != 'session.event') return;
    final sid = msg.payload['session_id'] as String? ?? '';
    final event = msg.payload['event'];
    if (sid.isEmpty || event is! Map) return;
    final eventMap = Map<String, dynamic>.from(event);
    final evType = eventMap['event_type'] as String? ?? '';
    final idx = state.indexWhere((s) => s.sessionId == sid);
    if (idx < 0) return;

    final current = state[idx];
    final updated = current.copyWith(
      status:
          evType == 'session.done' ? SessionStatus.done : SessionStatus.running,
      lastPreview: _previewForEvent(current.lastPreview, evType, eventMap),
      unread: current.unread + 1,
    );
    state = [...state.sublist(0, idx), updated, ...state.sublist(idx + 1)];
  }

  String? _previewForEvent(
    String current,
    String eventType,
    Map<String, dynamic> event,
  ) {
    if (eventType == 'assistant.delta') {
      final delta = event['text'] as String? ?? '';
      if (delta.isEmpty) {
        return current;
      }
      final next = '$current$delta'.trimLeft();
      if (next.length <= 120) {
        return next;
      }
      return next.substring(next.length - 120);
    }

    if (eventType == 'tool.result') {
      final content = event['content'] as String? ?? '';
      if (content.isNotEmpty) {
        return content.length <= 120 ? content : content.substring(0, 120);
      }
    }

    return current;
  }
}
