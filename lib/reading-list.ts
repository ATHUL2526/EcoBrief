// The browser's reading list of saved papers.
import { paperId } from "./paper.ts";

/** What the reading list keeps for each paper: enough to list and export it. */
export const SAVED_FIELDS = ["title", "year", "authors", "journal", "doi", "url"] as const;
export type SavedPaper = Record<(typeof SAVED_FIELDS)[number], string>;

/** Adds the paper, or removes it when it is already saved. */
export function toggleSaved(saved: readonly SavedPaper[], paper: SavedPaper): SavedPaper[] {
  const id = paperId(paper);
  if (saved.some((item) => paperId(item) === id)) return saved.filter((item) => paperId(item) !== id);
  return [...saved, Object.fromEntries(SAVED_FIELDS.map((field) => [field, paper[field] ?? ""])) as SavedPaper];
}

/** Saved papers from storage; anything unreadable counts as an empty list. */
export function parseSaved(raw: string | null): SavedPaper[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item?.title === "string") : [];
  } catch {
    return [];
  }
}

export function readingListCsv(saved: readonly SavedPaper[]): string {
  const quote = (value: string | undefined) => `"${String(value || "").replaceAll('"', '""')}"`;
  return [SAVED_FIELDS.join(","), ...saved.map((paper) => SAVED_FIELDS.map((field) => quote(paper[field])).join(","))].join("\n");
}
