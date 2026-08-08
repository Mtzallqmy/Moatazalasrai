import { describe, expect, it } from "vitest";
import { inputKindForAttachments } from "@/server/files/input-kind";

describe("attachment input kind", () => {
  it("routes actual supported images to a vision model", () => {
    expect(inputKindForAttachments(["image/png"])).toBe("image");
    expect(inputKindForAttachments(["application/pdf", "image/jpeg"])).toBe("image");
  });

  it("routes normalized documents and unsupported media through text context", () => {
    expect(inputKindForAttachments(["application/pdf"])).toBe("text");
    expect(inputKindForAttachments(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])).toBe("text");
    expect(inputKindForAttachments(["audio/mpeg"])).toBe("text");
    expect(inputKindForAttachments(["video/mp4"])).toBe("text");
    expect(inputKindForAttachments([])).toBe("text");
  });
});
