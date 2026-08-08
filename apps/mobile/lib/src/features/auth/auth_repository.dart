import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';
import 'package:moataz_ai_mobile/src/core/token_store.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(tokenStoreProvider)),
);
final authStateProvider = AsyncNotifierProvider<AuthController, bool>(AuthController.new);

class AuthRepository {
  AuthRepository(this._api, this._state);
  final ApiClient _api;
  final TokenStore _state;
  SupabaseClient get _supabase => Supabase.instance.client;

  Future<List<Map<String, dynamic>>?> _activate(String? organizationId) async {
    await _state.setActiveOrganization(organizationId);
    final response = await _api.dio.get<Map<String, dynamic>>(
      '/api/mobile/v1/auth/session',
      options: Options(validateStatus: (status) => status != null && (status < 400 || status == 409), extra: {'retried': true}),
    );
    final data = response.data?['data'] as Map<String, dynamic>? ?? const {};
    if (response.statusCode == 409 || data['organizationSelectionRequired'] == true) {
      return (data['organizations'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
    }
    ApiClient.payload(response);
    return null;
  }

  Future<List<Map<String, dynamic>>?> login({required String email, required String password, required bool rememberSession, String? organizationId}) async {
    final response = await _supabase.auth.signInWithPassword(email: email.trim().toLowerCase(), password: password);
    if (response.session == null) throw const ApiException(code: 'AUTH_SESSION_MISSING', message: 'لم تبدأ جلسة Supabase صالحة.');
    await _state.setRememberSession(rememberSession);
    return _activate(organizationId);
  }

  Future<void> register({required String name, required String email, required String password, required bool rememberSession}) async {
    final response = await _supabase.auth.signUp(email: email.trim().toLowerCase(), password: password, data: {'full_name': name.trim()});
    if (response.session == null) throw const ApiException(code: 'EMAIL_CONFIRMATION_REQUIRED', message: 'أُرسل رابط تأكيد إلى بريدك. افتحه ثم سجّل الدخول.');
    await _state.setRememberSession(rememberSession);
    final organizations = await _activate(null);
    if (organizations != null) throw const ApiException(code: 'ORGANIZATION_SELECTION_REQUIRED', message: 'اختر مساحة العمل بعد تسجيل الدخول.');
  }

  Future<void> loginWithGoogle() async {
    final started = await _supabase.auth.signInWithOAuth(OAuthProvider.google, redirectTo: 'com.moataz.ai://login-callback');
    if (!started) throw const ApiException(code: 'GOOGLE_OAUTH_FAILED', message: 'تعذر بدء تسجيل الدخول باستخدام Google.');
  }

  Future<bool> hasSession() async {
    if (!await _state.rememberSession()) {
      await _supabase.auth.signOut(scope: SignOutScope.local);
      return false;
    }
    if (_supabase.auth.currentSession == null) return false;
    try {
      final organizations = await _activate(await _state.activeOrganization());
      return organizations == null;
    } on DioException {
      return false;
    }
  }

  Future<void> logout() async {
    try { await _supabase.auth.signOut(scope: SignOutScope.local); } finally { await _state.clear(); }
  }
  Future<bool> rememberSession() => _state.rememberSession();
}

class AuthController extends AsyncNotifier<bool> {
  AuthRepository get _repository => ref.read(authRepositoryProvider);
  StreamSubscription<AuthState>? _authSubscription;
  @override
  Future<bool> build() async {
    _authSubscription ??= Supabase.instance.client.auth.onAuthStateChange.listen((event) async {
      if (event.event == AuthChangeEvent.signedIn || event.event == AuthChangeEvent.tokenRefreshed) {
        state = const AsyncLoading();
        try { state = AsyncData(await _repository.hasSession()); } catch (error, stack) { state = AsyncError(error, stack); }
      } else if (event.event == AuthChangeEvent.signedOut) {
        state = const AsyncData(false);
      }
    });
    ref.onDispose(() { _authSubscription?.cancel(); _authSubscription = null; });
    return _repository.hasSession();
  }

  Future<List<Map<String, dynamic>>?> login(String email, String password, {required bool rememberSession, String? organizationId}) async {
    state = const AsyncLoading();
    try {
      final organizations = await _repository.login(email: email, password: password, rememberSession: rememberSession, organizationId: organizationId);
      state = AsyncData(organizations == null);
      return organizations;
    } catch (error, stack) { state = AsyncError(error, stack); rethrow; }
  }

  Future<void> loginWithGoogle() async {
    state = const AsyncLoading();
    try { await _repository.loginWithGoogle(); state = const AsyncData(false); } catch (error, stack) { state = AsyncError(error, stack); rethrow; }
  }

  Future<void> logout() async { await _repository.logout(); state = const AsyncData(false); }

  Future<void> register({required String name, required String email, required String password, required bool rememberSession}) async {
    state = const AsyncLoading();
    try { await _repository.register(name: name, email: email, password: password, rememberSession: rememberSession); state = const AsyncData(true); }
    catch (error, stack) { state = AsyncError(error, stack); rethrow; }
  }
}
