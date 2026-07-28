import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformApiKeys } from "@/db/schema";
import { hashApiKey } from "@/lib/security/encryption";

export type ApiPrincipal = {
  organizationId: string;
  apiKeyId: string;
};

export async function authenticateApiKey(request: Request): Promise<ApiPrincipal | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) return null;

  const [key] = await db()
    .select()
    .from(platformApiKeys)
    .where(eq(platformApiKeys.keyHash, hashApiKey(token)))
    .limit(1);

  if (!key || key.revoked) return null;
  await db().update(platformApiKeys).set({ lastUsedAt: new Date() }).where(eq(platformApiKeys.id, key.id));
  return { organizationId: key.organizationId, apiKeyId: key.id };
}

export function bootstrapAuthorized(request: Request): boolean {
  const configured = process.env.BOOTSTRAP_ADMIN_TOKEN;
  const supplied = request.headers.get("x-bootstrap-token");
  return Boolean(configured && supplied && configured === supplied);
}
