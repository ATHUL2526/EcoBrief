import path from "node:path";

// Relative to the project folder: npm scripts and the Next.js server both run from there.
export const DATA_DIR = path.join(process.cwd(), "data");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const PROCESSED_DIR = path.join(DATA_DIR, "processed");
export const CORPUS_PATH = path.join(PROCESSED_DIR, "wildlife_papers_clean.csv");
