import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { usersTable } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rows = await db
      .select({ url: usersTable.outputImageUrl })
      .from(usersTable)
      .where(and(eq(usersTable.userId, userId), eq(usersTable.status, "completed")))
      .orderBy(desc(usersTable.createdAt));

    const urls = rows.map((r) => r.url).filter((u): u is string => typeof u === "string" && u.length > 0);
    const count = urls.length;
    const limitReached = count >= 10;
    return NextResponse.json({ urls, count, limitReached });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


