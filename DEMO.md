# DEMO — the judge journey

Exact steps, exact expected output. Everything before "Paid" costs nothing.

## 0. Fresh clone

```bash
git clone https://github.com/0xsaroj001/dossier && cd dossier && npm ci
```

```bash
npm run typecheck && npm test
```

Expected: `tsc` prints nothing; vitest ends with `Test Files  6 passed (6)` and `Tests  50 passed (50)`.

## 1. Preflight, free

```bash
cp .env.example .env.local
```

Fill `PAYER_PRIVATE_KEY`, set `DAILY_CALL_BUDGET=400`, a random `VISITOR_SALT`. Then:

```bash
npm run preflight
```

Expected (2026-09-06 shape; leaders move with each 9-hour epoch):

```
== environment
node             https://devnode.telegraphprotocol.com
payer            0x…
daily budget     400 calls, per visitor 64, price cap $0.02, router timeout 48000 ms
paid work        ENABLED
usdc balance     20.00

== 402 challenge (free)
status           402
network          ok  eip155:84532
asset            ok  0x036CbD53842c5426634e7929541eC2318f3dCF7e
payTo            ok  0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8
amount           ok  $0.01

== the questions, and who leads each intent today (the router chooses; this is who it is likely to choose)
read        CONTENT_EXTRACTION    livecert#1, netwire-content-extraction#2, microlink-url-extraction#3
            accepts CONTENT_EXTRACTION
            asks    Read the research paper page at https://arxiv.org/abs/1706.03762 and extract its full title, all authors…
abstract    CONTENT_EXTRACTION    …
authorship  AI_TEXT_DETECTION     caliber-truthport-text-auth#1, livecert#2, veritarach-ai-text-detector#3
…
translate   LANGUAGE_TRANSLATION  livecert#1, langwire-translation#2, test-mymemory-translate#3
headlines   NEWS_HEADLINES        livecert#1, newswire-headlines#2, newsapi#3
search      NEWS_SEARCH           verity-news-search#1, tavily#2, gnews#3
brief       CHAT_COMPLETION       groq-llama31-instant-miner#1, gemini#2, litellm#3
…
preflight clean
```

## 2. Paid: one dossier from the command line (about $0.08)

```bash
npm run live -- research "https://arxiv.org/abs/1706.03762 in Hindi"
```

Expected shape, one line per question (miners, confidences and hashes will differ):

```
payer 0x… · research · 8 steps · "https://arxiv.org/abs/1706.03762 in Hindi"
- read        CONTENT_EXTRACTION    ok  netwire-content-extraction#2 routed as CONTENT_EXTRACTION · conf 0.95 · $0.01 · 1200ms · signal 0x… · tx 0x…
- abstract    CONTENT_EXTRACTION    ok  microlink-url-extraction#3 routed as CONTENT_EXTRACTION · …
- authorship  AI_TEXT_DETECTION     ok  caliber-truthport-text-auth#1 routed as AI_TEXT_DETECTION · conf 0.75 · …
- fraud       FRAUD_DETECTION       ok  sarzops-transaction-risk#1 routed as FRAUD_DETECTION · conf 0.6 · …
- fact        FACT_CHECK            ok  qarinah-proofpack#1 routed as FACT_CHECK · conf … · … · 12000ms · …
- provenance  CONTENT_VERIFICATION  ok  <miner>#<rank> routed as <INTENT> · …
- related     ACADEMIC_SEARCH       ok  txlens#1 routed as ACADEMIC_SEARCH · …
- translate   LANGUAGE_TRANSLATION  ok  livecert#1 routed as LANGUAGE_TRANSLATION · conf 1 · …

8/8 steps answered · 8 calls · $0.08 · intents: CONTENT_EXTRACTION, AI_TEXT_DETECTION, …
```

A step may show `ERROR` with the reason and whether anything was charged, or list a first ask
that was *unusable* or *off-target* followed by the second phrasing. The exit code is 0 when at
least half the steps answered.

```bash
npm run live -- news "AI regulation in India, in Hindi"
```

Expected: four questions; `headlines` and `search` routed to news miners, `brief` to a
CHAT_COMPLETION miner, `translate` to a LANGUAGE_TRANSLATION miner.

## 3. The site

```bash
npm run dev
```

1. Open <http://localhost:3000>. Heading: **Ask once. Get the case file.** Two tabs: Research
   paper, News topic.
2. Click the first example, *Extract the research paper at https://arxiv.org/abs/1706.03762 in
   Hindi*, then **Build the dossier**.
3. Eight step cards appear, numbered 01–08, each with its intent chip. They fill in one at a
   time: a spinner, then a stamp (`read`, `human_written`, `RECHECK`, `SUPPORTED`, `found`,
   `translated` …), a receipt block (miner and rank, routed as, confidence bar, cost and
   latency, signal link, settlement link, the router's reasoning) and the answer. A step that
   needed its second phrasing lists both asks under the receipt.
4. The paper card fills with title, authors, year, abstract, and the abstract in Hindi. The
   verdict grid shows Authorship, Fraud record, Key claim, Provenance.
5. The case summary lists one line per step and the totals: `8 Telegraph calls · 8 steps
   answered · $0.08 USDC paid · 7 intents · N miners`. A share box shows `/d/{id}`.
6. Open the share link in a private window: the same dossier, server-rendered, with "A saved
   dossier. Build your own →".
7. Click a signal link: `/verify/{hash}` shows the node's record, the payer wallet with the
   stamp **this app**, "In this app's ledger: yes", and the raw record.
8. Open `/ledger`: the seven stat tiles, the on-chain paragraph ("Payer wallet 0x… has made N
   USDC transfers to the Telegraph collector … Of the N settlement hashes on this ledger page,
   N appear among them"), the intents served, recent dossiers, and the calls table with the
   step's intent and what the router routed it as.
9. Switch to **News topic**, click *What's the latest on AI regulation in India, in Hindi*,
   **Brief me**. Four steps; the briefing card fills last, then its Hindi translation.

## 4. Judge journey, automated

```bash
npm run e2e
```

Expected: `7 passed`, `1 skipped` (the paid test). Against the deployment, with the paid test:

```bash
BASE_URL=https://<deployment> E2E_PAID=1 npm run e2e
```

Expected: `8 passed`.

## 5. Ship

Push as the project's GitHub account (the repo's local identity is already set to it):

```bash
gh auth login
```

```bash
gh repo create 0xsaroj001/dossier --public --source=. --remote=origin --push
```

On Vercel (the project's own account, not any other): **Add New → Project → Import**
`0xsaroj001/dossier`; framework Next.js is detected; add the variables from `.env.example`;
**Storage → Upstash Redis → Connect**; deploy; then set `PUBLIC_URL` to the deployment URL and
redeploy. Verify with `curl https://<deployment>/api/health` (`payerConfigured: true`,
`paidWorkEnabled: true`, `store: "redis"`).

## 6. Submission text

*Dossier turns one question into a case file from the Telegraph network. Paste a paper or name a
news topic; it plans up to eight questions across seven canonical intents (extraction, AI-text
detection, fraud, fact-check, provenance, academic search, translation, or headlines, news
search, chat completion, translation), puts every one to Telegraph's own router, and returns one
document where every line carries the miner, its rank, the router's reasoning, its confidence,
the cost, the signal hash and the on-chain settlement. Every call is on a public ledger and
counted again from the payer wallet's USDC transfers on Base Sepolia.*

Live: `https://<deployment>` · Repo: `https://github.com/0xsaroj001/dossier` · Payer: `0x…`
