import { eq } from "drizzle-orm";
import { DashboardShell } from "@/components/dashboard-shell";
import { ContentManager } from "@/components/content-manager";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can, type Permission } from "@/lib/auth/permissions";
import { requireModuleActive } from "@/lib/control-plane/modules";

export default async function ContentPage() {
  const session = await requireSession("content:read");
  await requireModuleActive(session.organizationId, "content_management");
  const customPermissions = await loadCustomPermissions(session.organizationId, session.userId);
  const allowed = (permission: Permission) => can(session.role, permission) || customPermissions.includes(permission);
  const [organization] = await db().select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, session.organizationId))
    .limit(1);

  return (
    <DashboardShell
      session={session}
      activePath="/dashboard/content"
      title="إدارة المحتوى والصفحات"
      description="إنشاء صفحات وأقسام وخدمات وقوائم منظمة، مع نشر آمن وإصدارات قابلة للاسترجاع وحذف ناعم."
    >
      <ContentManager
        organizationSlug={organization?.slug ?? "platform"}
        canManage={allowed("content:manage")}
        canPublish={allowed("content:publish")}
        canManageServices={allowed("services:manage")}
        canManageMenus={allowed("menus:manage")}
        canPurge={allowed("trash:manage")}
      />
    </DashboardShell>
  );
}
