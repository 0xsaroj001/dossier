# PRD — Dossier

Telegraph Hackathon Season I, Track 3 (Applications). Track window Aug 31 – Sep 7 2026; the
submission form closes **2026-09-07 23:59:59 UTC**. Written 2026-09-06.

## Claim

**Anyone with a link or a topic can now get a verified, multi-intent case file from the
Telegraph network in one question**, because we solved the composition problem: one sentence
is planned into a fixed sequence of canonical intents, each step is paid to the best-ranked
miner that can take its input (or handed to Telegraph's own router), and the receipts are
stitched into one dossier that can be checked step by step on the node and on the chain.

## Reality checks

### Jargon strip

Telegraph is a market where small programs called miners answer questions for about a cent
each, and get ranked by how good their answers are. Most apps built on it ask one question and
show one answer. Dossier takes one request, such as "read this paper in Hindi", and turns it into
eight questions for eight different specialists: what does the page say, who wrote it and when,
was the abstract written by a machine, has the paper been retracted or faked, is its main claim
true, does it exist in the library under that name, what else has been written on the subject,
and how does it read in Hindi. Each answer comes back with a receipt: who answered, how sure
they were, what it cost, and the blockchain record of the payment. News works the same way
with today's headlines, the week's articles and a written briefing.

### Status quo

A person vetting a paper today opens five tabs: the paper, Google Scholar, Retraction Watch, an
AI-text detector, a translator. It takes ten minutes and leaves no record. On Telegraph, the
organisers' reference apps and the first-week Track 3 entries ask one intent per question. The
judging rubric names "multi-intent & cross-domain" and "signal quality & verification" as
high-value areas precisely because nothing composes the network yet. That is what is bad about
the status quo: the intelligence exists, in pieces, and nobody assembles it with a paper trail.

### Who cares

- Students, journalists and reviewers who need to vet a source in a minute, with something to
  show for it.
- Agents that need a verified summary of a document or a topic with provenance attached.
- Telegraph's miners and organisers, who need real multi-intent traffic: a research dossier
  sends eight paid requests to up to seven intents, a news dossier three to four.

### Failure list, ranked by how likely it is to go wrong

1. **Not enough real users before the deadline.** This is what is being underestimated: 45% of
   the score is users and call volume, and there is one day. Mitigation: deploy today, share the
   link on X with real dossier links, ask in the hackathon Discord, put the ledger and the chain
   count where judges see them, make every dossier shareable.
2. **The paid path is unverified until the wallet key exists.** Everything up to the payment is
   tested against the live node for free (the 402 challenge is diffed against the client
   constants; every request shape passed the node's pre-validation). The x402 client is built
   the way the official Telegraph MCP client builds it, on the same pinned version. One
   `npm run live` proves it; do that before anything else (GAPS G1).
3. **Miners fail or go cold.** The FACT_CHECK leader has thrown 500s in bursts; two miners sit
   on free hosting that sleeps. Mitigation: next-ranked fallback on every free failure, an
   *unusable* state for answered-but-empty results, 45-second call timeouts, honest per-step
   errors that never hide a failure inside a summary.
4. **The router misclassifies the open-ended steps.** Mitigation: an accept-list of intents per
   router step and a direct fallback; both calls are shown and counted.
5. **Serverless limits.** One step per HTTP request keeps every call inside one 60-second
   function; the router gets 25 seconds, a miner 45.
6. **Payments collide when two people run at once** (the facilitator rejects a second
   in-flight payment from one wallet). Mitigation: steps run one at a time per user; a refused
   payment settles nothing and is retried once after 1.5 seconds.
7. **The wallet is drained or abused.** Mitigation: daily budget, per-browser allowance, price
   cap at $0.02 (one FRAUD_DETECTION miner charges $0.20), pause flag, and paid work off by
   default.
8. **Traffic looks manufactured** (rule 04 is disqualification). Mitigation: no cron, no
   self-loops, no unattended jobs; a public ledger with hashed visitor ids; the on-chain count
   next to it.
9. **The submission form for Track 3 is unknown** until it opens. Mitigation: repo, live URL,
   payer address, X handle and a one-paragraph description ready in DEMO.md.
10. **Provenance has no real intent to land on.** CONTENT_VERIFICATION has one active miner and
    it verifies images. Mitigation: the step asks the router the verification question and falls
    back to ACADEMIC_SEARCH by exact title; the dossier says which happened.

## Judging criteria

Weights are verbatim from the hackathon rules page (Track 3 tab), read 2026-09-06.

| Weight | Criterion | Where the hours go |
|---:|---|---|
| 45% | Real usage & adoption: number of real users + actual volume of Telegraph calls | Ship first, then share. Eight calls per research dossier, every one receipted and counted on `/ledger` and on the chain. Shareable dossier links for X and Discord. |
| 25% | Usefulness, creativity & depth of integration, off-chain and on-chain | The pipeline itself: ten intents, leaderboard-driven miner choice, one router-dispatched step per dossier, confidence read from each miner's declared mapping, signal hashes and settlements on every line. |
| 25% | Engagement & updates on X, tagging @Telegraphprotoc | Three drafted updates in docs/x-updates.md, each with a live dossier link and the ledger's real numbers. |
| 5% | Technical execution & integration quality | Typecheck, 45 unit tests, the judge journey in Playwright, a free preflight that diffs the node's challenge, honest errors. |

Rules that shape the build: applications must use real miners, simulated or mocked data is not
allowed; metric inflation is disqualification; updates must be public on X and tagged.

## Novelty

- **What has not been done before:** one query planned into up to eight paid calls across seven
  canonical intents, assembled into one document with a per-step receipt, a router-dispatched
  step whose routing decision is shown, and a ledger reconciled against the chain.
- **How this differs from the nearest existing thing:** the reference apps and the single-intent
  front doors give one answer per question; Dossier composes intents and verifies each leg.
  Aggregators blend answers; Dossier never blends, it stacks receipts.
- **The one unforgettable thing:** *One question, ten intents, one receipt trail you can check on
  the node and on the chain.*

## Scope

In: the two modes above, the ledger, share links, the verify page, spending guards, the free
preflight, the paid live script, the judge journey. Out: accounts, wallets for users, agents'
API keys, Telegram or MCP surfaces, re-ranking miners, automatic second opinions, anything that
sits between the user and the protocol's own judgement.
