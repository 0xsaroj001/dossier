import { randomUUID } from "node:crypto";
import { fallbackData, readerFor, titlesFromProse, type Article, type Parsed, type StepInput } from "./adapters";
import { utcDay } from "./config";
import { checkAllowance, noteAttempt } from "./guard";
import { buildReceipt } from "./receipt";
import type { Store } from "./store";
import { askRouted, NodeError, payerAddress, rankOf, resolveMiner, type EngineResponse } from "./telegraph";
import type { Attempt, DossierSummary, LedgerRow, Mode, ParsedQuery, Receipt, StepId, StepResult, StepSpec } from "./types";

/**
 * One query becomes a fixed sequence of questions. Every question goes to Telegraph's own
 * router (POST /engine/v1/ask): the network classifies the intent and picks the miner; the
 * app never names one. Each step keeps the receipt and hands structured data to the steps
 * after it. A step has two phrasings: the second is sent only when the first was refused
 * for free, came back unusable, or was filed under an intent the step cannot use.
 */
export const RESEARCH_STEPS: StepSpec[] = [
  { id: "read", title: "Read the page", intent: "CONTENT_EXTRACTION", accept: ["CONTENT_EXTRACTION"], strict: true, needs: [], blurb: "Title, authors, date and identifier, read from the link by the miner the router picks." },
  { id: "abstract", title: "The abstract", intent: "CONTENT_EXTRACTION", accept: ["CONTENT_EXTRACTION"], strict: true, needs: [], blurb: "The abstract itself, extracted from the page." },
  { id: "authorship", title: "AI-text detection", intent: "AI_TEXT_DETECTION", accept: ["AI_TEXT_DETECTION", "TEXT_AUTHENTICITY_CHECK"], strict: true, needs: ["abstract"], blurb: "Was the abstract written by a person or a model?" },
  { id: "fraud", title: "Fraud and retraction record", intent: "FRAUD_DETECTION", accept: ["FRAUD_DETECTION"], strict: true, needs: ["read"], blurb: "Any documented misconduct, retraction, paper mill or predatory venue." },
  { id: "fact", title: "Fact-check the key claim", intent: "FACT_CHECK", accept: ["FACT_CHECK"], strict: true, needs: ["abstract"], blurb: "The abstract's main result, checked against live evidence." },
  {
    id: "provenance",
    title: "Provenance",
    intent: "CONTENT_VERIFICATION",
    accept: ["CONTENT_VERIFICATION", "ACADEMIC_SEARCH", "FACT_CHECK", "RESEARCH_QUERY", "RESEARCH_SYNTHESIS", "WEB_SEARCH"],
    needs: ["read"],
    blurb: "Does this paper exist as described? The router decides which intent answers that.",
  },
  { id: "related", title: "Related scholarship", intent: "ACADEMIC_SEARCH", accept: ["ACADEMIC_SEARCH", "RESEARCH_QUERY", "RESEARCH_SYNTHESIS"], needs: ["read"], blurb: "Peer-reviewed work on the same subject." },
  { id: "translate", title: "Translate the abstract", intent: "LANGUAGE_TRANSLATION", accept: ["LANGUAGE_TRANSLATION"], strict: true, needs: ["abstract"], optional: true, blurb: "The abstract in the language you asked for." },
];

export const NEWS_STEPS: StepSpec[] = [
  { id: "headlines", title: "Today's headlines", intent: "NEWS_HEADLINES", accept: ["NEWS_HEADLINES", "NEWS_SEARCH"], needs: [], blurb: "The top headlines right now, region-aware." },
  { id: "search", title: "Recent coverage", intent: "NEWS_SEARCH", accept: ["NEWS_SEARCH", "NEWS_HEADLINES", "WEB_SEARCH"], needs: [], blurb: "The last week's articles on the topic." },
  { id: "brief", title: "Briefing", intent: "CHAT_COMPLETION", accept: ["CHAT_COMPLETION", "TEXT_GENERATION", "LANGUAGE_GENERATION", "RESEARCH_SYNTHESIS"], needs: ["headlines", "search"], blurb: "A model writes the briefing from the material above and nothing else." },
  { id: "translate", title: "Translate the briefing", intent: "LANGUAGE_TRANSLATION", accept: ["LANGUAGE_TRANSLATION"], strict: true, needs: ["brief"], optional: true, blurb: "The briefing in the language you asked for." },
];

export function specsFor(mode: Mode): StepSpec[] {
  return mode === "research" ? RESEARCH_STEPS : NEWS_STEPS;
}

export function buildPlan(parsed: ParsedQuery): StepSpec[] {
  return specsFor(parsed.mode).filter((s) => !s.optional || parsed.language);
}

export type Context = Partial<Record<StepId, unknown>>;

interface Meta {
  title: string | null;
  authors: string[];
  abstract: string | null;
  date: string | null;
  year: string | null;
  excerpt: string | null;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((a): a is string => typeof a === "string") : []);

/** What the two extraction steps found, merged: either may carry the title, only one usually carries the abstract. */
export function metaOf(c: Context): Meta {
  const a = rec(c.read);
  const b = rec(c.abstract);
  const authors = strs(a["authors"]).length ? strs(a["authors"]) : strs(b["authors"]);
  return {
    title: str(a["title"]) ?? str(b["title"]),
    authors,
    abstract: str(b["abstract"]) ?? str(a["abstract"]),
    date: str(a["date"]) ?? str(b["date"]),
    year: str(a["year"]) ?? str(b["year"]),
    excerpt: str(a["excerpt"]) ?? str(b["excerpt"]),
  };
}

function articlesOf(v: unknown): Article[] {
  return Array.isArray(v) ? (v as Article[]).filter((a) => a && typeof a.title === "string") : [];
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Whole sentences up to `max` characters, so a translation never ends mid-thought. */
export function clipSentences(text: string, max = 700): { text: string; truncated: boolean } {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return { text: t, truncated: false };
  const parts = t.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    if ((out + " " + p).trim().length > max) break;
    out = (out + " " + p).trim();
  }
  return { text: out || t.slice(0, max), truncated: true };
}

const RESULT_WORDS = /\b(we (show|find|demonstrate|prove|achieve|report|establish|observe)|results? (show|indicate|suggest|demonstrate)|experiments? (show|demonstrate)|outperform|achiev(e|es|ed)|state-of-the-art|significantly|improv(e|es|ed|ing)|reduc(e|es|ed)|increas(e|es|ed))\b/i;
const PROPOSAL_WORDS = /\b(we (propose|present|introduce|describe|develop))\b/i;

/** The sentence a fact-checker should test: the abstract's result claim, else what it proposes, else its first full sentence. */
export function keySentence(abstract: string): string | null {
  const sentences = abstract.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim());
  const long = sentences.filter((s) => wordCount(s) >= 8);
  const pick = long.find((s) => RESULT_WORDS.test(s)) ?? long.find((s) => PROPOSAL_WORDS.test(s)) ?? long[0] ?? sentences[0] ?? null;
  return pick ? pick.slice(0, 400) : null;
}

function paperRef(title: string, authors: string[], year: string | null): string {
  const by = authors.length ? ` by ${authors.slice(0, 3).join(", ")}${authors.length > 3 ? " et al." : ""}` : "";
  return `“${title}”${by}${year ? ` (${year})` : ""}`;
}

/** The excerpt a page reader returns for arXiv is mostly navigation chrome; keep only what reads as prose. */
function proseOf(meta: Meta): string | null {
  if (meta.abstract) return meta.abstract;
  if (!meta.excerpt) return null;
  const cut = meta.excerpt.replace(/^.*?(?:Abstract:|View a PDF of the paper titled)/s, "").trim();
  return wordCount(cut) >= 40 ? cut : null;
}

const BRIEF_RULES =
  "You are a careful news analyst. Write a briefing of 120 to 180 words using only the material provided. Lead with what changed, name the source of each point in parentheses, and end with one line on what to watch next. If the material is thin or off-topic, say so plainly instead of inventing detail.";

export interface Derived {
  input: StepInput;
  /** Two wordings of the same question; the second is used only when the first does not deliver. */
  queries: [string, string];
  /** Structured hints merged into the routed request body by the node. */
  context?: Record<string, unknown>;
}

export function deriveInput(spec: StepSpec, parsed: ParsedQuery, context: Context): Derived | { skip: string } {
  const meta = metaOf(context);
  const title = meta.title;
  const authors = meta.authors;
  const year = meta.year;
  const url = parsed.url ?? "";
  const where = parsed.region ? ` in ${parsed.region}` : "";
  switch (spec.id) {
    case "read":
      return {
        input: { url },
        queries: [
          `Read the research paper page at ${url} and extract its full title, all authors, the publication date and the DOI or arXiv identifier.`,
          `Extract the title, the authors and the publication date from the web page ${url}.`,
        ],
        context: { url },
      };
    case "abstract":
      return {
        input: { url },
        queries: [`Extract the abstract of the research paper at ${url}.`, `What is the abstract of the paper at ${url}? Return the abstract paragraph.`],
        context: { url },
      };
    case "authorship": {
      const prose = proseOf(meta);
      if (!prose) return { skip: "No abstract was extracted, so there is no prose to analyse." };
      if (wordCount(prose) < 40) return { skip: "The page gave fewer than 40 words of prose; authorship statistics need more." };
      const text = prose.slice(0, 4000);
      return {
        input: { text },
        queries: [`Was the following passage written by an AI or by a human? Passage: ${text}`, `AI text detection: classify this passage as ai_generated or human_written. ${text}`],
        context: { text },
      };
    }
    case "fraud": {
      if (!title) return { skip: "No title was extracted, so there is nothing to look up." };
      const ref = paperRef(title, authors, year);
      return {
        input: { title, authors, year },
        queries: [
          `Is there any documented fraud, retraction, paper mill, plagiarism or predatory-publishing concern associated with the research paper ${ref}? Answer only with what is documented.`,
          `Fraud check: has the research paper ${ref} been retracted, or linked to research misconduct, a paper mill or a predatory journal?`,
        ],
      };
    }
    case "fact": {
      const prose = proseOf(meta);
      if (!title && !prose) return { skip: "No title or abstract was extracted, so there is no claim to check." };
      const sentence = prose ? keySentence(prose) : null;
      const claim = sentence
        ? `${sentence} (claim from the paper ${paperRef(title ?? "untitled", authors, year)})`
        : `The paper ${paperRef(title ?? "untitled", authors, year)} was published${year ? ` in ${year}` : ""} and is available at ${url}.`;
      return { input: { claim, title: title ?? undefined, authors, year }, queries: [`Is this claim true? ${claim}`, `Fact-check this statement with evidence: ${claim}`] };
    }
    case "provenance": {
      if (!title) return { skip: "No title was extracted, so provenance cannot be checked." };
      const ref = paperRef(title, authors, year);
      return {
        input: { title, authors, year, url, topic: title },
        queries: [
          `Verify that the research paper ${ref} at ${url} is genuine and unaltered: confirm it exists in the scholarly record with matching title, authors and year.`,
          `Search the academic literature for a paper titled “${title}”${authors.length ? ` by ${authors[0]}` : ""} and confirm that it exists.`,
        ],
      };
    }
    case "related": {
      const topic = title ?? (meta.abstract ? meta.abstract.split(/\s+/).slice(0, 12).join(" ") : null);
      if (!topic) return { skip: "No subject was extracted to search for." };
      return { input: { topic }, queries: [`Find peer-reviewed papers on the same subject as “${topic}”.`, `Search the scholarly literature for research on: ${topic}`] };
    }
    case "translate": {
      if (!parsed.language) return { skip: "No target language was asked for." };
      const brief = str(rec(context.brief)["text"]);
      const headlines = articlesOf(rec(context.headlines)["items"]).map((a) => a.title).join(". ");
      const source = parsed.mode === "research" ? proseOf(meta) : (brief ?? headlines);
      if (!source) return { skip: "There is no text to translate yet." };
      const text = clipSentences(source, 700).text;
      const lang = parsed.language;
      return {
        input: { text, language: lang, title: title ?? undefined },
        queries: [`Translate the following text into ${lang.name}: ${text}`, `Translate into ${lang.name} (${lang.code}): "${text}"`],
        // Hints for every translator shape on the leaderboard: text/target_language, text/to, q/langpair.
        context: { text, q: text, target_language: lang.name, to: lang.name, langpair: `en|${lang.code}` },
      };
    }
    case "headlines": {
      const topic = parsed.topic ?? "";
      const section = parsed.category ?? topic;
      return {
        input: { topic, category: parsed.category, region: parsed.region },
        queries: [`What are the top news headlines about ${topic}${where} today?`, `Top ${section} headlines${where} right now, as a list.`],
      };
    }
    case "search": {
      const topic = parsed.topic ?? "";
      return {
        input: { topic, region: parsed.region },
        queries: [`Find recent news articles from the last 7 days about ${topic}${where}.`, `Search the news for this week's coverage of ${topic}${where}.`],
      };
    }
    case "brief": {
      const items = articlesOf(rec(context.headlines)["items"]);
      const articles = articlesOf(rec(context.search)["articles"]);
      const searchAnswer = str(rec(context.search)["answer"]);
      if (!items.length && !articles.length && !searchAnswer) return { skip: "Neither headlines nor coverage came back, so there is nothing to brief on." };
      const lines: string[] = [`Topic: ${parsed.topic}${parsed.region ? ` (${parsed.region})` : ""}.`, `Reader's question: ${parsed.query}`];
      if (items.length) {
        lines.push("", `Top headlines${parsed.category ? ` in ${parsed.category}` : ""}:`);
        for (const a of items.slice(0, 8)) lines.push(`- ${a.title}${a.source ? ` (${a.source}${a.published ? `, ${a.published.slice(0, 10)}` : ""})` : ""}`);
      }
      if (articles.length || searchAnswer) {
        lines.push("", "Recent coverage:");
        if (searchAnswer) lines.push(`Summary from the search miner: ${searchAnswer.slice(0, 600)}`);
        for (const a of articles.slice(0, 6)) lines.push(`- ${a.title}${a.source ? ` (${a.source}${a.published ? `, ${a.published.slice(0, 16)}` : ""})` : ""}${a.description ? `: ${a.description.slice(0, 240)}` : ""}`);
      }
      const material = lines.join("\n").slice(0, 6000);
      const ask = `Write a news briefing of 120 to 180 words about ${parsed.topic}${where}, using only the material below. Name the source of each point in parentheses and end with one line on what to watch next.\n\n${material}`;
      return {
        input: { topic: parsed.topic ?? "" },
        queries: [ask, `Summarise the following news material about ${parsed.topic} into a 150-word briefing with sources named:\n\n${material}`],
        context: {
          messages: [
            { role: "system", content: BRIEF_RULES },
            { role: "user", content: material },
          ],
        },
      };
    }
    default:
      return { skip: "Unknown step." };
  }
}

export interface RunContext {
  store: Store;
  visitor: string;
  mode: Mode;
}

interface Outcome {
  receipt: Receipt;
  data: unknown;
}

function applyParsed(receipt: Receipt, parsed: Parsed): void {
  if (parsed.answer) receipt.answer = parsed.answer;
  if (parsed.label !== undefined) receipt.label = parsed.label ?? receipt.label;
  if (parsed.confidence !== undefined) receipt.confidence = parsed.confidence;
  if (parsed.confidenceNote !== undefined) receipt.confidenceNote = parsed.confidenceNote ?? receipt.confidenceNote;
}

function preview(parsed: ParsedQuery, spec: StepSpec): string {
  const subject = parsed.mode === "research" ? (parsed.url ?? "") : (parsed.topic ?? "");
  return `${spec.title}: ${subject}`.slice(0, 160);
}

function toNodeError(e: unknown): NodeError {
  return e instanceof NodeError ? e : new NodeError((e as Error).message ?? String(e), "network");
}

function humanError(err: NodeError): string {
  if (err.kind === "timeout") return "The network did not answer in time. If the call lands late it will settle on chain without a ledger row.";
  if (err.kind === "unpaid") return "The payment was not accepted, so nothing was asked and nothing was charged.";
  if (err.status !== null && err.status >= 500) return "The miner the router chose failed on its side; failed calls are not charged.";
  return err.message;
}

async function record(ctx: RunContext, parsed: ParsedQuery, spec: StepSpec, fields: Partial<LedgerRow> & { status: LedgerRow["status"] }): Promise<void> {
  const now = new Date();
  const row: LedgerRow = {
    id: randomUUID(),
    at: now.toISOString(),
    day: utcDay(now),
    visitor: ctx.visitor,
    mode: ctx.mode,
    step: spec.id,
    intent: spec.intent,
    routerIntent: null,
    minerSlug: null,
    minerId: null,
    minerRank: null,
    endpoint: null,
    confidence: null,
    costUsd: null,
    durationMs: null,
    signalHash: null,
    settlementTx: null,
    error: null,
    preview: preview(parsed, spec),
    ...fields,
  };
  try {
    await ctx.store.addRow(row);
  } catch (e) {
    console.error("ledger write failed:", (e as Error).message);
  }
}

function rowFromReceipt(r: Receipt): Partial<LedgerRow> {
  return {
    routerIntent: r.routerIntent,
    minerSlug: r.minerSlug,
    minerId: r.minerId,
    minerRank: r.minerRank,
    endpoint: r.endpoint,
    confidence: r.confidence,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    signalHash: r.signalHash,
    settlementTx: r.settlementTx,
  };
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Post-processing that needs the step's own input, such as matching the paper's title in a provenance answer. */
function finish(spec: StepSpec, out: Outcome, input: StepInput): Outcome {
  if (spec.id !== "provenance") return out;
  const data = rec(out.data);
  let found: boolean | null = null;
  const label = (out.receipt.label ?? "").toUpperCase();
  if (out.receipt.routerIntent === "FACT_CHECK" || /SUPPORTED|REFUTED|INSUFFICIENT/.test(label)) {
    found = /SUPPORTED|TRUE|VERIFIED/.test(label) ? true : /REFUTED|FALSE/.test(label) ? false : null;
  } else if (input.title) {
    const want = normTitle(input.title);
    const titles = (strs(data["papers"]).length ? strs(data["papers"]) : titlesFromProse(out.receipt.answer)).map(normTitle);
    const haystack = normTitle(out.receipt.answer);
    found = titles.some((t) => t.includes(want) || want.includes(t)) || haystack.includes(want) ? true : titles.length > 0 ? false : null;
  }
  return { receipt: out.receipt, data: { ...data, found, answer: data["answer"] ?? out.receipt.answer } };
}

/** Ask the router once and read what came back. Returns the outcome and how it should be judged. */
async function askOnce(
  spec: StepSpec,
  parsed: ParsedQuery,
  derived: Derived,
  phrasing: 1 | 2,
  ctx: RunContext,
  attempts: Attempt[],
): Promise<{ outcome: Outcome | null; usable: boolean; accepted: boolean; error: NodeError | null }> {
  const query = phrasing === 1 ? derived.queries[0] : derived.queries[1];
  const started = Date.now();
  await noteAttempt(ctx.store, ctx.visitor);
  let raw: EngineResponse;
  try {
    raw = await askRouted(query, derived.context);
  } catch (e) {
    const err = toNodeError(e);
    const status: LedgerRow["status"] = err.kind === "timeout" ? "timeout" : err.kind === "unpaid" ? "unpaid" : "error";
    await record(ctx, parsed, spec, { status, error: err.message.slice(0, 300), durationMs: Date.now() - started });
    attempts.push({ phrasing, minerSlug: "telegraph-router", minerRank: null, intent: null, outcome: status, durationMs: Date.now() - started, costUsd: null, note: humanError(err) });
    return { outcome: null, usable: false, accepted: false, error: err };
  }
  const miner = await resolveMiner({ id: raw.miner_id ?? null, name: raw.miner_name ?? null }).catch(() => null);
  const intent = raw.intent ?? null;
  const rank = rankOf(miner, intent);
  const receipt = buildReceipt(raw, { intent: intent ?? spec.intent, miner, rank, routerIntent: intent, reasoning: raw.reasoning ?? null, endpoint: raw.endpoint ?? null, payer: payerAddress() });
  const reader = readerFor(intent, receipt.minerSlug);
  const parsedOut: Parsed = reader ? reader(raw.result, derived.input) : {};
  applyParsed(receipt, parsedOut);
  const usable = !parsedOut.unusable;
  const accepted = intent !== null && spec.accept.includes(intent);
  await record(ctx, parsed, spec, { status: usable ? "ok" : "unusable", ...rowFromReceipt(receipt), error: usable ? null : (parsedOut.unusable ?? null) });
  const who = `${receipt.minerSlug ?? "a miner"}${rank ? ` (#${rank} for ${intent})` : ""}`;
  attempts.push({
    phrasing,
    minerSlug: receipt.minerSlug ?? "unknown",
    minerRank: rank,
    intent,
    outcome: !usable ? "unusable" : accepted ? "ok" : "off-target",
    durationMs: receipt.durationMs ?? Date.now() - started,
    costUsd: receipt.costUsd,
    note: !usable
      ? `The router sent this to ${who} as ${intent ?? "?"}; it answered, but ${parsedOut.unusable}`
      : accepted
        ? null
        : `The router filed this under ${intent ?? "an unknown intent"} and ${who} answered.`,
  });
  const data = parsedOut.data ?? fallbackData(spec.id, receipt.answer, undefined);
  return { outcome: { receipt, data }, usable, accepted, error: null };
}

export async function runStep(spec: StepSpec, parsed: ParsedQuery, context: Context, ctx: RunContext): Promise<StepResult> {
  const base = { id: spec.id, title: spec.title, intent: spec.intent };
  const derived = deriveInput(spec, parsed, context);
  if ("skip" in derived) return { ...base, status: "skipped", receipt: null, data: null, error: derived.skip, attempts: [] };
  const attempts: Attempt[] = [];
  let offTarget: Outcome | null = null;
  let lastError = "The network could not serve this step.";
  try {
    for (const phrasing of [1, 2] as const) {
      const allowance = await checkAllowance(ctx.store, ctx.visitor);
      if (!allowance.ok) {
        if (phrasing === 1) return { ...base, status: "error", receipt: null, data: null, error: allowance.reason, attempts };
        lastError = allowance.reason ?? lastError;
        break;
      }
      const r = await askOnce(spec, parsed, derived, phrasing, ctx, attempts);
      if (r.error) {
        lastError = humanError(r.error);
        // A timeout has an unknown outcome and the call may still settle; never send the question again.
        if (r.error.kind === "timeout") break;
        continue;
      }
      if (r.outcome && r.usable && r.accepted) {
        const done = finish(spec, r.outcome, derived.input);
        return { ...base, status: "ok", receipt: done.receipt, data: done.data, error: null, attempts };
      }
      if (r.outcome && r.usable && !r.accepted && !spec.strict && !offTarget) offTarget = r.outcome;
      lastError = r.usable ? `The router filed this under ${r.outcome?.receipt.routerIntent ?? "another intent"} both times, so no ${spec.intent} miner answered.` : (attempts[attempts.length - 1]?.note ?? lastError);
    }
    if (offTarget) {
      offTarget.receipt.routerReasoning = `Filed under ${offTarget.receipt.routerIntent ?? "another intent"} rather than ${spec.intent}. ${offTarget.receipt.routerReasoning ?? ""}`.trim();
      const done = finish(spec, offTarget, derived.input);
      return { ...base, status: "ok", receipt: done.receipt, data: done.data, error: null, attempts };
    }
    return { ...base, status: "error", receipt: null, data: null, error: lastError, attempts };
  } catch (e) {
    const err = toNodeError(e);
    return { ...base, status: "error", receipt: null, data: null, error: err.message, attempts };
  }
}

function pct(n: number | null | undefined): string {
  return typeof n === "number" ? `${Math.round(n * 100)}%` : "n/a";
}

export function summarize(parsed: ParsedQuery, steps: StepResult[]): DossierSummary {
  const ok = steps.filter((s) => s.status === "ok" && s.receipt);
  const calls = steps.reduce((n, s) => n + s.attempts.length, 0);
  const costUsd = Number(steps.reduce((n, s) => n + s.attempts.reduce((m, a) => m + (a.costUsd ?? 0), 0), 0).toFixed(4));
  const intents = [...new Set(ok.map((s) => s.receipt?.routerIntent ?? s.receipt?.intent ?? s.intent))];
  const miners = [...new Set(ok.map((s) => s.receipt?.minerSlug).filter((m): m is string => Boolean(m)))];
  const lines: string[] = [];
  const by = (id: StepId) => steps.find((s) => s.id === id);
  const d = (id: StepId) => rec(by(id)?.data);
  const via = (s: StepResult | undefined) => `${s?.receipt?.minerSlug ?? "?"}, routed as ${s?.receipt?.routerIntent ?? s?.intent}`;
  if (parsed.mode === "research") {
    const meta = metaOf({ read: by("read")?.data, abstract: by("abstract")?.data });
    if (meta.title) lines.push(`Paper: ${meta.title}${meta.authors.length ? ` — ${meta.authors.slice(0, 3).join(", ")}` : ""}${meta.year ? ` (${meta.year})` : ""}.`);
    if (by("abstract")?.status === "ok" && !meta.abstract) lines.push("The abstract itself was not obtained; later steps worked from the page excerpt or the title.");
    const au = by("authorship");
    if (au?.status === "ok") lines.push(`Authorship: ${au.receipt?.label ?? "no verdict"} (${via(au)}, ${pct(au.receipt?.confidence)} for that label).`);
    const fr = by("fraud");
    if (fr?.status === "ok") lines.push(`Fraud record: ${fr.receipt?.label ?? "see answer"} (${via(fr)}).`);
    const fc = by("fact");
    if (fc?.status === "ok") lines.push(`Key claim: ${fc.receipt?.label ?? "no verdict"} (${via(fc)}, ${pct(fc.receipt?.confidence)}).`);
    const pv = by("provenance");
    if (pv?.status === "ok") {
      const found = d("provenance")["found"];
      lines.push(`Provenance: ${found === true ? "found in the scholarly record" : found === false ? "not found under that title" : "checked, no title match possible"} (${via(pv)}).`);
    }
    const rl = by("related");
    if (rl?.status === "ok") lines.push(`Related work: ${strs(d("related")["papers"]).length || "some"} papers (${via(rl)}).`);
  } else {
    const hl = by("headlines");
    if (hl?.status === "ok") lines.push(`${articlesOf(d("headlines")["items"]).length} headlines (${via(hl)}).`);
    const se = by("search");
    if (se?.status === "ok") lines.push(`${articlesOf(d("search")["articles"]).length} recent articles (${via(se)}).`);
    const br = by("brief");
    if (br?.status === "ok") lines.push(`Briefing written by ${via(br)}.`);
  }
  const tr = by("translate");
  if (tr?.status === "ok") lines.push(`Translated into ${parsed.language?.name ?? "the requested language"} (${via(tr)}).`);
  for (const s of steps) if (s.status === "error") lines.push(`${s.title}: ${s.error}`);
  return { calls, okSteps: ok.length, costUsd, intents, miners, lines };
}
