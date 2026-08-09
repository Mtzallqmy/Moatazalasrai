import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

type LockPackage = {
  version?: string;
  optionalDependencies?: Record<string, string>;
};

type PackageLock = {
  packages?: Record<string, LockPackage>;
};

function dependencyCandidates(packagePath: string, dependency: string) {
  const marker = "/esbuild";
  const markerIndex = packagePath.lastIndexOf(marker);
  const nestedBase = markerIndex >= 0 ? packagePath.slice(0, markerIndex + 1) : "node_modules/";
  return [`${nestedBase}${dependency}`, `node_modules/${dependency}`];
}

describe("package-lock platform integrity", () => {
  it("contains every optional esbuild platform package required by npm ci", async () => {
    const lock = JSON.parse(await readFile("package-lock.json", "utf8")) as PackageLock;
    const packages = lock.packages ?? {};
    const esbuildEntries = Object.entries(packages).filter(([path]) => path.endsWith("/esbuild") || path === "node_modules/esbuild");
    expect(esbuildEntries.length).toBeGreaterThan(0);

    for (const [path, pkg] of esbuildEntries) {
      for (const [dependency, version] of Object.entries(pkg.optionalDependencies ?? {})) {
        const candidates = dependencyCandidates(path, dependency);
        const resolved = candidates.map((candidate) => packages[candidate]).find(Boolean);
        expect(resolved, `${path} requires ${dependency}@${version}, but the lockfile omits its platform package`).toBeTruthy();
        expect(resolved?.version, `${dependency} must match the esbuild optional dependency version`).toBe(version);
      }
    }
  });
});
