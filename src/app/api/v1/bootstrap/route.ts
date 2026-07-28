import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, organizations, platformApiKeys } from "@/db/schema";
import { bootstrapAuthorized } from "@/lib/auth/api-key";
import { hashApiKey } from "@/lib/security/encryption";

export async function POST(request: Request) {
  if (!bootstrapAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: string; slug?: string } | null;
  const name = body?.name?.trim();
  const slug = body?.slug?.trim().toLowerCase();
  if (!name || !slug || !/^[a-z0-9-]{3,50}$/.test(slug)) {
    return NextResponse.json({ error: "Valid name and slug are required." }, { status: 400 });
  }

  const rawKey = `map_${randomBytes(32).toString("base64url")}`;
  try {
    const [organization] = await db().insert(organizations).values({ name, slug }).returning();
    const [apiKey] = await db().insert(platformApiKeys).values({
      organizationId: organization.id,
      name: "Initial administrator key",
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.slice(0, 12),
    }).returning();
    await db().insert(auditLogs).values({
      organizationId: organization.id,
      actorType: "bootstrap",
      action: "organization.created",
      resourceType: "organization",
      resourceId: organization.id,
    });
    return NextResponse.json({ organization, apiKey: { id: apiKey.id, value: rawKey } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not bootstrap organization. The slug may already exist." }, { status: 409 });
  }
}
