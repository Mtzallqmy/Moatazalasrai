export const queryKeys = {
  account: () => ["account"] as const,
  agents: (filters: Record<string, unknown> = {}) => ["agents", filters] as const,
  conversations: (filters: Record<string, unknown> = {}) => ["conversations", filters] as const,
  conversationMessages: (conversationId: string) => ["conversations", conversationId, "messages"] as const,
  conversationDraft: (conversationId: string) => ["conversations", conversationId, "draft"] as const,
  files: (filters: Record<string, unknown> = {}) => ["files", filters] as const,
  knowledgeBases: () => ["knowledge-bases"] as const,
  knowledgeDocuments: (knowledgeBaseId: string) => ["knowledge-bases", knowledgeBaseId, "documents"] as const,
  models: () => ["models"] as const,
  providers: () => ["providers"] as const,
  repositories: () => ["repositories"] as const,
  repositoryPath: (repository: string, ref: string, path: string) => ["repositories", repository, ref, path] as const,
  runs: (filters: Record<string, unknown> = {}) => ["runs", filters] as const,
  runEvents: (runId: string) => ["runs", runId, "events"] as const,
} as const;

export type QueryKey = ReturnType<(typeof queryKeys)[keyof typeof queryKeys]>;
