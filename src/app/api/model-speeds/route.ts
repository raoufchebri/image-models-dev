import { NextResponse } from "next/server";
import { db } from "@/db";
import { usersTable } from "@/db/schema";
import { avg, eq } from "drizzle-orm";

type AvgDurationRow = {
  model: string;
  avgDurationMs: string | number | null;
};

export async function GET() {
  try {
    const averages = await db
      .select({
        model: usersTable.model,
        avgDurationMs: avg(usersTable.generationDurationMs),
      })
      .from(usersTable)
      .where(eq(usersTable.status, "completed"))
      .groupBy(usersTable.model);

    const response = {
      fluxMs: null as number | null,
      geminiMs: null as number | null,
    };

    for (const row of averages as AvgDurationRow[]) {
      const avgMs = row.avgDurationMs === null ? null : Number(row.avgDurationMs);
      if (!Number.isFinite(avgMs ?? NaN)) continue;

      if (row.model === "flux-1") {
        response.fluxMs = avgMs;
      } else if (row.model === "gemini-image-flash") {
        response.geminiMs = avgMs;
      }
    }

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch model speeds", error);
    return NextResponse.json({ error: "Failed to fetch model speeds" }, { status: 500 });
  }
}

