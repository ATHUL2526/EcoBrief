// Merge, clean and de-duplicate raw records from every source into the search corpus
// (run by scripts/preprocess.ts).
import { decodeHTML } from "entities";
import { GROUP_ORDER, classify } from "./animals.ts";
import { formatCsv } from "./csv.ts";
import { GENERAL } from "./paper.ts";
import { compareText, normaliseDoi, wholeWord } from "./text.ts";

export type Row = Record<string, string>;
export type DropReason = "incomplete" | "bad_year" | "off_topic" | "duplicate";

export const MIN_ABSTRACT_LENGTH = 80;
export const MIN_YEAR = 1900;
export const LEGACY_ORIGIN = "Europe PMC"; // rows written before the `origin` column existed

// Broad keyword searches on Crossref/OpenAlex pull in off-topic papers ("energy conservation",
// "reactive oxygen species"). Keep a paper only if it has a wildlife-specific term AND at least
// two distinct ecology terms overall.
const CORE_PATTERN = wholeWord(
  "wildlife|biodiversity|endangered|poaching|fauna|habitats?|conservation|camera[- ]traps?|"
  + "protected areas?|national parks?|nature reserves?|human[- ]wildlife|animal movement");
const BROAD_PATTERN = wholeWord(
  "wildlife|biodiversity|endangered|poaching|fauna|habitats?|conservation|camera[- ]traps?|"
  + "protected areas?|ecosystems?|mammals?|birds?|reptiles?|amphibians?|elephants?|tigers?|leopards?|"
  + "lions?|primates?|carnivores?|ungulates?|populations?|species|migration|corridors?|forests?|"
  + "wolf|wolves|bears?|deer|dolphins?|whales?|lemurs?|bats?|rhinos?|zoo|animals?", "gu");

// Unambiguous in a title; bare "conservation" is not ("energy conservation", "water conservation").
const STRONG_TITLE_PATTERN = wholeWord(
  "wildlife|biodiversity|endangered|poaching|fauna|habitats?|camera[- ]traps?|protected areas?|"
  + "national parks?|nature reserves?|human[- ]wildlife|animal movement|conservation (?:biology|planning|status|genetics)");

/** Decode HTML entities, strip stray tags and normalise whitespace; wording is untouched. */
export function cleanText(value: string | undefined): string {
  const text = decodeHTML(decodeHTML(value ?? "")); // some feeds double-encode (&amp;lt;i&amp;gt;)
  return text.replace(/<\/?[a-zA-Z][^>]{0,40}>/g, "").replace(/\s+/g, " ").trim();
}

/** Case/punctuation-insensitive title, used to spot the same paper from different sources. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Reject missing, malformed or future-dated years. */
export function validYear(year: string): boolean {
  return /^\d+$/.test(year) && MIN_YEAR <= Number(year) && Number(year) <= new Date().getFullYear();
}

/** An unambiguous term in the title is enough; otherwise need a core term plus another ecology term. */
export function isRelevant(title: string, abstract: string): boolean {
  if (STRONG_TITLE_PATTERN.test(title.toLowerCase())) return true;
  const text = `${title} ${abstract}`.toLowerCase();
  return CORE_PATTERN.test(text) && new Set(Array.from(text.matchAll(BROAD_PATTERN), (match) => match[0])).size >= 2;
}

export function buildCorpus(sourceRows: readonly Row[]): { corpus: Row[]; dropped: Record<DropReason, number> } {
  const dropped = { incomplete: 0, bad_year: 0, off_topic: 0, duplicate: 0 };
  const candidates: Row[] = [];
  for (const raw of sourceRows) {
    const row: Row = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key) row[key] = cleanText(value);
    }
    row.doi = normaliseDoi(row.doi);
    if (!row.title || (row.abstract ?? "").length < MIN_ABSTRACT_LENGTH) dropped.incomplete++;
    else if (!validYear(row.year ?? "")) dropped.bad_year++;
    else if (!isRelevant(row.title, row.abstract)) dropped.off_topic++;
    else candidates.push(row);
  }

  // Prefer the richest copy of a duplicated paper (journal name, link, longer abstract): it is seen first.
  candidates.sort((a, b) =>
    Number(Boolean(b.journal)) - Number(Boolean(a.journal))
    || Number(Boolean(b.url || b.doi)) - Number(Boolean(a.url || a.doi))
    || b.abstract.length - a.abstract.length);
  const seen = new Set<string>();
  const corpus: Row[] = [];
  for (const row of candidates) {
    const keys = row.doi ? [titleKey(row.title), row.doi] : [titleKey(row.title)];
    if (keys.some((key) => seen.has(key))) {
      dropped.duplicate++;
      continue;
    }
    for (const key of keys) seen.add(key);
    if (!row.url && row.doi) row.url = `https://doi.org/${row.doi}`;
    Object.assign(row, classify(row.title, row.abstract));
    row.search_text = `${row.title}. ${row.abstract}`;
    corpus.push(row);
  }

  // Newest first.
  corpus.sort((a, b) =>
    compareText(b.year, a.year) || compareText(b.publication_date ?? "", a.publication_date ?? "") || compareText(b.title, a.title));
  return { corpus, dropped };
}

const ANIMAL_INDEX_COLUMNS = ["animal_group", "animals", "animal_groups", "year", "title", "journal", "origin", "doi", "url"];

/** Papers sorted by animal: a CSV for spreadsheets and a readable Markdown index. */
export function animalIndex(corpus: readonly Row[]): { csv: string; markdown: string } {
  const counts = new Map<string, number>();
  for (const paper of corpus) counts.set(paper.animal_group, (counts.get(paper.animal_group) ?? 0) + 1);
  const size = (group: string) => counts.get(group) ?? 0;
  const groups = [...GROUP_ORDER].sort((a, b) => Number(a === GENERAL) - Number(b === GENERAL) || size(b) - size(a));
  const order = new Map(groups.map((group, index) => [group, index]));
  const ranked = [...corpus].sort((a, b) =>
    order.get(a.animal_group)! - order.get(b.animal_group)!
    || compareText(a.animals, b.animals)
    || Number(b.year) - Number(a.year)
    || compareText(a.title, b.title));

  const lines = [
    "# EcoBrief papers by animal", "",
    `${corpus.length} papers. Each paper is listed under its main animal group; the *also* note lists other groups it covers.`, "",
    "| Animal group | Papers |", "|---|---|",
    ...groups.filter((group) => size(group) > 0).map((group) => `| ${group} | ${size(group)} |`),
  ];
  for (const group of groups) {
    const members = ranked.filter((paper) => paper.animal_group === group);
    if (!members.length) continue;
    lines.push("", `## ${group} (${members.length})`, "");
    for (const paper of members) {
      const title = paper.title.replace(/\.+$/, "");
      const link = paper.url ? `[${title}](${paper.url})` : title;
      const extra = paper.animal_groups.split("; ").filter((name) => name !== group && name !== GENERAL);
      const tags = paper.animals ? ` — ${paper.animals}` : "";
      const also = extra.length ? ` *(also: ${extra.join(", ")})*` : "";
      lines.push(`- ${paper.year} · ${link}${tags}${also}`);
    }
  }
  return { csv: formatCsv(ANIMAL_INDEX_COLUMNS, ranked), markdown: lines.join("\n") + "\n" };
}
