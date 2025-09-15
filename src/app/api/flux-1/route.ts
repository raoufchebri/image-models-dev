import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { usersTable } from "@/db/schema";
import { auth } from '@clerk/nextjs/server';
import { uploadFile } from "@/storage";
import mime from 'mime';
import { and, eq } from 'drizzle-orm';

const BFL_ENDPOINT = 'https://api.bfl.ai/v1/flux-kontext-pro';

export async function POST(request: NextRequest) {
  type RequestBody = { prompt?: string; image?: string; enhance?: boolean };
  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const apiKey = process.env.BFL_API_KEY || process.env.BFL_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing BFL_API_KEY' }, { status: 500 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Rate limit: max 10 completed image generations per user
  try {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.userId, userId), eq(usersTable.status, 'completed')))
      .limit(11);
    if (existing.length >= 10) {
      return NextResponse.json({ error: 'You have reached the limit of 10 image generations.' }, { status: 429 });
    }
  } catch {}
  let prompt: string = String(body?.prompt || 'A small furry elephant pet looks out from a cat house');
  const enhance = Boolean(body?.enhance);
  if (enhance && prompt.trim().length > 0) {
    try {
      prompt = await enhancePromptExternally(prompt);
    } catch {}
  }
  // const aspect_ratio: string = String(body?.aspect_ratio || '1:1');
  const input_image: string | undefined = body.image;
  
  type FluxRequestBody = { prompt: string; input_image?: string };
  const fluxBody: FluxRequestBody = { prompt };
  if (input_image) {
    fluxBody.input_image = input_image;
  }

  const submitRes = await fetch(BFL_ENDPOINT, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'x-key': apiKey,
    },
    body: JSON.stringify(fluxBody),
  });
  if (!submitRes.ok) {
    const text = await submitRes.text().catch(() => '');
    return NextResponse.json({ error: 'BFL submit failed', status: submitRes.status, body: text || undefined }, { status: 502 });
  }
  const submitJson = (await submitRes.json()) as { polling_url?: string };
  const pollingUrl: string | undefined = submitJson?.polling_url;

  if (!pollingUrl) {
    return NextResponse.json({ error: 'No polling URL returned' }, { status: 502 });
  }

  for (let i = 0; i < 120; i++) { // Max 60 seconds
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between polls
    
    const pollRes = await fetch(pollingUrl, {
      headers: {
        'accept': 'application/json',
        'x-key': apiKey,
      }
    });

    if (!pollRes.ok) {
      const text = await pollRes.text().catch(() => '');
      return NextResponse.json({ error: 'BFL polling failed', status: pollRes.status, body: text || undefined }, { status: 502 });
    }

    const pollJson = (await pollRes.json()) as { status?: string; result?: { sample?: string; url?: string; image?: string } };
    
    const okStatuses = new Set(['Ready', 'Completed', 'Complete', 'Success', 'Succeeded']);
    if (pollJson.status && okStatuses.has(pollJson.status)) {
      const originalImageUrl = pollJson.result?.sample || pollJson.result?.url || pollJson.result?.image;

      // Try to upload the generated image to object storage
      let savedImageUrl: string | undefined = originalImageUrl;
      try {
        if (typeof originalImageUrl === 'string' && originalImageUrl.length > 0) {
          let mimeType = 'image/png';
          let imageBuffer: Buffer | undefined;

          if (/^data:/i.test(originalImageUrl)) {
            // data URL case
            const parts = originalImageUrl.split(',');
            const header = parts[0] || '';
            const b64 = parts[1] || '';
            const headerMime = header.split(';')[0]?.replace('data:', '') || '';
            if (headerMime) mimeType = headerMime;
            if (b64) imageBuffer = Buffer.from(b64, 'base64');
          } else {
            // remote URL case
            const res = await fetch(originalImageUrl);
            if (res.ok) {
              const contentType = res.headers.get('content-type');
              if (contentType) {
                mimeType = contentType;
              } else {
                try {
                  mimeType = mime.getType(new URL(originalImageUrl).pathname) || 'image/png';
                } catch {
                  mimeType = 'image/png';
                }
              }
              const arrayBuf = await res.arrayBuffer();
              imageBuffer = Buffer.from(arrayBuf);
            }
          }

          if (imageBuffer) {
            const randomImageName = Math.random().toString(36).substring(2, 15);
            const ext = mime.getExtension(mimeType) || 'png';
            const fileName = `${randomImageName}.0.${ext}`;
            try {
              const url = await uploadFile(fileName, imageBuffer, mimeType);
              if (url) savedImageUrl = url;
            } catch {
              // ignore and fall back to original URL
            }
          }
        }
      } catch {
        // ignore upload errors; we'll fall back to originalImageUrl
      }

      const generation: typeof usersTable.$inferInsert = {
        userId: userId ?? null,
        prompt: prompt,
        inputImageUrl: input_image || '',
        outputImageUrl: savedImageUrl || originalImageUrl || '',
        model: 'flux-1',
        status: 'completed',
        error: '',
        metadata: {},
      }

      await db.insert(usersTable).values(generation);

      return NextResponse.json({
        success: true,
        url: savedImageUrl || originalImageUrl,
      });
    } else if (pollJson.status === 'Error' || pollJson.status === 'Failed') {
      return NextResponse.json({ error: 'Generation failed', details: pollJson }, { status: 500 });
    }
    // Otherwise continue polling
  }

  // If we get here, we timed out
  return NextResponse.json({ error: 'Generation timed out' }, { status: 504 });
}

async function enhancePromptExternally(prompt: string): Promise<string> {
  // Reuse internal text-to-prompt endpoint for enhancement to avoid provider mismatch
  try {
    const res = await fetch(process.env.NEXT_PUBLIC_BASE_URL ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/text-to-prompt` : 'http://localhost:3000/api/text-to-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt }),
    });
    if (!res.ok) return prompt;
    const json = (await res.json()) as { prompt?: string };
    if (typeof json.prompt === 'string' && json.prompt.trim().length > 0) return json.prompt.trim();
    return prompt;
  } catch {
    return prompt;
  }
}

