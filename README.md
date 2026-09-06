# Dossier

**Ask once. Get the case file.** A Telegraph Hackathon Season I, Track 3 application.

Paste a link to a research paper, or name a news topic, and Dossier runs it through the
Telegraph miner network one intent at a time, then hands back a single case file where every
line says which miner answered, how sure it was, what it cost, and where the payment settled on
Base Sepolia.

- **Research mode**, eight steps over seven intents: `CONTENT_EXTRACTION` (read the page, then
  its bibliographic record), `AI_TEXT_DETECTION`, `FRAUD_DETECTION`, `FACT_CHECK`,
  `CONTENT_VERIFICATION` (dispatched by Telegraph's own router), `ACADEMIC_SEARCH`,
  `LANGUAGE_TRANSLATION`.
- **News mode**, three to four steps over four intents: `NEWS_HEADLINES`, `NEWS_SEARCH`
  (router-dispatched), `CHAT_COMPLETION`, `LANGUAGE_TRANSLATION`.

One query such as *"Extract the research paper at https://arxiv.org/abs/1706.03762 in Hindi"*
is the whole interface. The language, region and section are read from the sentence.

## What makes it honest

- **Nothing is mocked.** Every step is a paid x402 call to a live miner. A step that fails says
  which miner failed and that failed calls are not charged. A miner that answers but cannot be
  used (a translation engine without the language pair) is shown as *unusable* and the
  next-ranked miner is tried.
- **Ranked, not hand-picked.** For each step the app reads the live leaderboard and calls the
  best-ranked miner whose declared inputs fit the step. One step per dossier is handed to
  Telegraph's router instead, and the receipt says what the router decided.
- **Two ledgers.** `/ledger` lists every call the app has ever made. The same page counts the
  payer wallet's USDC transfers to the Telegraph collector from a public explorer, so the volume
  does not rest on the app's word. Every signal hash opens on the node at `/verify/{hash}`.
- **Spending is off by default.** No key, no budget, nothing is asked. A daily budget, a
  per-browser allowance, a price cap and a pause flag guard the wallet.

## Run it

```bash
git clone https://github.com/0xsaroj001/dossier && cd dossier && npm ci
```

```bash
npm run typecheck && npm test
```

```bash
cp .env.example .env.local
```

Fill in `PAYER_PRIVATE_KEY` (a fresh Base Sepolia burner funded with testnet USDC from
[faucet.circle.com](https://faucet.circle.com)) and set `DAILY_CALL_BUDGET` above zero. Then:

```bash
npm run preflight
```

That is free: it checks the environment, the node's 402 challenge against the constants the
client signs for, and which miner would serve each step today. The first paid check is one
dossier from the command line, about $0.08 of testnet USDC:

```bash
npm run live -- research "https://arxiv.org/abs/1706.03762 in Hindi"
```

```bash
npm run dev
```

Open <http://localhost:3000>. The judge journey runs against any deployment:

```bash
npm run e2e
```

Set `E2E_PAID=1` to include the one paid test. Set `BASE_URL` to point it at a deployment.

## Deploy

The app is a standard Next.js 15 project. On Vercel: import the repository, add the variables
from `.env.example`, and add Upstash Redis from the Marketplace so the ledger and dossiers
survive cold starts (the app reads `UPSTASH_REDIS_REST_URL`/`_TOKEN` or the `KV_REST_API_*`
names the integration sets). Set `PUBLIC_URL` to the deployment's address so share links are
absolute. Without Redis everything still works, in memory, per instance.

## Docs

- [PRD.md](PRD.md): the claim, the reality checks, the judging weights, the novelty
- [ARCHITECTURE.md](ARCHITECTURE.md): how it fits together and why those choices
- [PHASES.md](PHASES.md): what ships in what order, and the freeze
- [GAPS.md](GAPS.md): what is missing, broken or unverified; read before trusting a claim
- [MEMORY.md](MEMORY.md): decisions and lessons
- [DEMO.md](DEMO.md): the judge journey, exact steps and expected output
- [docs/x-updates.md](docs/x-updates.md): update posts for X, to be filled with live numbers

## Limitations

- Testnet. Base Sepolia, testnet USDC. The answers are real; the money is not.
- One intent on the network, `CONTENT_VERIFICATION`, currently has a single miner and it
  verifies images. The provenance step therefore asks Telegraph's router the verification
  question and falls back to an `ACADEMIC_SEARCH` lookup by title; the receipt shows which
  happened.
- "Visitors" are browsers: a random cookie stored as a salted hash. One person on two devices
  counts twice. The method is published next to the number.
- Translation covers the first 700 characters of the abstract or briefing, cut at a sentence.

## License

MIT
