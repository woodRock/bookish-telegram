import { NextResponse } from "next/server";
import { pipeline } from "@xenova/transformers";

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    const summarizer = await pipeline('summarization', 'Xenova/t5-small');
    const output = await summarizer(prompt, {
      max_new_tokens: 5,
      min_new_tokens: 3,
    });

    const summary = (output as { summary_text: string }[])[0].summary_text;

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Error during title summarization:", error);
    return NextResponse.json(
      { error: "Failed to summarize chat for title" },
      { status: 500 }
    );
  }
}
