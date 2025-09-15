import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { usersTable } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { put } from "@tigrisdata/storage";

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    type Body = { bucketName?: string; accessKeyId?: string; secretAccessKey?: string };
    const body = (await request.json().catch(() => ({}))) as Body;
    const bucketName = (body.bucketName || "").trim();
    const accessKeyId = (body.accessKeyId || "").trim();
    const secretAccessKey = (body.secretAccessKey || "").trim();

    console.log("bucketName", bucketName);
    console.log("accessKeyId", accessKeyId);
    console.log("secretAccessKey", secretAccessKey);

    if (!bucketName || !accessKeyId || !secretAccessKey) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const rows = await db
      .select({ url: usersTable.outputImageUrl })
      .from(usersTable)
      .where(and(eq(usersTable.userId, userId), eq(usersTable.status, "completed")));

    const urls = rows.map((r) => r.url).filter((u): u is string => typeof u === "string" && u.length > 0);

    if (urls.length === 0) {
      return NextResponse.json({ migrated: 0, message: "No images to migrate" });
    }

    let migrated = 0;
    for (const imageUrl of urls) {
      try {
        const res = await fetch(imageUrl);
        if (!res.ok) continue;
        const contentType = res.headers.get("content-type") || "image/png";
        const arrayBuf = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        // Derive a filename from the URL path
        let key = "";
        try {
          const { pathname } = new URL(imageUrl);
          key = pathname.split("/").filter(Boolean).slice(-1)[0] || `image-${Date.now()}.png`;
        } catch {
          key = `image-${Date.now()}.png`;
        }
        // Upload into user's bucket under images/ using Tigris Storage
        const result = await put(`images/${key}`, buffer, {
          contentType,
          access: "public",
          allowOverwrite: true,
          config: {
            bucket: bucketName,
            accessKeyId,
            secretAccessKey,
          },
        });
        console.log("result", result);
        if (!result.error) {
          migrated += 1;
        }
      } catch {
        // skip failures
      }
    }

    return NextResponse.json({ migrated, success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


