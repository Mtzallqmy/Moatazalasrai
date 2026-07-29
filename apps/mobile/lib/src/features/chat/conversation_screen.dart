import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';
import 'package:moataz_ai_mobile/src/features/dashboard/platform_repository.dart';

class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({
    required this.agent,
    this.conversation,
    super.key,
  });
  final Map<String, dynamic> agent;
  final Map<String, dynamic>? conversation;

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final List<Map<String, dynamic>> _messages = [];
  final List<Map<String, dynamic>> _pendingFiles = [];
  String? _conversationId;
  bool _busy = false;
  bool _loading = true;
  String _theme = 'moataz';
  String _wallpaper = 'soft-grid';

  @override
  void initState() {
    super.initState();
    _conversationId = widget.conversation?['id'] as String?;
    _restore();
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _restore() async {
    try {
      final repository = ref.read(platformRepositoryProvider);
      final results = await Future.wait([
        if (_conversationId != null) repository.messages(_conversationId!) else Future.value(<Map<String, dynamic>>[]),
        repository.chatAppearance(),
      ]);
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(results[0] as List<Map<String, dynamic>>);
        final appearance = results[1] as Map<String, dynamic>;
        _theme = appearance['theme'] as String? ?? 'moataz';
        _wallpaper = appearance['wallpaper'] as String? ?? 'soft-grid';
      });
      _scrollToEnd();
    } catch (error) {
      if (mounted) _show(error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String> _ensureConversation() async {
    if (_conversationId != null) return _conversationId!;
    final created = await ref.read(platformRepositoryProvider).createConversation(widget.agent['id'] as String);
    _conversationId = created['id'] as String;
    return _conversationId!;
  }

  Future<void> _pickFile() async {
    if (_busy || _pendingFiles.length >= 8) return;
    final selected = await FilePicker.platform.pickFiles(withData: true, allowMultiple: true);
    if (selected == null) return;
    setState(() => _busy = true);
    try {
      final conversationId = await _ensureConversation();
      for (final file in selected.files.take(8 - _pendingFiles.length)) {
        final uploaded = await ref.read(platformRepositoryProvider).uploadFile(conversationId, file);
        if (mounted) setState(() => _pendingFiles.add(uploaded));
      }
    } catch (error) {
      if (mounted) _show(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runUrlTool(bool youtube) async {
    final controller = TextEditingController();
    final url = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(youtube ? 'تفريغ مقطع YouTube' : 'فحص موقع مصرح به'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: controller,
              autofocus: true,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(hintText: youtube ? 'https://youtube.com/watch?v=…' : 'https://example.com'),
            ),
            if (!youtube) const Padding(
              padding: EdgeInsets.only(top: 12),
              child: Text('بالمتابعة تؤكد أنك مخول بفحص هذا العنوان. الفحص دفاعي لصفحة عامة واحدة.'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('تشغيل')),
        ],
      ),
    );
    controller.dispose();
    if (url == null || url.isEmpty) return;
    setState(() => _busy = true);
    try {
      final conversationId = await _ensureConversation();
      final file = youtube
          ? await ref.read(platformRepositoryProvider).importYoutube(conversationId, url)
          : await ref.read(platformRepositoryProvider).auditSite(conversationId, url);
      if (mounted) setState(() => _pendingFiles.add(file));
    } catch (error) {
      if (mounted) _show(error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if ((text.isEmpty && _pendingFiles.isEmpty) || _busy) return;
    final content = text.isEmpty ? 'حلل الملفات المرفقة وقدم النتيجة بوضوح.' : text;
    final attachmentIds = _pendingFiles.map((file) => file['id'] as String).toList();
    final inputKind = PlatformRepository.inputKindForFiles(_pendingFiles);
    setState(() {
      _busy = true;
      _messages.add({
        'role': 'user',
        'content': content,
        'attachments': List<Map<String, dynamic>>.from(_pendingFiles),
      });
      _controller.clear();
      _pendingFiles.clear();
    });
    _scrollToEnd();
    try {
      final conversationId = await _ensureConversation();
      await ref.read(platformRepositoryProvider).sendMessage(
        conversationId,
        content,
        attachmentIds: attachmentIds,
        inputKind: inputKind,
      );
      final saved = await ref.read(platformRepositoryProvider).messages(conversationId);
      if (mounted) {
        setState(() {
          _messages
            ..clear()
            ..addAll(saved);
        });
      }
      ref.invalidate(dashboardDataProvider);
      _scrollToEnd();
    } catch (error) {
      if (mounted) {
        _show(error);
        final saved = _conversationId == null
            ? <Map<String, dynamic>>[]
            : await ref.read(platformRepositoryProvider).messages(_conversationId!).catchError((_) => <Map<String, dynamic>>[]);
        if (mounted) {
          setState(() {
            _messages
              ..clear()
              ..addAll(saved);
          });
        }
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _appearance() async {
    var theme = _theme;
    var wallpaper = _wallpaper;
    final result = await showModalBottomSheet<List<String>>(
      context: context,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => Padding(
          padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('مظهر المحادثة', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 14),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'moataz', label: Text('معتز')),
                  ButtonSegment(value: 'whatsapp', label: Text('واتساب')),
                  ButtonSegment(value: 'telegram', label: Text('تليجرام')),
                ],
                selected: {theme},
                onSelectionChanged: (value) => update(() => theme = value.first),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                children: ['clean', 'soft-grid', 'doodles', 'bubbles'].map((item) => ChoiceChip(
                  label: Text({'clean': 'نظيف', 'soft-grid': 'شبكة', 'doodles': 'نقوش', 'bubbles': 'فقاعات'}[item]!),
                  selected: wallpaper == item,
                  onSelected: (_) => update(() => wallpaper = item),
                )).toList(),
              ),
              const SizedBox(height: 18),
              FilledButton(onPressed: () => Navigator.pop(context, [theme, wallpaper]), child: const Text('حفظ المظهر')),
            ],
          ),
        ),
      ),
    );
    if (result == null) return;
    try {
      final saved = await ref.read(platformRepositoryProvider).saveChatAppearance(theme: result[0], wallpaper: result[1]);
      if (mounted) {
        setState(() {
          _theme = saved['theme'] as String;
          _wallpaper = saved['wallpaper'] as String;
        });
      }
    } catch (error) {
      if (mounted) _show(error);
    }
  }

  void _show(Object error) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(ApiClient.userMessage(error))),
  );

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  ({Color stage, Color user, Color assistant, Color border}) get _colors => switch (_theme) {
    'whatsapp' => (stage: const Color(0xFFEFEAE2), user: const Color(0xFFD9FDD3), assistant: Colors.white, border: const Color(0xFFD8D1C8)),
    'telegram' => (stage: const Color(0xFFDCEAF5), user: const Color(0xFFC9EFFF), assistant: Colors.white, border: const Color(0xFFC4D7E5)),
    _ => (stage: const Color(0xFFF0F7F6), user: const Color(0xFFD7F1ED), assistant: Colors.white, border: const Color(0xFFD5E3E1)),
  };

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.agent['name'] as String? ?? 'المحادثة', style: const TextStyle(fontWeight: FontWeight.w900)),
          const Text('محفوظة ومتزامنة', style: TextStyle(fontSize: 11, color: Color(0xFF607178))),
        ],
      ),
      actions: [
        PopupMenuButton<String>(
          tooltip: 'أدوات الوكيل',
          onSelected: (value) => _runUrlTool(value == 'youtube'),
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'youtube', child: ListTile(leading: Icon(Icons.video_library_outlined), title: Text('تفريغ YouTube'))),
            PopupMenuItem(value: 'site', child: ListTile(leading: Icon(Icons.security_outlined), title: Text('فحص موقع'))),
          ],
        ),
        IconButton(tooltip: 'المظهر', onPressed: _appearance, icon: const Icon(Icons.palette_outlined)),
      ],
    ),
    body: Column(
      children: [
        Expanded(
          child: ColoredBox(
            color: _colors.stage,
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                    ? const _EmptyChat()
                    : ListView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.all(14),
                        itemCount: _messages.length,
                        itemBuilder: (_, index) {
                          final message = _messages[index];
                          final user = message['role'] == 'user';
                          final files = (message['attachments'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
                          return Align(
                            alignment: user ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                              constraints: const BoxConstraints(maxWidth: 390),
                              margin: const EdgeInsets.only(bottom: 10),
                              padding: const EdgeInsets.all(13),
                              decoration: BoxDecoration(
                                color: user ? _colors.user : _colors.assistant,
                                border: Border.all(color: _colors.border),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(message['content'] as String? ?? ''),
                                  if (files.isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    ...files.map((file) => Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Icon(Icons.attach_file, size: 16),
                                          const SizedBox(width: 4),
                                          Flexible(child: Text(file['filename'] as String? ?? 'ملف', maxLines: 1, overflow: TextOverflow.ellipsis)),
                                        ],
                                      ),
                                    )),
                                  ],
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
        ),
        if (_pendingFiles.isNotEmpty)
          SizedBox(
            height: 58,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              children: _pendingFiles.map((file) => InputChip(
                avatar: const Icon(Icons.description_outlined, size: 17),
                label: Text(file['filename'] as String? ?? 'ملف'),
                onDeleted: _busy ? null : () => setState(() => _pendingFiles.remove(file)),
              )).toList(),
            ),
          ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: Row(
              children: [
                IconButton.filledTonal(
                  tooltip: 'إرفاق ملفات أو صور',
                  onPressed: _busy ? null : _pickFile,
                  icon: const Icon(Icons.attach_file),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    minLines: 1,
                    maxLines: 5,
                    textInputAction: TextInputAction.newline,
                    decoration: const InputDecoration(hintText: 'اكتب رسالة أو أرفق ملفًا للتحليل…'),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  tooltip: 'إرسال',
                  onPressed: _busy ? null : _send,
                  icon: _busy
                      ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.send_rounded),
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat();
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.auto_awesome_outlined, size: 48, color: Color(0xFF178E84)),
          const SizedBox(height: 12),
          Text('ابدأ مهمة جديدة', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)),
          const SizedBox(height: 6),
          const Text('الرسائل والملفات تحفظ في حسابك وتظهر مجددًا عند فتح التطبيق.', textAlign: TextAlign.center),
        ],
      ),
    ),
  );
}
