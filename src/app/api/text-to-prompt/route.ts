import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI({ apiKey: API_KEY });
const PROMPT_ENHANCER_MODEL = "gemini-2.5-flash";

export async function POST(req: Request) {
    const { text } = await req.json();
    const instruction = `You are an expert Text to Image Prompt Enhancer. Please enhance the following prompt to make it more interesting and descriptive: ${text}.
    <response>`;
    const result = await ai.models.generateContent({
        model: PROMPT_ENHANCER_MODEL,
        contents: instruction,
      });
    const prompt = result.text
    return NextResponse.json({ prompt });
}