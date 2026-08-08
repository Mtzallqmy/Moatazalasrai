import { SandboxConsole } from "@/components/sandbox-console";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireSession } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function SandboxPage({ searchParams }: { searchParams: Promise<{ conversationId?: string }> }) {
  const session = await requireSession("sandbox:read");
  const { conversationId } = await searchParams;
  return (
    <DashboardShell session={session} activePath="/dashboard/sandbox" title="Sandbox" description="مساحات تنفيذ معزولة وملفات وأحداث مباشرة مع تحكم واضح في دورة التشغيل.">
      <SandboxConsole conversationId={conversationId} />
    </DashboardShell>
  );
}
