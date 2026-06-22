import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'ws_client.dart';

// Null until the device is paired. PairingController (M1.6) sets this via
// ProviderContainer.updateOverrides after a successful pairing flow.
final wsClientProvider = Provider<WsClient?>((ref) => null);
