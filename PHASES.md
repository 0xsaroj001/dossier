# PHASES — Dossier

Deadline **2026-09-07 23:59:59 UTC** (submission form). Feature freeze at 70% of the time:
**2026-09-07 10:00 UTC**. After the freeze: rehearsal, posts, submission. Resolve every deadline
with `date -u`, never the local clock.

## Phase 0 — Facts, 2026-09-06 05:20–05:50 UTC — done

Live node facts gathered for free: the 45 canonical intents and their miner counts; the active
catalogue (130 miners); manifests and OpenAPI entries for the top miners of the ten target
intents; output shapes probed on the miners' own hosts; the 402 challenge decoded; the Engine
docs for `context` and the router's fallback; Blockscout's response shape.

## Phase 1 — Core and UI, 2026-09-06 05:50–07:10 UTC — done, then re-cut

Parser, node client, pipeline, guards, store, chain check, six API routes, workbench, dossier
view, ledger, verify and share pages. At about 06:20 UTC the operator ruled out direct dispatch;
the pipeline was re-cut so that every step is an auto-routed ask with two phrasings, an
accept-list and a reader. Typecheck clean; `next build` clean.

## Phase 2 — Verification — done except the paid run

- 50 unit tests pass (parser, readers, receipts, pipeline questions and hints, store, guards,
  config).
- Judge journey in Playwright: 7 free tests pass against the dev server; the paid test is gated
  behind `E2E_PAID=1`.
- `npm run preflight` clean against the live node: challenge matches the client constants, every
  step prints its question and the intent's leaderboard.
- **Open:** the first paid question. Needs the operator's `.env.local`. Command and expected
  output in DEMO.md.

## Phase 3 — Ship — mostly done, 2026-09-06 ~10:30 UTC

Done: wallet funded (55 USDC), preflight clean, paid news dossier 4/4, two paid research
dossiers through the UI, repo pushed to `github.com/0xsaroj001/dossier`, production deployed at
<https://dossier-wukong4.vercel.app> with budget, caps, salt and `PUBLIC_URL` set, SSO protection
off, free judge journey 8/8 against production.

Left for the operator:
1. `vercel env add PAYER_PRIVATE_KEY production` (prompts for the value), then Storage →
   Upstash Redis → Connect in the Vercel dashboard, then `vercel deploy --prod`.
2. `curl https://dossier-wukong4.vercel.app/api/health` → `payerConfigured: true`, `store: "redis"`.
3. `BASE_URL=https://dossier-wukong4.vercel.app E2E_PAID=1 npm run e2e` → 9 passed.
4. Re-check the Track 3 tab at submissions.telegraphprotocol.com and fill the form.

## Phase 3b — "Is this safe?", 2026-09-06 12:00–12:40 UTC — done

Third mode on the operator's go: link scan, certificate, host location, fraud record, red flags
in the message; four more intents (URL_SCAN, SSL_VERIFICATION, IP_GEOLOCATION,
TEXT_CLASSIFICATION), fourteen in all. Verdict computed from the miners' labels. 61 unit
tests, journey 9/9 free.

## Phase 4 — Distribution, until the deadline

- Three X updates from docs/x-updates.md with real dossier links and ledger numbers, each tagged
  @Telegraphprotoc.
- Post the link in the hackathon Discord; ask people to run one dossier each.
- Watch `/ledger` and `/api/health` (balance, budget). Refill from the faucet every 2 hours if
  needed.

## Freeze — 2026-09-07 10:00 UTC

No new features after this line. Only fixes for a broken judge journey, copy, and docs.
