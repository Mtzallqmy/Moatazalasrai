# Authentication and tenant bootstrap

## Flow

1. `POST /api/auth/register` creates the user, the first organization, an owner membership, an audit event, and a database-backed session.
2. The browser receives the opaque session token only in an `HttpOnly`, `SameSite=Lax` cookie.
3. PostgreSQL stores only a SHA-256 hash of the session token.
4. `POST /api/auth/login` verifies the scrypt-derived password hash and creates a new session.
5. `POST /api/auth/logout` revokes the current database session and clears the cookie.
6. `/dashboard` requires a valid non-expired, non-revoked session and resolves the user organization from membership records.

## Password storage

Passwords use Node.js `scrypt` with a random 16-byte salt and a 64-byte derived key. The stored value contains the algorithm marker, salt, and derived key. Plaintext passwords are never stored or logged.

## Production migration

Run:

```bash
npm run db:migrate
```

The additive migration is `drizzle/0002_auth_sessions.sql`.

## Security properties

- Session values are never stored in LocalStorage.
- Session tokens are never stored in plaintext in PostgreSQL.
- Cookies are `Secure` in production, `HttpOnly`, scoped to `/`, and `SameSite=Lax`.
- Dashboard data is filtered by the organization resolved from the authenticated membership.
- Registration and login produce audit records without passwords or tokens.
