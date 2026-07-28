# Production deployment

## Required environment variables

- `NODE_ENV=production`
- `PORT`: Railway normally supplies this automatically.
- `APP_URL`: the public HTTPS application URL.
- `DATABASE_URL`: PostgreSQL connection string. A Neon pooled URL is supported.
- `CREDENTIAL_ENCRYPTION_KEY`: base64-encoded 32-byte AES key. Generate with `openssl rand -base64 32`.
- `BOOTSTRAP_ADMIN_TOKEN`: long random token used only to create the first organization and platform API key.
- `LOG_LEVEL=info`
- `NEXT_TELEMETRY_DISABLED=1`

Optional observability variables are documented in `.env.example`.

Never expose tenant provider API keys as deployment variables. Store them through `/api/v1/provider-credentials`; the server encrypts them before persistence and never returns the plaintext value.

## Railway release sequence

1. Connect the repository and select the intended branch.
2. Configure the required environment variables.
3. Confirm the service uses `railway.json` and the repository `Dockerfile`.
4. Run `npm run db:migrate` from a Railway one-off shell before promoting a release that depends on a new migration.
5. Deploy the service.
6. Verify liveness at `GET /api/health`.
7. Verify readiness and database connectivity at `GET /api/ready`.
8. Expose a Railway public domain only after readiness succeeds.

Railway is configured to use `/api/ready` as its health check. A deployment remains unhealthy when PostgreSQL is unavailable or required runtime configuration is invalid.

## Bootstrap the first tenant

Run this once after migrations and the first healthy deployment:

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/bootstrap \
  -H 'content-type: application/json' \
  -H 'x-bootstrap-token: YOUR_BOOTSTRAP_ADMIN_TOKEN' \
  -d '{"name":"Primary organization","slug":"primary"}'
```

Save the returned `apiKey.value`; it is displayed once. Rotate or remove `BOOTSTRAP_ADMIN_TOKEN` after initialization.

## Add a provider credential

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/provider-credentials \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_PLATFORM_API_KEY' \
  -d '{"provider":"openai","name":"Production OpenAI","apiKey":"PROVIDER_KEY"}'
```

Supported provider values are `openai`, `anthropic`, and `gemini`.

## Create and publish an agent

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/agents \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_PLATFORM_API_KEY' \
  -d '{
    "name":"Support agent",
    "providerCredentialId":"CREDENTIAL_UUID",
    "model":"PROVIDER_MODEL_ID",
    "instructions":"You are a reliable customer support agent.",
    "publish":true
  }'
```

## Run an agent

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/runs \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_PLATFORM_API_KEY' \
  -d '{"agentId":"AGENT_UUID","input":"Summarize our support policy."}'
```

## Generic Docker host

```bash
docker build -t moataz-agent-platform .
docker run --rm -p 3000:3000 --env-file .env moataz-agent-platform
```

Verify:

```bash
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3000/api/ready
```

## Operational safeguards

- Use a managed secret store for encryption and bootstrap keys.
- Do not rotate `CREDENTIAL_ENCRYPTION_KEY` without a re-encryption procedure for existing credentials.
- Restrict database networking, enable backups, and configure alerts.
- Apply migrations once per release; do not run them concurrently from every replica.
- Keep at least one known-good deployment available for rollback.
- Require CI to pass before merging production changes.
