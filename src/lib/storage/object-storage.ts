import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageDriver = "local" | "r2";
export type StoredObject = { key: string; sizeBytes: number; driver: StorageDriver };
export interface ObjectStorage {
  readonly driver: StorageDriver;
  put(input: { key: string; body: Uint8Array; contentType: string; sha256: string }): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
}

const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;

function assertKey(key: string) {
  if (!SAFE_KEY.test(key)) throw new Error("OBJECT_STORAGE_KEY_INVALID");
}

function localRoot() {
  const configured = process.env.ATTACHMENT_LOCAL_DIRECTORY?.trim();
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(process.cwd(), ".data", "attachments");
}

class LocalObjectStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private filename(key: string) {
    assertKey(key);
    const target = path.resolve(localRoot(), key);
    if (!target.startsWith(`${localRoot()}${path.sep}`)) throw new Error("OBJECT_STORAGE_PATH_INVALID");
    return target;
  }
  async put(input: { key: string; body: Uint8Array }) {
    const filename = this.filename(input.key);
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    await writeFile(filename, input.body, { mode: 0o600, flag: "wx" });
    return { key: input.key, sizeBytes: input.body.byteLength, driver: this.driver };
  }
  async get(key: string) { return readFile(this.filename(key)); }
  async delete(key: string) {
    try { await unlink(this.filename(key)); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  async createSignedDownloadUrl(): Promise<string> {
    throw new Error("LOCAL_STORAGE_SIGNED_URL_UNSUPPORTED");
  }
}

export type R2Config = { bucket: string; endpoint: string; accessKeyId: string; secretAccessKey: string };

function r2Configuration(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID/R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required when OBJECT_STORAGE_DRIVER=r2.");
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/") {
    throw new Error("R2_ENDPOINT must be an HTTPS origin without credentials or a path.");
  }
  return { bucket, endpoint: parsed.origin, accessKeyId, secretAccessKey };
}

function r2Client(config: R2Config) {
  const options: S3ClientConfig = {
    region: "auto",
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  return new S3Client(options);
}

export class R2ObjectStorage implements ObjectStorage {
  readonly driver = "r2" as const;
  private readonly client: S3Client;
  constructor(private readonly config: R2Config = r2Configuration(), client?: S3Client) {
    this.client = client ?? r2Client(config);
  }
  async put(input: { key: string; body: Uint8Array; contentType: string; sha256: string }) {
    assertKey(input.key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: { sha256: input.sha256 },
    }));
    return { key: input.key, sizeBytes: input.body.byteLength, driver: this.driver };
  }
  async get(key: string) {
    assertKey(key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!response.Body) throw new Error("OBJECT_STORAGE_EMPTY_RESPONSE");
    return new Uint8Array(await response.Body.transformToByteArray());
  }
  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
  async createSignedDownloadUrl(key: string, expiresInSeconds: number) {
    assertKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: Math.min(Math.max(Math.floor(expiresInSeconds), 30), 900),
    });
  }
}

const cached = new Map<StorageDriver, ObjectStorage>();

export function objectStorage(requestedDriver?: StorageDriver): ObjectStorage {
  const driver = requestedDriver ?? process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase() ?? "local";
  if (driver !== "local" && driver !== "r2") throw new Error("OBJECT_STORAGE_DRIVER must be local or r2.");
  const existing = cached.get(driver);
  if (existing) return existing;
  const selected: ObjectStorage = driver === "r2" ? new R2ObjectStorage() : new LocalObjectStorage();
  cached.set(driver, selected);
  return selected;
}

export function resetObjectStorageForTests() { cached.clear(); }
