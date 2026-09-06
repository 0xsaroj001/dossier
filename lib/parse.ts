import { findLanguage, LANGUAGES } from "./languages";
import type { Language, Mode, ParsedQuery } from "./types";

/**
 * One free-text query becomes a plan. Research needs a URL; news needs a topic. A target
 * language may be named in the text ("in Hindi", "translate to Spanish") or chosen in the UI.
 */
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/i;

const LANG_ALTS = LANGUAGES.flatMap((l) => [l.name, ...l.aliases])
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .sort((a, b) => b.length - a.length)
  .join("|");

/** "in Hindi", "into Spanish", "to French", "translated in Tamil", "(hindi)". */
const LANG_RE = new RegExp(
  `(?:\\b(?:in|into|to|as)\\s+(?:the\\s+)?(${LANG_ALTS})(?:\\s+language)?\\b|\\((${LANG_ALTS})\\))`,
  "giu",
);

export function extractLanguage(text: string): { language: Language | null; rest: string } {
  let language: Language | null = null;
  let rest = text;
  const matches = [...text.matchAll(LANG_RE)];
  // The last mention wins: "translate the paper in Hindi" and "in India ... in Hindi" both end with the target.
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const m = matches[i];
    if (!m) continue;
    const word = m[1] ?? m[2] ?? "";
    const found = findLanguage(word);
    if (found) {
      language = found;
      const start = m.index ?? 0;
      rest = text.slice(0, start) + " " + text.slice(start + m[0].length);
      break;
    }
  }
  return { language, rest: rest.replace(/\s+/g, " ").trim() };
}

const REGION_WORDS: Array<[RegExp, string]> = [
  [/\b(india|indian)\b/i, "India"],
  [/\b(usa?|u\.s\.a?\.?|united states|america|american)\b/i, "United States"],
  [/\b(uk|u\.k\.|britain|british|united kingdom|england)\b/i, "United Kingdom"],
  [/\b(canada|canadian)\b/i, "Canada"],
  [/\b(australia|australian)\b/i, "Australia"],
  [/\b(germany|german)\b/i, "Germany"],
  [/\b(france|french)\b/i, "France"],
  [/\b(japan|japanese)\b/i, "Japan"],
  [/\b(china|chinese)\b/i, "China"],
  [/\b(brazil|brazilian)\b/i, "Brazil"],
  [/\b(nigeria|nigerian)\b/i, "Nigeria"],
  [/\b(kenya|kenyan)\b/i, "Kenya"],
  [/\b(pakistan|pakistani)\b/i, "Pakistan"],
  [/\b(bangladesh)\b/i, "Bangladesh"],
  [/\b(singapore)\b/i, "Singapore"],
  [/\b(europe|european|eu)\b/i, "Europe"],
  [/\b(middle east)\b/i, "Middle East"],
  [/\b(africa|african)\b/i, "Africa"],
];

/** A region named after "in", "from", "for" or "across". Only those phrasings count, so "Indian IT firms" stays a topic. */
export function detectRegion(text: string): string | null {
  const m = text.match(/\b(?:in|from|for|across)\s+(?:the\s+)?([A-Za-z.]+(?:\s+[A-Za-z.]+)?)/i);
  if (!m?.[1]) return null;
  for (const [re, name] of REGION_WORDS) if (re.test(m[1])) return name;
  return null;
}

/** Google News sections the headline miners understand. Free text that maps to none stays a topic search. */
const CATEGORIES: Array<[RegExp, string]> = [
  [/\b(tech|technology|ai|artificial intelligence|machine learning|llms?|software|apps?|chips?|semiconductors?|crypto|bitcoin|ethereum|blockchain|startups?|cyber(security)?|robots?|robotics|gadgets?|smartphones?)\b/i, "technology"],
  [/\b(business|econom(y|ic|ics)|markets?|stocks?|shares|finance|financial|trade|tariffs?|inflation|earnings|banks?|banking|ipo|rbi|fed|interest rates?)\b/i, "business"],
  [/\b(sports?|cricket|football|soccer|nba|nfl|tennis|olympics?|ipl|f1|formula one|golf|hockey|badminton)\b/i, "sports"],
  [/\b(science|space|nasa|isro|climate|physics|quantum|astronomy|biology|chemistry|research)\b/i, "science"],
  [/\b(health|medical|medicine|covid|vaccines?|disease|hospitals?|drugs?|pharma)\b/i, "health"],
  [/\b(entertainment|movies?|films?|music|celebrit(y|ies)|bollywood|hollywood|tv|television|netflix|box office)\b/i, "entertainment"],
  [/\b(world|war|ukraine|gaza|israel|russia|elections?|politics|political|parliament|congress|senate|president|prime minister|government|diplomacy)\b/i, "world"],
];

export function detectCategory(topic: string): string | null {
  for (const [re, name] of CATEGORIES) if (re.test(topic)) return name;
  return null;
}

const NEWS_LEAD =
  /^(?:(?:what(?:'s| is| are)?|whats|tell me|give me|show me|find|get|fetch|search|look up)\s+)?(?:the\s+)?(?:latest|recent|current|today'?s|top|breaking)?\s*(?:news|headlines?|coverage|stories|updates?|developments?)?\s*(?:about|on|regarding|around|for|of|with)?\s*/i;

export function extractTopic(text: string): string | null {
  let t = text.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
  t = t.replace(NEWS_LEAD, "").trim();
  t = t.replace(/^(?:what(?:'s| is)? (?:happening|going on|new)\s+(?:with|in|on|about)?\s*)/i, "").trim();
  t = t.replace(/[?!.]+$/g, "").trim();
  t = t
    .replace(/\b(?:please|right now|at the moment|this week|today)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/^(?:the|a|an)\s+/i, "").trim();
  t = t.replace(/[,;:]+$/g, "").trim();
  return t.length >= 2 ? t : null;
}

const REGION_TAIL = /\b(?:in|from|for|across)\s+(?:the\s+)?[A-Za-z.]+(?:\s+[A-Za-z.]+)?\s*[,.]?\s*$/i;

const BARE_HOST_RE = /(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`)\]]*)?)(?=[\s.,;:!?)]|$)/i;
const ADDRESS_RE = /\b0x[0-9a-fA-F]{40}\b|\b[a-z0-9-]+\.eth\b/i;

/** Safety mode: what was pasted. A link with or without a scheme, a wallet, and any prose around them. */
export function parseSafety(query: string): ParsedQuery {
  const clean = query.replace(/\s+/g, " ").trim();
  let url = clean.match(URL_RE)?.[0]?.replace(/[.,;:!?)]+$/, "") ?? null;
  if (!url) {
    const bare = clean.match(BARE_HOST_RE)?.[1];
    if (bare && !/\.(eth|jpg|png|pdf)$/i.test(bare)) url = `https://${bare}`;
  }
  const address = clean.match(ADDRESS_RE)?.[0] ?? null;
  const prose = clean
    .replace(URL_RE, " ")
    .replace(ADDRESS_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const message = prose.split(/\s+/).filter(Boolean).length >= 8 ? clean.slice(0, 2000) : null;
  return { mode: "safety", query: clean, url, topic: null, language: null, region: null, category: null, address, message };
}

export function parseQuery(mode: Mode, query: string, uiLanguage?: string | null): ParsedQuery {
  if (mode === "safety") return parseSafety(query);
  const clean = query.replace(/\s+/g, " ").trim();
  const url = clean.match(URL_RE)?.[0]?.replace(/[.,;:]+$/, "") ?? null;
  const { language: spoken, rest } = extractLanguage(clean);
  const language = spoken ?? (uiLanguage ? findLanguage(uiLanguage) : null);
  const finalLanguage = language && language.code === "en" ? null : language;
  const withoutUrl = rest.replace(URL_RE, " ");
  const region = mode === "news" ? detectRegion(withoutUrl) : null;
  let topic: string | null = null;
  if (mode === "news") {
    let t = withoutUrl;
    if (region) t = t.replace(REGION_TAIL, (m) => (detectRegion(m) ? " " : m));
    topic = extractTopic(t);
  }
  const category = topic ? detectCategory(topic) : null;
  return { mode, query: clean, url, topic, language: finalLanguage, region, category };
}

function urlProblem(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "Only http(s) links can be checked.";
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname)) return "That address is not public.";
    return null;
  } catch {
    return "That link does not parse as a URL.";
  }
}

export function validateParsed(p: ParsedQuery): string | null {
  if (!p.query) return "Type a question first.";
  if (p.mode === "research") {
    if (!p.url) return "Research mode needs a link to the paper, e.g. https://arxiv.org/abs/1706.03762";
    return urlProblem(p.url);
  }
  if (p.mode === "news" && !p.topic) return "News mode needs a topic, e.g. AI regulation in India";
  if (p.mode === "safety") {
    if (!p.url && !p.address && !p.message) return "Paste a link, a wallet address, or the message you received.";
    if (p.url) return urlProblem(p.url);
  }
  return null;
}
