import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { ApiError } from "@/lib/http/api";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

async function migrateLegacyPassword(email: string, password: string) {
  const [legacy] = await db().select({ id: users.id, passwordHash: users.passwordHash, supabaseUserId: users.supabaseUserId })
    .from(users).where(eq(users.email, email)).limit(1);
  if (!legacy?.passwordHash || !(await verifyPassword(password, legacy.passwordHash))) return false;

  const admin = createSupabaseAdminClient();
  if (legacy.supabaseUserId) {
    const { error } = await admin.auth.admin.updateUserById(legacy.supabaseUserId, { password, email_confirm: true });
    if (error) throw new ApiError(502, "AUTH_MIGRATION_FAILED", "تعذر تحديث هوية المصادقة الحالية.");
    return true;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    throw new ApiError(409, "AUTH_MIGRATION_REQUIRES_LINK", "يوجد حساب مصادقة سابق بهذا البريد. ادخل بواسطة Google أو اطلب من المالك ربطه.");
  }
  await db().update(users).set({ supabaseUserId: data.user.id, authLinkedAt: new Date(), emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, legacy.id));
  return true;
}

export async function signInWithSupabasePassword(email: string, password: string) {
  const supabase = await createSupabaseServerClient();
  let result = await supabase.auth.signInWithPassword({ email, password });
  if (result.error && await migrateLegacyPassword(email, password)) {
    result = await supabase.auth.signInWithPassword({ email, password });
  }
  if (result.error || !result.data.user || !result.data.session) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "بيانات الدخول غير صحيحة.");
  }
  return result.data;
}
