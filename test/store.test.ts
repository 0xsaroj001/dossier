import { beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { checkAllowance, noteAttempt } from "@/lib/guard";
import { getStore, resetStoreForTests } from "@/lib/store";
import type { Dossier, LedgerRow } from "@/lib/types";

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: Math.random().toString(36).slice(2),
  at: "2026-09-06T05:00:00.000Z",
  day: new Date().toISOString().slice(0, 10),
  visitor: "v1",
  mode: "research",
  step: "extract",
  intent: "CONTENT_EXTRACTION",
  routerIntent: "CONTENT_EXTRACTION",
  minerSlug: "livecert",
  minerId: "4433",
  minerRank: 1,
  endpoint: "/extract",
  status: "ok",
  confidence: 0.95,
  costUsd: 0.01,
  durationMs: 900,
  signalHash: "0xhash1",
  settlementTx: "0xtx1",
  error: null,
  preview: "Read the page: https://x",
  ...over,
});

describe("memory store", () => {
  beforeEach(() => {
    resetStoreForTests();
    delete process.env["UPSTASH_REDIS_REST_URL"];
    delete process.env["KV_REST_API_URL"];
    resetConfigForTests();
  });

  it("keeps rows, totals, visitors and signal hashes", async () => {
    const s = getStore();
    expect(s.kind).toBe("memory");
    await s.addRow(row());
    await s.addRow(row({ visitor: "v2", status: "error", costUsd: null, signalHash: null }));
    const stats = await s.stats();
    expect(stats).toMatchObject({ calls: 2, okCalls: 1, callsToday: 2, costUsd: 0.01, usersAll: 2, usersToday: 2, intents: { CONTENT_EXTRACTION: 2 } });
    expect((await s.rows(10)).length).toBe(2);
    expect(await s.knownSignal("0xhash1")).toBe(true);
    expect(await s.knownSignal("0xnope")).toBe(false);
  });

  it("saves and lists dossiers", async () => {
    const s = getStore();
    const d: Dossier = { id: "abc123", mode: "news", query: "q", parsed: { mode: "news", query: "q", url: null, topic: "q", language: null, region: null, category: null }, createdAt: "2026-09-06T05:00:00.000Z", source: null, steps: [], summary: { calls: 0, okSteps: 0, costUsd: 0, intents: [], miners: [], lines: [] } };
    await s.saveDossier(d);
    expect((await s.getDossier("abc123"))?.query).toBe("q");
    expect((await s.recentDossiers(5)).map((x) => x.id)).toEqual(["abc123"]);
  });
});

describe("spend guards", () => {
  beforeEach(() => {
    resetStoreForTests();
    resetConfigForTests();
  });

  it("refuses without a key, then allows within budget, then refuses when it is spent", async () => {
    delete process.env["PAYER_PRIVATE_KEY"];
    process.env["DAILY_CALL_BUDGET"] = "2";
    resetConfigForTests();
    let a = await checkAllowance(getStore(), "v");
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/payer wallet/);

    process.env["PAYER_PRIVATE_KEY"] = "1".repeat(64);
    resetConfigForTests();
    a = await checkAllowance(getStore(), "v");
    expect(a.ok).toBe(true);
    expect(a.budgetLeft).toBe(2);

    await noteAttempt(getStore(), "v");
    await noteAttempt(getStore(), "v");
    a = await checkAllowance(getStore(), "v");
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/budget/);
    delete process.env["PAYER_PRIVATE_KEY"];
    delete process.env["DAILY_CALL_BUDGET"];
    resetConfigForTests();
  });

  it("caps one visitor without touching the shared budget's headroom", async () => {
    process.env["PAYER_PRIVATE_KEY"] = "2".repeat(64);
    process.env["DAILY_CALL_BUDGET"] = "100";
    process.env["VISITOR_DAILY_CALLS"] = "1";
    resetConfigForTests();
    await noteAttempt(getStore(), "me");
    const a = await checkAllowance(getStore(), "me");
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/allowance/);
    expect((await checkAllowance(getStore(), "someone-else")).ok).toBe(true);
    delete process.env["PAYER_PRIVATE_KEY"];
    delete process.env["DAILY_CALL_BUDGET"];
    delete process.env["VISITOR_DAILY_CALLS"];
    resetConfigForTests();
  });

  it("pauses everything with one flag", async () => {
    process.env["PAYER_PRIVATE_KEY"] = "3".repeat(64);
    process.env["DAILY_CALL_BUDGET"] = "100";
    process.env["PAUSED"] = "true";
    resetConfigForTests();
    expect((await checkAllowance(getStore(), "v")).reason).toMatch(/Paused/);
    delete process.env["PAYER_PRIVATE_KEY"];
    delete process.env["DAILY_CALL_BUDGET"];
    delete process.env["PAUSED"];
    resetConfigForTests();
  });
});
