import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { validateProviderBaseUrl } from "@/lib/security/provider-network";

export type McpConnectionInput = {
  endpoint: string;
  bearerToken?: string;
};

async function connectedClient<T>(input: McpConnectionInput, operation: (client: Client) => Promise<T>) {
  const safe = await validateProviderBaseUrl(input.endpoint);
  const client = new Client({ name: "moataz-agent-platform", version: "2.0.0" }, { capabilities: {} });
  const headers = input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(safe.normalizedUrl), {
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
    const listing = await client.listTools(undefined, { timeout: 12_000 });
    return {
      server: client.getServerVersion() ?? null,
      capabilities: client.getServerCapabilities() ?? {},
      tools: listing.tools,
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
