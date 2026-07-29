import { z } from "zod";

export const uuidSchema = z.uuid();
export const providerKindSchema = z.enum(["openai", "anthropic", "gemini", "openai_compatible"]);
export const agentStatusSchema = z.enum(["draft", "published", "archived"]);
export const roleSchema = z.enum(["owner", "admin", "developer", "operator", "viewer"]);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().max(320).pipe(z.email()).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  organizationName: z.string().trim().min(2).max(120),
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().max(320).pipe(z.email()).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();

export const switchOrganizationSchema = z.object({
  organizationId: uuidSchema,
}).strict();

export const providerInputSchema = z.object({
  provider: providerKindSchema,
  name: z.string().trim().min(2).max(80),
  apiKey: z.string().trim().min(8).max(1000),
  baseUrl: z.url().max(2048).optional(),
  testModel: z.string().trim().min(1).max(200).optional(),
}).strict();

export const providerValidationSchema = providerInputSchema.pick({
  provider: true,
  apiKey: true,
  baseUrl: true,
  testModel: true,
});

export const providerUpdateSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(2).max(80).optional(),
  baseUrl: z.url().max(2048).optional(),
  apiKey: z.string().trim().min(8).max(1000).optional(),
  enabled: z.boolean().optional(),
  revalidate: z.boolean().optional(),
  testModel: z.string().trim().min(1).max(200).optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "No provider changes supplied.");

export const providerDeleteSchema = z.object({ id: uuidSchema }).strict();

export const agentCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
  providerCredentialId: uuidSchema,
  model: z.string().trim().min(1).max(200),
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

export const chatStreamSchema = z.object({
  conversationId: uuidSchema,
  message: z.string().trim().min(1).max(30_000),
  attachmentIds: z.array(uuidSchema).max(8).default([]),
  clientRequestId: uuidSchema.optional(),
  providerCredentialId: uuidSchema.optional(),
  model: z.string().trim().min(1).max(200).optional(),
  inputKind: z.enum(["text", "image", "file", "coding", "summary", "analysis", "audio", "video"]).default("text"),
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
