import { hydrateRuntimeControlPlane } from "@/lib/platform/runtime-control";

export async function hydrateRuntimeForRequest() {
  if (process.env.NODE_ENV === "test" && process.env.RUNTIME_CONTROL_TEST_ENABLED !== "true") {
    return null;
  }
  return hydrateRuntimeControlPlane();
}
