"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function SettingsForms({ name, organizationName, canManageOrganization }: { name: string | null; organizationName: string; canManageOrganization: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: string, values: Record<string, unknown>) {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/dashboard/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...values }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error?.message ?? "تعذر حفظ الإعدادات.");
      setMessage(action === "password" ? "تم تغيير كلمة المرور وتدوير جميع الجلسات بنجاح." : "تم حفظ التغييرات.");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تعذر حفظ الإعدادات.");
    } finally {
      setBusy(null);
    }
  }

  function profile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit("profile", { name: new FormData(event.currentTarget).get("name") });
  }
  function organization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit("organization", { name: new FormData(event.currentTarget).get("name") });
  }
  function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    submit("password", { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") }).then(() => form.reset());
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {message ? <p role="status" className="rounded-2xl border border-stone-700 p-3 text-sm lg:col-span-2">{message}</p> : null}
      <form onSubmit={profile} className="soft-card grid gap-4 p-5"><h2 className="font-bold">الحساب</h2><label className="grid gap-2 text-sm">الاسم<input name="name" defaultValue={name ?? ""} required className="form-control" /></label><button disabled={busy !== null} className="primary-button">حفظ الاسم</button></form>
      {canManageOrganization ? <form onSubmit={organization} className="soft-card grid gap-4 p-5"><h2 className="font-bold">المؤسسة</h2><label className="grid gap-2 text-sm">الاسم<input name="name" defaultValue={organizationName} required className="form-control" /></label><button disabled={busy !== null} className="primary-button">حفظ المؤسسة</button></form> : null}
      <form onSubmit={password} className="soft-card grid gap-4 p-5 lg:col-span-2"><h2 className="font-bold">تغيير كلمة المرور</h2><p className="text-sm text-stone-400">سيتم إبطال جميع الجلسات وإنشاء جلسة جديدة آمنة على هذا الجهاز.</p><label className="grid gap-2 text-sm">الحالية<input name="currentPassword" type="password" required maxLength={128} className="form-control" /></label><label className="grid gap-2 text-sm">الجديدة<input name="newPassword" type="password" required minLength={12} maxLength={128} className="form-control" /></label><button disabled={busy !== null} className="primary-button">تغيير وتدوير الجلسات</button></form>
      <section className="soft-card p-5 lg:col-span-2"><h2 className="font-bold">استعادة كلمة المرور والبريد</h2><p className="mt-2 text-sm leading-7 text-stone-400">لا تظهر روابط استعادة أو تأكيد بريد غير مكتملة. ستتاح هذه التدفقات بعد إعداد مزود بريد ومعالجة الرموز المؤقتة.</p></section>
    </div>
  );
}
