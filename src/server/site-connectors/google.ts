import { ApiError } from "@/lib/http/api";
import type { SiteConnector } from "@/server/site-connectors/types";

export const googleSiteConnector: SiteConnector = {
  id: "google",
  displayName: "Google",
  type: "oauth",
  async validateConnection() {
    throw new ApiError(422, "GOOGLE_OAUTH_REQUIRED", "استخدم تدفق Google OAuth لإنشاء هذا الاتصال.");
  },
  getAvailableActions() {
    return [];
  },
  async executeAction() {
    throw new ApiError(422, "CONNECTOR_ACTION_UNKNOWN", "لا توجد عمليات Google مفعلة دون طلب نطاق خدمة إضافي.");
  },
};
