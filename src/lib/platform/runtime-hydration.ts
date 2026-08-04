import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";
import { initializeWhatsAppFromEnvironment } from "@/lib/platform/whatsapp-environment";

export async function hydrateRuntimeForRequest() {
  if (process.env.NODE_ENV === "test" && process.env.RUNTIME_CONTROL_TEST_ENABLED !== "true") {
    return null;
  }
  await initializeWhatsAppFromEnvironment();
  return hydrateRuntimeControlPlane();
}
