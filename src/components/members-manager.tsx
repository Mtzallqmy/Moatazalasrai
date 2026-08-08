"use client";

import { FormEvent, useMemo, useState } from "react";
import { Check, ChevronDown, Clock3, KeyRound, Loader2, UserPlus, X } from "lucide-react";
import { ALL_PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { apiErrorMessage, apiRequest } from "@/lib/http/client";

type Role = "owner" | "admin" | "developer" | "operator" | "viewer" | "member";
type Member = {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: Role;
  expiresAt: string | null;
  customPermissions: string[];
  createdAt: string;
};
type Duration = "permanent" | "day" | "week" | "month" | "quarter" | "custom";

const roles: Exclude<Role, "owner">[] = ["member", "viewer", "operator", "developer", "admin"];
const roleLabels: Record<Role, string> = {
  owner: "المالك",
  admin: "مدير",
  developer: "مطوّر",
  operator: "مشغّل",
  viewer: "مشاهد",
  member: "عضو",
};
const durationLabels: Record<Duration, string> = {
  permanent: "دون انتهاء",
  day: "يوم واحد",
  week: "7 أيام",
  month: "30 يومًا",
  quarter: "90 يومًا",
  custom: "تاريخ مخصص",
};
const permissionGroups: Array<{ title: string; prefixes: string[] }> = [
  { title: "الوكلاء والتشغيل", prefixes: ["agents:", "runs:", "executions:", "tools:"] },
  { title: "الملفات والذكاء", prefixes: ["files:", "data_interpreter:", "coding_agent:", "voice_studio:"] },
  { title: "القنوات والتكاملات", prefixes: ["channels:", "integrations:", "notifications:", "site_connections:"] },
  { title: "المتصفح وSandbox", prefixes: ["browser_tasks:", "browser_agent:", "sandbox:"] },
  { title: "الإدارة والمحتوى", prefixes: ["members:", "organization:", "control_plane:", "content:", "services:", "menus:", "security:", "audit:", "analytics:", "trash:", "providers:"] },
];

function expiryFor(duration: Duration, custom: string) {
  if (duration === "permanent") return null;
  if (duration === "custom") {
    const parsed = new Date(custom);
    if (!custom || !Number.isFinite(parsed.getTime())) throw new Error("حدد تاريخ انتهاء صالحًا.");
    return parsed.toISOString();
  }
  const days = duration === "day" ? 1 : duration === "week" ? 7 : duration === "month" ? 30 : 90;
  return new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function PermissionPicker({ value, onChange, disabled = false }: {
  value: Permission[];
  onChange: (value: Permission[]) => void;
  disabled?: boolean;
}) {
  const selected = useMemo(() => new Set(value), [value]);
  return (
    <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold">
        <span className="flex items-center gap-2"><KeyRound size={16} /> صلاحيات إضافية دقيقة</span>
        <span className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">{value.length ? `${value.length} محددة` : "حسب الدور"}<ChevronDown size={15} /></span>
      </summary>
      <p className="mt-3 text-xs leading-6 text-[var(--text-secondary)]">هذه الصلاحيات تُضاف إلى صلاحيات الدور الأساسي. اختر دور «مشاهد» أو «عضو» للوصول المحدود ثم امنح الاستثناءات المطلوبة فقط.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {permissionGroups.map((group) => {
          const options = ALL_PERMISSIONS.filter((permission) => group.prefixes.some((prefix) => permission.startsWith(prefix)));
          return <fieldset key={group.title} className="rounded-xl border border-[var(--border)] p-3" disabled={disabled}>
            <legend className="px-2 text-xs font-bold">{group.title}</legend>
            <div className="grid gap-2">{options.map((permission) => <label key={permission} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={selected.has(permission)} onChange={(event) => onChange(event.target.checked
                ? [...value, permission]
                : value.filter((item) => item !== permission))} />
              <code dir="ltr" className="text-[11px]">{permission}</code>
            </label>)}</div>
          </fieldset>;
        })}
      </div>
    </details>
  );
}

export function MembersManager({ initialMembers, currentUserId, currentRole, initialPublicRegistrationEnabled }: {
  initialMembers: Member[];
  currentUserId: string;
  currentRole: Role;
  initialPublicRegistrationEnabled: boolean;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [duration, setDuration] = useState<Duration>("month");
  const [customExpiry, setCustomExpiry] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState<Exclude<Role, "owner">>("member");
  const [editExpiry, setEditExpiry] = useState("");
  const [editPermissions, setEditPermissions] = useState<Permission[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [publicRegistration, setPublicRegistration] = useState(initialPublicRegistrationEnabled);
  const [renderedAt] = useState(() => Date.now());
  const [minimumExpiry] = useState(() => localDateTime(new Date(Date.now() + 60_000).toISOString()));

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("create");
    setMessage(null);
    try {
      const created = await apiRequest<Member & { userCreated: boolean }>("/api/dashboard/members", {
        method: "POST",
        body: {
          action: "create",
          name: data.get("name"),
          email: data.get("email"),
          password: data.get("password"),
          role: data.get("role"),
          expiresAt: expiryFor(duration, customExpiry),
          permissions,
        },
      });
      setMembers((items) => [...items, {
        ...created,
        expiresAt: created.expiresAt ? new Date(created.expiresAt).toISOString() : null,
        createdAt: new Date(created.createdAt).toISOString(),
      }]);
      form.reset();
      setDuration("month");
      setCustomExpiry("");
      setPermissions([]);
      setMessage(created.userCreated
        ? "تم إنشاء الحساب وتفعيل وصوله. يستطيع المستخدم الدخول بالبريد وكلمة المرور المحددين."
        : "البريد يملك حسابًا سابقًا؛ أضيف إلى المؤسسة مع الاحتفاظ بكلمة مروره الحالية.");
    } catch (error) {
      setMessage(apiErrorMessage(error, "تعذر إنشاء المستخدم."));
    } finally {
      setBusy(null);
    }
  }

  function openAccess(member: Member) {
    setEditing(member);
    setEditRole(member.role === "owner" ? "member" : member.role);
    setEditExpiry(localDateTime(member.expiresAt));
    setEditPermissions(member.customPermissions.filter((permission): permission is Permission => ALL_PERMISSIONS.includes(permission as Permission)));
    setMessage(null);
  }

  async function saveAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(editing.id);
    setMessage(null);
    try {
      const updated = await apiRequest<Member>("/api/dashboard/members", {
        method: "POST",
        body: {
          action: "access",
          memberId: editing.id,
          role: editRole,
          expiresAt: editExpiry ? new Date(editExpiry).toISOString() : null,
          permissions: editPermissions,
        },
      });
      setMembers((items) => items.map((item) => item.id === editing.id ? {
        ...item,
        role: updated.role,
        expiresAt: updated.expiresAt ? new Date(updated.expiresAt).toISOString() : null,
        customPermissions: updated.customPermissions,
      } : item));
      setEditing(null);
      setMessage("تم تحديث الدور والصلاحيات والمدة، وأُبطلت جلسات المستخدم القديمة لتطبيقها فورًا.");
    } catch (error) {
      setMessage(apiErrorMessage(error, "تعذر تحديث الوصول."));
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: Member) {
    if (confirmRemove !== member.id) {
      setConfirmRemove(member.id);
      setMessage(`اضغط «تأكيد الإزالة» لإزالة ${member.name ?? member.email}.`);
      return;
    }
    setBusy(member.id);
    try {
      await apiRequest("/api/dashboard/members", { method: "POST", body: { action: "remove", memberId: member.id } });
      setMembers((items) => items.filter((item) => item.id !== member.id));
      setConfirmRemove(null);
      setMessage("تمت إزالة العضو وإبطال جلساته في المؤسسة.");
    } catch (error) {
      setMessage(apiErrorMessage(error, "تعذر إزالة العضو."));
    } finally {
      setBusy(null);
    }
  }

  async function toggleRegistration() {
    setBusy("registration");
    try {
      const next = !publicRegistration;
      await apiRequest("/api/dashboard/members", { method: "POST", body: { action: "registration", enabled: next } });
      setPublicRegistration(next);
      setMessage(next ? "تم فتح التسجيل العام للمستخدمين الجدد." : "تم إغلاق التسجيل العام؛ إنشاء الحسابات من هذه الصفحة ما زال متاحًا.");
    } catch (error) {
      setMessage(apiErrorMessage(error, "تعذر تغيير التسجيل العام."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5">
      {currentRole === "owner" ? <section className="soft-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-bold">التسجيل العام</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">عند إغلاقه لا يستطيع الزائر إنشاء حساب بنفسه، بينما يبقى إنشاء المستخدمين من لوحة الإدارة متاحًا.</p></div>
        <button type="button" disabled={busy !== null} onClick={toggleRegistration} className={publicRegistration ? "danger-button px-4 py-2" : "primary-button px-4 py-2"}>
          {busy === "registration" ? "جارٍ الحفظ…" : publicRegistration ? "إغلاق التسجيل العام" : "فتح التسجيل العام"}
        </button>
      </section> : null}

      <form onSubmit={create} className="soft-card grid gap-5 p-5">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500"><UserPlus size={20} /></span><div><h2 className="font-bold">إنشاء مستخدم مباشر</h2><p className="text-sm text-[var(--text-secondary)]">ينشئ المالك أو الأدمن البريد وكلمة المرور والوصول دون انتظار دعوة بريدية.</p></div></div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">الاسم الكامل<input name="name" required minLength={2} maxLength={100} className="form-control" autoComplete="off" /></label>
          <label className="grid gap-2 text-sm">البريد الإلكتروني<input name="email" type="email" required maxLength={320} className="form-control" dir="ltr" autoComplete="off" /></label>
          <label className="grid gap-2 text-sm">كلمة المرور المؤقتة أو الأساسية<input name="password" type="password" required minLength={12} maxLength={128} className="form-control" dir="ltr" autoComplete="new-password" /><small className="text-[var(--text-secondary)]">12 حرفًا على الأقل. لا تُعرض الكلمة بعد الحفظ.</small></label>
          <label className="grid gap-2 text-sm">الدور الأساسي<select name="role" defaultValue="member" className="form-control">{roles.filter((role) => currentRole === "owner" || role !== "admin").map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
          <label className="grid gap-2 text-sm">مدة الاستخدام<select value={duration} onChange={(event) => setDuration(event.target.value as Duration)} className="form-control">{Object.entries(durationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {duration === "custom" ? <label className="grid gap-2 text-sm">ينتهي في<input type="datetime-local" required value={customExpiry} min={minimumExpiry} onChange={(event) => setCustomExpiry(event.target.value)} className="form-control" /></label> : null}
        </div>
        <PermissionPicker value={permissions} onChange={setPermissions} disabled={busy !== null} />
        <button disabled={busy !== null} className="primary-button justify-self-start px-5 py-3">{busy === "create" ? <><Loader2 className="animate-spin" size={17} /> جارٍ الإنشاء…</> : <><UserPlus size={17} /> إنشاء المستخدم وتفعيل الوصول</>}</button>
      </form>

      {message ? <p role="status" className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">{message}</p> : null}

      <section className="soft-card overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[var(--surface-muted)] text-right text-[var(--text-secondary)]"><tr><th className="p-4">المستخدم</th><th className="p-4">الدور</th><th className="p-4">صلاحية الوصول</th><th className="p-4">صلاحيات إضافية</th><th className="p-4">الإجراء</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">{members.map((member) => {
            const expired = Boolean(member.expiresAt && new Date(member.expiresAt).getTime() <= renderedAt);
            const canEdit = member.role !== "owner" && member.userId !== currentUserId && (currentRole === "owner" || member.role !== "admin");
            return <tr key={member.id} className={expired ? "opacity-65" : undefined}>
              <td className="p-4"><strong>{member.name ?? "بلا اسم"}</strong><bdi className="mt-1 block font-mono text-xs text-[var(--text-secondary)]" dir="ltr">{member.email}</bdi></td>
              <td className="p-4"><span className="status-badge status-neutral">{roleLabels[member.role]}</span></td>
              <td className="p-4">{member.expiresAt ? <span className="flex items-center gap-2"><Clock3 size={15} />{expired ? "منتهية" : new Date(member.expiresAt).toLocaleString("ar")}</span> : "دائمة"}</td>
              <td className="p-4">{member.customPermissions.length ? `${member.customPermissions.length} صلاحيات` : "حسب الدور"}</td>
              <td className="p-4"><div className="flex gap-2">{canEdit ? <>
                <button type="button" disabled={busy !== null} className="secondary-button px-3 py-2 text-xs" onClick={() => openAccess(member)}>تعديل الوصول</button>
                <button type="button" disabled={busy !== null} className="danger-button px-3 py-2 text-xs" onClick={() => remove(member)}>{confirmRemove === member.id ? "تأكيد الإزالة" : "إزالة"}</button>
                {confirmRemove === member.id ? <button type="button" className="secondary-button px-2 py-2" aria-label="إلغاء الإزالة" onClick={() => setConfirmRemove(null)}><X size={15} /></button> : null}
              </> : "—"}</div></td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>

      {editing ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditing(null); }}>
        <form className="modal-card member-access-dialog max-h-[90vh] w-[min(760px,calc(100vw-2rem))] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="member-access-title" onSubmit={saveAccess}>
          <div className="flex items-start justify-between gap-4"><div><h2 id="member-access-title" className="text-lg font-bold">تعديل وصول {editing.name ?? editing.email}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">سيتم إبطال جلساته الحالية لتطبيق التغيير فورًا.</p></div><button type="button" className="icon-button" aria-label="إغلاق" onClick={() => setEditing(null)}><X size={18} /></button></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">الدور<select value={editRole} onChange={(event) => setEditRole(event.target.value as Exclude<Role, "owner">)} className="form-control">{roles.filter((role) => currentRole === "owner" || role !== "admin").map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
            <label className="grid gap-2 text-sm">انتهاء الوصول (فارغ = دائم)<input type="datetime-local" value={editExpiry} min={minimumExpiry} onChange={(event) => setEditExpiry(event.target.value)} className="form-control" /></label>
          </div>
          <div className="mt-5"><PermissionPicker value={editPermissions} onChange={setEditPermissions} disabled={busy !== null} /></div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button px-4 py-2" onClick={() => setEditing(null)}>إلغاء</button><button disabled={busy !== null} className="primary-button px-4 py-2">{busy === editing.id ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />} حفظ وتطبيق</button></div>
        </form>
      </div> : null}
    </div>
  );
}
