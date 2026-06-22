import 'package:flutter_riverpod/flutter_riverpod.dart';

class DraftState {
  const DraftState({this.text = '', this.scrollOffset = 0.0});
  final String text;
  final double scrollOffset;
  DraftState copyWith({String? text, double? scrollOffset}) =>
      DraftState(text: text ?? this.text, scrollOffset: scrollOffset ?? this.scrollOffset);
}

final draftsProvider =
    NotifierProvider<DraftsNotifier, Map<String, DraftState>>(DraftsNotifier.new);

class DraftsNotifier extends Notifier<Map<String, DraftState>> {
  @override
  Map<String, DraftState> build() => {};

  void setDraft(String sessionId, String text) => state = {
        ...state,
        sessionId: (state[sessionId] ?? const DraftState()).copyWith(text: text),
      };

  void setScrollOffset(String sessionId, double offset) => state = {
        ...state,
        sessionId: (state[sessionId] ?? const DraftState()).copyWith(scrollOffset: offset),
      };

  void clear(String sessionId) => state = Map.from(state)..remove(sessionId);
}
