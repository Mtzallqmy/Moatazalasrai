import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:moataz_ai_mobile/src/core/api_config.dart';
import 'package:moataz_ai_mobile/src/core/token_store.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final tokenStoreProvider = Provider<TokenStore>(
  (ref) => TokenStore(const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  )),
);

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(ref.watch(tokenStoreProvider)),
);

class ApiClient {
  ApiClient(this._tokens) {
    _dio = Dio(BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 60),
      headers: const {'accept': 'application/json'},
    ));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final session = Supabase.instance.client.auth.currentSession;
        if (session != null) options.headers['authorization'] = 'Bearer ${session.accessToken}';
        final organizationId = await _tokens.activeOrganization();
        if (organizationId != null) options.headers['x-organization-id'] = organizationId;
        options.headers['x-request-id'] ??= _requestId();
        handler.next(options);
      },
      onError: (error, handler) async {
        if (error.response?.statusCode != 401 || error.requestOptions.extra['retried'] == true) {
          handler.next(error);
          return;
        }
        if (Supabase.instance.client.auth.currentSession == null) {
          handler.next(error);
          return;
        }
        late final Session refreshed;
        try {
          refreshed = await _refreshSession();
        } catch (_) {
          await Supabase.instance.client.auth.signOut(scope: SignOutScope.local);
          await _tokens.setActiveOrganization(null);
          handler.next(error);
          return;
        }
        final request = error.requestOptions;
        request.extra['retried'] = true;
        request.headers['authorization'] = 'Bearer ${refreshed.accessToken}';
        try {
          handler.resolve(await _dio.fetch<dynamic>(request));
        } on DioException catch (retryError) {
          handler.next(retryError);
        }
      },
    ));
  }

  final TokenStore _tokens;
  late final Dio _dio;
  Future<Session>? _refreshing;

  Dio get dio => _dio;

  Future<Session> _refreshSession() async {
    final active = _refreshing;
    if (active != null) return active;
    final operation = _performRefresh();
    _refreshing = operation;
    try {
      return await operation;
    } finally {
      _refreshing = null;
    }
  }

  Future<Session> _performRefresh() async {
    final response = await Supabase.instance.client.auth.refreshSession();
    final refreshed = response.session;
    if (refreshed == null) throw StateError('Missing refreshed Supabase session');
    return refreshed;
  }

  static String _requestId() => 'mobile-${DateTime.now().microsecondsSinceEpoch}';

  static Map<String, dynamic> payload(Response<Map<String, dynamic>> response) {
    final body = response.data;
    if (body == null || body['success'] != true) {
      final error = body?['error'] as Map<String, dynamic>?;
      throw ApiException(
        code: error?['code'] as String? ?? 'UNKNOWN_API_ERROR',
        message: error?['message'] as String? ?? 'تعذر إكمال الطلب.',
      );
    }
    return body['data'] as Map<String, dynamic>? ?? const {};
  }

  static String userMessage(Object error) {
    if (error is ApiException) return error.message;
    if (error is DioException) {
      final body = error.response?.data;
      if (body is Map) {
        final apiError = body['error'];
        if (apiError is Map) {
          final message = apiError['message'];
          if (message is String && message.trim().isNotEmpty) return message;
        }
      }
      return switch (error.response?.statusCode) {
        401 => 'انتهت الجلسة. سجّل الدخول مجددًا.',
        402 => 'رصيد مزود الذكاء الاصطناعي غير كافٍ. أضف رصيدًا أو اختر مزودًا آخر.',
        403 => 'لا تملك الصلاحية المطلوبة لتنفيذ هذه العملية.',
        413 => 'حجم الملف أكبر من الحد المسموح.',
        415 => 'نوع الملف غير مدعوم أو لا يطابق امتداده.',
        422 => 'تعذر تشغيل الوكيل بهذا النموذج أو بهذه المدخلات.',
        429 => 'تم بلوغ الحد المؤقت للطلبات. حاول بعد قليل.',
        502 || 503 || 504 => 'مزود الذكاء الاصطناعي غير متاح مؤقتًا. حاول مجددًا أو اختر نموذجًا آخر.',
        _ when error.type == DioExceptionType.connectionTimeout
            || error.type == DioExceptionType.receiveTimeout
            || error.type == DioExceptionType.connectionError =>
          'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.',
        _ => 'تعذر إكمال الطلب. حاول مجددًا.',
      };
    }
    return 'حدث خطأ غير متوقع. حاول مجددًا.';
  }
}

class ApiException implements Exception {
  const ApiException({required this.code, required this.message});
  final String code;
  final String message;
  @override
  String toString() => message;
}
