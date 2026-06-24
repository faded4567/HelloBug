import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'ws_client.dart';

// Null until pairing succeeds. PairingController sets this via notifier.state.
final wsClientProvider = StateProvider<WsClient?>((ref) => null);

// Set by platform push-notification init; null until firebase_messaging is wired.
final pushTokenProvider = StateProvider<String?>((ref) => null);
