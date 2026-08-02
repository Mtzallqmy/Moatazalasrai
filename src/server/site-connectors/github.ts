import { z } from "zod";
import {
  listGitHubRepositories,
  readGitHubFile,
  verifyGitHubToken,
} from "@/lib/integrations/github";
import { ApiError } from "@/lib/http/api";
import type {
  ConnectorActionDefinition,
  SiteConnector,
} from "@/server/site-connectors/types";

const credentialSchema = z.object({
  token: z.string().trim().min(8).max(8_000),
}).strict();

const listRepositoriesInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

const readFileInput = z.object({
  owner: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  repo: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  path: z.string().trim().min(1).max(1_000),
  ref: z.string().trim().min(1).max(255).optional(),
}).strict();

const actions: readonly ConnectorActionDefinition[] = [
  {
    id: "list_repositories",
    displayName: "عرض المستودعات",
    inputSchema: listRepositoriesInput,
    risk: "low",
    requiredPermission: "read",
    approval: "never",
    timeoutMs: 20_000,
    verifyResult: (result) => Array.isArray(result),
  },
  {
    id: "read_file",
    displayName: "قراءة ملف من مستودع",
    inputSchema: readFileInput,
    risk: "low",
    requiredPermission: "read",
    approval: "never",
    timeoutMs: 20_000,
    verifyResult: (result) => Boolean(result && typeof result === "object" && "path" in result),
  },
];

export const githubSiteConnector: SiteConnector = {
  id: "github",
  displayName: "GitHub",
  type: "api",
  async validateConnection(input) {
    const { token } = credentialSchema.parse(input);
    const identity = await verifyGitHubToken(token);
    return {
      status: "verified",
      metadata: {
        login: identity.login,
        accountName: identity.name ?? null,
        accountId: identity.id,
      },
      grantedScopes: [],
      allowedDomains: ["github.com", "api.github.com"],
    };
  },
  getAvailableActions() {
    return actions;
  },
  async executeAction(context, request) {
    const { token } = credentialSchema.parse(context.credentials);
    const definition = actions.find((candidate) => candidate.id === request.action);
    if (!definition) {
      throw new ApiError(400, "CONNECTOR_ACTION_UNKNOWN", "العملية غير مدعومة بواسطة موصل GitHub.");
    }
    const input = definition.inputSchema.parse(request.input);

    let data: unknown;
    if (request.action === "list_repositories") {
      data = await listGitHubRepositories(token, (input as z.infer<typeof listRepositoriesInput>).limit);
    } else if (request.action === "read_file") {
      const parsed = input as z.infer<typeof readFileInput>;
      data = await readGitHubFile(token, parsed.owner, parsed.repo, parsed.path, parsed.ref);
    } else {
      throw new ApiError(400, "CONNECTOR_ACTION_UNKNOWN", "العملية غير مدعومة بواسطة موصل GitHub.");
    }

    return {
      data,
      verified: definition.verifyResult(data),
      metadata: { connector: "github", action: request.action },
    };
  },
};
