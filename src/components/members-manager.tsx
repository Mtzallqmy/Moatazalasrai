"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "owner" | "admin" | "developer" | "operator" | "viewer" | "member";
type Member = { id: string; userId: string; name: string | null; email: string; role: Role; createdAt: string };
const assignableRoles: Exclude<Role, "owner">[] = ["member", "viewer", "operator", "developer", "admin"];

export function MembersManager({ initialMembers, currentUserId, currentRole }: { initialMembers: Member[]; currentUserId: string; currentRole: Role }) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function mutate(body: Record<string, unknown>) {
    const response = await fetch("/api/dashboard/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر تحديث العضوية.");
    return payload.data;
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("add");
    setMessage(null);
    try {
      await mutate({ action: "add", email: data.get("email"), role: data.get("role") });
      form.reset();
      setMessage("تمت إضافة العضو. سيستطيع اختيار المؤسسة عند دخوله التالي.");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر إضافة العضو.");
    } finally {
      setBusy(null);
    }
  }

  async function updateRole(member: Member, role: Role) {
    setBusy(member.id);
    setMessage(null);
    try {
      const updated = await mutate({ action: "role", memberId: member.id, role });
      setMembers((items) => items.map((item) => item.id === member.id ? { ...item, role: updated.role } : item));
      setMessage("تم تحديث الدور.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر تحديث الدور.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(`إزالة ${member.name ?? member.email} من المؤسسة؟`)) return;
    setBusy(member.id);
    setMessage(null);
    try {
      await mutate({ action: "remove", memberId: member.id });
      setMembers((items) => items.filter((item) => item.id !== member.id));
      setMessage("تمت إزالة العضو.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر إزالة العضو.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5">
      <form onSubmit={add} className="soft-card grid gap-4 p-5 sm:grid-cols-[1fr_220px_auto] sm:items-end">
        <label className="grid gap-2 text-sm">بريد مستخدم مسجل<input name="email" type="email" required className="form-control" dir="ltr" /></label>
        <label className="grid gap-2 text-sm">الدور<select name="role" className="form-control">{assignableRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
        <button disabled={busy !== null} className="primary-button">{busy === "add" ? "جارٍ الإضافة..." : "إضافة عضو"}</button>
        <p className="text-xs leading-6 text-stone-500 sm:col-span-3">لا تظهر دعوات بريد وهمية: يجب أن يملك الشخص حسابًا مسجلًا لأن مزود البريد غير مهيأ.</p>
      </form>
      {message ? <p role="status" className="rounded-2xl border border-stone-700 bg-stone-950/40 p-3 text-sm">{message}</p> : null}
      <section className="soft-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-stone-900/70 text-right text-stone-400"><tr><th className="p-4">العضو</th><th className="p-4">الدور</th><th className="p-4">تاريخ الإضافة</th><th className="p-4">الإجراء</th></tr></thead>
            <tbody className="divide-y divide-stone-800">
              {members.map((member) => {
                const canEdit = member.role !== "owner" && member.userId !== currentUserId && (currentRole === "owner" || member.role !== "admin");
                return (
                  <tr key={member.id}>
                    <td className="p-4"><strong>{member.name ?? "بلا اسم"}</strong><span className="mt-1 block font-mono text-xs text-stone-500" dir="ltr">{member.email}</span></td>
                    <td className="p-4">
                      {canEdit ? <select disabled={busy !== null} value={member.role} onChange={(event) => updateRole(member, event.target.value as Role)} className="form-control py-2">{assignableRoles.map((role) => <option key={role}>{role}</option>)}</select> : <span className="status-badge status-neutral">{member.role}</span>}
                    </td>
                    <td className="p-4">{new Date(member.createdAt).toLocaleString("ar")}</td>
                    <td className="p-4">{canEdit ? <button disabled={busy !== null} className="danger-button px-3 py-2 text-xs" onClick={() => remove(member)}>إزالة</button> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
