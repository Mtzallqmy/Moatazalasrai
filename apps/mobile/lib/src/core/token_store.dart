import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;
}

class TokenStore {
  TokenStore(this._storage);
  final FlutterSecureStorage _storage;

  static const _accessKey = 'moataz_access_token';
  static const _refreshKey = 'moataz_refresh_token';
  static const _deviceKey = 'moataz_device_id';

  Future<String> deviceId() async {
    final existing = await _storage.read(key: _deviceKey);
    if (existing != null) return existing;
    final created = const Uuid().v4();
    await _storage.write(key: _deviceKey, value: created);
    return created;
  }

  Future<TokenPair?> read() async {
    final access = await _storage.read(key: _accessKey);
    final refresh = await _storage.read(key: _refreshKey);
    if (access == null || refresh == null) return null;
    return TokenPair(accessToken: access, refreshToken: refresh);
  }

  Future<void> write(TokenPair pair) async {
    await Future.wait([
      _storage.write(key: _accessKey, value: pair.accessToken),
      _storage.write(key: _refreshKey, value: pair.refreshToken),
    ]);
  }

  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _accessKey),
      _storage.delete(key: _refreshKey),
    ]);
  }
}
