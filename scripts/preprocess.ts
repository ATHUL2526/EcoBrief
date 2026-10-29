// Merge, clean and de-duplicate the records from every source in data/raw/ into the search corpus:
// data/processed/wildlife_papers_clean.csv (what the app searches) plus papers_by_animal.csv/.md.
// Run with `npm run preprocess`; a running server picks up the new corpus on its next request.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatCsv, parseCsvRecords } from "../lib/csv.ts";
import { CORPUS_PATH, PROCESSED_DIR, RAW_DIR } from "../lib/paths.ts";
import { LEGACY_ORIGIN, type Row, animalIndex, buildCorpus } from "../lib/pipeline.ts";
import { compareText } from "../lib/text.ts";

async function readRawRows(): Promise<Row[]> {
  const files = (await readdir(RAW_DIR).catch(() => [])).filter((name) => /\.csv$/i.test(name)).sort();
  if (!files.length) throw new Error(`No CSV files in ${RAW_DIR}. Run "npm run fetch-papers" first.`);
  const rows: Row[] = [];
  for (const name of files) {
    for (const row of parseCsvRecords(await readFile(path.join(RAW_DIR, name), "utf8"))) {
      row.origin ||= LEGACY_ORIGIN;
      rows.push(row);
    }
    console.log(`  ${name}: ${rows.length} rows so far`);
  }
  return rows;
}

function countBy(values: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts];
}

async function main() {
  console.log("Reading raw files:");
  const sourceRows = await readRawRows();
  const { corpus, dropped } = buildCorpus(sourceRows);
  if (!corpus.length) throw new Error("No usable records remain after cleaning.");

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(CORPUS_PATH, formatCsv([...new Set(corpus.flatMap((row) => Object.keys(row)))], corpus));
  const index = animalIndex(corpus);
  await writeFile(path.join(PROCESSED_DIR, "papers_by_animal.csv"), index.csv);
  await writeFile(path.join(PROCESSED_DIR, "papers_by_animal.md"), index.markdown);

  const groups = countBy(corpus.map((paper) => paper.animal_group)).sort((a, b) => b[1] - a[1]);
  const origins = countBy(corpus.map((paper) => paper.origin)).sort(([a], [b]) => compareText(a, b));
  console.log(`Animal groups: ${groups.map(([group, count]) => `${group} ${count}`).join(", ")}`);
  console.log(`\nRead ${sourceRows.length} raw records`);
  console.log(`Dropped ${Object.entries(dropped).map(([reason, count]) => `${count} ${reason.replace("_", " ")}`).join(", ")}`);
  console.log(`Saved ${corpus.length} searchable papers: ${origins.map(([origin, count]) => `${origin} ${count}`).join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
