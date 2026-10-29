// TF-IDF search over the processed corpus, with the filters, sorting and stats behind the API.
// Framework-free: the Next.js page and route handlers reach it through lib/corpus.ts.
import type { AnimalCount, SearchOptions, SearchResponse, SearchResult, Stats } from "./api.ts";
import { GENERAL, PAPER_FIELDS, type Paper, animalGroups, paperId, plainText } from "./paper.ts";
import { anyTerm, compareText } from "./text.ts";

const TOKEN_PATTERN = /[a-z]{2,}/g;
const STOP_WORDS = new Set([
  "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "of",
  "on", "or", "that", "the", "this", "to", "with", "we", "were", "was",
]);

// Region and topic filters: a paper matches when its title or abstract contains any of the terms
// as whole words. The keys are the filter values the dashboard offers.
export const REGION_TERMS: Record<string, string[]> = {
  africa: ["africa", "african"],
  asia: ["asia", "asian"],
  india: ["india", "indian"],
  amazon: ["amazon", "amazonia", "amazonian"],
  europe: ["europe", "european"],
};
export const TOPIC_TERMS: Record<string, string[]> = {
  conflict: ["human-wildlife conflict", "conflict", "crop raiding", "fence", "coexistence"],
  monitoring: ["monitoring", "camera trap", "camera-trap", "survey", "detection", "uav"],
  habitat: ["habitat", "fragmentation", "connectivity", "landscape", "corridor"],
  movement: ["movement", "migration", "space use", "tracking", "dispersal"],
  conservation: ["conservation", "biodiversity", "protected area", "management", "endangered"],
};

const FILTER_PATTERNS = {
  region: new Map(Object.entries(REGION_TERMS).map(([key, terms]) => [key, anyTerm(terms)])),
  topic: new Map(Object.entries(TOPIC_TERMS).map(([key, terms]) => [key, anyTerm(terms)])),
};

// Words that say little about how two papers relate (ignored for the "Related" titles).
const RELATED_STOP_WORDS = new Set(["this", "that", "with", "from", "their", "were", "which", "study", "wildlife"]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_PATTERN) ?? []).filter((word) => !STOP_WORDS.has(word));
}

/** True when `value` is empty or the paper mentions it; a value without a term list matches as a whole word. */
export function matchesFilter(
  paper: Pick<Paper, "title" | "abstract">, kind: keyof typeof FILTER_PATTERNS, value: string,
): boolean {
  if (!value) return true;
  const pattern = FILTER_PATTERNS[kind].get(value) ?? anyTerm([value.toLowerCase()]);
  return pattern.test(`${paper.title} ${paper.abstract}`.toLowerCase());
}

function countItems<T>(items: Iterable<T>): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

/** Results per request: 1-50, 20 when missing or not a whole number. */
function parseLimit(raw: string): number {
  return /^\s*[+-]?\d+\s*$/.test(raw) ? Math.min(Math.max(Number(raw), 1), 50) : 20;
}

export interface SearchEngine {
  /** Ranked, filtered and sorted papers: the GET /api/search payload. */
  search(options?: SearchOptions): SearchResponse;
  /** The GET /api/stats payload. */
  stats(): Stats;
}

/** Index a corpus: rows of data/processed/wildlife_papers_clean.csv, newest first. */
export function createSearchEngine(rows: readonly Record<string, string>[]): SearchEngine {
  const papers = rows.map((row) => Object.fromEntries(PAPER_FIELDS.map((field) => [field, row[field] ?? ""])) as Paper);
  const ids = papers.map(paperId);

  // term -> [paper index, occurrences in that paper] for every paper containing it, in corpus order.
  const postings = new Map<string, [number, number][]>();
  rows.forEach((row, index) => {
    for (const [term, occurrences] of countItems(tokenize(row.search_text ?? `${row.title}. ${row.abstract}`))) {
      let list = postings.get(term);
      if (!list) postings.set(term, (list = []));
      list.push([index, occurrences]);
    }
  });

  const groupCounts = countItems(papers.flatMap((paper) => animalGroups(paper)));
  const animals: AnimalCount[] = [...groupCounts]
    .sort(([a, countA], [b, countB]) => Number(a === GENERAL) - Number(b === GENERAL) || countB - countA || compareText(a, b))
    .map(([name, count]) => ({ name, count }));
  const animalRank = new Map(animals.map(({ name }, index) => [name, index]));
  const years = [...new Set(papers.map((paper) => paper.year).filter(Boolean))].sort().reverse();

  /** [paper index, score] for every paper containing a query term, best first. */
  function rank(query: string): [number, number][] {
    const scores = new Map<number, number>();
    for (const [term, queryCount] of countItems(tokenize(query))) {
      const papersWithTerm = postings.get(term);
      if (!papersWithTerm) continue;
      // Words found in fewer papers count for more (how often one paper repeats a word does not matter here).
      const inverseFrequency = Math.log((papers.length + 1) / (papersWithTerm.length + 1)) + 1;
      for (const [index, occurrences] of papersWithTerm) {
        scores.set(index, (scores.get(index) ?? 0) + queryCount * (1 + Math.log(occurrences)) * inverseFrequency);
      }
    }
    return [...scores].sort((a, b) => b[1] - a[1]);
  }

  let relatedTerms: Set<string>[] | undefined;
  const relatedCache = new Map<number, string[]>();

  /** Up to two other papers sharing the most distinctive words (at least three) with this one. */
  function related(index: number): string[] {
    let titles = relatedCache.get(index);
    if (!titles) {
      relatedTerms ??= papers.map((paper) => new Set(
        (plainText(`${paper.title} ${paper.abstract}`).toLowerCase().match(/[a-z]{4,}/g) ?? [])
          .filter((word) => !RELATED_STOP_WORDS.has(word)),
      ));
      const own = [...relatedTerms[index]];
      titles = relatedTerms
        .map((terms, candidate) => ({
          candidate,
          shared: ids[candidate] === ids[index] ? 0 : own.filter((term) => terms.has(term)).length,
        }))
        .filter(({ shared }) => shared >= 3)
        .sort((a, b) => b.shared - a.shared)
        .slice(0, 2)
        .map(({ candidate }) => papers[candidate].title);
      relatedCache.set(index, titles);
    }
    return titles;
  }

  function search(options: SearchOptions = {}): SearchResponse {
    const param = (name: keyof SearchOptions) => (options[name] ?? "").trim();
    const query = param("q");
    const year = param("year");
    const animal = param("animal");
    const region = param("region").toLowerCase();
    const topic = param("topic").toLowerCase();
    const sort = param("sort") || "relevance";

    const matches = query ? rank(query) : papers.map((_, index): [number, number] => [index, 0]);
    const filtered = matches.filter(([index]) => {
      const paper = papers[index];
      return (!year || paper.year === year)
        && (!animal || animalGroups(paper).includes(animal))
        && matchesFilter(paper, "region", region)
        && matchesFilter(paper, "topic", topic);
    });
    const yearOf = ([index]: [number, number]) => papers[index].year;
    if (sort === "newest") {
      filtered.sort((a, b) => compareText(yearOf(b), yearOf(a)));
    } else if (sort === "oldest") {
      filtered.sort((a, b) => compareText(yearOf(a) || "9999", yearOf(b) || "9999"));
    } else if (sort === "animal") {
      const groupOf = ([index]: [number, number]) => animalRank.get(papers[index].animal_group || GENERAL) ?? 99;
      filtered.sort((a, b) => groupOf(a) - groupOf(b) || compareText(yearOf(b), yearOf(a)));
    }
    // "relevance": rank() is already best-first, and without a query the corpus is newest-first.

    const results: SearchResult[] = filtered.slice(0, parseLimit(param("limit"))).map(([index, score]) => ({
      score: Number(score.toFixed(2)),
      ...papers[index],
      related: related(index),
    }));
    return { query, total: results.length, matched: filtered.length, results };
  }

  return { search, stats: () => ({ papers: papers.length, years, animals }) };
}
