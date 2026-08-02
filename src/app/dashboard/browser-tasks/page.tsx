import { BrowserTasksManager } from "@/components/browser-tasks-manager";
import { requireSession } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function BrowserTasksPage() {
  await requireSession("browser_tasks:read");
  return <BrowserTasksManager />;
}
