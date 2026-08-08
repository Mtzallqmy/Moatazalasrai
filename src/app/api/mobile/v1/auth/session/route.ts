import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { mobileMe, mobileOrganizations } from "@/lib/auth/mobile";
import { ensureLocalIdentity, supabaseSessionIdFromAccessToken, upsertSupabaseAppSession } from "@/lib/auth/supabase-identity";
import { setActiveOrganization } from "@/lib/auth/session";
import { apiSuccess, ApiError, getRequestId, handleApiError } from "@/lib/http/api";
import { createSupabaseBearerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!accessToken) throw new ApiError(401, "UNAUTHORIZED", "رمز Supabase مطلوب.");
    const supabase = createSupabaseBearerClient(accessToken);
    const { data: claimsResult, error: claimsError } = await supabase.auth.getClaims(accessToken);
    const subject = typeof claimsResult?.claims?.sub === "string" ? claimsResult.claims.sub : null;
    const exp = typeof claimsResult?.claims?.exp === "number" ? claimsResult.claims.exp : null;
    if (claimsError || !subject || !exp) throw new ApiError(401, "UNAUTHORIZED", "رمز Supabase غير صالح أو انتهت صلاحيته.");
    let [local] = await db().select({ id: users.id }).from(users).where(eq(users.supabaseUserId, subject)).limit(1);
    if (!local) {
      const { data: verified, error } = await supabase.auth.getUser(accessToken);
      if (error || !verified.user || verified.user.id !== subject) throw new ApiError(401, "UNAUTHORIZED", "تعذر التحقق من هوية المستخدم.");
      local = await ensureLocalIdentity(verified.user);
    }
    const organizations = await mobileOrganizations(local.id);
    if (organizations.length === 0) throw new ApiError(403, "ACCOUNT_ACCESS_EXPIRED", "لا توجد عضوية نشطة لهذا الحساب.");
    const requestedId = request.headers.get("x-organization-id")?.trim();
    const selected = requestedId ? organizations.find((item) => item.id === requestedId) : organizations.length === 1 ? organizations[0] : null;
    if (!selected) return apiSuccess({ organizationSelectionRequired: true, organizations, authenticationSource: "supabase" }, requestId, 409);
    const appSession = await upsertSupabaseAppSession({ userId: local.id, supabaseSessionId: supabaseSessionIdFromAccessToken(accessToken), expiresAt: new Date(exp * 1000), userAgent: request.headers.get("user-agent") ?? undefined });
    if (appSession.activeOrganizationId !== selected.id) await setActiveOrganization(local.id, appSession.id, selected.id);
    const identity = await mobileMe(local.id, selected.id);
    if (!identity) throw new ApiError(403, "ACCOUNT_ACCESS_EXPIRED", "انتهت صلاحية العضوية.");
    return apiSuccess({
      user: { id: identity.id, email: identity.email, name: identity.name },
      organization: { id: identity.organizationId, name: identity.organizationName, role: identity.role, expiresAt: identity.expiresAt },
      organizations,
      authenticationSource: "supabase",
    }, requestId);
  } catch (error) { return handleApiError(error, requestId, "/api/mobile/v1/auth/session"); }
}
