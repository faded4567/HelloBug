import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/danger_result.dart';
import '../transport/ws_provider.dart';

final dangerResultProvider = StreamProvider.autoDispose<DangerResult>((ref) {
  final client = ref.watch(wsClientProvider);
  if (client == null) return const Stream.empty();
  return client.messages
      .where((m) => m.type == 'danger.result')
      .map((m) => DangerResult.fromPayload(m.payload));
});
