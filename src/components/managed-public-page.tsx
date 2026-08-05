/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { sitePageSections, sitePages, siteServices } from "@/db/admin-schema";

export type PublicPageData = {
  organization: { name: string; slug: string };
  page: typeof sitePages.$inferSelect;
  sections: Array<typeof sitePageSections.$inferSelect>;
  services: Array<typeof siteServices.$inferSelect>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function action(value: unknown) {
  const item = record(value);
  const label = string(item.label);
  const href = string(item.href);
  return label && href ? { label, href } : null;
}

function ActionLink({ value, secondary = false }: { value: unknown; secondary?: boolean }) {
  const item = action(value);
  if (!item) return null;
  const external = item.href.startsWith("https://");
  return <Link
    href={item.href}
    target={external ? "_blank" : undefined}
    rel={external ? "noopener noreferrer" : undefined}
    className={secondary
      ? "rounded-xl border border-slate-300 px-5 py-3 font-medium dark:border-slate-700"
      : "rounded-xl bg-blue-600 px-5 py-3 font-medium text-white"}
  >{item.label}</Link>;
}

function ServiceCards({ services }: { services: PublicPageData["services"] }) {
  return <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
    {services.map((service) => <article key={service.id} className="rounded-2xl border bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      {service.imageUrl ? <img src={service.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="mb-4 h-40 w-full rounded-xl object-cover" /> : null}
      <h3 className="text-xl font-semibold">{service.name}</h3>
      {service.summary ? <p className="mt-2 text-slate-600 dark:text-slate-300">{service.summary}</p> : null}
      {service.actionUrl && service.actionLabel ? <Link className="mt-4 inline-flex text-blue-600" href={service.actionUrl}>{service.actionLabel}</Link> : null}
    </article>)}
  </div>;
}

function Section({ section, services }: { section: PublicPageData["sections"][number]; services: PublicPageData["services"] }) {
  const content = record(section.content);
  const settings = record(section.settings);
  const width = ["narrow", "standard", "wide", "full"].includes(string(settings.width)) ? string(settings.width) : "standard";
  const widthClass = width === "narrow" ? "max-w-3xl" : width === "wide" ? "max-w-7xl" : width === "full" ? "max-w-none" : "max-w-5xl";
  const shell = (children: React.ReactNode) => <section className={`mx-auto w-full ${widthClass} px-5 py-10`}>{children}</section>;

  if (section.type === "hero") {
    const primary = content.primaryAction;
    const secondary = content.secondaryAction;
    return shell(<div className="grid items-center gap-8 lg:grid-cols-2">
      <div>
        {string(content.eyebrow) ? <p className="mb-3 font-semibold text-blue-600">{string(content.eyebrow)}</p> : null}
        <h1 className="text-4xl font-bold leading-tight md:text-6xl">{string(content.heading) || section.title}</h1>
        {string(content.body) ? <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">{string(content.body)}</p> : null}
        <div className="mt-7 flex flex-wrap gap-3"><ActionLink value={primary} /><ActionLink value={secondary} secondary /></div>
      </div>
      {string(content.imageUrl) ? <img src={string(content.imageUrl)} alt={string(content.imageAlt)} loading="eager" decoding="async" referrerPolicy="no-referrer" className="max-h-[480px] w-full rounded-3xl object-cover" /> : null}
    </div>);
  }

  if (section.type === "rich_text") {
    return shell(<article className="prose prose-slate max-w-none dark:prose-invert">
      {section.title ? <h2>{section.title}</h2> : null}
      {strings(content.paragraphs).map((paragraph, index) => <p key={`${section.id}-${index}`}>{paragraph}</p>)}
    </article>);
  }

  if (section.type === "features") {
    const items = Array.isArray(content.items) ? content.items.map(record) : [];
    return shell(<div>
      {section.title ? <h2 className="mb-6 text-3xl font-bold">{section.title}</h2> : null}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{items.map((item, index) => <article key={`${section.id}-${index}`} className="rounded-2xl border p-6 dark:border-slate-800"><h3 className="text-lg font-semibold">{string(item.title)}</h3><p className="mt-2 text-slate-600 dark:text-slate-300">{string(item.description)}</p></article>)}</div>
    </div>);
  }

  if (section.type === "services") {
    const ids = new Set(strings(content.serviceIds));
    const selected = ids.size ? services.filter((service) => ids.has(service.id)) : services;
    return shell(<div>{string(content.heading) || section.title ? <h2 className="mb-6 text-3xl font-bold">{string(content.heading) || section.title}</h2> : null}<ServiceCards services={selected} /></div>);
  }

  if (section.type === "callout") {
    return shell(<div className="rounded-3xl bg-slate-100 p-8 dark:bg-slate-900"><h2 className="text-2xl font-bold">{string(content.heading) || section.title}</h2><p className="mt-3 text-lg">{string(content.body)}</p><div className="mt-5"><ActionLink value={content.action} /></div></div>);
  }

  if (section.type === "image") {
    return shell(<figure><img src={string(content.url)} alt={string(content.alt)} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-h-[720px] w-full rounded-3xl object-cover" />{string(content.caption) ? <figcaption className="mt-3 text-center text-sm text-slate-500">{string(content.caption)}</figcaption> : null}</figure>);
  }

  if (section.type === "faq") {
    const items = Array.isArray(content.items) ? content.items.map(record) : [];
    return shell(<div>{section.title ? <h2 className="mb-6 text-3xl font-bold">{section.title}</h2> : null}<div className="space-y-3">{items.map((item, index) => <details key={`${section.id}-${index}`} className="rounded-xl border p-4 dark:border-slate-800"><summary className="cursor-pointer font-semibold">{string(item.question)}</summary><p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{string(item.answer)}</p></details>)}</div></div>);
  }

  if (section.type === "cta") {
    return shell(<div className="rounded-3xl bg-blue-600 p-9 text-white"><h2 className="text-3xl font-bold">{string(content.heading)}</h2>{string(content.body) ? <p className="mt-3 text-lg text-blue-100">{string(content.body)}</p> : null}<div className="mt-6"><ActionLink value={content.action} secondary /></div></div>);
  }

  const data = record(content.data);
  return shell(<div className="rounded-2xl border p-6 dark:border-slate-800">{section.title ? <h2 className="mb-4 text-2xl font-bold">{section.title}</h2> : null}<dl className="grid gap-3">{Object.entries(data).map(([key, value]) => <div key={key}><dt className="font-semibold">{key}</dt><dd className="text-slate-600 dark:text-slate-300">{Array.isArray(value) ? value.join("، ") : String(value ?? "")}</dd></div>)}</dl></div>);
}

export function ManagedPublicPage({ data }: { data: PublicPageData }) {
  return <main dir="rtl" className="min-h-screen bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <header className="border-b dark:border-slate-800"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5"><Link href={`/site/${data.organization.slug}/${data.page.slug}`} className="text-lg font-bold">{data.organization.name}</Link><Link href="/login" className="text-sm text-blue-600">تسجيل الدخول</Link></div></header>
    {data.sections.map((section) => <Section key={section.id} section={section} services={data.services} />)}
    {!data.sections.length ? <section className="mx-auto max-w-4xl px-5 py-20 text-center"><h1 className="text-4xl font-bold">{data.page.title}</h1>{data.page.excerpt ? <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">{data.page.excerpt}</p> : null}</section> : null}
    <footer className="mt-16 border-t px-5 py-8 text-center text-sm text-slate-500 dark:border-slate-800">{data.organization.name}</footer>
  </main>;
}
