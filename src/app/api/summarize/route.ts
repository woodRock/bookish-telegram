import { NextResponse } from "next/server";
import { pipeline } from "@xenova/transformers";

// This is a simplified summarization. In a real app, you'd likely have a dedicated summarization model
// or a more robust way to interact with the LLM for summarization.
// For now, we'll just use a basic approach.

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // This part would ideally interact with a dedicated summarization model or a more
    // sophisticated LLM endpoint. For demonstration, we'll just return a truncated version
    // of the prompt as a placeholder summary.
    // In a real scenario, you'd load a model like 'Xenova/t5-small' for summarization
    // and use it here.

    // Placeholder for actual LLM summarization
    const summarizer = await pipeline('summarization', 'Xenova/t5-small');
    const output = await summarizer(prompt, {
      max_new_tokens: 5, // Limit to 5 words
      min_new_tokens: 3,
    });
    // The output from summarizer pipeline is typically an array of objects,
    // where each object has a 'summary_text' property.
    // We assert the type to ensure TypeScript knows this structure.
    const summary = (output as { summary_text: string }[])[0].summary_text;

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Error during summarization:", error);
    return NextResponse.json(
      { error: "Failed to summarize chat" },
      { status: 500 }
    );
  }
}