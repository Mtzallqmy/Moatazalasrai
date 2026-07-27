import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Next.js 15+ makes route params an async value (Promise) rather than a
// plain object, so it can be resolved lazily. Always `await params`.
type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const patch: Partial<{ title: string; done: boolean }> = {};
    if (typeof body.title === "string" && body.title.trim().length > 0) {
      patch.title = body.title.trim();
    }
    if (typeof body.done === "boolean") {
      patch.done = body.done;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "Provide at least one of: title, done." },
        { status: 400 }
      );
    }

    const [updated] = await db()
      .update(tasks)
      .set(patch)
      .where(eq(tasks.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    return NextResponse.json({ task: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  try {
    const [deleted] = await db().delete(tasks).where(eq(tasks.id, id)).returning();
    if (!deleted) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    return NextResponse.json({ task: deleted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
