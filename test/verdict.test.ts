import { describe, expect, it } from "vitest";
import { safetyVerdict, toneOf } from "@/lib/verdict";
import type { Receipt, StepResult } from "@/lib/types";

const receipt = (label: string | null, answer: string): Receipt => ({
  intent: "URL_SCAN",
  minerSlug: "m",
  minerName: null,
  minerId: null,
  minerRank: 1,
  routerIntent: "URL_SCAN",
  routerReasoning: null,
  endpoint: null,
  confidence: 0.9,
  confidenceNote: null,
  label,
  answer,
  costUsd: 0.01,
  durationMs: 10,
  signalHash: null,
  settlementTx: null,
  payer: null,
  warnings: [],
});
const step = (id: StepResult["id"], title: string, r: Receipt | null, status: StepResult["status"] = "ok"): StepResult => ({ id, title, intent: "URL_SCAN", status, receipt: r, data: null, error: null, attempts: [] });

describe("safety verdict", () => {
  it("raises caution on any red-flag label or answer", () => {
    const steps = [step("scan", "Link scan", receipt("malicious", "Listed by OpenPhish")), step("cert", "Certificate", receipt("valid", "Issued by Let's Encrypt"))];
    expect(toneOf(steps[0]!)).toBe("caution");
    expect(toneOf(steps[1]!)).toBe("clear");
    const v = safetyVerdict(steps);
    expect(v.tone).toBe("caution");
    expect(v.line).toMatch(/1 of 2 checks raised a red flag \(Link scan\)/);
  });
  it("reads an explicit risk figure and a not-applicable wallet as clean, even when the text mentions scary words", () => {
    expect(toneOf(step("scam", "Fraud record", receipt("NOT_APPLICABLE", "this address is not a standard funded wallet (burn/null or known mixer). Probability 0 (0% risk).")))).toBe("clear");
    expect(toneOf(step("scam", "Fraud record", receipt("HIGH", "Known drainer. 92% risk.")))).toBe("caution");
    expect(toneOf(step("scan", "Link scan", receipt("not listed", "example.com is not in the URLhaus malware feed")))).toBe("clear");
  });
  it("does not count danger words inside a negated sentence, and reads a prose label like an answer", () => {
    const prose = "Based on publicly available blockchain analytics, the address 0xdEaD does not appear in any known scam, phishing, or fraud database. No reports were found.";
    expect(toneOf(step("scam", "Fraud record", receipt(prose, prose)))).toBe("clear");
    expect(toneOf(step("redflags", "Red flags", receipt("scam likely", "It is a phishing/scam message. Legitimate banks never ask for this.")))).toBe("caution");
    expect(toneOf(step("redflags", "Red flags", receipt("ANSWERED", "This is a classic phishing scam pretending to be a bank. Legitimate banks never ask for crypto.")))).toBe("caution");
  });
  it("clears when every answered check is clean, and abstains with none", () => {
    expect(safetyVerdict([step("scan", "Link scan", receipt("safe", "No listings")), step("cert", "Certificate", receipt("valid", "ok"))]).tone).toBe("clear");
    expect(safetyVerdict([step("scan", "Link scan", null, "error")]).tone).toBe("unknown");
  });
});
