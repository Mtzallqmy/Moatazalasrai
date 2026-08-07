import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agents, conversationMembers, conversations } from "@/db/schema";
import { ApiError } from "@/lib/http/api";

export type ConversationActor = {
  userId: string;
  organizationId: string;
};

export async function createConversationForAgent(actor: ConversationActor, agentId: string) {
  const [agent] = await db().select({ id: agents.id, name: agents.name, status: agents.status })
    .from(agents)
    .where(and(
      eq(agents.id, agentId),
      eq(agents.organizationId, actor.organizationId),
      eq(agents.status, "published"),
    ))
    .limit(1);
  if (!agent) throw new ApiError(422, "AGENT_UNAVAILABLE", "الوكيل غير منشور أو غير موجود.");

  const conversation = await db().transaction(async (tx) => {
    const [created] = await tx.insert(conversations).values({
      organizationId: actor.organizationId,
      agentId: agent.id,
      createdByUserId: actor.userId,
      title: null,
      status: "active",
    }).returning();
    if (!created) throw new Error("CONVERSATION_CREATE_FAILED");
    await tx.insert(conversationMembers).values({
      organizationId: actor.organizationId,
      conversationId: created.id,
      userId: actor.userId,
      role: "manager",
      addedByUserId: actor.userId,
    });
    return created;
  });

  return { conversation, agent };
}
