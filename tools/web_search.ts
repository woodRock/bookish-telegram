import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";

export async function web_search(query: string) {
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  console.log(`Attempting to fetch search results from: ${searchUrl}`);

  let pageContent = "";
  let firstResultLink = "";

  try {
    const searchResponse = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    console.log(`Search results response status for ${searchUrl}: ${searchResponse.status}`);

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error(`HTTP error fetching search results! status: ${searchResponse.status}, body: ${errorText}`);
      throw new Error(`HTTP error fetching search results! status: ${searchResponse.status}`);
    }

    const searchHtml = await searchResponse.text();
    const $ = cheerio.load(searchHtml);

    const results: { title: string; link: string; snippet: string }[] = [];

    $(".result").each((i, el) => {
      const title = $(el).find(".result__title a").text().trim();
      const link = $(el).find(".result__url").attr("href");
      const snippet = $(el).find(".result__snippet").text().trim();

      if (title && link && snippet) {
        results.push({ title, link, snippet });
      }
    });
    console.log(`Found ${results.length} search results.`);

    if (results.length > 0 && results[0].link) {
      firstResultLink = results[0].link;
      console.log(`Attempting to fetch content from first result: ${firstResultLink}`);
      try {
        const pageResponse = await fetch(firstResultLink, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
        });

        console.log(`Page content response status for ${firstResultLink}: ${pageResponse.status}`);

        if (pageResponse.ok) {
          const pageHtml = await pageResponse.text();
          const dom = new JSDOM(pageHtml);
          const document = dom.window.document;

          // A basic attempt to extract main content
          // This can be highly unreliable and needs more sophisticated logic for real-world use
          const paragraphs = document.querySelectorAll("p");
          let extractedText = "";
          paragraphs.forEach((p) => {
            extractedText += p.textContent + "\n";
          });
          pageContent = extractedText.trim().substring(0, 2000); // Limit content to avoid huge prompts
          console.log(`Extracted ${pageContent.length} characters from the first result page.`);
        } else {
          console.warn(`Could not fetch content from ${firstResultLink}, status: ${pageResponse.status}`);
        }
      } catch (pageError) {
        console.error(`Error fetching or parsing first result page (${firstResultLink}):`, pageError);
      }
    }

    return { searchResults: results, pageContent, firstResultLink };
  } catch (error) {
    console.error("Error during web scraping:", error);
    return { searchResults: [], pageContent: "", firstResultLink: "" };
  }
}