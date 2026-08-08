import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { ApiError } from "@/lib/http/api";

const MAX_ENTRIES = 250;
const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;
const MAX_EXTRACTED_TEXT = 400_000;
const MAX_RATIO = 100;
const MAX_ARCHIVE_DEPTH = 2;
const BINARY_EXECUTABLE_EXTENSIONS = new Set([".exe", ".dll", ".com", ".msi", ".scr", ".app", ".dmg"]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".yaml", ".yml", ".log", ".ini", ".conf", ".env", ".sql",
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".php", ".rb", ".swift",
  ".kt", ".kts", ".dart", ".vue", ".svelte", ".sh", ".bash", ".ps1", ".dockerfile", ".toml", ".gradle", ".html", ".htm", ".css", ".scss",
]);

export type FileCategory = "text" | "image" | "document" | "spreadsheet" | "presentation" | "audio" | "video" | "archive" | "binary";
export type ExtractionStatus = "ready" | "partially_ready" | "unsupported";
export type ExtractedSegment = { text: string; metadata: Record<string, string | number | boolean> };
export type ProcessedFile = {
  extension: string;
  detectedType: string;
  category: FileCategory;
  status: ExtractionStatus;
  extractedText: string;
  segments: ExtractedSegment[];
  warnings: string[];
  metadata: Record<string, unknown>;
  archiveEntryCount: number | null;
};
type DetectedFile = Pick<ProcessedFile, "extension" | "detectedType" | "category">;

function extension(filename: string) {
  const lower = filename.toLowerCase();
  if (filename.includes("\0") || filename.includes("/") || filename.includes("\\")) throw new ApiError(400, "UNSAFE_FILENAME", "اسم الملف غير صالح.");
  if (lower === "dockerfile") return ".dockerfile";
  const ext = path.extname(filename).toLowerCase();
  if (!ext) return "";
  if (BINARY_EXECUTABLE_EXTENSIONS.has(ext)) throw new ApiError(415, "EXECUTABLE_FILE_BLOCKED", "الملفات التنفيذية الثنائية محظورة.");
  return ext;
}
function startsWith(content: Buffer, signature: number[]) { return signature.every((value, index) => content[index] === value); }
function hasPeOrElfSignature(content: Buffer) { return content.subarray(0, 2).toString("ascii") === "MZ" || startsWith(content, [0x7f, 0x45, 0x4c, 0x46]); }
function looksBinary(content: Uint8Array) {
  const sample = content.subarray(0, Math.min(content.length, 8192));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || byte === 11 || byte === 12 || byte > 13 && byte < 32) controls += 1;
  }
  return sample.length > 0 && controls / sample.length > 0.08;
}
function safeUtf8(content: Uint8Array) {
  if (looksBinary(content)) throw new ApiError(415, "BINARY_TEXT_MISMATCH", "الملف ثنائي ولا يمكن قراءته كنص آمن.");
  return new TextDecoder("utf-8", { fatal: false }).decode(content).replaceAll("\u0000", "");
}
function xmlUnescape(value: string) { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'"); }
function rejectUnsafeXml(value: string) { if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new ApiError(415, "XML_EXTERNAL_ENTITY_BLOCKED", "ملف XML يحتوي تعريفات غير مسموحة."); }
function xmlText(value: Uint8Array) {
  const xml = strFromU8(value); rejectUnsafeXml(xml);
  return xmlUnescape(xml.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim());
}
function textSegment(text: string, metadata: ExtractedSegment["metadata"] = {}): ExtractedSegment | null { const normalized = text.trim(); return normalized ? { text: normalized, metadata } : null; }

export function detectFile(filename: string, declaredMime: string, content: Buffer): DetectedFile {
  const ext = extension(filename);
  if (content.byteLength === 0) throw new ApiError(400, "FILE_EMPTY", "الملف فارغ.");
  if (hasPeOrElfSignature(content)) throw new ApiError(415, "EXECUTABLE_FILE_BLOCKED", "تم اكتشاف ملف تنفيذي ثنائي محظور.");
  const signatures = {
    pdf: content.subarray(0, 5).toString("ascii") === "%PDF-",
    zip: startsWith(content, [0x50, 0x4b, 0x03, 0x04]) || startsWith(content, [0x50, 0x4b, 0x05, 0x06]) || startsWith(content, [0x50, 0x4b, 0x07, 0x08]),
    rar: startsWith(content, [0x52, 0x61, 0x72, 0x21]),
    sevenZip: startsWith(content, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    png: startsWith(content, [0x89, 0x50, 0x4e, 0x47]), jpeg: startsWith(content, [0xff, 0xd8, 0xff]),
    gif: ["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii")),
    webp: content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP",
    bmp: content.subarray(0, 2).toString("ascii") === "BM",
    tiff: startsWith(content, [0x49, 0x49, 0x2a, 0x00]) || startsWith(content, [0x4d, 0x4d, 0x00, 0x2a]),
    mp3: content.subarray(0, 3).toString("ascii") === "ID3" || (content[0] === 0xff && (content[1] ?? 0) >= 0xe0),
    wav: content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WAVE",
    ogg: content.subarray(0, 4).toString("ascii") === "OggS",
    mp4: content.subarray(4, 8).toString("ascii") === "ftyp",
    webm: startsWith(content, [0x1a, 0x45, 0xdf, 0xa3]),
  };
  if (ext === ".pdf" && !signatures.pdf) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى PDF لا يطابق امتداده.");
  if ([".zip", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".epub"].includes(ext) && !signatures.zip) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى الملف المضغوط لا يطابق امتداده.");
  if (ext === ".rar" && !signatures.rar) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى RAR لا يطابق امتداده.");
  if (ext === ".7z" && !signatures.sevenZip) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى 7Z لا يطابق امتداده.");
  if ((ext === ".png" && !signatures.png) || ([".jpg", ".jpeg"].includes(ext) && !signatures.jpeg) || (ext === ".gif" && !signatures.gif) || (ext === ".webp" && !signatures.webp) || (ext === ".bmp" && !signatures.bmp) || ([".tif", ".tiff"].includes(ext) && !signatures.tiff)) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى الصورة لا يطابق امتدادها.");
  if ((ext === ".mp3" && !signatures.mp3) || (ext === ".wav" && !signatures.wav) || (ext === ".ogg" && !signatures.ogg) || ([".m4a", ".mp4", ".mov"].includes(ext) && !signatures.mp4) || (ext === ".webm" && !signatures.webm)) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى الوسائط لا يطابق امتداده.");

  if (TEXT_EXTENSIONS.has(ext) || (!ext && !looksBinary(content))) return { extension: ext, detectedType: declaredMime || "text/plain", category: "text" };
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg", ".heic", ".heif"].includes(ext)) return { extension: ext, detectedType: declaredMime || "image/*", category: "image" };
  if ([".pdf", ".doc", ".docx", ".odt", ".rtf", ".epub"].includes(ext)) return { extension: ext, detectedType: declaredMime, category: "document" };
  if ([".xls", ".xlsx", ".ods"].includes(ext)) return { extension: ext, detectedType: declaredMime, category: "spreadsheet" };
  if ([".ppt", ".pptx", ".odp"].includes(ext)) return { extension: ext, detectedType: declaredMime, category: "presentation" };
  if ([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"].includes(ext)) return { extension: ext, detectedType: declaredMime || "application/octet-stream", category: "archive" };
  if (declaredMime.startsWith("audio/")) return { extension: ext, detectedType: declaredMime, category: "audio" };
  if (declaredMime.startsWith("video/")) return { extension: ext, detectedType: declaredMime, category: "video" };
  return { extension: ext, detectedType: declaredMime || "application/octet-stream", category: "binary" };
}

function inspectZip(content: Buffer) {
  let offset = 0, entries = 0, expanded = 0;
  while ((offset = content.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
    if (offset + 46 > content.length) break;
    const compressed = content.readUInt32LE(offset + 20), uncompressed = content.readUInt32LE(offset + 24);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new ApiError(415, "ZIP64_UNSUPPORTED", "أرشيف ZIP64 غير مدعوم لأسباب أمنية.");
    const nameLength = content.readUInt16LE(offset + 28), extraLength = content.readUInt16LE(offset + 30), commentLength = content.readUInt16LE(offset + 32);
    const externalAttributes = content.readUInt32LE(offset + 38);
    const name = content.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const unixMode = externalAttributes >>> 16;
    if (name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name) || name.split(/[\\/]+/).includes("..") || name.includes("\0")) throw new ApiError(415, "ARCHIVE_PATH_TRAVERSAL", "يحتوي الأرشيف مسارًا غير آمن.");
    if ((unixMode & 0o170000) === 0o120000) throw new ApiError(415, "ARCHIVE_SYMLINK_BLOCKED", "الروابط الرمزية داخل الأرشيف غير مسموحة.");
    if (BINARY_EXECUTABLE_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new ApiError(415, "ARCHIVE_EXECUTABLE_BLOCKED", "يحتوي الأرشيف ملفًا تنفيذيًا ثنائيًا محظورًا.");
    entries += 1; expanded += uncompressed;
    if (entries > MAX_ENTRIES) throw new ApiError(413, "ARCHIVE_TOO_MANY_FILES", "الأرشيف يحتوي ملفات أكثر من الحد المسموح.");
    if (expanded > MAX_EXPANDED_BYTES) throw new ApiError(413, "ARCHIVE_TOO_LARGE", "حجم الأرشيف بعد الفك يتجاوز الحد المسموح.");
    if (compressed > 0 && uncompressed / compressed > MAX_RATIO) throw new ApiError(413, "ARCHIVE_BOMB_DETECTED", "نسبة ضغط الأرشيف غير آمنة.");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entries === 0) throw new ApiError(415, "ARCHIVE_INVALID", "بنية الأرشيف غير صالحة أو محمية بكلمة مرور.");
  return { entries, expanded };
}
function unzipChecked(content: Buffer) {
  const inspected = inspectZip(content);
  try { return { inspected, files: unzipSync(new Uint8Array(content)) }; }
  catch { throw new ApiError(415, "PASSWORD_PROTECTED_FILE", "تعذر فك الملف؛ قد يكون محميًا بكلمة مرور أو تالفًا."); }
}
function extractDocx(files: Record<string, Uint8Array>): ExtractedSegment[] {
  const document = files["word/document.xml"]; if (!document) return [];
  const segment = textSegment(xmlText(document), { part: "document" }); return segment ? [segment] : [];
}
function extractXlsx(files: Record<string, Uint8Array>): ExtractedSegment[] {
  const sharedXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]!) : ""; if (sharedXml) rejectUnsafeXml(sharedXml);
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => xmlUnescape(match[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()));
  const workbookXml = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]!) : ""; if (workbookXml) rejectUnsafeXml(workbookXml);
  const sheetNames = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"/g)].map((match) => ({ name: xmlUnescape(match[1]!), id: Number(match[2]) }));
  const segments: ExtractedSegment[] = [];
  Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach((name, index) => {
    const xml = strFromU8(files[name]!); rejectUnsafeXml(xml); const rows: string[] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1]!, body = cell[2]!, ref = /\br="([^"]+)"/.exec(attrs)?.[1] ?? "", type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
        const value = type === "s" ? shared[Number(raw)] ?? raw : xmlUnescape(raw); if (value) cells.push(ref ? `${ref}=${value}` : value);
      }
      if (cells.length) rows.push(cells.join(" | ")); if (rows.length >= 5000) break;
    }
    const label = sheetNames[index]?.name ?? `Sheet ${index + 1}`, segment = textSegment(`[Sheet: ${label}]\n${rows.join("\n")}`, { sheet: label }); if (segment) segments.push(segment);
  });
  return segments;
}
function extractPptx(files: Record<string, Uint8Array>): ExtractedSegment[] {
  return Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).flatMap((name, index) => {
    const slideNumber = Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? index + 1), text = xmlText(files[name]!);
    const notes = files[`ppt/notesSlides/notesSlide${slideNumber}.xml`] ? xmlText(files[`ppt/notesSlides/notesSlide${slideNumber}.xml`]!) : "";
    const segment = textSegment(`[Slide ${slideNumber}]\n${text}${notes ? `\n[Notes]\n${notes}` : ""}`, { slide: slideNumber }); return segment ? [segment] : [];
  });
}
function extractOpenDocument(files: Record<string, Uint8Array>, ext: string): ExtractedSegment[] {
  const content = files["content.xml"]; if (!content) return [];
  const text = xmlText(content), label = ext === ".ods" ? "spreadsheet" : ext === ".odp" ? "presentation" : "document", segment = textSegment(text, { part: label }); return segment ? [segment] : [];
}
function pdfExtract(content: Buffer): ExtractedSegment[] {
  const raw = content.toString("latin1");
  if (/\/Encrypt\b/.test(raw)) throw new ApiError(415, "PASSWORD_PROTECTED_FILE", "ملف PDF محمي بكلمة مرور.");
  const strings: string[] = [];
  for (const match of raw.matchAll(/\((?:\\.|[^()\\]){2,1000}\)\s*Tj/g)) {
    const body = match[0].replace(/\)\s*Tj$/, "").slice(1).replace(/\\([()\\])/g, "$1").replace(/\\n/g, "\n");
    if (/^[\x09\x0A\x0D\x20-\x7E\xA0-\xFF]+$/.test(body)) strings.push(body);
  }
  for (const match of raw.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    const parts = [...match[1]!.matchAll(/\((?:\\.|[^()\\])*\)/g)].map((part) => part[0].slice(1, -1).replace(/\\([()\\])/g, "$1"));
    if (parts.length) strings.push(parts.join(""));
  }
  const text = strings.join(" ").replace(/\s+/g, " ").trim(), segment = textSegment(text, { extraction: "pdf-text-operators" }); return segment ? [segment] : [];
}
function processArchiveEntries(files: Record<string, Uint8Array>, depth = 0): ExtractedSegment[] {
  if (depth > MAX_ARCHIVE_DEPTH) throw new ApiError(413, "ARCHIVE_TOO_DEEP", "تجاوز الأرشيف عمق المعالجة الآمن.");
  const segments: ExtractedSegment[] = [];
  for (const [name, value] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    const ext = path.extname(name).toLowerCase(); if (BINARY_EXECUTABLE_EXTENSIONS.has(ext) || hasPeOrElfSignature(Buffer.from(value))) continue;
    if (TEXT_EXTENSIONS.has(ext) || path.basename(name).toLowerCase() === "dockerfile") {
      try { const segment = textSegment(safeUtf8(value), { archivePath: name }); if (segment) segments.push(segment); } catch { /* ignored binary masquerade */ }
    } else if (ext === ".pdf" && value.length <= 10 * 1024 * 1024) {
      for (const segment of pdfExtract(Buffer.from(value))) segments.push({ ...segment, metadata: { ...segment.metadata, archivePath: name } });
    } else if ([".docx", ".xlsx", ".pptx"].includes(ext) && depth < MAX_ARCHIVE_DEPTH && value.length <= 10 * 1024 * 1024) {
      try { const nested = unzipChecked(Buffer.from(value)); const inner = ext === ".docx" ? extractDocx(nested.files) : ext === ".xlsx" ? extractXlsx(nested.files) : extractPptx(nested.files); inner.forEach((segment) => segments.push({ ...segment, metadata: { ...segment.metadata, archivePath: name } })); } catch { /* retain archive usability */ }
    }
    if (segments.reduce((sum, item) => sum + item.text.length, 0) >= MAX_EXTRACTED_TEXT) break;
  }
  return segments;
}
function finish(detected: DetectedFile, status: ExtractionStatus, segments: ExtractedSegment[], warnings: string[], metadata: Record<string, unknown> = {}, archiveEntryCount: number | null = null): ProcessedFile {
  const clipped: ExtractedSegment[] = []; let remaining = MAX_EXTRACTED_TEXT;
  for (const segment of segments) { if (remaining <= 0) break; const text = segment.text.slice(0, remaining); if (text.trim()) clipped.push({ text, metadata: segment.metadata }); remaining -= text.length; }
  const extractedText = clipped.map((segment) => segment.text).join("\n\n");
  return { ...detected, status, segments: clipped, extractedText, warnings, metadata, archiveEntryCount };
}

export function processFile(filename: string, declaredMime: string, content: Buffer): ProcessedFile {
  const detected = detectFile(filename, declaredMime, content);
  if (detected.category === "text") {
    const text = safeUtf8(content);
    if (detected.extension === ".json") { try { JSON.parse(text); } catch { throw new ApiError(422, "FILE_CORRUPTED", "ملف JSON غير صالح."); } }
    if ([".xml", ".html", ".htm", ".svg"].includes(detected.extension)) rejectUnsafeXml(text);
    const segment = textSegment(text, { kind: detected.extension || "text" }); return finish(detected, segment ? "ready" : "unsupported", segment ? [segment] : [], segment ? [] : ["NO_EXTRACTABLE_TEXT"]);
  }
  if ([".docx", ".xlsx", ".pptx"].includes(detected.extension)) {
    const { inspected, files } = unzipChecked(content); const segments = detected.extension === ".docx" ? extractDocx(files) : detected.extension === ".xlsx" ? extractXlsx(files) : extractPptx(files);
    return finish(detected, segments.length ? "ready" : "unsupported", segments, segments.length ? [] : ["NO_EXTRACTABLE_OFFICE_CONTENT"], { expandedBytes: inspected.expanded }, inspected.entries);
  }
  if ([".odt", ".ods", ".odp", ".epub"].includes(detected.extension)) {
    const { inspected, files } = unzipChecked(content), segments = detected.extension === ".epub" ? processArchiveEntries(files) : extractOpenDocument(files, detected.extension);
    return finish(detected, segments.length ? "partially_ready" : "unsupported", segments, ["OPEN_DOCUMENT_STRUCTURE_PARTIAL"], { expandedBytes: inspected.expanded }, inspected.entries);
  }
  if (detected.extension === ".zip") {
    const { inspected, files } = unzipChecked(content), segments = processArchiveEntries(files);
    return finish(detected, segments.length ? "ready" : "unsupported", segments, segments.length ? [] : ["ARCHIVE_HAS_NO_SUPPORTED_READABLE_FILES"], { expandedBytes: inspected.expanded }, inspected.entries);
  }
  if ([".rar", ".7z", ".tar", ".gz", ".tgz"].includes(detected.extension)) return finish(detected, "unsupported", [], ["ARCHIVE_DECODER_UNAVAILABLE"]);
  if (detected.extension === ".pdf") { const segments = pdfExtract(content); return finish(detected, segments.length ? "partially_ready" : "unsupported", segments, segments.length ? ["PDF_TEXT_EXTRACTION_LIMITED_NO_OCR"] : ["PDF_NO_TEXT_EXTRACTED_OCR_UNAVAILABLE"]); }
  if ([".doc", ".xls", ".ppt", ".rtf"].includes(detected.extension)) return finish(detected, "unsupported", [], ["LEGACY_DOCUMENT_DECODER_UNAVAILABLE"]);
  if (detected.category === "image") return finish(detected, "partially_ready", [], ["VISION_MODEL_REQUIRED_OR_OCR_UNAVAILABLE"], { nativeVisionCandidate: true });
  if (detected.category === "audio" || detected.category === "video") return finish(detected, "unsupported", [], ["MEDIA_TRANSCRIPTION_NOT_AVAILABLE_IN_CHAT_FILE_LAYER"]);
  return finish(detected, "unsupported", [], ["UNSUPPORTED_FILE_TYPE"]);
}
