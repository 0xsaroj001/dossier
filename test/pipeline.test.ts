import { describe, expect, it } from "vitest";
import { parseQuery } from "@/lib/parse";
import { buildPlan, clipSentences, deriveInput, keySentence, metaOf, NEWS_STEPS, RESEARCH_STEPS, SAFETY_STEPS, summarize } from "@/lib/pipeline";
import type { StepResult } from "@/lib/types";

const ABSTRACT =
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.";

describe("plan", () => {
  it("plans eight research questions with a language and seven without", async () => {
    expect(buildPlan(parseQuery("research", "https://arxiv.org/abs/1 in Hindi")).map((s) => s.id)).toEqual(["extract", "summary", "authorship", "fraud", "fact", "provenance", "related", "translate"]);
    expect(buildPlan(parseQuery("research", "https://arxiv.org/abs/1")).length).toBe(7);
    expect(buildPlan(parseQuery("news", "AI regulation in India in Hindi")).map((s) => s.id)).toEqual(["headlines", "search", "brief", "translate"]);
  });
  it("covers all ten intents across both modes and accepts its own intent everywhere", async () => {
    const all = [...RESEARCH_STEPS, ...NEWS_STEPS];
    expect([...new Set(all.map((s) => s.intent))].sort()).toEqual(["ACADEMIC_SEARCH", "AI_TEXT_DETECTION", "CHAT_COMPLETION", "CONTENT_EXTRACTION", "CONTENT_VERIFICATION", "FACT_CHECK", "FRAUD_DETECTION", "LANGUAGE_TRANSLATION", "NEWS_HEADLINES", "NEWS_SEARCH"]);
    for (const s of all) expect(s.accept).toContain(s.intent);
  });
});

describe("inputs", () => {
  const parsed = parseQuery("research", "https://arxiv.org/abs/1706.03762 in Hindi");
  const spec = (id: string) => RESEARCH_STEPS.find((s) => s.id === id)!;
  const ctx = { source: { url: "https://arxiv.org/abs/1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], abstract: ABSTRACT, date: "2017-06-12", year: "2017", site: "arxiv.org" } };

  it("reads the paper from the page's metadata", async () => {
    expect(metaOf(ctx)).toMatchObject({ title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], abstract: ABSTRACT, year: "2017" });
    expect(metaOf({}).title).toBeNull();
  });
  it("asks for structured facts from the abstract, and skips without one", async () => {
    const d = await deriveInput(spec("extract"), parsed, ctx);
    expect("queries" in d && d.queries[0]).toMatch(/^Extract the dates, quantities, named entities and events from: The dominant/);
    expect("context" in d ? d.context : undefined).toBeUndefined();
    expect(await deriveInput(spec("extract"), parsed, {})).toHaveProperty("skip");
  });
  it("asks for a plain-words summary with the abstract as chat context", async () => {
    const d = await deriveInput(spec("summary"), parsed, ctx);
    expect("queries" in d && d.queries[0]).toMatch(/^In three plain sentences/);
    expect("context" in d && (d.context?.["messages"] as Array<{ role: string }>)[0]?.role).toBe("system");
  });
  it("skips authorship on thin prose and sends the abstract as text otherwise", async () => {
    expect(await deriveInput(spec("authorship"), parsed, { source: { abstract: "too short" } })).toHaveProperty("skip");
    const d = await deriveInput(spec("authorship"), parsed, ctx);
    expect("context" in d && d.context).toEqual({ text: ABSTRACT });
    expect("queries" in d && d.queries[0]).toMatch(/^Was the following passage written by an AI or by a human\? Passage: The dominant/);
    expect("queries" in d && d.queries[1]).toMatch(/^AI text detection/);
  });
  it("turns the abstract's result sentence into the claim", async () => {
    expect(keySentence(ABSTRACT)).toMatch(/^Experiments on two machine translation tasks show/);
    const d = await deriveInput(spec("fact"), parsed, ctx);
    expect("queries" in d && d.queries[0]).toMatch(/^Is this claim true\? Experiments .* \(claim from the paper “Attention Is All You Need” by Ashish Vaswani, Noam Shazeer \(2017\)\)$/);
  });
  it("asks a provenance question and skips without a title", async () => {
    const d = await deriveInput(spec("provenance"), parsed, ctx);
    expect("queries" in d && d.queries[0]).toMatch(/genuine and unaltered/);
    expect("queries" in d && d.queries[1]).toMatch(/^Search the academic literature/);
    expect(await deriveInput(spec("provenance"), parsed, {})).toHaveProperty("skip");
  });
  it("translates whole sentences within the cap and names the language in every translator's shape", async () => {
    const d = await deriveInput(spec("translate"), parsed, ctx);
    expect("context" in d && d.context).toMatchObject({ target_language: "Hindi", to: "Hindi", langpair: "en|hi" });
    expect("queries" in d && d.queries[0]).toMatch(/^Translate the following text into Hindi: /);
    expect(clipSentences("One. Two. Three.", 9)).toEqual({ text: "One. Two.", truncated: true });
  });
  it("words the briefing as a writing task from notes, never as a search", async () => {
    const news = parseQuery("news", "AI regulation in India");
    const brief = NEWS_STEPS.find((s) => s.id === "brief")!;
    const d = await deriveInput(brief, news, { headlines: { items: [{ title: "H1", source: "BBC" }] }, search: { articles: [{ title: "A1", source: "Reuters", description: "d" }] } });
    expect("queries" in d && d.queries[0]).toMatch(/^Write a briefing of 120 to 180 words on AI regulation in India using only the notes below\. Do not look anything up\./);
    expect("queries" in d && d.queries[0]).not.toMatch(/news|headline|coverage/i);
    expect("context" in d && (d.context?.["messages"] as Array<{ content: string }>)[1]?.content).toMatch(/H1 \(BBC\)[\s\S]*A1 \(Reuters\)/);
    expect(await deriveInput(brief, news, {})).toHaveProperty("skip");
  });
  it("phrases headlines and search with the region", async () => {
    const news = parseQuery("news", "AI regulation in India");
    const h = await deriveInput(NEWS_STEPS[0]!, news, {});
    expect("queries" in h && h.queries[0]).toBe("What are the top news headlines about AI regulation in India today?");
    const s = await deriveInput(NEWS_STEPS[1]!, news, {});
    expect("queries" in s && s.queries[0]).toBe("Find recent news articles from the last 7 days about AI regulation in India.");
  });
});

describe("safety", () => {
  it("plans only the checks the input allows", async () => {
    expect(buildPlan(parseQuery("safety", "Verify at https://example.com/x and send ETH to 0x000000000000000000000000000000000000dEaD to unlock your prize now")).map((s) => s.id)).toEqual(["scan", "cert", "where", "scam", "redflags"]);
    expect(buildPlan(parseQuery("safety", "https://example.com")).map((s) => s.id)).toEqual(["scan", "cert", "where", "scam"]);
    expect(buildPlan(parseQuery("safety", "0x000000000000000000000000000000000000dEaD")).map((s) => s.id)).toEqual(["scam"]);
    for (const s of SAFETY_STEPS) expect(s.accept).toContain(s.intent);
  });
  it("asks about the wallet before the site, classifies the message, and skips a host that does not resolve", async () => {
    const p = parseQuery("safety", "Send 0.1 ETH to 0x000000000000000000000000000000000000dEaD via https://no-such-host.invalid/ to claim your prize today please");
    const spec = (id: string) => SAFETY_STEPS.find((s) => s.id === id)!;
    const scam = await deriveInput(spec("scam"), p, {});
    expect("queries" in scam && scam.queries[0]).toMatch(/^How likely is the wallet 0x0000/);
    const flags = await deriveInput(spec("redflags"), p, {});
    expect("queries" in flags && flags.queries[0]).toMatch(/^Read this message someone received/);
    expect("queries" in flags && flags.queries[1]).toMatch(/^Classify this text message as one of: scam, phishing, spam, legitimate/);
    expect("queries" in flags && flags.queries[0]).toMatch(/\[a wallet address\] via \[a link\]/);
    expect("queries" in flags && flags.queries[0]).not.toMatch(/0x0000/);
    const cert = await deriveInput(spec("cert"), p, {});
    expect("queries" in cert && cert.queries[0]).toBe("Is the TLS certificate for no-such-host.invalid currently valid, and who issued it?");
    expect(await deriveInput(spec("where"), p, {})).toHaveProperty("skip");
  });
});

describe("summary", () => {
  it("counts every question asked and what it cost, including failed ones, and names the paper", async () => {
    const parsed = parseQuery("research", "https://arxiv.org/abs/1");
    const steps: StepResult[] = [
      {
        id: "extract",
        title: "Key facts",
        intent: "CONTENT_EXTRACTION",
        status: "ok",
        receipt: null,
        data: { facts: ["dates: 2017"] },
        error: null,
        attempts: [
          { phrasing: 1, minerSlug: "a", minerRank: 2, intent: "WEB_SEARCH", outcome: "off-target", durationMs: 10, costUsd: 0.01, note: null },
          { phrasing: 2, minerSlug: "b", minerRank: 3, intent: "CONTENT_EXTRACTION", outcome: "ok", durationMs: 10, costUsd: 0.01, note: null },
        ],
      },
      { id: "fraud", title: "Fraud", intent: "FRAUD_DETECTION", status: "error", receipt: null, data: null, error: "boom", attempts: [] },
    ];
    const s = summarize(parsed, steps, { title: "T", authors: ["A"], year: "2017" });
    expect(s.calls).toBe(2);
    expect(s.costUsd).toBe(0.02);
    expect(s.lines[0]).toMatch(/^Paper: T — A \(2017\)/);
    expect(s.lines.some((l) => l.includes("boom"))).toBe(true);
  });
});
