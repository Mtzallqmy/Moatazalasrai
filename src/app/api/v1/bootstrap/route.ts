import { randomBytes } from "node:crypto";
import { auditLogs, organizations, platformApiKeys } from "@/db/schema";
import { ALL_API_SCOPES } from "@/lib/auth/api-key";
import { withConsumedBootstrapToken } from "@/lib/auth/bootstrap";
import { ApiError, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { platformBootstrapSchema } from "@/lib/http/contracts";
import { hashApiKey } from "@/lib/security/encryption";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await parseJson(request, platformBootstrapSchema, 8 * 1024);
    const rawKey = `map_${randomBytes(32).toString("base64url")}`;
    const { organization, apiKey } = await withConsumedBootstrapToken({
      request,
      requestId,
      operation: async (tx) => {
        const [organization] = await tx.insert(organizations).values({ name: body.name, slug: body.slug }).returning();
        if (!organization) throw new Error("ORGANIZATION_CREATE_FAILED");
        const [apiKey] = await tx.insert(platformApiKeys).values({
          organizationId: organization.id,
          name: "Initial administrator key",
          keyHash: hashApiKey(rawKey),
          keyPrefix: rawKey.slice(0, 12),
          scopes: [...ALL_API_SCOPES],
        }).returning();
        if (!apiKey) throw new Error("API_KEY_CREATE_FAILED");
        await tx.insert(auditLogs).values([
          {
            organizationId: organization.id,
            actorType: "bootstrap",
            action: "bootstrap.token.consumed",
            resourceType: "bootstrap_token",
            resourceId: "admin",
            metadata: { requestId, endpoint: "/api/v1/bootstrap" },
          },
          {
            organizationId: organization.id,
            actorType: "bootstrap",
            action: "organization.created",
            resourceType: "organization",
            resourceId: organization.id,
            metadata: { requestId },
          },
        ]);
        return { organization, apiKey };
      },
    });
    return apiSuccess({ organization, apiKey: { id: apiKey.id, value: rawKey } }, requestId, 201);
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes("duplicate key") ||
      error.message.includes("unique constraint")
    )) {
      error = new ApiError(409, "ORGANIZATION_SLUG_EXISTS", "معرّف المؤسسة مستخدم بالفعل.");
    }
    return handleApiError(error, requestId, "/api/v1/bootstrap");
  }
}
