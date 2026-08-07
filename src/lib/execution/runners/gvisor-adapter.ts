import { UnavailableExecutionAdapter } from "@/lib/execution/runners/unavailable-adapter";

export class GVisorExecutionAdapter extends UnavailableExecutionAdapter {
  readonly kind = "gvisor" as const;
  protected availability() {
    const enabled = process.env.EXECUTION_GVISOR_ENABLED === "true";
    const runtime = process.env.EXECUTION_GVISOR_RUNTIME?.trim() || "runsc";
    return {
      enabled,
      configured: Boolean(runtime),
      errorCode: !enabled
        ? "GVISOR_DISABLED"
        : process.env.RAILWAY_ENVIRONMENT
          ? "GVISOR_UNSUPPORTED_ON_RAILWAY"
          : "GVISOR_DEDICATED_HOST_REQUIRED",
    };
  }
}
