// Web search tool: Tavily if TAVILY_API_KEY is set, else keyless DuckDuckGo.
async function tavilySearch(query, k) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: k,
      search_depth: "basic",
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, k).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

async function duckDuckGoSearch(query, k) {
  const url =
    "https://api.duckduckgo.com/?q=" +
    encodeURIComponent(query) +
    "&format=json&no_html=1&skip_disambig=1";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DuckDuckGo error ${res.status}`);
  const data = await res.json();

  const results = [];
  if (data.AbstractText) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL || "https://duckduckgo.com/?q=" + encodeURIComponent(query),
      content: data.AbstractText,
    });
  }
  const topics = (data.RelatedTopics || []).flatMap((t) =>
    t.Topics ? t.Topics : [t]
  );
  for (const t of topics) {
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.slice(0, 80), url: t.FirstURL, content: t.Text });
    }
    if (results.length >= k) break;
  }
  return results.slice(0, k);
}

export async function webSearch(query, k = 4) {
  try {
    if (process.env.TAVILY_API_KEY) {
      return await tavilySearch(query, k);
    }
    return await duckDuckGoSearch(query, k);
  } catch (err) {
    console.error("webSearch failed:", err.message);
    return [];
  }
}
