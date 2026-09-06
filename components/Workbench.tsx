"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DossierView, { type StepView } from "./DossierView";
import { LANGUAGES } from "@/lib/languages";
import type { DossierSummary, Mode, ParsedQuery, StepId, StepResult } from "@/lib/types";

interface PlanStep {
  id: StepId;
  title: string;
  intent: StepResult["intent"];
  route: "engine" | "direct";
  fallbackIntent: string | null;
  blurb: string;
}

const EXAMPLES: Record<Mode, string[]> = {
  research: [
    "Extract the research paper at https://arxiv.org/abs/1706.03762 in Hindi",
    "Read https://arxiv.org/abs/1810.04805 and translate the abstract into Tamil",
    "https://arxiv.org/abs/2005.14165 in Spanish",
  ],
  news: ["What's the latest on AI regulation in India, in Hindi", "Top technology headlines in the US", "News about the cricket World Cup in Tamil"],
};

const PLACEHOLDER: Record<Mode, string> = {
  research: "Paste a link to a paper and, if you like, name a language: “Extract the paper at https://arxiv.org/abs/… in Hindi”",
  news: "Name a topic and, if you like, a region and a language: “What's happening with AI regulation in India, in Hindi”",
};

export default function Workbench() {
  const [mode, setMode] = useState<Mode>("research");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [summary, setSummary] = useState<DossierSummary | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [allowance, setAllowance] = useState<{ budgetLeft: number; visitorLeft: number } | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("dossier.mode");
      if (saved === "news" || saved === "research") setMode(saved);
    } catch {
      /* private mode */
    }
  }, []);

  const pick = useCallback((m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem("dossier.mode", m);
    } catch {
      /* ignore */
    }
  }, []);

  async function run(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const my = ++runId.current;
    setBusy(true);
    setError(null);
    setSummary(null);
    setShare(null);
    setDone(false);
    setSteps([]);
    setParsed(null);
    try {
      const planRes = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, query: q, language: language || null }) });
      const plan = (await planRes.json()) as { ok: boolean; error?: string; parsed?: ParsedQuery; steps?: PlanStep[] };
      if (!plan.ok || !plan.parsed || !plan.steps) throw new Error(plan.error ?? "Could not plan that query.");
      if (runId.current !== my) return;
      setParsed(plan.parsed);
      const views: StepView[] = plan.steps.map((s) => ({ id: s.id, title: s.title, intent: s.intent, status: "skipped", receipt: null, data: null, error: null, attempts: [], state: "pending" }));
      setSteps(views);
      const context: Partial<Record<StepId, unknown>> = {};
      const results: StepResult[] = [];
      for (let i = 0; i < plan.steps.length; i += 1) {
        const spec = plan.steps[i]!;
        setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, state: "running" } : s)));
        let result: StepResult;
        try {
          const res = await fetch("/api/step", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode, stepId: spec.id, parsed: plan.parsed, context }),
          });
          const body = (await res.json()) as { ok: boolean; error?: string; result?: StepResult; allowance?: { budgetLeft: number; visitorLeft: number } };
          if (!body.ok || !body.result) throw new Error(body.error ?? `Step ${spec.id} failed (${res.status}).`);
          result = body.result;
          if (body.allowance) setAllowance(body.allowance);
        } catch (e) {
          result = { id: spec.id, title: spec.title, intent: spec.intent, status: "error", receipt: null, data: null, error: (e as Error).message, attempts: [] };
        }
        if (runId.current !== my) return;
        results.push(result);
        if (result.status === "ok") context[spec.id] = result.data;
        setSteps((prev) => prev.map((s, j) => (j === i ? { ...result, state: undefined } : s)));
      }
      const save = await fetch("/api/dossier", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parsed: plan.parsed, steps: results }) });
      const saved = (await save.json()) as { ok: boolean; id?: string; url?: string; error?: string };
      if (runId.current !== my) return;
      if (saved.ok && saved.url) setShare(saved.url);
      const sumRes = saved.ok && saved.id ? await fetch(`/api/dossier/${saved.id}`).then((r) => r.json()).catch(() => null) : null;
      const sum = (sumRes as { dossier?: { summary?: DossierSummary } } | null)?.dossier?.summary ?? null;
      setSummary(sum);
      setDone(true);
    } catch (e) {
      if (runId.current === my) setError((e as Error).message);
    } finally {
      if (runId.current === my) setBusy(false);
    }
  }

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Mode">
        <button type="button" role="tab" aria-pressed={mode === "research"} onClick={() => pick("research")}>
          Research paper
        </button>
        <button type="button" role="tab" aria-pressed={mode === "news"} onClick={() => pick("news")}>
          News topic
        </button>
      </div>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDER[mode]}
          aria-label="Your question"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run(query);
            }
          }}
        />
        <div className="row">
          <label className="note" htmlFor="lang">
            Translate into
          </label>
          <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Target language">
            <option value="">as written in the query, or not at all</option>
            {LANGUAGES.filter((l) => l.code !== "en").map((l) => (
              <option key={l.code} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          {allowance && (
            <span className="note">
              {allowance.visitorLeft} calls left for you today · {allowance.budgetLeft} in the shared budget
            </span>
          )}
          <button className="btn" type="submit" disabled={busy || !query.trim()}>
            {busy ? "Assembling…" : mode === "research" ? "Build the dossier" : "Brief me"}
          </button>
        </div>
      </form>
      <div className="examples" aria-label="Examples">
        {EXAMPLES[mode].map((ex) => (
          <button key={ex} type="button" onClick={() => setQuery(ex)} disabled={busy}>
            {ex}
          </button>
        ))}
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        {mode === "research"
          ? "Eight steps, seven intents: read, record, AI-text detection, fraud record, fact-check, provenance, related work, translation. Each is a paid call to a ranked Telegraph miner, and each shows its receipt."
          : "Three to four steps, four intents: headlines, recent coverage, a written briefing, translation. Each is a paid call to a ranked Telegraph miner, and each shows its receipt."}
      </p>
      {error && <p className="error">{error}</p>}
      {parsed && <DossierView mode={mode} parsed={parsed} steps={steps} summary={summary} shareUrl={share} done={done} />}
    </div>
  );
}
