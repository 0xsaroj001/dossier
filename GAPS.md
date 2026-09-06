# GAPS — what is missing, broken or unverified

Read before trusting a claim. Newest first within each state.

## Open

### G1 · The paid path has never run — BLOCKER until the operator runs it
Everything up to the payment is verified against the live node for free. The payment itself
needs the operator's key. The client is built the way the official Telegraph MCP client builds
it, on the same pinned `@x402/*` 2.24.0, with the request materialised before the payment
wrapper (ARCHITECTURE A11) and a $0.02 per-payment cap in the client's spend controls. Close by
running `npm run live` twice (research, news) and pasting the receipts here with the settlement
hashes.

### G2 · What `context` does to the miner's parameters is not pinned down
The docs say it is "merged into the routed request body". Whether it overrides or yields to the
parameters the router fills from the question is unknown, and whether a strict miner rejects an
unknown key (qarinah declares `additionalProperties: false`) is unknown. The app sends `context`
only where the payload is long or structured (url, text, target language, chat messages) and
repeats the passage in the question itself. Watch the first live run for `warnings` on the
receipts.

### G3 · The router may hand a link to the inline extractor
livecert is #1 for CONTENT_EXTRACTION and reads inline text; it fetches nothing. If the router
sends a page question there, the answer is fields pulled from the question string. The reader
marks that *unusable* and the second phrasing is sent, which is a second draw, not a guarantee.
Two extraction questions per dossier (the page, then the abstract) give two more draws; when no
abstract is obtained, later steps say so and work from the page excerpt or the title.

### G4 · CONTENT_VERIFICATION has one miner and it verifies images
The provenance question is put to the router as written and accepted under
CONTENT_VERIFICATION, ACADEMIC_SEARCH, FACT_CHECK, RESEARCH_QUERY, RESEARCH_SYNTHESIS or
WEB_SEARCH. If the router routes to the image miner, that call fails for free and the second
phrasing ("search the academic literature for a paper titled …") is sent.

### G5 · Off-target answers are kept for the non-strict steps
A WEB_SEARCH miner answering the provenance question is accepted and its prose is searched for
the title; the *found* verdict then depends on that prose. The receipt shows the intent and the
miner, and the routing line says it was filed elsewhere.

### G6 · Free-text topics and the #1 headlines miner
livecert's `/headlines` honours Google News sections and a region, not free-text topics. Whether
the router's parameter filling maps "AI regulation" to a section is unknown; the second phrasing
names the section the parser detected. The briefing names its sources either way.

### G7 · Memory store resets on every cold start
Without Upstash credentials the ledger, counters and dossiers live in the function instance.
Fine for local use; on Vercel set the Redis integration before sharing links.

### G8 · Abuse controls are per browser, not per person
Clearing the cookie resets the allowance; the global daily budget is the real ceiling. No IP
limits. Acceptable for a testnet budget the operator can pause.

### G9 · Translation is the first 700 characters
Cut at a sentence boundary. The translation miners' limits are undocumented.

### G10 · One slow question fills the function
Router timeout 48 s inside a 60 s function. A timed-out question is not re-asked (it may still
settle late; the chain count would show it and the ledger would not) and the step fails with a
timeout message.

### G11 · Track 3 submission form not yet seen
Its field list is unknown. Repo, live URL, payer address, one-paragraph description and the X
handle are ready in DEMO.md.

### G12 · No X posts yet, no users yet
The 45% criterion is untouched until the deployment is public and shared.

### G13 · Visitors are browsers
A random cookie hashed with a salt. One person on two devices is two visitors; ten people reading
one shared dossier are zero. Published next to the number on `/ledger`.

### G14 · Router accuracy on long questions is unmeasured
The AI-text and translation questions carry up to 4,000 characters of passage. Whether the
classifier still files them correctly, and whether it truncates what it copies into the miner's
`text`, can only be seen with paid traffic. `context` carries the exact passage as a hedge.

## Closed

### G0 · Direct-dispatch request shapes — SUPERSEDED 2026-09-06 06:20 UTC
Eleven direct payloads had been validated against the node's free pre-check. The operator then
ruled out direct dispatch altogether; every question now goes through the router and those
shapes are no longer sent. The readers built from the same probes remain.
