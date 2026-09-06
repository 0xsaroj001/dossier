import type { StepResult } from "./types";

/**
 * The safety verdict is computed from the miners' own labels and answers, without another
 * paid call. An explicit risk figure wins. Otherwise each sentence is read on its own: a
 * sentence that names danger without negating it raises a caution; a negated one ("does not
 * appear in any known scam database") or a clean word clears. Anything else is "no verdict".
 */
export const RED_FLAGS = /\b(malicious|phishing|scams?|scammers?|fraudulent|fraud attempt|unsafe|dangerous|suspicious|blacklisted|blocklisted|malware|expired|revoked|mismatch|self-signed|untrusted|high[ -]risk|sanctioned|drainer|ponzi|rug ?pull|likely fraud)\b/i;
const CLEAR = /\b(safe|clean|valid|legitimate|benign|low[ -]risk|not listed|not flagged|not found|not applicable|not_applicable|0% risk|probability 0)\b/i;
const NEGATION = /\b(no|not|never|none|without|isn't|aren't|doesn't|don't|wasn't|neither|nor)\b|n't\b/i;

export type Tone = "caution" | "clear" | "unknown";

function toneOfText(text: string): Tone {
  let caution = false;
  let clear = false;
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s) continue;
    const danger = RED_FLAGS.test(s);
    const negated = NEGATION.test(s);
    if (danger && !negated) caution = true;
    else if ((danger && negated) || CLEAR.test(s)) clear = true;
  }
  if (caution) return "caution";
  if (clear) return "clear";
  return "unknown";
}

export function toneOf(s: StepResult): Tone {
  if (s.status !== "ok" || !s.receipt) return "unknown";
  const label = s.receipt.label ?? "";
  const answer = s.receipt.answer.slice(0, 600);
  const pct = `${label} ${answer}`.match(/(\d{1,3})\s*% risk/i);
  if (pct) {
    const n = Number(pct[1]);
    if (n <= 20) return "clear";
    if (n >= 60) return "caution";
  }
  // A short label is a verdict in itself; a long one is prose and is read like the answer.
  if (label && label.length <= 60) {
    const t = toneOfText(label);
    if (t !== "unknown") return t;
  }
  return toneOfText(answer);
}

export function safetyVerdict(steps: StepResult[]): { tone: Tone; line: string; flagged: string[]; checked: number } {
  const ok = steps.filter((s) => s.status === "ok" && s.receipt);
  const flagged = ok.filter((s) => toneOf(s) === "caution").map((s) => s.title);
  if (ok.length === 0) return { tone: "unknown", line: "No check came back, so there is no verdict.", flagged, checked: 0 };
  if (flagged.length) return { tone: "caution", line: `Caution: ${flagged.length} of ${ok.length} checks raised a red flag (${flagged.join(", ")}).`, flagged, checked: ok.length };
  return { tone: "clear", line: `No red flags from ${ok.length} independent check${ok.length === 1 ? "" : "s"}. That is evidence, not a guarantee.`, flagged, checked: ok.length };
}
