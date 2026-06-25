import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

const pairingSasEmoji = <String>[
  '🐢',
  '🪐',
  '🍵',
  '🎷',
  '🌙',
  '🧭',
  '🛠️',
  '📦',
  '🧪',
  '🌲',
  '🔥',
  '🌊',
];

Future<List<String>> derivePairingSas(Uint8List pairingSeed) async {
  final mac = await Hmac.sha256().calculateMac(
    utf8.encode('hellobug-sas'),
    secretKey: SecretKey(pairingSeed),
  );
  return List<String>.generate(
    5,
    (index) => pairingSasEmoji[mac.bytes[index] % pairingSasEmoji.length],
    growable: false,
  );
}
