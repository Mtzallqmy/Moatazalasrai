from pathlib import Path


def replace_once(path: str, old: str, new: str, required: bool = True):
    file = Path(path)
    text = file.read_text()
    if old not in text:
        if required:
            raise RuntimeError(f"Missing patch anchor in {path}: {old[:120]!r}")
        return False
    file.write_text(text.replace(old, new, 1))
    return True


# Channel contracts and router imports.
replace_once(
    "src/db/channel-schema.ts",
    "    days: Record<string, Array<{ start: string; end: string }>>;\n  };",
    "    days: Record<string, Array<{ start: string; end: string }>>;\n  } | null;",
    required=False,
)
replace_once(
    "src/lib/channels/router.ts",
    "  channelContacts,\n  channelConversationLinks,",
    "  channelContacts,\n  channelConnections,\n  channelConversationLinks,",
    required=False,
)

# Telegram adapter typing and unused imports.
telegram = Path("src/lib/channels/telegram-adapter.ts")
text = telegram.read_text()
text = text.replace(
    "  ChannelAdapterContext,\n  ChannelIncomingAttachment,\n  ChannelIncomingMessage,\n",
    "  ChannelIncomingAttachment,\n",
)
text = text.replace(
    "      const bot = await verifyTelegramToken(context.credentials.token);",
    "      const bot = await verifyTelegramToken(context.credentials.token) as { id: string | number; first_name?: string; username?: string };",
)
telegram.write_text(text)

# Propagate the per-channel tool allowlist through the AI SDK runtime.
replace_once(
    "src/lib/ai-sdk/runtime.ts",
    "  runId: string;\n  allocateStep: () => number;\n}) {",
    "  runId: string;\n  allowedToolIds?: readonly string[] | null;\n  allocateStep: () => number;\n}) {",
    required=False,
)
replace_once(
    "src/lib/ai-sdk/runtime.ts",
    "    runId: input.runId,\n    state,\n  });",
    "    runId: input.runId,\n    allowedToolIds: input.allowedToolIds,\n    state,\n  });",
    required=False,
)
replace_once(
    "src/lib/ai-sdk/runtime.ts",
    "  resumeMessages?: ModelMessage[];\n  temperature: number;",
    "  resumeMessages?: ModelMessage[];\n  allowedToolIds?: readonly string[] | null;\n  temperature: number;",
    required=False,
)
replace_once(
    "src/lib/ai-sdk/runtime.ts",
    "  context: ProviderMessage[];\n  temperature: number;",
    "  context: ProviderMessage[];\n  allowedToolIds?: readonly string[] | null;\n  temperature: number;",
    required=False,
)

# Enforce channel tool policy before loading and executing agent MCP tools.
replace_once(
    "src/lib/agents/runtime.ts",
    'import { and, asc, count, desc, eq, isNull } from "drizzle-orm";',
    'import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";',
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "async function hasEnabledAgentTools(organizationId: string, agentId: string) {\n  const [row] = await db().select({ value: count() }).from(agentMcpTools)",
    "async function hasEnabledAgentTools(\n  organizationId: string,\n  agentId: string,\n  allowedToolIds?: readonly string[] | null,\n) {\n  if (allowedToolIds && allowedToolIds.length === 0) return false;\n  const [row] = await db().select({ value: count() }).from(agentMcpTools)",
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "      eq(agentMcpTools.agentId, agentId),\n      eq(mcpTools.organizationId, organizationId),",
    "      eq(agentMcpTools.agentId, agentId),\n      allowedToolIds ? inArray(agentMcpTools.toolId, [...allowedToolIds]) : undefined,\n      eq(mcpTools.organizationId, organizationId),",
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "  media?: ProviderContentPart[];\n}) {\n  const [agent]",
    "  media?: ProviderContentPart[];\n  allowedToolIds?: readonly string[] | null;\n}) {\n  const [agent]",
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "    hasEnabledAgentTools(input.organizationId, input.agentId),",
    "    hasEnabledAgentTools(input.organizationId, input.agentId, input.allowedToolIds),",
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "  media?: ProviderContentPart[];\n}) {\n  const requestId = input.requestId ?? crypto.randomUUID();",
    "  media?: ProviderContentPart[];\n  allowedToolIds?: readonly string[] | null;\n}) {\n  const requestId = input.requestId ?? crypto.randomUUID();",
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "          context: prepared.context,\n          temperature: prepared.version.temperatureMilli / 1000,",
    "          context: prepared.context,\n          allowedToolIds: input.allowedToolIds,\n          temperature: prepared.version.temperatureMilli / 1000,",
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "  media?: ProviderContentPart[];\n}) {\n  const prepared = await prepareAgentRun(input);",
    "  media?: ProviderContentPart[];\n  allowedToolIds?: readonly string[] | null;\n}) {\n  const prepared = await prepareAgentRun(input);",
    required=False,
)
replace_once(
    "src/lib/agents/runtime.ts",
    "          context: prepared.context,\n          temperature: prepared.version.temperatureMilli / 1000,\n          maxOutputTokens: prepared.version.maxOutputTokens,\n          abortSignal: controller.signal,\n          allocateStep,\n        })) {",
    "          context: prepared.context,\n          allowedToolIds: input.allowedToolIds,\n          temperature: prepared.version.temperatureMilli / 1000,\n          maxOutputTokens: prepared.version.maxOutputTokens,\n          abortSignal: controller.signal,\n          allocateStep,\n        })) {",
    required=False,
)

# Management UI required by the server-side channels page.
component = Path("src/components/channel-manager.tsx")
if not component.exists():
    component.write_text(r'''"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Named = { id: string; name: string };
type Connection = {
  id: string;
  kind: "telegram" | "whatsapp";
  name: string;
  displayAddress: string | null;
  status: string;
  enabled: boolean;
  webhookStatus: string;
  lastErrorCode: string | null;
  defaultAgentId: string | null;
  defaultProviderCredentialId: string | null;
  defaultModel: string | null;
  inboxId: string | null;
  workflowId: string | null;
  settings: Record<string, unknown>;
};
type Props = {
  canManage: boolean;
  canHandoff: boolean;
  options: {
    agents: Array<Named & { status: string }>;
    providers: Array<Named & { provider: string; models: unknown; enabled: boolean }>;
    tools: Array<Named & { title: string | null; risk: string }>;
    inboxes: Named[];
    workflows: Named[];
    members: Array<Named & { email: string; role: string }>;
  };
};

function unwrap(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return (record.data && typeof record.data === "object" ? record.data : record) as Record<string, unknown>;
}

export function ChannelManager({ canManage, canHandoff, options }: Props) {
  const [rows, setRows] = useState<Connection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard/channels", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message || "تعذر تحميل القنوات.");
    const connections = (unwrap(json).connections || []) as Connection[];
    setRows(connections);
    setSelectedId((current) => connections.some((row) => row.id === current) ? current : connections[0]?.id || "");
  }, []);

  useEffect(() => {
    void load().catch((error: Error) => setNotice(error.message));
  }, [load]);

  async function request(path: string, method: string, body: unknown, success: string) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || "فشلت العملية.");
      setNotice(success);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "فشلت العملية.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid gap-6 xl:grid-cols-[330px_1fr]">
    <aside className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-4 flex justify-between"><h2 className="font-semibold">القنوات</h2><span>{rows.length}</span></div>
      <div className="space-y-2">{rows.map((row) => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full rounded-xl border p-3 text-right ${selectedId === row.id ? "border-blue-500" : "dark:border-slate-800"}`}>
        <div className="flex justify-between"><strong>{row.name}</strong><small>{row.kind}</small></div>
        <p className="text-xs text-slate-500">{row.displayAddress || row.status} · webhook: {row.webhookStatus}</p>
        {row.lastErrorCode ? <p className="text-xs text-red-600">{row.lastErrorCode}</p> : null}
      </button>)}</div>
      {canManage ? <form className="mt-5 space-y-2 border-t pt-4 dark:border-slate-800" action={async (data) => request("/api/dashboard/channels", "POST", {
        name: data.get("name"),
        phoneNumberId: data.get("phoneNumberId") || undefined,
        displayAddress: data.get("displayAddress") || undefined,
      }, "تمت إضافة WhatsApp.")}>
        <h3 className="text-sm font-semibold">إضافة WhatsApp</h3>
        <input name="name" required placeholder="اسم الاتصال" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" />
        <input name="phoneNumberId" placeholder="Phone Number ID" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" />
        <input name="displayAddress" placeholder="رقم العرض" className="w-full rounded-lg border px-3 py-2 dark:bg-slate-900" />
        <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-white">إضافة واختبار</button>
      </form> : null}
    </aside>
    <main className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
      {!selected ? <p>اختر قناة.</p> : <form key={selected.id} className="space-y-5" action={async (data) => request("/api/dashboard/channels", "PATCH", {
        id: selected.id,
        name: data.get("name"),
        enabled: data.get("enabled") === "on",
        defaultAgentId: data.get("agentId") || null,
        defaultProviderCredentialId: data.get("providerId") || null,
        defaultModel: data.get("model") || null,
        inboxId: data.get("inboxId") || null,
        workflowId: data.get("workflowId") || null,
        settings: {
          welcomeMessage: data.get("welcomeMessage"),
          autoReplyEnabled: data.get("autoReplyEnabled") === "on",
          language: data.get("language") || "ar",
          memoryEnabled: data.get("memoryEnabled") === "on",
          historyEnabled: data.get("historyEnabled") === "on",
          handoffMode: data.get("handoffMode") || "ai_then_human",
        },
      }, "تم حفظ إعدادات القناة.")}>
        <div className="flex justify-between"><div><h2 className="text-lg font-semibold">{selected.name}</h2><p className="text-sm text-slate-500">{selected.kind} · {selected.status}</p></div><label><input name="enabled" type="checkbox" defaultChecked={selected.enabled} /> مفعّل</label></div>
        <div className="grid gap-4 md:grid-cols-2">
          <label>الاسم<input name="name" defaultValue={selected.name} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /></label>
          <label>الوكيل<select name="agentId" defaultValue={selected.defaultAgentId || ""} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="">بدون</option>{options.agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>المزود<select name="providerId" defaultValue={selected.defaultProviderCredentialId || ""} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="">بدون</option>{options.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>النموذج<input name="model" defaultValue={selected.defaultModel || ""} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /></label>
          <label>الصندوق<select name="inboxId" defaultValue={selected.inboxId || ""} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="">بدون</option>{options.inboxes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>سير العمل<select name="workflowId" defaultValue={selected.workflowId || ""} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="">بدون</option>{options.workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>اللغة<input name="language" defaultValue={String(selected.settings.language || "ar")} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /></label>
          <label>التحويل<select name="handoffMode" defaultValue={String(selected.settings.handoffMode || "ai_then_human")} className="block w-full rounded-lg border px-3 py-2 dark:bg-slate-900"><option value="ai">AI فقط</option><option value="human">بشري فقط</option><option value="ai_then_human">AI ثم بشري</option><option value="human_then_ai">بشري ثم AI</option><option value="keyword">كلمات مفتاحية</option><option value="business_hours">ساعات العمل</option><option value="agent_failure">فشل الوكيل</option><option value="user_request">طلب المستخدم</option></select></label>
          <label className="md:col-span-2">الترحيب<textarea name="welcomeMessage" defaultValue={String(selected.settings.welcomeMessage || "")} className="block min-h-24 w-full rounded-lg border px-3 py-2 dark:bg-slate-900" /></label>
        </div>
        <div className="flex gap-4 text-sm"><label><input name="autoReplyEnabled" type="checkbox" defaultChecked={Boolean(selected.settings.autoReplyEnabled)} /> رد تلقائي</label><label><input name="memoryEnabled" type="checkbox" defaultChecked={Boolean(selected.settings.memoryEnabled)} /> ذاكرة</label><label><input name="historyEnabled" type="checkbox" defaultChecked={Boolean(selected.settings.historyEnabled)} /> سجل</label></div>
        <p className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">الأدوات: {options.tools.length} · الفريق: {options.members.length} · التحويل البشري: {canHandoff ? "مسموح" : "غير مسموح"}</p>
        {canManage ? <div className="flex flex-wrap gap-2"><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-white">حفظ</button><button type="button" onClick={() => void request("/api/dashboard/channels/test", "POST", { connectionId: selected.id }, "نجح اختبار الاتصال.")} className="rounded-lg border px-4 py-2">اختبار</button><button type="button" onClick={() => void request("/api/dashboard/channels/unlink", "POST", { connectionId: selected.id }, "تم فصل الاتصال.")} className="rounded-lg border border-red-300 px-4 py-2 text-red-700">فصل</button></div> : null}
      </form>}
      {notice ? <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">{notice}</p> : null}
    </main>
  </div>;
}
''')

print("channel platform remediation applied")
