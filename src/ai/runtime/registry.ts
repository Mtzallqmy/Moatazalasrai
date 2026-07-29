import type { AgentRuntime } from "./contracts";
export class RuntimeRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();
  register(runtime: AgentRuntime) {
    if (this.runtimes.has(runtime.id)) throw new Error("RUNTIME_DUPLICATE");
    this.runtimes.set(runtime.id, runtime);
  }
  get(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error("RUNTIME_NOT_FOUND");
    return runtime;
  }
  list() { return [...this.runtimes.keys()].sort(); }
}
