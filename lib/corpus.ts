import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseCsvRecords } from "./csv.ts";
import { CORPUS_PATH } from "./paths.ts";
import { type SearchEngine, createSearchEngine } from "./search.ts";

let cached: { mtimeMs: number; engine: SearchEngine } | undefined;

/**
 * The search engine for data/processed/wildlife_papers_clean.csv. It is rebuilt whenever the file
 * changes, so `npm run preprocess` takes effect without restarting the server.
 */
export function getSearchEngine(): SearchEngine {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(CORPUS_PATH).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`No corpus at ${path.relative(process.cwd(), CORPUS_PATH)}. Run "npm run preprocess" to build it.`);
  }
  if (cached?.mtimeMs !== mtimeMs) {
    cached = { mtimeMs, engine: createSearchEngine(parseCsvRecords(readFileSync(CORPUS_PATH, "utf8"))) };
  }
  return cached.engine;
}
