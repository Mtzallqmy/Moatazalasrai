import { expect, test } from "@playwright/test";

const required = [
  process.env.E2E_BASE_URL,
  process.env.E2E_PROVIDER_KIND,
  process.env.E2E_PROVIDER_KEY,
  process.env.E2E_PROVIDER_BASE_URL,
  process.env.E2E_PROVIDER_MODEL,
];

test.describe("live provider acceptance path", () => {
  test.skip(required.some((value) => !value), "Live provider E2E requires dedicated E2E_PROVIDER_* secrets.");

  test("adds a real provider, publishes an agent, and streams a persisted reply", async ({ page }) => {
    const email = `provider-e2e-${Date.now()}@example.test`;
    await page.goto("/register");
    await page.getByLabel("الاسم الكامل").fill("مستخدم مزود حي");
    await page.getByLabel("اسم المؤسسة").fill(`مختبر مزود ${Date.now()}`);
    await page.getByLabel("البريد الإلكتروني").fill(email);
    await page.getByLabel("كلمة المرور").fill("A-strong-test-password-123!");
    await page.getByRole("button", { name: "إنشاء الحساب والمؤسسة" }).click();

    await page.goto("/dashboard/providers");
    await page.getByLabel("نوع المزود").selectOption(process.env.E2E_PROVIDER_KIND!);
    await page.getByLabel("اسم الاتصال").fill("اتصال E2E حي");
    await page.getByLabel("Base URL").fill(process.env.E2E_PROVIDER_BASE_URL!);
    await page.getByLabel("مفتاح API").fill(process.env.E2E_PROVIDER_KEY!);
    await page.getByRole("button", { name: "فحص الاتصال وجلب النماذج" }).click();
    await expect(page.getByText(/نجح الاتصال/)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("نموذج اختبار التوليد قبل الحفظ").selectOption(process.env.E2E_PROVIDER_MODEL!);
    await page.getByRole("button", { name: "تحقق واحفظ الاتصال" }).click();
    await expect(page.getByText(/تم التحقق والحفظ المشفر/)).toBeVisible({ timeout: 30_000 });

    await page.goto("/dashboard/agents");
    await page.getByLabel("الاسم").first().fill("وكيل E2E");
    await page.getByLabel("النموذج").first().selectOption(process.env.E2E_PROVIDER_MODEL!);
    await page.getByLabel("تعليمات النظام").first().fill("أجب باختصار وبالعربية.");
    await page.getByText("نشر الوكيل مباشرة").click();
    await page.getByRole("button", { name: "إنشاء الوكيل" }).click();
    await expect(page.getByText("وكيل E2E")).toBeVisible();

    await page.goto("/dashboard/chat");
    await page.getByRole("button", { name: "محادثة جديدة" }).click();
    await page.getByPlaceholder("اكتب طلبك الحقيقي للوكيل...").fill("اكتب كلمة: نجح");
    await page.getByRole("button", { name: "إرسال" }).click();
    await expect(page.getByText(/نجح/).last()).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText(/نجح/).last()).toBeVisible({ timeout: 30_000 });
  });
});
