import { SandboxConsole } from "@/components/sandbox-console";
import { requireSession } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function SandboxPage({ searchParams }: { searchParams: Promise<{ conversationId?: string }> }) {
  await requireSession("sandbox:read");
  const { conversationId } = await searchParams;
  return <SandboxConsole conversationId={conversationId} />;
}
