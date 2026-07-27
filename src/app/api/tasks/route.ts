import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { isNonEmptyTitle } from "@/lib/utils";

export async function GET() {
  try {
    const rows = await db().select().from(tasks).orderBy(desc(tasks.createdAt));
    return NextResponse.json({ tasks: rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !isNonEmptyTitle(body.title)) {
      return NextResponse.json(
        { error: "Field 'title' is required and must be a non-empty string." },
        { status: 400 }
      );
    }

    const [created] = await db()
      .insert(tasks)
      .values({ title: body.title.trim() })
      .returning();

    return NextResponse.json({ task: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
