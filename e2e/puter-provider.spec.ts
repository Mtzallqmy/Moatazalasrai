import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const enabled = process.env.E2E_BASE_URL
  && process.env.E2E_DATABASE_URL
  && process.env.NEXT_PUBLIC_PUTER_ENABLED === "true"
  && process.env.NEXT_PUBLIC_PUTER_E2E_MOCK === "true";

test.describe("Puter browser provider", () => {
  test.skip(!enabled, "Puter E2E requires an isolated deployment with the explicit browser mock enabled.");

  test("connects, discovers models, streams, persists, and survives reload", async ({ page }) => {
    const email = `puter-e2e-${Date.now()}@example.test`;
    await page.goto("/register");
    await page.getByLabel("الاسم الكامل").fill("مستخدم Puter E2E");
    await page.getByLabel("اسم المؤسسة").fill(`مختبر Puter ${Date.now()}`);
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("كلمة المرور").fill("A-strong-test-password-123!");
    await page.getByRole("button", { name: "إنشاء الحساب والمؤسسة" }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [account] = await sql<{ user_id: string; organization_id: string }[]>`
        SELECT u.id AS user_id, om.organization_id
        FROM users u
        JOIN organization_members om ON om.user_id = u.id
        WHERE u.email = ${email}
        LIMIT 1
      `;
      if (!account) throw new Error("Puter E2E account was not persisted.");
      const credentialId = randomUUID();
      const agentId = randomUUID();
      await sql`
        INSERT INTO provider_credentials (
          id, organization_id, provider, name, base_url, encrypted_secret,
          secret_hint, discovered_models, validation_status, enabled
        ) VALUES (
          ${credentialId}, ${account.organization_id}, 'openai', 'Unchanged E2E Server Provider',
          'https://api.openai.com/v1', 'e2e-unused-secret', 'e2e',
          ${sql.json(["existing-model"])}, 'verified', true
        )
      `;
      await sql`
        INSERT INTO agents (
          id, organization_id, name, status, current_version,
          default_provider_credential_id, default_model
        ) VALUES (
          ${agentId}, ${account.organization_id}, 'وكيل Puter E2E', 'published', 1,
          ${credentialId}, 'existing-model'
        )
      `;
      await sql`
        INSERT INTO agent_versions (
          id, agent_id, version, provider_credential_id, model, instructions
        ) VALUES (${randomUUID()}, ${agentId}, 1, ${credentialId}, 'existing-model', 'أجب بالعربية باختصار.')
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    await page.goto("/dashboard/providers");
    const card = page.getByLabel("مزوّد Puter");
    await expect(card).toBeVisible();
    await expect(card.getByLabel("مفتاح API")).toHaveCount(0);
    await page.evaluate(() => localStorage.setItem("moataz:puter:e2e-auth-fail", "true"));
    await card.getByRole("button", { name: "الاتصال بحساب Puter" }).click();
    await expect(card.getByRole("alert")).toContainText("تعذر الاتصال");
    await page.evaluate(() => localStorage.removeItem("moataz:puter:e2e-auth-fail"));
    await card.getByRole("button", { name: "الاتصال بحساب Puter" }).click();
    await expect(card.getByText("Puter E2E Model")).toBeVisible();
    await page.screenshot({ path: "artifacts/puter-ui/providers-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/puter-ui/providers-mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.goto("/dashboard/chat");
    await page.getByRole("button", { name: "محادثة جديدة" }).click();
    await page.getByLabel("مصدر تنفيذ الدردشة").selectOption("puter");
    await page.getByLabel("نموذج Puter").selectOption("puter-e2e-model");
    await page.getByPlaceholder("اكتب طلبك… Enter للإرسال وShift+Enter لسطر جديد").fill("ابدأ اختبار Puter");
    await page.getByRole("button", { name: "إرسال" }).click();
    await page.getByRole("button", { name: "أفهم وأتابع" }).click();
    await expect(page.getByText("نجح بث Puter التجريبي")).toBeVisible();
    await page.screenshot({ path: "artifacts/puter-ui/chat-desktop.png", fullPage: true });
    await page.reload();
    await expect(page.getByText("نجح بث Puter التجريبي")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/puter-ui/chat-mobile.png", fullPage: true });
  });
});
