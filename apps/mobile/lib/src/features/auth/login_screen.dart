import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:moataz_ai_mobile/src/features/auth/auth_repository.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  List<Map<String, dynamic>> _organizations = const [];
  String? _organizationId;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    try {
      final organizations = await ref.read(authStateProvider.notifier).login(
        _email.text,
        _password.text,
        organizationId: _organizationId,
      );
      if (!mounted || organizations == null) return;
      setState(() {
        _organizations = organizations;
        _organizationId = organizations.isNotEmpty ? organizations.first['id'] as String : null;
      });
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final loading = ref.watch(authStateProvider).isLoading;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const CircleAvatar(
                          radius: 28,
                          backgroundColor: Color(0xFFE9EFFF),
                          foregroundColor: Color(0xFF245BFF),
                          child: Icon(Icons.hub_outlined, size: 28),
                        ),
                        const SizedBox(height: 18),
                        Text('تسجيل الدخول إلى معتز AI', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 8),
                        Text('تطبيق أصلي يتصل بالمنصة عبر API آمن.', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFF5E6B7C))),
                        const SizedBox(height: 24),
                        TextFormField(
                          controller: _email,
                          textDirection: TextDirection.ltr,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(labelText: 'البريد الإلكتروني', prefixIcon: Icon(Icons.alternate_email)),
                          validator: (value) => value != null && value.contains('@') ? null : 'أدخل بريداً صحيحاً',
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _password,
                          obscureText: true,
                          textDirection: TextDirection.ltr,
                          decoration: const InputDecoration(labelText: 'كلمة المرور', prefixIcon: Icon(Icons.lock_outline)),
                          validator: (value) => (value?.length ?? 0) >= 8 ? null : 'كلمة المرور قصيرة',
                        ),
                        if (_organizations.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          DropdownButtonFormField<String>(
                            initialValue: _organizationId,
                            decoration: const InputDecoration(labelText: 'مساحة العمل', prefixIcon: Icon(Icons.business_outlined)),
                            items: _organizations.map((organization) => DropdownMenuItem(
                              value: organization['id'] as String,
                              child: Text(organization['name'] as String),
                            )).toList(),
                            onChanged: (value) => setState(() => _organizationId = value),
                          ),
                        ],
                        const SizedBox(height: 20),
                        FilledButton.icon(
                          onPressed: loading ? null : _submit,
                          icon: loading
                              ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.login),
                          label: Text(_organizations.isEmpty ? 'متابعة' : 'دخول إلى مساحة العمل'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
