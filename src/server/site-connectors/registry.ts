import { ApiError } from "@/lib/http/api";
import { githubSiteConnector } from "@/server/site-connectors/github";
import type { SiteConnector } from "@/server/site-connectors/types";

const connectors = new Map<string, SiteConnector>([
  [githubSiteConnector.id, githubSiteConnector],
]);

export function siteConnector(connectorKey: string): SiteConnector {
  const connector = connectors.get(connectorKey);
  if (!connector) {
    throw new ApiError(422, "SITE_CONNECTOR_UNAVAILABLE", "الموصل المطلوب غير متاح في الإصدار الحالي.");
  }
  return connector;
}

export function listSiteConnectors() {
  return [...connectors.values()].map((connector) => ({
    id: connector.id,
    displayName: connector.displayName,
    type: connector.type,
    actions: connector.getAvailableActions().map((action) => ({
      id: action.id,
      displayName: action.displayName,
      risk: action.risk,
      requiredPermission: action.requiredPermission,
      approval: action.approval,
      timeoutMs: action.timeoutMs,
    })),
  }));
}
