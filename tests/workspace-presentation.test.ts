import { describe, expect, it } from "vitest";
import {
  agentLifecyclePresentation,
  formatDurationMs,
  friendlyModelName,
  runStatusPresentation,
} from "@/lib/ui/presentation";

describe("workspace Arabic presentation", () => {
  it("localizes every persisted run status without changing its internal value", () => {
    expect(runStatusPresentation).toEqual(expect.objectContaining({
      queued: expect.objectContaining({ label: "في الانتظار" }),
      running: expect.objectContaining({ label: "قيد التشغيل" }),
      waiting_approval: expect.objectContaining({ label: "بانتظار الموافقة" }),
      completed: expect.objectContaining({ label: "مكتمل" }),
      failed: expect.objectContaining({ label: "فشل" }),
      cancelled: expect.objectContaining({ label: "ملغي" }),
    }));
  });

  it("keeps agent lifecycle separate from imaginary runtime presence", () => {
    expect(Object.keys(agentLifecyclePresentation).sort()).toEqual(["archived", "draft", "published"]);
    expect(agentLifecyclePresentation.published.label).toBe("منشور");
  });

  it("creates a friendly display name without mutating the backend model slug", () => {
    expect(friendlyModelName("openai/gpt-oss-20b:free")).toBe("GPT OSS 20B");
    expect(friendlyModelName("deepseek/deepseek-v4-pro")).toBe("DeepSeek v4 pro");
  });

  it("labels short and long durations for Arabic UI", () => {
    expect(formatDurationMs(550)).toContain("مللي ثانية");
    expect(formatDurationMs(17_300)).toContain("ث");
  });
});
