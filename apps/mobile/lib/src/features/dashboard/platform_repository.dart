import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';

final platformRepositoryProvider = Provider<PlatformRepository>(
  (ref) => PlatformRepository(ref.watch(apiClientProvider)),
);

final dashboardDataProvider = FutureProvider<DashboardData>(
  (ref) => ref.watch(platformRepositoryProvider).dashboard(),
);

class DashboardData {
  const DashboardData({
    required this.identity,
    required this.agents,
    required this.conversations,
    required this.runs,
  });
  final Map<String, dynamic> identity;
  final List<Map<String, dynamic>> agents;
  final List<Map<String, dynamic>> conversations;
  final List<Map<String, dynamic>> runs;
}

class PlatformRepository {
  PlatformRepository(this._api);
  final ApiClient _api;

  Future<DashboardData> dashboard() async {
    final responses = await Future.wait([
      _api.dio.get<Map<String, dynamic>>('/api/mobile/v1/me'),
      _api.dio.get<Map<String, dynamic>>('/api/v1/agents'),
      _api.dio.get<Map<String, dynamic>>('/api/v1/conversations'),
      _api.dio.get<Map<String, dynamic>>('/api/v1/runs', queryParameters: {'limit': 20}),
    ]);
    final me = ApiClient.payload(responses[0]);
    final agents = ApiClient.payload(responses[1]);
    final conversations = ApiClient.payload(responses[2]);
    final runs = ApiClient.payload(responses[3]);
    return DashboardData(
      identity: me['identity'] as Map<String, dynamic>,
      agents: (agents['agents'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>(),
      conversations: (conversations['conversations'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>(),
      runs: (runs['runs'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>(),
    );
  }

  Future<Map<String, dynamic>> createConversation(String agentId) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/api/v1/conversations',
      data: {'agentId': agentId},
    );
    return ApiClient.payload(response)['conversation'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> sendMessage(String conversationId, String message) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/api/v1/chat',
      data: {'conversationId': conversationId, 'message': message, 'attachmentIds': <String>[]},
      options: Options(headers: {'idempotency-key': 'chat-${DateTime.now().microsecondsSinceEpoch}'}),
    );
    return ApiClient.payload(response);
  }

  Future<List<Map<String, dynamic>>> messages(String conversationId) async {
    final response = await _api.dio.get<Map<String, dynamic>>(
      '/api/v1/conversations',
      queryParameters: {'conversationId': conversationId},
    );
    return (ApiClient.payload(response)['messages'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> chatAppearance() async {
    final response = await _api.dio.get<Map<String, dynamic>>('/api/mobile/v1/preferences');
    return ApiClient.payload(response)['chat'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> saveChatAppearance({
    required String theme,
    required String wallpaper,
  }) async {
    final response = await _api.dio.put<Map<String, dynamic>>(
      '/api/mobile/v1/preferences',
      data: {'theme': theme, 'wallpaper': wallpaper},
    );
    return ApiClient.payload(response)['chat'] as Map<String, dynamic>;
  }
}
