import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

export type McpConnectionInput = {
  endpoint: string;
  bearerToken?: string;
  authProvider?: OAuthClientProvider;
};

async function connectedClient<T>(input: McpConnectionInput, operation: (client: Client) => Promise<T>) {
  const safe = await validateProviderBaseUrl(input.endpoint);
  const client = new Client({ name: "moataz-agent-platform", version: "2.0.0" }, { capabilities: {} });
  const headers = input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(safe.normalizedUrl), {
    authProvider: input.authProvider,
    requestInit: headers ? { headers } : undefined,
    reconnectionOptions: {
      initialReconnectionDelay: 500,
      maxReconnectionDelay: 4_000,
      reconnectionDelayGrowFactor: 1.8,
      maxRetries: 1,
    },
  });
  try {
    await client.connect(transport, { timeout: 12_000 });
    return await operation(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function discoverMcpServer(input: McpConnectionInput) {
  return connectedClient(input, async (client) => {
    const tools = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const listing = await client.listTools(cursor ? { cursor } : undefined, { timeout: 12_000 });
      tools.push(...listing.tools);
      cursor = listing.nextCursor;
      pages += 1;
      if (pages >= 100 && cursor) throw new Error("MCP_TOOL_PAGINATION_LIMIT");
    } while (cursor);
    return {
      server: client.getServerVersion() ?? null,
      capabilities: client.getServerCapabilities() ?? {},
      tools,
    };
  });
}

export async function callRemoteMcpTool(input: McpConnectionInput & {
  name: string;
  arguments: Record<string, unknown>;
}) {
  return connectedClient(input, (client) => client.callTool({
    name: input.name,
    arguments: input.arguments,
  }, undefined, { timeout: 30_000 }));
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
