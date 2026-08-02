import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import ipaddr from "ipaddr.js";
import { chromium } from "@playwright/test";

const PORT = integerEnv("PORT", 8080, 1, 65_535);
const SHARED_SECRET = required("BROWSER_RUNNER_SHARED_SECRET");
const PUBLIC_URL = required("BROWSER_RUNNER_PUBLIC_URL").replace(/\/$/, "");
const MAX_REQUEST_BYTES = integerEnv("BROWSER_RUNNER_MAX_REQUEST_BYTES", 2 * 1024 * 1024, 1_024, 20 * 1024 * 1024);
const MAX_SESSIONS = integerEnv("BROWSER_RUNNER_CONCURRENCY", 1, 1, 10);
const LOGIN_TTL_MS = integerEnv("BROWSER_LOGIN_TTL_MS", 15 * 60_000, 60_000, 60 * 60_000);
const TASK_TTL_MS = integerEnv("BROWSER_TASK_TTL_MS", 15 * 60_000, 60_000, 60 * 60_000);
const VIEWPORT = { width: 1280, height: 800 };
const loginSessions = new Map();
const taskSessions = new Map();
const usedNonces = new Map();
const dnsCache = new Map();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function integerEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is invalid.`);
  return value;
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

function fail(response, status, code, message) {
  json(response, status, { error: { code, message } });
}

async function bodyText(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw Object.assign(new Error("Payload too large."), { status: 413, code: "PAYLOAD_TOO_LARGE" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function expectedSignature(timestamp, nonce, method, pathname, body) {
  return createHmac("sha256", SHARED_SECRET)
    .update([timestamp, nonce, method.toUpperCase(), pathname, body].join("\n"), "utf8")
    .digest("base64url");
}

function authenticateInternal(request, pathname, body) {
  const timestamp = request.headers["x-moataz-timestamp"];
  const nonce = request.headers["x-moataz-nonce"];
  const signature = request.headers["x-moataz-signature"];
  if (typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string") return false;
  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60_000 || usedNonces.has(nonce)) return false;
  const expected = Buffer.from(expectedSignature(timestamp, nonce, request.method || "GET", pathname, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  usedNonces.set(nonce, Date.now());
  for (const [value, createdAt] of usedNonces) if (Date.now() - createdAt > 10 * 60_000) usedNonces.delete(value);
  return true;
}

function safeId(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) {
    throw Object.assign(new Error(`${name} is invalid.`), { status: 400, code: "INVALID_IDENTIFIER" });
  }
  return value;
}

function hashToken(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokenMatches(expected, supplied) {
  if (typeof supplied !== "string" || supplied.length > 500) return false;
  const actual = hashToken(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizedDomains(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 30) throw Object.assign(new Error("Allowed domains are invalid."), { status: 400, code: "DOMAINS_INVALID" });
  return [...new Set(values.map((value) => {
    if (typeof value !== "string") throw Object.assign(new Error("Allowed domain is invalid."), { status: 400, code: "DOMAIN_INVALID" });
    const hostname = value.trim().toLowerCase().replace(/\.$/, "");
    if (!/^[a-z0-9.-]{1,253}$/.test(hostname) || hostname.includes("..") || hostname === "localhost" || hostname.endsWith(".local")) {
      throw Object.assign(new Error("Allowed domain is invalid."), { status: 400, code: "DOMAIN_INVALID" });
    }
    return hostname;
  }))];
}

function hostnameAllowed(hostname, domains) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function publicIp(value) {
  try { return ipaddr.parse(value).range() === "unicast"; } catch { return false; }
}

async function assertSafeUrl(value, domains) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error("URL is invalid."), { status: 400, code: "URL_INVALID" }); }
  if (url.protocol === "about:" || url.protocol === "data:" || url.protocol === "blob:") return url;
  if (url.protocol !== "https:" && url.protocol !== "http:") throw Object.assign(new Error("Protocol is forbidden."), { status: 403, code: "PROTOCOL_FORBIDDEN" });
  if (url.username || url.password) throw Object.assign(new Error("URL credentials are forbidden."), { status: 403, code: "URL_CREDENTIALS_FORBIDDEN" });
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostnameAllowed(hostname, domains)) throw Object.assign(new Error("Domain is outside the allowlist."), { status: 403, code: "DOMAIN_FORBIDDEN" });
  const cached = dnsCache.get(hostname);
  let addresses = cached?.expiresAt > Date.now() ? cached.addresses : null;
  if (!addresses) {
    if (ipaddr.isValid(hostname)) addresses = [hostname];
    else addresses = (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
    dnsCache.set(hostname, { addresses, expiresAt: Date.now() + 60_000 });
  }
  if (!addresses.length || addresses.some((address) => !publicIp(address))) {
    throw Object.assign(new Error("Private or reserved network is forbidden."), { status: 403, code: "PRIVATE_NETWORK_FORBIDDEN" });
  }
  return url;
}

async function hardenedContext(storageState, allowedDomains, maxPages) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    storageState: storageState || undefined,
    acceptDownloads: true,
    serviceWorkers: "block",
    locale: "ar",
  });
  await context.route("**/*", async (route) => {
    try {
      await assertSafeUrl(route.request().url(), allowedDomains);
      const headers = { ...route.request().headers() };
      delete headers.cookie;
      await route.continue({ headers });
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  context.on("page", async () => {
    const pages = context.pages();
    if (pages.length > maxPages) await pages.at(-1)?.close().catch(() => undefined);
  });
  return { browser, context };
}

async function newPage(context, startUrl, domains) {
  const page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  await assertSafeUrl(startUrl, domains);
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return page;
}

function interactiveHtml(sessionId, token) {
  const escapedSession = JSON.stringify(sessionId);
  const escapedToken = JSON.stringify(token);
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تسجيل الدخول الآمن</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#07131a;color:#e8f7f6;font-family:system-ui,sans-serif}.bar{display:flex;gap:.5rem;align-items:center;padding:.65rem;background:#0b2029;position:sticky;top:0}.bar input{min-width:0;flex:1;background:#102c36;color:inherit;border:1px solid #285564;border-radius:.55rem;padding:.65rem}.bar button{background:#1aa89c;color:#031b1a;border:0;border-radius:.55rem;padding:.65rem .8rem;font-weight:700}.bar button.danger{background:#e15b64;color:white}.screen{display:flex;justify-content:center;padding:.5rem}.screen img{max-width:100%;height:auto;border:1px solid #285564;background:white;cursor:crosshair}.keys{display:flex;gap:.5rem;padding:.65rem;position:sticky;bottom:0;background:#0b2029}.keys input{flex:1;background:#102c36;color:inherit;border:1px solid #285564;border-radius:.55rem;padding:.65rem}.status{font-size:.85rem;color:#9bc7c5}
</style></head><body>
<div class="bar"><button data-key="Alt+Left">رجوع</button><button data-action="reload">تحديث</button><input id="url" aria-label="العنوان"><button data-action="navigate">انتقال</button><button data-action="finalize">حفظ الجلسة</button><button class="danger" data-action="cancel">إلغاء</button></div>
<div class="screen"><img id="screen" alt="المتصفح التفاعلي" width="1280" height="800"></div>
<div class="keys"><input id="text" type="password" autocomplete="off" aria-label="نص يرسل مباشرة للحقل المحدد" placeholder="اكتب النص أو كلمة المرور ثم أرسله"><button data-action="type">إرسال النص</button><button data-key="Tab">Tab</button><button data-key="Enter">Enter</button><span class="status" id="status">لا تُحفظ كلمات المرور أو تُرسل للمنصة.</span></div>
<script>
const sessionId=${escapedSession},token=${escapedToken};const screen=document.getElementById('screen'),status=document.getElementById('status'),urlInput=document.getElementById('url');
async function call(action,payload={}){const r=await fetch('/interactive/'+encodeURIComponent(sessionId)+'/input?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'فشل الطلب');if(j.currentUrl)urlInput.value=j.currentUrl;return j}
async function refresh(){screen.src='/interactive/'+encodeURIComponent(sessionId)+'/screenshot?token='+encodeURIComponent(token)+'&t='+Date.now();try{const j=await call('status');if(j.currentUrl)urlInput.value=j.currentUrl;if(j.status!=='active'){status.textContent='انتهت الجلسة: '+j.status;return}}catch(e){status.textContent=e.message}setTimeout(refresh,700)}
screen.addEventListener('click',async e=>{const r=screen.getBoundingClientRect();await call('click',{x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height})});
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>call('key',{key:b.dataset.key}));
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{const a=b.dataset.action;try{if(a==='type'){const el=document.getElementById('text');await call('type',{text:el.value});el.value=''}else if(a==='navigate')await call(a,{url:urlInput.value});else await call(a);status.textContent=a==='finalize'?'تم حفظ الجلسة. عُد إلى منصة معتز.':'تم'}catch(e){status.textContent=e.message}});refresh();
</script></body></html>`;
}

function locatorFor(page, target) {
  if (!target || typeof target !== "object") throw Object.assign(new Error("Target is required."), { status: 400, code: "TARGET_REQUIRED" });
  if (target.testId) return page.getByTestId(String(target.testId)).first();
  if (target.role && target.name) return page.getByRole(String(target.role), { name: String(target.name), exact: true }).first();
  if (target.label) return page.getByLabel(String(target.label), { exact: true }).first();
  if (target.text) return page.getByText(String(target.text), { exact: true }).first();
  if (target.css && target.cssJustification) return page.locator(String(target.css)).first();
  throw Object.assign(new Error("Stable target is missing."), { status: 400, code: "TARGET_INVALID" });
}

async function executeStep(session, step) {
  if (!step || typeof step !== "object" || typeof step.id !== "string" || typeof step.action !== "string") {
    throw Object.assign(new Error("Step is invalid."), { status: 400, code: "STEP_INVALID" });
  }
  const page = session.context.pages()[0] ?? await session.context.newPage();
  const startedAt = Date.now();
  let result = {};
  if (step.action === "navigate") {
    await assertSafeUrl(step.url, session.allowedDomains);
    const response = await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    result = { url: page.url(), status: response?.status() ?? null, title: await page.title() };
  } else {
    const locator = locatorFor(page, step.target);
    await locator.waitFor({ state: "visible", timeout: 15_000 });
    if (step.action === "click") {
      await locator.click({ timeout: 15_000 });
      result = { clicked: true, url: page.url() };
    } else if (step.action === "fill") {
      if (typeof step.value !== "string") throw Object.assign(new Error("Fill value is missing."), { status: 400, code: "VALUE_REQUIRED" });
      await locator.fill(step.value);
      result = { filled: true };
    } else if (step.action === "select") {
      if (typeof step.option !== "string") throw Object.assign(new Error("Select option is missing."), { status: 400, code: "OPTION_REQUIRED" });
      const selected = await locator.selectOption(step.option);
      result = { selected };
    } else if (step.action === "read" || step.action === "extract") {
      const text = (await locator.innerText()).slice(0, 50_000);
      result = { text };
    } else if (step.action === "submit") {
      await locator.click({ timeout: 15_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      result = { submitted: true, url: page.url(), title: await page.title() };
    } else if (step.action === "upload") {
      const artifact = session.artifacts?.[step.fileArtifactId];
      if (!artifact) throw Object.assign(new Error("Approved upload artifact is missing."), { status: 422, code: "UPLOAD_ARTIFACT_MISSING" });
      await locator.setInputFiles({ name: artifact.filename, mimeType: artifact.mimeType, buffer: Buffer.from(artifact.contentBase64, "base64") });
      result = { uploaded: true, filename: artifact.filename };
    } else if (step.action === "download") {
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), locator.click()]);
      const failure = await download.failure();
      if (failure) throw Object.assign(new Error("Download failed."), { status: 422, code: "DOWNLOAD_FAILED" });
      const path = await download.path();
      if (!path) throw Object.assign(new Error("Download is unavailable."), { status: 422, code: "DOWNLOAD_UNAVAILABLE" });
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(path);
      if (content.length > session.maxDownloadBytes) throw Object.assign(new Error("Download exceeds the configured limit."), { status: 413, code: "DOWNLOAD_TOO_LARGE" });
      const filename = download.suggestedFilename();
      if (/\.(exe|msi|dll|bat|cmd|com|scr|ps1|sh|apk|dmg|pkg|deb|rpm)$/i.test(filename)) {
        throw Object.assign(new Error("Executable downloads are forbidden."), { status: 403, code: "DOWNLOAD_TYPE_FORBIDDEN" });
      }
      result = { download: { filename, sizeBytes: content.length, contentBase64: content.toString("base64") } };
    } else {
      throw Object.assign(new Error("Action is unsupported."), { status: 400, code: "ACTION_UNSUPPORTED" });
    }
  }
  return { result, durationMs: Date.now() - startedAt, currentUrl: page.url(), title: await page.title().catch(() => "") };
}

async function closeSession(session, status) {
  session.status = status;
  session.updatedAt = Date.now();
  await session.context?.close().catch(() => undefined);
  await session.browser?.close().catch(() => undefined);
}

async function handle(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;
  if (request.method === "GET" && pathname === "/health") return json(response, 200, { ok: true, loginSessions: loginSessions.size, taskSessions: taskSessions.size });

  const interactiveMatch = pathname.match(/^\/interactive\/([A-Za-z0-9_-]+)$/);
  const screenshotMatch = pathname.match(/^\/interactive\/([A-Za-z0-9_-]+)\/screenshot$/);
  const inputMatch = pathname.match(/^\/interactive\/([A-Za-z0-9_-]+)\/input$/);
  if (interactiveMatch && request.method === "GET") {
    const session = loginSessions.get(interactiveMatch[1]);
    const token = url.searchParams.get("token");
    if (!session || !tokenMatches(session.tokenHash, token)) return fail(response, 404, "SESSION_NOT_FOUND", "Interactive session is unavailable.");
    const html = interactiveHtml(session.id, token);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", "referrer-policy": "no-referrer" });
    return response.end(html);
  }
  if (screenshotMatch && request.method === "GET") {
    const session = loginSessions.get(screenshotMatch[1]);
    if (!session || !tokenMatches(session.tokenHash, url.searchParams.get("token")) || session.status !== "active") return fail(response, 404, "SESSION_NOT_FOUND", "Interactive session is unavailable.");
    const image = await session.page.screenshot({ type: "jpeg", quality: 70, animations: "disabled" });
    response.writeHead(200, { "content-type": "image/jpeg", "content-length": image.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    return response.end(image);
  }
  if (inputMatch && request.method === "POST") {
    const session = loginSessions.get(inputMatch[1]);
    if (!session || !tokenMatches(session.tokenHash, url.searchParams.get("token"))) return fail(response, 404, "SESSION_NOT_FOUND", "Interactive session is unavailable.");
    const text = await bodyText(request);
    let input;
    try { input = JSON.parse(text); } catch { return fail(response, 400, "INVALID_JSON", "Invalid JSON."); }
    if (input.action === "status") return json(response, 200, { status: session.status, currentUrl: session.page.url() });
    if (session.status !== "active") return fail(response, 409, "SESSION_NOT_ACTIVE", "Interactive session is no longer active.");
    if (input.action === "click") {
      const x = Math.min(1, Math.max(0, Number(input.x)));
      const y = Math.min(1, Math.max(0, Number(input.y)));
      await session.page.mouse.click(x * VIEWPORT.width, y * VIEWPORT.height);
    } else if (input.action === "type") {
      if (typeof input.text !== "string" || input.text.length > 4_000) return fail(response, 400, "TEXT_INVALID", "Input text is invalid.");
      await session.page.keyboard.insertText(input.text);
    } else if (input.action === "key") {
      if (!["Tab", "Enter", "Backspace", "Escape", "Alt+Left"].includes(input.key)) return fail(response, 400, "KEY_FORBIDDEN", "Key is not allowed.");
      await session.page.keyboard.press(input.key);
    } else if (input.action === "reload") {
      await session.page.reload({ waitUntil: "domcontentloaded" });
    } else if (input.action === "navigate") {
      await assertSafeUrl(input.url, session.allowedDomains);
      await session.page.goto(input.url, { waitUntil: "domcontentloaded" });
    } else if (input.action === "finalize") {
      session.storageState = await session.context.storageState();
      session.status = "completed";
      session.completedAt = Date.now();
    } else if (input.action === "cancel") {
      await closeSession(session, "cancelled");
    } else return fail(response, 400, "ACTION_UNSUPPORTED", "Interactive action is unsupported.");
    session.updatedAt = Date.now();
    return json(response, 200, { status: session.status, currentUrl: session.page.url() });
  }

  const text = request.method === "GET" || request.method === "DELETE" ? "" : await bodyText(request);
  if (!authenticateInternal(request, pathname, text)) return fail(response, 401, "UNAUTHORIZED", "Invalid runner signature.");
  let body = {};
  if (text) { try { body = JSON.parse(text); } catch { return fail(response, 400, "INVALID_JSON", "Invalid JSON."); } }

  const loginMatch = pathname.match(/^\/v1\/login-sessions\/([A-Za-z0-9_-]+)$/);
  const taskMatch = pathname.match(/^\/v1\/tasks\/([A-Za-z0-9_-]+)$/);
  const stepMatch = pathname.match(/^\/v1\/tasks\/([A-Za-z0-9_-]+)\/step$/);
  const stateMatch = pathname.match(/^\/v1\/tasks\/([A-Za-z0-9_-]+)\/state$/);

  if (pathname === "/v1/login-sessions" && request.method === "POST") {
    if (loginSessions.size + taskSessions.size >= MAX_SESSIONS) return fail(response, 429, "RUNNER_BUSY", "Browser runner is at capacity.");
    const tenantId = safeId(body.tenantId, "tenantId");
    const connectionId = safeId(body.connectionId, "connectionId");
    const allowedDomains = normalizedDomains(body.allowedDomains);
    const startUrl = (await assertSafeUrl(body.startUrl, allowedDomains)).toString();
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + LOGIN_TTL_MS;
    const { browser, context } = await hardenedContext(undefined, allowedDomains, Math.min(Math.max(Number(body.maxPages) || 5, 1), 10));
    const page = await newPage(context, startUrl, allowedDomains);
    loginSessions.set(id, { id, tenantId, connectionId, tokenHash: hashToken(token), allowedDomains, browser, context, page, status: "active", storageState: null, expiresAt, updatedAt: Date.now() });
    return json(response, 201, { sessionId: id, interactiveUrl: `${PUBLIC_URL}/interactive/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, expiresAt: new Date(expiresAt).toISOString() });
  }
  if (loginMatch && request.method === "GET") {
    const session = loginSessions.get(loginMatch[1]);
    if (!session || session.tenantId !== url.searchParams.get("tenantId")) return fail(response, 404, "SESSION_NOT_FOUND", "Login session is unavailable.");
    return json(response, 200, { status: session.status, ...(session.storageState ? { storageState: session.storageState } : {}), currentUrl: session.page?.url(), ...(session.errorCode ? { errorCode: session.errorCode } : {}) });
  }
  if (loginMatch && request.method === "DELETE") {
    const session = loginSessions.get(loginMatch[1]);
    if (!session || session.tenantId !== url.searchParams.get("tenantId")) return json(response, 200, { cancelled: false });
    await closeSession(session, "cancelled");
    return json(response, 200, { cancelled: true });
  }

  if (pathname === "/v1/tasks" && request.method === "POST") {
    if (loginSessions.size + taskSessions.size >= MAX_SESSIONS) return fail(response, 429, "RUNNER_BUSY", "Browser runner is at capacity.");
    const tenantId = safeId(body.tenantId, "tenantId");
    const taskId = safeId(body.taskId, "taskId");
    const existing = taskSessions.get(taskId);
    if (existing) return json(response, 200, { taskId, accepted: true });
    const allowedDomains = normalizedDomains(body.allowedDomains);
    const plan = body.plan;
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 50) return fail(response, 400, "PLAN_INVALID", "Browser plan is invalid.");
    const { browser, context } = await hardenedContext(body.storageState, allowedDomains, Math.min(Math.max(Number(body.maxPages) || 5, 1), 10));
    const firstNavigation = plan.steps.find((step) => step.action === "navigate" && step.url);
    const page = firstNavigation ? await newPage(context, firstNavigation.url, allowedDomains) : await context.newPage();
    taskSessions.set(taskId, {
      id: taskId, tenantId, browser, context, page, plan, allowedDomains,
      status: "running", currentStep: 0, events: [], sequence: 0,
      artifacts: body.artifacts || {}, maxDownloadBytes: Math.min(Math.max(Number(body.maxDownloadBytes) || 10 * 1024 * 1024, 1024), 100 * 1024 * 1024),
      expiresAt: Date.now() + TASK_TTL_MS, updatedAt: Date.now(),
    });
    return json(response, 201, { taskId, accepted: true });
  }
  if (stepMatch && request.method === "POST") {
    const session = taskSessions.get(stepMatch[1]);
    if (!session || session.tenantId !== body.tenantId) return fail(response, 404, "TASK_NOT_FOUND", "Browser task is unavailable.");
    if (session.status !== "running") return fail(response, 409, "TASK_NOT_RUNNING", "Browser task is not running.");
    const stepIndex = Number(body.stepIndex);
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= session.plan.steps.length) return fail(response, 400, "STEP_INDEX_INVALID", "Browser step index is invalid.");
    if (stepIndex < session.currentStep) return json(response, 200, { completed: true, stepIndex, result: { alreadyCompleted: true }, currentUrl: session.page.url() });
    if (stepIndex > session.currentStep) return fail(response, 409, "STEP_ORDER_INVALID", "Browser steps must execute in order.");
    const step = session.plan.steps[stepIndex];
    try {
      const result = await executeStep(session, step);
      session.currentStep += 1;
      session.sequence += 1;
      session.events.push({ sequence: session.sequence, type: "step.completed", payload: { stepId: step.id, action: step.action, result: result.result, durationMs: result.durationMs, currentUrl: result.currentUrl }, createdAt: new Date().toISOString() });
      session.updatedAt = Date.now();
      return json(response, 200, { completed: true, stepIndex, ...result });
    } catch (cause) {
      session.sequence += 1;
      session.events.push({ sequence: session.sequence, type: "step.failed", payload: { stepId: step.id, action: step.action, errorCode: cause?.code || "STEP_FAILED" }, createdAt: new Date().toISOString() });
      session.status = "failed";
      session.errorCode = cause?.code || "STEP_FAILED";
      return fail(response, Number(cause?.status) || 422, session.errorCode, "Browser step failed.");
    }
  }
  if (taskMatch && request.method === "GET") {
    const session = taskSessions.get(taskMatch[1]);
    if (!session || session.tenantId !== url.searchParams.get("tenantId")) return fail(response, 404, "TASK_NOT_FOUND", "Browser task is unavailable.");
    const after = Math.max(0, Number(url.searchParams.get("after") || 0));
    return json(response, 200, { taskId: session.id, status: session.status, currentStep: session.currentStep, errorCode: session.errorCode || null, events: session.events.filter((event) => event.sequence > after).slice(0, 500) });
  }
  if (stateMatch && request.method === "GET") {
    const session = taskSessions.get(stateMatch[1]);
    if (!session || session.tenantId !== url.searchParams.get("tenantId")) return fail(response, 404, "TASK_NOT_FOUND", "Browser task is unavailable.");
    const storageState = await session.context.storageState();
    return json(response, 200, { storageState, currentUrl: session.page.url() });
  }
  if (taskMatch && request.method === "DELETE") {
    const session = taskSessions.get(taskMatch[1]);
    if (!session || session.tenantId !== url.searchParams.get("tenantId")) return json(response, 200, { cancelled: false });
    await closeSession(session, "cancelled");
    return json(response, 200, { cancelled: true });
  }
  return fail(response, 404, "NOT_FOUND", "Browser runner route not found.");
}

const server = createServer((request, response) => {
  void handle(request, response).catch((cause) => {
    const status = Number(cause?.status) || 500;
    const code = typeof cause?.code === "string" ? cause.code : "INTERNAL_ERROR";
    const message = status >= 500 ? "Browser runner failed." : cause instanceof Error ? cause.message : "Request failed.";
    if (!response.headersSent) fail(response, status, code, message); else response.end();
  });
});
server.requestTimeout = 45_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, "0.0.0.0", () => console.log(JSON.stringify({ level: "info", event: "browser.runner.started", port: PORT })));

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of loginSessions) {
    if (session.expiresAt <= now || session.status !== "active" && now - session.updatedAt > 60_000) {
      void closeSession(session, session.status === "active" ? "expired" : session.status).finally(() => loginSessions.delete(id));
    }
  }
  for (const [id, session] of taskSessions) {
    if (session.expiresAt <= now || session.status !== "running" && now - session.updatedAt > 60_000) {
      void closeSession(session, session.status === "running" ? "expired" : session.status).finally(() => taskSessions.delete(id));
    }
  }
}, 30_000).unref();

function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", event: "browser.runner.stopping", signal }));
  for (const session of [...loginSessions.values(), ...taskSessions.values()]) void closeSession(session, "cancelled");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
