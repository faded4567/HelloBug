import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/inner_message.dart';
import '../models/session_summary.dart';
import '../transport/ws_client.dart';
import '../transport/ws_provider.dart';
import 'workspace_history_provider.dart';

final sessionsProvider =
    NotifierProvider<SessionsNotifier, List<SessionSummary>>(
      SessionsNotifier.new,
    );

class SessionsNotifier extends Notifier<List<SessionSummary>> {
  StreamSubscription<InnerMessage>? _subscription;
  WsClient? _client;
  List<SessionSummary> _sessions = const [];

  @override
  List<SessionSummary> build() {
    _subscription?.cancel();
    _client = ref.watch(wsClientProvider);
    if (_client != null) {
      for (final session in _sessions) {
        if (session.status == SessionStatus.running ||
            session.status == SessionStatus.replaying) {
          _client!.trackSession(session.sessionId);
        }
      }
      _subscription = _client!.messages.listen(_handle);
    }
    ref.onDispose(() => _subscription?.cancel());
    return _sessions;
  }

  void add(SessionSummary session) {
    _client?.trackSession(session.sessionId);
    if (session.workspacePath.isNotEmpty) {
      unawaited(
        ref
            .read(workspaceHistoryProvider.notifier)
            .visit(session.workspacePath),
      );
    }
    _sessions = [session, ..._sessions];
    state = _sessions;
  }

  void markRead(String sessionId) => _setSessions(
    _sessions
        .map((s) => s.sessionId == sessionId ? s.copyWith(unread: 0) : s)
        .toList(),
  );

  void markOffline(String sessionId) =>
      _updateStatus(sessionId, SessionStatus.offline, untrack: true);

  void markReplaying(String sessionId) =>
      _updateStatus(sessionId, SessionStatus.replaying);

  void markRunning(String sessionId) =>
      _updateStatus(sessionId, SessionStatus.running, track: true);

  void _handle(InnerMessage msg) {
    if (msg.type == 'replay.done') {
      final sid = msg.payload['session_id'] as String? ?? '';
      final status = msg.payload['status'] as String? ?? 'ok';
      if (sid.isNotEmpty) {
        if (status == 'session_not_found') {
          markOffline(sid);
        } else {
          final session = _sessions.where((entry) => entry.sessionId == sid);
          if (session.isNotEmpty &&
              session.first.status == SessionStatus.replaying) {
            markRunning(sid);
          }
        }
      }
      return;
    }

    if (msg.type == 'auth.token') {
      for (final session in _sessions) {
        if (session.status == SessionStatus.running) {
          markReplaying(session.sessionId);
        }
      }
      return;
    }

    if (msg.type != 'session.event') return;
    final sid = msg.payload['session_id'] as String? ?? '';
    final event = msg.payload['event'];
    if (sid.isEmpty || event is! Map) return;
    final eventMap = Map<String, dynamic>.from(event);
    final evType = eventMap['event_type'] as String? ?? '';
    final idx = _sessions.indexWhere((s) => s.sessionId == sid);
    if (idx < 0) return;

    final current = _sessions[idx];
    final nextStatus =
        evType == 'session.done' ? SessionStatus.done : SessionStatus.running;
    final updated = current.copyWith(
      status: nextStatus,
      lastPreview: _previewForEvent(current.lastPreview, evType, eventMap),
      unread: current.unread + 1,
    );
    _setSessions([
      ..._sessions.sublist(0, idx),
      updated,
      ..._sessions.sublist(idx + 1),
    ]);
    if (nextStatus == SessionStatus.done) {
      _client?.untrackSession(sid);
    } else {
      _client?.trackSession(sid);
    }
  }

  void _updateStatus(
    String sessionId,
    SessionStatus status, {
    bool track = false,
    bool untrack = false,
  }) {
    if (sessionId.isEmpty) {
      return;
    }
    if (track) {
      _client?.trackSession(sessionId);
    }
    if (untrack) {
      _client?.untrackSession(sessionId);
    }
    _setSessions(
      _sessions
          .map((s) => s.sessionId == sessionId ? s.copyWith(status: status) : s)
          .toList(),
    );
  }

  void _setSessions(List<SessionSummary> next) {
    _sessions = next;
    state = next;
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
