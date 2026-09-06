# ARCHITECTURE — Dossier

## Shape

Next.js 15 (App Router) on the Node runtime, deployed to Vercel. No database is required:
Upstash Redis is used when its REST credentials are present, memory otherwise. One payer wallet,
held by the operator, pays every x402 call. The app never calls a miner by name.

```
browser ──POST /api/plan──▶ parse the sentence, list the questions (free)
        ──POST /api/step──▶ run ONE question: guard → POST /engine/v1/ask → read → receipt → ledger row
        ──POST /api/step──▶ … next question, carrying the previous answers' data
        ──POST /api/dossier─▶ save the assembled case file, return /d/{id}
```

```
lib/parse.ts      sentence → {mode, url, topic, language, region, category}
lib/pipeline.ts   step specs, the two phrasings and context per step, runStep, summary
lib/adapters.ts   readers: how to understand each known miner's answer; generic fallback
lib/telegraph.ts  node client: x402-paying auto-routed ask, catalogue (to name and rank what
                  the router chose), signals, balance
lib/receipt.ts    confidence/label/answer from each miner's declared signal_mapping
lib/store.ts      ledger, counters, visitors, dossiers (memory | Upstash Redis)
lib/guard.ts      daily budget, per-browser allowance, pause
lib/chain.ts      the payer wallet's USDC transfers to the collector, from Blockscout
app/              pages: / (workbench), /d/[id], /ledger, /verify/[hash]; api routes
```

## Decisions

**A1. One question per HTTP request, driven by the browser.** A research dossier is eight paid
questions and a FACT_CHECK miner alone can take 30 seconds. Running the whole pipeline in one
serverless function would blow the 60-second ceiling and show nothing until the end. Each
question is its own request with its own budget; the page fills in as receipts arrive;
questions run one after another because two payments in flight from one wallet are refused by
the facilitator.

**A2. Everything goes through Telegraph's router.** Every step is an auto-routed
`POST /engine/v1/ask {query, context?}`. The network's LLM router classifies the intent, picks a
ranked miner and keeps a fallback behind it; the response carries the intent, the miner and the
router's reasoning, all of which land on the receipt. The direct path
(`/engine/v1/ask/{minerId}`) is not used anywhere: the protocol's judgement about who should
answer is the product, not something to route around.

**A3. Short questions, structured hints.** The classifier sees a natural sentence; anything
long or exact (the abstract to classify, the text to translate, the briefing material) also
travels in `context`, which the node merges into the routed request body. The question repeats
the passage too, so a miner that reads only the verbatim query still gets it.

**A4. Two phrasings per step, and a verdict on every answer.** Each step declares the intents
it can accept. The first phrasing is sent; if the node refuses for free, the miner's answer
cannot serve the step (*unusable*), or the router filed it under an intent the step cannot use
(*off-target*), the second phrasing is sent once. A timeout is never re-asked, because the call
may still settle. Steps whose meaning depends on the intent (extraction, detection,
fact-check, translation) are *strict* and never use an off-target answer; the others keep a
usable off-target answer and say so on the receipt.

**A5. Readers, not request builders.** The app cannot choose the miner, so it only has to
understand answers. Known miners for each intent have an exact reader taken from their manifest
and live probes (an arXiv page read by the page extractor is parsed for title, authors and
date; the AI-text leader's confidence is read as P(AI-written); a translation engine's
`translation: null` is *unusable*). Unknown miners are read through the generic receipt text
and the step's data is built from that.

**A6. Receipts read the miner's own `signal_mapping`.** Confidence, label and reason come from
the fields each miner declares, normalised from 0–1, 0–100 and strings; a declared field that is
really a risk score is labelled as such rather than shown as certainty.

**A7. Spending is off unless deliberately on, and capped per payment.** No key, zero budget and
no pause flag is the default. A global daily budget, a per-browser daily allowance (a random
cookie, stored only as a salted hash) and a pause flag are checked before every question. The
router may pick a miner charging more than a cent, so the x402 client's spend controls cap every
payment at `MAX_CALL_PRICE_USDC`; a payment above the cap is never constructed and costs
nothing.

**A8. Dossiers are saved only with receipts the app itself recorded.** The browser assembles the
dossier from step results and posts it back; the server keeps a step's receipt only if its
signal hash is in the ledger. A shared page therefore cannot show a receipt the app never got.

**A9. Two counts of the same thing.** The ledger is the app's record. The chain is not: the
payer wallet's USDC transfers to the Telegraph collector are read from Blockscout and shown
beside the ledger, with the number of ledger settlements found among them. Judges can count the
calls without trusting the app.

**A10. Failures are surfaced, never smoothed.** Skipped steps say why, failed steps say whether
anything was charged, *unusable* and *off-target* are their own states, and the summary lists
failures as lines, not as absence.

**A11. The Request is materialised before the payment wrapper sees it.** `wrapFetchWithPayment`
clones the request for the paid retry; on a serverless runtime the `(url, init)` form lost its
body on the retry and the node answered with a bare challenge. Building `new Request(...)` first
is the fix; do not simplify it away without re-running a paid call on the deployment.

## Data

- `LedgerRow`: one per question, with the step's intent and the router's intent, status
  `ok | unusable | error | timeout | unpaid`, miner, rank, confidence, cost, latency, signal hash,
  settlement tx, visitor hash, and a 160-character preview.
- `Dossier`: mode, query, parsed fields, steps with receipts, attempts and structured data,
  summary lines and totals. Stored 90 days in Redis, 500 in memory.
- Redis keys are prefixed `dz:`; counters per UTC day expire after three days.

## Environment

See `.env.example`. `PAYER_PRIVATE_KEY` accepts MetaMask's bare 64-hex export or the `0x` form.
`TELEGRAPH_NODE` defaults to `https://devnode.telegraphprotocol.com`. Base Sepolia, USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, collector
`0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8`, network id `eip155:84532`.
