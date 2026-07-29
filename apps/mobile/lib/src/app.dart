import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:moataz_ai_mobile/src/features/auth/auth_repository.dart';
import 'package:moataz_ai_mobile/src/features/auth/login_screen.dart';
import 'package:moataz_ai_mobile/src/features/dashboard/dashboard_screen.dart';

class MoatazAiApp extends ConsumerWidget {
  const MoatazAiApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);
    final router = GoRouter(
      initialLocation: '/dashboard',
      redirect: (_, state) {
        final signedIn = auth.valueOrNull == true;
        final loggingIn = state.matchedLocation == '/login';
        if (!signedIn && !loggingIn) return '/login';
        if (signedIn && loggingIn) return '/dashboard';
        return null;
      },
      routes: [
        GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
        GoRoute(path: '/dashboard', builder: (_, __) => const DashboardScreen()),
      ],
    );
    return MaterialApp.router(
      debugShowCheckedModeBanner: false,
      title: 'معتز AI',
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF245BFF),
          brightness: Brightness.light,
          surface: const Color(0xFFF4F7FB),
        ),
        scaffoldBackgroundColor: const Color(0xFFF4F7FB),
        cardTheme: const CardThemeData(
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(18)),
            side: BorderSide(color: Color(0xFFDDE4ED)),
          ),
        ),
        inputDecorationTheme: const InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(14))),
        ),
      ),
      routerConfig: router,
    );
  }
}
