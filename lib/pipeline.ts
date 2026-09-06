import { randomUUID } from "node:crypto";
import { adapterFor, titlesFromProse, type Adapter, type Article, type Parsed, type StepInput } from "./adapters";
import { config, utcDay } from "./config";
import { checkAllowance, noteAttempt } from "./guard";
import { buildReceipt } from "./receipt";
import type { Store } from "./store";
import { askDirect, askRouted, NodeError, payerAddress, rankOf, rankedFor, resolveMiner, type DirectRequest, type EngineResponse, type Miner } from "./telegraph";
import type { Attempt, DossierSummary, Intent, LedgerRow, Mode, ParsedQuery, Receipt, StepId, StepResult, StepSpec } from "./types";

/**
 * One query becomes a fixed sequence of intents. Each step asks the network once, keeps the
 * receipt, and hands structured data to the steps after it. Telegraph's own router is used
 * where the question is open-ended; the best-ranked miner is called directly where the
 * input must arrive exactly as given (a passage to classify, a text to translate).
 */
export const RESEARCH_STEPS: StepSpec[] = [
  { id: "read", title: "Read the page", intent: "CONTENT_EXTRACTION", route: "direct", needs: [], blurb: "A miner fetches the link and reports what is there." },
  { id: "metadata", title: "Bibliographic record", intent: "CONTENT_EXTRACTION", route: "direct", needs: [], blurb: "Title, authors, abstract and date, pulled from the page's own metadata." },
  { id: "authorship", title: "AI-text detection", intent: "AI_TEXT_DETECTION", route: "direct", needs: ["metadata"], blurb: "Was the abstract written by a person or a model?" },
  { id: "fraud", title: "Fraud and retraction record", intent: "FRAUD_DETECTION", route: "direct", needs: ["metadata"], blurb: "Any documented misconduct, retraction, paper mill or predatory venue." },
  { id: "fact", title: "Fact-check the key claim", intent: "FACT_CHECK", route: "direct", needs: ["metadata"], blurb: "The abstract's main result, checked against live evidence." },
  {
    id: "provenance",
    title: "Provenance, router-dispatched",
    intent: "CONTENT_VERIFICATION",
    route: "engine",
    fallbackIntent: "ACADEMIC_SEARCH",
    acceptIntents: ["CONTENT_VERIFICATION", "ACADEMIC_SEARCH", "FACT_CHECK", "RESEARCH_QUERY", "RESEARCH_SYNTHESIS", "WEB_SEARCH"],
    needs: ["metadata"],
    blurb: "Telegraph's router decides which intent verifies that this paper exists as described.",
  },
  { id: "related", title: "Related scholarship", intent: "ACADEMIC_SEARCH", route: "direct", needs: ["metadata"], blurb: "Peer-reviewed work on the same subject, from OpenAlex and Crossref." },
  { id: "translate", title: "Translate the abstract", intent: "LANGUAGE_TRANSLATION", route: "direct", needs: ["metadata"], optional: true, blurb: "The abstract in the language you asked for." },
];

export const NEWS_STEPS: StepSpec[] = [
  { id: "headlines", title: "Today's headlines", intent: "NEWS_HEADLINES", route: "direct", needs: [], blurb: "The section's top headlines right now, region-aware." },
  {
    id: "search",
    title: "Recent coverage, router-dispatched",
    intent: "NEWS_SEARCH",
    route: "engine",
    fallbackIntent: "NEWS_SEARCH",
    acceptIntents: ["NEWS_SEARCH", "NEWS_HEADLINES", "WEB_SEARCH"],
    needs: [],
    blurb: "Telegraph's router picks the miner that finds the last week's articles.",
  },
  { id: "brief", title: "Briefing", intent: "CHAT_COMPLETION", route: "direct", needs: ["headlines", "search"], blurb: "A model writes the briefing from the material above and nothing else." },
  { id: "translate", title: "Translate the briefing", intent: "LANGUAGE_TRANSLATION", route: "direct", needs: ["brief"], optional: true, blurb: "The briefing in the language you asked for." },
];

export function specsFor(mode: Mode): StepSpec[] {
  return mode === "research" ? RESEARCH_STEPS : NEWS_STEPS;
}

export function buildPlan(parsed: ParsedQuery): StepSpec[] {
  return specsFor(parsed.mode).filter((s) => !s.optional || parsed.language);
}

export type Context = Partial<Record<StepId, unknown>>;

interface ReadData {
  title: string | null;
  excerpt: string | null;
  charCount: number | null;
}
interface MetaData {
  title: string | null;
  authors: string[];
  abstract: string | null;
  date: string | null;
  year: string | null;
}
interface HeadlinesData {
  items: Article[];
  category: string | null;
  region: string | null;
}
interface SearchData {
  articles: Article[];
  answer: string | null;
}
interface BriefData {
  text: string;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function readOf(c: Context): ReadData | null {
  const r = rec(c.read);
  return c.read ? { title: str(r["title"]), excerpt: str(r["excerpt"]), charCount: typeof r["charCount"] === "number" ? r["charCount"] : null } : null;
}

function metaOf(c: Context): MetaData | null {
  const r = rec(c.metadata);
  if (!c.metadata) return null;
  return {
    title: str(r["title"]),
    authors: Array.isArray(r["authors"]) ? (r["authors"] as unknown[]).filter((a): a is string => typeof a === "string") : [],
    abstract: str(r["abstract"]),
    date: str(r["date"]),
    year: str(r["year"]),
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

const MATERIAL_NOTE = "You are a careful news analyst. Write a briefing of 120 to 180 words using only the material provided. Lead with what changed, name the source of each point in parentheses, and end with one line on what to watch next. If the material is thin or off-topic, say so plainly instead of inventing detail.";

export function deriveInput(spec: StepSpec, parsed: ParsedQuery, context: Context): { input: StepInput } | { skip: string } {
  const read = readOf(context);
  const meta = metaOf(context);
  const title = meta?.title ?? read?.title ?? null;
  const authors = meta?.authors ?? [];
  const year = meta?.year ?? null;
  const prose = meta?.abstract ?? read?.excerpt ?? null;
  switch (spec.id) {
    case "read":
      return { input: { url: parsed.url ?? "", question: "Extract the full title, all authors, the abstract, the publication date and the DOI or arXiv identifier of this research paper." } };
    case "metadata":
      return { input: { url: parsed.url ?? "" } };
    case "authorship": {
      if (!prose) return { skip: "Nothing was read from the page, so there is no prose to analyse." };
      if (wordCount(prose) < 40) return { skip: "The page gave fewer than 40 words of prose; authorship statistics need more." };
      return { input: { text: prose.slice(0, 6000) } };
    }
    case "fraud": {
      if (!title) return { skip: "No title was extracted, so there is nothing to look up." };
      return {
        input: {
          title,
          authors,
          year,
          question: `Is there any documented fraud, retraction, paper mill, plagiarism or predatory-publishing concern associated with the research paper ${paperRef(title, authors, year)}? Answer only with what is documented.`,
        },
      };
    }
    case "fact": {
      if (!title && !prose) return { skip: "No title or abstract was extracted, so there is no claim to check." };
      const sentence = prose ? keySentence(prose) : null;
      const claim = sentence
        ? `${sentence} (claim from the paper ${paperRef(title ?? "untitled", authors, year)})`
        : `The paper ${paperRef(title ?? "untitled", authors, year)} was published${year ? ` in ${year}` : ""} and is available at ${parsed.url}.`;
      return { input: { claim, title: title ?? undefined, authors, year } };
    }
    case "provenance": {
      if (!title) return { skip: "No title was extracted, so provenance cannot be checked." };
      return { input: { title, authors, year, url: parsed.url ?? "", topic: title } };
    }
    case "related": {
      const topic = title ?? (prose ? prose.split(/\s+/).slice(0, 12).join(" ") : null);
      if (!topic) return { skip: "No subject was extracted to search for." };
      return { input: { topic } };
    }
    case "translate": {
      if (!parsed.language) return { skip: "No target language was asked for." };
      const brief = str(rec(context.brief)["text"]);
      const headlines = articlesOf(rec(context.headlines)["items"]).map((a) => a.title).join(". ");
      const source = parsed.mode === "research" ? prose : (brief ?? headlines);
      if (!source) return { skip: "There is no text to translate yet." };
      const clipped = clipSentences(source, 700);
      return { input: { text: clipped.text, language: parsed.language, title: title ?? undefined } };
    }
    case "headlines":
      return { input: { topic: parsed.topic ?? "", category: parsed.category, region: parsed.region } };
    case "search":
      return { input: { topic: parsed.topic ?? "", region: parsed.region, question: `Find recent news articles from the last 7 days about ${parsed.topic}${parsed.region ? ` in ${parsed.region}` : ""}.` } };
    case "brief": {
      const items = articlesOf(rec(context.headlines)["items"]);
      const articles = articlesOf(rec(context.search)["articles"]);
      const searchAnswer = str(rec(context.search)["answer"]);
      if (!items.length && !articles.length && !searchAnswer) return { skip: "Neither headlines nor coverage came back, so there is nothing to brief on." };
      const lines: string[] = [];
      lines.push(`Topic: ${parsed.topic}${parsed.region ? ` (${parsed.region})` : ""}.`);
      lines.push(`Reader's question: ${parsed.query}`);
      if (items.length) {
        lines.push("", `Top headlines${parsed.category ? ` in ${parsed.category}` : ""}:`);
        for (const a of items.slice(0, 8)) lines.push(`- ${a.title}${a.source ? ` (${a.source}${a.published ? `, ${a.published.slice(0, 10)}` : ""})` : ""}`);
      }
      if (articles.length || searchAnswer) {
        lines.push("", "Recent coverage:");
        if (searchAnswer) lines.push(`Summary from the search miner: ${searchAnswer.slice(0, 600)}`);
        for (const a of articles.slice(0, 6)) lines.push(`- ${a.title}${a.source ? ` (${a.source}${a.published ? `, ${a.published.slice(0, 16)}` : ""})` : ""}${a.description ? `: ${a.description.slice(0, 240)}` : ""}`);
      }
      return {
        input: {
          messages: [
            { role: "system", content: MATERIAL_NOTE },
            { role: "user", content: lines.join("\n").slice(0, 7000) },
          ],
        },
      };
    }
    default:
      return { skip: "Unknown step." };
  }
}

export function routerQuery(spec: StepSpec, input: StepInput): string {
  if (spec.id === "provenance") {
    const ref = paperRef(input.title ?? "untitled", input.authors ?? [], input.year ?? null);
    return `Is the research paper ${ref} at ${input.url} genuine and unaltered? Confirm it exists in the scholarly record with matching title, authors and year.`;
  }
  return input.question ?? input.claim ?? input.text ?? input.topic ?? "";
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

function statusOf(err: NodeError): LedgerRow["status"] {
  return err.kind === "timeout" ? "timeout" : err.kind === "unpaid" ? "unpaid" : "error";
}

function outcomeOf(err: NodeError): Attempt["outcome"] {
  return err.kind === "timeout" ? "timeout" : err.kind === "unpaid" ? "unpaid" : "error";
}

/** A refused payment settles nothing, so one more try after a short pause is safe. */
async function callWithRetry(minerId: string, req: DirectRequest): Promise<EngineResponse> {
  try {
    return await askDirect(minerId, req);
  } catch (e) {
    const err = toNodeError(e);
    if (err.kind !== "unpaid" || err.status === 402) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return askDirect(minerId, req);
  }
}

function humanError(err: NodeError, slug: string): string {
  if (err.kind === "timeout") return `${slug} did not answer in time.`;
  if (err.kind === "unpaid") return `The payment for ${slug} was not accepted, so nothing was asked and nothing was charged.`;
  if (err.status === 422) return `The node predicted ${slug} would fail and refused for free.`;
  if (err.status !== null && err.status >= 500) return `${slug} failed on its side; failed calls are not charged.`;
  return `${slug}: ${err.message}`;
}

async function record(ctx: RunContext, parsed: ParsedQuery, spec: StepSpec, fields: Partial<LedgerRow> & { intent: string; status: LedgerRow["status"]; routedBy: "engine" | "app" }): Promise<void> {
  const now = new Date();
  const row: LedgerRow = {
    id: randomUUID(),
    at: now.toISOString(),
    day: utcDay(now),
    visitor: ctx.visitor,
    mode: ctx.mode,
    step: spec.id,
    minerSlug: null,
    minerId: null,
    minerRank: null,
    routerIntent: null,
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
    minerSlug: r.minerSlug,
    minerId: r.minerId,
    minerRank: r.minerRank,
    routerIntent: r.routerIntent,
    endpoint: r.endpoint,
    confidence: r.confidence,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    signalHash: r.signalHash,
    settlementTx: r.settlementTx,
  };
}

async function tryRouter(spec: StepSpec, parsed: ParsedQuery, input: StepInput, ctx: RunContext, attempts: Attempt[]): Promise<Outcome | null> {
  const q = routerQuery(spec, input);
  const started = Date.now();
  await noteAttempt(ctx.store, ctx.visitor);
  try {
    const raw = await askRouted(q);
    const miner = await resolveMiner({ id: raw.miner_id ?? null, name: raw.miner_name ?? null }).catch(() => null);
    const intent = raw.intent ?? null;
    const rank = rankOf(miner, intent);
    const receipt = buildReceipt(raw, {
      intent: intent ?? spec.intent,
      miner,
      rank,
      routedBy: "engine",
      routerIntent: intent,
      reasoning: raw.reasoning ?? null,
      endpoint: raw.endpoint ?? null,
      payer: payerAddress(),
    });
    const adapter: Adapter | null = miner ? adapterFor(intent ?? spec.intent, miner) : null;
    const parsedOut: Parsed = adapter?.parse ? adapter.parse(raw.result, input) : {};
    applyParsed(receipt, parsedOut);
    const accepted = !spec.acceptIntents || (intent !== null && spec.acceptIntents.includes(intent));
    const usable = !parsedOut.unusable;
    await record(ctx, parsed, spec, { intent: intent ?? spec.intent, status: usable ? "ok" : "unusable", routedBy: "engine", ...rowFromReceipt(receipt), error: usable ? null : (parsedOut.unusable ?? null) });
    attempts.push({
      minerSlug: receipt.minerSlug ?? "telegraph-router",
      minerRank: rank,
      routedBy: "engine",
      outcome: !usable ? "unusable" : accepted ? "ok" : "off-target",
      durationMs: receipt.durationMs ?? Date.now() - started,
      costUsd: receipt.costUsd,
      note: !usable
        ? `The router sent this to ${receipt.minerSlug ?? "a miner"} (${intent ?? "?"}), which answered but ${parsedOut.unusable}`
        : accepted
          ? null
          : `The router classified this as ${intent ?? "an unknown intent"} and ${receipt.minerSlug ?? "a miner"} answered; the app then asked ${spec.fallbackIntent ?? spec.intent} directly.`,
    });
    if (accepted && usable) return { receipt, data: parsedOut.data ?? { answer: receipt.answer } };
    return null;
  } catch (e) {
    const err = toNodeError(e);
    await record(ctx, parsed, spec, { intent: spec.intent, status: statusOf(err), routedBy: "engine", error: err.message.slice(0, 300), durationMs: Date.now() - started });
    attempts.push({ minerSlug: "telegraph-router", minerRank: null, routedBy: "engine", outcome: outcomeOf(err), durationMs: Date.now() - started, costUsd: null, note: humanError(err, "the router") });
    return null;
  }
}

async function direct(spec: StepSpec, intent: Intent, parsed: ParsedQuery, input: StepInput, ctx: RunContext, attempts: Attempt[]): Promise<Outcome | { error: string }> {
  const ranked = await rankedFor(intent);
  const candidates = ranked
    .map((c) => ({ ...c, adapter: adapterFor(intent, c.miner) }))
    .filter((c) => c.adapter.build(input, c.miner) !== null)
    .slice(0, 4);
  if (candidates.length === 0) return { error: `No active miner serves ${intent} with this input right now (${ranked.length} listed for the intent).` };
  let lastError = "No miner could take this step.";
  for (const c of candidates) {
    if (attempts.length > 0) {
      const a = await checkAllowance(ctx.store, ctx.visitor);
      if (!a.ok) {
        lastError = a.reason ?? "Not allowed.";
        break;
      }
    }
    const req = c.adapter.build(input, c.miner) as DirectRequest;
    await noteAttempt(ctx.store, ctx.visitor);
    const started = Date.now();
    let raw: EngineResponse;
    try {
      raw = await callWithRetry(c.miner.id, req);
    } catch (e) {
      const err = toNodeError(e);
      await record(ctx, parsed, spec, {
        intent,
        status: statusOf(err),
        routedBy: "app",
        minerSlug: c.miner.slug,
        minerId: c.miner.id,
        minerRank: c.rank,
        endpoint: req.endpoint,
        error: err.message.slice(0, 300),
        durationMs: Date.now() - started,
      });
      attempts.push({ minerSlug: c.miner.slug, minerRank: c.rank, routedBy: "app", outcome: outcomeOf(err), durationMs: Date.now() - started, costUsd: null, note: humanError(err, c.miner.slug) });
      lastError = humanError(err, c.miner.slug);
      continue;
    }
    const receipt = buildReceipt(raw, { intent, miner: c.miner, rank: c.rank, routedBy: "app", endpoint: req.endpoint, payer: payerAddress() });
    receipt.minerSlug = c.miner.slug;
    receipt.routerReasoning = `The app called ${c.miner.slug}, ranked #${c.rank ?? "?"} for ${intent}, directly.`;
    const parsedOut: Parsed = c.adapter.parse ? c.adapter.parse(raw.result, input) : {};
    applyParsed(receipt, parsedOut);
    if (parsedOut.unusable) {
      await record(ctx, parsed, spec, { intent, status: "unusable", routedBy: "app", ...rowFromReceipt(receipt), error: parsedOut.unusable.slice(0, 300) });
      attempts.push({ minerSlug: c.miner.slug, minerRank: c.rank, routedBy: "app", outcome: "unusable", durationMs: receipt.durationMs, costUsd: receipt.costUsd, note: `${c.miner.slug} answered, but ${parsedOut.unusable}` });
      lastError = `${c.miner.slug} answered, but ${parsedOut.unusable}`;
      continue;
    }
    await record(ctx, parsed, spec, { intent, status: "ok", routedBy: "app", ...rowFromReceipt(receipt) });
    attempts.push({ minerSlug: c.miner.slug, minerRank: c.rank, routedBy: "app", outcome: "ok", durationMs: receipt.durationMs, costUsd: receipt.costUsd, note: null });
    return { receipt, data: parsedOut.data ?? { answer: receipt.answer } };
  }
  return { error: lastError };
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
    const titles = (Array.isArray(data["papers"]) ? (data["papers"] as unknown[]).filter((t): t is string => typeof t === "string") : titlesFromProse(out.receipt.answer)).map(normTitle);
    const haystack = normTitle(out.receipt.answer);
    found = titles.some((t) => t.includes(want) || want.includes(t)) || haystack.includes(want) ? true : titles.length > 0 ? false : null;
  }
  return { receipt: out.receipt, data: { ...data, found, answer: data["answer"] ?? out.receipt.answer } };
}

export async function runStep(spec: StepSpec, parsed: ParsedQuery, context: Context, ctx: RunContext): Promise<StepResult> {
  const base = { id: spec.id, title: spec.title, intent: spec.intent };
  const derived = deriveInput(spec, parsed, context);
  if ("skip" in derived) return { ...base, status: "skipped", receipt: null, data: null, error: derived.skip, attempts: [] };
  const allowance = await checkAllowance(ctx.store, ctx.visitor);
  if (!allowance.ok) return { ...base, status: "error", receipt: null, data: null, error: allowance.reason, attempts: [] };
  const input = derived.input;
  const attempts: Attempt[] = [];
  try {
    if (spec.route === "engine") {
      const viaRouter = await tryRouter(spec, parsed, input, ctx, attempts);
      if (viaRouter) {
        const done = finish(spec, viaRouter, input);
        return { ...base, status: "ok", receipt: done.receipt, data: done.data, error: null, attempts };
      }
    }
    const intent = spec.route === "engine" ? (spec.fallbackIntent ?? spec.intent) : spec.intent;
    const out = await direct(spec, intent, parsed, input, ctx, attempts);
    if ("error" in out) return { ...base, status: "error", receipt: null, data: null, error: out.error, attempts };
    const done = finish(spec, out, input);
    return { ...base, status: "ok", receipt: done.receipt, data: done.data, error: null, attempts };
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
  const intents = [...new Set(ok.map((s) => s.receipt?.intent ?? s.intent))];
  const miners = [...new Set(ok.map((s) => s.receipt?.minerSlug).filter((m): m is string => Boolean(m)))];
  const lines: string[] = [];
  const by = (id: StepId) => steps.find((s) => s.id === id);
  const d = (id: StepId) => rec(by(id)?.data);
  if (parsed.mode === "research") {
    const meta = d("metadata");
    const title = str(meta["title"]) ?? str(d("read")["title"]);
    if (title) lines.push(`Paper: ${title}${Array.isArray(meta["authors"]) && (meta["authors"] as string[]).length ? ` — ${(meta["authors"] as string[]).slice(0, 3).join(", ")}` : ""}${str(meta["year"]) ? ` (${meta["year"]})` : ""}.`);
    const au = by("authorship");
    if (au?.status === "ok") lines.push(`Authorship: ${au.receipt?.label ?? "no verdict"} (${au.receipt?.minerSlug}, ${pct(au.receipt?.confidence)} for that label).`);
    const fr = by("fraud");
    if (fr?.status === "ok") lines.push(`Fraud record: ${fr.receipt?.label ?? "see answer"} (${fr.receipt?.minerSlug}).`);
    const fc = by("fact");
    if (fc?.status === "ok") lines.push(`Key claim: ${fc.receipt?.label ?? "no verdict"} (${fc.receipt?.minerSlug}, ${pct(fc.receipt?.confidence)}).`);
    const pv = by("provenance");
    if (pv?.status === "ok") {
      const found = d("provenance")["found"];
      lines.push(`Provenance: ${found === true ? "found in the scholarly record" : found === false ? "not found under that title" : "checked, no title match possible"} (router → ${pv.receipt?.routerIntent ?? pv.receipt?.intent}, ${pv.receipt?.minerSlug}).`);
    }
    const rl = by("related");
    if (rl?.status === "ok") {
      const papers = Array.isArray(d("related")["papers"]) ? (d("related")["papers"] as unknown[]).length : 0;
      lines.push(`Related work: ${papers || "some"} papers from ${rl.receipt?.minerSlug}.`);
    }
  } else {
    const hl = by("headlines");
    if (hl?.status === "ok") lines.push(`${articlesOf(d("headlines")["items"]).length} headlines from ${hl.receipt?.minerSlug}.`);
    const se = by("search");
    if (se?.status === "ok") lines.push(`${articlesOf(d("search")["articles"]).length} recent articles (router → ${se.receipt?.routerIntent ?? se.receipt?.intent}, ${se.receipt?.minerSlug}).`);
    const br = by("brief");
    if (br?.status === "ok") lines.push(`Briefing written by ${br.receipt?.minerSlug}.`);
  }
  const tr = by("translate");
  if (tr?.status === "ok") lines.push(`Translated into ${parsed.language?.name ?? "the requested language"} by ${tr.receipt?.minerSlug}.`);
  for (const s of steps) if (s.status === "error") lines.push(`${s.title}: ${s.error}`);
  return { calls, okSteps: ok.length, costUsd, intents, miners, lines };
}
