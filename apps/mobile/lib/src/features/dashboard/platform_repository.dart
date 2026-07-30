import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http_parser/http_parser.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';

final platformRepositoryProvider = Provider<PlatformRepository>(
  (ref) => PlatformRepository(ref.watch(apiClientProvider)),
);

final dashboardDataProvider = FutureProvider<DashboardData>(
  (ref) => ref.watch(platformRepositoryProvider).dashboard(),
);

final workspaceDataProvider = FutureProvider<WorkspaceData>(
  (ref) => ref.watch(platformRepositoryProvider).workspace(),
);

class DashboardData {
  const DashboardData({
    required this.identity,
    required this.scopes,
    required this.agents,
    required this.conversations,
    required this.runs,
  });
  final Map<String, dynamic> identity;
  final List<String> scopes;
  final List<Map<String, dynamic>> agents;
  final List<Map<String, dynamic>> conversations;
  final List<Map<String, dynamic>> runs;
}

class WorkspaceData {
  const WorkspaceData({
    required this.organization,
    required this.capabilities,
    required this.mcpServers,
    required this.mcpTools,
    required this.mcpResources,
    required this.mcpResourceTemplates,
    required this.mcpPrompts,
    required this.members,
    required this.audit,
  });
  final Map<String, dynamic>? organization;
  final Map<String, dynamic> capabilities;
  final List<Map<String, dynamic>> mcpServers;
  final List<Map<String, dynamic>> mcpTools;
  final List<Map<String, dynamic>> mcpResources;
  final List<Map<String, dynamic>> mcpResourceTemplates;
  final List<Map<String, dynamic>> mcpPrompts;
  final List<Map<String, dynamic>> members;
  final List<Map<String, dynamic>> audit;
}

class PlatformRepository {
  PlatformRepository(this._api);
  final ApiClient _api;

  Future<DashboardData> dashboard() async {
    final responses = await Future.wait([
      _api.dio.get<Map<String, dynamic>>('/api/mobile/v1/me'),
      _api.dio.get<Map<String, dynamic>>('/api/v1/agents'),
      _api.dio.get<Map<String, dynamic>>('/api/v1/conversations'),
      _api.dio.get<Map<String, dynamic>>('/api/v1/runs', queryParameters: {'limit': 100}),
    ]);
    final me = ApiClient.payload(responses[0]);
    final agentPayload = ApiClient.payload(responses[1]);
    final conversationPayload = ApiClient.payload(responses[2]);
    final runPayload = ApiClient.payload(responses[3]);
    return DashboardData(
      identity: me['identity'] as Map<String, dynamic>,
      scopes: (me['scopes'] as List<dynamic>? ?? const []).cast<String>(),
      agents: _list(agentPayload, 'agents'),
      conversations: _list(conversationPayload, 'conversations'),
      runs: _list(runPayload, 'runs'),
    );
  }

  Future<WorkspaceData> workspace() async {
    final response = await _api.dio.get<Map<String, dynamic>>('/api/mobile/v1/workspace');
    final data = ApiClient.payload(response);
    final mcp = data['mcp'] as Map<String, dynamic>? ?? const {};
    final tools = _list(mcp, 'tools');
    final resources = _list(mcp, 'resources');
    final resourceTemplates = _list(mcp, 'resourceTemplates');
    final prompts = _list(mcp, 'prompts');
    final catalog = <Map<String, dynamic>>[
      ...tools.map((item) => {...item, 'catalogKind': 'tool'}),
      ...resources.map((item) => {
        ...item,
        'catalogKind': 'resource',
        'risk': 'resource',
        'name': item['name'] ?? item['uri'],
      }),
      ...resourceTemplates.map((item) => {
        ...item,
        'catalogKind': 'resource_template',
        'risk': 'template',
        'name': item['name'] ?? item['uriTemplate'],
      }),
      ...prompts.map((item) => {
        ...item,
        'catalogKind': 'prompt',
        'risk': 'prompt',
      }),
    ];
    return WorkspaceData(
      organization: data['organization'] as Map<String, dynamic>?,
      capabilities: data['capabilities'] as Map<String, dynamic>? ?? const {},
      mcpServers: _list(mcp, 'servers'),
      mcpTools: catalog,
      mcpResources: resources,
      mcpResourceTemplates: resourceTemplates,
      mcpPrompts: prompts,
      members: _list(data, 'members'),
      audit: _list(data, 'audit'),
    );
  }

  Future<List<Map<String, dynamic>>> agents() => _getList('/api/v1/agents', 'agents');
  Future<List<Map<String, dynamic>>> conversations() => _getList('/api/v1/conversations', 'conversations');
  Future<List<Map<String, dynamic>>> runs() => _getList('/api/v1/runs', 'runs', query: {'limit': 100});
  Future<List<Map<String, dynamic>>> teams() => _getList('/api/v1/teams', 'teams');
  Future<List<Map<String, dynamic>>> files() => _getList('/api/v1/files', 'files');
  Future<List<Map<String, dynamic>>> providers() => _getList('/api/v1/provider-credentials', 'credentials');
  Future<List<Map<String, dynamic>>> integrations() => _getList('/api/v1/integrations', 'integrations');
  Future<List<Map<String, dynamic>>> agentTemplates() => _getList('/api/v1/agent-templates', 'templates');

  Future<List<Map<String, dynamic>>> _getList(
    String path,
    String key, {
    Map<String, dynamic>? query,
  }) async {
    final response = await _api.dio.get<Map<String, dynamic>>(path, queryParameters: query);
    return _list(ApiClient.payload(response), key);
  }

  static List<Map<String, dynamic>> _list(Map<String, dynamic> data, String key) =>
      (data[key] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();

  Future<Map<String, dynamic>> createConversation(String agentId, {String? title}) async {
    final data = <String, dynamic>{'agentId': agentId};
    if (title != null) data['title'] = title;
    final response = await _api.dio.post<Map<String, dynamic>>('/api/v1/conversations', data: data);
    return ApiClient.payload(response)['conversation'] as Map<String, dynamic>;
  }

  Future<void> mutateConversation(String conversationId, String action, {String? title}) async {
    final data = <String, dynamic>{'conversationId': conversationId, 'action': action};
    if (title != null) data['title'] = title;
    await _api.dio.patch<Map<String, dynamic>>('/api/v1/conversations', data: data);
  }

  Future<void> deleteConversation(String conversationId) async {
    await _api.dio.delete<Map<String, dynamic>>('/api/v1/conversations', data: {'conversationId': conversationId});
  }

  Future<Map<String, dynamic>> sendMessage(
    String conversationId,
    String message, {
    List<String> attachmentIds = const [],
    String inputKind = 'text',
    List<Map<String, String>> mcpResources = const [],
    Map<String, dynamic>? mcpPrompt,
  }) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/api/v1/chat',
      data: {
        'conversationId': conversationId,
        'message': message,
        'attachmentIds': attachmentIds,
        'inputKind': inputKind,
        'mcpResources': mcpResources,
        'mcpPrompt': ?mcpPrompt,
      },
      options: Options(headers: {'idempotency-key': 'chat-${DateTime.now().microsecondsSinceEpoch}'}),
    );
    return ApiClient.payload(response);
  }

  Future<List<Map<String, dynamic>>> messages(String conversationId) async {
    final response = await _api.dio.get<Map<String, dynamic>>('/api/v1/conversations', queryParameters: {'conversationId': conversationId});
    return _list(ApiClient.payload(response), 'messages');
  }

  Future<Map<String, dynamic>> uploadFile(String conversationId, PlatformFile selected) async {
    final bytes = selected.bytes;
    if (bytes == null) throw const ApiException(code: 'FILE_UNREADABLE', message: 'تعذر قراءة الملف المحدد.');
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/api/v1/files',
      data: FormData.fromMap({
        'conversationId': conversationId,
        'file': MultipartFile.fromBytes(bytes, filename: selected.name, contentType: MediaType.parse(_mimeType(selected.name))),
      }),
      options: Options(contentType: 'multipart/form-data'),
    );
    return ApiClient.payload(response)['file'] as Map<String, dynamic>;
  }

  static String _mimeType(String filename) {
    final extension = filename.toLowerCase().split('.').last;
    return const {
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif',
      'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv', 'json': 'application/json',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'zip': 'application/zip', 'rar': 'application/vnd.rar', '7z': 'application/x-7z-compressed',
      'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'mp4': 'video/mp4', 'webm': 'video/webm',
    }[extension] ?? 'application/octet-stream';
  }

  static String inputKindForFiles(List<Map<String, dynamic>> files) {
    final mimeTypes = files.map((file) => file['mimeType'] as String? ?? '').toList();
    if (mimeTypes.any((type) => type.startsWith('image/'))) return 'image';
    if (mimeTypes.any((type) => type.startsWith('audio/'))) return 'audio';
    if (mimeTypes.any((type) => type.startsWith('video/'))) return 'video';
    return files.isEmpty ? 'text' : 'file';
  }

  Future<Map<String, dynamic>> importYoutube(String conversationId, String url) async {
    final response = await _api.dio.post<Map<String, dynamic>>('/api/v1/youtube', data: {'conversationId': conversationId, 'url': url});
    return ApiClient.payload(response)['file'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> auditSite(String conversationId, String url) async {
    final response = await _api.dio.post<Map<String, dynamic>>('/api/v1/site-audit', data: {'conversationId': conversationId, 'url': url, 'authorized': true});
    return ApiClient.payload(response)['file'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> installTemplate({ required String templateId, required String providerCredentialId, required String model }) async {
    final response = await _api.dio.post<Map<String, dynamic>>('/api/v1/agent-templates', data: {'templateId': templateId, 'providerCredentialId': providerCredentialId, 'model': model});
    return ApiClient.payload(response);
  }

  Future<void> createMcpServer({ required String name, required String endpoint, String? bearerToken }) async {
    await _api.dio.post<Map<String, dynamic>>('/api/v1/mcp', data: {
      'action': 'create', 'name': name, 'endpoint': endpoint,
      if (bearerToken != null && bearerToken.isNotEmpty) 'bearerToken': bearerToken,
    });
  }

  Future<void> syncMcpServer(String serverId) async {
    await _api.dio.post<Map<String, dynamic>>('/api/v1/mcp', data: {'action': 'sync', 'serverId': serverId});
  }

  Future<Map<String, dynamic>> readMcpResource({ required String serverId, required String uri }) async {
    final response = await _api.dio.post<Map<String, dynamic>>('/api/v1/mcp', data: {'action': 'read_resource', 'serverId': serverId, 'uri': uri});
    return ApiClient.payload(response)['result'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> renderMcpPrompt({ required String serverId, required String name, Map<String, String> arguments = const {} }) async {
    final response = await _api.dio.post<Map<String, dynamic>>('/api/v1/mcp', data: {'action': 'get_prompt', 'serverId': serverId, 'name': name, 'arguments': arguments});
    return ApiClient.payload(response)['result'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> callMcpTool({ required String toolId, Map<String, dynamic> arguments = const {} }) async {
    final response = await _api.dio.post<Map<String, dynamic>>('/api/v1/mcp', data: {'action': 'call', 'toolId': toolId, 'arguments': arguments});
    return ApiClient.payload(response);
  }

  Future<void> createProvider({ required String provider, required String name, required String apiKey, required String testModel, String? baseUrl }) async {
    await _api.dio.post<Map<String, dynamic>>('/api/v1/provider-credentials', data: {
      'provider': provider, 'name': name, 'apiKey': apiKey, 'testModel': testModel,
      if (baseUrl != null && baseUrl.isNotEmpty) 'baseUrl': baseUrl,
    });
  }

  Future<Map<String, dynamic>> chatAppearance() async {
    final response = await _api.dio.get<Map<String, dynamic>>('/api/mobile/v1/preferences');
    return ApiClient.payload(response)['chat'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> saveChatAppearance({ required String theme, required String wallpaper }) async {
    final response = await _api.dio.put<Map<String, dynamic>>('/api/mobile/v1/preferences', data: {'theme': theme, 'wallpaper': wallpaper});
    return ApiClient.payload(response)['chat'] as Map<String, dynamic>;
  }
}
