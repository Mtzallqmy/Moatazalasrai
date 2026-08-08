import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, normalize, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const PORT = integerEnv("PORT", 8080, 1, 65_535);
const ROOT = resolve(process.env.SANDBOX_WORKSPACE_ROOT || "/data/workspaces");
const SHARED_SECRET = required("SANDBOX_RUNNER_SHARED_SECRET");
const MAX_REQUEST_BYTES = integerEnv("SANDBOX_RUNNER_MAX_REQUEST_BYTES", 4 * 1024 * 1024, 1_024, 32 * 1024 * 1024);
const MAX_FILE_READ_BYTES = integerEnv("SANDBOX_RUNNER_MAX_FILE_READ_BYTES", 25 * 1024 * 1024, 1_024, 100 * 1024 * 1024);
const MAX_CONCURRENT = integerEnv("SANDBOX_RUNNER_CONCURRENCY", 2, 1, 32);
const MAX_PROCESSES = integerEnv("SANDBOX_MAX_PROCESSES", 64, 8, 512);
const CPU_SECONDS = integerEnv("SANDBOX_CPU_SECONDS", 300, 1, 1_800);
const MEMORY_KB = integerEnv("SANDBOX_MEMORY_KB", 524_288, 65_536, 8_388_608);
const FILE_SIZE_KB = integerEnv("SANDBOX_FILE_SIZE_KB", 524_288, 1_024, 10_485_760);
const ALLOWED_TEMPLATES = new Set((process.env.SANDBOX_ALLOWED_TEMPLATES || "moataz-code").split(",").map((value) => value.trim()).filter(Boolean));
const ALLOWED_EXECUTABLES = new Set((process.env.SANDBOX_ALLOWED_EXECUTABLES || "python3,python,node,npm,git").split(",").map((value) => value.trim()).filter(Boolean));
const SAFE_ENVIRONMENT_KEYS = new Set(["LANG", "LC_ALL", "TZ", "NO_COLOR", "PYTHONIOENCODING"]);
const FORBIDDEN_ENVIRONMENT = /(?:DATABASE_URL|RAILWAY|SECRET|TOKEN|PASSWORD|COOKIE|SESSION|ENCRYPTION|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i;
const activeExecutions = new Map();
const usedNonces = new Map();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integerEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function error(response, status, code, message) {
  json(response, status, { error: { code, message } });
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw Object.assign(new Error("Request too large."), { status: 413, code: "PAYLOAD_TOO_LARGE" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bodySha256(body) {
  return createHash("sha256").update(body, "utf8").digest("base64url");
}

function expectedSignature(timestamp, nonce, service, method, pathname, bodyHash) {
  return createHmac("sha256", SHARED_SECRET)
    .update([timestamp, nonce, service, method.toUpperCase(), pathname, bodyHash].join("\n"), "utf8")
    .digest("base64url");
}

function authenticate(request, pathname, body) {
  const timestamp = request.headers["x-moataz-timestamp"];
  const nonce = request.headers["x-moataz-nonce"];
  const signature = request.headers["x-moataz-signature"];
  const service = request.headers["x-moataz-service"];
  const suppliedBodyHash = request.headers["x-moataz-body-sha256"];
  if (
    typeof timestamp !== "string"
    || typeof nonce !== "string"
    || typeof signature !== "string"
    || typeof service !== "string"
    || typeof suppliedBodyHash !== "string"
  ) return false;
  if (!new Set(["platform-execution-kernel", "platform-sandbox"]).has(service)) return false;
  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60_000 || usedNonces.has(nonce)) return false;
  const calculatedBodyHash = bodySha256(body);
  const expectedBodyHash = Buffer.from(calculatedBodyHash);
  const actualBodyHash = Buffer.from(suppliedBodyHash);
  if (expectedBodyHash.length !== actualBodyHash.length || !timingSafeEqual(expectedBodyHash, actualBodyHash)) return false;
  const expected = Buffer.from(expectedSignature(timestamp, nonce, service, request.method || "GET", pathname, calculatedBodyHash));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  usedNonces.set(nonce, Date.now());
  for (const [key, createdAt] of usedNonces) {
    if (Date.now() - createdAt > 10 * 60_000) usedNonces.delete(key);
  }
  return true;
}

function safeId(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw Object.assign(new Error(`${name} is invalid.`), { status: 400, code: "INVALID_IDENTIFIER" });
  }
  return value;
}

function workspaceDirectory(tenantId, workspaceId) {
  return join(ROOT, safeId(tenantId, "tenantId"), safeId(workspaceId, "workspaceId"));
}

function assertContained(root, target) {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(target) === ROOT) {
    throw Object.assign(new Error("Path traversal is forbidden."), { status: 400, code: "PATH_TRAVERSAL" });
  }
}

function safeWorkspacePath(root, value = ".") {
  if (typeof value !== "string" || value.includes("\0") || value.includes("\\")) {
    throw Object.assign(new Error("Path is invalid."), { status: 400, code: "PATH_INVALID" });
  }
  const normalizedPath = normalize(value.trim().replace(/^\/+/, "") || ".");
  if (normalizedPath === ".." || normalizedPath.startsWith(`..${sep}`)) {
    throw Object.assign(new Error("Path traversal is forbidden."), { status: 400, code: "PATH_TRAVERSAL" });
  }
  const target = resolve(root, normalizedPath);
  assertContained(root, target);
  return target;
}

async function assertNoSymlinkSegments(root, target, allowMissing = false) {
  const rootReal = await realpath(root);
  const rel = relative(root, target);
  assertContained(root, target);
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw Object.assign(new Error("Symbolic links are forbidden."), { status: 422, code: "SYMLINK_FORBIDDEN" });
      }
      if (!info.isDirectory() && current !== target) {
        throw Object.assign(new Error("Path parent is not a directory."), { status: 422, code: "PATH_PARENT_INVALID" });
      }
    } catch (cause) {
      if (allowMissing && cause?.code === "ENOENT") break;
      throw cause;
    }
  }
  try {
    const targetReal = await realpath(target);
    const realRel = relative(rootReal, targetReal);
    if (realRel === ".." || realRel.startsWith(`..${sep}`)) {
      throw Object.assign(new Error("Path escapes workspace."), { status: 400, code: "PATH_TRAVERSAL" });
    }
  } catch (cause) {
    if (!(allowMissing && cause?.code === "ENOENT")) throw cause;
  }
}

async function safeExistingPath(root, value) {
  const target = safeWorkspacePath(root, value);
  await assertNoSymlinkSegments(root, target, false);
  return target;
}

async function safeWritablePath(root, value) {
  const target = safeWorkspacePath(root, value);
  await assertNoSymlinkSegments(root, target, true);
  const parent = resolve(target, "..");
  await assertNoSymlinkSegments(root, parent, true);
  return target;
}

async function ensureWorkspace(tenantId, workspaceId) {
  const directory = workspaceDirectory(tenantId, workspaceId);
  await access(directory);
  await assertNoSymlinkSegments(resolve(ROOT, safeId(tenantId, "tenantId")), directory, false);
  return directory;
}

function metadataDirectory(workspaceRoot) {
  return join(workspaceRoot, ".moataz", "executions");
}

function executionPaths(workspaceRoot, executionId) {
  const base = metadataDirectory(workspaceRoot);
  return {
    events: join(base, `${executionId}.jsonl`),
    status: join(base, `${executionId}.json`),
  };
}

async function appendEvent(eventsPath, event) {
  const line = `${JSON.stringify(event)}\n`;
  await writeFile(eventsPath, line, { flag: "a", mode: 0o600 });
}

async function writeStatus(statusPath, value) {
  const temporary = `${statusPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, statusPath);
}

function baseEnvironment() {
  return {
    HOME: "/workspace",
    USER: "sandbox",
    LOGNAME: "sandbox",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TMPDIR: "/tmp",
    NO_COLOR: "1",
    CI: "1",
  };
}

function safeEnvironment(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Environment is invalid."), { status: 400, code: "ENVIRONMENT_INVALID" });
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_ENVIRONMENT_KEYS.has(key) || FORBIDDEN_ENVIRONMENT.test(key) || typeof item !== "string" || item.length > 8_192 || item.includes("\0")) {
      throw Object.assign(new Error("Environment entry is forbidden."), { status: 400, code: "ENVIRONMENT_FORBIDDEN" });
    }
    output[key] = item;
  }
  return output;
}

function safeArgv(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw Object.assign(new Error("argv is invalid."), { status: 400, code: "ARGV_INVALID" });
  }
  const argv = value.map((argument) => {
    if (typeof argument !== "string" || argument.length > 8_192 || argument.includes("\0")) {
      throw Object.assign(new Error("argv contains an invalid argument."), { status: 400, code: "ARGV_INVALID" });
    }
    return argument;
  });
  const executable = argv[0];
  if (basename(executable) !== executable || !ALLOWED_EXECUTABLES.has(executable)) {
    throw Object.assign(new Error("Executable is not allowlisted."), { status: 403, code: "EXECUTABLE_FORBIDDEN" });
  }
  return argv;
}

function bwrapArguments(workspaceRoot, workingDirectory, command) {
  const environment = { ...baseEnvironment(), ...command.environment };
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--unshare-net",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/opt", "/opt",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--bind", workspaceRoot, "/workspace",
    "--chdir", `/workspace/${workingDirectory === "." ? "" : workingDirectory}`,
  ];
  for (const [key, value] of Object.entries(environment)) args.push("--setenv", key, value);
  if (command.mode === "argv") return [...args, "--", ...command.argv];
  return [...args, "--", "/bin/bash", "--noprofile", "--norc", "-o", "pipefail", "-c", command.command];
}

function normalizedCommand(input) {
  if (Array.isArray(input.argv)) {
    return { mode: "argv", argv: safeArgv(input.argv), environment: safeEnvironment(input.environment) };
  }
  if (typeof input.command === "string" && input.command.trim() && input.command.length <= 20_000) {
    return { mode: "legacy-shell", command: input.command, environment: {} };
  }
  throw Object.assign(new Error("Command is invalid."), { status: 400, code: "COMMAND_INVALID" });
}

async function startExecution(input) {
  if (activeExecutions.size >= MAX_CONCURRENT) {
    throw Object.assign(new Error("Runner concurrency is exhausted."), { status: 429, code: "RUNNER_BUSY" });
  }
  const tenantId = safeId(input.tenantId, "tenantId");
  const workspaceId = safeId(input.workspaceId, "workspaceId");
  const executionId = safeId(input.executionId, "executionId");
  const command = normalizedCommand(input);
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 300_000, 1_000), 1_800_000);
  const maxOutputBytes = Math.min(Math.max(Number(input.maxOutputBytes) || 2_097_152, 1_024), 20_971_520);
  const workspaceRoot = await ensureWorkspace(tenantId, workspaceId);
  const requestedWorkingDirectory = safeWorkspacePath(workspaceRoot, input.workingDirectory || ".");
  await assertNoSymlinkSegments(workspaceRoot, requestedWorkingDirectory, false);
  const workingDirectory = relative(workspaceRoot, requestedWorkingDirectory) || ".";
  const paths = executionPaths(workspaceRoot, executionId);
  await mkdir(metadataDirectory(workspaceRoot), { recursive: true, mode: 0o700 });
  try {
    await access(paths.status);
    const existing = JSON.parse(await readFile(paths.status, "utf8"));
    return { executionId, accepted: existing.status === "queued" || existing.status === "running" };
  } catch {}

  const startedAt = new Date().toISOString();
  const status = {
    executionId,
    status: "running",
    startedAt,
    completedAt: null,
    exitCode: null,
    signal: null,
    outputTruncated: false,
    stdoutBytes: 0,
    stderrBytes: 0,
  };
  await writeStatus(paths.status, status);
  await appendEvent(paths.events, { sequence: 1, type: "status", payload: { status: "running", startedAt, mode: command.mode }, createdAt: startedAt });

  const child = spawn("prlimit", [
    `--cpu=${Math.max(1, Math.ceil(Math.min(timeoutMs / 1000, CPU_SECONDS)))}`,
    `--as=${MEMORY_KB * 1024}`,
    `--fsize=${FILE_SIZE_KB * 1024}`,
    `--nproc=${MAX_PROCESSES}`,
    "--", "bwrap", ...bwrapArguments(workspaceRoot, workingDirectory, command),
  ], {
    cwd: workspaceRoot,
    env: baseEnvironment(),
    stdio: [typeof input.stdin === "string" ? "pipe" : "ignore", "pipe", "pipe"],
    detached: true,
    uid: process.getuid?.(),
    gid: process.getgid?.(),
  });

  if (typeof input.stdin === "string") {
    const stdin = Buffer.from(input.stdin, "utf8");
    if (stdin.length > 1_048_576) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      throw Object.assign(new Error("stdin is too large."), { status: 413, code: "STDIN_TOO_LARGE" });
    }
    child.stdin.end(stdin);
  }

  const state = { child, workspaceRoot, paths, sequence: 1, outputBytes: 0, maxOutputBytes, status };
  activeExecutions.set(executionId, state);

  const recordChunk = async (stream, chunk) => {
    if (!activeExecutions.has(executionId)) return;
    const buffer = Buffer.from(chunk);
    const remaining = Math.max(0, maxOutputBytes - state.outputBytes);
    const kept = buffer.subarray(0, remaining);
    state.outputBytes += kept.length;
    state.status[`${stream}Bytes`] += kept.length;
    if (buffer.length > kept.length) state.status.outputTruncated = true;
    if (kept.length) {
      state.sequence += 1;
      await appendEvent(paths.events, {
        sequence: state.sequence,
        type: "output",
        stream,
        payload: { text: kept.toString("utf8") },
        createdAt: new Date().toISOString(),
      });
    }
    if (state.outputBytes >= maxOutputBytes) {
      state.status.outputTruncated = true;
      state.status.status = "failed";
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
    }
  };

  child.stdout.on("data", (chunk) => { void recordChunk("stdout", chunk); });
  child.stderr.on("data", (chunk) => { void recordChunk("stderr", chunk); });

  const timeout = setTimeout(() => {
    state.status.status = "timed_out";
    state.status.signal = "SIGTERM";
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 2_000).unref();
  }, timeoutMs);

  child.on("error", async () => {
    clearTimeout(timeout);
    state.status.status = "failed";
    state.status.completedAt = new Date().toISOString();
    await writeStatus(paths.status, state.status);
    state.sequence += 1;
    await appendEvent(paths.events, { sequence: state.sequence, type: "status", payload: { status: "failed", errorCode: "SPAWN_FAILED" }, createdAt: state.status.completedAt });
    activeExecutions.delete(executionId);
  });

  child.on("close", async (code, signal) => {
    clearTimeout(timeout);
    if (state.status.status === "running") {
      state.status.status = code === 0 ? "completed" : signal ? "cancelled" : "failed";
    }
    state.status.exitCode = Number.isInteger(code) ? code : null;
    state.status.signal = signal || state.status.signal;
    state.status.completedAt = new Date().toISOString();
    await writeStatus(paths.status, state.status);
    state.sequence += 1;
    await appendEvent(paths.events, {
      sequence: state.sequence,
      type: "status",
      payload: { ...state.status },
      createdAt: state.status.completedAt,
    });
    activeExecutions.delete(executionId);
  });

  return { executionId, accepted: true };
}

async function executionSnapshot(workspaceRoot, executionId, after = 0) {
  const paths = executionPaths(workspaceRoot, safeId(executionId, "executionId"));
  const statusValue = JSON.parse(await readFile(paths.status, "utf8"));
  let events = [];
  try {
    const content = await readFile(paths.events, "utf8");
    events = content.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((event) => event.sequence > after).slice(0, 500);
  } catch {}
  return { ...statusValue, events };
}

async function fileInfo(root, target) {
  await assertNoSymlinkSegments(root, target, false);
  const value = await lstat(target);
  if (value.isSymbolicLink() || (!value.isFile() && !value.isDirectory())) {
    throw Object.assign(new Error("Unsupported workspace file type."), { status: 422, code: "FILE_TYPE_FORBIDDEN" });
  }
  const rel = relative(root, target).split(sep).join("/") || ".";
  return {
    path: rel,
    isDirectory: value.isDirectory(),
    sizeBytes: value.isFile() ? value.size : 0,
    mimeType: value.isDirectory() ? null : mimeType(rel),
    sha256: value.isFile() && value.size <= MAX_FILE_READ_BYTES ? await fileSha256(target) : null,
    modifiedAt: value.mtime.toISOString(),
  };
}

function mimeType(filename) {
  const extension = extname(filename).toLowerCase();
  return ({
    ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json", ".js": "text/javascript",
    ".mjs": "text/javascript", ".ts": "text/typescript", ".tsx": "text/tsx", ".py": "text/x-python",
    ".html": "text/html", ".css": "text/css", ".csv": "text/csv", ".xml": "application/xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".pdf": "application/pdf", ".zip": "application/zip", ".gz": "application/gzip",
  })[extension] || "application/octet-stream";
}

async function fileSha256(target) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(target), hash);
  return hash.digest("hex");
}

async function listFiles(root, requestedPath, depth) {
  const start = await safeExistingPath(root, requestedPath);
  const output = [];
  async function walk(current, remaining) {
    const info = await fileInfo(root, current);
    if (info.path.startsWith(".moataz/")) return;
    output.push(info);
    if (!info.isDirectory || remaining <= 0 || output.length >= 10_000) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".moataz" || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) continue;
      await walk(join(current, entry.name), remaining - 1);
      if (output.length >= 10_000) break;
    }
  }
  await walk(start, depth);
  return output;
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;
  if (request.method === "GET" && pathname === "/health") {
    return json(response, 200, {
      ok: true,
      protocolVersion: 2,
      argvExecution: true,
      networkIsolation: true,
      activeExecutions: activeExecutions.size,
    });
  }
  const bodyText = request.method === "GET" || request.method === "DELETE" ? "" : await readBody(request);
  if (!authenticate(request, pathname, bodyText)) return error(response, 401, "UNAUTHORIZED", "Invalid runner signature.");
  let body = {};
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch { return error(response, 400, "INVALID_JSON", "Invalid JSON body."); }
  }

  const workspaceMatch = pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]+)$/);
  const resetMatch = pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]+)\/reset$/);
  const executionsMatch = pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]+)\/executions$/);
  const executionMatch = pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]+)\/executions\/([A-Za-z0-9_-]+)$/);
  const stopMatch = pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]+)\/executions\/([A-Za-z0-9_-]+)\/stop$/);
  const filesMatch = pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]+)\/files$/);
  const fileMatch = pathname.match(/^\/v1\/workspaces\/([A-Za-z0-9_-]+)\/file$/);

  if (request.method === "POST" && pathname === "/v1/workspaces") {
    const tenantId = safeId(body.tenantId, "tenantId");
    const workspaceId = safeId(body.workspaceId, "workspaceId");
    if (!ALLOWED_TEMPLATES.has(body.template)) return error(response, 422, "TEMPLATE_NOT_ALLOWED", "Workspace template is not allowed.");
    if (body.networkMode !== "disabled") return error(response, 403, "NETWORK_FORBIDDEN", "Network access is disabled by default.");
    const directory = workspaceDirectory(tenantId, workspaceId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await mkdir(metadataDirectory(directory), { recursive: true, mode: 0o700 });
    await writeFile(join(directory, ".moataz", "workspace.json"), JSON.stringify({ tenantId, workspaceId, template: body.template, networkMode: "disabled", createdAt: new Date().toISOString() }), { mode: 0o600 });
    return json(response, 201, { workspaceId, status: "ready" });
  }

  if (workspaceMatch && request.method === "DELETE") {
    const workspaceId = workspaceMatch[1];
    const tenantId = safeId(url.searchParams.get("tenantId"), "tenantId");
    const directory = workspaceDirectory(tenantId, workspaceId);
    if ([...activeExecutions.values()].some((entry) => entry.workspaceRoot === directory)) return error(response, 409, "WORKSPACE_BUSY", "Workspace has active executions.");
    await rm(directory, { recursive: true, force: true });
    return json(response, 200, { deleted: true });
  }

  if (resetMatch && request.method === "POST") {
    const workspaceId = resetMatch[1];
    const tenantId = safeId(body.tenantId, "tenantId");
    const directory = workspaceDirectory(tenantId, workspaceId);
    if ([...activeExecutions.values()].some((entry) => entry.workspaceRoot === directory)) return error(response, 409, "WORKSPACE_BUSY", "Workspace has active executions.");
    await rm(directory, { recursive: true, force: true });
    await mkdir(metadataDirectory(directory), { recursive: true, mode: 0o700 });
    return json(response, 200, { workspaceId, status: "ready" });
  }

  if (executionsMatch && request.method === "POST") {
    if (body.workspaceId !== executionsMatch[1]) return error(response, 400, "WORKSPACE_MISMATCH", "Workspace identifiers do not match.");
    const result = await startExecution(body);
    return json(response, 202, result);
  }

  if (executionMatch && request.method === "GET") {
    const tenantId = safeId(url.searchParams.get("tenantId"), "tenantId");
    const directory = await ensureWorkspace(tenantId, executionMatch[1]);
    const snapshot = await executionSnapshot(directory, executionMatch[2], Number(url.searchParams.get("after") || 0));
    return json(response, 200, snapshot);
  }

  if (stopMatch && request.method === "POST") {
    const state = activeExecutions.get(stopMatch[2]);
    if (!state) return json(response, 200, { stopped: false });
    state.status.status = "cancelled";
    state.status.signal = "SIGTERM";
    try { process.kill(-state.child.pid, "SIGTERM"); } catch {}
    setTimeout(() => { try { process.kill(-state.child.pid, "SIGKILL"); } catch {} }, 2_000).unref();
    return json(response, 200, { stopped: true });
  }

  if (filesMatch && request.method === "GET") {
    const tenantId = safeId(url.searchParams.get("tenantId"), "tenantId");
    const directory = await ensureWorkspace(tenantId, filesMatch[1]);
    const files = await listFiles(directory, url.searchParams.get("path") || ".", Math.min(Math.max(Number(url.searchParams.get("depth") || 4), 1), 10));
    return json(response, 200, { files });
  }

  if (fileMatch && request.method === "GET") {
    const tenantId = safeId(url.searchParams.get("tenantId"), "tenantId");
    const directory = await ensureWorkspace(tenantId, fileMatch[1]);
    const target = await safeExistingPath(directory, url.searchParams.get("path") || "");
    const value = await lstat(target);
    if (!value.isFile() || value.isSymbolicLink()) return error(response, 422, "NOT_A_FILE", "Path is not a regular file.");
    const maxBytes = Math.min(Math.max(Number(url.searchParams.get("maxBytes") || 262_144), 1), MAX_FILE_READ_BYTES);
    if (value.size > maxBytes) return error(response, 413, "FILE_TOO_LARGE", "File is larger than the read limit.");
    const content = await readFile(target);
    const utf8 = !content.includes(0) && mimeType(target).startsWith("text/");
    return json(response, 200, { content: content.toString(utf8 ? "utf8" : "base64"), encoding: utf8 ? "utf8" : "base64", sizeBytes: value.size, sha256: await fileSha256(target) });
  }

  if (fileMatch && request.method === "POST") {
    const tenantId = safeId(body.tenantId, "tenantId");
    const directory = await ensureWorkspace(tenantId, fileMatch[1]);
    const target = await safeWritablePath(directory, body.path);
    const exists = await lstat(target).then((value) => {
      if (value.isSymbolicLink() || !value.isFile()) throw Object.assign(new Error("Target type is forbidden."), { status: 422, code: "FILE_TYPE_FORBIDDEN" });
      return true;
    }).catch((cause) => {
      if (cause?.code === "ENOENT") return false;
      throw cause;
    });
    if (exists && body.overwrite !== true) return error(response, 409, "FILE_EXISTS", "File already exists.");
    const content = Buffer.from(String(body.content || ""), body.encoding === "base64" ? "base64" : "utf8");
    if (content.length > MAX_REQUEST_BYTES) return error(response, 413, "FILE_TOO_LARGE", "File is larger than the write limit.");
    await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
    await assertNoSymlinkSegments(directory, resolve(target, ".."), false);
    await writeFile(target, content, { mode: 0o600, flag: exists ? "w" : "wx" });
    return json(response, 200, await fileInfo(directory, target));
  }

  if (fileMatch && request.method === "DELETE") {
    const tenantId = safeId(url.searchParams.get("tenantId"), "tenantId");
    const directory = await ensureWorkspace(tenantId, fileMatch[1]);
    const target = await safeExistingPath(directory, url.searchParams.get("path") || "");
    const recursive = url.searchParams.get("recursive") === "true";
    const value = await lstat(target);
    if (value.isSymbolicLink() || (!value.isDirectory() && !value.isFile())) return error(response, 422, "FILE_TYPE_FORBIDDEN", "Unsupported path type.");
    if (value.isDirectory() && !recursive) return error(response, 409, "RECURSIVE_REQUIRED", "Recursive deletion must be explicit.");
    await rm(target, { recursive, force: false });
    return json(response, 200, { deleted: true });
  }

  return error(response, 404, "NOT_FOUND", "Runner route not found.");
}

await mkdir(ROOT, { recursive: true, mode: 0o700 });
const server = createServer((request, response) => {
  void handleRequest(request, response).catch((cause) => {
    const status = Number(cause?.status) || 500;
    const code = typeof cause?.code === "string" ? cause.code : "INTERNAL_ERROR";
    const message = status >= 500 ? "Sandbox runner failed." : cause instanceof Error ? cause.message : "Request failed.";
    if (!response.headersSent) error(response, status, code, message);
    else response.end();
  });
});
server.requestTimeout = 65_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({
    level: "info",
    event: "sandbox.runner.started",
    port: PORT,
    protocolVersion: 2,
    argvExecution: true,
    networkIsolation: true,
  }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", event: "sandbox.runner.stopping", signal }));
  for (const state of activeExecutions.values()) {
    try { process.kill(-state.child.pid, "SIGTERM"); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
