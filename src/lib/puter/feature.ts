export const PUTER_PROVIDER_ID = "puter" as const;

export const PUTER_PROVIDER_METADATA = Object.freeze({
  id: PUTER_PROVIDER_ID,
  name: "Puter",
  execution: "client",
  credentialMode: "user-account",
  supportsStreaming: true,
  supportsModelDiscovery: true,
  supportsServerRuns: false,
  supportsBackgroundWorker: false,
} as const);

export function isPuterEnabled(value = process.env.NEXT_PUBLIC_PUTER_ENABLED): boolean {
  return value === "true";
}

export function assertPuterEnabled() {
  if (!isPuterEnabled()) throw new Error("PUTER_PROVIDER_DISABLED");
}
