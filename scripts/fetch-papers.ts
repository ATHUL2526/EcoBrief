// Download wildlife-conservation research metadata into data/raw/<source>.csv, one file per source.
// Run `npm run preprocess` afterwards to merge, de-duplicate and rebuild the search corpus.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatCsv } from "../lib/csv.ts";
import { RAW_DIR } from "../lib/paths.ts";
import { FIELDS, SEARCH_TERMS, SOURCES, collect } from "../lib/sources.ts";

const USAGE = `Usage: npm run fetch-papers -- [options]

Downloads wildlife-conservation papers from Europe PMC, OpenAlex, Crossref and arXiv
into data/raw/<source>.csv. Run "npm run preprocess" afterwards.

Options:
  --sources <name...>   any of: ${Object.keys(SOURCES).join(", ")} (default: all)
  --per-term <n>        max records per search term per source (default: 100)
  --from-year <year>    earliest publication year (default: 2010)
  --terms <term...>     replace the ${SEARCH_TERMS.length} built-in search terms
  --help                show this message

Environment:
  ECOBRIEF_EMAIL        your contact address, for polite/faster API access (recommended)
  OPENALEX_API_KEY      only if OpenAlex asks for a (free) key

Examples:
  npm run fetch-papers
  npm run fetch-papers -- --sources openalex arxiv --per-term 200 --from-year 2015`;

interface Options {
  sources: string[];
  perTerm: number;
  fromYear: number;
  terms: string[];
}

/** Options from the command line, or undefined when help was asked for. */
function parseArgs(argv: string[]): Options | undefined {
  const options: Options = { sources: Object.keys(SOURCES), perTerm: 100, fromYear: 2010, terms: SEARCH_TERMS };
  for (let i = 0; i < argv.length;) {
    const flag = argv[i++];
    const values: string[] = [];
    while (i < argv.length && !argv[i].startsWith("--")) values.push(argv[i++]);
    const wholeNumber = () => {
      if (values.length !== 1 || !/^\d+$/.test(values[0])) throw new Error(`${flag} needs one whole number.`);
      return Number(values[0]);
    };
    if (flag === "--help" || flag === "-h") return undefined;
    if (flag === "--sources") {
      if (!values.length || values.some((name) => !Object.hasOwn(SOURCES, name))) {
        throw new Error(`--sources must be some of: ${Object.keys(SOURCES).join(", ")}.`);
      }
      options.sources = values;
    } else if (flag === "--per-term") {
      options.perTerm = wholeNumber();
    } else if (flag === "--from-year") {
      options.fromYear = wholeNumber();
    } else if (flag === "--terms") {
      if (!values.length) throw new Error("--terms needs at least one search term.");
      options.terms = values;
    } else {
      throw new Error(`Unknown option ${flag}. Run with --help to see the options.`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log(USAGE);
    return;
  }
  await mkdir(RAW_DIR, { recursive: true });
  let total = 0;
  for (const source of options.sources) {
    console.log(`\n== ${source} ==`);
    const papers = await collect(source, options.terms, options.perTerm, options.fromYear);
    if (!papers.length) {
      console.log(`  No records from ${source}; keeping any existing file.`);
      continue;
    }
    const output = path.join(RAW_DIR, `${source}.csv`);
    await writeFile(output, formatCsv(FIELDS, papers));
    console.log(`  Saved ${papers.length} papers (${papers.filter((paper) => paper.abstract).length} with abstracts) to ${output}`);
    total += papers.length;
  }
  if (!total) throw new Error("No source returned records. Check your connection and try again.");
  console.log(`\nDone: ${total} records. Now run: npm run preprocess`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
