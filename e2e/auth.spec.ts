import { expect, test } from "@playwright/test";

test.describe("registration and session flow", () => {
  test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL to a deployment backed by an isolated test database.");

  test("registers, reaches the dashboard, and logs out", async ({ page }) => {
    const email = `e2e-${Date.now()}@example.test`;
    await page.goto("/register");
    await page.getByLabel("الاسم الكامل").fill("مستخدم الاختبار");
    await page.getByLabel("اسم المؤسسة").fill(`مؤسسة الاختبار ${Date.now()}`);
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("كلمة المرور").fill("A-strong-test-password-123!");
    await page.getByRole("button", { name: "إنشاء الحساب والمؤسسة" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /مرحبًا/ })).toBeVisible();
    await page.getByRole("button", { name: "تسجيل الخروج" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
