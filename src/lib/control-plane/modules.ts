import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { platformModules } from "@/db/control-plane-schema";
import { ApiError } from "@/lib/http/api";

export async function moduleStatus(organizationId: string, key: string) {
  const [module] = await db().select({ status: platformModules.status })
    .from(platformModules)
    .where(and(
      eq(platformModules.organizationId, organizationId),
      eq(platformModules.key, key),
      isNull(platformModules.deletedAt),
    ))
    .limit(1);
  return module?.status ?? "disabled";
}

export async function isModuleActive(organizationId: string, key: string) {
  return (await moduleStatus(organizationId, key)) === "active";
}

export async function requireModuleActive(organizationId: string, key: string) {
  if (!(await isModuleActive(organizationId, key))) {
    throw new ApiError(403, "MODULE_DISABLED", "هذه الوحدة معطلة أو مخفية داخل المؤسسة الحالية.");
  }
}
