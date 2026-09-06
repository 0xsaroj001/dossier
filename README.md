# Dossier

**Ask once. Get the case file.** A Telegraph Hackathon Season I, Track 3 application.

Paste a link to a research paper, or name a news topic, and Dossier turns it into a sequence of
questions for Telegraph's router. The network classifies each question into an intent, picks a
ranked miner, and answers; Dossier assembles the answers into one case file where every line
says which miner answered, how it was routed, how sure it was, what it cost, and where the
payment settled on Base Sepolia.

**Live: <https://dossier-wukong4.vercel.app>** · [ledger](https://dossier-wukong4.vercel.app/ledger)

- **Research mode**: Dossier first reads the page's own metadata tags (title, authors, date,
  abstract) for free, then puts eight questions to the router over seven intents:
  `CONTENT_EXTRACTION` (structured facts from the abstract), `CHAT_COMPLETION` (a plain-words
  summary), `AI_TEXT_DETECTION`, `FRAUD_DETECTION`, `FACT_CHECK`, `CONTENT_VERIFICATION` (the
  provenance question), `ACADEMIC_SEARCH`, `LANGUAGE_TRANSLATION`.
- **News mode**, three to four questions over four intents: `NEWS_HEADLINES`, `NEWS_SEARCH`,
  `CHAT_COMPLETION`, `LANGUAGE_TRANSLATION`.
- **Is this safe?**: paste a link, a wallet address, or the message someone sent you. Up to
  five questions over four intents: `URL_SCAN`, `SSL_VERIFICATION`, `IP_GEOLOCATION` (the app
  resolves the host for free, the network says where it is), `FRAUD_DETECTION`,
  `TEXT_CLASSIFICATION`. The verdict is drawn from the miners' own labels, with no extra call.

One query such as *"Extract the research paper at https://arxiv.org/abs/1706.03762 in Hindi"*
is the whole interface. The language, region and section are read from the sentence.

## What makes it honest

- **Routed, never hand-picked.** The app never names a miner. Every question is an auto-routed
  `POST /engine/v1/ask`; the router's intent and its stated reasoning are on every receipt.
  Long passages ride along in the request's `context` so the miner gets them intact.
- **Nothing is mocked.** Every step is a paid x402 call to a live miner. A step that fails says
  so and whether anything was charged. A miner that answers but cannot be used (a translation
  engine without the language pair) is shown as *unusable*, and the question is asked once more
  in different words. A question the router files under an intent the step cannot use is shown
  as *off-target* rather than passed off as an answer.
- **Two ledgers.** `/ledger` lists every question the app has ever asked. The same page counts
  the payer wallet's USDC transfers to the Telegraph collector from a public explorer, so the
  volume does not rest on the app's word. Every signal hash opens on the node at
  `/verify/{hash}`.
- **Spending is off by default.** No key, no budget, nothing is asked. A daily budget, a
  per-browser allowance, a per-payment price cap in the x402 client, and a pause flag guard the
  wallet.

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
client signs for, the question each step will put to the router, and who leads the leaderboard
for each intent today. The first paid check is one dossier from the command line, about $0.08
of testnet USDC:

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
- The router hands every question that contains a link to the #1 content-extraction miner,
  which reads inline text and cannot fetch (verified 2026-09-06, three phrasings). So the page
  itself is read by Dossier from its metadata tags, free and labelled as such, and every paid
  question works on that abstract. The router still decides every miner; a question filed
  under a neighbouring intent is shown as off-target and asked once more in different words.
- `CONTENT_VERIFICATION` currently has a single miner on the network and it verifies images.
  The provenance question is put to the router as written; it usually lands on an academic
  search or a fact-check, and the receipt says which.
- "Visitors" are browsers: a random cookie stored as a salted hash. One person on two devices
  counts twice. The method is published next to the number.
- Translation covers the first 700 characters of the abstract or briefing, cut at a sentence.

## License

MIT
