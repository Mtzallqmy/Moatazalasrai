"use client";

import type { PuterClient } from "@/lib/puter/types";

type PuterModule = { puter?: PuterClient; default?: PuterClient };
type PuterModuleLoader = () => Promise<PuterModule>;

const defaultLoader: PuterModuleLoader = () => process.env.NEXT_PUBLIC_PUTER_E2E_MOCK === "true"
  ? import("@/lib/puter/e2e-mock")
  : import("@heyputer/puter.js");
let moduleLoader: PuterModuleLoader = defaultLoader;
let puterPromise: Promise<PuterClient> | null = null;

function resolvePuter(module: PuterModule): PuterClient {
  const client = module.puter ?? module.default;
  if (!client?.ai || !client.auth) throw new Error("تعذر تهيئة عميل Puter.");
  return client;
}

export async function getPuterClient(): Promise<PuterClient> {
  if (typeof window === "undefined") throw new Error("Puter متاح من المتصفح فقط.");
  puterPromise ??= moduleLoader()
    .then(resolvePuter)
    .catch(() => {
      puterPromise = null;
      throw new Error("تعذر تحميل Puter الآن. تحقق من الاتصال وحاول مجددًا.");
    });
  return puterPromise;
}

export function setPuterModuleLoaderForTests(loader: PuterModuleLoader | null) {
  moduleLoader = loader ?? defaultLoader;
  puterPromise = null;
}
