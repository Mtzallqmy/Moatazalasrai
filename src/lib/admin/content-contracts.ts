import { z } from "zod";

const uuid = z.string().uuid();
const slug = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const key = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const status = z.enum(["draft", "active", "published", "disabled", "hidden", "deleted"]);
const safeUrl = z.string().trim().max(2_000).refine((value) => {
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}, "يجب استخدام مسار داخلي أو رابط HTTPS.");

const actionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  href: safeUrl,
}).strict();

const heroContent = z.object({
  eyebrow: z.string().trim().max(120).optional(),
  heading: z.string().trim().min(1).max(240),
  body: z.string().trim().max(2_000).optional(),
  primaryAction: actionSchema.optional(),
  secondaryAction: actionSchema.optional(),
  imageUrl: safeUrl.optional(),
  imageAlt: z.string().trim().max(300).optional(),
}).strict();

const richTextContent = z.object({
  paragraphs: z.array(z.string().trim().min(1).max(5_000)).min(1).max(50),
}).strict();

const featuresContent = z.object({
  items: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1_500),
    icon: z.string().trim().max(80).optional(),
  }).strict()).min(1).max(24),
}).strict();

const servicesContent = z.object({
  serviceIds: z.array(uuid).max(50).default([]),
  heading: z.string().trim().max(240).optional(),
}).strict();

const calloutContent = z.object({
  heading: z.string().trim().max(240).optional(),
  body: z.string().trim().min(1).max(3_000),
  action: actionSchema.optional(),
}).strict();

const imageContent = z.object({
  url: safeUrl,
  alt: z.string().trim().min(1).max(300),
  caption: z.string().trim().max(500).optional(),
}).strict();

const faqContent = z.object({
  items: z.array(z.object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(4_000),
  }).strict()).min(1).max(50),
}).strict();

const ctaContent = z.object({
  heading: z.string().trim().min(1).max(240),
  body: z.string().trim().max(2_000).optional(),
  action: actionSchema,
}).strict();

const customContent = z.object({
  data: z.record(z.string().max(100), z.union([
    z.string().max(5_000), z.number(), z.boolean(), z.null(),
    z.array(z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()])).max(100),
  ])).default({}),
}).strict();

export const sectionPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), content: heroContent }).strict(),
  z.object({ type: z.literal("rich_text"), content: richTextContent }).strict(),
  z.object({ type: z.literal("features"), content: featuresContent }).strict(),
  z.object({ type: z.literal("services"), content: servicesContent }).strict(),
  z.object({ type: z.literal("callout"), content: calloutContent }).strict(),
  z.object({ type: z.literal("image"), content: imageContent }).strict(),
  z.object({ type: z.literal("faq"), content: faqContent }).strict(),
  z.object({ type: z.literal("cta"), content: ctaContent }).strict(),
  z.object({ type: z.literal("custom"), content: customContent }).strict(),
]);

const seoSchema = z.object({
  title: z.string().trim().max(70).optional(),
  description: z.string().trim().max(180).optional(),
  canonicalUrl: safeUrl.optional(),
  noIndex: z.boolean().optional(),
}).strict();

export const contentOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("page.upsert"),
    id: uuid.optional(),
    slug,
    title: z.string().trim().min(1).max(240),
    excerpt: z.string().trim().max(1_000).nullable().optional(),
    status: status.default("draft"),
    template: z.enum(["standard", "landing", "documentation"]).default("standard"),
    position: z.number().int().min(0).max(10_000).default(100),
    seo: seoSchema.default({}),
    settings: z.object({
      showHeader: z.boolean().default(true),
      showFooter: z.boolean().default(true),
      container: z.enum(["narrow", "standard", "wide"]).default("standard"),
    }).strict().default({ showHeader: true, showFooter: true, container: "standard" }),
    changeSummary: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({ operation: z.literal("page.delete"), id: uuid }).strict(),
  z.object({ operation: z.literal("page.restore"), id: uuid }).strict(),
  z.object({ operation: z.literal("page.purge"), id: uuid }).strict(),
  z.object({
    operation: z.literal("section.upsert"),
    id: uuid.optional(),
    pageId: uuid,
    key,
    title: z.string().trim().max(240).nullable().optional(),
    status: status.default("active"),
    position: z.number().int().min(0).max(10_000).default(100),
    payload: sectionPayloadSchema,
    settings: z.object({
      width: z.enum(["narrow", "standard", "wide", "full"]).default("standard"),
      alignment: z.enum(["start", "center", "end"]).default("start"),
    }).strict().default({ width: "standard", alignment: "start" }),
    changeSummary: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({ operation: z.literal("section.delete"), id: uuid }).strict(),
  z.object({ operation: z.literal("section.restore"), id: uuid }).strict(),
  z.object({
    operation: z.literal("service.upsert"),
    id: uuid.optional(),
    slug,
    name: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(1_000).nullable().optional(),
    description: z.string().trim().max(8_000).nullable().optional(),
    status: status.default("active"),
    position: z.number().int().min(0).max(10_000).default(100),
    icon: z.string().trim().max(80).nullable().optional(),
    imageUrl: safeUrl.nullable().optional(),
    actionLabel: z.string().trim().max(80).nullable().optional(),
    actionUrl: safeUrl.nullable().optional(),
    config: z.record(z.string().max(100), z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()])).default({}),
    changeSummary: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({ operation: z.literal("service.delete"), id: uuid }).strict(),
  z.object({ operation: z.literal("service.restore"), id: uuid }).strict(),
  z.object({
    operation: z.literal("menu.upsert"),
    id: uuid.optional(),
    key,
    name: z.string().trim().min(1).max(160),
    status: status.default("active"),
    settings: z.object({ orientation: z.enum(["horizontal", "vertical"]).default("horizontal") }).strict().default({ orientation: "horizontal" }),
  }).strict(),
  z.object({
    operation: z.literal("menu_item.upsert"),
    id: uuid.optional(),
    menuId: uuid,
    key,
    parentKey: key.nullable().optional(),
    label: z.string().trim().min(1).max(160),
    href: safeUrl.nullable().optional(),
    pageId: uuid.nullable().optional(),
    status: status.default("active"),
    position: z.number().int().min(0).max(10_000).default(100),
    settings: z.object({ openInNewTab: z.boolean().default(false) }).strict().default({ openInNewTab: false }),
  }).strict().refine((value) => Boolean(value.href || value.pageId), { message: "يجب ربط عنصر القائمة بصفحة أو رابط." }),
  z.object({ operation: z.literal("menu_item.delete"), id: uuid }).strict(),
  z.object({ operation: z.literal("revision.restore"), id: uuid }).strict(),
]);

export type ContentOperation = z.infer<typeof contentOperationSchema>;
