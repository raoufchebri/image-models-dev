import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { put } from '@tigrisdata/storage';
import mime from 'mime';

export async function POST(request: NextRequest) {
  const body = await request.json();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY. Set it in your environment or a .env file.');
    return NextResponse.json({ error: 'Server misconfiguration: missing OPENAI_API_KEY' }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey });

  // Build the input content for Responses API
  const content: Array<any> = [
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
    content.push({ type: 'input_image', image_url: dataUrl });
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
    const imageOutputs = (response as any).output?.filter((o: any) => o?.type === 'image_generation_call') || [];
    const imageBase64List: string[] = imageOutputs.map((o: any) => {
      // Some SDK versions return o.result directly as base64
      if (typeof o?.result === 'string') return o.result;
      // Fallbacks for potential shapes
      if (typeof o?.result?.b64_json === 'string') return o.result.b64_json;
      return '';
    }).filter((s: string) => s.length > 0);

    // Extract output text (if any)
    const textOutputs = (response as any).output?.filter((o: any) => o?.type === 'output_text') || [];
    const fullText = textOutputs.map((t: any) => t?.text || '').join('');

    // Extract token usage if available
    const usageObj: any = (response as any).usage || (response as any).meta?.usage || {};
    const inputTokens: number | undefined = usageObj.input_tokens ?? usageObj.prompt_tokens;
    const outputTokens: number | undefined = usageObj.output_tokens ?? usageObj.completion_tokens;
    const totalTokens: number | undefined = usageObj.total_tokens ?? (
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
