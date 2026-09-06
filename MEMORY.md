# MEMORY — decisions made and lessons learned

Read first every session. Keep it short: decisions and why, lessons and what they cost.

## 2026-09-06 — Build day

**Decisions**

- **Everything through Telegraph's router; no direct dispatch.** The first build chose miners
  from the leaderboard and called them by id for typed inputs. The operator ruled that out at
  about 06:20 UTC: auto-routing is the protocol's judgement and the product should rest on it.
  `askDirect` and the request builders were removed; each step now has two phrasings, an
  accept-list of intents, and a reader for the answer (ARCHITECTURE A2–A5).
- One question per request, browser-driven (A1). A whole dossier in one function would not fit
  60 seconds and would show nothing until the end.
- Price cap $0.02 inside the x402 client's spend controls, because the router may pick a miner
  charging $0.20 (zengawd, FRAUD_DETECTION) and the app can no longer screen prices beforehand.
- No Telegram, no MCP, no API keys. Scope is the two modes and the receipts; distribution is
  the web link.
- Docs follow the hackathon framework: PRD, ARCHITECTURE, PHASES, GAPS, MEMORY, DEMO.

**Lessons from the live node and the docs, all free**

- `POST /engine/v1/ask` takes `{query, context?}`; `context` is "merged into the routed request
  body" for structured hints. The response carries `intent`, `reasoning`, `miner_id`,
  `miner_name` (which "may be the fallback rather than the router's first pick"), `endpoint`,
  `signal_hash`, `warnings`. On the routed path nothing is ever blocked by pre-validation.
- The node's pre-validation is a free test harness for the *direct* path only; on the routed
  path the payment gate runs first, so a routed question cannot be probed for free.
- The dispatcher OpenAPI (`/miner-dispatcher/openapi.json`, 2.3 MB) is keyed by numeric miner
  id (`/v1/4433/extract`), not slug.
- livecert's `/extract` is a structured extractor for inline text; it fetches nothing. The URL
  readers are netwire (returns a 500-character excerpt whose arXiv chrome carries title,
  authors and date) and microlink (metadata incl. the abstract).
- livecert's `/headlines` honours Google News sections and a region in the question, and
  ignores free-text topics.
- langwire (Apertium) lacks Hindi and answers 200 with `translation: null`; a 2xx that cannot be
  used must be its own state, or the step would show an empty answer as success.
- caliber-truthport's `confidence` is P(AI-written), not certainty for its label.
- sarzops answers research-paper fraud questions sensibly ("no documented concerns…") and
  marks itself `RECHECK` at 0.6; qarinah takes 8–30 seconds.
- x402 2.24.0 exports `wrapFetchWithPayment`, `x402Client.fromConfig` (with `spendControls:
  {maxAmountPerPayment: "$0.02"}`), `toClientEvmSigner` (one argument is enough),
  `ExactEvmScheme`. The docs' `createSigner` does not exist there.
- The settlement transaction is only in the `payment-response` header of the paying request;
  the signal record served later does not carry it.
- Blockscout's `token-transfers?type=ERC-20&filter=from` gives `transaction_hash`, `to.hash`,
  `token.address_hash`, `total.value`, and `next_page_params` for paging.

**Cost of the day's mistakes**

- Building direct dispatch first cost about an hour and a rewrite. The question that would have
  saved it: "should the app ever name a miner, or is the router the point?" Ask it before
  building anything that chooses on the network's behalf.
- Two unit tests caught my own helpers: the numbered-title regex ran across a quoted title, and
  the claim picker preferred "we propose" over "experiments show". Ten minutes each.
