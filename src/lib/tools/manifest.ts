import type { ToolManifest } from "./contracts";

const kernelLimits = { timeoutMs: 300_000, memoryBytes: 536_870_912, diskBytes: 1_073_741_824, maxArtifactBytes: 104_857_600 } as const;

export const TOOL_MANIFESTS: readonly ToolManifest[] = [
  {
    id: "data.interpreter", version: "1.0.0", titleAr: "مختبر تحليل البيانات", descriptionAr: "تحليل ملفات البيانات داخل بيئة Python معزولة دون خروج شبكي افتراضي.", category: "data",
    requiredPermission: "data_interpreter:run", requiredModule: "operational_tools", executionKind: "execution_kernel",
    supportedInputs: ["csv", "tsv", "xlsx", "json", "ndjson", "txt", "zip"], supportedOutputs: ["report.md", "result.json", "analysis.py", "chart", "export"],
    supportsFiles: true, supportsStreaming: true, supportsCancellation: true, supportsResume: true,
    networkPolicy: { mode: "deny_all" }, defaultLimits: kernelLimits, approvalPolicy: { write: false, external: false, publishing: false }, featureFlag: "DATA_INTERPRETER_ENABLED",
  },
  {
    id: "coding.agent", version: "1.0.0", titleAr: "وكيل البرمجة", descriptionAr: "تخطيط وتعديل مشاريع برمجية داخل Execution Workspace مع تحقق قبل التسليم.", category: "coding",
    requiredPermission: "coding_agent:run", requiredModule: "operational_tools", executionKind: "execution_kernel",
    supportedInputs: ["template", "github", "zip", "artifact"], supportedOutputs: ["specification.md", "plan.md", "tasks.json", "final.diff", "verification-report.json", "implementation-report.md"],
    supportsFiles: true, supportsStreaming: true, supportsCancellation: true, supportsResume: true,
    networkPolicy: { mode: "allowlist", hosts: [] }, defaultLimits: { ...kernelLimits, timeoutMs: 1_800_000, diskBytes: 2_147_483_648 }, approvalPolicy: { write: true, external: true, publishing: true }, featureFlag: "CODING_AGENT_ENABLED",
  },
  {
    id: "browser.agent", version: "1.0.0", titleAr: "وكيل المتصفح", descriptionAr: "تنفيذ مهام متصفح معزولة بخطة قابلة للتحقق وموافقات للأفعال الخارجية.", category: "browser",
    requiredPermission: "browser_agent:run", requiredModule: "operational_tools", executionKind: "execution_kernel",
    supportedInputs: ["objective", "start_url", "allowed_hosts", "artifact"], supportedOutputs: ["task-plan.json", "execution-log.json", "final-state.json", "screenshot", "trace", "download", "validation-report.json"],
    supportsFiles: true, supportsStreaming: true, supportsCancellation: true, supportsResume: true,
    networkPolicy: { mode: "allowlist", hosts: [] }, defaultLimits: { ...kernelLimits, timeoutMs: 1_800_000 }, approvalPolicy: { write: true, external: true, publishing: true }, featureFlag: "BROWSER_AGENT_ENABLED",
  },
  {
    id: "voice.studio", version: "1.0.0", titleAr: "استوديو الصوت", descriptionAr: "توليد صوت عبر مزودات المنصة مع معالجة الوسائط والتحقق من الملف النهائي.", category: "media",
    requiredPermission: "voice_studio:run", requiredModule: "operational_tools", executionKind: "provider",
    supportedInputs: ["text"], supportedOutputs: ["mp3", "wav", "opus", "metadata.json"], supportsFiles: false, supportsStreaming: true, supportsCancellation: true, supportsResume: false,
    networkPolicy: { mode: "deny_all" }, defaultLimits: { ...kernelLimits, timeoutMs: 600_000 }, approvalPolicy: { write: false, external: false, publishing: false }, featureFlag: "VOICE_STUDIO_ENABLED",
  },
] as const;
