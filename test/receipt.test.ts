import { describe, expect, it } from "vitest";
import { buildReceipt, extractAnswer, isRiskField, toConfidence } from "@/lib/receipt";

describe("confidence", () => {
  it("normalises the shapes miners use", () => {
    expect(toConfidence(0.5)).toBe(0.5);
    expect(toConfidence(85)).toBe(0.85);
    expect(toConfidence("0.3")).toBe(0.3);
    expect(toConfidence(150)).toBeNull();
    expect(toConfidence(null)).toBeNull();
  });
  it("knows a risk score from a confidence", () => {
    expect(isRiskField("risk_score")).toBe(true);
    expect(isRiskField("confidence")).toBe(false);
  });
});

describe("answer text", () => {
  it("prefers the declared reason field, then common keys, then chat choices", () => {
    expect(extractAnswer({ reason: "because", answer: "no" }, { reason_field: "reason" })).toBe("because");
    expect(extractAnswer({ summary: "short" })).toBe("short");
    expect(extractAnswer({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
    expect(extractAnswer({ responseData: { translatedText: "hola" } })).toBe("hola");
    expect(extractAnswer(null)).toMatch(/empty/);
  });
});

describe("buildReceipt", () => {
  it("reads settlement, hash and mapping-driven fields", () => {
    const r = buildReceipt(
      { miner_id: 4433, miner_name: "LiveCert", result: { verdict: "translated", confidence: 1, reason: "नमस्ते" }, cost_usd: 0.01, duration_ms: 320.4, signal_hash: "0xabc", settlement: { success: true, txHash: "0xdef", payer: "0x1", errorReason: null } },
      { intent: "LANGUAGE_TRANSLATION", miner: { id: "4433", slug: "livecert", signal_mapping: { confidence_field: "confidence", label_field: "verdict", reason_field: "reason" } }, rank: 1, routedBy: "app", endpoint: "/translate", payer: "0x1" },
    );
    expect(r).toMatchObject({ minerSlug: "livecert", minerRank: 1, confidence: 1, label: "translated", answer: "नमस्ते", costUsd: 0.01, durationMs: 320, signalHash: "0xabc", settlementTx: "0xdef", routedBy: "app" });
  });
  it("labels a risk score instead of calling it confidence", () => {
    const r = buildReceipt({ result: { risk: 0.9 } }, { intent: "STORM_ALERT", miner: { id: "1", slug: "storm", signal_mapping: { confidence_field: "risk" } }, rank: null, routedBy: "app", payer: null });
    expect(r.confidence).toBe(0.9);
    expect(r.confidenceNote).toMatch(/risk/);
  });
});
