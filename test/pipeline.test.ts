import { describe, expect, it } from "vitest";
import { parseQuery } from "@/lib/parse";
import { buildPlan, clipSentences, deriveInput, keySentence, RESEARCH_STEPS, routerQuery, summarize } from "@/lib/pipeline";
import type { StepResult } from "@/lib/types";

const ABSTRACT =
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.";

describe("plan", () => {
  it("plans eight research steps with a language and seven without", () => {
    expect(buildPlan(parseQuery("research", "https://arxiv.org/abs/1 in Hindi")).map((s) => s.id)).toEqual(["read", "metadata", "authorship", "fraud", "fact", "provenance", "related", "translate"]);
    expect(buildPlan(parseQuery("research", "https://arxiv.org/abs/1")).length).toBe(7);
    expect(buildPlan(parseQuery("news", "AI regulation in India in Hindi")).map((s) => s.id)).toEqual(["headlines", "search", "brief", "translate"]);
  });
  it("covers all ten intents across both modes", () => {
    const intents = new Set([...buildPlan(parseQuery("research", "https://x in Hindi")), ...buildPlan(parseQuery("news", "x in Hindi"))].map((s) => s.intent));
    expect([...intents].sort()).toEqual(["ACADEMIC_SEARCH", "AI_TEXT_DETECTION", "CHAT_COMPLETION", "CONTENT_EXTRACTION", "CONTENT_VERIFICATION", "FACT_CHECK", "FRAUD_DETECTION", "LANGUAGE_TRANSLATION", "NEWS_HEADLINES", "NEWS_SEARCH"]);
  });
});

describe("inputs", () => {
  const parsed = parseQuery("research", "https://arxiv.org/abs/1706.03762 in Hindi");
  const spec = (id: string) => RESEARCH_STEPS.find((s) => s.id === id)!;
  const ctx = { read: { title: "Attention Is All You Need", excerpt: "x", charCount: 10 }, metadata: { title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], abstract: ABSTRACT, date: "2017-06-12", year: "2017" } };

  it("skips authorship on thin prose and runs it on an abstract", () => {
    expect(deriveInput(spec("authorship"), parsed, { metadata: { abstract: "too short" } })).toHaveProperty("skip");
    const d = deriveInput(spec("authorship"), parsed, ctx);
    expect("input" in d && d.input.text).toBe(ABSTRACT);
  });
  it("turns the abstract's result sentence into the claim", () => {
    expect(keySentence(ABSTRACT)).toMatch(/^Experiments on two machine translation tasks show/);
    const d = deriveInput(spec("fact"), parsed, ctx);
    expect("input" in d && d.input.claim).toMatch(/^Experiments .* \(claim from the paper “Attention Is All You Need” by Ashish Vaswani, Noam Shazeer \(2017\)\)$/);
  });
  it("asks the router a provenance question and skips without a title", () => {
    const d = deriveInput(spec("provenance"), parsed, ctx);
    expect("input" in d).toBe(true);
    if ("input" in d) expect(routerQuery(spec("provenance"), d.input)).toMatch(/genuine and unaltered/);
    expect(deriveInput(spec("provenance"), parsed, {})).toHaveProperty("skip");
  });
  it("translates whole sentences within the cap", () => {
    const d = deriveInput(spec("translate"), parsed, ctx);
    expect("input" in d && d.input.language?.name).toBe("Hindi");
    const clipped = clipSentences("One. Two. Three.", 9);
    expect(clipped).toEqual({ text: "One. Two.", truncated: true });
  });
  it("builds the news briefing from headlines and coverage, and skips with none", () => {
    const news = parseQuery("news", "AI regulation in India");
    const brief = deriveInput({ ...spec("read"), id: "brief" }, news, { headlines: { items: [{ title: "H1", source: "BBC" }] }, search: { articles: [{ title: "A1", source: "Reuters", description: "d" }] } });
    expect("input" in brief && brief.input.messages?.[1]?.content).toMatch(/H1 \(BBC\)[\s\S]*A1 \(Reuters\)/);
    expect(deriveInput({ ...spec("read"), id: "brief" }, news, {})).toHaveProperty("skip");
  });
});

describe("summary", () => {
  it("counts calls and cost from every attempt, including failed ones", () => {
    const parsed = parseQuery("research", "https://arxiv.org/abs/1");
    const steps: StepResult[] = [
      { id: "read", title: "Read", intent: "CONTENT_EXTRACTION", status: "ok", receipt: null, data: { title: "T" }, error: null, attempts: [{ minerSlug: "a", minerRank: 2, routedBy: "app", outcome: "error", durationMs: 10, costUsd: null, note: null }, { minerSlug: "b", minerRank: 3, routedBy: "app", outcome: "ok", durationMs: 10, costUsd: 0.01, note: null }] },
      { id: "fraud", title: "Fraud", intent: "FRAUD_DETECTION", status: "error", receipt: null, data: null, error: "boom", attempts: [] },
    ];
    const s = summarize(parsed, steps);
    expect(s.calls).toBe(2);
    expect(s.costUsd).toBe(0.01);
    expect(s.lines.some((l) => l.includes("boom"))).toBe(true);
  });
});
