# GAPS — what is missing, broken or unverified

Read before trusting a claim. Newest first within each state.

## Open

### G1b · The deployment cannot pay until the operator adds the key and Redis
<https://dossier-wukong4.vercel.app> is live with the budget, caps and salt set. `PAYER_PRIVATE_KEY`
must be added by the operator (`vercel env add PAYER_PRIVATE_KEY production`, or the dashboard)
and Upstash Redis connected from the Storage tab, then redeploy. Until then `/api/health` says
`payerConfigured: false` and `store: "memory"`.

### G2 · What `context` does to the miner's parameters is not pinned down
The docs say it is "merged into the routed request body". Whether it overrides or yields to the
parameters the router fills from the question is unknown, and whether a strict miner rejects an
unknown key (qarinah declares `additionalProperties: false`) is unknown. The app sends `context`
only where the payload is long or structured (url, text, target language, chat messages) and
repeats the passage in the question itself. Watch the first live run for `warnings` on the
receipts.

### G3 · The page is read by the app, not by the network
Verified with paid probes on 2026-09-06: every phrasing containing a link was routed to
livecert (#1 for CONTENT_EXTRACTION), whose `/extract` reads inline text and returned empty
fields; "search the web for arXiv 1706.03762" went to an academic search of the literal string.
Dossier therefore reads the page's metadata tags itself (ARCHITECTURE A2b), labelled as free.
Pages without `citation_*` or Open Graph abstracts (many publisher paywalls) give a title and
no abstract; the abstract-dependent steps then skip and say why.

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

### G15 · Network-wide settlement outage, 2026-09-06 from 09:18 UTC
Every payment from any wallet has been refused with `insufficient_credits: facilitator returned
403` since the last settlement to the collector at 09:17:50 UTC (read from Blockscout at 11:05).
Dossier's own probe from the operator's machine and the paid journey on production both hit it.
Nothing in the app can fix it; every step shows the node's message and that nothing was
charged. Re-run `npm run ask -- "test"` to see when it clears.

### G16 · Without Redis, production instances do not share memory
Vercel runs several instances; a ledger row written by one is invisible to another. Production
showed `calls: 0` beside `dossiers: 2` for exactly this reason. Connect Upstash Redis before
sharing the link.

## Closed

### G1 · The paid path — CLOSED 2026-09-06 ~09:40 UTC, paying locally
Payer `0xFEc66E0F5c64296fF190EdCeD88C781eeEdFd9d3`. First routed calls settled at $0.01 each (for
example signal `0x216578cd…` → tx `0xd38f1c13…`, signal `0xf048a710…` → tx `0x3fd5e3d4…`). The
news dossier answered 4/4 through the router (livecert, verity-news-search, newswire-search,
test-mymemory-translate). Two research dossiers through the UI passed the paid journey test
(at least five steps with signal hashes each). Two early `unpaid` refusals were transient and
did not recur.

### G0 · Direct-dispatch request shapes — SUPERSEDED 2026-09-06 06:20 UTC
Eleven direct payloads had been validated against the node's free pre-check. The operator then
ruled out direct dispatch altogether; every question now goes through the router and those
shapes are no longer sent. The readers built from the same probes remain.
