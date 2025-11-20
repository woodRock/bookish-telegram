import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { query } = await req.json();

  if (!query) {
    return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  }

  try {
    // 1. Search Wikipedia
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();
    const searchResults = searchData.query.search;

    if (searchResults.length === 0) {
      return NextResponse.json({ summary: "I couldn't find any relevant information on Wikipedia." });
    }

    const pageId = searchResults[0].pageid;

    // 2. Get page content
    const pageUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=extracts&explaintext&format=json`;
    const pageResponse = await fetch(pageUrl);
    const pageData = await pageResponse.json();
    const pageContent = pageData.query.pages[pageId].extract;

    // 3. Summarize the content (for now, we'll just return the first paragraph)
    const firstParagraph = pageContent.split('\n')[0];

    console.log("First paragraph:", firstParagraph);

    return NextResponse.json({ summary: firstParagraph });

  } catch (error) {
    console.error('Wikipedia RAG error:', error);
    return NextResponse.json({ error: 'Failed to fetch from Wikipedia' }, { status: 500 });
  }
}
