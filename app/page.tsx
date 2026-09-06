import Workbench from "@/components/Workbench";
import { payerAddress } from "@/lib/telegraph";

export const dynamic = "force-dynamic";

const INTENTS: Array<[string, string]> = [
  ["CONTENT_EXTRACTION", "reads the page and its bibliographic record"],
  ["AI_TEXT_DETECTION", "asks whether the abstract was machine-written"],
  ["FRAUD_DETECTION", "looks for retractions, paper mills and predatory venues"],
  ["FACT_CHECK", "tests the abstract's main claim against live evidence"],
  ["CONTENT_VERIFICATION", "the provenance question, dispatched by Telegraph's own router"],
  ["ACADEMIC_SEARCH", "finds peer-reviewed work on the same subject"],
  ["LANGUAGE_TRANSLATION", "renders the abstract or briefing in the language you asked for"],
  ["NEWS_HEADLINES", "the section's headlines, region-aware"],
  ["NEWS_SEARCH", "the last week's coverage, dispatched by the router"],
  ["CHAT_COMPLETION", "writes the briefing from that material and nothing else"],
];

export default function Home() {
  const payer = payerAddress();
  return (
    <>
      <h1>Ask once. Get the case file.</h1>
      <p className="lede">
        Paste a paper or name a news topic. Dossier runs it through ten Telegraph intents, one ranked miner each, and hands you a case file where every line carries the miner that said it, how sure it was, what it cost, and the on-chain receipt.
      </p>
      <Workbench />
      <section className="about" id="how">
        <h2>How it works</h2>
        <div className="two-col">
          <div>
            <p>
              Telegraph is a marketplace of miners, each an API answering one or more canonical intents, ranked every epoch by validators. Dossier does not pick favourites: for each step it asks the live leaderboard for the best-ranked miner that can take the input, pays the x402 fee in testnet USDC from one app wallet, and keeps the receipt. One step in each dossier is handed to Telegraph&apos;s own router instead, so the network decides the intent and the miner and the receipt says so.
            </p>
            <p>
              Nothing here is mocked. A step that fails says which miner failed and that failed calls are not charged. A miner that answers but cannot be used, such as a translation engine that lacks the language pair, is shown as answered-but-unusable and the next-ranked miner is tried.
            </p>
            <p>
              The <a href="/ledger">ledger</a> lists every call this app has ever made, and counts the same calls again from the payer wallet&apos;s USDC transfers on Base Sepolia, read from a public explorer. Every signal hash opens on the node.
            </p>
            {payer && (
              <p className="note">
                Payer wallet: <code>{payer}</code>
              </p>
            )}
          </div>
          <div>
            <ol>
              {INTENTS.map(([intent, what]) => (
                <li key={intent}>
                  <code>{intent}</code> — {what}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}
