import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/features/auth/auth_repository.dart';
import 'package:moataz_ai_mobile/src/features/chat/chat_sheet.dart';
import 'package:moataz_ai_mobile/src/features/dashboard/platform_repository.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(dashboardDataProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('معتز AI', style: TextStyle(fontWeight: FontWeight.w800)),
        actions: [
          IconButton(
            tooltip: 'تحديث',
            onPressed: () => ref.invalidate(dashboardDataProvider),
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'تسجيل الخروج',
            onPressed: () => ref.read(authStateProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: data.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _ErrorState(error: error, retry: () => ref.invalidate(dashboardDataProvider)),
        data: (value) => RefreshIndicator(
          onRefresh: () async => ref.refresh(dashboardDataProvider.future),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              Text('مرحباً ${value.identity['name'] ?? value.identity['email']}', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(value.identity['organizationName'] as String? ?? 'مساحة العمل', style: const TextStyle(color: Color(0xFF5E6B7C))),
              const SizedBox(height: 18),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 1.35,
                children: [
                  _Metric(icon: Icons.smart_toy_outlined, label: 'الوكلاء', value: '${value.agents.length}'),
                  _Metric(icon: Icons.play_circle_outline, label: 'التشغيلات', value: '${value.runs.length}'),
                  _Metric(icon: Icons.forum_outlined, label: 'المحادثات', value: '${value.conversations.length}'),
                  const _Metric(icon: Icons.api_outlined, label: 'الاتصال', value: 'API'),
                ],
              ),
              const SizedBox(height: 18),
              _SectionHeader(title: 'الوكلاء الجاهزون', trailing: '${value.agents.length}'),
              const SizedBox(height: 10),
              ...value.agents.take(8).map((agent) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Card(
                  child: ListTile(
                    leading: const CircleAvatar(backgroundColor: Color(0xFFE9EFFF), child: Icon(Icons.smart_toy_outlined, color: Color(0xFF245BFF))),
                    title: Text(agent['name'] as String, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(agent['description'] as String? ?? 'وكيل منشور وجاهز للعمل', maxLines: 2, overflow: TextOverflow.ellipsis),
                    trailing: const Icon(Icons.chat_bubble_outline),
                    onTap: () => showModalBottomSheet<void>(
                      context: context,
                      isScrollControlled: true,
                      useSafeArea: true,
                      builder: (_) => ChatSheet(agent: agent),
                    ),
                  ),
                ),
              )),
              const SizedBox(height: 12),
              _SectionHeader(title: 'آخر التشغيلات', trailing: '${value.runs.length}'),
              const SizedBox(height: 10),
              Card(
                child: Column(
                  children: value.runs.take(10).map((run) => ListTile(
                    dense: true,
                    leading: Icon(
                      run['status'] == 'completed' ? Icons.check_circle : Icons.pending_outlined,
                      color: run['status'] == 'completed' ? const Color(0xFF16835F) : const Color(0xFFD97706),
                    ),
                    title: Text(run['model'] as String? ?? 'تشغيل وكيل', textDirection: TextDirection.ltr),
                    subtitle: Text(_status(run['status'] as String? ?? 'queued')),
                  )).toList(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _status(String value) => {
    'queued': 'في الانتظار',
    'running': 'يعمل الآن',
    'completed': 'مكتمل',
    'failed': 'فشل',
    'cancelled': 'ملغي',
  }[value] ?? value;
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: const Color(0xFF245BFF)),
          const Spacer(),
          Text(value, style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)),
          Text(label, style: const TextStyle(color: Color(0xFF5E6B7C))),
        ],
      ),
    ),
  );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.trailing});
  final String title;
  final String trailing;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800))),
      Text(trailing, style: const TextStyle(color: Color(0xFF5E6B7C))),
    ],
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
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 48),
          const SizedBox(height: 12),
          Text(error.toString(), textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton(onPressed: retry, child: const Text('إعادة المحاولة')),
        ],
      ),
    ),
  );
}
