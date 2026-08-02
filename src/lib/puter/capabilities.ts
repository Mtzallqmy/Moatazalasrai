import { ApiError } from "@/lib/http/api";

export const PUTER_UNSUPPORTED_SERVER_CAPABILITIES = [
  "worker",
  "telegram",
  "api_v1",
  "agent_team",
  "server_tools",
  "rag",
  "scheduled_run",
] as const;

export type PuterUnsupportedServerCapability = typeof PUTER_UNSUPPORTED_SERVER_CAPABILITIES[number];

export function assertPuterCapabilitySupported(capability: PuterUnsupportedServerCapability): never {
  throw new ApiError(
    422,
    "PUTER_CLIENT_ONLY",
    "مزوّد Puter يعمل من جلسة المتصفح ولا يدعم هذا النوع من التشغيل في الإصدار الحالي. اختر مزوّدًا خادميًا لهذه الميزة.",
    { provider: "puter", capability },
  );
}
