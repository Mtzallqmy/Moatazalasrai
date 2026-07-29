import { describe, expect, it } from "vitest";
import { inputKindForAttachments } from "@/server/files/input-kind";

describe("attachment input kind", () => {
  it("routes images to a vision model", () => {
    expect(inputKindForAttachments(["image/png"])).toBe("image");
    expect(inputKindForAttachments(["application/pdf", "image/jpeg"])).toBe("image");
  });

  it("routes documents, audio, video, and empty input distinctly", () => {
    expect(inputKindForAttachments(["application/pdf"])).toBe("file");
    expect(inputKindForAttachments(["audio/mpeg"])).toBe("audio");
    expect(inputKindForAttachments(["video/mp4"])).toBe("video");
    expect(inputKindForAttachments([])).toBe("text");
  });
});
