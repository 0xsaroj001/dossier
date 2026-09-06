import { describe, expect, it } from "vitest";
import { arxivFromExcerpt, cleanTitle, fallbackData, READERS, readerFor, splitAuthors, titlesFromProse } from "@/lib/adapters";

const ARXIV_EXCERPT =
  "Skip to main content Search Submit Donate Log in Search arXiv Press Enter to search &middot; Advanced search -- Computer Science Computation and Language arXiv:1706.03762 (cs) [Submitted on 12 Jun 2017 ( v1 ), last revised 2 Aug 2023 (this version, v7)] Title: Attention Is All You Need Authors: Ashish Vaswani , Noam Shazeer , Niki Parmar , Jakob Uszkoreit View a PDF of the paper titled Attention Is All You Need, by Ashish Vaswani";

describe("content extraction readers", () => {
  it("netwire: reads title, authors and date out of an arXiv excerpt", () => {
    const parsed = READERS.CONTENT_EXTRACTION!["netwire-content-extraction"]!({ title: "[1706.03762] Attention Is All You Need", excerpt: ARXIV_EXCERPT, char_count: 4930 }, { url: "https://arxiv.org/abs/1706.03762" });
    expect(parsed.data).toMatchObject({ title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"], date: "12 Jun 2017", year: "2017", charCount: 4930, abstract: null });
    expect(READERS.CONTENT_EXTRACTION!["netwire-content-extraction"]!({}, {}).unusable).toBeTruthy();
  });

  it("microlink: yields the bibliographic record", () => {
    const parsed = READERS.CONTENT_EXTRACTION!["microlink-url-extraction"]!({ status: "success", data: { title: "Attention Is All You Need", author: "Vaswani, Ashish", description: "We propose the Transformer.", date: "2017-06-12T00:00:00.000Z" } }, {});
    expect(parsed.data).toMatchObject({ title: "Attention Is All You Need", authors: ["Vaswani, Ashish"], abstract: "We propose the Transformer.", year: "2017" });
    expect(READERS.CONTENT_EXTRACTION!["microlink-url-extraction"]!({ status: "fail" }, {}).unusable).toBeTruthy();
  });

  it("livecert: structured fields become a flat list of facts", () => {
    const p = READERS.CONTENT_EXTRACTION!.livecert!({ verdict: "date_event", extracted: { dates: ["12 June 2017"], events: [], places: ["Google"] }, confidence: 1, reason: "One date and one place were found." }, {});
    expect(p.data).toMatchObject({ facts: ["dates: 12 June 2017", "places: Google"] });
    expect(p.answer).toMatch(/^One date and one place were found\.\ndates: 12 June 2017/);
    expect(READERS.CONTENT_EXTRACTION!.livecert!({}, {}).unusable).toBeTruthy();
  });
});

describe("authorship reader", () => {
  it("caliber reports P(AI) and the certainty for the stated label", () => {
    const r = READERS.AI_TEXT_DETECTION!["caliber-truthport-text-auth"]!;
    const p = r({ confidence: 0.248271, label: "human_written", reason: "low burstiness", model: "caliber-truthport-v2" }, {});
    expect(p.label).toBe("human_written");
    expect(p.confidence).toBeCloseTo(0.7517, 3);
    expect(p.data).toMatchObject({ pAi: 0.2483, model: "caliber-truthport-v2" });
    expect(r({ confidence: 0.9, label: "ai_generated" }, {}).confidence).toBe(0.9);
  });
  it("livecert says when no passage reached it", () => {
    expect(READERS.AI_TEXT_DETECTION!.livecert!({ verdict: "unknown", reason: "No passage long enough to analyse was supplied." }, {}).unusable).toBeTruthy();
  });
});

describe("translation readers", () => {
  it("livecert returns the translation, langwire flags an unsupported pair", () => {
    const l = READERS.LANGUAGE_TRANSLATION!.livecert!;
    expect(l({ verdict: "translated", confidence: 1, translation: "नमस्ते" }, { language: { name: "Hindi", code: "hi" } })).toMatchObject({ answer: "नमस्ते", data: { translation: "नमस्ते", language: "Hindi" } });
    expect(READERS.LANGUAGE_TRANSLATION!["langwire-translation"]!({ translation: null, supported: false, summary: "not available" }, {}).unusable).toBe("not available");
  });
});

describe("news readers", () => {
  it("livecert headlines become items; an empty list is unusable", () => {
    const r = READERS.NEWS_HEADLINES!.livecert!;
    expect(r({ topic: "technology", headlines: [{ title: "A", source: "BBC", published: "2026-09-06" }], confidence: 1, reason: "..." }, {}).data).toMatchObject({ items: [{ title: "A", source: "BBC" }], category: "technology" });
    expect(r({ headlines: [] }, {}).unusable).toBeTruthy();
  });
  it("verity articles carry source and description", () => {
    const p = READERS.NEWS_SEARCH!["verity-news-search"]!({ articles: [{ title: "T", url: "u", published_at: "d", source: "s", description: "x" }], answer: "ans", confidence: 0.9 }, {});
    expect(p.data).toMatchObject({ articles: [{ title: "T", source: "s", url: "u", description: "x" }], answer: "ans" });
  });
  it("groq output is the briefing text", () => {
    expect(READERS.CHAT_COMPLETION!["groq-llama31-instant-miner"]!({ output: "Brief.", confidence: 0.8 }, {}).data).toEqual({ text: "Brief." });
  });
});

describe("lookup and fallbacks", () => {
  it("finds a reader by the routed intent and miner, and none otherwise", () => {
    expect(readerFor("FACT_CHECK", "qarinah-proofpack")).toBe(READERS.FACT_CHECK!["qarinah-proofpack"]);
    expect(readerFor("FACT_CHECK", "someone-new")).toBeNull();
    expect(readerFor(null, "livecert")).toBeNull();
  });
  it("builds step data from plain answer text when no reader exists", () => {
    expect(fallbackData("brief", "Text.", undefined)).toEqual({ text: "Text." });
    expect(fallbackData("translate", "नमस्ते", undefined)).toEqual({ translation: "नमस्ते" });
    expect(fallbackData("search", "found things", undefined)).toEqual({ articles: [], answer: "found things" });
    expect(fallbackData("related", 'Papers: "PVT v2: Improved baselines" and more', undefined)).toMatchObject({ papers: ["PVT v2: Improved baselines"] });
  });
});

describe("text helpers", () => {
  it("cleans titles, splits authors, finds titles in prose", () => {
    expect(cleanTitle("[1706.03762] Attention Is All You Need | arXiv")).toBe("Attention Is All You Need");
    expect(splitAuthors("A. Smith; B. Jones and C. Lee")).toEqual(["A. Smith", "B. Jones", "C. Lee"]);
    expect(titlesFromProse('1) "PVT v2: Improved baselines" (2022); 2) Point cloud transformer by Meng-Hao Guo')).toEqual(["PVT v2: Improved baselines", "Point cloud transformer"]);
    expect(arxivFromExcerpt("nothing here")).toEqual({ title: null, authors: [], date: null });
  });
});
