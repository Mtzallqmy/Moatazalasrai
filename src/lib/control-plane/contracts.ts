import { z } from "zod";
import { ALL_PERMISSIONS } from "@/lib/auth/permissions";

const uuid = z.string().uuid();
const key = z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9_.-]*$/);
const channel = z.enum(["whatsapp", "email", "push", "internal"]);

export const controlPlaneOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("module.update"),
    id: uuid,
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(["active", "disabled", "hidden", "deleted"]).optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    operation: z.literal("feature.update"),
    id: uuid,
    enabled: z.boolean().optional(),
    rolloutPercentage: z.number().int().min(0).max(100).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    operation: z.literal("setting.upsert"),
    namespace: key.default("general"),
    key,
    value: z.unknown(),
    sensitive: z.boolean().default(false),
  }).strict(),
  z.object({
    operation: z.literal("role.upsert"),
    id: uuid.optional(),
    key,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    enabled: z.boolean().default(true),
    permissions: z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length),
  }).strict(),
  z.object({
    operation: z.literal("role.assign"),
    organizationMemberId: uuid,
    roleId: uuid,
  }).strict(),
  z.object({
    operation: z.literal("template.upsert"),
    id: uuid.optional(),
    key,
    name: z.string().trim().min(2).max(160),
    channel,
    eventKey: key,
    locale: z.string().trim().min(2).max(16).default("ar"),
    subject: z.string().max(500).nullable().optional(),
    body: z.string().trim().min(1).max(12_000),
    variables: z.array(key).max(80),
    whatsappTemplateName: key.nullable().optional(),
    whatsappTemplateStatus: z.string().trim().max(80).default("not_submitted"),
    enabled: z.boolean().default(true),
  }).strict(),
  z.object({
    operation: z.literal("rule.upsert"),
    id: uuid.optional(),
    name: z.string().trim().min(2).max(160),
    eventKey: key,
    channel,
    templateId: uuid,
    audienceType: z.enum(["event_user", "owners", "explicit"]),
    audienceConfig: z.record(z.string(), z.unknown()).default({}),
    priority: z.number().int().min(0).max(10_000).default(100),
    enabled: z.boolean().default(true),
  }).strict(),
  z.object({ operation: z.literal("trash.restore"), id: uuid }).strict(),
  z.object({ operation: z.literal("trash.purge"), id: uuid }).strict(),
]);

export type ControlPlaneOperation = z.infer<typeof controlPlaneOperationSchema>;
