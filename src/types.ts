export type Theme = "system" | "light" | "dark";
export interface Preferences {
  theme: Theme;
  exclusions: string[];
  paused: boolean;
}
export type CoverageReason =
  | "permission"
  | "excluded"
  | "sleeping"
  | "restricted"
  | "indexing"
  | "failure"
  | "stale"
  | "budget"
  | "partial"
  | "paused"
  | "ready"
  | "empty";
export interface SearchFilters {
  windowId?: number;
  pageText?: boolean;
  domain?: string;
  exactHost?: boolean;
}
export type MatchKind = "exact" | "prefix" | "variant" | "typo";
export interface Passage {
  id: string;
  start: number;
  end: number;
  text: string;
  ranges: { start: number; end: number }[];
  kind: MatchKind;
  revision: number;
  before: string;
  after: string;
  score: number;
  page?: number;
  pageLabel?: string;
  pageOffset?: number;
}
export interface PDFInfo {
  truncated?: boolean;
  pages: { page: number; label?: string; start: number; end: number }[];
  total: number;
  searched: number;
  textPages: number;
  identity?: string;
  status: string;
}
export interface TabRecord {
  breaks?: number[];
  pdf?: PDFInfo;
  coverage?: CoverageReason;
  lastActive?: number;
  id: number;
  windowId: number;
  url: string;
  title: string;
  text: string;
  updated: number;
  indexedAt?: number;
  state:
    | "content"
    | "metadata-only"
    | "indexing"
    | "unavailable"
    | "stale"
    | "excluded";
  truncated?: boolean;
}
export interface Hit {
  resultsCapped?: boolean;
  coverage?: CoverageReason;
  updated?: number;
  passage?: Passage;
  passages?: Passage[];
  passagesCapped?: boolean;
  pdf?: PDFInfo;
  matchedTerms?: string[];
  approximate?: boolean;
  id: number;
  title: string;
  url: string;
  state: TabRecord["state"];
  snippet: string;
  truncated?: boolean;
}
export interface SearchResponse {
  hits: Hit[];
  coverage?: {
    id: number;
    title: string;
    url: string;
    reason: CoverageReason;
    detail?: string;
  }[];
  total: number;
  searchable: number;
  indexing: number;
  paused: boolean;
  theme: Theme;
}
export const DEFAULTS: Preferences = {
  theme: "system",
  exclusions: [],
  paused: false,
};
export const MAX_TEXT = 60_000;
export const MAX_TOTAL = 2_000_000;
export function excluded(url: string, hosts: string[]): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return hosts.some((x) => h === x || h.endsWith("." + x));
  } catch {
    return false;
  }
}
export function normalizeHost(value: string): string | null {
  try {
    const u = new URL(value.includes("://") ? value : "https://" + value);
    return /^https?:$/.test(u.protocol) &&
      u.hostname &&
      !u.hostname.includes("*") &&
      u.pathname === "/" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
      ? u.hostname.toLowerCase().replace(/\.$/, "")
      : null;
  } catch {
    return null;
  }
}
export function validCommit(
  generation: number,
  current: number,
  recordURL: string,
  tabURL: string,
  paused: boolean,
  denied: boolean,
) {
  return generation === current && recordURL === tabURL && !paused && !denied;
}
export function enforceBudget(
  records: Map<number, TabRecord>,
  budget = MAX_TOTAL,
) {
  // Reserve session quota for the new location maps as well as body strings.
  const cost = (r: TabRecord) =>
    r.text.length +
    (r.breaks?.length ?? 0) * 8 +
    (r.pdf?.pages.length ?? 0) * 100;
  let size = [...records.values()].reduce((n, r) => n + cost(r), 0);
  for (const r of [...records.values()].sort((a, b) => a.updated - b.updated)) {
    if (size <= budget) break;
    if (r.text) {
      size -= cost(r);
      r.text = "";
      r.pdf = undefined;
      r.breaks = undefined;
      r.state = "metadata-only";
      r.coverage = "budget";
    }
  }
}
