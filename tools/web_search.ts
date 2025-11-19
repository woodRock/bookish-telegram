import * as cheerio from "cheerio";

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
      // DuckDuckGo ads often have a class like 'result--ad' or are in specific containers
      // We'll try to filter them out. This might need adjustment if DDG changes its HTML.
      if ($(el).hasClass("result--ad") || $(el).find(".badge--ad").length > 0) {
        return; // Skip this ad result
      }

      const title = $(el).find(".result__title a").text().trim();
      const link = $(el).find(".result__url").attr("href");
      const snippet = $(el).find(".result__snippet").text().trim();

      if (title && link && snippet) {
        results.push({ title, link, snippet });
      }
    });
    console.log(`Found ${results.length} non-ad search results.`);

    if (results.length > 0 && results[0].link) {
      firstResultLink = results[0].link;
      console.log(`Attempting to fetch content from first result: ${firstResultLink}`);

      // Basic validation for the link
      if (!firstResultLink.startsWith("http://") && !firstResultLink.startsWith("https://")) {
        console.warn(`Skipping non-HTTP/HTTPS link: ${firstResultLink}`);
        return { searchResults: results, pageContent: "", firstResultLink: "" };
      }

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
          const $page = cheerio.load(pageHtml);
          // A simple heuristic to get main content, falling back to body
          const mainContent = ($page("main").text() || $page("article").text() || $page("body").text()).trim();
          pageContent = mainContent.substring(0, 10000);
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