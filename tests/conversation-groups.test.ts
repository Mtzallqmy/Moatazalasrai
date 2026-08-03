import { describe, expect, it } from "vitest";
import { groupConversations } from "@/lib/chat/conversation-groups";

describe("conversation groups", () => {
  it("groups and sorts conversations deterministically", () => {
    const now = new Date("2026-08-03T12:00:00Z");
    const groups = groupConversations([
      { id: "older", updatedAt: "2026-06-01T00:00:00Z" },
      { id: "today-b", updatedAt: "2026-08-03T08:00:00Z" },
      { id: "today-a", updatedAt: "2026-08-03T10:00:00Z" },
      { id: "pinned", updatedAt: "2026-01-01T00:00:00Z", pinnedAt: "2026-08-03T11:00:00Z" },
      { id: "week", updatedAt: "2026-07-29T00:00:00Z" },
    ], now);
    expect(groups.map((group) => group.key)).toEqual(["pinned", "today", "last7", "older"]);
    expect(groups.find((group) => group.key === "today")?.items.map((item) => item.id)).toEqual(["today-a", "today-b"]);
  });
});
