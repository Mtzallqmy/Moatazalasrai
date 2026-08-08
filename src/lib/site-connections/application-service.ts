import { assertUserPermission } from "@/lib/auth/user-authorization";
import { getSiteConnection, listSiteConnections } from "@/lib/site-connections/service";

export async function listOrganizationSiteConnections(input: {
  organizationId: string;
  userId: string;
}) {
  await assertUserPermission({ ...input, permission: "site_connections:read" });
  return listSiteConnections(input.organizationId);
}

export async function getOrganizationSiteConnection(input: {
  organizationId: string;
  userId: string;
  connectionId: string;
}) {
  await assertUserPermission({ ...input, permission: "site_connections:read" });
  return getSiteConnection(input.organizationId, input.connectionId);
}
