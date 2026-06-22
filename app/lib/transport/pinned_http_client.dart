import 'dart:io';

// Returns an HttpClient with optional certificate pinning.
// In M1 pinning is not yet active; Spike F4 will fill in the pin bytes.
class PinnedHttpClient {
  // SHA-256 DER fingerprint of server's leaf certificate; set after Spike F4.
  static List<int>? _pinBytes;

  static void setPin(List<int> derFingerprint) => _pinBytes = derFingerprint;

  static HttpClient build() {
    final client = HttpClient();
    if (_pinBytes != null) {
      client.badCertificateCallback = (cert, host, port) => false;
      // Full pin verification wired in after Spike F4.
    }
    return client;
  }
}
