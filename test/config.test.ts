import { afterEach, describe, expect, it } from "vitest";
import { config, configProblems, normalizePrivateKey, paidWorkEnabled, resetConfigForTests } from "@/lib/config";
import { decodeSettlement } from "@/lib/telegraph";

describe("config", () => {
  afterEach(() => {
    delete process.env["PAYER_PRIVATE_KEY"];
    delete process.env["DAILY_CALL_BUDGET"];
    resetConfigForTests();
  });

  it("accepts a MetaMask key with or without 0x", () => {
    const bare = "ab".repeat(32);
    expect(normalizePrivateKey(bare)).toBe(`0x${bare}`);
    expect(normalizePrivateKey(` 0x${bare.toUpperCase()} `)).toBe(`0x${bare}`);
    expect(normalizePrivateKey("nope")).toBeUndefined();
  });

  it("keeps paid work off by default and reports a malformed key", () => {
    resetConfigForTests();
    expect(paidWorkEnabled(config())).toBe(false);
    process.env["PAYER_PRIVATE_KEY"] = "garbage";
    resetConfigForTests();
    expect(config().PAYER_PRIVATE_KEY).toBeUndefined();
    expect(configProblems()[0]).toMatch(/not 64 hex/);
  });

  it("enables paid work only with a key and a budget", () => {
    process.env["PAYER_PRIVATE_KEY"] = "c".repeat(64);
    process.env["DAILY_CALL_BUDGET"] = "50";
    resetConfigForTests();
    expect(paidWorkEnabled(config())).toBe(true);
  });
});

describe("settlement header", () => {
  it("decodes the node's base64 payment response", () => {
    const h = Buffer.from(JSON.stringify({ success: true, transaction: `0x${"a".repeat(64)}`, payer: "0x1" })).toString("base64");
    expect(decodeSettlement(h)).toEqual({ success: true, txHash: `0x${"a".repeat(64)}`, payer: "0x1", errorReason: null });
    expect(decodeSettlement(Buffer.from(JSON.stringify({ success: false, errorReason: "insufficient_funds" })).toString("base64"))?.errorReason).toBe("insufficient_funds");
    expect(decodeSettlement("not base64 json")).toBeNull();
  });
});
