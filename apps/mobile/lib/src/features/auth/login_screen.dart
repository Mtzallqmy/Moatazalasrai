import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:moataz_ai_mobile/src/core/api_client.dart';
import 'package:moataz_ai_mobile/src/core/brand_config.dart';
import 'package:moataz_ai_mobile/src/features/auth/auth_repository.dart';
import 'package:moataz_ai_mobile/src/widgets/brand_mark.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  List<Map<String, dynamic>> _organizations = const [];
  String? _organizationId;
  bool _register = false;
  bool _rememberSession = true;
  bool _showPassword = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    try {
      if (_register) {
        await ref.read(authStateProvider.notifier).register(
          name: _name.text,
          email: _email.text,
          password: _password.text,
          rememberSession: _rememberSession,
        );
        return;
      }
      final organizations = await ref.read(authStateProvider.notifier).login(
        _email.text,
        _password.text,
        rememberSession: _rememberSession,
        organizationId: _organizationId,
      );
      if (!mounted || organizations == null) return;
      setState(() {
        _organizations = organizations;
        _organizationId = organizations.isNotEmpty ? organizations.first['id'] as String : null;
      });
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiClient.userMessage(error))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final loading = ref.watch(authStateProvider).isLoading;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                children: [
                  const BrandMark(size: 68, showWordmark: true),
                  const SizedBox(height: 20),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(22),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            SegmentedButton<bool>(
                              segments: const [
                                ButtonSegment(value: false, label: Text('تسجيل الدخول'), icon: Icon(Icons.login)),
                                ButtonSegment(value: true, label: Text('حساب جديد'), icon: Icon(Icons.person_add_alt_1)),
                              ],
                              selected: {_register},
                              onSelectionChanged: loading || _organizations.isNotEmpty
                                  ? null
                                  : (value) => setState(() => _register = value.first),
                            ),
                            const SizedBox(height: 20),
                            Text(
                              _register ? 'ابدأ كعضو في مساحة العمل' : 'مرحبًا بعودتك',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _register
                                  ? 'يُنشأ الحساب بصلاحيات عضو، ويمكن للمدير ترقيته لاحقًا.'
                                  : 'جلسة API أصلية ومشفّرة، دون WebView.',
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Color(0xFF607178)),
                            ),
                            if (_register) ...[
                              const SizedBox(height: 18),
                              TextFormField(
                                controller: _name,
                                decoration: const InputDecoration(labelText: 'الاسم', prefixIcon: Icon(Icons.person_outline)),
                                validator: (value) => (value?.trim().length ?? 0) >= 2 ? null : 'أدخل الاسم',
                              ),
                            ],
                            const SizedBox(height: 14),
                            TextFormField(
                              controller: _email,
                              textDirection: TextDirection.ltr,
                              keyboardType: TextInputType.emailAddress,
                              decoration: const InputDecoration(labelText: 'البريد الإلكتروني', prefixIcon: Icon(Icons.alternate_email)),
                              validator: (value) => value != null && value.contains('@') ? null : 'أدخل بريدًا صحيحًا',
                            ),
                            const SizedBox(height: 14),
                            TextFormField(
                              controller: _password,
                              obscureText: !_showPassword,
                              textDirection: TextDirection.ltr,
                              decoration: InputDecoration(
                                labelText: 'كلمة المرور',
                                prefixIcon: const Icon(Icons.lock_outline),
                                suffixIcon: IconButton(
                                  tooltip: _showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور',
                                  onPressed: () => setState(() => _showPassword = !_showPassword),
                                  icon: Icon(_showPassword ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                                ),
                              ),
                              validator: (value) => (value?.length ?? 0) >= (_register ? 12 : 8)
                                  ? null
                                  : _register ? 'استخدم 12 حرفًا على الأقل' : 'كلمة المرور قصيرة',
                            ),
                            if (_register) ...[
                              const SizedBox(height: 14),
                              TextFormField(
                                controller: _confirmPassword,
                                obscureText: !_showPassword,
                                textDirection: TextDirection.ltr,
                                decoration: const InputDecoration(labelText: 'تأكيد كلمة المرور', prefixIcon: Icon(Icons.verified_user_outlined)),
                                validator: (value) => value == _password.text ? null : 'كلمتا المرور غير متطابقتين',
                              ),
                            ],
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
                            const SizedBox(height: 8),
                            SwitchListTile.adaptive(
                              contentPadding: EdgeInsets.zero,
                              value: _rememberSession,
                              title: const Text('ابقَ مسجّلًا'),
                              subtitle: const Text('استعادة الجلسة تلقائيًا على هذا الجهاز.'),
                              onChanged: loading ? null : (value) => setState(() => _rememberSession = value),
                            ),
                            const SizedBox(height: 12),
                            FilledButton.icon(
                              onPressed: loading ? null : _submit,
                              icon: loading
                                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                  : Icon(_register ? Icons.person_add_alt_1 : Icons.login),
                              label: Text(_register ? 'إنشاء الحساب والدخول' : _organizations.isEmpty ? 'متابعة' : 'دخول إلى مساحة العمل'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 22),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 6,
                    children: socialLinks.map((item) => IconButton(
                      tooltip: item.url.isEmpty ? '${item.label} — الرابط غير مضاف بعد' : item.label,
                      onPressed: item.url.isEmpty ? null : () {},
                      icon: FaIcon(item.icon, size: 20),
                    )).toList(),
                  ),
                  const SizedBox(height: 8),
                  const Text('برمجة وتطوير معتز العلقمي', style: TextStyle(fontWeight: FontWeight.w700)),
                  const Text('2026 م', style: TextStyle(color: Color(0xFF607178))),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
