export type Theme = "system" | "light" | "dark";
export interface Preferences {
  theme: Theme;
  exclusions: string[];
  paused: boolean;
}
export interface TabRecord {
  id: number;
  windowId: number;
  url: string;
  title: string;
  text: string;
  updated: number;
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
  id: number;
  title: string;
  url: string;
  state: TabRecord["state"];
  snippet: string;
  truncated?: boolean;
}
export interface SearchResponse {
  hits: Hit[];
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
  let size = [...records.values()].reduce((n, r) => n + r.text.length, 0);
  for (const r of [...records.values()].sort((a, b) => a.updated - b.updated)) {
    if (size <= budget) break;
    if (r.text) {
      size -= r.text.length;
      r.text = "";
      r.state = "metadata-only";
    }
  }
}
