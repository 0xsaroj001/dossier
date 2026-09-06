# DEMO — the judge journey

Exact steps, exact expected output. Everything before "Paid" costs nothing.

## 0. Fresh clone

```bash
git clone https://github.com/0xsaroj001/dossier && cd dossier && npm ci
```

```bash
npm run typecheck && npm test
```

Expected: `tsc` prints nothing; vitest ends with `Test Files  6 passed (6)` and `Tests  45 passed (45)`.

## 1. Preflight, free

```bash
cp .env.example .env.local
```

Fill `PAYER_PRIVATE_KEY`, set `DAILY_CALL_BUDGET=400`, a random `VISITOR_SALT`. Then:

```bash
npm run preflight
```

Expected (2026-09-06 shape; miners and ranks move with each 9-hour epoch):

```
== environment
node             https://devnode.telegraphprotocol.com
payer            0x…
daily budget     400 calls, per visitor 64, price cap $0.02
paid work        ENABLED
usdc balance     20.00

== 402 challenge (free)
status           402
network          ok  eip155:84532
asset            ok  0x036CbD53842c5426634e7929541eC2318f3dCF7e
payTo            ok  0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8
amount           ok  $0.01

== who would serve each step today (leaderboard, price cap, adapter fit)
read        CONTENT_EXTRACTION    netwire-content-extraction#2, microlink-url-extraction#3 (3 listed)
metadata    CONTENT_EXTRACTION    netwire-content-extraction#2, microlink-url-extraction#3 (3 listed)
authorship  AI_TEXT_DETECTION     caliber-truthport-text-auth#1, livecert#2, veritarach-ai-text-detector#3 (4 listed)
fraud       FRAUD_DETECTION       sarzops-transaction-risk#1, degenlens-onchain#2, chainsight-oracle#4 (15 listed)
fact        FACT_CHECK            qarinah-proofpack#1, livecert#2, tavily#3 (4 listed)
provenance  ACADEMIC_SEARCH       router first, then txlens#1, livecert#2, scholarwire-academic-search#4 (6 listed)
related     ACADEMIC_SEARCH       txlens#1, livecert#2, scholarwire-academic-search#4 (6 listed)
translate   LANGUAGE_TRANSLATION  livecert#1, langwire-translation#2, test-mymemory-translate#3 (4 listed)
headlines   NEWS_HEADLINES        livecert#1, newswire-headlines#2, newsapi#3 (3 listed)
search      NEWS_SEARCH           router first, then verity-news-search#1, tavily#2, gnews#3 (5 listed)
brief       CHAT_COMPLETION       groq-llama31-instant-miner#1, gemini#2 (3 listed)

preflight clean
```

## 2. Paid: one dossier from the command line (about $0.08)

```bash
npm run live -- research "https://arxiv.org/abs/1706.03762 in Hindi"
```

Expected shape, one line per step (miners, confidences and hashes will differ):

```
payer 0x… · research · 8 steps · "https://arxiv.org/abs/1706.03762 in Hindi"
- read        CONTENT_EXTRACTION    ok  netwire-content-extraction#2 via direct · conf 0.95 · $0.01 · 1200ms · signal 0x… · tx 0x…
- metadata    CONTENT_EXTRACTION    ok  microlink-url-extraction#3 via direct · …
- authorship  AI_TEXT_DETECTION     ok  caliber-truthport-text-auth#1 via direct · conf 0.75 · …
- fraud       FRAUD_DETECTION       ok  sarzops-transaction-risk#1 via direct · conf 0.6 · …
- fact        FACT_CHECK            ok  qarinah-proofpack#1 via direct · conf … · … · 12000ms · …
- provenance  CONTENT_VERIFICATION  ok  <miner>#<rank> via router→<INTENT> · …
- related     ACADEMIC_SEARCH       ok  txlens#1 via direct · …
- translate   LANGUAGE_TRANSLATION  ok  livecert#1 via direct · conf 1 · …

8/8 steps answered · 8 calls · $0.08 · intents: CONTENT_EXTRACTION, AI_TEXT_DETECTION, …
```

A step may show `ERROR` with the miner named and "failed calls are not charged", or list an
*unusable* attempt followed by the next-ranked miner. The exit code is 0 when at least half the
steps answered.

```bash
npm run live -- news "AI regulation in India, in Hindi"
```

Expected: four steps, `headlines` from livecert (section technology, region India), `search`
via the router, `brief` from groq-llama31-instant-miner, `translate` from livecert.

## 3. The site

```bash
npm run dev
```

1. Open <http://localhost:3000>. Heading: **Ask once. Get the case file.** Two tabs: Research
   paper, News topic.
2. Click the first example, *Extract the research paper at https://arxiv.org/abs/1706.03762 in
   Hindi*, then **Build the dossier**.
3. Eight step cards appear, numbered 01–08, each with its intent chip. They fill in one at a
   time: a spinner, then a stamp (`human_written`, `RECHECK`, `SUPPORTED`, `found`,
   `translated` …), a receipt block (miner and rank, chosen by, confidence bar, cost and
   latency, signal link, settlement link, routing sentence) and the answer.
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
   N appear among them"), the intents served, recent dossiers, and the calls table.
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
news topic; it plans up to eight paid calls across seven canonical intents (extraction, AI-text
detection, fraud, fact-check, router-dispatched provenance, academic search, translation, or
headlines, router-dispatched news search, chat completion, translation), calls the best-ranked
miner for each, and returns one document where every line carries the miner, its rank, its
confidence, the cost, the signal hash and the on-chain settlement. Every call is on a public
ledger and counted again from the payer wallet's USDC transfers on Base Sepolia.*

Live: `https://<deployment>` · Repo: `https://github.com/0xsaroj001/dossier` · Payer: `0x…`
