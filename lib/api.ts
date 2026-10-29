// Request and response shapes of the EcoBrief API: GET /api/search and GET /api/stats.
import type { Paper } from "./paper.ts";

/** Query parameters of GET /api/search (all optional). */
export const SEARCH_PARAMS = ["q", "year", "animal", "region", "topic", "sort", "limit"] as const;
export type SearchOptions = Partial<Record<(typeof SEARCH_PARAMS)[number], string>>;

export interface SearchResult extends Paper {
  score: number;
  /** Titles of up to two papers that share the most distinctive words with this one. */
  related: string[];
}

export interface SearchResponse {
  query: string;
  /** Results returned (at most `limit`). */
  total: number;
  /** Papers that matched before `limit` was applied. */
  matched: number;
  results: SearchResult[];
}

export interface AnimalCount {
  name: string;
  count: number;
}

export interface Stats {
  papers: number;
  /** Publication years, newest first. */
  years: string[];
  /** Animal groups with paper counts (a paper counts once per group it covers), biggest first. */
  animals: AnimalCount[];
}
