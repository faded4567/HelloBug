import 'package:flutter/cupertino.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';

Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Future init (secure_storage, local_auth, cert pinning) goes here.
  runApp(const ProviderScope(child: HelloBugApp()));
}
