import { notFound } from "next/navigation";
import { ExecutionKernelConsole } from "@/components/execution-kernel-console";
import { requireSession } from "@/lib/auth/authorization";
import { loadCustomPermissions } from "@/lib/auth/custom-permissions";
import { can } from "@/lib/auth/permissions";
import { listExecutions } from "@/lib/execution/repository";
import { executionKernelEnabled } from "@/lib/execution/runner-registry";

export const dynamic = "force-dynamic";

export default async function ExecutionsPage() {
  if (!executionKernelEnabled()) notFound();
  const session = await requireSession("executions:read");
  const customPermissions = await loadCustomPermissions(session.organizationId, session.userId);
  const canRun = can(session.role, "executions:run") || customPermissions.includes("executions:run");
  const initial = await listExecutions({
    actor: { organizationId: session.organizationId, userId: session.userId, role: session.role },
    page: 1,
    limit: 25,
  });
  return <ExecutionKernelConsole initialJobs={initial.rows} canRun={canRun} />;
}
