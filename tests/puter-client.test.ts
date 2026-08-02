import { afterEach, describe, expect, it, vi } from "vitest";
import { getPuterClient, setPuterModuleLoaderForTests } from "@/lib/puter/client";
import type { PuterClient } from "@/lib/puter/types";

function mockClient() {
  return { ai: {}, auth: {} } as unknown as PuterClient;
}

afterEach(() => {
  setPuterModuleLoaderForTests(null);
  Reflect.deleteProperty(globalThis, "window");
});

describe("Puter SDK wrapper", () => {
  it("rejects server execution before importing the SDK", async () => {
    const loader = vi.fn(async () => ({ puter: mockClient() }));
    setPuterModuleLoaderForTests(loader);
    await expect(getPuterClient()).rejects.toThrow("المتصفح فقط");
    expect(loader).not.toHaveBeenCalled();
  });

  it("imports once and reuses the initialized client", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const client = mockClient();
    const loader = vi.fn(async () => ({ puter: client }));
    setPuterModuleLoaderForTests(loader);
    await expect(getPuterClient()).resolves.toBe(client);
    await expect(getPuterClient()).resolves.toBe(client);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns an Arabic error and allows a later retry after loading failure", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ default: mockClient() });
    setPuterModuleLoaderForTests(loader);
    await expect(getPuterClient()).rejects.toThrow("تعذر تحميل Puter");
    await expect(getPuterClient()).resolves.toBeDefined();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
