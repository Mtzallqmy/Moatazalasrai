import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

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
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
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
              const CircleAvatar(backgroundColor: Color(0xFFE9EFFF), child: Icon(Icons.smart_toy_outlined, color: Color(0xFF245BFF))),
              const SizedBox(width: 10),
              Expanded(child: Text(widget.agent['name'] as String, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
              IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
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
                          color: user ? const Color(0xFFE9EFFF) : Colors.white,
                          border: Border.all(color: const Color(0xFFDDE4ED)),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Text(message['content'] as String? ?? ''),
                      ),
                    );
                  },
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
