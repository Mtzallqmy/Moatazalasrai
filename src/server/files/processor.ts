import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { ApiError } from "@/lib/http/api";

const MAX_ENTRIES = 200;
const MAX_EXPANDED_BYTES = 30 * 1024 * 1024;
const MAX_EXTRACTED_TEXT = 200_000;
const MAX_RATIO = 100;
const EXECUTABLE_EXTENSIONS = new Set([".exe", ".dll", ".com", ".bat", ".cmd", ".ps1", ".sh", ".msi", ".jar", ".scr", ".app", ".dmg"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log"]);

export type DetectedFile = {
  extension: string;
  detectedType: string;
  category: "text" | "image" | "document" | "spreadsheet" | "presentation" | "audio" | "video" | "archive";
};

function extension(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (!ext || filename.includes("\0") || filename.includes("/") || filename.includes("\\")) {
    throw new ApiError(400, "UNSAFE_FILENAME", "اسم الملف غير صالح.");
  }
  if (EXECUTABLE_EXTENSIONS.has(ext)) throw new ApiError(415, "EXECUTABLE_FILE_BLOCKED", "الملفات التنفيذية محظورة.");
  return ext;
}

function startsWith(content: Buffer, signature: number[]) {
  return signature.every((value, index) => content[index] === value);
}

export function detectFile(filename: string, declaredMime: string, content: Buffer): DetectedFile {
  const ext = extension(filename);
  if (content.byteLength < 4) throw new ApiError(400, "FILE_TOO_SMALL", "الملف غير صالح أو فارغ.");
  const signatures = {
    pdf: content.subarray(0, 5).toString("ascii") === "%PDF-",
    zip: startsWith(content, [0x50, 0x4b, 0x03, 0x04]),
    rar: startsWith(content, [0x52, 0x61, 0x72, 0x21]),
    sevenZip: startsWith(content, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    png: startsWith(content, [0x89, 0x50, 0x4e, 0x47]),
    jpeg: startsWith(content, [0xff, 0xd8, 0xff]),
    webp: content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP",
    gif: ["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii")),
    mp3: content.subarray(0, 3).toString("ascii") === "ID3" || (content[0] === 0xff && (content[1] & 0xe0) === 0xe0),
    wav: content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WAVE",
    ogg: content.subarray(0, 4).toString("ascii") === "OggS",
    mp4: content.subarray(4, 8).toString("ascii") === "ftyp",
    webm: startsWith(content, [0x1a, 0x45, 0xdf, 0xa3]),
  };
  if ([".exe", ".dll"].includes(ext) || content.subarray(0, 2).toString("ascii") === "MZ") {
    throw new ApiError(415, "EXECUTABLE_FILE_BLOCKED", "الملفات التنفيذية محظورة.");
  }
  if (ext === ".pdf" && !signatures.pdf) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى PDF لا يطابق امتداده.");
  if ([".zip", ".docx", ".xlsx", ".pptx"].includes(ext) && !signatures.zip) {
    throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى الملف المضغوط لا يطابق امتداده.");
  }
  if (ext === ".rar" && !signatures.rar) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى RAR لا يطابق امتداده.");
  if (ext === ".7z" && !signatures.sevenZip) throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى 7Z لا يطابق امتداده.");
  if ((ext === ".png" && !signatures.png) || ([".jpg", ".jpeg"].includes(ext) && !signatures.jpeg)
    || (ext === ".webp" && !signatures.webp) || (ext === ".gif" && !signatures.gif)) {
    throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى الصورة لا يطابق امتدادها.");
  }
  if ((ext === ".mp3" && !signatures.mp3) || (ext === ".wav" && !signatures.wav)
    || (ext === ".ogg" && !signatures.ogg) || ([".m4a", ".mp4", ".mov"].includes(ext) && !signatures.mp4)
    || (ext === ".webm" && !signatures.webm)) {
    throw new ApiError(415, "FILE_SIGNATURE_MISMATCH", "محتوى الوسائط لا يطابق امتداده.");
  }
  if (TEXT_EXTENSIONS.has(ext)) return { extension: ext, detectedType: declaredMime || "text/plain", category: "text" };
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return { extension: ext, detectedType: `image/${ext.replace(".", "").replace("jpg", "jpeg")}`, category: "image" };
  if (ext === ".pdf" || ext === ".docx") return { extension: ext, detectedType: ext === ".pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", category: "document" };
  if (ext === ".xlsx") return { extension: ext, detectedType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", category: "spreadsheet" };
  if (ext === ".pptx") return { extension: ext, detectedType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", category: "presentation" };
  if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) return { extension: ext, detectedType: declaredMime || "audio/*", category: "audio" };
  if ([".mp4", ".webm", ".mov"].includes(ext)) return { extension: ext, detectedType: declaredMime || "video/*", category: "video" };
  if ([".zip", ".rar", ".7z"].includes(ext)) return { extension: ext, detectedType: declaredMime || "application/octet-stream", category: "archive" };
  throw new ApiError(415, "FILE_TYPE_UNSUPPORTED", "نوع الملف غير مدعوم.");
}

function inspectZip(content: Buffer) {
  let offset = 0;
  let entries = 0;
  let expanded = 0;
  while ((offset = content.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
    if (offset + 46 > content.length) break;
    const compressed = content.readUInt32LE(offset + 20);
    const uncompressed = content.readUInt32LE(offset + 24);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new ApiError(415, "ZIP64_UNSUPPORTED", "أرشيف ZIP64 غير مدعوم لأسباب أمنية.");
    }
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const name = content.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.startsWith("/") || name.includes("../") || name.includes("..\\") || name.includes("\0")) {
      throw new ApiError(415, "ARCHIVE_PATH_TRAVERSAL", "يحتوي الأرشيف مسارًا غير آمن.");
    }
    if (EXECUTABLE_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      throw new ApiError(415, "ARCHIVE_EXECUTABLE_BLOCKED", "يحتوي الأرشيف ملفًا تنفيذيًا محظورًا.");
    }
    entries += 1;
    expanded += uncompressed;
    if (entries > MAX_ENTRIES || expanded > MAX_EXPANDED_BYTES || (compressed > 0 && uncompressed / compressed > MAX_RATIO)) {
      throw new ApiError(413, "ARCHIVE_LIMIT_EXCEEDED", "الأرشيف يتجاوز حدود الأمان.");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entries === 0) throw new ApiError(415, "ARCHIVE_INVALID", "بنية الأرشيف غير صالحة.");
  return { entries, expanded };
}

function xmlText(value: Uint8Array) {
  return strFromU8(value).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
}

export function processFile(filename: string, declaredMime: string, content: Buffer) {
  const detected = detectFile(filename, declaredMime, content);
  if (detected.category === "text") {
    const text = content.toString("utf8");
    if (detected.extension === ".json") {
      try { JSON.parse(text); } catch { throw new ApiError(422, "JSON_INVALID", "ملف JSON غير صالح."); }
    }
    return { ...detected, extractedText: text.slice(0, MAX_EXTRACTED_TEXT), archiveEntryCount: null };
  }
  if ([".zip", ".docx", ".xlsx", ".pptx"].includes(detected.extension)) {
    const inspected = inspectZip(content);
    let files: ReturnType<typeof unzipSync>;
    try {
      files = unzipSync(new Uint8Array(content));
    } catch {
      throw new ApiError(415, "ARCHIVE_INVALID", "تعذر فك الأرشيف أو أنه مشفر/تالف.");
    }
    const texts: string[] = [];
    for (const [name, value] of Object.entries(files)) {
      const ext = path.extname(name).toLowerCase();
      const isOfficeXml = detected.extension === ".docx" && name.startsWith("word/")
        || detected.extension === ".xlsx" && name.startsWith("xl/")
        || detected.extension === ".pptx" && name.startsWith("ppt/");
      if (isOfficeXml && ext === ".xml" || detected.extension === ".zip" && TEXT_EXTENSIONS.has(ext)) {
        texts.push(`[${name}]\n${ext === ".xml" ? xmlText(value) : strFromU8(value)}`);
      }
      if (texts.join("\n").length >= MAX_EXTRACTED_TEXT) break;
    }
    return { ...detected, extractedText: texts.join("\n\n").slice(0, MAX_EXTRACTED_TEXT), archiveEntryCount: inspected.entries };
  }
  if (detected.extension === ".rar" || detected.extension === ".7z") {
    return { ...detected, extractedText: "أرشيف محفوظ بعد التحقق من التوقيع. الاستخراج معطّل لعدم توفر sandbox موثوق.", archiveEntryCount: null };
  }
  if (detected.category === "audio" || detected.category === "video" || detected.category === "image") {
    return { ...detected, extractedText: `${detected.category} file: ${filename}; ${content.byteLength} bytes`, archiveEntryCount: null };
  }
  if (detected.extension === ".pdf") {
    const raw = content.toString("latin1");
    const text = [...raw.matchAll(/\(([^()]{2,500})\)/g)].map((match) => match[1]).join(" ");
    return { ...detected, extractedText: text.slice(0, MAX_EXTRACTED_TEXT), archiveEntryCount: null };
  }
  return { ...detected, extractedText: "", archiveEntryCount: null };
}
