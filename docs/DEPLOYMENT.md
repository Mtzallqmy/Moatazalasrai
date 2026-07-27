# Production deployment

## Required environment variables

- `DATABASE_URL`: PostgreSQL connection string. Neon is recommended.
- `CREDENTIAL_ENCRYPTION_KEY`: base64-encoded 32-byte AES key. Generate with `openssl rand -base64 32`.
- `BOOTSTRAP_ADMIN_TOKEN`: long random token used only to create the first organization and platform API key.
- `NODE_ENV=production`
- `NEXT_TELEMETRY_DISABLED=1`

Never expose provider API keys as deployment variables for individual tenants. Store them through `/api/v1/provider-credentials`; they are encrypted before persistence.

## Railway

1. Create a Railway project and connect this repository/branch.
2. Add a PostgreSQL service or use a Neon database.
3. Configure all required environment variables.
4. Railway uses the repository `Dockerfile` through `railway.json`.
5. Deploy, then verify `GET /api/health`.
6. Run migrations from a one-off shell: `npm run db:migrate`.
7. Bootstrap the first tenant once:

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/bootstrap \
  -H 'content-type: application/json' \
  -H 'x-bootstrap-token: YOUR_BOOTSTRAP_ADMIN_TOKEN' \
  -d '{"name":"Primary organization","slug":"primary"}'
```

Save the returned `apiKey.value`; it is shown once. Rotate or remove `BOOTSTRAP_ADMIN_TOKEN` after initialization.

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

Run migrations before serving production traffic. Use a managed secret store for the encryption and bootstrap keys, enforce HTTPS, restrict database networking, and configure backups and alerts.
