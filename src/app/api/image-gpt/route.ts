import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { put } from '@tigrisdata/storage';
import mime from 'mime';
import { db } from "@/db";
import { usersTable } from "@/db/schema";
import { auth } from '@clerk/nextjs/server';


export async function POST(request: NextRequest) {
  type RequestBody = { prompt?: string; image?: string };
  const body = (await request.json()) as RequestBody;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY. Set it in your environment or a .env file.');
    return NextResponse.json({ error: 'Server misconfiguration: missing OPENAI_API_KEY' }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey });

  const { userId } = await auth();

  // Build the input content for Responses API
  type InputContent =
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string; detail: 'auto' | 'low' | 'high' };
  const content: Array<InputContent> = [
    { type: "input_text", text: String(body.prompt || '') },
  ];
  if (typeof body.image === 'string') {
    let dataUrl = body.image as string;
    if (/^https?:\/\//i.test(dataUrl)) {
      const res = await fetch(dataUrl);
      if (!res.ok) {
        return NextResponse.json({ error: `Failed to fetch image URL: ${res.status}` }, { status: 400 });
      }
      const contentType = res.headers.get('content-type') || mime.getType(new URL(dataUrl).pathname) || 'image/png';
      const arrayBuf = await res.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString('base64');
      dataUrl = `data:${contentType};base64,${b64}`;
    } else if (!dataUrl.startsWith('data:')) {
      // Treat as raw base64; wrap in a data URL
      dataUrl = `data:image/png;base64,${dataUrl}`;
    }
    content.push({ type: 'input_image', image_url: dataUrl, detail: 'auto' });
  }

  try {
    const response = await openai.responses.create({
      model: 'gpt-5',
      input: [
        {
          role: 'user',
          content,
        },
      ],
      tools: [{ type: 'image_generation', size: '1024x1024' }],
    });

    // Extract generated image(s)
    type OutputItem = { type?: string; result?: unknown; text?: string };
    type ResponseShape = { output?: unknown; usage?: unknown; meta?: { usage?: unknown } };
    const resp = response as unknown as ResponseShape;
    const outputsRaw = resp.output;
    const outputs: OutputItem[] = Array.isArray(outputsRaw) ? (outputsRaw as OutputItem[]) : [];
    const imageOutputs = outputs.filter((o: OutputItem) => o?.type === 'image_generation_call');
    const imageBase64List: string[] = imageOutputs.map((o: OutputItem) => {
      // Some SDK versions return o.result directly as base64
      if (typeof o?.result === 'string') return o.result as string;
      // Fallbacks for potential shapes
      const r = o?.result as { b64_json?: unknown } | undefined;
      if (r && typeof r.b64_json === 'string') return r.b64_json;
      return '';
    }).filter((s: string) => s.length > 0);

    // Extract output text (if any)
    type TextOutputItem = { type?: string; text?: string };
    const textOutputs = outputs.filter((o: TextOutputItem) => o?.type === 'output_text') as TextOutputItem[];
    const fullText = textOutputs.map((t) => t?.text || '').join('');

    // Extract token usage if available
    const rawUsage = (resp.usage ?? resp.meta?.usage ?? {}) as {
      input_tokens?: number;
      prompt_tokens?: number;
      output_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    const inputTokens: number | undefined = rawUsage.input_tokens ?? rawUsage.prompt_tokens;
    const outputTokens: number | undefined = rawUsage.output_tokens ?? rawUsage.completion_tokens;
    const totalTokens: number | undefined = rawUsage.total_tokens ?? (
      typeof inputTokens === 'number' && typeof outputTokens === 'number'
        ? inputTokens + outputTokens
        : undefined
    );

    let savedImageUrl: string | undefined;
    if (imageBase64List.length > 0) {
      const randomImageName = Math.random().toString(36).substring(2, 15);
      const mimeType = 'image/png';
      const ext = mime.getExtension(mimeType) || 'png';
      const fileName = `${randomImageName}.0.${ext}`;
      const buffer = Buffer.from(imageBase64List[0], 'base64');

      try {
        const url = await saveBinaryFile(fileName, buffer, mimeType);
        savedImageUrl = url || `data:${mimeType};base64,${imageBase64List[0]}`;
      } catch {
        savedImageUrl = `data:${mimeType};base64,${imageBase64List[0]}`;
      }
    }

    if (savedImageUrl) {
      const generation: typeof usersTable.$inferInsert = {
        userId: userId ?? null,
        prompt: String(body.prompt || ''),
        inputImageUrl: savedImageUrl || '',
        outputImageUrl: savedImageUrl || '',
        model: 'image-gpt',
        status: 'completed',
        error: '',
        metadata: {},
      }
      await db.insert(usersTable).values(generation);
      return NextResponse.json({
        success: true,
        image: savedImageUrl,
        text: fullText || undefined,
        tokens: totalTokens,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
        },
      });
    }
    if (typeof fullText === 'string' && fullText.trim().length > 0) {
      return NextResponse.json({
        success: true,
        text: fullText,
        tokens: totalTokens,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens,
        },
      });
    }
    return NextResponse.json({ error: 'No image or text was generated' }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function saveBinaryFile(fileName: string, content: Buffer, contentType: string) {
  const imageResult = await put(`images/${fileName}`, content, {
    contentType,
    access: 'public',
    allowOverwrite: true,
  });
  return imageResult.data?.url;
}
