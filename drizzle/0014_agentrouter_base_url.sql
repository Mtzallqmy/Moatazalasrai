UPDATE "provider_credentials"
SET
  "base_url" = 'https://co.agentrouter.org/v1',
  "updated_at" = now()
WHERE "provider" = 'openai_compatible'
  AND lower(trim(trailing '/' from "base_url")) IN (
    'https://agentrouter.org',
    'https://agentrouter.org/v1',
    'https://www.agentrouter.org',
    'https://www.agentrouter.org/v1',
    'https://co.agentrouter.org'
  );
