import type { ReactNode } from "react";
import { AutomationQuickNav } from "@/components/automation-quick-nav";
import { env } from "@/lib/config/env";

export default function DashboardTemplate({ children }: { children: ReactNode }) {
  const config = env();
  return <>
    {children}
    <AutomationQuickNav
      browserEnabled={config.browserAgentEnabled}
      sandboxEnabled={config.sandboxEnabled}
      connectionsEnabled={config.browserAgentEnabled || config.googleOauthIntegrationsEnabled}
    />
  </>;
}
