"use client";

import type { PuterClient } from "@/lib/puter/types";

let signedIn = false;

const puterMock = {
  auth: {
    isSignedIn: () => signedIn,
    signIn: async () => {
      if (localStorage.getItem("moataz:puter:e2e-auth-fail") === "true") {
        throw new Error("mock_auth_failed");
      }
      signedIn = true;
      return { success: true };
    },
    signOut: () => { signedIn = false; },
    getUser: async () => ({ username: "e2e-puter-user" }),
  },
  ai: {
    listModels: async () => ([
      { id: "puter-e2e-model", name: "Puter E2E Model", provider: "puter", capabilities: { chat: true } },
    ]),
    chat: async () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "text", text: "نجح " };
        await Promise.resolve();
        yield { type: "usage", usage: {} };
        yield { type: "text", text: "بث Puter التجريبي" };
      },
    }),
  },
} as unknown as PuterClient;

export const puter = puterMock;
export default puterMock;
