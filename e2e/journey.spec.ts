import { expect, test } from "@playwright/test";

/**
 * The judge journey. Everything here is free unless E2E_PAID=1, which runs one real
 * research dossier through the deployed pipeline and checks the receipts.
 */
const RESEARCH = "Extract the research paper at https://arxiv.org/abs/1706.03762 in Hindi";
const NEWS = "What's the latest on AI regulation in India, in Hindi";

test("home explains itself and offers both modes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ask once");
  await expect(page.getByRole("tab", { name: "Research paper" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "News topic" })).toBeVisible();
  await expect(page.locator("#how")).toContainText("CONTENT_VERIFICATION");
});

test("health reports the configuration honestly", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const j = await res.json();
  expect(j.name).toBe("dossier");
  expect(typeof j.payerConfigured).toBe("boolean");
  expect(j.budget).toHaveProperty("limit");
});

test("a research query plans eight steps over seven intents", async ({ request }) => {
  const res = await request.post("/api/plan", { data: { mode: "research", query: RESEARCH } });
  const j = await res.json();
  expect(j.ok).toBe(true);
  expect(j.parsed.url).toBe("https://arxiv.org/abs/1706.03762");
  expect(j.parsed.language.name).toBe("Hindi");
  expect(j.steps.map((s: { id: string }) => s.id)).toEqual(["read", "metadata", "authorship", "fraud", "fact", "provenance", "related", "translate"]);
  expect(j.steps.find((s: { id: string }) => s.id === "provenance").route).toBe("engine");
});

test("a news query plans headlines, router-dispatched search, briefing and translation", async ({ request }) => {
  const res = await request.post("/api/plan", { data: { mode: "news", query: NEWS } });
  const j = await res.json();
  expect(j.ok).toBe(true);
  expect(j.parsed).toMatchObject({ topic: "AI regulation", region: "India", category: "technology" });
  expect(j.steps.map((s: { id: string }) => s.id)).toEqual(["headlines", "search", "brief", "translate"]);
});

test("bad input is refused for free", async ({ request }) => {
  const res = await request.post("/api/plan", { data: { mode: "research", query: "no link here" } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/needs a link/);
});

test("the ledger and a bad signal hash both render", async ({ page }) => {
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ledger");
  await expect(page.getByText("Calls, all time")).toBeVisible();
  const res = await page.goto("/verify/0xnothex");
  expect(res?.status()).toBe(404);
});

test("the workbench runs every step and saves a shareable dossier, paid or not", async ({ page, request }) => {
  const health = await (await request.get("/api/health")).json();
  await page.goto("/");
  await page.getByRole("tab", { name: "Research paper" }).click();
  await page.getByLabel("Your question").fill(RESEARCH);
  await page.getByRole("button", { name: "Build the dossier" }).click();
  await expect(page.locator(".step")).toHaveCount(8);
  await expect(page.locator(".share")).toBeVisible({ timeout: 230_000 });
  const stepStates = await page.locator(".step").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  if (!health.paidWorkEnabled) {
    // Without a funded wallet the first steps fail honestly and the rest skip for lack of input.
    expect(stepStates.every((s) => s === "error" || s === "skipped")).toBe(true);
    await expect(page.locator(".step").first()).toContainText(/payer wallet|budget|Paused/);
  }
});

test("paid: a real research dossier carries signal hashes and settlements", async ({ page }) => {
  test.skip(process.env["E2E_PAID"] !== "1", "set E2E_PAID=1 to spend about $0.10 of testnet USDC");
  await page.goto("/");
  await page.getByRole("tab", { name: "Research paper" }).click();
  await page.getByLabel("Your question").fill(RESEARCH);
  await page.getByRole("button", { name: "Build the dossier" }).click();
  await expect(page.locator(".share")).toBeVisible({ timeout: 230_000 });
  const okSteps = await page.locator('.step[data-state="ok"]').count();
  expect(okSteps).toBeGreaterThanOrEqual(5);
  await expect(page.locator(".step").first()).toContainText("Signal");
  const hashLinks = await page.locator('.receipt a[href^="/verify/0x"]').count();
  expect(hashLinks).toBeGreaterThanOrEqual(5);
  await expect(page.locator(".totals")).toContainText("Telegraph calls");
});
