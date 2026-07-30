import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:moataz_ai_mobile/src/core/api_config.dart';
import 'package:moataz_ai_mobile/src/core/token_store.dart';

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
    _refreshDio = Dio(BaseOptions(
      baseUrl: ApiConfig.baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
    ));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final pair = await _tokens.read();
        if (pair != null) options.headers['authorization'] = 'Bearer ${pair.accessToken}';
        options.headers['x-request-id'] ??= _requestId();
        handler.next(options);
      },
      onError: (error, handler) async {
        if (error.response?.statusCode != 401 || error.requestOptions.extra['retried'] == true) {
          handler.next(error);
          return;
        }
        final pair = await _tokens.read();
        if (pair == null) {
          handler.next(error);
          return;
        }
        late final TokenPair refreshed;
        try {
          refreshed = await _refreshSession(pair);
        } catch (_) {
          await _tokens.clear();
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
  late final Dio _refreshDio;
  Future<TokenPair>? _refreshing;

  Dio get dio => _dio;

  Future<TokenPair> _refreshSession(TokenPair current) async {
    final active = _refreshing;
    if (active != null) return active;
    final operation = _performRefresh(current);
    _refreshing = operation;
    try {
      return await operation;
    } finally {
      _refreshing = null;
    }
  }

  Future<TokenPair> _performRefresh(TokenPair current) async {
    final response = await _refreshDio.post<Map<String, dynamic>>(
      '/api/mobile/v1/auth/refresh',
      data: {'refreshToken': current.refreshToken},
    );
    final data = response.data?['data'] as Map<String, dynamic>?;
    final tokenData = data?['tokens'] as Map<String, dynamic>?;
    if (tokenData == null) throw StateError('Missing refreshed token payload');
    final refreshed = TokenPair(
      accessToken: tokenData['accessToken'] as String,
      refreshToken: tokenData['refreshToken'] as String,
    );
    await _tokens.write(refreshed);
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
