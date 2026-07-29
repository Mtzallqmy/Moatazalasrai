import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';
import 'package:moataz_ai_mobile/src/core/token_store.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(tokenStoreProvider)),
);

final authStateProvider = AsyncNotifierProvider<AuthController, bool>(AuthController.new);

class AuthRepository {
  AuthRepository(this._api, this._tokens);
  final ApiClient _api;
  final TokenStore _tokens;

  Future<List<Map<String, dynamic>>?> login({
    required String email,
    required String password,
    required bool rememberSession,
    String? organizationId,
  }) async {
    final deviceId = await _tokens.deviceId();
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/api/mobile/v1/auth/login',
      data: {
        'email': email.trim().toLowerCase(),
        'password': password,
        'organizationId': organizationId,
        'deviceId': deviceId,
        'rememberSession': rememberSession,
        'deviceName': '${Platform.operatingSystem} ${Platform.operatingSystemVersion}',
      }..removeWhere((_, value) => value == null),
      options: Options(
        extra: {'retried': true},
        validateStatus: (status) => status != null && (status < 400 || status == 409),
      ),
    );
    final data = response.data?['data'] as Map<String, dynamic>? ?? const {};
    if (response.statusCode == 409 || data['organizationSelectionRequired'] == true) {
      return (data['organizations'] as List<dynamic>? ?? const [])
          .cast<Map<String, dynamic>>();
    }
    final tokenData = data['tokens'] as Map<String, dynamic>?;
    if (tokenData == null) throw const ApiException(code: 'TOKEN_MISSING', message: 'لم تصل رموز الجلسة.');
    await _tokens.write(TokenPair(
      accessToken: tokenData['accessToken'] as String,
      refreshToken: tokenData['refreshToken'] as String,
    ), remember: rememberSession);
    return null;
  }

  Future<void> register({
    required String name,
    required String email,
    required String password,
    required bool rememberSession,
  }) async {
    final deviceId = await _tokens.deviceId();
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/api/mobile/v1/auth/register',
      data: {
        'name': name.trim(),
        'email': email.trim().toLowerCase(),
        'password': password,
        'rememberSession': rememberSession,
        'deviceId': deviceId,
        'deviceName': '${Platform.operatingSystem} ${Platform.operatingSystemVersion}',
      },
      options: Options(extra: {'retried': true}),
    );
    final data = ApiClient.payload(response);
    final tokenData = data['tokens'] as Map<String, dynamic>?;
    if (tokenData == null) throw const ApiException(code: 'TOKEN_MISSING', message: 'لم تصل رموز الجلسة.');
    await _tokens.write(TokenPair(
      accessToken: tokenData['accessToken'] as String,
      refreshToken: tokenData['refreshToken'] as String,
    ), remember: rememberSession);
  }

  Future<bool> hasSession() async {
    final pair = await _tokens.read();
    if (pair == null) return false;
    try {
      final response = await _api.dio.get<Map<String, dynamic>>('/api/mobile/v1/me');
      return response.data?['success'] == true;
    } on DioException {
      return false;
    }
  }

  Future<void> logout() async {
    final pair = await _tokens.read();
    if (pair != null) {
      try {
        await _api.dio.post<void>('/api/mobile/v1/auth/logout', data: {'refreshToken': pair.refreshToken});
      } catch (_) {
        // Local revocation still happens if the device is offline.
      }
    }
    await _tokens.clear();
  }

  Future<bool> rememberSession() => _tokens.rememberSession();
}

class AuthController extends AsyncNotifier<bool> {
  AuthRepository get _repository => ref.read(authRepositoryProvider);
  @override
  Future<bool> build() => _repository.hasSession();

  Future<List<Map<String, dynamic>>?> login(
    String email,
    String password, {
    required bool rememberSession,
    String? organizationId,
  }) async {
    state = const AsyncLoading();
    try {
      final organizations = await _repository.login(
        email: email,
        password: password,
        rememberSession: rememberSession,
        organizationId: organizationId,
      );
      state = AsyncData(organizations == null);
      return organizations;
    } catch (error, stack) {
      state = AsyncError(error, stack);
      rethrow;
    }
  }

  Future<void> logout() async {
    await _repository.logout();
    state = const AsyncData(false);
  }

  Future<void> register({
    required String name,
    required String email,
    required String password,
    required bool rememberSession,
  }) async {
    state = const AsyncLoading();
    try {
      await _repository.register(
        name: name,
        email: email,
        password: password,
        rememberSession: rememberSession,
      );
      state = const AsyncData(true);
    } catch (error, stack) {
      state = AsyncError(error, stack);
      rethrow;
    }
  }
}
