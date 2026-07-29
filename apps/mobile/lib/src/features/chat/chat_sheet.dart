import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';
import 'package:moataz_ai_mobile/src/features/dashboard/platform_repository.dart';

class ChatSheet extends ConsumerStatefulWidget {
  const ChatSheet({required this.agent, super.key});
  final Map<String, dynamic> agent;
  @override
  ConsumerState<ChatSheet> createState() => _ChatSheetState();
}

class _ChatSheetState extends ConsumerState<ChatSheet> {
  final _controller = TextEditingController();
  final List<Map<String, dynamic>> _messages = [];
  String? _conversationId;
  bool _busy = false;
  String _chatTheme = 'moataz';
  String _wallpaper = 'soft-grid';
  bool _savingAppearance = false;

  @override
  void initState() {
    super.initState();
    _loadAppearance();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadAppearance() async {
    try {
      final value = await ref.read(platformRepositoryProvider).chatAppearance();
      if (!mounted) return;
      setState(() {
        _chatTheme = value['theme'] as String? ?? 'moataz';
        _wallpaper = value['wallpaper'] as String? ?? 'soft-grid';
      });
    } catch (_) {
      // القيم الافتراضية تبقي الدردشة قابلة للاستخدام عند انقطاع الشبكة.
    }
  }

  Future<void> _saveAppearance(String theme, String wallpaper) async {
    if (_savingAppearance) return;
    final previousTheme = _chatTheme;
    final previousWallpaper = _wallpaper;
    setState(() {
      _chatTheme = theme;
      _wallpaper = wallpaper;
      _savingAppearance = true;
    });
    try {
      final saved = await ref.read(platformRepositoryProvider).saveChatAppearance(
        theme: theme,
        wallpaper: wallpaper,
      );
      if (!mounted) return;
      setState(() {
        _chatTheme = saved['theme'] as String? ?? theme;
        _wallpaper = saved['wallpaper'] as String? ?? wallpaper;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _chatTheme = previousTheme;
        _wallpaper = previousWallpaper;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiClient.userMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _savingAppearance = false);
    }
  }

  Future<void> _showAppearancePicker() async {
    var theme = _chatTheme;
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
              Text('مظهر المحادثة', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              const Text('يُحفظ الاختيار في حسابك ويتزامن مع نسخة الويب.'),
              const SizedBox(height: 16),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'moataz', label: Text('معتز')),
                  ButtonSegment(value: 'whatsapp', label: Text('واتساب')),
                  ButtonSegment(value: 'telegram', label: Text('تليجرام')),
                ],
                selected: {theme},
                onSelectionChanged: (value) => update(() => theme = value.first),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: const [
                  ('clean', 'نظيفة'),
                  ('soft-grid', 'شبكة ناعمة'),
                  ('doodles', 'نقوش'),
                  ('bubbles', 'فقاعات'),
                ].map((item) => ChoiceChip(
                  label: Text(item.$2),
                  selected: wallpaper == item.$1,
                  onSelected: (_) => update(() => wallpaper = item.$1),
                )).toList(),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () => Navigator.pop(context, [theme, wallpaper]),
                icon: const Icon(Icons.check),
                label: const Text('حفظ المظهر'),
              ),
            ],
          ),
        ),
      ),
    );
    if (result != null) await _saveAppearance(result[0], result[1]);
  }

  ({Color stage, Color user, Color assistant, Color border}) get _colors => switch (_chatTheme) {
    'whatsapp' => (
      stage: const Color(0xFFEFEAE2),
      user: const Color(0xFFD9FDD3),
      assistant: Colors.white,
      border: const Color(0xFFD8D1C8),
    ),
    'telegram' => (
      stage: const Color(0xFFDCEAF5),
      user: const Color(0xFFC9EFFF),
      assistant: Colors.white,
      border: const Color(0xFFC4D7E5),
    ),
    _ => (
      stage: const Color(0xFFF2F7F6),
      user: const Color(0xFFD9F2EE),
      assistant: Colors.white,
      border: const Color(0xFFD6E2E0),
    ),
  };

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _messages.add({'role': 'user', 'content': text});
      _controller.clear();
    });
    try {
      final repository = ref.read(platformRepositoryProvider);
      if (_conversationId == null) {
        final conversation = await repository.createConversation(widget.agent['id'] as String);
        _conversationId = conversation['id'] as String;
      }
      final result = await repository.sendMessage(_conversationId!, text);
      final message = result['message'] as Map<String, dynamic>?;
      if (message != null && mounted) setState(() => _messages.add(message));
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
  Widget build(BuildContext context) => DraggableScrollableSheet(
    expand: false,
    initialChildSize: .86,
    minChildSize: .6,
    maxChildSize: .96,
    builder: (_, scrollController) => Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Row(
            children: [
              const CircleAvatar(backgroundColor: Color(0xFFE2F4F2), child: Icon(Icons.smart_toy_outlined, color: Color(0xFF0F8F86))),
              const SizedBox(width: 10),
              Expanded(child: Text(widget.agent['name'] as String, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
              IconButton(
                tooltip: 'مظهر المحادثة',
                onPressed: _savingAppearance ? null : _showAppearancePicker,
                icon: const Icon(Icons.palette_outlined),
              ),
              IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: CustomPaint(
            painter: _WallpaperPainter(color: _colors.stage, pattern: _wallpaper),
            child: _messages.isEmpty
              ? const Center(child: Text('اكتب مهمتك لبدء محادثة API أصلية.'))
              : ListView.builder(
                  controller: scrollController,
                  padding: const EdgeInsets.all(16),
                  itemCount: _messages.length,
                  itemBuilder: (_, index) {
                    final message = _messages[index];
                    final user = message['role'] == 'user';
                    return Align(
                      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 340),
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(13),
                        decoration: BoxDecoration(
                          color: user ? _colors.user : _colors.assistant,
                          border: Border.all(color: _colors.border),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Text(message['content'] as String? ?? ''),
                      ),
                    );
                  },
                ),
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(12, 10, 12, 10 + MediaQuery.viewInsetsOf(context).bottom),
          child: Row(
            children: [
              Expanded(child: TextField(controller: _controller, minLines: 1, maxLines: 4, decoration: const InputDecoration(hintText: 'اكتب رسالتك…'))),
              const SizedBox(width: 8),
              IconButton.filled(onPressed: _busy ? null : _send, icon: _busy ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send)),
            ],
          ),
        ),
      ],
    ),
  );
}

class _WallpaperPainter extends CustomPainter {
  const _WallpaperPainter({required this.color, required this.pattern});
  final Color color;
  final String pattern;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = color);
    if (pattern == 'clean') return;
    final ink = Paint()
      ..color = const Color(0xFF0F8F86).withValues(alpha: .07)
      ..style = pattern == 'bubbles' ? PaintingStyle.stroke : PaintingStyle.fill
      ..strokeWidth = 1;
    final gap = pattern == 'soft-grid' ? 28.0 : 48.0;
    for (double x = 0; x < size.width + gap; x += gap) {
      for (double y = 0; y < size.height + gap; y += gap) {
        if (pattern == 'soft-grid') {
          canvas.drawCircle(Offset(x, y), 1.1, ink);
        } else if (pattern == 'bubbles') {
          canvas.drawCircle(Offset(x, y), 8, ink);
        } else {
          canvas.drawCircle(Offset(x, y), ((x + y) ~/ gap).isEven ? 2.5 : 4, ink);
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _WallpaperPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.pattern != pattern;
}
