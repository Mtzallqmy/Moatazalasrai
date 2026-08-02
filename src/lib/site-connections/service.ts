import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  agentSiteConnections,
  siteConnectionPermissions,
  siteConnections,
} from "@/db/site-connections-schema";
import { agents, auditLogs } from "@/db/schema";
import { env } from "@/lib/config/env";
import {
  agentSiteConnectionUpsertSchema,
  siteConnectionCreateSchema,
  siteConnectionUpdateSchema,
} from "@/lib/site-connections/contracts";
import {
  normalizeDomainAllowlist,
  validatePublicSiteDomain,
} from "@/lib/site-connections/domains";
import {
  completePermissionMap,
  evaluateSitePermission,
  type BrowserRiskLevel,
  type SitePermissionAction,
} from "@/lib/site-connections/policy";
import { ApiError } from "@/lib/http/api";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/security/encryption";
import { siteConnector } from "@/server/site-connectors/registry";

type CreateInput = z.infer<typeof siteConnectionCreateSchema>;
type UpdateInput = z.infer<typeof siteConnectionUpdateSchema>;
type AssignmentInput = z.infer<typeof agentSiteConnectionUpsertSchema>;
type DatabaseTransaction = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

const publicConnectionFields = {
  id: siteConnections.id,
  organizationId: siteConnections.organizationId,
  createdByUserId: siteConnections.createdByUserId,
  name: siteConnections.name,
  siteDomain: siteConnections.siteDomain,
  connectorType: siteConnections.connectorType,
  connectorKey: siteConnections.connectorKey,
  status: siteConnections.status,
  credentialHint: siteConnections.credentialHint,
  grantedScopes: siteConnections.grantedScopes,
  allowedDomains: siteConnections.allowedDomains,
  metadata: siteConnections.metadata,
  lastVerifiedAt: siteConnections.lastVerifiedAt,
  expiresAt: siteConnections.expiresAt,
  lastUsedAt: siteConnections.lastUsedAt,
  revokedAt: siteConnections.revokedAt,
  createdAt: siteConnections.createdAt,
  updatedAt: siteConnections.updatedAt,
};

export function assertSiteConnectionsEnabled() {
  if (!env().browserAgentEnabled) {
    throw new ApiError(404, "FEATURE_DISABLED", "ميزة الحسابات المتصلة غير مفعلة.");
  }
}

async function assertAgentsBelongToOrganization(organizationId: string, agentIds: readonly string[]) {
  const uniqueIds = [...new Set(agentIds)];
  if (uniqueIds.length === 0) return;
  const rows = await db().select({ id: agents.id }).from(agents).where(and(
    eq(agents.organizationId, organizationId),
    inArray(agents.id, uniqueIds),
  ));
  if (rows.length !== uniqueIds.length) {
    throw new ApiError(422, "AGENT_UNAVAILABLE", "أحد الوكلاء المحددين غير موجود في المؤسسة الحالية.");
  }
}

async function normalizedAllowedDomains(
  siteDomainInput: string,
  requested: readonly string[],
  connectorDomains: readonly string[],
) {
  const siteDomain = await validatePublicSiteDomain(siteDomainInput);
  const candidates = normalizeDomainAllowlist(siteDomain, [...requested, ...connectorDomains]);
  await Promise.all(candidates.map(validatePublicSiteDomain));
  return { siteDomain, allowedDomains: candidates };
}

function permissionOverrides(permissions: CreateInput["agents"][number]["permissions"]) {
  return Object.fromEntries(permissions.map((permission) => [permission.action, permission.policy]));
}

async function writeAssignment(
  tx: DatabaseTransaction,
  input: {
    organizationId: string;
    connectionId: string;
    agentId: string;
    enabled: boolean;
    permissions: CreateInput["agents"][number]["permissions"];
  },
) {
  const [assignment] = await tx.insert(agentSiteConnections).values({
    organizationId: input.organizationId,
    agentId: input.agentId,
    siteConnectionId: input.connectionId,
    enabled: input.enabled,
  }).onConflictDoUpdate({
    target: [agentSiteConnections.agentId, agentSiteConnections.siteConnectionId],
    set: { enabled: input.enabled, updatedAt: new Date() },
  }).returning({ id: agentSiteConnections.id });
  if (!assignment) throw new Error("AGENT_SITE_CONNECTION_WRITE_FAILED");

  const policies = completePermissionMap(permissionOverrides(input.permissions));
  await tx.delete(siteConnectionPermissions).where(and(
    eq(siteConnectionPermissions.organizationId, input.organizationId),
    eq(siteConnectionPermissions.agentSiteConnectionId, assignment.id),
  ));
  await tx.insert(siteConnectionPermissions).values(
    Object.entries(policies).map(([action, policy]) => ({
      organizationId: input.organizationId,
      agentSiteConnectionId: assignment.id,
      action: action as SitePermissionAction,
      policy,
    })),
  );
  return assignment.id;
}

export async function createSiteConnection(input: {
  organizationId: string;
  userId: string;
  requestId: string;
  body: CreateInput;
}) {
  assertSiteConnectionsEnabled();
  const connector = siteConnector(input.body.connectorKey);
  if (connector.type !== input.body.connectorType) {
    throw new ApiError(422, "CONNECTOR_TYPE_MISMATCH", "نوع الاتصال لا يطابق الموصل المحدد.");
  }
  if (connector.type !== "api" || !input.body.credential) {
    throw new ApiError(422, "CONNECTION_METHOD_UNAVAILABLE", "استخدم مسار OAuth أو جلسة المتصفح لهذا النوع من الاتصالات.");
  }

  await assertAgentsBelongToOrganization(
    input.organizationId,
    input.body.agents.map((assignment) => assignment.agentId),
  );
  const validation = await connector.validateConnection({ token: input.body.credential });
  const { siteDomain, allowedDomains } = await normalizedAllowedDomains(
    input.body.siteDomain,
    input.body.allowedDomains,
    validation.allowedDomains,
  );

  const id = randomUUID();
  const encryptedCredentials = encryptSecret(
    JSON.stringify({ token: input.body.credential }),
    `site-connection:${input.organizationId}:${id}`,
  );
  const now = new Date();

  const result = await db().transaction(async (tx) => {
    const [connection] = await tx.insert(siteConnections).values({
      id,
      organizationId: input.organizationId,
      createdByUserId: input.userId,
      name: input.body.name,
      siteDomain,
      connectorType: input.body.connectorType,
      connectorKey: input.body.connectorKey,
      status: validation.status,
      encryptedCredentials,
      credentialKeyId: env().credentialEncryptionKeyId,
      credentialHint: maskSecret(input.body.credential),
      grantedScopes: validation.grantedScopes,
      allowedDomains,
      metadata: validation.metadata,
      lastVerifiedAt: validation.status === "verified" ? now : null,
      expiresAt: validation.expiresAt ?? null,
    }).returning(publicConnectionFields);
    if (!connection) throw new Error("SITE_CONNECTION_CREATE_FAILED");

    for (const assignment of input.body.agents) {
      await writeAssignment(tx, {
        organizationId: input.organizationId,
        connectionId: id,
        agentId: assignment.agentId,
        enabled: assignment.enabled,
        permissions: assignment.permissions,
      });
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "site_connection.created",
      resourceType: "site_connection",
      resourceId: id,
      metadata: {
        connectorKey: input.body.connectorKey,
        connectorType: input.body.connectorType,
        siteDomain,
        agentCount: input.body.agents.length,
        requestId: input.requestId,
      },
    });
    return connection;
  });

  return getSiteConnection(input.organizationId, result.id);
}

export async function listSiteConnections(organizationId: string) {
  assertSiteConnectionsEnabled();
  const connections = await db().select(publicConnectionFields).from(siteConnections)
    .where(eq(siteConnections.organizationId, organizationId))
    .orderBy(desc(siteConnections.updatedAt));
  if (connections.length === 0) return [];

  const assignments = await db().select({
    id: agentSiteConnections.id,
    connectionId: agentSiteConnections.siteConnectionId,
    agentId: agentSiteConnections.agentId,
    agentName: agents.name,
    enabled: agentSiteConnections.enabled,
    updatedAt: agentSiteConnections.updatedAt,
  }).from(agentSiteConnections)
    .innerJoin(agents, and(
      eq(agents.id, agentSiteConnections.agentId),
      eq(agents.organizationId, organizationId),
    ))
    .where(eq(agentSiteConnections.organizationId, organizationId));

  return connections.map((connection) => ({
    ...connection,
    agents: assignments.filter((assignment) => assignment.connectionId === connection.id),
  }));
}

export async function getSiteConnection(organizationId: string, connectionId: string) {
  assertSiteConnectionsEnabled();
  const [connection] = await db().select(publicConnectionFields).from(siteConnections).where(and(
    eq(siteConnections.id, connectionId),
    eq(siteConnections.organizationId, organizationId),
  )).limit(1);
  if (!connection) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "الاتصال غير موجود.");

  const assignments = await db().select({
    id: agentSiteConnections.id,
    agentId: agentSiteConnections.agentId,
    agentName: agents.name,
    enabled: agentSiteConnections.enabled,
    createdAt: agentSiteConnections.createdAt,
    updatedAt: agentSiteConnections.updatedAt,
  }).from(agentSiteConnections)
    .innerJoin(agents, and(
      eq(agents.id, agentSiteConnections.agentId),
      eq(agents.organizationId, organizationId),
    ))
    .where(and(
      eq(agentSiteConnections.organizationId, organizationId),
      eq(agentSiteConnections.siteConnectionId, connectionId),
    ));

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const permissions = assignmentIds.length === 0
    ? []
    : await db().select({
      assignmentId: siteConnectionPermissions.agentSiteConnectionId,
      action: siteConnectionPermissions.action,
      policy: siteConnectionPermissions.policy,
    }).from(siteConnectionPermissions).where(and(
      eq(siteConnectionPermissions.organizationId, organizationId),
      inArray(siteConnectionPermissions.agentSiteConnectionId, assignmentIds),
    ));

  return {
    ...connection,
    agents: assignments.map((assignment) => ({
      ...assignment,
      permissions: permissions.filter((permission) => permission.assignmentId === assignment.id)
        .map(({ action, policy }) => ({ action, policy })),
    })),
  };
}

export async function updateSiteConnection(input: {
  organizationId: string;
  userId: string;
  requestId: string;
  body: UpdateInput;
}) {
  assertSiteConnectionsEnabled();
  const [current] = await db().select().from(siteConnections).where(and(
    eq(siteConnections.id, input.body.id),
    eq(siteConnections.organizationId, input.organizationId),
  )).limit(1);
  if (!current) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "الاتصال غير موجود.");
  if (current.status === "revoked") {
    throw new ApiError(409, "SITE_CONNECTION_REVOKED", "الاتصال مسحوب ولا يمكن تعديله.");
  }

  const connector = siteConnector(current.connectorKey);
  let validation: Awaited<ReturnType<typeof connector.validateConnection>> | null = null;
  if (input.body.credential) {
    if (current.connectorType !== "api") {
      throw new ApiError(422, "CREDENTIAL_ROTATION_UNAVAILABLE", "أعد المصادقة عبر التدفق المخصص لهذا النوع.");
    }
    validation = await connector.validateConnection({ token: input.body.credential });
  }

  const allowedDomains = input.body.allowedDomains
    ? (await normalizedAllowedDomains(current.siteDomain, input.body.allowedDomains, validation?.allowedDomains ?? [])).allowedDomains
    : current.allowedDomains;
  const now = new Date();

  const [updated] = await db().update(siteConnections).set({
    ...(input.body.name === undefined ? {} : { name: input.body.name }),
    ...(input.body.allowedDomains === undefined ? {} : { allowedDomains }),
    ...(input.body.credential === undefined ? {} : {
      encryptedCredentials: encryptSecret(
        JSON.stringify({ token: input.body.credential }),
        `site-connection:${input.organizationId}:${current.id}`,
      ),
      credentialKeyId: env().credentialEncryptionKeyId,
      credentialHint: maskSecret(input.body.credential),
      status: validation!.status,
      metadata: validation!.metadata,
      grantedScopes: validation!.grantedScopes,
      lastVerifiedAt: validation!.status === "verified" ? now : null,
      expiresAt: validation!.expiresAt ?? null,
    }),
    updatedAt: now,
  }).where(and(
    eq(siteConnections.id, current.id),
    eq(siteConnections.organizationId, input.organizationId),
  )).returning(publicConnectionFields);
  if (!updated) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "الاتصال غير موجود.");

  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.userId,
    action: input.body.credential ? "site_connection.credential_rotated" : "site_connection.updated",
    resourceType: "site_connection",
    resourceId: current.id,
    metadata: {
      nameChanged: input.body.name !== undefined,
      allowlistChanged: input.body.allowedDomains !== undefined,
      credentialRotated: input.body.credential !== undefined,
      requestId: input.requestId,
    },
  });
  return updated;
}

export async function deleteSiteConnection(input: {
  organizationId: string;
  userId: string;
  connectionId: string;
  requestId: string;
}) {
  assertSiteConnectionsEnabled();
  const result = await db().transaction(async (tx) => {
    const [deleted] = await tx.delete(siteConnections).where(and(
      eq(siteConnections.id, input.connectionId),
      eq(siteConnections.organizationId, input.organizationId),
    )).returning({
      id: siteConnections.id,
      connectorKey: siteConnections.connectorKey,
      siteDomain: siteConnections.siteDomain,
    });
    if (!deleted) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "الاتصال غير موجود.");
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "site_connection.deleted",
      resourceType: "site_connection",
      resourceId: deleted.id,
      metadata: {
        connectorKey: deleted.connectorKey,
        siteDomain: deleted.siteDomain,
        credentialsDestroyed: true,
        requestId: input.requestId,
      },
    });
    return deleted;
  });
  return { deleted: true, id: result.id };
}

export async function upsertAgentSiteConnection(input: {
  organizationId: string;
  userId: string;
  requestId: string;
  body: AssignmentInput;
}) {
  assertSiteConnectionsEnabled();
  const [connection] = await db().select({ id: siteConnections.id, status: siteConnections.status })
    .from(siteConnections).where(and(
      eq(siteConnections.id, input.body.connectionId),
      eq(siteConnections.organizationId, input.organizationId),
    )).limit(1);
  if (!connection) throw new ApiError(404, "SITE_CONNECTION_NOT_FOUND", "الاتصال غير موجود.");
  if (connection.status === "revoked") {
    throw new ApiError(409, "SITE_CONNECTION_REVOKED", "لا يمكن ربط وكيل باتصال مسحوب.");
  }
  await assertAgentsBelongToOrganization(input.organizationId, [input.body.assignment.agentId]);

  await db().transaction(async (tx) => {
    await writeAssignment(tx, {
      organizationId: input.organizationId,
      connectionId: connection.id,
      agentId: input.body.assignment.agentId,
      enabled: input.body.assignment.enabled,
      permissions: input.body.assignment.permissions,
    });
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      action: "site_connection.agent_policy_updated",
      resourceType: "site_connection",
      resourceId: connection.id,
      metadata: {
        agentId: input.body.assignment.agentId,
        enabled: input.body.assignment.enabled,
        requestId: input.requestId,
      },
    });
  });
  return getSiteConnection(input.organizationId, connection.id);
}

export async function removeAgentSiteConnection(input: {
  organizationId: string;
  userId: string;
  connectionId: string;
  agentId: string;
  requestId: string;
}) {
  assertSiteConnectionsEnabled();
  const [deleted] = await db().delete(agentSiteConnections).where(and(
    eq(agentSiteConnections.organizationId, input.organizationId),
    eq(agentSiteConnections.siteConnectionId, input.connectionId),
    eq(agentSiteConnections.agentId, input.agentId),
  )).returning({ id: agentSiteConnections.id });
  if (!deleted) throw new ApiError(404, "AGENT_SITE_CONNECTION_NOT_FOUND", "الوكيل غير مرتبط بهذا الاتصال.");

  await db().insert(auditLogs).values({
    organizationId: input.organizationId,
    actorType: "user",
    actorId: input.userId,
    action: "site_connection.agent_unlinked",
    resourceType: "site_connection",
    resourceId: input.connectionId,
    metadata: { agentId: input.agentId, requestId: input.requestId },
  });
  return { deleted: true, agentId: input.agentId };
}

export async function resolveAgentSitePermission(input: {
  organizationId: string;
  agentId: string;
  connectionId: string;
  action: SitePermissionAction;
  risk: BrowserRiskLevel;
}) {
  assertSiteConnectionsEnabled();
  const [assignment] = await db().select({
    assignmentId: agentSiteConnections.id,
    connectionStatus: siteConnections.status,
  }).from(agentSiteConnections)
    .innerJoin(siteConnections, and(
      eq(siteConnections.id, agentSiteConnections.siteConnectionId),
      eq(siteConnections.organizationId, input.organizationId),
    ))
    .where(and(
      eq(agentSiteConnections.organizationId, input.organizationId),
      eq(agentSiteConnections.agentId, input.agentId),
      eq(agentSiteConnections.siteConnectionId, input.connectionId),
      eq(agentSiteConnections.enabled, true),
    ))
    .limit(1);
  if (!assignment) {
    throw new ApiError(403, "AGENT_CONNECTION_FORBIDDEN", "هذا الوكيل غير مرتبط بالاتصال.");
  }
  if (assignment.connectionStatus !== "verified") {
    throw new ApiError(409, "SITE_CONNECTION_UNAVAILABLE", "الاتصال غير موثق أو لم يعد صالحًا.");
  }

  const [permission] = await db().select({ policy: siteConnectionPermissions.policy })
    .from(siteConnectionPermissions)
    .where(and(
      eq(siteConnectionPermissions.organizationId, input.organizationId),
      eq(siteConnectionPermissions.agentSiteConnectionId, assignment.assignmentId),
      eq(siteConnectionPermissions.action, input.action),
    ))
    .limit(1);

  return evaluateSitePermission({
    action: input.action,
    risk: input.risk,
    policy: permission?.policy,
  });
}

export async function loadConnectionCredentials(organizationId: string, connectionId: string) {
  assertSiteConnectionsEnabled();
  const [connection] = await db().select({
    id: siteConnections.id,
    status: siteConnections.status,
    connectorKey: siteConnections.connectorKey,
    encryptedCredentials: siteConnections.encryptedCredentials,
  }).from(siteConnections).where(and(
    eq(siteConnections.id, connectionId),
    eq(siteConnections.organizationId, organizationId),
  )).limit(1);
  if (!connection || connection.status !== "verified" || !connection.encryptedCredentials) {
    throw new ApiError(409, "SITE_CONNECTION_UNAVAILABLE", "الاتصال غير متاح للتنفيذ.");
  }

  const plaintext = decryptSecret(
    connection.encryptedCredentials,
    `site-connection:${organizationId}:${connection.id}`,
  );
  let credentials: unknown;
  try {
    credentials = JSON.parse(plaintext);
  } catch {
    throw new ApiError(500, "SITE_CREDENTIALS_INVALID", "تعذر تحميل بيانات اعتماد الاتصال.");
  }
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new ApiError(500, "SITE_CREDENTIALS_INVALID", "تعذر تحميل بيانات اعتماد الاتصال.");
  }
  return {
    connectorKey: connection.connectorKey,
    credentials: credentials as Record<string, unknown>,
  };
}
