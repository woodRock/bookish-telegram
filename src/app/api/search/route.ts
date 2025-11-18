import { web_search } from "../../../../tools/web_search";
import { summarizeSearchResults } from "../../../../tools/summarize_search_results";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { query } = await request.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const { searchResults, pageContent, firstResultLink } = await web_search(query);
    const summaryOfResults = await summarizeSearchResults(query, searchResults, pageContent);

    return NextResponse.json({ searchResults, pageContent, firstResultLink, summaryOfResults });
  } catch (error) {
    console.error("Error during web search:", error);
    return NextResponse.json(
      { error: "Failed to perform web search" },
      { status: 500 }
    );
  }
}
