import { UnavailableExecutionAdapter } from "@/lib/execution/runners/unavailable-adapter";

export class E2BExecutionAdapter extends UnavailableExecutionAdapter {
  readonly kind = "e2b" as const;
  protected availability() {
    const enabled = process.env.EXECUTION_E2B_ENABLED === "true";
    const configured = Boolean(process.env.E2B_API_KEY?.trim());
    return {
      enabled,
      configured,
      errorCode: !enabled
        ? "E2B_DISABLED"
        : !configured
          ? "E2B_API_KEY_MISSING"
          : "E2B_ADAPTER_NOT_INSTALLED",
    };
  }
}
