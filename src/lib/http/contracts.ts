import { z } from "zod";

export const uuidSchema = z.uuid();
export const providerKindSchema = z.enum(["openai", "anthropic", "gemini", "openai_compatible"]);
export const providerTypeIdSchema = z.enum([
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "openai",
  "anthropic",
  "google-ai-studio",
  "custom-openai-compatible",
]);
export const providerTransportModeSchema = z.enum([
  "direct",
  "cloudflare_ai_gateway_native",
  "cloudflare_ai_gateway_rest",
  "cloudflare_workers_ai",
]);
export const providerCredentialModeSchema = z.enum(["encrypted_byok", "cloudflare_provider_key", "cloudflare_binding"]);
export const providerHealthStatusSchema = z.enum([
  "unconfigured", "validating", "healthy", "degraded", "rate_limited", "unauthorized",
  "model_unavailable", "network_error", "misconfigured", "disabled", "unknown",
]);
export const providerSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/);
export const agentStatusSchema = z.enum(["draft", "published", "archived"]);
export const roleSchema = z.enum(["owner", "admin", "developer", "operator", "viewer", "member"]);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().max(320).pipe(z.email()).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  organizationName: z.string().trim().min(2).max(120).optional(),
  turnstileToken: z.string().trim().min(1).max(2048).optional(),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().max(320).pipe(z.email()).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  turnstileToken: z.string().trim().min(1).max(2048).optional(),
}).strict();

export const switchOrganizationSchema = z.object({ organizationId: uuidSchema }).strict();

const providerInputBaseSchema = z.object({
  provider: providerKindSchema,
  providerTypeId: providerTypeIdSchema.optional(),
  providerSlug: providerSlugSchema.optional(),
  name: z.string().trim().min(2).max(80),
  apiKey: z.string().trim().min(8).max(4000).optional(),
  baseUrl: z.url().max(2048).optional(),
  transportMode: providerTransportModeSchema.default("direct"),
  credentialMode: providerCredentialModeSchema.default("encrypted_byok"),
  gatewayId: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,96}$/).optional(),
  keyAlias: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,96}$/).optional(),
  defaultModel: z.string().trim().min(1).max(300).optional(),
  allowedModels: z.array(z.string().trim().min(1).max(300)).max(200).default([]),
  testModel: z.string().trim().min(1).max(300).optional(),
  manualModel: z.string().trim().min(1).max(300).optional(),
  isDefault: z.boolean().default(false),
  saveInvalid: z.boolean().default(false),
  skipCache: z.boolean().default(true),
  cacheTtl: z.number().int().min(0).max(31_536_000).optional(),
  collectLog: z.boolean().default(false),
}).strict();

type ProviderConfigForValidation = z.infer<typeof providerInputBaseSchema>;

function validateProviderRouting(value: ProviderConfigForValidation, context: z.RefinementCtx) {
  if (value.transportMode === "direct" && (!value.apiKey || value.credentialMode !== "encrypted_byok")) {
    context.addIssue({ code: "custom", path: ["apiKey"], message: "المزوّد المباشر يتطلب مفتاح API." });
  }
  if (value.transportMode === "cloudflare_ai_gateway_native") {
    if (!value.gatewayId) context.addIssue({ code: "custom", path: ["gatewayId"], message: "Gateway ID مطلوب." });
    if (value.credentialMode === "cloudflare_provider_key" && !value.keyAlias) {
      context.addIssue({ code: "custom", path: ["keyAlias"], message: "Provider Key Alias مطلوب." });
    }
    if (value.credentialMode === "encrypted_byok" && !value.apiKey) {
      context.addIssue({ code: "custom", path: ["apiKey"], message: "أدخل مفتاح المزود أو استخدم Provider Key Alias." });
    }
  }
  if ((value.transportMode === "cloudflare_ai_gateway_rest" || value.transportMode === "cloudflare_workers_ai")
    && value.credentialMode !== "cloudflare_binding") {
    context.addIssue({ code: "custom", path: ["credentialMode"], message: "هذا المسار يستخدم سر Cloudflare أو binding ولا يقبل مفتاح مزود من العميل." });
  }
  if (value.transportMode === "cloudflare_workers_ai" && value.providerTypeId !== "cloudflare-workers-ai") {
    context.addIssue({ code: "custom", path: ["providerTypeId"], message: "معرف Workers AI غير مطابق." });
  }
}

export const providerInputSchema = providerInputBaseSchema.superRefine(validateProviderRouting);

const providerValidationBaseSchema = providerInputBaseSchema.omit({
  name: true,
  isDefault: true,
  saveInvalid: true,
});

export const providerValidationSchema = providerValidationBaseSchema.superRefine((value, context) => {
  validateProviderRouting({
    ...value,
    name: "validation",
    isDefault: false,
    saveInvalid: false,
  }, context);
});

export const providerVerifiedSaveSchema = providerInputBaseSchema.extend({
  validationId: uuidSchema,
}).superRefine(validateProviderRouting);

export const providerUpdateSchema = z.object({
  id: uuidSchema,
  providerTypeId: providerTypeIdSchema.optional(),
  providerSlug: providerSlugSchema.optional(),
  name: z.string().trim().min(2).max(80).optional(),
  baseUrl: z.url().max(2048).optional(),
  apiKey: z.string().trim().min(8).max(4000).optional(),
  transportMode: providerTransportModeSchema.optional(),
  credentialMode: providerCredentialModeSchema.optional(),
  gatewayId: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,96}$/).nullable().optional(),
  keyAlias: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,96}$/).nullable().optional(),
  defaultModel: z.string().trim().min(1).max(300).nullable().optional(),
  allowedModels: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  revalidate: z.boolean().optional(),
  testModel: z.string().trim().min(1).max(300).optional(),
  manualModel: z.string().trim().min(1).max(300).optional(),
  skipCache: z.boolean().optional(),
  cacheTtl: z.number().int().min(0).max(31_536_000).nullable().optional(),
  collectLog: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "No provider changes supplied.");

export const providerDeleteSchema = z.object({ id: uuidSchema }).strict();

export const agentCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
  providerCredentialId: uuidSchema,
  model: z.string().trim().min(1).max(300),
  instructions: z.string().trim().min(1).max(30_000),
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.number().int().min(64).max(32_768).default(2048),
  publish: z.boolean().default(false),
}).strict();

export const agentUpdateSchema = agentCreateSchema.partial().extend({
  id: uuidSchema,
  status: agentStatusSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "No agent changes supplied.");

export const conversationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), agentId: uuidSchema }).strict(),
  z.object({ action: z.literal("rename"), conversationId: uuidSchema, title: z.string().trim().min(1).max(120) }).strict(),
  z.object({ action: z.literal("archive"), conversationId: uuidSchema, archived: z.boolean() }).strict(),
  z.object({ action: z.literal("delete"), conversationId: uuidSchema }).strict(),
  z.object({ action: z.literal("restore"), conversationId: uuidSchema }).strict(),
  z.object({ action: z.literal("pin"), conversationId: uuidSchema, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal("move"), conversationId: uuidSchema, folderId: uuidSchema.nullable() }).strict(),
]);

const mcpArgumentsSchema = z.record(
  z.string().trim().min(1).max(100),
  z.string().max(20_000),
).refine((value) => Object.keys(value).length <= 40, "Too many MCP arguments.");

export const mcpResourceSelectionSchema = z.object({
  serverId: uuidSchema,
  uri: z.string().trim().min(1).max(4096),
}).strict();

export const mcpPromptSelectionSchema = z.object({
  serverId: uuidSchema,
  name: z.string().trim().min(1).max(200),
  arguments: mcpArgumentsSchema.default({}),
}).strict();

export const chatStreamSchema = z.object({
  conversationId: uuidSchema,
  message: z.string().trim().min(1).max(30_000),
  attachmentIds: z.array(uuidSchema).max(8).default([]),
  clientRequestId: uuidSchema.optional(),
  providerCredentialId: uuidSchema.optional(),
  model: z.string().trim().min(1).max(300).optional(),
  inputKind: z.enum(["text", "image", "file", "coding", "summary", "analysis", "audio", "video"]).default("text"),
  knowledgeBaseId: uuidSchema.optional(),
  useMemory: z.boolean().default(false),
  mcpResources: z.array(mcpResourceSelectionSchema).max(12).default([]),
  mcpPrompt: mcpPromptSelectionSchema.optional(),
}).strict();

export const conversationDraftSchema = z.object({
  conversationId: uuidSchema,
  content: z.string().max(30_000),
}).strict();

export const runCancelSchema = z.object({ runId: uuidSchema }).strict();

export const platformBootstrapSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,50}$/),
}).strict();

export const platformRunSchema = z.object({
  agentId: uuidSchema,
  conversationId: uuidSchema,
  input: z.string().trim().min(1).max(30_000),
}).strict();

export const memberMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), email: z.string().trim().max(320).pipe(z.email()).transform((value) => value.toLowerCase()), role: roleSchema.exclude(["owner"]) }).strict(),
  z.object({ action: z.literal("role"), memberId: uuidSchema, role: roleSchema }).strict(),
  z.object({ action: z.literal("remove"), memberId: uuidSchema }).strict(),
]);

export const accountMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), name: z.string().trim().min(2).max(100) }).strict(),
  z.object({ action: z.literal("organization"), name: z.string().trim().min(2).max(120) }).strict(),
  z.object({
    action: z.literal("password"),
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
  }).strict(),
]);

export const chatAppearanceSchema = z.object({
  theme: z.enum(["moataz", "whatsapp", "telegram"]),
  wallpaper: z.enum(["clean", "soft-grid", "doodles", "bubbles"]),
}).strict();

export const integrationCreateSchema = z.object({
  kind: z.enum(["telegram", "github"]),
  name: z.string().trim().min(2).max(80),
  token: z.string().trim().min(8).max(2000),
  agentId: uuidSchema.optional(),
}).strict();

export const integrationUpdateSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(2).max(80).optional(),
  token: z.string().trim().min(8).max(2000).optional(),
  agentId: uuidSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  activateWebhook: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "No integration changes supplied.");

export const integrationDeleteSchema = z.object({ id: uuidSchema }).strict();
