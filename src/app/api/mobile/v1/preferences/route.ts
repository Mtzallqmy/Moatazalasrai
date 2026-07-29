import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { authenticateApiKey } from "@/lib/auth/api-key";
import { defaultChatAppearance, normalizeChatAppearance } from "@/lib/chat/appearance";
import { apiFailure, apiSuccess, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { chatAppearanceSchema } from "@/lib/http/contracts";

async function mobilePrincipal(request: Request) {
  const principal = await authenticateApiKey(request);
  return principal?.kind === "mobile_session" && principal.userId ? principal : null;
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await mobilePrincipal(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "جلسة التطبيق غير صالحة.", requestId);
    const [stored] = await db()
      .select({ theme: userPreferences.chatTheme, wallpaper: userPreferences.chatWallpaper })
      .from(userPreferences)
      .where(eq(userPreferences.userId, principal.userId!))
      .limit(1);
    return apiSuccess({ chat: normalizeChatAppearance(stored ?? defaultChatAppearance) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/preferences");
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    const principal = await mobilePrincipal(request);
    if (!principal) return apiFailure(401, "UNAUTHORIZED", "جلسة التطبيق غير صالحة.", requestId);
    const body = await parseJson(request, chatAppearanceSchema, 4 * 1024);
    const [saved] = await db()
      .insert(userPreferences)
      .values({
        userId: principal.userId!,
        chatTheme: body.theme,
        chatWallpaper: body.wallpaper,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          chatTheme: body.theme,
          chatWallpaper: body.wallpaper,
          updatedAt: new Date(),
        },
      })
      .returning({ theme: userPreferences.chatTheme, wallpaper: userPreferences.chatWallpaper });
    return apiSuccess({ chat: normalizeChatAppearance(saved) }, requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/mobile/v1/preferences");
  }
}
