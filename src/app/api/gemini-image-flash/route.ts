import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
// import { writeFile } from 'fs';
import { put } from '@tigrisdata/storage';
import mime from 'mime';
// import { Variant } from '@/types'

export async function POST(request: NextRequest) {
    const body = await request.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('Missing GEMINI_API_KEY. Set it in your environment or a .env file.');
      process.exit(1);
    }
    const ai = new GoogleGenAI({
      apiKey,
    });
    const config = {
      responseModalities: [
          'IMAGE',
          'TEXT',
      ],
    };
    const model = 'gemini-2.5-flash-image-preview';
  
    const imageString = typeof body.image === 'string' ? (body.image as string) : undefined;
    let contents: any = String(body.prompt || '');
    if (imageString) {
      let inlineMime = 'image/png';
      let inlineData = '';
      if (/^https?:\/\//i.test(imageString)) {
        const res = await fetch(imageString);
        if (!res.ok) {
          throw new Error(`Failed to fetch image URL: ${res.status}`);
        }
        const contentType = res.headers.get('content-type') || mime.getType(new URL(imageString).pathname) || 'image/png';
        const arrayBuf = await res.arrayBuffer();
        inlineData = Buffer.from(arrayBuf).toString('base64');
        inlineMime = contentType;
      } else if (imageString.startsWith('data:')) {
        inlineMime = imageString.split(';')[0]?.replace('data:', '') || 'image/png';
        inlineData = imageString.split(',')[1] || '';
      } else {
        inlineMime = 'image/png';
        inlineData = imageString; // treat as raw base64 string
      }
      contents = [
        {
          role: 'user',
          parts: [
            { text: String(body.prompt || '') },
            { inlineData: { mimeType: inlineMime, data: inlineData } },
          ],
        },
      ];
    }

    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });
    let fileIndex = 0;
    let fullText = "";
    let savedImageUrl: string | undefined;
    // Track token usage if provided by the API
    let promptTokenCount: number | undefined;
    let candidatesTokenCount: number | undefined;
    let totalTokenCount: number | undefined;
    for await (const chunk of response) {
      if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
        continue;
      }
      // Capture usage metadata when available (usually present on terminal chunks)
      const usage = (chunk as any).usageMetadata || (chunk.candidates?.[0] as any)?.usageMetadata;
      if (usage) {
        if (typeof usage.promptTokenCount === 'number') promptTokenCount = usage.promptTokenCount;
        if (typeof usage.candidatesTokenCount === 'number') candidatesTokenCount = usage.candidatesTokenCount;
        if (typeof usage.totalTokenCount === 'number') totalTokenCount = usage.totalTokenCount;
      }
      if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
        const random_image_name = Math.random().toString(36).substring(2, 15);
        const fileName = `${random_image_name}.${fileIndex++}`;
        const inlineData = chunk.candidates[0].content.parts[0].inlineData;
        const mimeType = inlineData.mimeType || 'image/png';
        const fileExtension = mime.getExtension(mimeType || '') || 'png';
        const buffer = Buffer.from(inlineData.data || '', 'base64');
        const dataUrl = `data:${mimeType};base64,${inlineData.data || ''}`;
        try {
          const url = await saveBinaryFile(`${fileName}.${fileExtension}`, buffer, mimeType);
          savedImageUrl = url || dataUrl;
        } catch {
          savedImageUrl = dataUrl;
        }
        continue;
      } else if (typeof chunk.text === 'string' && chunk.text.length > 0) {
        fullText += chunk.text;
      }
    }
    if (savedImageUrl) {
      return NextResponse.json({
        success: true,
        image: savedImageUrl,
        text: fullText || undefined,
        tokens: typeof totalTokenCount === 'number' ? totalTokenCount : undefined,
        usage: {
          inputTokens: promptTokenCount,
          outputTokens: candidatesTokenCount,
          totalTokens: totalTokenCount,
        },
      });
    }
    if (fullText.trim().length > 0) {
      return NextResponse.json({
        success: true,
        text: fullText,
        tokens: typeof totalTokenCount === 'number' ? totalTokenCount : undefined,
        usage: {
          inputTokens: promptTokenCount,
          outputTokens: candidatesTokenCount,
          totalTokens: totalTokenCount,
        },
      });
    }
    return NextResponse.json({ error: 'No image or text was generated' }, { status: 500 });
}

  
async function saveBinaryFile(fileName: string, content: Buffer, contentType: string) {
    const imageResult = await put(`images/${fileName}`, content, {
        contentType,
        access: 'public',
        allowOverwrite: true,
    });
    return imageResult.data?.url;
  }


  