import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/danger_request.dart';
import '../transport/ws_provider.dart';

final dangerPendingProvider = StreamProvider.autoDispose<DangerRequest>((ref) {
  final client = ref.watch(wsClientProvider);
  if (client == null) return const Stream.empty();
  return client.messages
      .where((m) => m.type == 'danger.pending')
      .map((m) => DangerRequest.fromPayload(m.payload));
});
