import { getPath, toConfidence } from "./receipt";
import type { DirectRequest, Miner } from "./telegraph";
import type { Language } from "./types";

/**
 * How to ask each miner, and how to read what it says. Known miners get an exact request
 * shape taken from their manifest; unknown ones get a schema-driven guess. A builder that
 * returns null says "this miner cannot take this input", and the step moves on.
 */
export interface StepInput {
  url?: string;
  question?: string;
  text?: string;
  claim?: string;
  title?: string;
  authors?: string[];
  year?: string | null;
  topic?: string;
  category?: string | null;
  region?: string | null;
  language?: Language | null;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export interface Parsed {
  answer?: string;
  label?: string | null;
  confidence?: number | null;
  confidenceNote?: string | null;
  data?: unknown;
  /** Set when the miner answered 2xx but the answer cannot be used (e.g. translation null). */
  unusable?: string | null;
}

export interface Adapter {
  build(input: StepInput, miner: Miner): DirectRequest | null;
  parse?(result: unknown, input: StepInput): Parsed;
}

export interface Article {
  title: string;
  source: string | null;
  url: string | null;
  published: string | null;
  description: string | null;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const COUNTRY_CODES: Record<string, string> = {
  India: "in",
  "United States": "us",
  "United Kingdom": "gb",
  Canada: "ca",
  Australia: "au",
  Germany: "de",
  France: "fr",
  Japan: "jp",
  China: "cn",
  Brazil: "br",
  Nigeria: "ng",
  Kenya: "ke",
  Pakistan: "pk",
  Bangladesh: "bd",
  Singapore: "sg",
};

export function cleanTitle(t: string | null): string | null {
  if (!t) return null;
  return t.replace(/^\[\d{4}\.\d{4,5}(v\d+)?\]\s*/, "").replace(/\s+\|\s+.*$/, "").replace(/\s+/g, " ").trim() || null;
}

export function splitAuthors(a: string | null): string[] {
  if (!a) return [];
  return a
    .split(/;|\band\b|,(?=\s*[A-Z][a-z]+\s+[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function yearOf(date: string | null | undefined): string | null {
  const m = date?.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function listText(items: Article[]): string {
  return items.map((a, i) => `${i + 1}. ${a.title}${a.source ? ` (${a.source})` : ""}`).join("\n");
}

/** Titles quoted in prose ("PVT v2: …") or numbered ("1) Title by Author"). */
export function titlesFromProse(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["“]([^"”]{8,200})["”]/g)) if (m[1]) out.push(m[1].trim());
  for (const m of text.matchAll(/(?:^|\s)\d+\)\s+([^"“”;]{8,200}?)\s+by\s+[A-Z]/g)) if (m[1]) out.push(m[1].trim());
  return [...new Set(out)];
}

const CONTENT_EXTRACTION: Record<string, Adapter> = {
  "netwire-content-extraction": {
    build: (i) => (i.url ? { method: "GET", endpoint: "/extract", payload: { url: i.url, question: i.question ?? `What does ${i.url} say?` } } : null),
    parse: (result, input) => {
      const r = rec(result);
      const title = cleanTitle(str(r["title"]));
      const excerpt = str(r["excerpt"]) ?? str(r["summary"]);
      const charCount = typeof r["char_count"] === "number" ? r["char_count"] : null;
      if (!title && !excerpt) return { unusable: "The page came back empty." };
      return {
        label: "read",
        answer: `Read ${charCount ?? "?"} characters from ${input.url ?? "the page"}${title ? `: “${title}”` : ""}.${excerpt ? ` ${excerpt}` : ""}`,
        data: { title, excerpt, charCount },
      };
    },
  },
  "microlink-url-extraction": {
    build: (i) => (i.url ? { method: "GET", endpoint: "/extract", payload: { url: i.url } } : null),
    parse: (result) => {
      const r = rec(result);
      const d = rec(r["data"] ?? r);
      const title = cleanTitle(str(d["title"]));
      const abstract = str(d["description"]);
      const author = str(d["author"]);
      const date = str(d["date"]);
      if (!title && !abstract) return { unusable: "No title or description in the page metadata." };
      return {
        label: "metadata",
        confidence: null,
        answer: `${title ?? "Untitled"}${author ? ` — ${author}` : ""}${date ? ` (${date.slice(0, 10)})` : ""}.${abstract ? ` ${abstract}` : ""}`,
        data: { title, authors: splitAuthors(author), abstract, date, year: yearOf(date), publisher: str(d["publisher"]), lang: str(d["lang"]) },
      };
    },
  },
  livecert: {
    // Structured extraction from inline text only; it fetches nothing.
    build: (i) => (i.text && !i.url ? { method: "GET", endpoint: "/extract", payload: { text: i.text, query: i.question ?? "Extract the key facts" } } : null),
  },
};

const AI_TEXT_DETECTION: Record<string, Adapter> = {
  "caliber-truthport-text-auth": {
    build: (i) => (i.text ? { method: "POST", endpoint: "/predict", payload: { text: i.text } } : null),
    parse: (result) => {
      const r = rec(result);
      const p = toConfidence(r["confidence"]);
      const label = str(r["label"]) ?? str(r["verdict"]);
      const ai = label === "ai_generated";
      return {
        label,
        confidence: p === null ? null : ai ? p : Number((1 - p).toFixed(4)),
        confidenceNote: p === null ? null : `The miner reports P(AI-written) = ${(p * 100).toFixed(0)}%.`,
        answer: str(r["reason"]) ?? `${label ?? "no verdict"}`,
        data: { label, pAi: p, model: str(r["model"]) },
      };
    },
  },
  livecert: {
    build: (i) => (i.text ? { method: "GET", endpoint: "/ai-detect", payload: { text: i.text, query: "Is the following text written by an AI or a human?" } } : null),
    parse: (result) => {
      const r = rec(result);
      const label = str(r["verdict"]);
      return { label, confidence: toConfidence(r["confidence"]), answer: str(r["reason"]) ?? label ?? "", data: { label, pAi: null, model: "livecert statistics" } };
    },
  },
  "veritarach-ai-text-detector": {
    build: (i) => (i.text ? { method: "POST", endpoint: "/predict", payload: { text: i.text } } : null),
    parse: (result) => {
      const r = rec(result);
      const label = str(r["label"]) ?? str(r["verdict"]) ?? str(r["prediction"]);
      return { label, confidence: toConfidence(r["confidence"]), data: { label, pAi: null, model: "veritarach" } };
    },
  },
};

const FRAUD_DETECTION: Record<string, Adapter> = {
  "sarzops-transaction-risk": {
    build: (i) => (i.question ? { method: "POST", endpoint: "/fraud", payload: { query: i.question.slice(0, 1000) } } : null),
    parse: (result) => {
      const r = rec(result);
      const answer = str(r["signal"]) ?? str(r["explanation"]);
      if (!answer) return { unusable: "No signal in the fraud answer." };
      return { label: str(r["verdict"]), confidence: toConfidence(r["confidence"]), answer, data: { verdict: str(r["verdict"]), answer } };
    },
  },
  txlens: {
    build: (i) => (i.question ? { method: "POST", endpoint: "/fraud-query", payload: { query: i.question.slice(8, 1000).length >= 8 ? i.question.slice(0, 1000) : i.question } } : null),
  },
};

const FACT_CHECK: Record<string, Adapter> = {
  "qarinah-proofpack": {
    build: (i) => (i.claim ? { method: "POST", endpoint: "/v1/proof", payload: { query: i.claim.slice(0, 2000), intent: "FACT_CHECK" } } : null),
    parse: (result) => {
      const r = rec(result);
      const verdict = str(r["verdict"]);
      return {
        label: verdict,
        confidence: toConfidence(r["confidence"]),
        answer: str(r["answer"]) ?? str(r["reason"]) ?? verdict ?? "",
        data: { verdict, confidence: toConfidence(r["confidence"]), answer: str(r["answer"]) },
      };
    },
  },
  livecert: {
    build: (i) => (i.claim ? { method: "GET", endpoint: "/fact-check", payload: { claim: i.claim.slice(0, 500), query: `Is this true: ${i.claim.slice(0, 400)}` } } : null),
    parse: (result) => {
      const r = rec(result);
      const verdict = str(r["verdict"]);
      return { label: verdict, confidence: toConfidence(r["confidence"]), answer: str(r["reason"]) ?? verdict ?? "", data: { verdict, answer: str(r["reason"]) } };
    },
  },
  tavily: {
    build: (i) => (i.claim ? { method: "POST", endpoint: "/search", payload: { query: `Is this claim true? ${i.claim.slice(0, 380)}`, include_answer: true, search_depth: "basic", max_results: 5 } } : null),
    parse: (result) => {
      const r = rec(result);
      const answer = str(r["answer"]);
      if (!answer) return { unusable: "The search returned no synthesised answer." };
      return { label: null, answer, data: { verdict: null, answer } };
    },
  },
};

function papersFrom(result: unknown, prose: string): string[] {
  const r = rec(result);
  const lists = [arr(r["papers"]), arr(r["results"]), arr(r["items"])];
  for (const l of lists) {
    const titles = l.map((p) => str(rec(p)["title"])).filter((t): t is string => Boolean(t));
    if (titles.length) return titles;
  }
  return titlesFromProse(prose);
}

const ACADEMIC_SEARCH: Record<string, Adapter> = {
  txlens: {
    build: (i) => (i.topic ? { method: "GET", endpoint: "/academic-search", payload: { topic: i.topic.slice(0, 300), limit: 5 } } : null),
    parse: (result) => {
      const r = rec(result);
      const answer = str(r["summary"]) ?? str(r["answer"]) ?? "";
      const papers = papersFrom(result, answer);
      const mc = rec(r["most_cited"]);
      const mostCited = str(mc["title"]);
      if (mostCited && !papers.includes(mostCited)) papers.unshift(mostCited);
      return { label: str(r["status"]), confidence: toConfidence(r["confidence"]), answer, data: { papers, totalMatches: r["total_matches"] ?? null } };
    },
  },
  livecert: {
    build: (i) => (i.topic ? { method: "GET", endpoint: "/papers", payload: { topic: i.topic.slice(0, 300), query: `Find peer-reviewed papers on ${i.topic.slice(0, 200)}` } } : null),
    parse: (result) => {
      const r = rec(result);
      const answer = str(r["reason"]) ?? "";
      return { label: str(r["verdict"]), confidence: toConfidence(r["confidence"]), answer, data: { papers: papersFrom(result, answer), totalMatches: null } };
    },
  },
  "scholarwire-academic-search": {
    build: (i) => (i.topic ? { method: "GET", endpoint: "/papers", payload: { topic: i.topic.slice(0, 300), question: `Find recent papers on ${i.topic.slice(0, 200)}` } } : null),
    parse: (result) => {
      const r = rec(result);
      const answer = str(r["summary"]) ?? str(r["answer"]) ?? "";
      return { answer, data: { papers: papersFrom(result, answer), totalMatches: null } };
    },
  },
};

const LANGUAGE_TRANSLATION: Record<string, Adapter> = {
  livecert: {
    build: (i) => (i.text && i.language ? { method: "GET", endpoint: "/translate", payload: { text: i.text, target_language: i.language.name } } : null),
    parse: (result, input) => {
      const r = rec(result);
      const t = str(r["translation"]) ?? (str(r["verdict"]) === "translated" ? str(r["reason"]) : null);
      if (!t) return { unusable: str(r["reason"]) ?? "No translation came back." };
      return { label: "translated", confidence: toConfidence(r["confidence"]), answer: t, data: { translation: t, language: input.language?.name ?? null } };
    },
  },
  "langwire-translation": {
    build: (i) => (i.text && i.language ? { method: "GET", endpoint: "/translate", payload: { text: i.text, to: i.language.name } } : null),
    parse: (result, input) => {
      const r = rec(result);
      const t = str(r["translation"]);
      if (!t) return { unusable: str(r["summary"]) ?? "This miner does not support that language pair." };
      return { label: "translated", confidence: toConfidence(r["confidence"]), answer: t, data: { translation: t, language: input.language?.name ?? null } };
    },
  },
  "mymemory-translate": {
    build: (i) => (i.text && i.language ? { method: "GET", endpoint: "/translate", payload: { q: i.text.slice(0, 480), langpair: `en|${i.language.code}` } } : null),
    parse: (result, input) => {
      const r = rec(result);
      const t = str(getPath(r, "responseData.translatedText"));
      if (!t || /QUERY LENGTH|INVALID|NO QUERY/i.test(t)) return { unusable: t ?? "No translation came back." };
      return { label: "translated", confidence: toConfidence(getPath(r, "responseData.match")), answer: t, data: { translation: t, language: input.language?.name ?? null } };
    },
  },
};
LANGUAGE_TRANSLATION["test-mymemory-translate"] = LANGUAGE_TRANSLATION["mymemory-translate"]!;

function articlesOf(list: unknown[], map: (a: Rec) => Article): Article[] {
  return list.map((x) => map(rec(x))).filter((a) => a.title);
}

const NEWS_HEADLINES: Record<string, Adapter> = {
  livecert: {
    // Understands Google News sections, not free-text topics; the region rides in the question.
    build: (i) =>
      i.category
        ? { method: "GET", endpoint: "/headlines", payload: i.region ? { topic: i.category, query: `${i.category} headlines in ${i.region}` } : { topic: i.category } }
        : null,
    parse: (result) => {
      const r = rec(result);
      const items = articlesOf(arr(r["headlines"]), (a) => ({ title: str(a["title"]) ?? "", source: str(a["source"]), url: str(a["url"]), published: str(a["published"]), description: null }));
      if (!items.length) return { unusable: "No headlines came back." };
      return { label: str(r["verdict"]), confidence: toConfidence(r["confidence"]), answer: listText(items), data: { items, category: str(r["topic"]), region: str(r["region"]) } };
    },
  },
  "newswire-headlines": {
    build: (i) => (i.topic ? { method: "GET", endpoint: "/headlines", payload: { topic: i.topic.slice(0, 120), question: `What are the top headlines about ${i.topic.slice(0, 120)}${i.region ? ` in ${i.region}` : ""} today?` } } : null),
    parse: (result, input) => {
      const r = rec(result);
      const items = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(a["source"]), url: str(a["url"]), published: str(a["published_at"]), description: null }));
      if (!items.length) return { unusable: "No headlines came back." };
      return { label: "headlines", answer: listText(items), data: { items, category: input.category ?? null, region: input.region ?? null } };
    },
  },
  newsapi: {
    build: (i) => {
      if (!i.topic) return null;
      const payload: Record<string, unknown> = { q: i.topic.slice(0, 120) };
      const cc = i.region ? COUNTRY_CODES[i.region] : undefined;
      if (cc) payload["country"] = cc;
      return { method: "GET", endpoint: "/headlines", payload };
    },
    parse: (result, input) => {
      const r = rec(result);
      const items = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(rec(a["source"])["name"]), url: str(a["url"]), published: str(a["publishedAt"]), description: str(a["description"]) }));
      if (!items.length) return { unusable: "No headlines came back." };
      return { label: "headlines", answer: listText(items), data: { items, category: input.category ?? null, region: input.region ?? null } };
    },
  },
};

const NEWS_SEARCH: Record<string, Adapter> = {
  "verity-news-search": {
    build: (i) => {
      if (!i.topic) return null;
      const payload: Record<string, unknown> = { q: i.topic.slice(0, 120), max_results: 5, recent_days: 7, language: "en" };
      const cc = i.region ? COUNTRY_CODES[i.region] : undefined;
      if (cc) payload["country"] = cc.toUpperCase();
      return { method: "GET", endpoint: "/news", payload };
    },
    parse: (result) => {
      const r = rec(result);
      const articles = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(a["source"]), url: str(a["url"]), published: str(a["published_at"]), description: str(a["description"]) }));
      if (!articles.length) return { unusable: "No articles matched." };
      return { label: `${articles.length} articles`, confidence: toConfidence(r["confidence"]), answer: str(r["answer"]) ?? str(r["summary"]) ?? listText(articles), data: { articles, answer: str(r["answer"]) } };
    },
  },
  tavily: {
    build: (i) => (i.topic ? { method: "POST", endpoint: "/search", payload: { query: `${i.topic.slice(0, 200)} news${i.region ? ` ${i.region}` : ""}`, topic: "news", include_answer: true, max_results: 5 } } : null),
    parse: (result) => {
      const r = rec(result);
      const articles = articlesOf(arr(r["results"]), (a) => ({ title: str(a["title"]) ?? "", source: null, url: str(a["url"]), published: str(a["published_date"]), description: str(a["content"])?.slice(0, 300) ?? null }));
      if (!articles.length && !str(r["answer"])) return { unusable: "No articles matched." };
      return { label: `${articles.length} articles`, answer: str(r["answer"]) ?? listText(articles), data: { articles, answer: str(r["answer"]) } };
    },
  },
  gnews: {
    build: (i) => (i.topic ? { method: "GET", endpoint: "/search", payload: { q: i.topic.slice(0, 120), max: 5, lang: "en" } } : null),
    parse: (result) => {
      const r = rec(result);
      const articles = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(rec(a["source"])["name"]), url: str(a["url"]), published: str(a["publishedAt"]), description: str(a["description"]) }));
      if (!articles.length) return { unusable: "No articles matched." };
      return { label: `${articles.length} articles`, answer: listText(articles), data: { articles, answer: null } };
    },
  },
};

const CHAT_COMPLETION: Record<string, Adapter> = {
  "groq-llama31-instant-miner": {
    build: (i) => (i.messages?.length ? { method: "POST", endpoint: "/chat", payload: { messages: i.messages, max_tokens: 700, temperature: 0.2 } } : null),
    parse: (result) => {
      const r = rec(result);
      const text = str(r["output"]) ?? str(getPath(r, "choices.0.message.content"));
      if (!text) return { unusable: "The model returned no text." };
      return { label: null, confidence: toConfidence(r["confidence"]), answer: text, data: { text } };
    },
  },
  gemini: {
    build: (i) => (i.messages?.length ? { method: "POST", endpoint: "/chat", payload: { messages: i.messages, model: "gemini-flash-latest", max_tokens: 700, temperature: 0.2 } } : null),
    parse: (result) => {
      const r = rec(result);
      const text = str(getPath(r, "choices.0.message.content")) ?? str(r["output"]);
      if (!text) return { unusable: "The model returned no text." };
      return { label: null, answer: text, data: { text } };
    },
  },
};

export const ADAPTERS: Record<string, Record<string, Adapter>> = {
  CONTENT_EXTRACTION,
  AI_TEXT_DETECTION,
  FRAUD_DETECTION,
  FACT_CHECK,
  ACADEMIC_SEARCH,
  LANGUAGE_TRANSLATION,
  NEWS_HEADLINES,
  NEWS_SEARCH,
  CHAT_COMPLETION,
};

const PROSE_KEYS = ["query", "q", "question", "text", "prompt", "input", "message"];
const ENDPOINT_HINT: Record<string, RegExp> = {
  CONTENT_EXTRACTION: /extract|read|scrape/i,
  AI_TEXT_DETECTION: /detect|predict|ai/i,
  FRAUD_DETECTION: /fraud|risk|assess|scam/i,
  FACT_CHECK: /fact|proof|verify|check|claim/i,
  ACADEMIC_SEARCH: /paper|academic|scholar|search/i,
  LANGUAGE_TRANSLATION: /translat/i,
  NEWS_HEADLINES: /headline|news|top/i,
  NEWS_SEARCH: /news|search|article/i,
  CHAT_COMPLETION: /chat|complet|generate/i,
};

/** A schema-driven guess for miners without a known adapter. Null when the schema needs typed input we do not have. */
export function genericAdapter(intent: string): Adapter {
  return {
    build: (input, miner) => {
      const props = Object.keys(miner.input_schema?.properties ?? {});
      const required = miner.input_schema?.required ?? [];
      const eps = miner.endpoints ?? [];
      const hint = ENDPOINT_HINT[intent];
      const ep = (hint && eps.find((e) => hint.test(e.path) || hint.test(e.description ?? ""))) ?? eps[0];
      if (!ep) return null;
      const method = (ep.method ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
      const question =
        input.question ?? input.claim ?? input.text ?? (input.topic ? `${intent === "NEWS_HEADLINES" ? "Top headlines about" : "Recent news about"} ${input.topic}` : null);
      const payload: Record<string, unknown> = {};
      const prose = props.filter((k) => PROSE_KEYS.includes(k));
      if (question) for (const k of prose) payload[k] = question;
      if (input.url && props.includes("url")) payload["url"] = input.url;
      if (input.text && props.includes("text")) payload["text"] = input.text;
      if (input.language) {
        for (const k of ["to", "target", "target_language", "target_lang", "tl"]) if (props.includes(k)) payload[k] = input.language.name;
      }
      if (intent === "CHAT_COMPLETION" && (props.includes("messages") || props.length === 0) && input.messages) payload["messages"] = input.messages;
      const unmet = required.filter((k) => !(k in payload));
      if (unmet.length > 0) return null;
      if (Object.keys(payload).length === 0) return null;
      return { method, endpoint: ep.path, payload };
    },
  };
}

export function adapterFor(intent: string, miner: Miner): Adapter {
  return ADAPTERS[intent]?.[miner.slug] ?? genericAdapter(intent);
}
