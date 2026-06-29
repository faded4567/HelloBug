import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';

import 'server_pin_store.dart';

Object? buildPinnedHttpClient(Uri uri) {
  if (!ServerPinStore.supportsPinning(uri)) {
    return HttpClient();
  }

  final client = HttpClient(context: SecurityContext(withTrustedRoots: false));
  client.badCertificateCallback = (cert, host, port) {
    final observedUri = Uri(
      scheme: uri.scheme == 'wss' ? 'https' : uri.scheme,
      host: host,
      port: port,
    );
    final observedPin = _fingerprint(cert.der);
    ServerPinStore.observe(observedUri, observedPin);

    final expectedPin = ServerPinStore.configuredPin(uri);
    if (expectedPin == null) {
      return true;
    }

    final matches = expectedPin == observedPin;
    if (!matches) {
      ServerPinStore.noteFailure(observedUri, '服务器证书指纹不匹配，请确认服务器地址或重新配对');
    }
    return matches;
  };
  return client;
}

String _fingerprint(List<int> derBytes) {
  final hash = Sha256().toSync().hashSync(derBytes).bytes;
  return base64Url.encode(hash).replaceAll('=', '');
}
