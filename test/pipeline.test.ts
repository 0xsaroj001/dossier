import { describe, expect, it } from "vitest";
import { parseQuery } from "@/lib/parse";
import { buildPlan, clipSentences, deriveInput, keySentence, metaOf, NEWS_STEPS, RESEARCH_STEPS, summarize } from "@/lib/pipeline";
import type { StepResult } from "@/lib/types";

const ABSTRACT =
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.";

describe("plan", () => {
  it("plans eight research questions with a language and seven without", () => {
    expect(buildPlan(parseQuery("research", "https://arxiv.org/abs/1 in Hindi")).map((s) => s.id)).toEqual(["read", "abstract", "authorship", "fraud", "fact", "provenance", "related", "translate"]);
    expect(buildPlan(parseQuery("research", "https://arxiv.org/abs/1")).length).toBe(7);
    expect(buildPlan(parseQuery("news", "AI regulation in India in Hindi")).map((s) => s.id)).toEqual(["headlines", "search", "brief", "translate"]);
  });
  it("covers all ten intents across both modes and accepts its own intent everywhere", () => {
    const all = [...RESEARCH_STEPS, ...NEWS_STEPS];
    expect([...new Set(all.map((s) => s.intent))].sort()).toEqual(["ACADEMIC_SEARCH", "AI_TEXT_DETECTION", "CHAT_COMPLETION", "CONTENT_EXTRACTION", "CONTENT_VERIFICATION", "FACT_CHECK", "FRAUD_DETECTION", "LANGUAGE_TRANSLATION", "NEWS_HEADLINES", "NEWS_SEARCH"]);
    for (const s of all) expect(s.accept).toContain(s.intent);
  });
});

describe("inputs", () => {
  const parsed = parseQuery("research", "https://arxiv.org/abs/1706.03762 in Hindi");
  const spec = (id: string) => RESEARCH_STEPS.find((s) => s.id === id)!;
  const ctx = {
    read: { title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], abstract: null, date: "12 Jun 2017", year: "2017", excerpt: "x" },
    abstract: { title: "Attention Is All You Need", authors: [], abstract: ABSTRACT, date: null, year: null, excerpt: null },
  };

  it("merges what the two extraction questions found", () => {
    const m = metaOf(ctx);
    expect(m).toMatchObject({ title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], abstract: ABSTRACT, year: "2017" });
  });
  it("asks the page questions with the link as a structured hint", () => {
    const d = deriveInput(spec("read"), parsed, {});
    expect("queries" in d && d.queries[0]).toMatch(/^Read the research paper page at https:\/\/arxiv.org\/abs\/1706.03762/);
    expect("context" in d && d.context).toEqual({ url: "https://arxiv.org/abs/1706.03762" });
  });
  it("skips authorship on thin prose and sends the abstract as text otherwise", () => {
    expect(deriveInput(spec("authorship"), parsed, { abstract: { abstract: "too short" } })).toHaveProperty("skip");
    const d = deriveInput(spec("authorship"), parsed, ctx);
    expect("context" in d && d.context).toEqual({ text: ABSTRACT });
    expect("queries" in d && d.queries[0]).toMatch(/^Was the following passage written by an AI or by a human\? Passage: The dominant/);
    expect("queries" in d && d.queries[1]).toMatch(/^AI text detection/);
  });
  it("turns the abstract's result sentence into the claim", () => {
    expect(keySentence(ABSTRACT)).toMatch(/^Experiments on two machine translation tasks show/);
    const d = deriveInput(spec("fact"), parsed, ctx);
    expect("queries" in d && d.queries[0]).toMatch(/^Is this claim true\? Experiments .* \(claim from the paper “Attention Is All You Need” by Ashish Vaswani, Noam Shazeer \(2017\)\)$/);
  });
  it("asks a provenance question and skips without a title", () => {
    const d = deriveInput(spec("provenance"), parsed, ctx);
    expect("queries" in d && d.queries[0]).toMatch(/genuine and unaltered/);
    expect("queries" in d && d.queries[1]).toMatch(/^Search the academic literature/);
    expect(deriveInput(spec("provenance"), parsed, {})).toHaveProperty("skip");
  });
  it("translates whole sentences within the cap and names the language in the hint", () => {
    const d = deriveInput(spec("translate"), parsed, ctx);
    expect("context" in d && d.context).toMatchObject({ target_language: "Hindi", to: "Hindi" });
    expect("queries" in d && d.queries[0]).toMatch(/^Translate the following text into Hindi: /);
    expect(clipSentences("One. Two. Three.", 9)).toEqual({ text: "One. Two.", truncated: true });
  });
  it("builds the news briefing from headlines and coverage, and skips with none", () => {
    const news = parseQuery("news", "AI regulation in India");
    const brief = NEWS_STEPS.find((s) => s.id === "brief")!;
    const d = deriveInput(brief, news, { headlines: { items: [{ title: "H1", source: "BBC" }] }, search: { articles: [{ title: "A1", source: "Reuters", description: "d" }] } });
    expect("context" in d && (d.context?.["messages"] as Array<{ content: string }>)[1]?.content).toMatch(/H1 \(BBC\)[\s\S]*A1 \(Reuters\)/);
    expect("queries" in d && d.queries[0]).toMatch(/^Write a news briefing of 120 to 180 words about AI regulation in India/);
    expect(deriveInput(brief, news, {})).toHaveProperty("skip");
  });
  it("phrases headlines and search with the region", () => {
    const news = parseQuery("news", "AI regulation in India");
    const h = deriveInput(NEWS_STEPS[0]!, news, {});
    expect("queries" in h && h.queries[0]).toBe("What are the top news headlines about AI regulation in India today?");
    const s = deriveInput(NEWS_STEPS[1]!, news, {});
    expect("queries" in s && s.queries[0]).toBe("Find recent news articles from the last 7 days about AI regulation in India.");
  });
});

describe("summary", () => {
  it("counts every question asked and what it cost, including failed ones", () => {
    const parsed = parseQuery("research", "https://arxiv.org/abs/1");
    const steps: StepResult[] = [
      {
        id: "read",
        title: "Read",
        intent: "CONTENT_EXTRACTION",
        status: "ok",
        receipt: null,
        data: { title: "T" },
        error: null,
        attempts: [
          { phrasing: 1, minerSlug: "a", minerRank: 2, intent: "WEB_SEARCH", outcome: "off-target", durationMs: 10, costUsd: 0.01, note: null },
          { phrasing: 2, minerSlug: "b", minerRank: 3, intent: "CONTENT_EXTRACTION", outcome: "ok", durationMs: 10, costUsd: 0.01, note: null },
        ],
      },
      { id: "fraud", title: "Fraud", intent: "FRAUD_DETECTION", status: "error", receipt: null, data: null, error: "boom", attempts: [] },
    ];
    const s = summarize(parsed, steps);
    expect(s.calls).toBe(2);
    expect(s.costUsd).toBe(0.02);
    expect(s.lines.some((l) => l.includes("boom"))).toBe(true);
  });
});
