import { z } from "zod";
import { browserPlanSchema } from "@/lib/browser/contracts";

const safePath = z.string().trim().min(1).max(500).regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/);

export const dataInterpreterRunSchema = z.object({
  title: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:_-]+$/),
  dataset: z.union([
    z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(100_000),
    z.record(z.string(), z.unknown()),
  ]),
  objective: z.string().trim().min(1).max(4_000),
}).strict();

export const codingAgentRunSchema = z.object({
  title: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:_-]+$/),
  objective: z.string().trim().min(1).max(8_000),
  files: z.record(safePath, z.string().max(512_000)).refine((files) => Object.keys(files).length <= 200, "Too many files"),
  operations: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("write"), path: safePath, content: z.string().max(512_000) }).strict(),
    z.object({ kind: z.literal("delete"), path: safePath }).strict(),
  ])).min(1).max(100),
}).strict();

export const browserAgentRunSchema = z.object({
  title: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:_-]+$/),
  startUrl: z.string().url().max(2_000),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).min(1).max(20),
  plan: browserPlanSchema,
}).strict().superRefine((value, context) => {
  const host = new URL(value.startUrl).hostname.toLowerCase();
  if (!value.allowedDomains.map((item) => item.toLowerCase()).includes(host)) {
    context.addIssue({ code: "custom", path: ["startUrl"], message: "startUrl must be inside allowedDomains" });
  }
});

export const voiceStudioRunSchema = z.object({
  title: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9:_-]+$/),
  provider: z.enum(["openai", "elevenlabs"]),
  voiceId: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(50_000),
  format: z.enum(["mp3", "wav", "opus"]).default("mp3"),
  model: z.string().trim().min(1).max(200).optional(),
}).strict();

export const operationalToolRunRequestSchema = z.discriminatedUnion("toolId", [
  dataInterpreterRunSchema.extend({ toolId: z.literal("data.interpreter") }),
  codingAgentRunSchema.extend({ toolId: z.literal("coding.agent") }),
  browserAgentRunSchema.extend({ toolId: z.literal("browser.agent") }),
  voiceStudioRunSchema.extend({ toolId: z.literal("voice.studio") }),
]);

export type OperationalToolRunRequest = z.infer<typeof operationalToolRunRequestSchema>;
