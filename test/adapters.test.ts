import { describe, expect, it } from "vitest";
import { ADAPTERS, adapterFor, cleanTitle, genericAdapter, splitAuthors, titlesFromProse } from "@/lib/adapters";
import type { Miner } from "@/lib/telegraph";

const miner = (slug: string, extra: Partial<Miner> = {}): Miner => ({ id: "1", slug, ...extra });

describe("content extraction", () => {
  it("netwire takes a url and cleans the arXiv title", () => {
    const a = ADAPTERS.CONTENT_EXTRACTION!["netwire-content-extraction"]!;
    const req = a.build({ url: "https://arxiv.org/abs/1706.03762", question: "q" }, miner("netwire-content-extraction"));
    expect(req).toMatchObject({ method: "GET", endpoint: "/extract", payload: { url: "https://arxiv.org/abs/1706.03762" } });
    const parsed = a.parse!({ title: "[1706.03762] Attention Is All You Need", excerpt: "Skip to main content", char_count: 4930 }, { url: "https://arxiv.org/abs/1706.03762" });
    expect(parsed.data).toMatchObject({ title: "Attention Is All You Need", charCount: 4930 });
    expect(a.build({ text: "no url" }, miner("netwire-content-extraction"))).toBeNull();
  });

  it("microlink yields the bibliographic record", () => {
    const a = ADAPTERS.CONTENT_EXTRACTION!["microlink-url-extraction"]!;
    const parsed = a.parse!({ status: "success", data: { title: "Attention Is All You Need", author: "Vaswani, Ashish", description: "We propose the Transformer.", date: "2017-06-12T00:00:00.000Z" } }, {});
    expect(parsed.data).toMatchObject({ title: "Attention Is All You Need", authors: ["Vaswani, Ashish"], abstract: "We propose the Transformer.", year: "2017" });
    expect(a.parse!({ status: "fail" }, {}).unusable).toBeTruthy();
  });

  it("livecert's inline extractor cannot take a url", () => {
    expect(ADAPTERS.CONTENT_EXTRACTION!.livecert!.build({ url: "https://x" }, miner("livecert"))).toBeNull();
  });
});

describe("authorship", () => {
  it("caliber reports P(AI) and the certainty for the stated label", () => {
    const a = ADAPTERS.AI_TEXT_DETECTION!["caliber-truthport-text-auth"]!;
    const p = a.parse!({ confidence: 0.248271, label: "human_written", reason: "low burstiness", model: "caliber-truthport-v2" }, {});
    expect(p.label).toBe("human_written");
    expect(p.confidence).toBeCloseTo(0.7517, 3);
    expect(p.data).toMatchObject({ pAi: 0.2483, model: "caliber-truthport-v2" });
    const q = a.parse!({ confidence: 0.9, label: "ai_generated" }, {});
    expect(q.confidence).toBe(0.9);
  });
});

describe("translation", () => {
  it("livecert returns the translation, langwire flags an unsupported pair", () => {
    const l = ADAPTERS.LANGUAGE_TRANSLATION!.livecert!;
    expect(l.build({ text: "hello", language: { name: "Hindi", code: "hi" } }, miner("livecert"))?.payload).toEqual({ text: "hello", target_language: "Hindi" });
    expect(l.parse!({ verdict: "translated", confidence: 1, translation: "नमस्ते" }, { language: { name: "Hindi", code: "hi" } })).toMatchObject({ answer: "नमस्ते", data: { translation: "नमस्ते", language: "Hindi" } });
    const w = ADAPTERS.LANGUAGE_TRANSLATION!["langwire-translation"]!;
    expect(w.parse!({ translation: null, supported: false, summary: "not available" }, {}).unusable).toBe("not available");
  });
});

describe("headlines", () => {
  it("livecert needs a section and carries the region in the question", () => {
    const a = ADAPTERS.NEWS_HEADLINES!.livecert!;
    expect(a.build({ topic: "AI regulation", category: "technology", region: "India" }, miner("livecert"))?.payload).toEqual({ topic: "technology", query: "technology headlines in India" });
    expect(a.build({ topic: "technology", category: "technology", region: null }, miner("livecert"))?.payload).toEqual({ topic: "technology" });
    expect(a.build({ topic: "Chandrayaan", category: null }, miner("livecert"))).toBeNull();
    const parsed = a.parse!({ topic: "technology", headlines: [{ title: "A", source: "BBC", published: "2026-09-06" }], confidence: 1, reason: "..." }, {});
    expect(parsed.data).toMatchObject({ items: [{ title: "A", source: "BBC" }] });
  });
});

describe("generic adapter", () => {
  it("fills prose keys and refuses typed schemas it cannot satisfy", () => {
    const g = genericAdapter("FRAUD_DETECTION");
    const prose = miner("x", { endpoints: [{ path: "/fraud", method: "POST" }], input_schema: { properties: { query: {} }, required: ["query"] } });
    expect(g.build({ question: "Is this a scam?" }, prose)).toEqual({ method: "POST", endpoint: "/fraud", payload: { query: "Is this a scam?" } });
    const typed = miner("y", { endpoints: [{ path: "/check" }], input_schema: { properties: { address: {} }, required: ["address"] } });
    expect(g.build({ question: "Is this a scam?" }, typed)).toBeNull();
  });
  it("prefers the endpoint that names the intent", () => {
    const g = genericAdapter("LANGUAGE_TRANSLATION");
    const m = miner("z", { endpoints: [{ path: "/ssl" }, { path: "/translate" }], input_schema: { properties: { text: {}, to: {} } } });
    expect(g.build({ text: "hi", language: { name: "French", code: "fr" } }, m)).toEqual({ method: "GET", endpoint: "/translate", payload: { text: "hi", to: "French" } });
  });
  it("adapterFor returns the known adapter by slug", () => {
    expect(adapterFor("FACT_CHECK", miner("qarinah-proofpack"))).toBe(ADAPTERS.FACT_CHECK!["qarinah-proofpack"]);
  });
});

describe("text helpers", () => {
  it("cleans titles, splits authors, finds titles in prose", () => {
    expect(cleanTitle("[1706.03762] Attention Is All You Need | arXiv")).toBe("Attention Is All You Need");
    expect(splitAuthors("A. Smith; B. Jones and C. Lee")).toEqual(["A. Smith", "B. Jones", "C. Lee"]);
    expect(titlesFromProse('1) "PVT v2: Improved baselines" (2022); 2) Point cloud transformer by Meng-Hao Guo')).toEqual(["PVT v2: Improved baselines", "Point cloud transformer"]);
  });
});
