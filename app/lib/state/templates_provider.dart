import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../crypto/secure_store.dart';
import '../models/inner_message.dart';
import '../models/template_summary.dart';
import '../transport/ws_client.dart';
import '../transport/ws_provider.dart';

final templatesProvider =
    NotifierProvider<TemplatesNotifier, List<TemplateSummary>>(
      TemplatesNotifier.new,
    );

const _kLocalTemplatesKey = 'templates.local.v1';

class TemplatesNotifier extends Notifier<List<TemplateSummary>> {
  WsClient? _lastClient;
  Future<void>? _localLoadFuture;
  List<TemplateSummary>? _remoteTemplates;
  Map<String, TemplateSummary> _localOverrides = {};
  Set<String> _deletedIds = {};
  bool _loading = false;
  bool _loadedLocal = false;
  bool _loadedRemote = false;

  @override
  List<TemplateSummary> build() {
    unawaited(_ensureLocalLoaded());
    final client = ref.watch(wsClientProvider);
    if (!identical(client, _lastClient)) {
      _lastClient = client;
      _loadedRemote = false;
      _remoteTemplates = null;
      if (client != null) {
        unawaited(load(force: true));
      }
    }
    return _composeTemplates();
  }

  Future<void> load({bool force = false}) async {
    final client = _lastClient ?? ref.read(wsClientProvider);
    if (client == null || _loading || (_loadedRemote && !force)) {
      return;
    }

    _loading = true;
    try {
      await client.send(InnerMessage.create('templates.list', const {}));
      final msg = await client.messages
          .firstWhere((message) => message.type == 'templates.list')
          .timeout(const Duration(seconds: 5));
      final templates = TemplateSummary.listFromPayload(
        msg.payload['templates'],
      );
      _remoteTemplates = templates;
      _loadedRemote = true;
      state = _composeTemplates();
    } catch (error) {
      debugPrint('[Templates] load failed -> $error');
    } finally {
      _loading = false;
    }
  }

  Future<void> refresh() => load(force: true);

  Future<void> upsertLocal(TemplateSummary template) async {
    await _ensureLocalLoaded();
    _deletedIds.remove(template.id);
    _localOverrides = Map<String, TemplateSummary>.from(_localOverrides)
      ..[template.id] = template;
    state = _composeTemplates();
    await _persistLocalState();
  }

  Future<void> removeLocal(String templateId) async {
    await _ensureLocalLoaded();

    final nextOverrides = Map<String, TemplateSummary>.from(_localOverrides)
      ..remove(templateId);
    final nextDeletedIds = Set<String>.from(_deletedIds);
    final existsInBase = _baseTemplates().any((item) => item.id == templateId);
    if (existsInBase) {
      nextDeletedIds.add(templateId);
    } else {
      nextDeletedIds.remove(templateId);
    }

    _localOverrides = nextOverrides;
    _deletedIds = nextDeletedIds;
    state = _composeTemplates();
    await _persistLocalState();
  }

  Future<void> _ensureLocalLoaded() {
    if (_loadedLocal) {
      return Future.value();
    }
    final existing = _localLoadFuture;
    if (existing != null) {
      return existing;
    }
    final future = _loadLocalState();
    _localLoadFuture = future;
    return future;
  }

  Future<void> _loadLocalState() async {
    try {
      final raw = await SecureStore.read(_kLocalTemplatesKey);
      if (raw == null || raw.isEmpty) {
        return;
      }

      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        return;
      }

      final json = decoded.map((key, value) => MapEntry('$key', value));
      final overrides = TemplateSummary.listFromPayload(json['overrides']);
      final deletedIds =
          (json['deleted_ids'] as List?)
              ?.whereType<String>()
              .where((id) => id.isNotEmpty)
              .toSet() ??
          <String>{};

      _localOverrides = {
        for (final template in overrides) template.id: template,
      };
      _deletedIds = deletedIds;
    } catch (error) {
      debugPrint('[Templates] restore local state failed -> $error');
    } finally {
      _loadedLocal = true;
      _localLoadFuture = null;
      state = _composeTemplates();
    }
  }

  Future<void> _persistLocalState() async {
    if (_localOverrides.isEmpty && _deletedIds.isEmpty) {
      try {
        await SecureStore.delete(_kLocalTemplatesKey);
      } catch (error) {
        debugPrint('[Templates] clear local state failed -> $error');
      }
      return;
    }

    final payload = jsonEncode({
      'overrides': _localOverrides.values.map((item) => item.toJson()).toList(),
      'deleted_ids': _deletedIds.toList()..sort(),
    });

    try {
      await SecureStore.write(_kLocalTemplatesKey, payload);
    } catch (error) {
      debugPrint('[Templates] persist local state failed -> $error');
    }
  }

  List<TemplateSummary> _composeTemplates() {
    final merged = <String, TemplateSummary>{};

    for (final template in _baseTemplates()) {
      if (_deletedIds.contains(template.id)) {
        continue;
      }
      merged[template.id] = _localOverrides[template.id] ?? template;
    }

    for (final entry in _localOverrides.entries) {
      if (_deletedIds.contains(entry.key) || merged.containsKey(entry.key)) {
        continue;
      }
      merged[entry.key] = entry.value;
    }

    return merged.values.toList(growable: false);
  }

  List<TemplateSummary> _baseTemplates() {
    if (_loadedRemote) {
      return _remoteTemplates ?? const <TemplateSummary>[];
    }
    return _remoteTemplates ?? kDefaultTemplates;
  }
}
