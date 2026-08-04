import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiRequest } from "@/lib/http/client";
import { queryKeys } from "@/lib/query/keys";
import { humanFileSize, validateClientFile } from "@/lib/files/validation";
import { parseInlineParts, parseMessageBlocks } from "@/lib/chat/message-format";
import { can, permissionsFor } from "@/lib/auth/permissions";
import { canManageConversation, canWriteConversation } from "@/lib/chat/access";

afterEach(() => vi.restoreAllMocks());

describe("unified API client", () => {
  it("returns the typed envelope data and sends a request id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { id: "ok" },
      meta: { requestId: "server-request" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await expect(apiRequest<{ id: string }>("https://app.example/api/test", { redirectOnUnauthorized: false })).resolves.toEqual({ id: "ok" });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("x-request-id")).toBeTruthy();
    expect(init?.credentials).toBe("same-origin");
  });

  it("normalizes API errors without exposing raw response bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: { code: "RATE_LIMITED", message: "تم تجاوز الحد.", requestId: "req-1", retryable: true },
    }), { status: 429, headers: { "content-type": "application/json" } }));
    const error = await apiRequest("https://app.example/api/test", { redirectOnUnauthorized: false }).catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", requestId: "req-1", retryable: true });
  });

  it("serializes plain objects but preserves FormData", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, data: null }), { status: 200 }));
    await apiRequest("https://app.example/api/test", { method: "POST", body: { name: "agent" }, redirectOnUnauthorized: false });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ name: "agent" }));
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("application/json");

    const form = new FormData();
    form.set("name", "agent");
    await apiRequest("https://app.example/api/upload", { method: "POST", body: form, redirectOnUnauthorized: false });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(form);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has("content-type")).toBe(false);
  });
});

describe("query keys", () => {
  it("keeps nested workspace resources deterministic", () => {
    expect(queryKeys.conversationMessages("c1")).toEqual(["conversations", "c1", "messages"]);
    expect(queryKeys.repositoryPath("org/repo", "main", "src/app")).toEqual(["repositories", "org/repo", "main", "src/app"]);
  });
});

describe("file validation", () => {
  it("rejects empty, oversized, and unsupported files", () => {
    expect(validateClientFile({ name: "empty.pdf", size: 0 })).toMatchObject({ valid: false, code: "FILE_EMPTY" });
    expect(validateClientFile({ name: "large.pdf", size: 11 * 1024 * 1024 })).toMatchObject({ valid: false, code: "FILE_TOO_LARGE" });
    expect(validateClientFile({ name: "script.exe", size: 10 })).toMatchObject({ valid: false, code: "FILE_TYPE_UNSUPPORTED" });
  });

  it("accepts supported types and formats sizes", () => {
    expect(validateClientFile({ name: "report.PDF", size: 1024 })).toEqual({ valid: true });
    expect(humanFileSize(1024)).toBe("1 KB");
  });
});

describe("safe message formatting", () => {
  it("parses code blocks and lists without rendering HTML", () => {
    expect(parseMessageBlocks("نتيجة\n\n- واحد\n- اثنان\n\n```ts\nconst ok = true;\n```")).toEqual([
      { type: "paragraph", content: "نتيجة" },
      { type: "list", ordered: false, items: ["واحد", "اثنان"] },
      { type: "code", language: "ts", content: "const ok = true;" },
    ]);
  });

  it("accepts only explicit http links in inline markdown", () => {
    expect(parseInlineParts("[موقع](https://example.com) و `code`")).toEqual([
      { type: "link", content: "موقع", href: "https://example.com" },
      { type: "text", content: " و " },
      { type: "code", content: "code" },
    ]);
    expect(parseInlineParts("[خطر](javascript:alert(1))")).toEqual([{ type: "text", content: "[خطر](javascript:alert(1))" }]);
  });
});

describe("client-safe permission helpers", () => {
  it("matches server role policy without granting management to members", () => {
    expect(can("owner", "organization:manage")).toBe(true);
    expect(can("member", "organization:manage")).toBe(false);
    expect(permissionsFor("viewer")).toContain("files:read");
    expect(permissionsFor(null)).toEqual([]);
  });
});


describe("conversation access helpers", () => {
  it("separates read, write, and management roles", () => {
    expect(canWriteConversation("member", "owner-1", "reader-1", "reader")).toBe(false);
    expect(canWriteConversation("member", "owner-1", "writer-1", "writer")).toBe(true);
    expect(canManageConversation("member", "owner-1", "writer-1", "writer")).toBe(false);
    expect(canManageConversation("member", "owner-1", "manager-1", "manager")).toBe(true);
    expect(canManageConversation("developer", null, "developer-1", null)).toBe(true);
  });
});
