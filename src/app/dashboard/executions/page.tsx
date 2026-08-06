import { notFound } from "next/navigation";
import { ExecutionKernelConsole } from "@/components/execution-kernel-console";
import { requireSession } from "@/lib/auth/authorization";
import { executionKernelEnabled } from "@/lib/execution/runner-registry";

export const dynamic = "force-dynamic";

export default async function ExecutionsPage() {
  if (!executionKernelEnabled()) notFound();
  await requireSession("executions:read");
  return <ExecutionKernelConsole />;
}
