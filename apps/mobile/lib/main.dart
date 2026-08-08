import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/app.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const url = String.fromEnvironment('SUPABASE_URL');
  const publishableKey = String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');
  if (url.isEmpty || publishableKey.isEmpty) {
    throw StateError('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required at build time.');
  }
  await Supabase.initialize(url: url, publishableKey: publishableKey);
  runApp(const ProviderScope(child: MoatazAiApp()));
}
