import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

export type McpConnectionInput = {
  endpoint: string;
  bearerToken?: string;
  authProvider?: OAuthClientProvider;
};

type ToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  icons?: Array<Record<string, unknown>>;
  _meta?: Record<string, unknown>;
};

type ResourceDescriptor = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: Record<string, unknown>;
  icons?: Array<Record<string, unknown>>;
  _meta?: Record<string, unknown>;
};

type ResourceTemplateDescriptor = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: Record<string, unknown>;
  icons?: Array<Record<string, unknown>>;
  _meta?: Record<string, unknown>;
};

type PromptDescriptor = {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<Record<string, unknown>>;
  icons?: Array<Record<string, unknown>>;
  _meta?: Record<string, unknown>;
};

const DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_PAGES = 250;

async function connectedClient<T>(input: McpConnectionInput, operation: (client: Client) => Promise<T>) {
  const safe = await validateProviderBaseUrl(input.endpoint);
  const client = new Client({ name: "moataz-agent-platform", version: "2.1.0" }, { capabilities: {} });
  const headers = input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(safe.normalizedUrl), {
    authProvider: input.authProvider,
    requestInit: headers ? { headers } : undefined,
    reconnectionOptions: {
      initialReconnectionDelay: 500,
      maxReconnectionDelay: 4_000,
      reconnectionDelayGrowFactor: 1.8,
      maxRetries: 2,
    },
  });
  try {
    await client.connect(transport, { timeout: DISCOVERY_TIMEOUT_MS });
    return await operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function collectPages<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>) {
  const items: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    pages += 1;
    if (pages >= MAX_PAGES && cursor) throw new Error("MCP_CATALOG_PAGINATION_LIMIT");
  } while (cursor);
  return items;
}

export async function discoverMcpServer(input: McpConnectionInput) {
  return connectedClient(input, async (client) => {
    const capabilities = client.getServerCapabilities() ?? {};
    const discoveryErrors: string[] = [];

    const tools = capabilities.tools
      ? await collectPages<ToolDescriptor>(async (cursor) => {
          const listing = await client.listTools(cursor ? { cursor } : undefined, { timeout: DISCOVERY_TIMEOUT_MS });
          return { items: listing.tools as unknown as ToolDescriptor[], nextCursor: listing.nextCursor };
        }).catch(() => {
          discoveryErrors.push("MCP_TOOLS_DISCOVERY_FAILED");
          return [];
        })
      : [];

    const resources = capabilities.resources
      ? await collectPages<ResourceDescriptor>(async (cursor) => {
          const listing = await client.listResources(cursor ? { cursor } : undefined, { timeout: DISCOVERY_TIMEOUT_MS });
          return { items: listing.resources as unknown as ResourceDescriptor[], nextCursor: listing.nextCursor };
        }).catch(() => {
          discoveryErrors.push("MCP_RESOURCES_DISCOVERY_FAILED");
          return [];
        })
      : [];

    const resourceTemplates = capabilities.resources
      ? await collectPages<ResourceTemplateDescriptor>(async (cursor) => {
          const listing = await client.listResourceTemplates(cursor ? { cursor } : undefined, { timeout: DISCOVERY_TIMEOUT_MS });
          return { items: listing.resourceTemplates as unknown as ResourceTemplateDescriptor[], nextCursor: listing.nextCursor };
        }).catch(() => {
          discoveryErrors.push("MCP_RESOURCE_TEMPLATES_DISCOVERY_FAILED");
          return [];
        })
      : [];

    const prompts = capabilities.prompts
      ? await collectPages<PromptDescriptor>(async (cursor) => {
          const listing = await client.listPrompts(cursor ? { cursor } : undefined, { timeout: DISCOVERY_TIMEOUT_MS });
          return { items: listing.prompts as unknown as PromptDescriptor[], nextCursor: listing.nextCursor };
        }).catch(() => {
          discoveryErrors.push("MCP_PROMPTS_DISCOVERY_FAILED");
          return [];
        })
      : [];

    return {
      server: client.getServerVersion() ?? null,
      capabilities,
      tools,
      resources,
      resourceTemplates,
      prompts,
      discoveryErrors,
    };
  });
}

export async function callRemoteMcpTool(input: McpConnectionInput & {
  name: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}) {
  const timeout = Math.min(Math.max(input.timeoutMs ?? 120_000, 5_000), 15 * 60_000);
  return connectedClient(input, (client) => client.callTool({
    name: input.name,
    arguments: input.arguments,
  }, undefined, {
    timeout,
    resetTimeoutOnProgress: true,
    maxTotalTimeout: timeout,
  }));
}

export async function readRemoteMcpResource(input: McpConnectionInput & { uri: string }) {
  return connectedClient(input, (client) => client.readResource(
    { uri: input.uri },
    { timeout: 90_000, resetTimeoutOnProgress: true, maxTotalTimeout: 90_000 },
  ));
}

export async function getRemoteMcpPrompt(input: McpConnectionInput & {
  name: string;
  arguments?: Record<string, string>;
}) {
  return connectedClient(input, (client) => client.getPrompt({
    name: input.name,
    arguments: input.arguments,
  }, { timeout: 90_000, resetTimeoutOnProgress: true, maxTotalTimeout: 90_000 }));
}

export async function finishMcpOAuth(input: {
  endpoint: string;
  authProvider: OAuthClientProvider;
  authorizationCode: string;
}) {
  const safe = await validateProviderBaseUrl(input.endpoint);
  const transport = new StreamableHTTPClientTransport(new URL(safe.normalizedUrl), {
    authProvider: input.authProvider,
  });
  try {
    await transport.finishAuth(input.authorizationCode);
  } finally {
    await transport.close().catch(() => undefined);
  }
}
