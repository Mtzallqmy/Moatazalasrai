import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const describeLinux = process.platform === "linux" ? describe : describe.skip;
const SHARED_SECRET = "sandbox-security-integration-secret-000000000000";
const TENANT = "tenantSecurity";

describeLinux("sandbox runner adversarial symlink isolation", () => {
  let root: string;
  let port: number;
  let child: ChildProcess;

  async function freePort() {
    return new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("PORT_ALLOCATION_FAILED"));
        const selected = address.port;
        server.close((error) => error ? reject(error) : resolve(selected));
      });
    });
  }

  async function waitForHealth() {
    const deadline = Date.now() + 10_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw lastError instanceof Error ? lastError : new Error("SANDBOX_RUNNER_DID_NOT_START");
  }

  function signedHeaders(method: string, pathname: string, body: string) {
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const service = "platform-sandbox";
    const bodyHash = createHash("sha256").update(body, "utf8").digest("base64url");
    const signature = createHmac("sha256", SHARED_SECRET)
      .update([timestamp, nonce, service, method.toUpperCase(), pathname, bodyHash].join("\n"), "utf8")
      .digest("base64url");
    return {
      "x-moataz-timestamp": timestamp,
      "x-moataz-nonce": nonce,
      "x-moataz-service": service,
      "x-moataz-body-sha256": bodyHash,
      "x-moataz-signature": signature,
      ...(body ? { "content-type": "application/json" } : {}),
    };
  }

  async function call(method: string, pathAndQuery: string, value?: unknown) {
    const url = new URL(pathAndQuery, `http://127.0.0.1:${port}`);
    const body = value === undefined ? "" : JSON.stringify(value);
    const response = await fetch(url, {
      method,
      headers: signedHeaders(method, url.pathname, body),
      ...(body ? { body } : {}),
    });
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string } };
    return { response, payload };
  }

  async function createWorkspace(workspaceId: string) {
    const created = await call("POST", "/v1/workspaces", {
      tenantId: TENANT,
      workspaceId,
      template: "moataz-code",
      networkMode: "disabled",
    });
    expect(created.response.status).toBe(201);
    return join(root, TENANT, workspaceId);
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "moataz-sandbox-security-"));
    port = await freePort();
    child = spawn(process.execPath, ["services/sandbox-runner/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        SANDBOX_WORKSPACE_ROOT: root,
        SANDBOX_RUNNER_SHARED_SECRET: SHARED_SECRET,
        SANDBOX_ALLOWED_TEMPLATES: "moataz-code",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHealth();
  });

  afterAll(async () => {
    if (child && !child.killed) child.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  });

  test("workspace symlink to /etc/passwd ancestry is rejected", async () => {
    const workspaceId = "workspaceLink";
    const workspace = await createWorkspace(workspaceId);
    await rm(workspace, { recursive: true, force: true });
    await symlink("/etc", workspace, "dir");
    const result = await call("GET", `/v1/workspaces/${workspaceId}/files?tenantId=${TENANT}&path=.&depth=1`);
    expect(result.response.status).toBe(422);
    expect(result.payload.error?.code).toBe("SYMLINK_FORBIDDEN");
  });

  test("file read through a symlink to /etc/passwd is rejected", async () => {
    const workspaceId = "readLink";
    const workspace = await createWorkspace(workspaceId);
    await symlink("/etc/passwd", join(workspace, "passwd-link"));
    const result = await call("GET", `/v1/workspaces/${workspaceId}/file?tenantId=${TENANT}&path=passwd-link`);
    expect(result.response.status).toBe(422);
    expect(result.payload.error?.code).toBe("SYMLINK_FORBIDDEN");
  });

  test("nested parent symlink cannot be used for writes", async () => {
    const workspaceId = "writeLink";
    const workspace = await createWorkspace(workspaceId);
    await mkdir(join(workspace, "safe"), { recursive: true });
    await symlink("/tmp", join(workspace, "safe", "escape"), "dir");
    const marker = join(tmpdir(), `moataz-sandbox-escape-${randomUUID()}.txt`);
    const result = await call("POST", `/v1/workspaces/${workspaceId}/file`, {
      tenantId: TENANT,
      path: `safe/escape/${marker.split("/").at(-1)}`,
      content: "must-not-escape",
      encoding: "utf8",
      overwrite: true,
    });
    expect(result.response.status).toBe(422);
    expect(result.payload.error?.code).toBe("SYMLINK_FORBIDDEN");
    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("symlink remove is rejected and the external target is untouched", async () => {
    const workspaceId = "removeLink";
    const workspace = await createWorkspace(workspaceId);
    const external = join(tmpdir(), `moataz-external-${randomUUID()}.txt`);
    await writeFile(external, "outside", "utf8");
    await symlink(external, join(workspace, "external-link"));
    const result = await call("DELETE", `/v1/workspaces/${workspaceId}/file?tenantId=${TENANT}&path=external-link`);
    expect(result.response.status).toBe(422);
    expect(result.payload.error?.code).toBe("SYMLINK_FORBIDDEN");
    await expect(readFile(external, "utf8")).resolves.toBe("outside");
    await rm(external, { force: true });
  });

  test("parent-directory symlink escape is rejected", async () => {
    const workspaceId = "parentLink";
    const workspace = await createWorkspace(workspaceId);
    await symlink("..", join(workspace, "parent"), "dir");
    const result = await call("GET", `/v1/workspaces/${workspaceId}/file?tenantId=${TENANT}&path=parent/${workspaceId}/.moataz/workspace.json`);
    expect(result.response.status).toBe(422);
    expect(result.payload.error?.code).toBe("SYMLINK_FORBIDDEN");
  });

  test("no user-controlled rename route exists and internal rename targets stay in metadata", async () => {
    const source = await readFile("services/sandbox-runner/server.mjs", "utf8");
    expect(source).not.toMatch(/request\.method === ["'](?:POST|PUT|PATCH)["'][\s\S]{0,200}rename/);
    expect(source).toContain("const temporary = `${statusPath}.${randomUUID()}.tmp`");
    expect(source).toContain("await rename(temporary, statusPath)");
  });
});
