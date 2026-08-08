"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Organization = { id: string; name: string; slug: string; role: string };

export function OrganizationSwitcher({ activeOrganizationId }: { activeOrganizationId: string | null }) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/organization", { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.success && Array.isArray(payload.data?.organizations)) setOrganizations(payload.data.organizations);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (organizations.length <= 1) return null;
  return (
    <label className="grid gap-1 text-xs text-stone-500">
      المؤسسة النشطة
      <select
        value={activeOrganizationId ?? ""}
        disabled={loading}
        className="rounded-xl border border-stone-700 bg-stone-950/70 px-3 py-2 text-sm text-stone-100"
        onChange={async (event) => {
          setLoading(true);
          try {
            const response = await fetch("/api/auth/organization", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ organizationId: event.target.value }),
            });
            if (response.ok) {
              router.push("/dashboard");
              router.refresh();
            }
          } finally {
            setLoading(false);
          }
        }}
      >
        {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} — {organization.role}</option>)}
      </select>
    </label>
  );
}
