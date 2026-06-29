import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'ws_client.dart';

// Null until pairing succeeds. PairingController sets this via notifier.state.
final wsClientProvider = StateProvider<WsClient?>((ref) => null);

// Set by platform push token bridge; null until the native bridge reports a token.
final pushTokenProvider = StateProvider<String?>((ref) => null);
