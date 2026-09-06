# ARCHITECTURE — Dossier

## Shape

Next.js 15 (App Router) on the Node runtime, deployed to Vercel. No database is required:
Upstash Redis is used when its REST credentials are present, memory otherwise. One payer wallet,
held by the operator, pays every x402 call.

```
browser ──POST /api/plan──▶ parse the sentence, list the steps (free)
        ──POST /api/step──▶ run ONE step: guard → pick miner → pay → receipt → ledger row
        ──POST /api/step──▶ … next step, carrying the previous steps' data
        ──POST /api/dossier─▶ save the assembled case file, return /d/{id}
```

```
lib/parse.ts      sentence → {mode, url, topic, language, region, category}
lib/pipeline.ts   step specs, per-step input derivation, runStep (router or direct), summary
lib/adapters.ts   how to ask each known miner and how to read its answer; generic fallback
lib/telegraph.ts  node client: x402-paying fetch, direct and routed asks, catalogue, signals
lib/receipt.ts    confidence/label/answer from each miner's declared signal_mapping
lib/store.ts      ledger, counters, visitors, dossiers (memory | Upstash Redis)
lib/guard.ts      daily budget, per-browser allowance, pause, price cap
lib/chain.ts      the payer wallet's USDC transfers to the collector, from Blockscout
app/              pages: / (workbench), /d/[id], /ledger, /verify/[hash]; api routes
```

## Decisions

**A1. One step per HTTP request, driven by the browser.** A research dossier is eight paid calls
and a FACT_CHECK miner alone can take 30 seconds. Running the whole pipeline in one serverless
function would blow the 60-second ceiling and show nothing until the end. Each step is its own
request with its own budget; the page fills in as receipts arrive; steps run one after another
because two payments in flight from one wallet are refused by the facilitator.

**A2. Direct calls for typed inputs, the router for open questions.** When a step must deliver a
passage verbatim (AI-text detection, translation) or a URL, the app reads the live leaderboard
(`/api/miners?intent=…`) and calls the best-ranked miner whose declared inputs fit, through
`POST /engine/v1/ask/{minerId}`. When the step is a question rather than a payload (provenance,
recent coverage), it goes to `POST /engine/v1/ask` and Telegraph's router picks the intent and
the miner. Each router step carries an accept-list of intents; anything else, or any failure,
falls back to a direct call, and both attempts are shown.

**A3. Adapters per miner, read from their manifests, with a schema-driven fallback.** Miners do not
share request shapes: one extractor takes `url`, another takes inline `text`; one translator
takes `target_language`, another `to`, another `langpair`. The known top miners for each intent
have an exact adapter; unknown miners get a guess from their input schema, or are skipped when
the schema needs typed input the step cannot supply. Every adapter's request shape was validated
against the node's free pre-check on 2026-09-06 (a 402 challenge means accepted; 422 means the
node would refuse for free).

**A4. Receipts read the miner's own `signal_mapping`.** Confidence, label and reason come from
the fields each miner declares, normalised from 0–1, 0–100 and strings; a declared field that is
really a risk score is labelled as such rather than shown as certainty. The AI-text leader
reports P(AI-written) in its confidence field, so its adapter shows both that and the certainty
for the stated label.

**A5. Spending is off unless deliberately on.** No key, zero budget and no pause flag is the
default. A global daily budget, a per-browser daily allowance (a random cookie, stored only as a
salted hash), a price cap of $0.02 per call and a pause flag are checked before every attempt.

**A6. Dossiers are saved only with receipts the app itself recorded.** The browser assembles the
dossier from step results and posts it back; the server keeps a step's receipt only if its
signal hash is in the ledger. A shared page therefore cannot show a receipt the app never got.

**A7. Two counts of the same thing.** The ledger is the app's record. The chain is not: the
payer wallet's USDC transfers to the Telegraph collector are read from Blockscout and shown
beside the ledger, with the number of ledger settlements found among them. Judges can count the
calls without trusting the app.

**A8. Failures are surfaced, never smoothed.** Skipped steps say why, failed steps name the miner
and say whether anything was charged, and *unusable* is its own state for a miner that answered
but could not serve the step. The summary lists failures as lines, not as absence.

**A9. The Request is materialised before the payment wrapper sees it.** `wrapFetchWithPayment`
clones the request for the paid retry; on a serverless runtime the `(url, init)` form lost its
body on the retry and the node answered with a bare challenge. Building `new Request(...)` first
is the fix the official client's users found; do not simplify it away without re-running a paid
call on the deployment.

**A10. Nothing sits between the user and the protocol's judgement.** No re-ranking, no podium,
no automatic second opinion. The leaderboard picks, the router picks, the receipts show it.

## Data

- `LedgerRow`: one per attempt (router or direct), with status `ok | unusable | error | timeout |
  unpaid`, miner, rank, routing, confidence, cost, latency, signal hash, settlement tx, visitor
  hash, and a 160-character preview.
- `Dossier`: mode, query, parsed fields, steps with receipts and structured data, summary lines
  and totals. Stored 90 days in Redis, 500 in memory.
- Redis keys are prefixed `dz:`; counters per UTC day expire after three days.

## Environment

See `.env.example`. `PAYER_PRIVATE_KEY` accepts MetaMask's bare 64-hex export or the `0x` form.
`TELEGRAPH_NODE` defaults to `https://devnode.telegraphprotocol.com`. Base Sepolia, USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, collector
`0x5a2324aA18613FAD4e44bDF0d6c73Ec1f6D87ff8`, network id `eip155:84532`.
