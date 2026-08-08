import { afterEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { objectStorage, resetObjectStorageForTests, R2ObjectStorage } from "@/lib/storage/object-storage";

const organizationId = "00000000-0000-4000-8000-000000000001";
const objectId = "00000000-0000-4000-8000-000000000002";
const key = `${organizationId}/${objectId}`;
const localDirectory = `/tmp/moataz-object-storage-${process.pid}`;

afterEach(async () => {
  resetObjectStorageForTests();
  delete process.env.OBJECT_STORAGE_DRIVER;
  delete process.env.ATTACHMENT_LOCAL_DIRECTORY;
  await rm(localDirectory, { recursive: true, force: true });
});

describe("attachment object storage", () => {
  it("ships an additive migration that preserves legacy database files", async () => {
    const migration = await readFile("drizzle/0021_cloudflare_integration.sql", "utf8");
    expect(migration).toContain('ALTER COLUMN "content" DROP NOT NULL');
    expect(migration).toContain('"storage_driver" text NOT NULL DEFAULT \'database\'');
    expect(migration).toContain('"turnstile_verifications"');
    expect(migration).not.toMatch(/DROP (TABLE|COLUMN)|TRUNCATE/i);
  });

  it("stores private local objects under opaque tenant-prefixed keys", async () => {
    process.env.OBJECT_STORAGE_DRIVER = "local";
    process.env.ATTACHMENT_LOCAL_DIRECTORY = localDirectory;
    const storage = objectStorage();
    await storage.put({ key, body: new TextEncoder().encode("content"), contentType: "text/plain", sha256: "digest" });
    expect(new TextDecoder().decode(await storage.get(key))).toBe("content");
    await expect(storage.get(`../${objectId}`)).rejects.toThrow("OBJECT_STORAGE_KEY_INVALID");
  });

  it("uses only the configured R2 bucket and passes non-secret integrity metadata", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      if (command instanceof HeadObjectCommand) return { ContentLength: 3, ContentType: "image/png", Metadata: { sha256: "abc123" } };
      return {};
    });
    const client = { send } as unknown as S3Client;
    const storage = new R2ObjectStorage({ bucket: "private-attachments", endpoint: "https://account.r2.cloudflarestorage.com", accessKeyId: "test-access", secretAccessKey: "test-secret" }, client);
    await storage.put({ key, body: new Uint8Array([1, 2, 3]), contentType: "image/png", sha256: "abc123" });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect((send.mock.calls[0]?.[0] as PutObjectCommand).input).toMatchObject({ Bucket: "private-attachments", Key: key, ContentType: "image/png", Metadata: { sha256: "abc123" } });
    expect(await storage.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.head(key)).toEqual({ sizeBytes: 3, contentType: "image/png", sha256: "abc123" });
    await storage.delete(key);
    expect(send.mock.calls[3]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });
});
