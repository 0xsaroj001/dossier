import { getPath, toConfidence } from "./receipt";
import type { Language } from "./types";

/**
 * Readers: how to understand what each miner says. The router chooses the miner; the app
 * only has to read the answer. Known miners get an exact reader taken from their manifest
 * and live probes; anything else falls back to the generic receipt text.
 */
export interface StepInput {
  url?: string;
  text?: string;
  claim?: string;
  title?: string;
  authors?: string[];
  year?: string | null;
  topic?: string;
  category?: string | null;
  region?: string | null;
  language?: Language | null;
}

export interface Parsed {
  answer?: string;
  label?: string | null;
  confidence?: number | null;
  confidenceNote?: string | null;
  data?: unknown;
  /** Set when the miner answered 2xx but the answer cannot serve the step. */
  unusable?: string | null;
}

export type Reader = (result: unknown, input: StepInput) => Parsed;

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

/** arXiv's abstract page, as a page-text extractor sees it: "… Title: X Authors: A, B View a PDF …". */
export function arxivFromExcerpt(excerpt: string): { title: string | null; authors: string[]; date: string | null } {
  const title = excerpt.match(/Title:\s*(.+?)\s+Authors:/)?.[1] ?? null;
  const authorsRaw = excerpt.match(/Authors:\s*(.+?)(?:\s+View a PDF|\s+Abstract:|$)/)?.[1] ?? null;
  const authors = authorsRaw
    ? authorsRaw
        .split(/\s*,\s*/)
        .map((s) => s.trim())
        .filter((s) => s && s.length < 60)
        .slice(0, 12)
    : [];
  const date = excerpt.match(/Submitted on\s+(\d{1,2}\s+\w{3}\s+\d{4})/)?.[1] ?? null;
  return { title: title ? cleanTitle(title) : null, authors, date };
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

function papersFrom(result: unknown, prose: string): string[] {
  const r = rec(result);
  for (const l of [arr(r["papers"]), arr(r["results"]), arr(r["items"])]) {
    const titles = l.map((p) => str(rec(p)["title"])).filter((t): t is string => Boolean(t));
    if (titles.length) return titles;
  }
  return titlesFromProse(prose);
}

function articlesOf(list: unknown[], map: (a: Rec) => Article): Article[] {
  return list.map((x) => map(rec(x))).filter((a) => a.title);
}

const CONTENT_EXTRACTION: Record<string, Reader> = {
  "netwire-content-extraction": (result, input) => {
    const r = rec(result);
    const pageTitle = cleanTitle(str(r["title"]));
    const excerpt = str(r["excerpt"]) ?? str(r["summary"]);
    const charCount = typeof r["char_count"] === "number" ? r["char_count"] : null;
    if (!pageTitle && !excerpt) return { unusable: "the page came back empty." };
    const ax = excerpt ? arxivFromExcerpt(excerpt) : { title: null, authors: [], date: null };
    const title = ax.title ?? pageTitle;
    return {
      label: "read",
      answer: `Read ${charCount ?? "?"} characters from ${input.url ?? "the page"}${title ? `: “${title}”` : ""}.${excerpt ? ` ${excerpt}` : ""}`,
      data: { title, authors: ax.authors, abstract: null, date: ax.date, year: yearOf(ax.date), excerpt, charCount },
    };
  },
  "microlink-url-extraction": (result) => {
    const r = rec(result);
    const d = rec(r["data"] ?? r);
    const title = cleanTitle(str(d["title"]));
    const abstract = str(d["description"]);
    const author = str(d["author"]);
    const date = str(d["date"]);
    if (!title && !abstract) return { unusable: "no title or description came back in the page metadata." };
    return {
      label: "metadata",
      answer: `${title ?? "Untitled"}${author ? ` — ${author}` : ""}${date ? ` (${date.slice(0, 10)})` : ""}.${abstract ? ` ${abstract}` : ""}`,
      data: { title, authors: splitAuthors(author), abstract, date, year: yearOf(date), publisher: str(d["publisher"]), excerpt: null, charCount: null },
    };
  },
  livecert: (result) => {
    // An inline-text extractor: it fetches nothing, so a link question comes back as fields pulled from the question itself.
    const r = rec(result);
    const extracted = rec(r["extracted"]);
    const title = str(extracted["title"]);
    if (!title) return { unusable: "this extractor reads inline text and did not fetch the link." };
    return { label: str(r["verdict"]), confidence: toConfidence(r["confidence"]), answer: str(r["reason"]) ?? title, data: { title, authors: [], abstract: null, date: null, year: null, excerpt: null, charCount: null } };
  },
};

const AI_TEXT_DETECTION: Record<string, Reader> = {
  "caliber-truthport-text-auth": (result) => {
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
  livecert: (result) => {
    const r = rec(result);
    const label = str(r["verdict"]);
    if (!label || /no passage|not supplied|too short/i.test(str(r["reason"]) ?? "")) return { unusable: str(r["reason"]) ?? "no passage reached the miner." };
    return { label, confidence: toConfidence(r["confidence"]), answer: str(r["reason"]) ?? label, data: { label, pAi: null, model: "livecert statistics" } };
  },
  "veritarach-ai-text-detector": (result) => {
    const r = rec(result);
    const label = str(r["label"]) ?? str(r["verdict"]) ?? str(r["prediction"]);
    return { label, confidence: toConfidence(r["confidence"]), data: { label, pAi: null, model: "veritarach" } };
  },
};

const FRAUD_DETECTION: Record<string, Reader> = {
  "sarzops-transaction-risk": (result) => {
    const r = rec(result);
    const answer = str(r["signal"]) ?? str(r["explanation"]);
    if (!answer) return { unusable: "no signal in the fraud answer." };
    return { label: str(r["verdict"]), confidence: toConfidence(r["confidence"]), answer, data: { verdict: str(r["verdict"]), answer } };
  },
};

const FACT_CHECK: Record<string, Reader> = {
  "qarinah-proofpack": (result) => {
    const r = rec(result);
    const verdict = str(r["verdict"]);
    return {
      label: verdict,
      confidence: toConfidence(r["confidence"]),
      answer: str(r["answer"]) ?? str(r["reason"]) ?? verdict ?? "",
      data: { verdict, confidence: toConfidence(r["confidence"]), answer: str(r["answer"]) },
    };
  },
  livecert: (result) => {
    const r = rec(result);
    const verdict = str(r["verdict"]);
    return { label: verdict, confidence: toConfidence(r["confidence"]), answer: str(r["reason"]) ?? verdict ?? "", data: { verdict, answer: str(r["reason"]) } };
  },
  tavily: (result) => {
    const r = rec(result);
    const answer = str(r["answer"]);
    if (!answer) return { unusable: "the search returned no synthesised answer." };
    return { label: null, answer, data: { verdict: null, answer } };
  },
};

const ACADEMIC_SEARCH: Record<string, Reader> = {
  txlens: (result) => {
    const r = rec(result);
    const answer = str(r["summary"]) ?? str(r["answer"]) ?? "";
    const papers = papersFrom(result, answer);
    const mostCited = str(rec(r["most_cited"])["title"]);
    if (mostCited && !papers.includes(mostCited)) papers.unshift(mostCited);
    return { label: str(r["status"]), confidence: toConfidence(r["confidence"]), answer, data: { papers, totalMatches: r["total_matches"] ?? null, answer } };
  },
  livecert: (result) => {
    const r = rec(result);
    const answer = str(r["reason"]) ?? "";
    return { label: str(r["verdict"]), confidence: toConfidence(r["confidence"]), answer, data: { papers: papersFrom(result, answer), totalMatches: null, answer } };
  },
  "scholarwire-academic-search": (result) => {
    const r = rec(result);
    const answer = str(r["summary"]) ?? str(r["answer"]) ?? "";
    return { answer, data: { papers: papersFrom(result, answer), totalMatches: null, answer } };
  },
};

const LANGUAGE_TRANSLATION: Record<string, Reader> = {
  livecert: (result, input) => {
    const r = rec(result);
    const t = str(r["translation"]) ?? (str(r["verdict"]) === "translated" ? str(r["reason"]) : null);
    if (!t) return { unusable: str(r["reason"]) ?? "no translation came back." };
    return { label: "translated", confidence: toConfidence(r["confidence"]), answer: t, data: { translation: t, language: input.language?.name ?? null } };
  },
  "langwire-translation": (result, input) => {
    const r = rec(result);
    const t = str(r["translation"]);
    if (!t) return { unusable: str(r["summary"]) ?? "this miner does not support that language pair." };
    return { label: "translated", confidence: toConfidence(r["confidence"]), answer: t, data: { translation: t, language: input.language?.name ?? null } };
  },
  "mymemory-translate": (result, input) => {
    const r = rec(result);
    const t = str(getPath(r, "responseData.translatedText"));
    if (!t || /QUERY LENGTH|INVALID|NO QUERY|PLEASE SELECT/i.test(t)) return { unusable: t ?? "no translation came back." };
    return { label: "translated", confidence: toConfidence(getPath(r, "responseData.match")), answer: t, data: { translation: t, language: input.language?.name ?? null } };
  },
};
LANGUAGE_TRANSLATION["test-mymemory-translate"] = LANGUAGE_TRANSLATION["mymemory-translate"]!;

const NEWS_HEADLINES: Record<string, Reader> = {
  livecert: (result) => {
    const r = rec(result);
    const items = articlesOf(arr(r["headlines"]), (a) => ({ title: str(a["title"]) ?? "", source: str(a["source"]), url: str(a["url"]), published: str(a["published"]), description: null }));
    if (!items.length) return { unusable: "no headlines came back." };
    return { label: str(r["verdict"]), confidence: toConfidence(r["confidence"]), answer: listText(items), data: { items, category: str(r["topic"]), region: str(r["region"]) } };
  },
  "newswire-headlines": (result, input) => {
    const r = rec(result);
    const items = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(a["source"]), url: str(a["url"]), published: str(a["published_at"]), description: null }));
    if (!items.length) return { unusable: "no headlines came back." };
    return { label: "headlines", answer: listText(items), data: { items, category: input.category ?? null, region: input.region ?? null } };
  },
  newsapi: (result, input) => {
    const r = rec(result);
    const items = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(rec(a["source"])["name"]), url: str(a["url"]), published: str(a["publishedAt"]), description: str(a["description"]) }));
    if (!items.length) return { unusable: "no headlines came back." };
    return { label: "headlines", answer: listText(items), data: { items, category: input.category ?? null, region: input.region ?? null } };
  },
};

const NEWS_SEARCH: Record<string, Reader> = {
  "verity-news-search": (result) => {
    const r = rec(result);
    const articles = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(a["source"]), url: str(a["url"]), published: str(a["published_at"]), description: str(a["description"]) }));
    if (!articles.length) return { unusable: "no articles matched." };
    return { label: `${articles.length} articles`, confidence: toConfidence(r["confidence"]), answer: str(r["answer"]) ?? str(r["summary"]) ?? listText(articles), data: { articles, answer: str(r["answer"]) } };
  },
  tavily: (result) => {
    const r = rec(result);
    const articles = articlesOf(arr(r["results"]), (a) => ({ title: str(a["title"]) ?? "", source: null, url: str(a["url"]), published: str(a["published_date"]), description: str(a["content"])?.slice(0, 300) ?? null }));
    if (!articles.length && !str(r["answer"])) return { unusable: "no articles matched." };
    return { label: `${articles.length} articles`, answer: str(r["answer"]) ?? listText(articles), data: { articles, answer: str(r["answer"]) } };
  },
  gnews: (result) => {
    const r = rec(result);
    const articles = articlesOf(arr(r["articles"]), (a) => ({ title: str(a["title"]) ?? "", source: str(rec(a["source"])["name"]), url: str(a["url"]), published: str(a["publishedAt"]), description: str(a["description"]) }));
    if (!articles.length) return { unusable: "no articles matched." };
    return { label: `${articles.length} articles`, answer: listText(articles), data: { articles, answer: null } };
  },
  newsapi: NEWS_HEADLINES["newsapi"]!,
};

const CHAT_COMPLETION: Record<string, Reader> = {
  "groq-llama31-instant-miner": (result) => {
    const r = rec(result);
    const text = str(r["output"]) ?? str(getPath(r, "choices.0.message.content"));
    if (!text) return { unusable: "the model returned no text." };
    return { label: null, confidence: toConfidence(r["confidence"]), answer: text, data: { text } };
  },
  gemini: (result) => {
    const r = rec(result);
    const text = str(getPath(r, "choices.0.message.content")) ?? str(r["output"]);
    if (!text) return { unusable: "the model returned no text." };
    return { label: null, answer: text, data: { text } };
  },
};

export const READERS: Record<string, Record<string, Reader>> = {
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

/** The reader for what the router chose, by the intent it chose and the miner it picked. Null means "read generically". */
export function readerFor(intent: string | null, slug: string | null): Reader | null {
  if (!intent || !slug) return null;
  return READERS[intent]?.[slug] ?? null;
}

/**
 * Structured data for a step when the miner has no reader, built from the receipt's answer
 * text so the next steps still have something to work with.
 */
export function fallbackData(stepId: string, answer: string, parsedData: unknown): unknown {
  const d = rec(parsedData);
  switch (stepId) {
    case "brief":
      return { text: str(d["text"]) ?? answer };
    case "translate":
      return { translation: str(d["translation"]) ?? answer };
    case "search":
      return { articles: arr(d["articles"]), answer: str(d["answer"]) ?? answer };
    case "headlines":
      return { items: arr(d["items"]), answer };
    case "related":
      return { papers: arr(d["papers"]).length ? d["papers"] : titlesFromProse(answer), answer };
    default:
      return Object.keys(d).length ? d : { answer };
  }
}
