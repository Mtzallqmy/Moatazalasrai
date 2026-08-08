import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { detectFile, processFile } from "@/server/files/processor";
import { validateDeclaredMime } from "@/lib/storage/attachments";

describe("file intelligence processor", () => {
  it("extracts safe text, markdown and source code as real context", () => {
    for (const [filename, mime, content] of [
      ["notes.md", "text/markdown", "# Secret Test\nThe internal validation code is FILE-78291."],
      ["data.json", "application/json", '{"code":"JSON-1"}'],
      ["src.ts", "text/plain", 'export const AUTH_TEST_IDENTIFIER = "TS-44182";'],
      ["Dockerfile", "text/plain", "FROM node:22\nRUN echo safe"],
    ] as const) {
      const result = processFile(filename, mime, Buffer.from(content));
      expect(result.category).toBe("text");
      expect(result.status).toBe("ready");
      expect(result.extractedText).toContain(content.split("\n")[0]);
      expect(result.segments.length).toBeGreaterThan(0);
    }
  });

  it("extracts zip source entries with archive paths", () => {
    const archive = Buffer.from(zipSync({
      "README.md": strToU8("Project documentation"),
      "src/auth.ts": strToU8('AUTH_TEST_IDENTIFIER = "ZIP-44182"'),
      "src/database.ts": strToU8("export const db = true"),
    }));
    const result = processFile("project.zip", "application/zip", archive);
    expect(result.status).toBe("ready");
    expect(result.archiveEntryCount).toBe(3);
    expect(result.extractedText).toContain("ZIP-44182");
    expect(result.segments.some((segment) => segment.metadata.archivePath === "src/auth.ts")).toBe(true);
  });

  it("extracts DOCX document XML", () => {
    const docx = Buffer.from(zipSync({
      "[Content_Types].xml": strToU8("<Types></Types>"),
      "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>DOCX-782</w:t></w:r></w:p></w:body></w:document>'),
    }));
    const result = processFile("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx);
    expect(result.status).toBe("ready");
    expect(result.extractedText).toContain("DOCX-782");
  });

  it("extracts XLSX sheets with cell references", () => {
    const xlsx = Buffer.from(zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Sales" sheetId="1"/></sheets></workbook>'),
      "xl/sharedStrings.xml": strToU8('<sst><si><t>Revenue</t></si><si><t>XLSX-928</t></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>'),
    }));
    const result = processFile("sales.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx);
    expect(result.status).toBe("ready");
    expect(result.extractedText).toContain("[Sheet: Sales]");
    expect(result.extractedText).toContain("XLSX-928");
  });

  it("extracts PPTX by slide and notes", () => {
    const pptx = Buffer.from(zipSync({
      "ppt/slides/slide1.xml": strToU8('<p:sld><a:p><a:r><a:t>PPTX-551</a:t></a:r></a:p></p:sld>'),
      "ppt/notesSlides/notesSlide1.xml": strToU8('<p:notes><a:p><a:r><a:t>speaker note</a:t></a:r></a:p></p:notes>'),
    }));
    const result = processFile("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", pptx);
    expect(result.status).toBe("ready");
    expect(result.extractedText).toContain("[Slide 1]");
    expect(result.extractedText).toContain("PPTX-551");
    expect(result.extractedText).toContain("speaker note");
  });

  it("blocks path traversal, symlink-like unsafe paths and executable masquerading", () => {
    const traversal = Buffer.from(zipSync({ "../escape.txt": strToU8("bad") }));
    expect(() => processFile("bad.zip", "application/zip", traversal)).toThrow("مسارًا غير آمن");
    expect(() => detectFile("payload.txt", "text/plain", Buffer.from("MZ executable body"))).toThrow("تنفيذي");
  });

  it("rejects extension/signature mismatch", () => {
    expect(() => processFile("fake.pdf", "application/pdf", Buffer.from("not a pdf document"))).toThrow("لا يطابق");
  });

  it("does not claim OCR or legacy binary document support", () => {
    const image = processFile("pixel.gif", "image/gif", Buffer.from("GIF89a-test"));
    expect(image.status).toBe("partially_ready");
    expect(image.warnings).toContain("VISION_MODEL_REQUIRED_OR_OCR_UNAVAILABLE");
    const legacy = processFile("old.doc", "application/msword", Buffer.from("legacy-binary-document"));
    expect(legacy.status).toBe("unsupported");
  });

  it("rejects XML external entities", () => {
    expect(() => processFile("unsafe.xml", "application/xml", Buffer.from('<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><x>&xxe;</x>')))
      .toThrow("XML");
  });
});

describe("attachment declared MIME validation", () => {
  it("accepts browser MIME aliases and code files", () => {
    expect(validateDeclaredMime("archive.zip", "application/x-zip-compressed")).toBe("application/x-zip-compressed");
    expect(validateDeclaredMime("notes.md", "text/plain; charset=utf-8")).toBe("text/plain");
    expect(validateDeclaredMime("component.tsx", "application/octet-stream")).toBe("application/octet-stream");
  });

  it("rejects unsupported executable extensions", () => {
    expect(() => validateDeclaredMime("payload.exe", "application/octet-stream")).toThrow(/غير مدعوم/);
  });
});
