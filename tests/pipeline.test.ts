// Offline tests for the data pipeline: parsers use sample payloads shaped like each API's documented response.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classify } from "../lib/animals.ts";
import { formatCsv, parseCsv, parseCsvRecords } from "../lib/csv.ts";
import { GENERAL } from "../lib/paper.ts";
import { animalIndex, buildCorpus } from "../lib/pipeline.ts";
import { matchesFilter } from "../lib/search.ts";
import {
  SOURCES, arxivParse, collect, crossrefNormalise, europepmcNormalise, fetchOpenalex, http, openalexNormalise, rawPaper,
} from "../lib/sources.ts";

const ABSTRACT = "Camera traps reveal how elephants use corridors between protected areas across the landscape. ".repeat(2);

describe("source parsers", () => {
  it("reads Europe PMC journals and tolerates an empty URL list", () => {
    const paper = europepmcNormalise({
      id: "1", source: "MED", doi: "10.1/X", title: "T", abstractText: `<h4>Abstract</h4>${ABSTRACT}`,
      journalInfo: { journal: { title: "Biol Conserv" } }, pubYear: "2024", fullTextUrlList: { fullTextUrl: [] },
    });
    assert.equal(paper.journal, "Biol Conserv");
    assert.equal(paper.doi, "10.1/x");
    assert.equal(paper.url, "");
    assert.ok(paper.abstract.startsWith("Camera traps"));
  });

  it("rebuilds OpenAlex abstracts and author lists", () => {
    const paper = openalexNormalise({
      id: "https://openalex.org/W42", doi: "https://doi.org/10.2/Y", title: "Tigers",
      abstract_inverted_index: { Tigers: [0], roam: [1], widely: [2, 4], and: [3] },
      authorships: [{ author: { display_name: "A B" } }, { author: { display_name: "C D" } }],
      primary_location: { landing_page_url: "https://x.org/p", source: { display_name: "PeerJ" } },
      publication_year: 2023, publication_date: "2023-05-01",
    });
    assert.equal(paper.abstract, "Tigers roam widely and widely");
    assert.deepEqual([paper.id, paper.doi, paper.journal, paper.authors], ["W42", "10.2/y", "PeerJ", "A B, C D"]);
  });

  it("handles OpenAlex works without an abstract or location", () => {
    const paper = openalexNormalise({ id: "https://openalex.org/W1", title: "x", abstract_inverted_index: null, primary_location: null });
    assert.deepEqual([paper.abstract, paper.journal], ["", ""]);
  });

  it("cleans Crossref JATS abstracts", () => {
    const paper = crossrefNormalise({
      DOI: "10.3/Z", title: ["Lions"], abstract: "<jats:p>Abstract Lions &amp; prey.</jats:p>",
      author: [{ given: "Ann", family: "Lee" }, { name: "Consortium" }], "container-title": ["Oryx"],
      issued: { "date-parts": [[2022, 3, 9]] }, URL: "http://dx.doi.org/10.3/Z",
    });
    assert.equal(paper.abstract, "Lions & prey.");
    assert.deepEqual(
      [paper.year, paper.publication_date, paper.authors, paper.journal],
      ["2022", "2022-03-09", "Ann Lee, Consortium", "Oryx"],
    );
  });

  it("parses arXiv Atom feeds", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry><id>http://arxiv.org/abs/2501.00001v1</id><published>2025-01-02T00:00:00Z</published>
      <title>Wildlife
        detection</title><summary> Detecting animals &amp; nests in drone imagery. </summary>
      <author><name>Z Q</name></author><arxiv:doi>10.4/ABC</arxiv:doi></entry></feed>`;
    const [paper] = arxivParse(xml);
    assert.deepEqual([paper.title, paper.id, paper.year, paper.doi], ["Wildlife detection", "2501.00001v1", "2025", "10.4/abc"]);
    assert.deepEqual([paper.abstract, paper.authors], ["Detecting animals & nests in drone imagery.", "Z Q"]);
  });

  it("stops cursor pagination at the last page and respects the limit", async (t) => {
    const pages = () => [
      { results: [0, 1, 2].map((i) => ({ id: `https://openalex.org/W${i}`, title: "t" })), meta: { next_cursor: "c2" } },
      { results: [{ id: "https://openalex.org/W9", title: "t" }], meta: { next_cursor: null } },
    ];
    let queue = pages();
    t.mock.method(http, "getJson", async () => queue.shift());
    t.mock.method(http, "sleep", async () => {});
    assert.equal((await fetchOpenalex("x", 100, 2020)).length, 4);
    queue = pages();
    assert.equal((await fetchOpenalex("x", 2, 2020)).length, 2);
  });

  it("retries rate-limited requests, but not other errors", async (t) => {
    const statuses = [429, 503, 200];
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("ok", { status: statuses.shift() }));
    const sleep = t.mock.method(http, "sleep", async () => {});
    assert.equal(await http.get("https://example.test/"), "ok");
    assert.equal(fetchMock.mock.callCount(), 3);
    assert.deepEqual(sleep.mock.calls.map((call) => call.arguments[0]), [2000, 4000]);
    statuses.push(404);
    await assert.rejects(http.get("https://example.test/"), /HTTP Error 404/);
    assert.equal(fetchMock.mock.callCount(), 4);
  });

  it("keeps going when one search term fails", async (t) => {
    const good = [rawPaper({ id: "1", source: "OA", title: "t", doi: "10.1/a" })];
    const responses = [() => Promise.reject(new Error("429")), () => Promise.resolve(good)];
    t.mock.method(SOURCES, "openalex", () => responses.shift()!());
    t.mock.method(console, "log", () => {});
    assert.equal((await collect("openalex", ["a", "b"], 10, 2020)).length, 1);
  });
});

describe("preprocess", () => {
  const base = { abstract: ABSTRACT, year: "2024", url: "", journal: "", origin: "A" };
  const rows = [
    { ...base, title: "Elephant corridors", doi: "10.1/a", origin: "arXiv" },
    { ...base, title: "Elephant Corridors.", doi: "https://doi.org/10.1/A", journal: "Oryx", origin: "Crossref" },
    { ...base, title: "Energy conservation in buildings", abstract: "Energy conservation reduces power use in buildings. ".repeat(3) },
    { ...base, title: "Future paper on wildlife", year: "2999" },
    { ...base, title: "Short", abstract: "too short" },
    { ...base, title: "Habitat &lt;i&gt;loss&lt;/i&gt; in tigers", doi: "" },
  ];

  it("merges sources and drops duplicate, incomplete, future and off-topic records", () => {
    const { corpus, dropped } = buildCorpus(rows);
    const titles = corpus.map((row) => row.title);
    assert.equal(corpus.length, 2, titles.join(" | "));
    const kept = corpus.find((row) => row.doi === "10.1/a")!;
    assert.deepEqual([kept.journal, kept.origin], ["Oryx", "Crossref"]); // richest copy wins
    assert.ok(titles.includes("Habitat loss in tigers")); // entities/tags decoded
    assert.deepEqual(dropped, { incomplete: 1, bad_year: 1, off_topic: 1, duplicate: 1 });
    assert.equal(kept.url, "https://doi.org/10.1/a");
  });

  it("indexes papers by animal group", () => {
    const { csv, markdown } = animalIndex(buildCorpus(rows).corpus);
    assert.ok(csv.startsWith("animal_group,animals,animal_groups,year,title,journal,origin,doi,url\r\n"));
    assert.match(markdown, /^\| Big cats & wild cats \| 1 \|$/m);
    assert.match(markdown, /^## Elephants \(1\)$/m);
    assert.match(markdown, /^- 2024 · \[Elephant Corridors\]\(https:\/\/doi\.org\/10\.1\/a\) — elephant$/m);
  });
});

describe("csv", () => {
  it("round-trips quotes, commas and line breaks", () => {
    const rows = [{ a: 'He said "hi", then left', b: "line one\nline two" }, { a: "", b: "plain" }];
    const text = formatCsv(["a", "b"], rows);
    assert.equal(text, 'a,b\r\n"He said ""hi"", then left","line one\nline two"\r\n,plain\r\n');
    assert.deepEqual(parseCsvRecords(text), rows);
  });

  it("skips blank lines, strips a byte-order mark and fills missing cells", () => {
    assert.deepEqual(parseCsvRecords("﻿id,title\n\n1,Tigers\r\n2\n"), [{ id: "1", title: "Tigers" }, { id: "2", title: "" }]);
    assert.deepEqual(parseCsv('x,"a""b"c\n'), [["x", 'a"bc']]);
  });
});

describe("filters", () => {
  it("matches regions as whole words", () => {
    assert.equal(matchesFilter({ title: "Indiana bats", abstract: "We indicate trends" }, "region", "india"), false);
    assert.equal(matchesFilter({ title: "Indian tigers", abstract: "" }, "region", "india"), true);
  });

  it("treats accented letters as part of a word", () => {
    assert.equal(matchesFilter({ title: "Indianápolis zoo", abstract: "" }, "region", "india"), false);
    assert.equal(classify("Antílope del desierto", "El antílope y el antílope.").animal_group, GENERAL);
  });
});

describe("animals", () => {
  it("prefers the focal animal over livestock context", () => {
    const result = classify("Livestock depredation by snow leopards", "Snow leopards kill livestock such as sheep and goats in villages. ".repeat(2));
    assert.equal(result.animal_group, "Big cats & wild cats");
    assert.ok(result.animals.includes("snow leopard"));
    assert.ok(!`; ${result.animals}`.includes("; leopard"));
  });

  it("tags several animal groups, or none", () => {
    const both = classify("Tortoises and birds at a wildlife centre", "We sampled tortoises and birds for bacteria.");
    assert.deepEqual(new Set(both.animal_groups.split("; ")), new Set(["Birds", "Reptiles"]));
    const plain = classify("Wildlife policy in protected areas", "Governance of reserves and community attitudes.");
    assert.deepEqual([plain.animal_group, plain.animals], [GENERAL, ""]);
  });

  it("does not match inside other words", () => {
    assert.equal(classify("Combat strategies", "A combatant battled the acrobat.").animal_group, GENERAL);
  });
});
