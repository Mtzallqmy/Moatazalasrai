import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';
import 'package:moataz_ai_mobile/src/core/brand_config.dart';
import 'package:moataz_ai_mobile/src/features/auth/auth_repository.dart';
import 'package:moataz_ai_mobile/src/features/chat/conversation_screen.dart';
import 'package:moataz_ai_mobile/src/features/dashboard/platform_repository.dart';
import 'package:moataz_ai_mobile/src/widgets/brand_mark.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});
  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  int _selected = 0;

  @override
  Widget build(BuildContext context) {
    final dashboard = ref.watch(dashboardDataProvider);
    final workspace = ref.watch(workspaceDataProvider);
    return dashboard.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, _) => Scaffold(body: _ErrorState(error: error, retry: _refresh)),
      data: (data) {
        final destinations = _destinations(data);
        if (_selected >= destinations.length) _selected = 0;
        final selected = destinations[_selected];
        return Scaffold(
          appBar: AppBar(
            title: Row(children: [
              const BrandMark(size: 36),
              const SizedBox(width: 10),
              Text(selected.label, style: const TextStyle(fontWeight: FontWeight.w900)),
            ]),
            actions: [
              IconButton(tooltip: 'تحديث', onPressed: _refresh, icon: const Icon(Icons.refresh)),
            ],
          ),
          drawer: NavigationDrawer(
            selectedIndex: _selected,
            onDestinationSelected: (index) {
              setState(() => _selected = index);
              Navigator.pop(context);
            },
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 22, 20, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const BrandMark(size: 48, showWordmark: true),
                    const SizedBox(height: 16),
                    Text(data.identity['name'] as String? ?? data.identity['email'] as String, style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text(data.identity['organizationName'] as String? ?? 'مساحة العمل', style: const TextStyle(color: Color(0xFF607178))),
                    const SizedBox(height: 8),
                    _RoleChip(role: data.identity['role'] as String? ?? 'member'),
                  ],
                ),
              ),
              ...destinations.map((item) => NavigationDrawerDestination(
                icon: Icon(item.icon),
                selectedIcon: Icon(item.icon, color: const Color(0xFF087D75)),
                label: Text(item.label),
              )),
              const Padding(padding: EdgeInsets.symmetric(horizontal: 20), child: Divider()),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('تسجيل الخروج'),
                onTap: () {
                  Navigator.pop(context);
                  ref.read(authStateProvider.notifier).logout();
                },
              ),
            ],
          ),
          body: _DestinationBody(
            destination: selected.id,
            dashboard: data,
            workspace: workspace,
            refresh: _refresh,
          ),
          bottomNavigationBar: destinations.length > 3
              ? NavigationBar(
                  selectedIndex: _selected < 3 ? _selected : 0,
                  onDestinationSelected: (index) => setState(() => _selected = index),
                  destinations: destinations.take(3).map((item) => NavigationDestination(
                    icon: Icon(item.icon),
                    label: item.label,
                  )).toList(),
                )
              : null,
        );
      },
    );
  }

  List<_Destination> _destinations(DashboardData data) {
    final scopes = data.scopes.toSet();
    final admin = {'owner', 'admin'}.contains(data.identity['role']);
    return [
      const _Destination('dashboard', 'لوحة التحكم', Icons.space_dashboard_outlined),
      const _Destination('conversations', 'المحادثات', Icons.forum_outlined),
      const _Destination('agents', 'الوكلاء', Icons.smart_toy_outlined),
      if (scopes.contains('teams:read')) const _Destination('teams', 'فرق الوكلاء', Icons.account_tree_outlined),
      if (scopes.contains('runs:read')) const _Destination('runs', 'التشغيلات', Icons.play_circle_outline),
      if (scopes.contains('files:read')) const _Destination('files', 'الملفات', Icons.folder_outlined),
      if (scopes.contains('providers:read')) const _Destination('providers', 'المزودون والنماذج', Icons.hub_outlined),
      if (scopes.contains('mcp:read')) const _Destination('mcp', 'MCP والأدوات', Icons.extension_outlined),
      if (scopes.contains('integrations:read')) const _Destination('integrations', 'التكاملات', Icons.cable_outlined),
      if (admin) const _Destination('members', 'الأعضاء والصلاحيات', Icons.group_outlined),
      if (admin) const _Destination('audit', 'سجل التدقيق', Icons.policy_outlined),
      const _Destination('settings', 'الإعدادات', Icons.settings_outlined),
    ];
  }

  void _refresh() {
    ref.invalidate(dashboardDataProvider);
    ref.invalidate(workspaceDataProvider);
    setState(() {});
  }
}

class _Destination {
  const _Destination(this.id, this.label, this.icon);
  final String id;
  final String label;
  final IconData icon;
}

class _DestinationBody extends StatelessWidget {
  const _DestinationBody({
    required this.destination,
    required this.dashboard,
    required this.workspace,
    required this.refresh,
  });
  final String destination;
  final DashboardData dashboard;
  final AsyncValue<WorkspaceData> workspace;
  final VoidCallback refresh;

  @override
  Widget build(BuildContext context) => switch (destination) {
    'dashboard' => _Overview(data: dashboard),
    'conversations' => _Conversations(data: dashboard, refresh: refresh),
    'agents' => _Agents(data: dashboard, refresh: refresh),
    'teams' => const _RemoteList(kind: _ResourceKind.teams),
    'runs' => _Runs(runs: dashboard.runs),
    'files' => const _RemoteList(kind: _ResourceKind.files),
    'providers' => _ProvidersView(canWrite: dashboard.scopes.contains('providers:write')),
    'integrations' => const _RemoteList(kind: _ResourceKind.integrations),
    'mcp' => workspace.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => _ErrorState(error: error, retry: refresh),
      data: (data) => _McpView(data: data),
    ),
    'members' => workspace.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => _ErrorState(error: error, retry: refresh),
      data: (data) => _MembersView(items: data.members),
    ),
    'audit' => workspace.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => _ErrorState(error: error, retry: refresh),
      data: (data) => _AuditView(items: data.audit),
    ),
    _ => _Settings(identity: dashboard.identity),
  };
}

class _Overview extends StatelessWidget {
  const _Overview({required this.data});
  final DashboardData data;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: () async {},
    child: ListView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [Color(0xFFDDF5F1), Color(0xFFF6FAFB)]),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFCFE2E0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('مرحبًا ${data.identity['name'] ?? data.identity['email']}', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              const Text('أدر محادثاتك ووكلاءك وملفاتك وتكاملاتك من تطبيق أصلي واحد.', style: TextStyle(height: 1.6, color: Color(0xFF51656A))),
            ],
          ),
        ),
        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.34,
          children: [
            _Metric(icon: Icons.smart_toy_outlined, label: 'الوكلاء', value: '${data.agents.length}'),
            _Metric(icon: Icons.forum_outlined, label: 'المحادثات', value: '${data.conversations.length}'),
            _Metric(icon: Icons.play_circle_outline, label: 'التشغيلات', value: '${data.runs.length}'),
            const _Metric(icon: Icons.cloud_done_outlined, label: 'المزامنة', value: 'API'),
          ],
        ),
        const SizedBox(height: 18),
        Text('آخر النشاط', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 10),
        Card(
          child: data.runs.isEmpty
              ? const _Empty(label: 'لا توجد تشغيلات بعد.')
              : Column(children: data.runs.take(8).map((run) => _RunTile(run: run)).toList()),
        ),
      ],
    ),
  );
}

class _Conversations extends ConsumerStatefulWidget {
  const _Conversations({required this.data, required this.refresh});
  final DashboardData data;
  final VoidCallback refresh;
  @override
  ConsumerState<_Conversations> createState() => _ConversationsState();
}

class _ConversationsState extends ConsumerState<_Conversations> {
  Map<String, dynamic>? _agent(String id) {
    for (final agent in widget.data.agents) {
      if (agent['id'] == id) return agent;
    }
    return null;
  }

  Future<void> _open(Map<String, dynamic> conversation) async {
    final agent = _agent(conversation['agentId'] as String);
    if (agent == null) return;
    if (agent['runtimeStatus'] != null && agent['runtimeStatus'] != 'ready') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('هذا الوكيل غير جاهز حاليًا. افحص المزود والنموذج ثم أعد المحاولة.')),
      );
      return;
    }
    await Navigator.push<void>(context, MaterialPageRoute(
      builder: (_) => ConversationScreen(agent: agent, conversation: conversation),
    ));
    widget.refresh();
  }

  Future<void> _new() async {
    final agent = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      showDragHandle: true,
      builder: (_) => ListView(
        shrinkWrap: true,
        children: [
          const ListTile(title: Text('اختر الوكيل', style: TextStyle(fontWeight: FontWeight.w900))),
          ...widget.data.agents.where((agent) =>
            agent['status'] == 'published'
            && (agent['runtimeStatus'] == null || agent['runtimeStatus'] == 'ready')).map((agent) => ListTile(
            leading: const CircleAvatar(child: Icon(Icons.smart_toy_outlined)),
            title: Text(agent['name'] as String),
            subtitle: Text(agent['description'] as String? ?? 'وكيل منشور'),
            onTap: () => Navigator.pop(context, agent),
          )),
        ],
      ),
    );
    if (agent == null || !mounted) return;
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => ConversationScreen(agent: agent)));
    widget.refresh();
  }

  Future<void> _menu(String action, Map<String, dynamic> item) async {
    final repository = ref.read(platformRepositoryProvider);
    try {
      if (action == 'delete') {
        await repository.deleteConversation(item['id'] as String);
      } else if (action == 'rename') {
        final controller = TextEditingController(text: item['title'] as String? ?? '');
        final title = await showDialog<String>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('إعادة تسمية المحادثة'),
            content: TextField(controller: controller, autofocus: true),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('إلغاء')),
              FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('حفظ')),
            ],
          ),
        );
        controller.dispose();
        if (title != null && title.isNotEmpty) {
          await repository.mutateConversation(item['id'] as String, 'rename', title: title);
        }
      } else {
        await repository.mutateConversation(item['id'] as String, action);
      }
      widget.refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.userMessage(error))),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      widget.data.conversations.isEmpty
          ? const _Empty(label: 'لا توجد محادثات. ابدأ محادثة وستُحفظ هنا.')
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 90),
              itemCount: widget.data.conversations.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (_, index) {
                final item = widget.data.conversations[index];
                final agent = _agent(item['agentId'] as String);
                return Card(
                  child: ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.forum_outlined)),
                    title: Text(item['title'] as String? ?? 'محادثة', style: const TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: Text('${agent?['name'] ?? 'وكيل'} · ${_date(item['updatedAt'])}'),
                    onTap: () => _open(item),
                    trailing: PopupMenuButton<String>(
                      onSelected: (value) => _menu(value, item),
                      itemBuilder: (_) => [
                        const PopupMenuItem(value: 'rename', child: Text('إعادة تسمية')),
                        PopupMenuItem(value: item['archivedAt'] == null ? 'archive' : 'restore', child: Text(item['archivedAt'] == null ? 'أرشفة' : 'استعادة')),
                        const PopupMenuItem(value: 'delete', child: Text('حذف')),
                      ],
                    ),
                  ),
                );
              },
            ),
      Positioned(
        left: 18,
        bottom: 18,
        child: FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add_comment_outlined), label: const Text('محادثة جديدة')),
      ),
    ],
  );
}

class _Agents extends ConsumerStatefulWidget {
  const _Agents({required this.data, required this.refresh});
  final DashboardData data;
  final VoidCallback refresh;
  @override
  ConsumerState<_Agents> createState() => _AgentsState();
}

class _AgentsState extends ConsumerState<_Agents> {
  Future<void> _open(Map<String, dynamic> agent) async {
    await Navigator.push<void>(context, MaterialPageRoute(builder: (_) => ConversationScreen(agent: agent)));
    widget.refresh();
  }

  Future<void> _templates() async {
    try {
      final repository = ref.read(platformRepositoryProvider);
      final results = await Future.wait([repository.agentTemplates(), repository.providers()]);
      if (!mounted) return;
      final templates = results[0];
      final providers = results[1].where((item) => item['enabled'] == true && item['validationStatus'] == 'verified').toList();
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (sheetContext) => _TemplateInstaller(
          templates: templates,
          providers: providers,
          install: (templateId, providerId, model) async {
            await repository.installTemplate(
              templateId: templateId,
              providerCredentialId: providerId,
              model: model,
            );
            widget.refresh();
          },
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.userMessage(error))),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      ListView.separated(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 90),
        itemCount: widget.data.agents.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, index) {
          final agent = widget.data.agents[index];
          final ready = agent['status'] == 'published' && agent['runtimeStatus'] != 'unavailable';
          final runtimeStatus = agent['runtimeStatus'] as String? ?? 'ready';
          final statusLabel = agent['status'] != 'published'
              ? 'مسودة'
              : runtimeStatus == 'cooldown'
                  ? 'انتظار'
                  : runtimeStatus == 'unavailable' ? 'غير جاهز' : 'جاهز';
          return Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: const Color(0xFFDDF5F1),
                child: Icon(Icons.smart_toy_outlined, color: ready ? const Color(0xFF087D75) : Colors.grey),
              ),
              title: Text(agent['name'] as String, style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text(agent['description'] as String? ?? 'لا يوجد وصف', maxLines: 2, overflow: TextOverflow.ellipsis),
              trailing: Chip(label: Text(statusLabel)),
              onTap: ready && runtimeStatus != 'cooldown' ? () => _open(agent) : null,
            ),
          );
        },
      ),
      if (widget.data.scopes.contains('agents:write'))
        Positioned(
          left: 18,
          bottom: 18,
          child: FloatingActionButton.extended(onPressed: _templates, icon: const Icon(Icons.auto_awesome), label: const Text('الوكلاء الجاهزون')),
        ),
    ],
  );
}

class _ProvidersView extends ConsumerStatefulWidget {
  const _ProvidersView({required this.canWrite});
  final bool canWrite;
  @override
  ConsumerState<_ProvidersView> createState() => _ProvidersViewState();
}

class _ProvidersViewState extends ConsumerState<_ProvidersView> {
  late Future<List<Map<String, dynamic>>> _future;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() => _future = ref.read(platformRepositoryProvider).providers();

  Future<void> _create() async {
    String provider = 'openai';
    final name = TextEditingController();
    final key = TextEditingController();
    final model = TextEditingController();
    final baseUrl = TextEditingController();
    final values = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('إضافة مزود واختباره'),
          content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: provider,
              decoration: const InputDecoration(labelText: 'نوع المزود'),
              items: const [
                DropdownMenuItem(value: 'openai', child: Text('OpenAI')),
                DropdownMenuItem(value: 'anthropic', child: Text('Anthropic')),
                DropdownMenuItem(value: 'gemini', child: Text('Gemini')),
                DropdownMenuItem(value: 'openai_compatible', child: Text('OpenAI Compatible')),
              ],
              onChanged: (value) => update(() => provider = value ?? provider),
            ),
            const SizedBox(height: 10),
            TextField(controller: name, decoration: const InputDecoration(labelText: 'اسم الاتصال')),
            const SizedBox(height: 10),
            TextField(controller: key, obscureText: true, textDirection: TextDirection.ltr, decoration: const InputDecoration(labelText: 'API key')),
            const SizedBox(height: 10),
            TextField(controller: model, textDirection: TextDirection.ltr, decoration: const InputDecoration(labelText: 'نموذج الاختبار')),
            const SizedBox(height: 10),
            TextField(controller: baseUrl, textDirection: TextDirection.ltr, decoration: const InputDecoration(labelText: 'Base URL (اختياري)')),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('إلغاء')),
            FilledButton(onPressed: () => Navigator.pop(context, {
              'provider': provider,
              'name': name.text.trim(),
              'key': key.text.trim(),
              'model': model.text.trim(),
              'baseUrl': baseUrl.text.trim(),
            }), child: const Text('اختبار وحفظ')),
          ],
        ),
      ),
    );
    name.dispose();
    key.dispose();
    model.dispose();
    baseUrl.dispose();
    if (values == null || values['name']!.length < 2 || values['key']!.length < 8 || values['model']!.isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(platformRepositoryProvider).createProvider(
        provider: values['provider']!,
        name: values['name']!,
        apiKey: values['key']!,
        testModel: values['model']!,
        baseUrl: values['baseUrl'],
      );
      if (mounted) setState(_load);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.userMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Stack(children: [
    FutureBuilder<List<Map<String, dynamic>>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snapshot.hasError) return _ErrorState(error: snapshot.error!, retry: () => setState(_load));
        final items = snapshot.data ?? const [];
        if (items.isEmpty) return const _Empty(label: 'لا يوجد مزود متحقق. أضف اتصالًا ليعمل الوكلاء.');
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 90),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, index) => _ResourceTile(kind: _ResourceKind.providers, item: items[index]),
        );
      },
    ),
    if (widget.canWrite) Positioned(
      left: 18,
      bottom: 18,
      child: FloatingActionButton.extended(
        onPressed: _busy ? null : _create,
        icon: const Icon(Icons.add_link),
        label: const Text('إضافة مزود'),
      ),
    ),
  ]);
}

enum _ResourceKind { teams, files, providers, integrations }

class _RemoteList extends ConsumerStatefulWidget {
  const _RemoteList({required this.kind});
  final _ResourceKind kind;
  @override
  ConsumerState<_RemoteList> createState() => _RemoteListState();
}

class _RemoteListState extends ConsumerState<_RemoteList> {
  late Future<List<Map<String, dynamic>>> _future;
  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final repository = ref.read(platformRepositoryProvider);
    _future = switch (widget.kind) {
      _ResourceKind.teams => repository.teams(),
      _ResourceKind.files => repository.files(),
      _ResourceKind.providers => repository.providers(),
      _ResourceKind.integrations => repository.integrations(),
    };
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<List<Map<String, dynamic>>>(
    future: _future,
    builder: (context, snapshot) {
      if (snapshot.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
      if (snapshot.hasError) return _ErrorState(error: snapshot.error!, retry: () => setState(_load));
      final items = snapshot.data ?? const [];
      if (items.isEmpty) return _Empty(label: _emptyLabel(widget.kind));
      return RefreshIndicator(
        onRefresh: () async => setState(_load),
        child: ListView.separated(
          padding: const EdgeInsets.all(14),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, index) => _ResourceTile(kind: widget.kind, item: items[index]),
        ),
      );
    },
  );
}

class _ResourceTile extends StatelessWidget {
  const _ResourceTile({required this.kind, required this.item});
  final _ResourceKind kind;
  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final title = switch (kind) {
      _ResourceKind.teams => item['name'] as String? ?? 'فريق',
      _ResourceKind.files => item['filename'] as String? ?? 'ملف',
      _ResourceKind.providers => item['name'] as String? ?? 'مزود',
      _ResourceKind.integrations => item['name'] as String? ?? 'تكامل',
    };
    final subtitle = switch (kind) {
      _ResourceKind.teams => '${(item['members'] as List<dynamic>? ?? const []).length} وكلاء · ${item['enabled'] == false ? 'معطل' : 'فعال'}',
      _ResourceKind.files => '${item['mimeType'] ?? 'file'} · ${_bytes(item['sizeBytes'])}',
      _ResourceKind.providers => '${item['provider'] ?? ''} · ${item['validationStatus'] ?? ''} · ${(item['discoveredModels'] as List<dynamic>? ?? const []).length} نموذج',
      _ResourceKind.integrations => '${item['kind'] ?? ''} · ${item['status'] ?? ''}',
    };
    final icon = switch (kind) {
      _ResourceKind.teams => Icons.account_tree_outlined,
      _ResourceKind.files => Icons.description_outlined,
      _ResourceKind.providers => Icons.hub_outlined,
      _ResourceKind.integrations => Icons.cable_outlined,
    };
    return Card(child: ListTile(
      leading: CircleAvatar(child: Icon(icon)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Text(subtitle),
      trailing: item['enabled'] == false
          ? const Icon(Icons.pause_circle_outline, color: Colors.orange)
          : const Icon(Icons.check_circle_outline, color: Color(0xFF16835F)),
    ));
  }
}

class _Runs extends StatelessWidget {
  const _Runs({required this.runs});
  final List<Map<String, dynamic>> runs;
  @override
  Widget build(BuildContext context) => runs.isEmpty
      ? const _Empty(label: 'لا توجد تشغيلات بعد.')
      : ListView.separated(
          padding: const EdgeInsets.all(14),
          itemCount: runs.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, index) => Card(child: _RunTile(run: runs[index])),
        );
}

class _RunTile extends StatelessWidget {
  const _RunTile({required this.run});
  final Map<String, dynamic> run;
  @override
  Widget build(BuildContext context) {
    final status = run['status'] as String? ?? 'queued';
    return ListTile(
      leading: Icon(status == 'completed' ? Icons.check_circle : status == 'failed' ? Icons.error_outline : Icons.pending_outlined,
        color: status == 'completed' ? const Color(0xFF16835F) : status == 'failed' ? Colors.red : Colors.orange),
      title: Text(run['model'] as String? ?? 'تشغيل وكيل', textDirection: TextDirection.ltr),
      subtitle: Text('${_status(status)} · ${_date(run['createdAt'])}'),
    );
  }
}

class _McpView extends ConsumerStatefulWidget {
  const _McpView({required this.data});
  final WorkspaceData data;
  @override
  ConsumerState<_McpView> createState() => _McpViewState();
}

class _McpViewState extends ConsumerState<_McpView> {
  bool _busy = false;

  Future<void> _create() async {
    final name = TextEditingController();
    final endpoint = TextEditingController();
    final token = TextEditingController();
    final values = await showDialog<List<String>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('ربط خادم MCP'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'اسم الاتصال')),
          const SizedBox(height: 10),
          TextField(controller: endpoint, textDirection: TextDirection.ltr, decoration: const InputDecoration(labelText: 'HTTPS Streamable endpoint')),
          const SizedBox(height: 10),
          TextField(controller: token, obscureText: true, textDirection: TextDirection.ltr, decoration: const InputDecoration(labelText: 'Bearer token (اختياري)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(context, [name.text.trim(), endpoint.text.trim(), token.text.trim()]), child: const Text('ربط واكتشاف')),
        ],
      ),
    );
    name.dispose();
    endpoint.dispose();
    token.dispose();
    if (values == null || values[0].length < 2 || !values[1].startsWith('https://')) return;
    setState(() => _busy = true);
    try {
      await ref.read(platformRepositoryProvider).createMcpServer(name: values[0], endpoint: values[1], bearerToken: values[2]);
      ref.invalidate(workspaceDataProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.userMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sync(String id) async {
    setState(() => _busy = true);
    try {
      await ref.read(platformRepositoryProvider).syncMcpServer(id);
      ref.invalidate(workspaceDataProvider);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.userMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(14),
    children: [
      _InfoBanner(
        icon: Icons.extension_outlined,
        title: '${widget.data.mcpServers.length} خادم MCP · ${widget.data.mcpTools.length} أداة',
        body: 'الخوادم والأدوات المكتشفة فعليًا. الأسرار لا تُرسل إلى التطبيق.',
      ),
      if (widget.data.capabilities['canWriteMcp'] == true) ...[
        const SizedBox(height: 10),
        FilledButton.tonalIcon(
          onPressed: _busy ? null : _create,
          icon: const Icon(Icons.add_link),
          label: const Text('ربط خادم MCP واكتشاف أدواته'),
        ),
      ],
      const SizedBox(height: 12),
      ...widget.data.mcpServers.map((server) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Card(child: ListTile(
          leading: const CircleAvatar(child: Icon(Icons.dns_outlined)),
          title: Text(server['name'] as String? ?? 'MCP', style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text('${server['endpoint'] ?? ''}\n${server['serverName'] ?? 'Server'} · ${server['status'] ?? 'pending'}', maxLines: 3),
          isThreeLine: true,
          trailing: IconButton(
            tooltip: 'إعادة الاكتشاف',
            onPressed: _busy || widget.data.capabilities['canWriteMcp'] != true ? null : () => _sync(server['id'] as String),
            icon: Icon(server['status'] == 'connected' ? Icons.sync : Icons.cloud_sync_outlined, color: server['status'] == 'connected' ? const Color(0xFF16835F) : Colors.orange),
          ),
        )),
      )),
      if (widget.data.mcpTools.isNotEmpty) ...[
        const SizedBox(height: 8),
        Text('الأدوات المكتشفة', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        ...widget.data.mcpTools.map((tool) => Card(child: ListTile(
          leading: const Icon(Icons.build_outlined),
          title: Text(tool['title'] as String? ?? tool['name'] as String? ?? 'أداة'),
          subtitle: Text(tool['description'] as String? ?? 'أداة MCP متصلة'),
          trailing: Chip(label: Text(tool['risk'] as String? ?? 'medium')),
        ))),
      ],
    ],
  );
}

class _MembersView extends StatelessWidget {
  const _MembersView({required this.items});
  final List<Map<String, dynamic>> items;
  @override
  Widget build(BuildContext context) => items.isEmpty
      ? const _Empty(label: 'لا توجد بيانات أعضاء متاحة.')
      : ListView.separated(
          padding: const EdgeInsets.all(14),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (_, index) {
            final item = items[index];
            return Card(child: ListTile(
              leading: CircleAvatar(child: Text(((item['name'] ?? item['email']) as String).characters.first.toUpperCase())),
              title: Text(item['name'] as String? ?? item['email'] as String),
              subtitle: Text(item['email'] as String, textDirection: TextDirection.ltr),
              trailing: _RoleChip(role: item['role'] as String? ?? 'member'),
            ));
          },
        );
}

class _AuditView extends StatelessWidget {
  const _AuditView({required this.items});
  final List<Map<String, dynamic>> items;
  @override
  Widget build(BuildContext context) => items.isEmpty
      ? const _Empty(label: 'لا توجد أحداث تدقيق.')
      : ListView.separated(
          padding: const EdgeInsets.all(14),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (_, index) {
            final item = items[index];
            return Card(child: ListTile(
              leading: const Icon(Icons.verified_user_outlined),
              title: Text(item['action'] as String? ?? 'حدث', textDirection: TextDirection.ltr),
              subtitle: Text('${item['resourceType'] ?? ''} · ${_date(item['createdAt'])}'),
            ));
          },
        );
}

class _Settings extends ConsumerWidget {
  const _Settings({required this.identity});
  final Map<String, dynamic> identity;
  @override
  Widget build(BuildContext context, WidgetRef ref) => ListView(
    padding: const EdgeInsets.all(14),
    children: [
      const Center(child: BrandMark(size: 72, showWordmark: true)),
      const SizedBox(height: 20),
      Card(child: Column(children: [
        ListTile(leading: const Icon(Icons.person_outline), title: Text(identity['name'] as String? ?? 'المستخدم'), subtitle: Text(identity['email'] as String, textDirection: TextDirection.ltr)),
        const Divider(height: 1),
        ListTile(leading: const Icon(Icons.business_outlined), title: Text(identity['organizationName'] as String? ?? 'مساحة العمل'), trailing: _RoleChip(role: identity['role'] as String? ?? 'member')),
      ])),
      const SizedBox(height: 12),
      const _InfoBanner(icon: Icons.lock_outline, title: 'جلسة آمنة قابلة للاستعادة', body: 'رمز وصول قصير العمر، وتجديد دوّار محفوظ داخل التخزين المشفر في Android.'),
      const SizedBox(height: 12),
      FilledButton.tonalIcon(
        onPressed: () => ref.read(authStateProvider.notifier).logout(),
        icon: const Icon(Icons.logout),
        label: const Text('تسجيل الخروج من هذا الجهاز'),
      ),
      const SizedBox(height: 28),
      Wrap(
        alignment: WrapAlignment.center,
        spacing: 4,
        children: socialLinks.map((item) => IconButton(
          tooltip: item.url.isEmpty ? '${item.label} — الرابط غير مضاف بعد' : item.label,
          onPressed: item.url.isEmpty ? null : () {},
          icon: FaIcon(item.icon, size: 20),
        )).toList(),
      ),
      const Center(child: Text('برمجة وتطوير معتز العلقمي', style: TextStyle(fontWeight: FontWeight.w800))),
      const Center(child: Text('2026 م', style: TextStyle(color: Color(0xFF607178)))),
    ],
  );
}

class _TemplateInstaller extends StatefulWidget {
  const _TemplateInstaller({required this.templates, required this.providers, required this.install});
  final List<Map<String, dynamic>> templates;
  final List<Map<String, dynamic>> providers;
  final Future<void> Function(String templateId, String providerId, String model) install;
  @override
  State<_TemplateInstaller> createState() => _TemplateInstallerState();
}

class _TemplateInstallerState extends State<_TemplateInstaller> {
  bool _busy = false;
  @override
  Widget build(BuildContext context) => SafeArea(
    child: DraggableScrollableSheet(
      expand: false,
      initialChildSize: .78,
      builder: (_, controller) => ListView(
        controller: controller,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        children: [
          Text('وكلاء إنتاجيون جاهزون', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)),
          const SizedBox(height: 6),
          Text(widget.providers.isEmpty ? 'اربط مزودًا متحققًا من المنصة أولًا لتثبيت الوكلاء.' : 'اختر القالب وسيستخدم أول نموذج متحقق. يمكنك تغييره لاحقًا من المنصة.'),
          const SizedBox(height: 14),
          ...widget.templates.map((template) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(template['name'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                  const SizedBox(height: 6),
                  Text(template['description'] as String),
                  const SizedBox(height: 12),
                  FilledButton.tonalIcon(
                    onPressed: _busy || widget.providers.isEmpty ? null : () => _install(template),
                    icon: const Icon(Icons.download_done_outlined),
                    label: const Text('تثبيت ونشر'),
                  ),
                ],
              ),
            )),
          )),
        ],
      ),
    ),
  );

  Future<void> _install(Map<String, dynamic> template) async {
    final provider = widget.providers.first;
    final models = (provider['discoveredModels'] as List<dynamic>? ?? const []).cast<String>();
    if (models.isEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.install(template['id'] as String, provider['id'] as String, models.first);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم تثبيت الوكيل ونشره.')));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiClient.userMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, color: const Color(0xFF087D75)),
        const Spacer(),
        Text(value, style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w900)),
        Text(label, style: const TextStyle(color: Color(0xFF607178))),
      ]),
    ),
  );
}

class _RoleChip extends StatelessWidget {
  const _RoleChip({required this.role});
  final String role;
  @override
  Widget build(BuildContext context) => Chip(
    visualDensity: VisualDensity.compact,
    label: Text({
      'owner': 'مالك',
      'admin': 'مدير',
      'developer': 'مطور',
      'operator': 'مشغل',
      'viewer': 'مشاهد',
      'member': 'عضو',
    }[role] ?? role),
  );
}

class _InfoBanner extends StatelessWidget {
  const _InfoBanner({required this.icon, required this.title, required this.body});
  final IconData icon;
  final String title;
  final String body;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(color: const Color(0xFFDFF4F1), borderRadius: BorderRadius.circular(18)),
    child: Row(children: [
      Icon(icon, color: const Color(0xFF087D75)),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        Text(body, style: const TextStyle(color: Color(0xFF51656A))),
      ])),
    ]),
  );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.inbox_outlined, size: 48, color: Color(0xFF8A9A9F)),
        const SizedBox(height: 12),
        Text(label, textAlign: TextAlign.center),
      ]),
    ),
  );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.error, required this.retry});
  final Object error;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off_outlined, size: 48),
        const SizedBox(height: 12),
        Text(ApiClient.userMessage(error), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        FilledButton(onPressed: retry, child: const Text('إعادة المحاولة')),
      ]),
    ),
  );
}

String _status(String value) => {
  'queued': 'في الانتظار',
  'running': 'يعمل الآن',
  'completed': 'مكتمل',
  'failed': 'فشل',
  'cancelled': 'ملغي',
}[value] ?? value;

String _date(dynamic value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (parsed == null) return '';
  return '${parsed.year}/${parsed.month.toString().padLeft(2, '0')}/${parsed.day.toString().padLeft(2, '0')}';
}

String _bytes(dynamic value) {
  final size = value is int ? value : int.tryParse(value?.toString() ?? '') ?? 0;
  if (size >= 1024 * 1024) return '${(size / (1024 * 1024)).toStringAsFixed(1)} MB';
  if (size >= 1024) return '${(size / 1024).toStringAsFixed(1)} KB';
  return '$size B';
}

String _emptyLabel(_ResourceKind kind) => switch (kind) {
  _ResourceKind.teams => 'لا توجد فرق وكلاء بعد.',
  _ResourceKind.files => 'لا توجد ملفات. ارفع ملفًا من داخل المحادثة.',
  _ResourceKind.providers => 'لا يوجد مزود متحقق. أضف مفتاح مزود من لوحة الويب.',
  _ResourceKind.integrations => 'لا توجد تكاملات مفعلة.',
};
