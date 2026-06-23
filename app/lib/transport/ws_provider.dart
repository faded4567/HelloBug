import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'ws_client.dart';

// Null until pairing succeeds. PairingController sets this via notifier.state.
final wsClientProvider = StateProvider<WsClient?>((ref) => null);
