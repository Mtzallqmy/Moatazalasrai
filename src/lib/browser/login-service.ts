import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { browserLoginSessions } from "@/db/browser-login-schema";
import { siteConnections } from "@/db/site-connections-schema";
import { auditLogs } from "@/db/schema";
import {
  cancelInteractiveBrowserLogin,
  getInteractiveBrowserLogin,
  startInteractiveBrowserLogin,
} from "@/lib/browser/runner-client";
import type { z } from "zod";
import type { browserLoginStartSchema } from "@/lib/browser/contracts";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/http/api";
import {
  normalizeDomainAllowlist,
  validatePublicSiteDomain,
} from "@/lib/site-connections/domains";
import { encryptSecret } from "@/lib/security/encryption";

export type BrowserLoginStartInput = z.infer<typeof browserLoginStartSchema>;

function assertInteractiveLoginEnabled() {
  const config = env();
  if (!config.browserAgentEnabled || !config.browserInteractiveLoginEnabled) {
    throw new ApiError(404, "FEATURE_DISABLED", "تسجيل الدخول التفاعلي للمتصفح غير مفعّل.");
  }
}

export async function beginBrowserLogin(input: {
  organizationId: string;
  userId: string;
  requestId: string;
  body: BrowserLoginStartInput;
}) {
  assertInteractiveLoginEnabled();
  const siteDomain = await validatePublicSiteDomain(input.body.siteDomain);
  const allowedDomains = normalizeDomainAllowlist(siteDomain, input.body.allowedDomains);
  await Promise.all(allowedDomains.map(validatePublicSiteDomain));
  const connectionId = crypto.randomUUID();
  const loginDomains = [...new Set([
    ...allowedDomains,
    "accounts.google.com",
    "google.com",
    "gstatic.com",
    "googleusercontent.com",
    "appleid.apple.com",
    "login.microsoftonline.com",
    "microsoftonline.com",
    "live.com",
  ])];
  const runner = await startInteractiveBrowserLogin({
    tenantId: input.organizationId,
    connectionId,
    startUrl: `https://${siteDomain}`,
    allowedDomains: loginDomains,
    maxPages: env().browserMaxPages,
  });
  try {
    await db().transaction(async (tx) => {
      await tx.insert(siteConnections).values({
        id: connectionId,
        organizationId: input.organizationId,
        createdByUserId: input.userId,
        name: input.body.name,
        siteDomain,
        connectorType: "browser",
        connectorKey: "browser-generic",
        status: "pending",
        allowedDomains,
        grantedScopes: [],
        metadata: { loginMethod: "interactive_browser" },
      });
      await tx.insert(browserLoginSessions).values({
        organizationId: input.organizationId,
        userId: input.userId,
        siteConnectionId: connectionId,
        externalSessionId: runner.sessionId,
        status: "active",
        expiresAt: new Date(runner.expiresAt),
      });
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        actorType: "user",
        actorId: input.userId,
        action: "browser_login.started",
        resourceType: "site_connection",
        resourceId: connectionId,
        metadata: { siteDomain, allowedDomains, requestId: input.requestId },
      });
    });
  } catch (error) {
    await cancelInteractiveBrowserLogin({ tenantId: input.organizationId, sessionId: runner.sessionId }).catch(() => undefined);
    throw error;
  }
  return {
    connectionId,
    sessionId: runner.sessionId,
    interactiveUrl: runner.interactiveUrl,
    expiresAt: runner.expiresAt,
  };
}

export async function getBrowserLoginStatus(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  requestId: string;
}) {
  assertInteractiveLoginEnabled();
  const [session] = await db().select().from(browserLoginSessions).where(and(
    eq(browserLoginSessions.id, input.sessionId),
    eq(browserLoginSessions.organizationId, input.organizationId),
    eq(browserLoginSessions.userId, input.userId),
  )).limit(1);
  if (!session) throw new ApiError(404, "BROWSER_LOGIN_NOT_FOUND", "جلسة تسجيل الدخول غير موجودة.");
  if (session.status !== "active") return { status: session.status, connectionId: session.siteConnectionId };
  if (session.expiresAt <= new Date()) {
    await db().update(browserLoginSessions).set({ status: "expired", updatedAt: new Date() }).where(eq(browserLoginSessions.id, session.id));
    return { status: "expired" as const, connectionId: session.siteConnectionId };
  }
  const runner = await getInteractiveBrowserLogin({ tenantId: input.organizationId, sessionId: session.externalSessionId });
  if (runner.status === "active") return { status: "active" as const, connectionId: session.siteConnectionId, currentUrl: runner.currentUrl };

  const now = new Date();
  if (runner.status === "completed") {
    if (!runner.storageState) throw new ApiError(502, "BROWSER_STORAGE_STATE_MISSING", "لم تُعد خدمة المتصفح حالة جلسة صالحة.");
    const [connection] = await db().select({ allowedDomains: siteConnections.allowedDomains }).from(siteConnections).where(and(
      eq(siteConnections.id, session.siteConnectionId),
      eq(siteConnections.organizationId, input.organizationId),
    )).limit(1);
    if (!connection) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "الاتصال غير موجود.");
    if (runner.currentUrl) {
      const hostname = new URL(runner.currentUrl).hostname.toLowerCase().replace(/\.$/, "");
      if (!connection.allowedDomains.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))) {
        throw new ApiError(403, "BROWSER_LOGIN_DOMAIN_MISMATCH", "انتهت جلسة الدخول على نطاق خارج نطاقات الاتصال.");
      }
    }
    await db().transaction(async (tx) => {
      await tx.update(siteConnections).set({
        status: "verified",
        encryptedSessionState: encryptSecret(
          JSON.stringify(runner.storageState),
          `browser-session:${input.organizationId}:${session.siteConnectionId}`,
        ),
        credentialKeyId: env().credentialEncryptionKeyId,
        lastVerifiedAt: now,
        metadata: { loginMethod: "interactive_browser", verifiedUrl: runner.currentUrl ?? null },
        updatedAt: now,
      }).where(and(
        eq(siteConnections.id, session.siteConnectionId),
        eq(siteConnections.organizationId, input.organizationId),
      ));
      await tx.update(browserLoginSessions).set({ status: "completed", completedAt: now, updatedAt: now })
        .where(eq(browserLoginSessions.id, session.id));
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        actorType: "user",
        actorId: input.userId,
        action: "browser_login.completed",
        resourceType: "site_connection",
        resourceId: session.siteConnectionId,
        metadata: { requestId: input.requestId },
      });
    });
    return { status: "completed" as const, connectionId: session.siteConnectionId };
  }

  await db().transaction(async (tx) => {
    await tx.update(browserLoginSessions).set({ status: runner.status, errorCode: runner.errorCode ?? null, updatedAt: now })
      .where(eq(browserLoginSessions.id, session.id));
    await tx.update(siteConnections).set({ status: runner.status === "failed" ? "failed" : "pending", updatedAt: now })
      .where(and(eq(siteConnections.id, session.siteConnectionId), eq(siteConnections.organizationId, input.organizationId)));
  });
  return { status: runner.status, connectionId: session.siteConnectionId, errorCode: runner.errorCode };
}

export async function cancelBrowserLogin(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  requestId: string;
}) {
  assertInteractiveLoginEnabled();
  const [session] = await db().select().from(browserLoginSessions).where(and(
    eq(browserLoginSessions.id, input.sessionId),
    eq(browserLoginSessions.organizationId, input.organizationId),
    eq(browserLoginSessions.userId, input.userId),
  )).limit(1);
  if (!session) throw new ApiError(404, "BROWSER_LOGIN_NOT_FOUND", "جلسة تسجيل الدخول غير موجودة.");
  await cancelInteractiveBrowserLogin({ tenantId: input.organizationId, sessionId: session.externalSessionId }).catch(() => undefined);
  const now = new Date();
  await db().transaction(async (tx) => {
    await tx.update(browserLoginSessions).set({ status: "cancelled", updatedAt: now }).where(eq(browserLoginSessions.id, session.id));
    await tx.delete(siteConnections).where(and(
      eq(siteConnections.id, session.siteConnectionId),
      eq(siteConnections.organizationId, input.organizationId),
      eq(siteConnections.status, "pending"),
    ));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "browser_login.cancelled",
      resourceType: "site_connection",
      resourceId: session.siteConnectionId,
      metadata: { requestId: input.requestId },
    });
  });
  return { cancelled: true, connectionId: session.siteConnectionId };
}

export async function listBrowserLoginSessions(input: { organizationId: string; userId: string }) {
  assertInteractiveLoginEnabled();
  return db().select({
    id: browserLoginSessions.id,
    siteConnectionId: browserLoginSessions.siteConnectionId,
    status: browserLoginSessions.status,
    expiresAt: browserLoginSessions.expiresAt,
    createdAt: browserLoginSessions.createdAt,
    updatedAt: browserLoginSessions.updatedAt,
  }).from(browserLoginSessions).where(and(
    eq(browserLoginSessions.organizationId, input.organizationId),
    eq(browserLoginSessions.userId, input.userId),
  )).orderBy(desc(browserLoginSessions.createdAt)).limit(20);
}
