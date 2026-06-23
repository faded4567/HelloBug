import 'dart:math';

final _rng = Random.secure();

String _uuid() {
  final b = List<int>.generate(16, (_) => _rng.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String h(List<int> v) => v.map((e) => e.toRadixString(16).padLeft(2, '0')).join();
  return '${h(b.sublist(0,4))}-${h(b.sublist(4,6))}-${h(b.sublist(6,8))}-${h(b.sublist(8,10))}-${h(b.sublist(10))}';
}

class InnerMessage {
  final int v;
  final String id;
  final String type;
  final Map<String, dynamic> payload;

  const InnerMessage({
    this.v = 1,
    required this.id,
    required this.type,
    required this.payload,
  });

  factory InnerMessage.create(String type, Map<String, dynamic> payload) =>
      InnerMessage(id: _uuid(), type: type, payload: payload);

  factory InnerMessage.fromJson(Map<String, dynamic> json) => InnerMessage(
        v: (json['v'] as num?)?.toInt() ?? 1,
        id: (json['id'] as String?) ?? _uuid(),
        type: json['type'] as String,
        payload: (json['payload'] as Map<String, dynamic>?) ?? {},
      );

  Map<String, dynamic> toJson() => {'v': v, 'id': id, 'type': type, 'payload': payload};
}
