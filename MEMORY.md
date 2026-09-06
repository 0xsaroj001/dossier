# MEMORY — decisions made and lessons learned

Read first every session. Keep it short: decisions and why, lessons and what they cost.

## 2026-09-06 — Build day

**Decisions**

- One step per request, browser-driven (ARCHITECTURE A1). A whole dossier in one function
  would not fit 60 seconds and would show nothing until the end.
- Router for open questions, direct-by-leaderboard for payloads (A2). Both are Telegraph
  choosing; the app never re-ranks.
- Price cap $0.02. One FRAUD_DETECTION miner (zengawd) charges $0.20 per call; without the cap a
  fallback could cost twenty calls' worth.
- No Telegram, no MCP, no API keys. Scope is the two modes and the receipts; distribution is
  the web link.
- Docs follow the hackathon framework: PRD, ARCHITECTURE, PHASES, GAPS, MEMORY, DEMO.

**Lessons from the live node, all free**

- The node's pre-validation is a free test harness: an unpaid `POST /engine/v1/ask/{id}` answers
  402 when the request shape is acceptable and 422 when the node would refuse. Every adapter
  was checked this way before any key existed.
- The dispatcher OpenAPI (`/miner-dispatcher/openapi.json`, 2.3 MB) is keyed by numeric miner
  id (`/v1/4433/extract`), not slug. The catalogue merges every endpoint's parameters into one
  `input_schema`, so per-endpoint parameters must come from the manifest or the OpenAPI.
- livecert's `/extract` is a structured extractor for inline text (dates, contacts,
  quantities); it fetches nothing. The URL readers are netwire (`url`, `question`; returns a
  500-character excerpt) and microlink (metadata incl. the abstract).
- livecert's `/headlines` honours Google News sections and a region in the question
  ("technology headlines in India"), and ignores free-text topics.
- langwire (Apertium) lacks Hindi and answers 200 with `translation: null`; a 2xx that cannot be
  used must be its own state, or the step would show an empty answer as success.
- caliber-truthport's `confidence` is P(AI-written), not certainty for its label.
- sarzops answers research-paper fraud questions sensibly ("no documented concerns…") and
  marks itself `RECHECK` at 0.6; qarinah takes 8–30 seconds.
- x402 2.24.0 exports `wrapFetchWithPayment`, `x402Client.fromConfig`, `toClientEvmSigner`
  (one argument is enough), `ExactEvmScheme`. The docs' `createSigner` does not exist there.
- The settlement transaction is only in the `payment-response` header of the paying request;
  the signal record served later does not carry it.
- Blockscout's `token-transfers?type=ERC-20&filter=from` gives `transaction_hash`, `to.hash`,
  `token.address_hash`, `total.value`, and `next_page_params` for paging.

**Cost of the day's mistakes**

- Two unit tests caught my own helpers: the numbered-title regex ran across a quoted title, and
  the claim picker preferred "we propose" over "experiments show". Ten minutes each. Worth the
  tests.
