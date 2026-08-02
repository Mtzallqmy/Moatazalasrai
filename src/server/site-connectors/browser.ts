import { ApiError } from "@/lib/http/api";
import type { SiteConnector } from "@/server/site-connectors/types";

export const browserSiteConnector: SiteConnector = {
  id: "browser-generic",
  displayName: "جلسة متصفح آمنة",
  type: "browser",
  async validateConnection() {
    throw new ApiError(422, "BROWSER_LOGIN_REQUIRED", "استخدم جلسة تسجيل الدخول التفاعلية لإنشاء اتصال المتصفح.");
  },
  getAvailableActions() {
    return [];
  },
  async executeAction() {
    throw new ApiError(422, "BROWSER_WORKER_REQUIRED", "تُنفذ عمليات المتصفح عبر مخطط المهام والـWorker المعزول.");
  },
};
