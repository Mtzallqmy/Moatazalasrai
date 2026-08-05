import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ManagedPublicPage } from "@/components/managed-public-page";
import { loadPublicPage } from "@/lib/admin/content-service";
import { isFeatureEnabled } from "@/lib/control-plane/features";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function generateMetadata({ params }: {
  params: Promise<{ organizationSlug: string; pageSlug: string }>;
}): Promise<Metadata> {
  const { organizationSlug, pageSlug } = await params;
  const data = await loadPublicPage({ organizationSlug, pageSlug });
  if (!data) return {};
  const seo = record(data.page.seo);
  const canonical = typeof seo.canonicalUrl === "string" ? seo.canonicalUrl : undefined;
  return {
    title: typeof seo.title === "string" ? seo.title : data.page.title,
    description: typeof seo.description === "string" ? seo.description : data.page.excerpt ?? undefined,
    alternates: canonical ? { canonical } : undefined,
    robots: seo.noIndex === true ? { index: false, follow: false } : undefined,
  };
}

export default async function PublicManagedPage({ params }: {
  params: Promise<{ organizationSlug: string; pageSlug: string }>;
}) {
  const { organizationSlug, pageSlug } = await params;
  const data = await loadPublicPage({ organizationSlug, pageSlug });
  if (!data) notFound();
  const enabled = await isFeatureEnabled(data.organization.id, "public_dynamic_pages", pageSlug);
  if (!enabled) notFound();
  return <ManagedPublicPage data={data} />;
}
