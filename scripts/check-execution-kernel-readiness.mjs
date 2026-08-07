#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const productionRoots = ["src", "services", "drizzle"];
const ignoredDirectories = new Set([".git", ".next", "node_modules", "coverage", "dist", "build", ".open-next"]);
const searchableExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".sql"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...await collectFiles(path.join(directory, entry.name)));
      continue;
    }
    if (searchableExtensions.has(path.extname(entry.name))) files.push(path.join(directory, entry.name));
  }
  return files;
}

const files = [];
for (const productionRoot of productionRoots) {
  files.push(...await collectFiles(path.join(root, productionRoot)));
}

const corpusParts = [];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const content = await readFile(file, "utf8");
  corpusParts.push(`\n/* FILE:${relative} */\n${content}`);
}
const corpus = corpusParts.join("\n");

const checks = [
  ...[
    "execution_jobs",
    "execution_workspaces",
    "execution_steps",
    "execution_events",
    "execution_artifacts",
    "execution_usage",
  ].map((table) => ({
    id: `db.${table}`,
    required: true,
    ok: corpus.includes(`\"${table}\"`) || corpus.includes(`'${table}'`) || corpus.includes(`CREATE TABLE ${table}`) || corpus.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
    expected: `جدول PostgreSQL/Drizzle باسم ${table}`,
  })),
  {
    id: "contract.ExecutionRunner",
    required: true,
    ok: /\b(?:interface|type|abstract class|class)\s+ExecutionRunner\b/.test(corpus),
    expected: "عقد ExecutionRunner مشترك ومستقل عن Sandbox/Browser",
  },
  {
    id: "adapter.ExistingSandboxAdapter",
    required: true,
    ok: /\bExistingSandboxAdapter\b/.test(corpus),
    expected: "ExistingSandboxAdapter يطبق ExecutionRunner فوق Sandbox الحالي",
  },
  {
    id: "worker.execution_tasks",
    required: true,
    ok: /[\"']execution-(?:run|execute|resume|cancel|cleanup|reconcile)[\"']/.test(corpus),
    expected: "مهام Graphile Worker عامة لنواة التنفيذ",
  },
  {
    id: "events.execution_sse",
    required: true,
    ok: /execution_events/.test(corpus) && /text\/event-stream/.test(corpus),
    expected: "SSE عام مبني على execution_events",
  },
  {
    id: "artifacts.registry",
    required: true,
    ok: /\b(?:Execution)?ArtifactRegistry\b/.test(corpus),
    expected: "Artifact Registry موحد يملك التسجيل والتحقق والحدود والتنظيف",
  },
  {
    id: "credentials.broker",
    required: true,
    ok: /\bCredentialBroker\b/.test(corpus),
    expected: "Credential Broker يمنع تمرير الأسرار الخام إلى Workspaces",
  },
  {
    id: "network.deny_by_default",
    required: true,
    ok: /deny_all/.test(corpus) && /network/i.test(corpus),
    expected: "Network policy عامة بنمط deny_all افتراضي",
  },
  {
    id: "quotas.execution",
    required: true,
    ok: /ExecutionQuota|execution quota|execution_usage/.test(corpus),
    expected: "Resource quotas واستخدام موحدان على مستوى Execution Kernel",
  },
  {
    id: "lifecycle.cleanup_reconciliation",
    required: true,
    ok: /ExecutionCleanup|ExecutionReconciliation|execution-reconcile/.test(corpus),
    expected: "Cleanup وReconciliation عامان للنواة",
  },
  {
    id: "lifecycle.cancel_timeout",
    required: true,
    ok: /cancelRequestedAt|cancel_requested_at/.test(corpus) && /timed_out/.test(corpus),
    expected: "إلغاء ومهلة على مستوى دورة التنفيذ",
  },
  {
    id: "security.tenant_isolation",
    required: true,
    ok: /organization_id/.test(corpus) && /organizationId/.test(corpus),
    expected: "Tenant isolation عبر organization_id في مسار التنفيذ",
  },
];

const missing = checks.filter((check) => check.required && !check.ok);
const result = {
  ready: missing.length === 0,
  checkedAt: new Date().toISOString(),
  scannedRoots: productionRoots,
  scannedFiles: files.length,
  checks: checks.map(({ id, ok, expected }) => ({ id, ok, expected })),
  missing: missing.map(({ id, expected }) => ({ id, expected })),
};

console.log(JSON.stringify(result, null, 2));
if (missing.length > 0) process.exitCode = 2;
