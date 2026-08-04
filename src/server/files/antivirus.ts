import net from "node:net";

export type AntivirusResult = {
  verdict: "clean" | "infected" | "skipped";
  engine: "clamav" | "disabled";
  signature?: string;
};

function enabled(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) return fallback;
  return value.trim().toLowerCase() === "true";
}

export function parseClamAvResponse(response: string): AntivirusResult {
  const normalized = response.replace(/\0/g, "").trim();
  if (/\bOK$/i.test(normalized)) return { verdict: "clean", engine: "clamav" };
  const match = normalized.match(/:\s*(.+)\s+FOUND$/i);
  if (match) return { verdict: "infected", engine: "clamav", signature: match[1]!.slice(0, 200) };
  throw new Error("CLAMAV_RESPONSE_INVALID");
}

export async function scanAttachmentForViruses(content: Uint8Array): Promise<AntivirusResult> {
  const required = enabled(process.env.ANTIVIRUS_REQUIRED, process.env.NODE_ENV === "production");
  if (!required) return { verdict: "skipped", engine: "disabled" };

  const host = process.env.CLAMAV_HOST?.trim() || "clamav";
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS ?? 30_000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("CLAMAV_PORT_INVALID");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error("CLAMAV_TIMEOUT_INVALID");

  return new Promise<AntivirusResult>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const responses: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, result?: AntivirusResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("CLAMAV_TIMEOUT")));
    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => responses.push(Buffer.from(chunk)));
    socket.on("end", () => {
      try { finish(undefined, parseClamAvResponse(Buffer.concat(responses).toString("utf8"))); }
      catch (error) { finish(error instanceof Error ? error : new Error("CLAMAV_RESPONSE_INVALID")); }
    });
    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "utf8"));
      const body = Buffer.from(content);
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < body.length; offset += chunkSize) {
        const chunk = body.subarray(offset, Math.min(offset + chunkSize, body.length));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
