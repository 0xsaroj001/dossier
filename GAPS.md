# GAPS — what is missing, broken or unverified

Read before trusting a claim. Newest first within each state.

## Open

### G1 · The paid path has never run — BLOCKER until the operator runs it
Everything up to the payment is verified against the live node for free. The payment itself
needs the operator's key. The client is built the way the official Telegraph MCP client builds
it, on the same pinned `@x402/*` 2.24.0, with the request materialised before the payment
wrapper (ARCHITECTURE A9). Close by running `npm run live` twice (research, news) and pasting the
receipts here with the settlement hashes.

### G2 · microlink through the node is untested
Its manifest lives on the miner author's localhost, so the app assumes `GET /extract {url}` maps
to Microlink's metadata call. Direct to Microlink's host that call returns title, author,
description (the full arXiv abstract) and date. If the node maps it differently the step is
*unusable* and the abstract falls back to the netwire excerpt, which for arXiv pages is the
page chrome plus title and authors and rarely reaches the abstract. Then AI-text detection may
skip for lack of 40 words of prose. Watch the first live run.

### G3 · Free-text topics do not reach the #1 headlines miner
livecert's `/headlines` ignores anything that is not a Google News section ("artificial
intelligence" returned general headlines with `topic: null`; "technology" and "technology
headlines in India" worked). The parser maps topics to sections; a topic that maps to none skips
livecert and asks newswire-headlines, then newsapi. The briefing says which.

### G4 · CONTENT_VERIFICATION has one miner and it verifies images
The provenance step therefore goes through Telegraph's router with the verification question and
accepts CONTENT_VERIFICATION, ACADEMIC_SEARCH, FACT_CHECK, RESEARCH_QUERY, RESEARCH_SYNTHESIS or
WEB_SEARCH as an answer, else falls back to ACADEMIC_SEARCH by exact title. The intent the router
chose is on the receipt. If the router routes to the image miner, that call fails for free and
the fallback runs.

### G5 · The router's accept-lists may admit an off-target answer
A WEB_SEARCH miner answering the provenance question is accepted and its prose is searched for
the title; the *found* verdict then depends on that prose. The receipt shows the intent and miner
so a reader can weigh it.

### G6 · Memory store resets on every cold start
Without Upstash credentials the ledger, counters and dossiers live in the function instance.
Fine for local use; on Vercel set the Redis integration before sharing links.

### G7 · Abuse controls are per browser, not per person
Clearing the cookie resets the allowance; the global daily budget is the real ceiling. No IP
limits. Acceptable for a testnet budget the operator can pause.

### G8 · Translation is the first 700 characters
Cut at a sentence boundary. The translation miners' limits are undocumented; MyMemory rejects
over 500 bytes, so its adapter sends 480 characters.

### G9 · A slow miner plus a fallback does not fit in one function
Call timeout 45 s, router timeout 25 s, function limit 60 s. A timeout on the first miner leaves
no room for a second; the step fails with a timeout message and the next step proceeds. A timed
out call may still settle late; the chain count would show it and the ledger would not.

### G10 · Track 3 submission form not yet seen
Its field list is unknown. Repo, live URL, payer address, one-paragraph description and the X
handle are ready in DEMO.md.

### G11 · No X posts yet, no users yet
The 45% criterion is untouched until the deployment is public and shared.

### G12 · Visitors are browsers
A random cookie hashed with a salt. One person on two devices is two visitors; ten people reading
one shared dossier are zero. Published next to the number on `/ledger`.

### G13 · Related-work relevance
The #1 ACADEMIC_SEARCH miner ranks by OpenAlex relevance; searching a paper's exact title returned
loosely related work first in a free probe. The step is labelled "related scholarship", not
"citations".

## Closed

### G0 · Request shapes for all ten intents — CLOSED 2026-09-06 05:45 UTC
Every direct request the adapters build was sent unpaid to `POST /engine/v1/ask/{id}`; all
eleven returned the 402 challenge, none a 422, so the node accepts them as shaped.
