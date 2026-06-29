class TemplateSummary {
  final String id;
  final String label;
  final String content;

  const TemplateSummary({
    required this.id,
    required this.label,
    required this.content,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'label': label,
    'content': content,
  };

  factory TemplateSummary.fromJson(Map<String, dynamic> json) =>
      TemplateSummary(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        content: json['text'] as String? ?? json['content'] as String? ?? '',
      );

  factory TemplateSummary.fromWireJson(Map<String, dynamic> json) =>
      TemplateSummary(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        content: json['text'] as String? ?? '',
      );

  static List<TemplateSummary> listFromPayload(Object? raw) {
    final items = raw is List ? raw : const [];
    final templates = <TemplateSummary>[];
    for (final item in items) {
      if (item is! Map) {
        continue;
      }
      final template = TemplateSummary.fromJson(
        item.map((key, value) => MapEntry('$key', value)),
      );
      if (template.id.isEmpty || template.label.isEmpty) {
        continue;
      }
      templates.add(template);
    }
    return templates;
  }

  static List<TemplateSummary> listFromWirePayload(Object? raw) {
    final items = raw is List ? raw : const [];
    final templates = <TemplateSummary>[];
    for (final item in items) {
      if (item is! Map) {
        continue;
      }
      final template = TemplateSummary.fromWireJson(
        item.map((key, value) => MapEntry('$key', value)),
      );
      if (template.id.isEmpty || template.label.isEmpty) {
        continue;
      }
      templates.add(template);
    }
    return templates;
  }
}
