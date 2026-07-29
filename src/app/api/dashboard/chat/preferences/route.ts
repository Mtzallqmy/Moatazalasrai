import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth/authorization";
import { defaultChatAppearance, normalizeChatAppearance } from "@/lib/chat/appearance";
import { apiSuccess, assertSameOrigin, getRequestId, handleApiError, parseJson } from "@/lib/http/api";
import { chatAppearanceSchema } from "@/lib/http/contracts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const session = await requireSession();
    const [stored] = await db()
      .select({ theme: userPreferences.chatTheme, wallpaper: userPreferences.chatWallpaper })
      .from(userPreferences)
      .where(eq(userPreferences.userId, session.userId))
      .limit(1);
    return apiSuccess(normalizeChatAppearance(stored ?? defaultChatAppearance), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/preferences");
  }
}

export async function PUT(request: Request) {
  const requestId = getRequestId(request);
  try {
    assertSameOrigin(request);
    const session = await requireSession();
    const body = await parseJson(request, chatAppearanceSchema, 4 * 1024);
    const [saved] = await db()
      .insert(userPreferences)
      .values({
        userId: session.userId,
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
    return apiSuccess(normalizeChatAppearance(saved), requestId);
  } catch (error) {
    return handleApiError(error, requestId, "/api/dashboard/chat/preferences");
  }
}
