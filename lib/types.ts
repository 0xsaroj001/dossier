export type Mode = "research" | "news" | "safety";

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
  | "CHAT_COMPLETION"
  | "URL_SCAN"
  | "SSL_VERIFICATION"
  | "IP_GEOLOCATION"
  | "TEXT_CLASSIFICATION";

export type StepId =
  | "extract"
  | "summary"
  | "authorship"
  | "fraud"
  | "fact"
  | "provenance"
  | "related"
  | "translate"
  | "headlines"
  | "search"
  | "brief"
  | "scan"
  | "cert"
  | "where"
  | "scam"
  | "redflags";

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
  /** Safety mode: an EVM address or ENS name found in the text. */
  address?: string | null;
  /** Safety mode: the pasted message itself, when there is prose to classify. */
  message?: string | null;
}

export interface StepSpec {
  id: StepId;
  title: string;
  /** The canonical intent the step is written for. */
  intent: Intent;
  /** Intents the router may file the question under and still serve the step. */
  accept: string[];
  /** When true, an answer filed under any other intent is never used, even if readable. */
  strict?: boolean;
  needs: StepId[];
  /** Only planned when the query asks for it (a target language). */
  optional?: boolean;
  /** Only planned when the parsed query has what the step needs. */
  when?: (p: ParsedQuery) => boolean;
  /** What the step does, in one line, for the UI. */
  blurb: string;
}

export interface Receipt {
  /** The intent the router classified the question as; the step's own intent when the router said nothing. */
  intent: string;
  minerSlug: string | null;
  minerName: string | null;
  minerId: string | null;
  minerRank: number | null;
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
  /** Which wording was sent: the step's first phrasing or its second. */
  phrasing: 1 | 2;
  minerSlug: string;
  minerRank: number | null;
  intent: string | null;
  outcome: "ok" | "unusable" | "off-target" | "error" | "timeout" | "unpaid";
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

export interface SourceRecord {
  url: string;
  title: string | null;
  authors: string[];
  abstract: string | null;
  date: string | null;
  year: string | null;
  site: string | null;
}

export interface Dossier {
  id: string;
  mode: Mode;
  query: string;
  parsed: ParsedQuery;
  createdAt: string;
  /** The page's own metadata, read by the app for free (research mode). Not a Telegraph call. */
  source: SourceRecord | null;
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
  /** The step's own intent. */
  intent: string;
  /** What the router classified the question as. */
  routerIntent: string | null;
  minerSlug: string | null;
  minerId: string | null;
  minerRank: number | null;
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
