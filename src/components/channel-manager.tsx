"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Named = { id: string; name: string };
type AgentBinding = {
  agentId: string;
  providerCredentialId: string | null;
  model: string | null;
  priority: number;
  enabled: boolean;
};
type ProviderBinding = {
  providerCredentialId: string;
  model: string | null;
  priority: number;
  enabled: boolean;
};
type PermissionPolicy = {
  permissions: string[];
  blockedOperations: string[];
  allowedCommands: string[];
};
type Connection = {
  id: string;
  kind: "telegram" | "whatsapp";
  name: string;
  displayAddress: string | null;
  credentialSource: string;
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
  agentBindings: AgentBinding[];
  providerBindings: ProviderBinding[];
  toolIds: string[];
  permissions: PermissionPolicy;
};
type ProviderOption = Named & {
  provider: string;
  models: string[];
  defaultModel: string | null;
  enabled: boolean;
};
type Props = {
  canManage: boolean;
  canHandoff: boolean;
  options: {
    agents: Array<Named & { status: string }>;
    providers: ProviderOption[];
    tools: Array<Named & { title: string | null; risk: string }>;
    inboxes: Named[];
    workflows: Named[];
    members: Array<Named & { email: string; role: string }>;
  };
};

const permissionOptions = [
  ["ai.chat", "الدردشة بالذكاء الاصطناعي"],
  ["agent.use", "استخدام الوكيل"],
  ["tools.execute", "تنفيذ الأدوات"],
  ["conversation.open", "إنشاء وربط المحادثات"],
  ["files.use", "استخدام الملفات والوسائط"],
  ["search.use", "البحث"],
  ["workflows.execute", "تشغيل سير العمل"],
  ["handoff.request", "التحويل إلى موظف"],
] as const;
const defaultPermissions = ["ai.chat", "agent.use", "conversation.open", "files.use", "handoff.request"];

function unwrap(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return (record.data && typeof record.data === "object" ? record.data : record) as Record<string, unknown>;
}

async function requestJson(path: string, method = "GET", body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    signal,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || "فشلت العملية.");
  return unwrap(json);
}

async function fetchConnections(signal?: AbortSignal): Promise<Connection[]> {
  const data = await requestJson("/api/dashboard/channels", "GET", undefined, signal);
  return (data.connections || []) as Connection[];
}

function toggle(values: string[], value: string, checked: boolean) {
  return checked ? Array.from(new Set([...values, value])) : values.filter((item) => item !== value);
}

function ConnectionEditor(props: {
  connection: Connection;
  options: Props["options"];
  canManage: boolean;
  canHandoff: boolean;
  onReload: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const connection = props.connection;
  const firstAgentBinding = connection.agentBindings.find((binding) => binding.enabled) ?? null;
  const firstProviderBinding = connection.providerBindings.find((binding) => binding.enabled) ?? null;
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(connection.name);
  const [enabled, setEnabled] = useState(connection.enabled);
  const [agentId, setAgentId] = useState(connection.defaultAgentId ?? firstAgentBinding?.agentId ?? "");
  const [providerId, setProviderId] = useState(connection.defaultProviderCredentialId
    ?? firstAgentBinding?.providerCredentialId
    ?? firstProviderBinding?.providerCredentialId
    ?? "");
  const [model, setModel] = useState(connection.defaultModel
    ?? firstAgentBinding?.model
    ?? firstProviderBinding?.model
    ?? "");
  const [inboxId, setInboxId] = useState(connection.inboxId ?? "");
  const [workflowId, setWorkflowId] = useState(connection.workflowId ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(String(connection.settings.welcomeMessage ?? ""));
  const [language, setLanguage] = useState(String(connection.settings.language ?? "ar"));
  const [handoffMode, setHandoffMode] = useState(String(connection.settings.handoffMode ?? "ai_then_human"));
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(Boolean(connection.settings.autoReplyEnabled));
  const [memoryEnabled, setMemoryEnabled] = useState(Boolean(connection.settings.memoryEnabled));
  const [historyEnabled, setHistoryEnabled] = useState(Boolean(connection.settings.historyEnabled));
  const [toolIds, setToolIds] = useState<string[]>(connection.toolIds ?? []);
  const [permissions, setPermissions] = useState<string[]>(connection.permissions?.permissions?.length
    ? connection.permissions.permissions
    : defaultPermissions);
  const [allowedCommands, setAllowedCommands] = useState((connection.permissions?.allowedCommands?.length
    ? connection.permissions.allowedCommands
    : Array.isArray(connection.settings.allowedCommands)
      ? connection.settings.allowedCommands.filter((value): value is string => typeof value === "string")
      : []).join(", "));

  const managedWhatsApp = connection.kind === "whatsapp" && connection.credentialSource === "environment";
  const selectedProvider = useMemo(
    () => props.options.providers.find((provider) => provider.id === providerId) ?? null,
    [providerId, props.options.providers],
  );
  const providerModels = useMemo(() => selectedProvider?.models ?? [], [selectedProvider]);
  const validationError = useMemo(() => {
    if (managedWhatsApp) return null;
    if (autoReplyEnabled && !agentId) return "اختر وكيلًا منشورًا قبل تفعيل الرد الآلي.";
    if (providerId && !selectedProvider) return "المزود المختار غير متاح أو لم يعد متحققًا.";
    if (providerId && (!model || !providerModels.includes(model))) return "اختر نموذجًا صالحًا من المزود المحدد.";
    if (toolIds.length > 0 && !permissions.includes("tools.execute")) return "فعّل صلاحية تنفيذ الأدوات قبل اختيار أدوات للقناة.";
    if (autoReplyEnabled && (!permissions.includes("ai.chat") || !permissions.includes("agent.use"))) {
      return "الرد الآلي يتطلب صلاحيتي الدردشة واستخدام الوكيل.";
    }
    return null;
  }, [agentId, autoReplyEnabled, managedWhatsApp, model, permissions, providerId, providerModels, selectedProvider, toolIds.length]);

  function changeProvider(nextProviderId: string) {
    const provider = props.options.providers.find((item) => item.id === nextProviderId) ?? null;
    setProviderId(provider?.id ?? "");
    setModel(provider?.defaultModel && provider.models.includes(provider.defaultModel)
      ? provider.defaultModel
      : provider?.models[0] ?? "");
  }

  async function save() {
    if (!props.canManage || managedWhatsApp) return;
    if (validationError) {
      props.setNotice(validationError);
      return;
    }
    setBusy(true);
    props.setNotice("");
    try {
      const commands = Array.from(new Set(allowedCommands.split(",").map((value) => value.trim()).filter(Boolean)));
      await requestJson("/api/dashboard/channels", "PATCH", {
        id: connection.id,
        name,
        enabled,
        defaultAgentId: agentId || null,
        defaultProviderCredentialId: providerId || null,
        defaultModel: model || null,
        inboxId: inboxId || null,
        workflowId: workflowId || null,
        settings: {
          welcomeMessage,
          autoReplyEnabled,
          language,
          memoryEnabled,
          historyEnabled,
          handoffMode,
          allowedCommands: commands,
        },
      });
      await requestJson("/api/dashboard/channels/bindings", "PUT", {
        connectionId: connection.id,
        agents: agentId ? [{
          agentId,
          providerCredentialId: providerId || null,
          model: model || null,
          priority: 100,
          enabled: true,
        }] : [],
        providers: providerId ? [{
          providerCredentialId: providerId,
          model: model || null,
          priority: 100,
          enabled: true,
        }] : [],
        toolIds,
      });
      await requestJson("/api/dashboard/channels/permissions", "PUT", {
        connectionId: connection.id,
        permissions,
        blockedOperations: connection.permissions?.blockedOperations?.length
          ? connection.permissions.blockedOperations
          : ["financial", "sensitive"],
        allowedCommands: commands,
      });
      await props.onReload();
      props.setNotice("تم حفظ القناة وربط الوكيل والمزود والنموذج والأدوات والصلاحيات فعليًا.");
    } catch (error) {
      props.setNotice(error instanceof Error ? error.message : "تعذر حفظ القناة.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    props.setNotice("");
    try {
      await requestJson("/api/dashboard/channels/test", "POST", { connectionId: connection.id });
      await props.onReload();
      props.setNotice("نجح اختبار اتصال القناة مع الخدمة الخارجية.");
    } catch (error) {
      props.setNotice(error instanceof Error ? error.message : "فشل اختبار الاتصال.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{connection.name}</h2>
          <p className="text-sm text-slate-500">{connection.kind} · {connection.status} · webhook: {connection.webhookStatus}</p>
          {connection.displayAddress ? <p className="text-sm text-slate-500"><bdi dir="ltr">{connection.displayAddress}</bdi></p> : null}
        </div>
        <div className="flex gap-2">
          <a href="/dashboard/chat" className="rounded-lg border px-3 py-2 text-sm">فتح المحادثات</a>
          <button type="button" disabled={busy} onClick={() => void testConnection()} className="rounded-lg border px-3 py-2 text-sm">اختبار الاتصال</button>
        </div>
      </div>

      {managedWhatsApp ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          قناة WhatsApp المركزية تعمل من نفس محرك المحادثات، لكن توجيه الوكيل والمزود والنموذج والأدوات يُدار من قسم «إعدادات WhatsApp المركزية» أعلى الصفحة حتى تبقى سياسات المؤسسة والمستخدم متسقة.
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm"><span>اسم القناة</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={!props.canManage || busy} /></label>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={!props.canManage || busy} /><span>القناة مفعلة</span></label>
            <label className="space-y-1 text-sm"><span>الوكيل المنشور</span><select className="input" value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={!props.canManage || busy}><option value="">اختر الوكيل</option>{props.options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>المزود المتحقق</span><select className="input" value={providerId} onChange={(event) => changeProvider(event.target.value)} disabled={!props.canManage || busy}><option value="">استخدم إعداد الوكيل</option>{props.options.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.provider}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>النموذج</span><select className="input" value={model} onChange={(event) => setModel(event.target.value)} disabled={!props.canManage || busy || !selectedProvider}><option value="">{selectedProvider ? "اختر النموذج" : "اختر المزود أولًا"}</option>{providerModels.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>صندوق المحادثات</span><select className="input" value={inboxId} onChange={(event) => setInboxId(event.target.value)} disabled={!props.canManage || busy}><option value="">بدون صندوق محدد</option>{props.options.inboxes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>سير العمل</span><select className="input" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} disabled={!props.canManage || busy}><option value="">بدون سير عمل</option>{props.options.workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="space-y-1 text-sm"><span>وضع التحويل</span><select className="input" value={handoffMode} onChange={(event) => setHandoffMode(event.target.value)} disabled={!props.canManage || busy || !props.canHandoff}><option value="ai">AI فقط</option><option value="human">بشري فقط</option><option value="ai_then_human">AI ثم بشري</option><option value="human_then_ai">بشري ثم AI</option><option value="keyword">كلمات مفتاحية</option><option value="business_hours">ساعات العمل</option><option value="agent_failure">عند فشل الوكيل</option><option value="user_request">عند طلب المستخدم</option></select></label>
            <label className="space-y-1 text-sm"><span>اللغة</span><input className="input" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={!props.canManage || busy} /></label>
            <label className="space-y-1 text-sm md:col-span-2"><span>رسالة الترحيب</span><textarea className="input min-h-24" value={welcomeMessage} onChange={(event) => setWelcomeMessage(event.target.value)} disabled={!props.canManage || busy} /></label>
            <label className="space-y-1 text-sm md:col-span-2"><span>الأوامر المسموحة، مفصولة بفواصل</span><input className="input" value={allowedCommands} onChange={(event) => setAllowedCommands(event.target.value)} disabled={!props.canManage || busy} placeholder="start, help, menu, new, human, ai, status" /></label>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <fieldset className="space-y-2" disabled={!props.canManage || busy}>
              <legend className="text-sm font-medium">صلاحيات القناة الفعلية</legend>
              {permissionOptions.map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={permissions.includes(value)} onChange={(event) => {
                const next = toggle(permissions, value, event.target.checked);
                setPermissions(next);
                if (value === "tools.execute" && !event.target.checked) setToolIds([]);
              }} /><span>{label}</span></label>)}
            </fieldset>
            <fieldset className="space-y-2" disabled={!props.canManage || busy}>
              <legend className="text-sm font-medium">الأدوات المرتبطة بالقناة</legend>
              {props.options.tools.length ? <div className="max-h-56 space-y-2 overflow-auto">{props.options.tools.map((tool) => <label key={tool.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={toolIds.includes(tool.id)} disabled={!permissions.includes("tools.execute")} onChange={(event) => setToolIds(toggle(toolIds, tool.id, event.target.checked))} /><span>{tool.title || tool.name} <small className="text-slate-500">({tool.risk})</small></span></label>)}</div> : <p className="text-sm text-slate-500">لا توجد أدوات MCP مفعلة في المؤسسة.</p>}
            </fieldset>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={autoReplyEnabled} onChange={(event) => setAutoReplyEnabled(event.target.checked)} disabled={!props.canManage || busy} /> رد تلقائي</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={memoryEnabled} onChange={(event) => setMemoryEnabled(event.target.checked)} disabled={!props.canManage || busy} /> ذاكرة</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={historyEnabled} onChange={(event) => setHistoryEnabled(event.target.checked)} disabled={!props.canManage || busy} /> حفظ السجل</label>
          </div>

          {validationError ? <p className="text-sm text-red-600" role="alert">{validationError}</p> : null}
          {props.canManage ? <button type="button" disabled={busy || Boolean(validationError)} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-white">{busy ? "جارٍ الحفظ…" : "حفظ وربط القناة"}</button> : null}
        </>
      )}

      <div className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">
        الربط الحالي: وكيل {connection.defaultAgentId ? "محدد" : "غير محدد"} · مزود {connection.defaultProviderCredentialId ? "محدد" : "من إعداد الوكيل"} · نموذج {connection.defaultModel || "من إعداد الوكيل"} · أدوات {connection.toolIds?.length ?? 0}.
        المحادثات الواردة تُحفظ في قاعدة البيانات وتظهر في صفحة الدردشات.
      </div>
      {connection.lastErrorCode ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">آخر خطأ: {connection.lastErrorCode}</p> : null}
    </section>
  );
}

export function ChannelManager({ canManage, canHandoff, options }: Props) {
  const [rows, setRows] = useState<Connection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);

  const applyConnections = useCallback((connections: Connection[]) => {
    setRows(connections);
    setSelectedId((current) => connections.some((row) => row.id === current) ? current : connections[0]?.id || "");
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      applyConnections(await fetchConnections(signal));
    } finally {
      setLoading(false);
    }
  }, [applyConnections]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchConnections(controller.signal)
      .then((connections) => {
        if (!controller.signal.aborted) applyConnections(connections);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setNotice(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [applyConnections]);

  async function synchronize() {
    setLoading(true);
    setNotice("");
    try {
      await requestJson("/api/dashboard/channels", "POST", {});
      await load();
      setNotice("تمت مزامنة قناتي Telegram وWhatsApp من إعدادات التشغيل.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذرت مزامنة القنوات.");
      setLoading(false);
    }
  }

  return <div className="grid gap-6 xl:grid-cols-[330px_1fr]">
    <aside className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">القنوات المتصلة</h2><span>{rows.length}</span></div>
      <div className="space-y-2">{rows.map((row) => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full rounded-xl border p-3 text-right ${selectedId === row.id ? "border-blue-500" : "dark:border-slate-800"}`}>
        <div className="flex justify-between gap-2"><strong>{row.name}</strong><small>{row.kind}</small></div>
        <p className="text-xs text-slate-500">{row.displayAddress || row.status} · webhook: {row.webhookStatus}</p>
        <p className="text-xs text-slate-500">وكيل: {row.defaultAgentId ? "مربوط" : "غير مربوط"} · أدوات: {row.toolIds?.length ?? 0}</p>
        {row.lastErrorCode ? <p className="text-xs text-red-600">{row.lastErrorCode}</p> : null}
      </button>)}</div>
      {canManage ? <button type="button" disabled={loading} onClick={() => void synchronize()} className="mt-5 w-full rounded-lg border px-3 py-2 text-sm">{loading ? "جارٍ المزامنة…" : "مزامنة القنوات"}</button> : null}
    </aside>
    <main className="rounded-2xl border bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
      {loading && !selected ? <p>جارٍ تحميل القنوات…</p> : !selected ? <p>لا توجد قناة مهيأة. فعّل Telegram أو WhatsApp في Environment ثم اضغط «مزامنة القنوات».</p> : <ConnectionEditor key={selected.id} connection={selected} options={options} canManage={canManage} canHandoff={canHandoff} onReload={load} setNotice={setNotice} />}
      {notice ? <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900" role="status">{notice}</p> : null}
    </main>
  </div>;
}
