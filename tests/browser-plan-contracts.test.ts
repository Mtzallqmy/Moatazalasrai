import { describe, expect, it } from "vitest";
import { browserPlanSchema } from "@/lib/browser/contracts";

const connectionId = "11111111-1111-4111-8111-111111111111";

describe("browser plan contracts", () => {
  it("accepts stable role and accessible-name targets", () => {
    const plan = browserPlanSchema.parse({
      connectionId,
      objective: "اقرأ حالة الطلب",
      steps: [{
        id: "read-status",
        action: "read",
        target: { role: "status", name: "حالة الطلب" },
        requiredPermission: "read",
        risk: "low",
        expectedResult: "يظهر نص حالة الطلب",
      }],
    });
    expect(plan.steps).toHaveLength(1);
  });

  it("rejects raw CSS without an explicit justification", () => {
    expect(() => browserPlanSchema.parse({
      connectionId,
      objective: "اضغط الزر",
      steps: [{
        id: "click",
        action: "click",
        target: { css: "#submit" },
        requiredPermission: "navigate",
        risk: "low",
        expectedResult: "يتغير العرض",
      }],
    })).toThrow(/توضيح سبب/);
  });

  it("rejects mismatched permission and action", () => {
    expect(() => browserPlanSchema.parse({
      connectionId,
      objective: "املأ النموذج",
      steps: [{
        id: "fill",
        action: "fill",
        target: { label: "الاسم" },
        value: "معتز",
        requiredPermission: "delete",
        risk: "high",
        expectedResult: "يمتلئ الحقل",
      }],
    })).toThrow(/لا تطابق/);
  });

  it("requires critical risk for payment and security settings", () => {
    expect(() => browserPlanSchema.parse({
      connectionId,
      objective: "نفذ دفعة",
      steps: [{
        id: "pay",
        action: "submit",
        target: { role: "button", name: "ادفع" },
        requiredPermission: "payment",
        risk: "high",
        expectedResult: "تظهر نتيجة الدفع",
      }],
    })).toThrow(/critical/);
  });

  it("limits plans to fifty steps and unique step ids", () => {
    const step = {
      id: "same",
      action: "navigate" as const,
      url: "https://example.com",
      requiredPermission: "navigate" as const,
      risk: "low" as const,
      expectedResult: "تفتح الصفحة",
    };
    expect(() => browserPlanSchema.parse({ connectionId, objective: "تنقل", steps: [step, step] })).toThrow(/مكرر/);
    expect(() => browserPlanSchema.parse({ connectionId, objective: "تنقل", steps: Array.from({ length: 51 }, (_, id) => ({ ...step, id: String(id) })) })).toThrow();
  });
});
