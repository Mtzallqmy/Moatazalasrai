import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createTestSqlClient } from "../tests/helpers/pg-sql";

const enabled = process.env.E2E_BASE_URL
  && process.env.E2E_DATABASE_URL
  && process.env.NEXT_PUBLIC_PUTER_ENABLED === "true"
  && process.env.NEXT_PUBLIC_PUTER_E2E_MOCK === "true";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

const responsiveViewports = [
  { name: "320x568", width: 320, height: 568, capture: false },
  { name: "360x800", width: 360, height: 800, capture: false },
  { name: "375x812", width: 375, height: 812, capture: true },
  { name: "390x844", width: 390, height: 844, capture: true },
  { name: "412x915", width: 412, height: 915, capture: false },
  { name: "430x932", width: 430, height: 932, capture: true },
  { name: "768x1024", width: 768, height: 1024, capture: true },
  { name: "1024x768", width: 1024, height: 768, capture: false },
  { name: "1440x900", width: 1440, height: 900, capture: true },
] as const;

test.describe("Puter browser provider", () => {
  test.skip(!enabled, "Puter E2E requires an isolated deployment with the explicit browser mock enabled.");

  test("connects, discovers models, streams, persists, and survives reload", async ({ page }) => {
    const email = `puter-e2e-${Date.now()}@example.test`;
    const sql = createTestSqlClient(process.env.E2E_DATABASE_URL!, 1);
    try {
      const organizationId = randomUUID();
      await sql`UPDATE organizations SET public_registration_enabled = false WHERE public_registration_enabled = true`;
      await sql`
        INSERT INTO organizations (id, name, slug, public_registration_enabled)
        VALUES (${organizationId}, 'مختبر Puter E2E', ${`puter-e2e-${organizationId}`}, true)
      `;

      const registration = await page.context().request.post(`${baseUrl}/api/auth/register`, {
        headers: { origin: baseUrl },
        data: {
          name: "مستخدم Puter E2E",
          email,
          password: "A-strong-test-password-123!",
        },
      });
      expect(registration.status()).toBe(201);
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/);

      const [account] = await sql<{ user_id: string; organization_id: string }[]>`
        SELECT u.id AS user_id, om.organization_id
        FROM users u
        JOIN organization_members om ON om.user_id = u.id
        WHERE u.email = ${email}
        LIMIT 1
      `;
      if (!account) throw new Error("Puter E2E account was not persisted.");
      await sql`
        UPDATE organization_members
        SET role = 'developer'
        WHERE organization_id = ${account.organization_id} AND user_id = ${account.user_id}
      `;

      const credentialId = randomUUID();
      const agentId = randomUUID();
      await sql`
        INSERT INTO provider_credentials (
          id, organization_id, provider, provider_type_id, transport_mode, credential_mode,
          name, base_url, encrypted_secret, secret_hint, discovered_models,
          validation_status, health_status, enabled
        ) VALUES (
          ${credentialId}, ${account.organization_id}, 'openai', 'openai', 'direct', 'encrypted_byok',
          'Unchanged E2E Server Provider', 'https://api.openai.com/v1',
          'e2e-unused-secret', 'e2e', ${sql.json(["existing-model"])},
          'verified', 'healthy', true
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
    await expect(card).toHaveAttribute("data-puter-ready", "true");
    await expect(card.getByLabel("مفتاح API")).toHaveCount(0);
    const connectButton = card.getByRole("button", { name: "الاتصال بحساب Puter" });
    await expect(connectButton).toBeEnabled();
    await page.evaluate(() => localStorage.setItem("moataz:puter:e2e-auth-fail", "true"));
    await connectButton.click();
    await expect(card).toHaveAttribute("data-puter-state", "error");
    await expect(card.getByRole("alert")).toContainText("تعذر الاتصال");
    await page.evaluate(() => localStorage.removeItem("moataz:puter:e2e-auth-fail"));
    await card.getByRole("button", { name: "الاتصال بحساب Puter" }).click();
    await expect(card.getByText("Puter E2E Model")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: "artifacts/puter-ui/providers-1440x900.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/puter-ui/providers-390x844.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/dashboard/chat?new=true");
    await expect(page).toHaveURL(/\/dashboard\/chat\?new=true/);
    await expect(page.getByRole("heading", { name: "ابدأ مع وكيلك الذكي" })).toBeVisible();
    await page.getByRole("button", { name: "أدوات" }).click();
    await page.getByLabel("مصدر التنفيذ").selectOption("puter");
    await expect(page.getByLabel("نموذج Puter").locator('option[value="puter-e2e-model"]')).toHaveCount(1);
    await page.getByLabel("نموذج Puter").selectOption("puter-e2e-model");
    const composer = page.getByLabel("رسالة المحادثة");
    await expect(composer).toBeEnabled();
    await composer.fill("ابدأ اختبار Puter");
    const sendButton = page.getByRole("button", { name: "إرسال الرسالة" });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();
    const conversationCreated = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/dashboard/chat"
      && response.status() === 201);
    await page.getByRole("button", { name: "أفهم وأتابع" }).click();
    await conversationCreated;
    await expect(page).toHaveURL(/\/dashboard\/chat\?.*conversationId=/);
    await expect(page.getByText("نجح بث Puter التجريبي")).toBeVisible();
    await page.reload();
    await expect(page.getByText("نجح بث Puter التجريبي")).toBeVisible();

    for (const viewport of responsiveViewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const hasNoHorizontalOverflow = await page.evaluate(() => {
        const root = document.documentElement;
        return Math.max(root.scrollWidth, document.body.scrollWidth) <= root.clientWidth + 1;
      });
      expect(hasNoHorizontalOverflow, `horizontal overflow at ${viewport.name}`).toBe(true);
      if (viewport.capture) await page.screenshot({ path: `artifacts/puter-ui/chat-${viewport.name}.png`, fullPage: true });
    }
  });
});
