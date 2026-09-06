import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dossier",
  description: "Ask once, get a case file. Research papers and news topics checked across ten Telegraph intents, with a receipt for every call.",
  openGraph: {
    title: "Dossier",
    description: "One question, ten intents, one case file. Built on the Telegraph miner network.",
    type: "website",
  },
  twitter: { card: "summary", title: "Dossier", description: "One question, ten intents, one case file. Built on the Telegraph miner network." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="wordmark">
              Dossier<small>on Telegraph</small>
            </Link>
            <nav className="site-nav">
              <Link href="/ledger">Ledger</Link>
              <Link href="/#how">How it works</Link>
              <a href="https://github.com/0xsaroj001/dossier" rel="noreferrer">Source</a>
            </nav>
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="wrap">
            Every answer on this site was bought from a Telegraph miner on Base Sepolia and can be checked on the node and on the chain. Testnet money, real answers.
          </div>
        </footer>
      </body>
    </html>
  );
}
