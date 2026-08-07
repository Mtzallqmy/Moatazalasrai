import { UnavailableExecutionAdapter } from "@/lib/execution/runners/unavailable-adapter";

export class DaytonaExecutionAdapter extends UnavailableExecutionAdapter {
  readonly kind = "daytona" as const;
  protected availability() {
    const enabled = process.env.EXECUTION_DAYTONA_ENABLED === "true";
    const configured = Boolean(process.env.DAYTONA_API_KEY?.trim());
    return {
      enabled,
      configured,
      errorCode: !enabled
        ? "DAYTONA_DISABLED"
        : !configured
          ? "DAYTONA_API_KEY_MISSING"
          : "DAYTONA_ADAPTER_NOT_INSTALLED",
    };
  }
}
