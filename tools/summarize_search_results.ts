import { pipeline } from "@xenova/transformers";

// Initialize the summarizer pipeline once
let summarizer: any = null;
async function getSummarizer() {
  if (!summarizer) {
    summarizer = await pipeline('summarization', 'Xenova/t5-base'); // Changed to t5-base
  }
  return summarizer;
}

export async function summarizeSearchResults(
  query: string,
  searchResults: { title: string; link: string; snippet: string }[],
  pageContent: string
): Promise<string> {
  const summarizerInstance = await getSummarizer();

  let textToSummarize = `User's original query: "${query}"\n\n`;

  if (pageContent) {
    textToSummarize += `Content from the most relevant page:\n${pageContent}\n\n`;
  }

  if (searchResults.length > 0) {
    textToSummarize += `Snippets from other search results:\n`;
    searchResults.forEach((result, index) => {
      textToSummarize += `Result ${index + 1}: ${result.title} - ${result.snippet}\n`;
    });
  }

  // Limit the input text to avoid exceeding the summarizer's context window
  const maxInputLength = 1000; // Adjust based on model capabilities
  if (textToSummarize.length > maxInputLength) {
    textToSummarize = textToSummarize.substring(0, maxInputLength);
  }

  try {
    const output = await summarizerInstance(textToSummarize, {
      max_new_tokens: 100, // Summary length
      min_new_tokens: 20,
      do_sample: true,
      temperature: 0.7,
    });
    return output[0].summary_text;
  } catch (error) {
    console.error("Error during search results summarization:", error);
    return "Could not generate a summary of the search results.";
  }
}
