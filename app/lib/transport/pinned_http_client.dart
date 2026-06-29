import 'pinned_http_client_stub.dart'
    if (dart.library.io) 'pinned_http_client_io.dart'
    as impl;
import 'server_pin_store.dart';

class PinnedHttpClient {
  static void configure(Uri uri, {String? pin}) {
    ServerPinStore.configure(uri, pin: pin);
  }

  static String? configuredPin(Uri uri) => ServerPinStore.configuredPin(uri);

  static String? observedPin(Uri uri) => ServerPinStore.observedPin(uri);

  static String? resolvedPin(Uri uri) => ServerPinStore.resolvedPin(uri);

  static String? takeLastFailure(Uri uri) => ServerPinStore.takeFailure(uri);

  static Object? build(Uri uri) => impl.buildPinnedHttpClient(uri);
}
