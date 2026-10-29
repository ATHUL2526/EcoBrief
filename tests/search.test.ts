// Tests for the search engine behind GET /api/search and GET /api/stats, and the reading list.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSearchEngine } from "../lib/corpus.ts";
import { GENERAL } from "../lib/paper.ts";
import { type SavedPaper, parseSaved, readingListCsv, toggleSaved } from "../lib/reading-list.ts";
import { createSearchEngine } from "../lib/search.ts";

function paper(index: number, title: string, abstract: string, year: string, animalGroups = "") {
  return {
    title, abstract, year, doi: `10.1/${index}`, url: "", journal: "", authors: "", origin: "Test",
    animal_group: animalGroups.split("; ")[0] || GENERAL, animal_groups: animalGroups || GENERAL, animals: "",
    search_text: `${title}. ${abstract}`,
  };
}

// Newest first, like the processed corpus.
const engine = createSearchEngine([
  paper(1, "Bird migration across Europe", "Satellite tracking of storks shows migration routes across European wetlands.", "2025", "Birds"),
  paper(2, "Elephant corridors in Kenya", "Elephants move through habitat corridors between protected areas. Elephant herds avoid fences.", "2024", "Elephants"),
  paper(3, "Tiger monitoring with camera traps in India", "Camera trap surveys estimate tiger density in Indian reserves.", "2023", "Big cats & wild cats; Livestock & domestic animals"),
  paper(4, "Indiana bat survey", "Acoustic monitoring of bats in Indiana caves.", "2022", "Bats"),
  paper(5, "Community attitudes to wildlife policy", "Interviews on coexistence with wildlife and governance of reserves.", "2021"),
]);
const titles = (options: Parameters<typeof engine.search>[0]) => engine.search(options).results.map((result) => result.title);

describe("search", () => {
  it("lists the whole corpus newest-first without a query", () => {
    const response = engine.search();
    assert.deepEqual([response.query, response.total, response.matched], ["", 5, 5]);
    assert.deepEqual(response.results.map((result) => result.year), ["2025", "2024", "2023", "2022", "2021"]);
    assert.ok(response.results.every((result) => result.score === 0));
  });

  it("scores matches with TF-IDF", () => {
    // "monitoring" is in 2 of the 5 papers: idf = ln(6/3) + 1. One occurrence each; ties keep corpus order.
    const monitoring = engine.search({ q: "monitoring" });
    assert.deepEqual(monitoring.results.map((result) => [result.title, result.score]), [
      ["Tiger monitoring with camera traps in India", 1.69], ["Indiana bat survey", 1.69],
    ]);
    // "tiger" is in 1 paper, twice. Repeated query words count and term frequency is log-scaled:
    // 2 * (1 + ln 2) * (ln(6/2) + 1).
    assert.deepEqual(engine.search({ q: "Tiger TIGER" }).results.map((result) => result.score), [7.11]);
    assert.equal(engine.search({ q: "  the and of  " }).matched, 0); // only stop words
    assert.equal(engine.search({ q: "xyzzy" }).matched, 0);
  });

  it("weights a word by how many papers contain it, not how often one paper repeats it", () => {
    const repeated = createSearchEngine([
      paper(1, "Zebra stripes", "zebra ".repeat(11), "2024"),
      ...["A", "B", "C"].map((letter, i) => paper(i + 2, `Forest survey ${letter}`, "One okapi was recorded.", "2023")),
    ]);
    // "zebra" is in 1 of 4 papers and "okapi" in 3, so the zebra paper ranks first however often it says "zebra".
    assert.equal(repeated.search({ q: "zebra okapi" }).results[0].title, "Zebra stripes");
  });

  it("filters by year, animal group, region and topic", () => {
    assert.deepEqual(titles({ year: "2024" }), ["Elephant corridors in Kenya"]);
    assert.deepEqual(titles({ animal: "Livestock & domestic animals" }), ["Tiger monitoring with camera traps in India"]);
    assert.deepEqual(titles({ animal: GENERAL }), ["Community attitudes to wildlife policy"]);
    assert.deepEqual(titles({ region: "INDIA" }), ["Tiger monitoring with camera traps in India"]); // not "Indiana"
    assert.deepEqual(titles({ topic: "monitoring" }), ["Tiger monitoring with camera traps in India", "Indiana bat survey"]);
    assert.deepEqual(titles({ topic: "conflict" }), ["Community attitudes to wildlife policy"]); // "coexistence"
    assert.deepEqual(titles({ topic: "kenya" }), ["Elephant corridors in Kenya"]); // no term list: whole word
    assert.deepEqual(titles({ q: "reserves", region: "europe" }), []);
  });

  it("sorts by year or by animal group", () => {
    assert.deepEqual(titles({ q: "monitoring tiger", sort: "oldest" }), ["Indiana bat survey", "Tiger monitoring with camera traps in India"]);
    assert.deepEqual(titles({ q: "reserves", sort: "newest" }), ["Tiger monitoring with camera traps in India", "Community attitudes to wildlife policy"]);
    // Groups in /api/stats order (biggest first, ties alphabetical, general last).
    assert.deepEqual(titles({ sort: "animal" }), [
      "Indiana bat survey", "Tiger monitoring with camera traps in India", "Bird migration across Europe",
      "Elephant corridors in Kenya", "Community attitudes to wildlife policy",
    ]);
  });

  it("returns between 1 and 50 results, 20 by default", () => {
    const counts = ["2", "0", "abc", "999", " 3 "].map((limit) => engine.search({ limit }));
    assert.deepEqual(counts.map((response) => [response.total, response.matched]), [[2, 5], [1, 5], [5, 5], [5, 5], [3, 5]]);
  });

  it("suggests related papers that share at least three distinctive words", () => {
    const related = createSearchEngine([
      paper(1, "Savanna elephant corridors", "Elephant herds use savanna corridors.", "2024"),
      paper(2, "Corridor planning for elephants", "Savanna corridors keep elephant herds connected.", "2023"),
      paper(3, "Savanna fires", "Fires reshape savanna corridors.", "2022"),
    ]);
    assert.deepEqual(related.search().results.map((result) => result.related), [
      ["Corridor planning for elephants"], ["Savanna elephant corridors"], [],
    ]);
  });
});

describe("stats", () => {
  it("lists years newest-first and animal groups by paper count", () => {
    const stats = engine.stats();
    assert.equal(stats.papers, 5);
    assert.deepEqual(stats.years, ["2025", "2024", "2023", "2022", "2021"]);
    assert.deepEqual(stats.animals.map((group) => group.name), [
      "Bats", "Big cats & wild cats", "Birds", "Elephants", "Livestock & domestic animals", GENERAL,
    ]);
    assert.ok(stats.animals.every((group) => group.count === 1));
  });
});

describe("shipped corpus", () => {
  it("loads data/processed/wildlife_papers_clean.csv once", () => {
    const corpus = getSearchEngine();
    const stats = corpus.stats();
    assert.ok(stats.papers > 0);
    assert.deepEqual(stats.years, [...stats.years].sort().reverse());
    const response = corpus.search();
    assert.equal(response.total, Math.min(20, stats.papers));
    assert.ok(response.results.every((result) => result.title && Array.isArray(result.related)));
    assert.equal(getSearchEngine(), corpus); // cached until the file changes
  });
});

describe("reading list", () => {
  const tiger: SavedPaper = { title: 'Tigers "in" India', year: "2023", authors: "A, B", journal: "Oryx", doi: "10.1/t", url: "https://doi.org/10.1/t" };

  it("adds and removes papers, keeping only the fields it needs", () => {
    const result = { ...tiger, abstract: "A long abstract", related: [] };
    const saved = toggleSaved([], result);
    assert.deepEqual(saved, [tiger]);
    assert.deepEqual(toggleSaved(saved, result), []);
  });

  it("exports a CSV with every value quoted", () => {
    assert.equal(
      readingListCsv([tiger]),
      'title,year,authors,journal,doi,url\n"Tigers ""in"" India","2023","A, B","Oryx","10.1/t","https://doi.org/10.1/t"',
    );
  });

  it("treats unreadable storage as an empty list", () => {
    assert.deepEqual(parseSaved(null), []);
    assert.deepEqual(parseSaved("not json"), []);
    assert.deepEqual(parseSaved('{"title":"x"}'), []);
    assert.deepEqual(parseSaved('[{"title":"x"},{"nope":1},null]'), [{ title: "x" }]);
  });
});
