export type Mode = "research" | "news";

export type Intent =
  | "CONTENT_EXTRACTION"
  | "AI_TEXT_DETECTION"
  | "FRAUD_DETECTION"
  | "FACT_CHECK"
  | "CONTENT_VERIFICATION"
  | "ACADEMIC_SEARCH"
  | "LANGUAGE_TRANSLATION"
  | "NEWS_HEADLINES"
  | "NEWS_SEARCH"
  | "CHAT_COMPLETION";

export type StepId =
  | "read"
  | "metadata"
  | "authorship"
  | "fraud"
  | "fact"
  | "provenance"
  | "related"
  | "translate"
  | "headlines"
  | "search"
  | "brief";

export interface Language {
  name: string;
  code: string;
}

export interface ParsedQuery {
  mode: Mode;
  query: string;
  url: string | null;
  topic: string | null;
  language: Language | null;
  region: string | null;
  category: string | null;
}

export interface StepSpec {
  id: StepId;
  title: string;
  /** The canonical intent this step is filed under. */
  intent: Intent;
  /** "engine": Telegraph's own router picks the miner; "direct": the app calls the best-ranked miner. */
  route: "engine" | "direct";
  /** For engine steps: the intent the app calls directly when the router does not deliver. */
  fallbackIntent?: Intent;
  /** For engine steps: intents whose answer counts as serving this step. */
  acceptIntents?: string[];
  needs: StepId[];
  /** Only planned when the query asks for it (a target language). */
  optional?: boolean;
  /** What the step does, in one line, for the UI. */
  blurb: string;
}

export interface Receipt {
  intent: string;
  minerSlug: string | null;
  minerName: string | null;
  minerId: string | null;
  minerRank: number | null;
  routedBy: "engine" | "app";
  routerIntent: string | null;
  routerReasoning: string | null;
  endpoint: string | null;
  confidence: number | null;
  confidenceNote: string | null;
  label: string | null;
  answer: string;
  costUsd: number | null;
  durationMs: number | null;
  signalHash: string | null;
  settlementTx: string | null;
  payer: string | null;
  warnings: string[];
}

export interface Attempt {
  minerSlug: string;
  minerRank: number | null;
  routedBy: "engine" | "app";
  outcome: "ok" | "unusable" | "error" | "timeout" | "unpaid" | "off-target";
  durationMs: number | null;
  costUsd: number | null;
  note: string | null;
}

export interface StepResult {
  id: StepId;
  title: string;
  intent: Intent;
  status: "ok" | "error" | "skipped";
  receipt: Receipt | null;
  /** Structured data other steps build on; shape depends on the step. */
  data: unknown;
  error: string | null;
  attempts: Attempt[];
}

export interface DossierSummary {
  calls: number;
  okSteps: number;
  costUsd: number;
  intents: string[];
  miners: string[];
  lines: string[];
}

export interface Dossier {
  id: string;
  mode: Mode;
  query: string;
  parsed: ParsedQuery;
  createdAt: string;
  steps: StepResult[];
  summary: DossierSummary;
}

export interface LedgerRow {
  id: string;
  at: string;
  day: string;
  visitor: string;
  mode: Mode;
  step: StepId;
  intent: string;
  minerSlug: string | null;
  minerId: string | null;
  minerRank: number | null;
  routedBy: "engine" | "app";
  routerIntent: string | null;
  endpoint: string | null;
  status: "ok" | "unusable" | "error" | "timeout" | "unpaid";
  confidence: number | null;
  costUsd: number | null;
  durationMs: number | null;
  signalHash: string | null;
  settlementTx: string | null;
  error: string | null;
  preview: string;
}

export interface Stats {
  calls: number;
  okCalls: number;
  callsToday: number;
  costUsd: number;
  usersAll: number;
  usersToday: number;
  intents: Record<string, number>;
  dossiers: number;
}
