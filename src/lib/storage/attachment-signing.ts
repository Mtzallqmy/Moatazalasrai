import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/http/api";

const MAX_TTL_SECONDS = 300;

type AttachmentTokenPayload = {
  v: 1;
  attachmentId: string;
  organizationId: string;
  expiresAt: number;
  disposition: "attachment" | "inline";
};

function signingSecret() {
  const configured = process.env.ATTACHMENT_SIGNING_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(503, "ATTACHMENT_SIGNING_UNAVAILABLE", "خدمة روابط الملفات الآمنة غير مهيأة.");
  }
  return "development-only-attachment-signing-secret";
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload, "utf8").digest("base64url");
}

function configuredTtl() {
  const value = Number(process.env.ATTACHMENT_URL_TTL_SECONDS ?? 60);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 30), MAX_TTL_SECONDS) : 60;
}

export function createAttachmentDownloadToken(input: {
  attachmentId: string;
  organizationId: string;
  disposition?: "attachment" | "inline";
  ttlSeconds?: number;
}) {
  const ttlSeconds = Math.min(Math.max(Math.floor(input.ttlSeconds ?? configuredTtl()), 30), MAX_TTL_SECONDS);
  const payload: AttachmentTokenPayload = {
    v: 1,
    attachmentId: input.attachmentId,
    organizationId: input.organizationId,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    disposition: input.disposition ?? "attachment",
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${encoded}.${signature(encoded)}`, expiresAt: new Date(payload.expiresAt * 1000) };
}

export function createAttachmentDownloadUrl(input: {
  origin: string;
  attachmentId: string;
  organizationId: string;
  disposition?: "attachment" | "inline";
  ttlSeconds?: number;
}) {
  const signed = createAttachmentDownloadToken(input);
  const url = new URL("/api/attachments/download", input.origin);
  url.searchParams.set("token", signed.token);
  return { url: url.toString(), expiresAt: signed.expiresAt };
}

export function verifyAttachmentDownloadToken(token: string) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) throw new ApiError(401, "ATTACHMENT_LINK_INVALID", "رابط الملف غير صالح.");
  const expected = Buffer.from(signature(encoded), "base64url");
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new ApiError(401, "ATTACHMENT_LINK_INVALID", "رابط الملف غير صالح.");
  }
  let payload: AttachmentTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AttachmentTokenPayload;
  } catch {
    throw new ApiError(401, "ATTACHMENT_LINK_INVALID", "رابط الملف غير صالح.");
  }
  if (payload.v !== 1
    || !/^[0-9a-f-]{36}$/i.test(payload.attachmentId)
    || !/^[0-9a-f-]{36}$/i.test(payload.organizationId)
    || (payload.disposition !== "attachment" && payload.disposition !== "inline")
    || !Number.isSafeInteger(payload.expiresAt)) {
    throw new ApiError(401, "ATTACHMENT_LINK_INVALID", "رابط الملف غير صالح.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.expiresAt <= now) throw new ApiError(410, "ATTACHMENT_LINK_EXPIRED", "انتهت صلاحية رابط الملف.");
  if (payload.expiresAt - now > MAX_TTL_SECONDS + 5) {
    throw new ApiError(401, "ATTACHMENT_LINK_INVALID", "مدة رابط الملف غير مسموحة.");
  }
  return payload;
}
