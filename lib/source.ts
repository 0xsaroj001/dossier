/**
 * The page's own bibliographic metadata, read by the app for free. Publishers and arXiv put
 * title, authors, date and abstract in <meta> tags for exactly this purpose. This is not a
 * Telegraph call and is never counted as one: it is the input the paid questions work on,
 * because the network's extraction miners work on inline text and cannot fetch a link.
 */
export interface SourceMeta {
  url: string;
  title: string | null;
  authors: string[];
  abstract: string | null;
  date: string | null;
  year: string | null;
  site: string | null;
  method: "meta-tags";
  fetchedAt: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function metas(html: string): Array<{ key: string; content: string }> {
  const out: Array<{ key: string; content: string }> = [];
  for (const m of html.matchAll(/<meta\s+([^>]*?)\/?>/gi)) {
    const attrs = m[1] ?? "";
    const key = attrs.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = attrs.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && content !== undefined) out.push({ key, content: decodeEntities(content) });
  }
  return out;
}

function yearOf(date: string | null): string | null {
  return date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
}

/** Parse the metadata out of a page's HTML. Exported for tests. */
export function parseSourceHtml(url: string, html: string): SourceMeta {
  const tags = metas(html);
  const first = (...keys: string[]): string | null => {
    for (const k of keys) {
      const hit = tags.find((t) => t.key === k && t.content);
      if (hit) return hit.content;
    }
    return null;
  };
  const all = (key: string): string[] => tags.filter((t) => t.key === key && t.content).map((t) => t.content);
  const htmlTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const title = first("citation_title", "dc.title", "og:title") ?? (htmlTitle ? decodeEntities(htmlTitle).replace(/^\[\d{4}\.\d{4,5}(v\d+)?\]\s*/, "") : null);
  let authors = all("citation_author");
  if (!authors.length) {
    const a = first("author", "dc.creator", "article:author");
    if (a) authors = a.split(/;|\band\b|,(?=\s*[A-Z][a-z]+\s+[A-Z])/).map((s) => s.trim()).filter(Boolean);
  }
  const abstractCandidates = [first("citation_abstract", "dc.description"), first("og:description"), first("twitter:description"), first("description")].filter((s): s is string => Boolean(s));
  const abstract = abstractCandidates.find((s) => s.split(/\s+/).length >= 25 && !/^abstract page for/i.test(s)) ?? null;
  const date = first("citation_date", "citation_publication_date", "citation_online_date", "dc.date", "article:published_time", "og:updated_time");
  const site = first("og:site_name") ?? (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  })();
  return { url, title, authors: authors.slice(0, 20), abstract, date, year: yearOf(date), site, method: "meta-tags", fetchedAt: new Date().toISOString() };
}

export async function fetchSource(url: string, timeoutMs = 12_000): Promise<SourceMeta | { error: string }> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Dossier/0.1; +https://github.com/0xsaroj001/dossier)", accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { error: `The page answered ${res.status}.` };
    const type = res.headers.get("content-type") ?? "";
    if (!/html|xml/i.test(type)) return { error: `The link is ${type.split(";")[0] || "not a web page"}, and only web pages can be read.` };
    const html = (await res.text()).slice(0, 600_000);
    const meta = parseSourceHtml(url, html);
    if (!meta.title && !meta.abstract) return { error: "The page carries no title or abstract in its metadata." };
    return meta;
  } catch (e) {
    return { error: `The page could not be read: ${(e as Error).message}` };
  }
}
