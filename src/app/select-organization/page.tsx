import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { OrganizationPicker } from "@/components/organization-picker";
import { db } from "@/db";
import { organizationMembers, organizations } from "@/db/schema";
import { currentSession } from "@/lib/auth/session";

export default async function SelectOrganizationPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.organizationId) redirect("/dashboard");
  const rows = await db().select({
    id: organizations.id,
    name: organizations.name,
    slug: organizations.slug,
    role: organizationMembers.role,
  }).from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.userId))
    .orderBy(asc(organizations.name));

  return (
    <main className="app-shell grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-xl">
        <div className="mb-6 text-center"><h1 className="text-3xl font-black">اختر المؤسسة النشطة</h1><p className="mt-2 text-sm text-stone-400">لن نختار أول عضوية بصورة عشوائية. يُحفظ اختيارك داخل الجلسة الآمنة.</p></div>
        {rows.length > 0 ? <OrganizationPicker organizations={rows} /> : <p className="soft-card p-8 text-center text-sm text-stone-400">لا توجد عضوية مؤسسة لهذا الحساب.</p>}
      </section>
    </main>
  );
}
