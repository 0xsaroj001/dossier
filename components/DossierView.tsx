import type { Article } from "@/lib/adapters";
import type { DossierSummary, Mode, ParsedQuery, Receipt, SourceRecord, StepResult } from "@/lib/types";
import { safetyVerdict, toneOf } from "@/lib/verdict";

export type StepView = StepResult & { state?: "pending" | "running" };

export interface DossierViewProps {
  mode: Mode;
  parsed: ParsedQuery;
  source?: SourceRecord | null;
  sourceError?: string | null;
  steps: StepView[];
  summary: DossierSummary | null;
  createdAt?: string;
  shareUrl?: string | null;
  done: boolean;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const articles = (v: unknown): Article[] => (Array.isArray(v) ? (v as Article[]).filter((a) => a && typeof a.title === "string") : []);

function pct(n: number | null | undefined): string {
  return typeof n === "number" ? `${Math.round(n * 100)}%` : "not reported";
}

function ms(n: number | null | undefined): string {
  return typeof n === "number" ? (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`) : "—";
}

function short(h: string): string {
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

function tone(label: string | null): "ok" | "warn" | "bad" | "muted" {
  if (!label) return "muted";
  const l = label.toLowerCase();
  if (/human|supported|found|translated|clean|safe|no (documented|known)|verified|genuine|legit/.test(l)) return "ok";
  if (/ai_generated|refuted|fraud|scam|retract|false|fake|not found|unsafe|malicious/.test(l)) return "bad";
  if (/insufficient|recheck|uncertain|mixed|unknown|inconclusive/.test(l)) return "warn";
  return "muted";
}

function Stamp({ label }: { label: string | null }) {
  return <span className={`stamp ${tone(label)}`}>{label ?? "no verdict"}</span>;
}

function ReceiptBlock({ r }: { r: Receipt }) {
  return (
    <div className="receipt">
      <div>
        <div className="k">Miner</div>
        <div className="v">
          {r.minerSlug ?? "?"}
          {r.minerRank ? ` · #${r.minerRank} for ${r.intent}` : ` · ${r.intent}`}
        </div>
      </div>
      <div>
        <div className="k">Routed as</div>
        <div className="v">{r.routerIntent ?? "not stated"}</div>
      </div>
      <div>
        <div className="k">Confidence</div>
        <div className="v">
          {pct(r.confidence)}
          {typeof r.confidence === "number" && (
            <div className="bar">
              <i style={{ width: `${Math.round(r.confidence * 100)}%` }} />
            </div>
          )}
          {r.confidenceNote && <div className="src">{r.confidenceNote}</div>}
        </div>
      </div>
      <div>
        <div className="k">Cost · latency</div>
        <div className="v">
          {typeof r.costUsd === "number" ? `$${r.costUsd.toFixed(3)}` : "—"} · {ms(r.durationMs)}
        </div>
      </div>
      <div>
        <div className="k">Signal</div>
        <div className="v">{r.signalHash ? <a href={`/verify/${r.signalHash}`}>{short(r.signalHash)}</a> : "not issued"}</div>
      </div>
      <div>
        <div className="k">Settlement</div>
        <div className="v">
          {r.settlementTx ? (
            <a href={`https://sepolia.basescan.org/tx/${r.settlementTx}`} rel="noreferrer" target="_blank">
              {short(r.settlementTx)}
            </a>
          ) : (
            "not reported"
          )}
        </div>
      </div>
      {r.routerReasoning && (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="k">Router&apos;s reasoning</div>
          <div className="v" style={{ wordBreak: "normal" }}>
            {r.routerReasoning}
          </div>
        </div>
      )}
      {r.warnings.length > 0 && (
        <div style={{ gridColumn: "1 / -1" }}>
          <div className="k">Node warnings</div>
          <div className="v" style={{ wordBreak: "normal" }}>
            {r.warnings.join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}

function StepCard({ s, n }: { s: StepView; n: number }) {
  const state = s.state ?? s.status;
  const stateText =
    state === "running" ? (
      <span>
        <span className="spinner" />
        asking the network…
      </span>
    ) : state === "pending" ? (
      "queued"
    ) : s.status === "ok" ? (
      <Stamp label={s.receipt?.label ?? "done"} />
    ) : s.status === "skipped" ? (
      "skipped"
    ) : (
      <span className="stamp bad">failed</span>
    );
  const long = (s.receipt?.answer.length ?? 0) > 600;
  return (
    <section className="step" data-state={state}>
      <div className="step-head">
        <span className="n">{String(n).padStart(2, "0")}</span>
        <h3>{s.title}</h3>
        <span className="chip intent">{s.receipt?.intent ?? s.intent}</span>
        <span className="state">{stateText}</span>
      </div>
      {s.status === "skipped" && <p className="note">{s.error}</p>}
      {s.status === "error" && <p className="error">{s.error}</p>}
      {s.receipt && (
        <>
          <ReceiptBlock r={s.receipt} />
          {long ? (
            <details>
              <summary>Full answer</summary>
              <p className="answer">{s.receipt.answer}</p>
            </details>
          ) : (
            <p className="answer">{s.receipt.answer}</p>
          )}
        </>
      )}
      {s.attempts.length > 1 || (s.attempts.length === 1 && s.status !== "ok") ? (
        <ul className="attempts">
          {s.attempts.map((a, i) => (
            <li key={i}>
              Ask {a.phrasing}: {a.minerSlug}
              {a.minerRank ? ` (#${a.minerRank})` : ""}
              {a.intent ? ` as ${a.intent}` : ""} — {a.outcome}
              {a.note ? `. ${a.note}` : ""}
              {typeof a.durationMs === "number" ? ` · ${ms(a.durationMs)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ResearchFront({ steps, parsed, source, sourceError }: { steps: StepView[]; parsed: ParsedQuery; source: SourceRecord | null; sourceError: string | null }) {
  const by = (id: string) => steps.find((s) => s.id === id);
  const title = source?.title ?? null;
  const authors = source?.authors ?? [];
  const abstract = source?.abstract ?? null;
  const year = source?.year ?? null;
  const au = by("authorship");
  const fr = by("fraud");
  const fc = by("fact");
  const pv = by("provenance");
  const rl = by("related");
  const tr = by("translate");
  const su = by("summary");
  const ex = by("extract");
  const found = rec(pv?.data)["found"];
  const papers = Array.isArray(rec(rl?.data)["papers"]) ? (rec(rl?.data)["papers"] as string[]) : [];
  const facts = Array.isArray(rec(ex?.data)["facts"]) ? (rec(ex?.data)["facts"] as string[]) : [];
  const summary = str(rec(su?.data)["text"]);
  const translation = str(rec(tr?.data)["translation"]);
  return (
    <div className="front two">
      <div className="card">
        <div className="kicker">The paper</div>
        <h3>{title ?? (sourceError ? "The page could not be read" : "Reading the page…")}</h3>
        {(authors.length > 0 || year) && (
          <p className="src">
            {authors.slice(0, 6).join(", ")}
            {authors.length > 6 ? " et al." : ""}
            {year ? ` · ${year}` : ""}
          </p>
        )}
        {sourceError && <p className="error">{sourceError}</p>}
        {summary && (
          <>
            <div className="kicker">In plain words</div>
            <p className="brief">{summary}</p>
          </>
        )}
        {abstract && (
          <>
            <div className="kicker" style={{ marginTop: summary ? 14 : 0 }}>
              Abstract
            </div>
            <p className="abstract">{abstract}</p>
          </>
        )}
        {source && (
          <p className="note">
            Title, authors, date and abstract were read from the page&apos;s own metadata tags by Dossier, free; that is the input every paid question below works on.
          </p>
        )}
        {translation && (
          <>
            <div className="kicker" style={{ marginTop: 14 }}>
              Abstract in {parsed.language?.name ?? "translation"}
            </div>
            <p className="translation">{translation}</p>
          </>
        )}
      </div>
      <div className="card">
        <div className="kicker">Verdicts</div>
        <div className="verdicts" style={{ marginTop: 8 }}>
          <div className="verdict">
            <div className="k">Authorship</div>
            <div className="v">{au?.status === "ok" ? <Stamp label={au.receipt?.label ?? null} /> : <span className="stamp muted">{au?.state === "running" ? "checking" : "—"}</span>}</div>
            <div className="m">{au?.receipt ? `${au.receipt.minerSlug} · ${pct(au.receipt.confidence)}` : au?.status === "skipped" ? "skipped" : ""}</div>
          </div>
          <div className="verdict">
            <div className="k">Fraud record</div>
            <div className="v">{fr?.status === "ok" ? <Stamp label={fr.receipt?.label ?? "answered"} /> : <span className="stamp muted">{fr?.state === "running" ? "checking" : "—"}</span>}</div>
            <div className="m">{fr?.receipt ? fr.receipt.minerSlug : fr?.status === "skipped" ? "skipped" : ""}</div>
          </div>
          <div className="verdict">
            <div className="k">Key claim</div>
            <div className="v">{fc?.status === "ok" ? <Stamp label={fc.receipt?.label ?? "answered"} /> : <span className="stamp muted">{fc?.state === "running" ? "checking" : "—"}</span>}</div>
            <div className="m">{fc?.receipt ? `${fc.receipt.minerSlug} · ${pct(fc.receipt.confidence)}` : fc?.status === "skipped" ? "skipped" : ""}</div>
          </div>
          <div className="verdict">
            <div className="k">Provenance</div>
            <div className="v">
              {pv?.status === "ok" ? (
                <Stamp label={found === true ? "found" : found === false ? "not found" : (pv.receipt?.label ?? "checked")} />
              ) : (
                <span className="stamp muted">{pv?.state === "running" ? "routing" : "—"}</span>
              )}
            </div>
            <div className="m">{pv?.receipt ? `routed as ${pv.receipt.routerIntent ?? pv.receipt.intent} · ${pv.receipt.minerSlug}` : pv?.status === "skipped" ? "skipped" : ""}</div>
          </div>
        </div>
        {facts.length > 0 && (
          <>
            <div className="kicker" style={{ marginTop: 14 }}>
              Key facts extracted
            </div>
            <ul className="plain">
              {facts.slice(0, 8).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </>
        )}
        {papers.length > 0 && (
          <>
            <div className="kicker" style={{ marginTop: 14 }}>
              Related scholarship
            </div>
            <ul className="plain">
              {papers.slice(0, 5).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function NewsFront({ steps, parsed }: { steps: StepView[]; parsed: ParsedQuery }) {
  const by = (id: string) => steps.find((s) => s.id === id);
  const items = articles(rec(by("headlines")?.data)["items"]);
  const found = articles(rec(by("search")?.data)["articles"]);
  const brief = str(rec(by("brief")?.data)["text"]);
  const translation = str(rec(by("translate")?.data)["translation"]);
  if (!items.length && !found.length && !brief) return null;
  return (
    <div className="front two">
      <div className="card">
        <div className="kicker">Briefing{brief ? "" : " (pending)"}</div>
        {brief ? <p className="brief">{brief}</p> : <p className="note">The briefing is written once the headlines and coverage are in.</p>}
        {translation && (
          <>
            <div className="kicker" style={{ marginTop: 14 }}>
              In {parsed.language?.name ?? "translation"}
            </div>
            <p className="translation">{translation}</p>
          </>
        )}
      </div>
      <div className="card">
        {items.length > 0 && (
          <>
            <div className="kicker">Headlines</div>
            <ul className="plain">
              {items.slice(0, 8).map((a, i) => (
                <li key={i}>
                  {a.url ? (
                    <a href={a.url} rel="noreferrer" target="_blank">
                      {a.title}
                    </a>
                  ) : (
                    a.title
                  )}
                  {a.source && <div className="src">{a.source}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
        {found.length > 0 && (
          <>
            <div className="kicker" style={{ marginTop: items.length ? 14 : 0 }}>
              Recent coverage
            </div>
            <ul className="plain">
              {found.slice(0, 6).map((a, i) => (
                <li key={i}>
                  {a.url ? (
                    <a href={a.url} rel="noreferrer" target="_blank">
                      {a.title}
                    </a>
                  ) : (
                    a.title
                  )}
                  <div className="src">
                    {[a.source, a.published?.slice(0, 16)].filter(Boolean).join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function SafetyFront({ steps, parsed, done }: { steps: StepView[]; parsed: ParsedQuery; done: boolean }) {
  const v = safetyVerdict(steps);
  const running = steps.some((s) => s.state === "running" || s.state === "pending");
  return (
    <div className="front two">
      <div className="card">
        <div className="kicker">Verdict</div>
        <h3>
          {running && !done ? (
            <span>
              <span className="spinner" />
              checking…
            </span>
          ) : (
            <span className={`stamp ${v.tone === "caution" ? "bad" : v.tone === "clear" ? "ok" : "muted"}`} style={{ fontSize: 14 }}>
              {v.tone === "caution" ? "Caution" : v.tone === "clear" ? "No red flags" : "No verdict"}
            </span>
          )}
        </h3>
        <p className="abstract">{running && !done ? "The checks come back one at a time; the verdict is drawn from their labels once they are in." : v.line}</p>
        <div className="chips">
          {parsed.url && <span className="chip">{parsed.url}</span>}
          {parsed.address && <span className="chip mono">{parsed.address}</span>}
        </div>
        {parsed.message && (
          <>
            <div className="kicker" style={{ marginTop: 14 }}>
              The message
            </div>
            <p className="answer">{parsed.message}</p>
          </>
        )}
      </div>
      <div className="card">
        <div className="kicker">Checks</div>
        <ul className="plain">
          {steps.map((s) => {
            const tone = toneOf(s);
            return (
              <li key={s.id}>
                <span className={`stamp ${s.status !== "ok" ? "muted" : tone === "caution" ? "bad" : tone === "clear" ? "ok" : "warn"}`} style={{ marginRight: 8 }}>
                  {s.status === "ok" ? (s.receipt?.label ?? (tone === "caution" ? "flagged" : "answered")) : s.state === "running" ? "checking" : s.status === "skipped" ? "skipped" : s.state === "pending" ? "queued" : "failed"}
                </span>
                {s.title}
                {s.receipt && <div className="src">{s.receipt.minerSlug} · routed as {s.receipt.routerIntent ?? s.intent}</div>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function DossierView({ mode, parsed, source = null, sourceError = null, steps, summary, createdAt, shareUrl, done }: DossierViewProps) {
  return (
    <div className="dossier">
      <div className="dossier-head">
        <div className="kicker">
          {mode === "research" ? "Research dossier" : mode === "news" ? "News dossier" : "Safety check"}
          {createdAt ? ` · ${createdAt.slice(0, 16).replace("T", " ")} UTC` : ""}
        </div>
        <h2 style={{ marginTop: 4 }}>{parsed.query}</h2>
        <div className="chips">
          {parsed.url && <span className="chip">{parsed.url}</span>}
          {parsed.topic && <span className="chip">topic: {parsed.topic}</span>}
          {parsed.category && <span className="chip">section: {parsed.category}</span>}
          {parsed.region && <span className="chip">region: {parsed.region}</span>}
          {parsed.language && <span className="chip">→ {parsed.language.name}</span>}
        </div>
      </div>
      {mode === "research" ? <ResearchFront steps={steps} parsed={parsed} source={source} sourceError={sourceError} /> : mode === "news" ? <NewsFront steps={steps} parsed={parsed} /> : <SafetyFront steps={steps} parsed={parsed} done={done} />}
      {summary && done && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="kicker">Case summary</div>
          <ul className="summary-lines">
            {summary.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <div className="totals">
            <span>
              <b>{summary.calls}</b> Telegraph calls
            </span>
            <span>
              <b>{summary.okSteps}</b> steps answered
            </span>
            <span>
              <b>${summary.costUsd.toFixed(2)}</b> USDC paid
            </span>
            <span>
              <b>{summary.intents.length}</b> intents
            </span>
            <span>
              <b>{summary.miners.length}</b> miners
            </span>
          </div>
        </div>
      )}
      {shareUrl && (
        <div className="share">
          <span>Share this dossier:</span>
          <code>{shareUrl}</code>
        </div>
      )}
      <div className="steps">
        {steps.map((s, i) => (
          <StepCard key={s.id} s={s} n={i + 1} />
        ))}
      </div>
    </div>
  );
}
