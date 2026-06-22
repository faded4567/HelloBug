import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/session_summary.dart';
import '../transport/ws_provider.dart';

final sessionsProvider =
    NotifierProvider<SessionsNotifier, List<SessionSummary>>(SessionsNotifier.new);

class SessionsNotifier extends Notifier<List<SessionSummary>> {
  @override
  List<SessionSummary> build() {
    final client = ref.watch(wsClientProvider);
    if (client != null) {
      final sub = client.messages.listen((msg) {
        if (msg.type != 'session.event') return;
        final sid = msg.payload['session_id'] as String? ?? '';
        final evType = msg.payload['event_type'] as String? ?? '';
        final idx = state.indexWhere((s) => s.sessionId == sid);
        if (idx < 0) return;
        final s = state[idx];
        final updated = s.copyWith(
          status: evType == 'session.done' ? SessionStatus.done : SessionStatus.running,
          lastPreview: evType == 'assistant.delta' ? (msg.payload['text'] as String? ?? s.lastPreview) : null,
          unread: s.unread + 1,
        );
        state = [...state.sublist(0, idx), updated, ...state.sublist(idx + 1)];
      });
      ref.onDispose(sub.cancel);
    }
    return [];
  }

  void add(SessionSummary session) => state = [session, ...state];

  void markRead(String sessionId) => state =
      state.map((s) => s.sessionId == sessionId ? s.copyWith(unread: 0) : s).toList();
}
