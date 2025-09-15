import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, GeneratedVideo } from "@google/genai";
import { uploadFile } from "@/storage";
import mime from 'mime';

const API_KEY = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({
  apiKey: API_KEY,
});
const VEO3_MODEL_NAME = 'veo-3.0-generate-preview';
const PROMPT_ENHANCER_MODEL = 'gemini-2.5-flash';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const numberOfVideos = body.numberOfVideos as number | undefined;

    // Structured prompt inputs (optional)
    const structured = {
      subject: body.subject as string | undefined,
      action: body.action as string | undefined,
      scene: body.scene as string | undefined,
      camera_angle: body.camera_angle as string | undefined,
      camera_movement: body.camera_movement as string | undefined,
      lens_effects: body.lens_effects as string | undefined,
      style: body.style as string | undefined,
      temporal_elements: body.temporal_elements as string | undefined,
      sound_effects: body.sound_effects as string | undefined,
      dialogue: body.dialogue as string | undefined,
    };

    const enhance = Boolean(body.enhance);

    let prompt = typeof body.prompt === 'string' ? (body.prompt as string) : '';
    const imageInput = typeof body.image === 'string' ? (body.image as string) : undefined;
    const hasStructured = Object.values(structured).some((v) => typeof v === 'string' && (v as string).trim() !== '');
    if ((!prompt && hasStructured) || (enhance && hasStructured)) {
      try {
        prompt = await enhancePromptFromKeywords(structured);
      } catch (e) {
        // Fallback to concatenated keywords if enhancer fails
        console.error('[generate] error:', e);
        prompt = fallbackPromptFromKeywords(structured);
      }
    }

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    // If an image is provided, normalize it and upload to object storage to obtain a public URL
    let referenceImageUrl: string | undefined;
    if (imageInput) {
      try {
        let mimeType = 'image/png';
        let imageBuffer: Buffer | undefined;
        if (/^https?:\/\//i.test(imageInput)) {
          const res = await fetch(imageInput);
          if (res.ok) {
            const contentType = res.headers.get('content-type');
            if (contentType) {
              mimeType = contentType;
            } else {
              try {
                mimeType = mime.getType(new URL(imageInput).pathname) || 'image/png';
              } catch {
                mimeType = 'image/png';
              }
            }
            const arrayBuf = await res.arrayBuffer();
            imageBuffer = Buffer.from(arrayBuf);
          }
        } else if (imageInput.startsWith('data:')) {
          const parts = imageInput.split(',');
          const header = parts[0] || '';
          const b64 = parts[1] || '';
          const headerMime = header.split(';')[0]?.replace('data:', '') || '';
          if (headerMime) mimeType = headerMime;
          if (b64) imageBuffer = Buffer.from(b64, 'base64');
        } else {
          // treat as raw base64
          mimeType = 'image/png';
          imageBuffer = Buffer.from(imageInput, 'base64');
        }

        if (imageBuffer) {
          const randomImageName = Math.random().toString(36).substring(2, 15);
          const ext = mime.getExtension(mimeType) || 'png';
          const fileName = `${randomImageName}.0.${ext}`;
          try {
            const url = await uploadFile(fileName, imageBuffer, mimeType);
            if (url) referenceImageUrl = url;
          } catch {}
        }
      } catch {}
    }

    const url = await generateVideoFromText(prompt, numberOfVideos, referenceImageUrl);
    console.log('[generate] completed, urls:', url);
    return NextResponse.json({ url });
  } catch (err: unknown) {
    console.error('[generate] error:', err);
    const message = err instanceof Error ? err.message : 'Failed to generate';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function generateVideoFromText(
  prompt: string,
  numberOfVideos = 1,
  referenceImageUrl?: string,
): Promise<string[]> {
  const finalPrompt = referenceImageUrl
    ? `${prompt}\nReference image: ${referenceImageUrl}`
    : prompt;
  let operation = await ai.models.generateVideos({
    model: VEO3_MODEL_NAME,
    prompt: finalPrompt,
    config: {
      numberOfVideos,
      aspectRatio: '16:9',
    },
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    console.log('...Generating...');
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation?.response) {
    const videos = operation.response?.generatedVideos;
    if (videos === undefined || videos.length === 0) {
      throw new Error('No videos generated');
    }

    return await Promise.all(
      videos.map(async (generatedVideo: GeneratedVideo, index: number) => {
        const rawUri = generatedVideo.video?.uri || '';
        console.log('[generate] video', index, 'uri:', rawUri);
        const uri = rawUri;
        if (!uri) {
          throw new Error('Empty video URI');
        }

        // Fetch the actual video bytes
        const urlWithKey = (() => {
          try {
            const u = new URL(uri);
            if (API_KEY) u.searchParams.set('key', API_KEY);
            return u.toString();
          } catch {
            // Fallback if uri isn't a valid URL instance
            if (!API_KEY) return uri;
            return uri.includes('?') ? `${uri}&key=${API_KEY}` : `${uri}?key=${API_KEY}`;
          }
        })();
        console.log('[generate] fetching video', index, 'from:', urlWithKey);
        const res = await fetch(urlWithKey);
        if (!res.ok) {
          throw new Error(`Failed to fetch video: ${res.status} ${res.statusText}`);
        }
        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        console.log('[generate] fetched video', index, 'content-type:', contentType);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Build S3 object key
        const extension = contentType.includes('mp4') ? '.mp4' : contentType.includes('quicktime') ? '.mov' : '';
        const uniqueId = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const objectKey = `videos/${uniqueId}${extension || `.mp4`}`;

        // Upload to S3
        console.log('[generate] uploading to S3 key:', objectKey);
        const url = await uploadFile(
            objectKey,
            buffer,
            contentType,
        );

        return url || '';
      }),
    );
  } else {
    throw new Error('No videos generated');
  }
}

type PromptKeywordInput = {
  subject?: string;
  action?: string;
  scene?: string;
  camera_angle?: string;
  camera_movement?: string;
  lens_effects?: string;
  style?: string;
  temporal_elements?: string;
  sound_effects?: string;
  dialogue?: string;
};

function collectKeywords(input: PromptKeywordInput): string[] {
  const mandatory = [input.subject, input.action, input.scene];
  const optional = [
    input.camera_angle,
    input.camera_movement,
    input.lens_effects,
    input.style,
    input.temporal_elements,
    input.sound_effects,
  ];
  const keywords: string[] = [];
  for (const k of mandatory) {
    if (typeof k === 'string' && k.trim() !== '') keywords.push(k.trim());
  }
  for (const k of optional) {
    if (typeof k === 'string' && k.trim() !== '' && k.trim().toLowerCase() !== 'none') {
      keywords.push(k.trim());
    }
  }
  if (typeof input.dialogue === 'string' && input.dialogue.trim() !== '') {
    keywords.push(input.dialogue.trim());
  }
  return keywords;
}

function fallbackPromptFromKeywords(input: PromptKeywordInput): string {
  const keywords = collectKeywords(input);
  return keywords.join(', ');
}

async function enhancePromptFromKeywords(input: PromptKeywordInput): Promise<string> {
  const keywords = collectKeywords(input);
  if (keywords.length === 0) return '';

  const geminiPrompt = `You are an expert video prompt engineer for Google's Veo model. Your task is to construct the most effective and optimal prompt string using the following keywords. Every single keyword MUST be included. Synthesize them into a single, cohesive, and cinematic instruction. Do not add any new core concepts. Output ONLY the final prompt string, without any introduction or explanation. Mandatory Keywords: ${keywords.join(', ')}`;

  const result = await ai.models.generateContent({
    model: PROMPT_ENHANCER_MODEL,
    contents: geminiPrompt,
  });

  const text = extractTextFromContentResult(result).trim();
  if (!text) return fallbackPromptFromKeywords(input);
  return text;
}

function extractTextFromContentResult(result: unknown): string {
  try {
    const textFn = (result as { response?: { text?: () => string } })?.response?.text;
    if (typeof textFn === 'function') {
      const maybeText = textFn();
      if (typeof maybeText === 'string' && maybeText.trim() !== '') return maybeText;
    }
  } catch {}
  try {
    const parts = (result as { response?: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } })?.response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      return parts.map((p) => p?.text || '').join('').trim();
    }
  } catch {}
  try {
    const alt = result as { text?: string; content?: string };
    const altText = alt?.text || alt?.content || '';
    if (typeof altText === 'string') return altText;
  } catch {}
  return '';
}