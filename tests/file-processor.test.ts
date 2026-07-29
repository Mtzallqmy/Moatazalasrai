import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { detectFile, processFile } from "@/server/files/processor";

describe("file processor", () => {
  it("extracts and indexes safe text files", () => {
    const result = processFile("notes.md", "text/markdown", Buffer.from("# Safe notes"));
    expect(result.category).toBe("text");
    expect(result.extractedText).toContain("Safe notes");
  });

  it("extracts safe zip text entries", () => {
    const archive = Buffer.from(zipSync({ "docs/readme.txt": strToU8("indexed content") }));
    const result = processFile("bundle.zip", "application/zip", archive);
    expect(result.archiveEntryCount).toBe(1);
    expect(result.extractedText).toContain("indexed content");
  });

  it("blocks path traversal and executable masquerading", () => {
    const traversal = Buffer.from(zipSync({ "../escape.txt": strToU8("bad") }));
    expect(() => processFile("bad.zip", "application/zip", traversal)).toThrow("مسارًا غير آمن");
    expect(() => detectFile("payload.txt", "text/plain", Buffer.from("MZ executable body"))).toThrow("التنفيذية");
  });

  it("rejects extension/signature mismatch", () => {
    expect(() => processFile("fake.pdf", "application/pdf", Buffer.from("not a pdf document"))).toThrow("لا يطابق");
  });

  it("rejects spoofed audio", () => {
    expect(() => processFile("voice.mp3", "audio/mpeg", Buffer.from("not-an-mp3")))
      .toThrow("محتوى الوسائط");
  });

  it("accepts a valid GIF signature", () => {
    const result = processFile("pixel.gif", "image/gif", Buffer.from("GIF89a-test"));
    expect(result.category).toBe("image");
  });
});
