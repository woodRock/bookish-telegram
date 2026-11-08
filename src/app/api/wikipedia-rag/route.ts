import { NextResponse } from 'next/server';

// Wikimedia asks API clients to identify themselves.
const headers = { 'User-Agent': 'bookish-telegram/0.1 (https://github.com/woodRock/bookish-telegram)' };

export async function POST(req: Request) {
  const { query } = await req.json();

  if (!query) {
    return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  }

  try {
    // 1. Search Wikipedia
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
    const searchResponse = await fetch(searchUrl, { headers });
    const searchData = await searchResponse.json();
    const searchResults = searchData.query.search;

    if (searchResults.length === 0) {
      return NextResponse.json({ error: "I couldn't find any relevant information on Wikipedia." }, { status: 404 });
    }

    const pageId = searchResults[0].pageid;
    const title = searchResults[0].title;

    // 2. Get page content
    const pageUrl = `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=extracts&explaintext&format=json`;
    const pageResponse = await fetch(pageUrl, { headers });
    const pageData = await pageResponse.json();
    const pageContent = pageData.query.pages[pageId].extract;

    // 3. Keep the lead section, trimmed to fit a small model's context window
    const lead = pageContent.split(/\n==/)[0].trim().slice(0, 3000);

    return NextResponse.json({ title, content: lead, link: `https://en.wikipedia.org/?curid=${pageId}` });

  } catch (error) {
    console.error('Wikipedia RAG error:', error);
    return NextResponse.json({ error: 'Failed to fetch from Wikipedia' }, { status: 500 });
  }
}
