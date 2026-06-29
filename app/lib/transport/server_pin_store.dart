class ServerPinStore {
  static final Map<String, String> _configuredPins = {};
  static final Map<String, String> _observedPins = {};
  static final Map<String, String> _lastFailures = {};

  static bool supportsPinning(Uri uri) =>
      uri.scheme == 'wss' || uri.scheme == 'https';

  static void configure(Uri uri, {String? pin}) {
    final key = _keyFor(uri);
    final normalized = normalize(pin);
    if (normalized == null) {
      _configuredPins.remove(key);
    } else {
      _configuredPins[key] = normalized;
    }
    _lastFailures.remove(key);
  }

  static String? configuredPin(Uri uri) => _configuredPins[_keyFor(uri)];

  static void observe(Uri uri, String pin) {
    final normalized = normalize(pin);
    if (normalized == null) {
      return;
    }
    final key = _keyFor(uri);
    _observedPins[key] = normalized;
    _lastFailures.remove(key);
  }

  static String? observedPin(Uri uri) => _observedPins[_keyFor(uri)];

  static String? resolvedPin(Uri uri) => observedPin(uri) ?? configuredPin(uri);

  static void noteFailure(Uri uri, String message) {
    _lastFailures[_keyFor(uri)] = message;
  }

  static String? takeFailure(Uri uri) {
    final key = _keyFor(uri);
    final value = _lastFailures[key];
    _lastFailures.remove(key);
    return value;
  }

  static void clear(Uri uri) {
    final key = _keyFor(uri);
    _configuredPins.remove(key);
    _observedPins.remove(key);
    _lastFailures.remove(key);
  }

  static void clearAll() {
    _configuredPins.clear();
    _observedPins.clear();
    _lastFailures.clear();
  }

  static String? normalize(String? pin) {
    if (pin == null) {
      return null;
    }
    final normalized = pin.trim().replaceAll('=', '');
    return normalized.isEmpty ? null : normalized;
  }

  static String _keyFor(Uri uri) {
    final host = uri.host.toLowerCase();
    final port =
        uri.hasPort
            ? uri.port
            : (uri.scheme == 'wss' || uri.scheme == 'https')
            ? 443
            : 80;
    return '$host:$port';
  }
}
