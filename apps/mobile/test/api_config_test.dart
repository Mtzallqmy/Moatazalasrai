import 'package:flutter_test/flutter_test.dart';
import 'package:moataz_ai_mobile/src/core/api_config.dart';

void main() {
  test('production API endpoint uses HTTPS and has no trailing slash', () {
    final uri = Uri.parse(ApiConfig.baseUrl);
    expect(uri.scheme, 'https');
    expect(uri.host, isNotEmpty);
    expect(ApiConfig.baseUrl.endsWith('/'), isFalse);
  });
}
