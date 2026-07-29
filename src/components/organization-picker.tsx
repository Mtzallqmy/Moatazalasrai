"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Organization = { id: string; name: string; slug: string; role: string };

export function OrganizationPicker({ organizations }: { organizations: Organization[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function select(organizationId: string) {
    setLoading(organizationId);
    setError(null);
    try {
      const response = await fetch("/api/auth/organization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "تعذر اختيار المؤسسة.");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر اختيار المؤسسة.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="grid gap-3">
      {organizations.map((organization) => (
        <button key={organization.id} disabled={loading !== null} onClick={() => select(organization.id)} className="soft-card flex items-center justify-between gap-4 p-5 text-right transition hover:border-emerald-200/40 disabled:opacity-60">
          <span><strong className="block">{organization.name}</strong><span className="mt-1 block text-sm text-stone-500">{organization.slug}</span></span>
          <span className="status-badge status-neutral">{loading === organization.id ? "جارٍ الاختيار..." : organization.role}</span>
        </button>
      ))}
      {error ? <p role="alert" className="text-sm text-rose-100">{error}</p> : null}
    </div>
  );
}
