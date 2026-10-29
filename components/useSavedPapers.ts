import { useSyncExternalStore } from "react";
import { paperId } from "@/lib/paper";
import { type SavedPaper, parseSaved, toggleSaved } from "@/lib/reading-list";

// The reading list lives in localStorage, so it survives reloads and is shared by open tabs.
const STORAGE_KEY = "ecobrief-saved";
const NONE: SavedPaper[] = [];
const listeners = new Set<() => void>();
let fallback: string | null = null; // used when the browser blocks localStorage
let snapshot = { raw: null as string | null, papers: NONE };

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
}

function getSnapshot(): SavedPaper[] {
  const raw = readRaw();
  if (raw !== snapshot.raw) snapshot = { raw, papers: parseSaved(raw) };
  return snapshot.papers;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener); // changes made in other tabs
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function save(papers: SavedPaper[]): void {
  const raw = JSON.stringify(papers);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    fallback = raw;
  }
  for (const listener of listeners) listener();
}

export function useSavedPapers() {
  const papers = useSyncExternalStore(subscribe, getSnapshot, () => NONE);
  const ids = new Set(papers.map(paperId));
  return {
    papers,
    isSaved: (paper: SavedPaper) => ids.has(paperId(paper)),
    toggle: (paper: SavedPaper) => save(toggleSaved(getSnapshot(), paper)),
  };
}
