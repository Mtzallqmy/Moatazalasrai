import { synchronizePlatformWhatsAppEndpoint } from "@/lib/channels/whatsapp-platform";
import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { initializeWhatsAppFromEnvironment } from "@/lib/platform/whatsapp-environment";

export async function hydrateRuntimeForRequest() {
  if (process.env.NODE_ENV === "test" && process.env.RUNTIME_CONTROL_TEST_ENABLED !== "true") {
    return null;
  }
  const report = await initializeWhatsAppFromEnvironment();
  if (report.enabled && report.inspection.complete && report.inspection.valid) {
    await synchronizePlatformWhatsAppEndpoint();
  }
  return hydrateRuntimeControlPlane(report.changed);
}
