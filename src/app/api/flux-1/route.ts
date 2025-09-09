import { NextRequest, NextResponse } from "next/server";

const BFL_ENDPOINT = 'https://api.bfl.ai/v1/flux-kontext-pro';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing BFL_API_KEY' }, { status: 500 });
  }

  const prompt: string = String(body?.prompt || 'A small furry elephant pet looks out from a cat house');
  // const aspect_ratio: string = String(body?.aspect_ratio || '1:1');
  const input_image: string | undefined = body.image;
  
  const fluxBody: any = { prompt };
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
    return NextResponse.json({ error: 'BFL submit failed', body: text || undefined }, { status: 502 });
  }
  const submitJson: any = await submitRes.json();
  const pollingUrl: string | undefined = submitJson?.polling_url;

  if (!pollingUrl) {
    return NextResponse.json({ error: 'No polling URL returned' }, { status: 502 });
  }

  console.log('pollingUrl', pollingUrl);

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
      return NextResponse.json({ error: 'BFL polling failed', body: text || undefined }, { status: 502 });
    }

    const pollJson = await pollRes.json();
    
    if (pollJson.status === 'Ready') {
      return NextResponse.json({
        success: true,
        url: pollJson.result?.sample,
      });
    } else if (pollJson.status === 'Error' || pollJson.status === 'Failed') {
      return NextResponse.json({ error: 'Generation failed', details: pollJson }, { status: 500 });
    }
    // Otherwise continue polling
  }

  // If we get here, we timed out
  return NextResponse.json({ error: 'Generation timed out' }, { status: 504 });
}
