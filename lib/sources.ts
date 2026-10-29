// Download wildlife-conservation research metadata from open scholarly APIs (all free; none needs
// a key, though OpenAlex may ask for one):
//   europepmc  Europe PMC   biomedical + life-science articles and preprints
//   openalex   OpenAlex     250M+ works across every publisher (CC0)
//   crossref   Crossref     DOI registry, covers most journals
//   arxiv      arXiv        preprints (ecology, computer vision, remote sensing...)
// Every fetcher returns rows with the same FIELDS; scripts/fetch-papers.ts writes them to data/raw/.
import { decodeHTML, decodeXML } from "entities";
import { normaliseDoi } from "./text.ts";

export const FIELDS = ["id", "source", "doi", "title", "abstract", "authors", "journal", "year",
  "publication_date", "url", "origin"] as const;
export type RawPaper = Record<(typeof FIELDS)[number], string>;

const GENERAL_TERMS = [
  "wildlife conservation", "biodiversity conservation", "habitat fragmentation",
  "animal movement ecology", "human-wildlife conflict", "wildlife monitoring",
  "camera trap wildlife", "protected areas wildlife", "endangered species conservation",
  "poaching wildlife trade",
];
// Species terms make the UI's species filters (elephant, tiger, ...) worth using.
const SPECIES_TERMS = [
  "elephant conservation", "tiger conservation", "leopard conservation",
  "lion conservation", "primate conservation", "bird conservation",
];
export const SEARCH_TERMS = [...GENERAL_TERMS, ...SPECIES_TERMS];

const CONTACT = process.env.ECOBRIEF_EMAIL ?? "";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

// --------------------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status: number, statusText: string) {
    super(`HTTP Error ${status}${statusText ? `: ${statusText}` : ""}`);
  }
}

/** Network access, kept on one object so tests can replace it. */
export const http = {
  /** GET with a descriptive User-Agent and exponential backoff on 429/5xx and network errors. */
  async get(url: string, retries = 4, timeoutMs = 60_000): Promise<string> {
    const agent = `EcoBrief/1.0 (research dashboard${CONTACT ? `; mailto:${CONTACT}` : ""})`;
    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < retries - 1;
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": agent, Accept: "application/json, application/atom+xml" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return await response.text();
        if (!RETRY_STATUSES.has(response.status) || !canRetry) throw new HttpError(response.status, response.statusText);
      } catch (error) {
        if (error instanceof HttpError || !canRetry) throw error;
      }
      await http.sleep(2 ** (attempt + 1) * 1000);
    }
  },
  async getJson<T>(url: string): Promise<T> {
    return JSON.parse(await http.get(url)) as T;
  },
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

/** Strip JATS/HTML tags and a leading "Abstract" label; collapse whitespace. */
export function cleanAbstract(text: string | null | undefined): string {
  const plain = decodeHTML((text ?? "").replace(/<[^>]+>/g, " "));
  return plain.replace(/^\s*abstract[:.\s]+/i, "").replace(/\s+/g, " ").trim();
}

/** A row with every field present (missing values become ""). */
export function rawPaper(values: Partial<Record<(typeof FIELDS)[number], unknown>>): RawPaper {
  return Object.fromEntries(FIELDS.map((field) => [field, String(values[field] || "").trim()])) as RawPaper;
}

const doiUrl = (doi: string) => (doi ? `https://doi.org/${doi}` : "");

// --------------------------------------------------------------------------- Europe PMC

interface EuropePmcRecord {
  id?: string; source?: string; doi?: string; title?: string; abstractText?: string; authorString?: string;
  journalInfo?: { journal?: { title?: string } } | null; journalTitle?: string; pubYear?: string;
  firstPublicationDate?: string; fullTextUrlList?: { fullTextUrl?: { url?: string }[] } | null;
}

export function europepmcNormalise(record: EuropePmcRecord): RawPaper {
  return rawPaper({
    id: record.id, source: record.source, doi: normaliseDoi(record.doi), title: record.title,
    abstract: cleanAbstract(record.abstractText), authors: record.authorString,
    journal: record.journalInfo?.journal?.title || record.journalTitle, year: record.pubYear,
    publication_date: record.firstPublicationDate, url: record.fullTextUrlList?.fullTextUrl?.[0]?.url,
    origin: "Europe PMC",
  });
}

export async function fetchEuropepmc(term: string, limit: number, fromYear: number): Promise<RawPaper[]> {
  const base = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
  const query = `"${term}" AND HAS_ABSTRACT:Y AND PUB_YEAR:[${fromYear} TO ${new Date().getFullYear()}]`;
  let cursor = "*";
  const results: RawPaper[] = [];
  while (results.length < limit) {
    const params = new URLSearchParams({
      query, format: "json", resultType: "core",
      pageSize: String(Math.min(limit - results.length, 1000)), cursorMark: cursor,
    });
    const payload = await http.getJson<{ resultList?: { result?: EuropePmcRecord[] }; nextCursorMark?: string }>(`${base}?${params}`);
    const page = payload.resultList?.result ?? [];
    results.push(...page.map(europepmcNormalise));
    const next = payload.nextCursorMark;
    if (!page.length || !next || next === cursor) break;
    cursor = next;
    await http.sleep(300);
  }
  return results.slice(0, limit);
}

// --------------------------------------------------------------------------- OpenAlex

interface OpenAlexWork {
  id?: string; doi?: string; title?: string; display_name?: string;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: { author?: { display_name?: string } | null }[] | null;
  primary_location?: { landing_page_url?: string; source?: { display_name?: string } | null } | null;
  publication_year?: number; publication_date?: string;
}

/** OpenAlex stores abstracts as {word: [positions]}; rebuild the running text. */
export function openalexAbstract(invertedIndex: Record<string, number[]> | null | undefined): string {
  if (!invertedIndex) return "";
  const words = new Map<number, string>();
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) words.set(position, word);
  }
  return [...words.keys()].sort((a, b) => a - b).map((position) => words.get(position)).join(" ");
}

export function openalexNormalise(work: OpenAlexWork): RawPaper {
  const location = work.primary_location ?? {};
  const authors = (work.authorships ?? [])
    .map((authorship) => authorship.author?.display_name ?? "")
    .join(", ")
    .replace(/^[, ]+|[, ]+$/g, "");
  const doi = normaliseDoi(work.doi);
  return rawPaper({
    id: (work.id ?? "").split("/").pop(), source: "OA", doi, title: work.title || work.display_name,
    abstract: cleanAbstract(openalexAbstract(work.abstract_inverted_index)), authors,
    journal: location.source?.display_name, year: work.publication_year, publication_date: work.publication_date,
    url: location.landing_page_url || doiUrl(doi), origin: "OpenAlex",
  });
}

export async function fetchOpenalex(term: string, limit: number, fromYear: number): Promise<RawPaper[]> {
  const base = "https://api.openalex.org/works";
  let cursor = "*";
  const results: RawPaper[] = [];
  while (results.length < limit) {
    const params = new URLSearchParams({
      search: term,
      filter: `has_abstract:true,language:en,from_publication_date:${fromYear}-01-01,type:article|preprint`,
      "per-page": String(Math.min(limit - results.length, 200)),
      cursor,
      select: "id,doi,title,display_name,abstract_inverted_index,authorships,primary_location,publication_year,publication_date",
    });
    if (CONTACT) params.set("mailto", CONTACT);
    if (process.env.OPENALEX_API_KEY) params.set("api_key", process.env.OPENALEX_API_KEY);
    const payload = await http.getJson<{ results?: OpenAlexWork[]; meta?: { next_cursor?: string | null } }>(`${base}?${params}`);
    const page = payload.results ?? [];
    results.push(...page.map(openalexNormalise));
    const next = payload.meta?.next_cursor;
    if (!page.length || !next) break;
    cursor = next;
    await http.sleep(200);
  }
  return results.slice(0, limit);
}

// --------------------------------------------------------------------------- Crossref

interface CrossrefItem {
  DOI?: string; title?: string[]; abstract?: string; URL?: string; "container-title"?: string[];
  author?: { given?: string; family?: string; name?: string }[]; issued?: { "date-parts"?: (number | null)[][] };
}

export function crossrefNormalise(item: CrossrefItem): RawPaper {
  const parts = item.issued?.["date-parts"]?.[0] ?? [];
  const date = parts
    .map((part, index) => (part ? (index ? String(part).padStart(2, "0") : String(part)) : ""))
    .filter(Boolean)
    .join("-");
  const authors = (item.author ?? [])
    .map((author) => [author.given, author.family].filter(Boolean).join(" ") || author.name || "")
    .join(", ");
  const doi = normaliseDoi(item.DOI);
  return rawPaper({
    id: doi, source: "CR", doi, title: (item.title ?? []).join(" "), abstract: cleanAbstract(item.abstract),
    authors, journal: (item["container-title"] ?? []).slice(0, 1).join(" "), year: parts[0] ? String(parts[0]) : "",
    publication_date: date, url: item.URL || doiUrl(doi), origin: "Crossref",
  });
}

export async function fetchCrossref(term: string, limit: number, fromYear: number): Promise<RawPaper[]> {
  const base = "https://api.crossref.org/works";
  let cursor = "*";
  const results: RawPaper[] = [];
  while (results.length < limit) {
    const params = new URLSearchParams({
      "query.bibliographic": term,
      filter: `has-abstract:true,from-pub-date:${fromYear},type:journal-article`,
      rows: String(Math.min(limit - results.length, 200)),
      cursor,
      select: "DOI,title,abstract,author,container-title,issued,URL",
    });
    if (CONTACT) params.set("mailto", CONTACT);
    const { message = {} } = await http.getJson<{ message?: { items?: CrossrefItem[]; "next-cursor"?: string } }>(`${base}?${params}`);
    const page = message.items ?? [];
    results.push(...page.map(crossrefNormalise));
    const next = message["next-cursor"];
    if (!page.length || !next) break;
    cursor = next;
    await http.sleep(300);
  }
  return results.slice(0, limit);
}

// --------------------------------------------------------------------------- arXiv

const ENTRY = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
const AUTHOR = /<author\b[^>]*>([\s\S]*?)<\/author>/g;

/** Text of the first `<tag>` element in an Atom fragment (entities decoded), or "" when missing. */
function elementText(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXML(match[1]).trim() : "";
}

export function arxivParse(xml: string): RawPaper[] {
  return Array.from(xml.matchAll(ENTRY), ([, entry]) => {
    const link = elementText(entry, "id");
    const published = elementText(entry, "published");
    return rawPaper({
      id: link.split("/abs/").pop(), source: "ARXIV", doi: normaliseDoi(elementText(entry, "arxiv:doi")),
      title: elementText(entry, "title").replace(/\s+/g, " "), abstract: cleanAbstract(elementText(entry, "summary")),
      authors: Array.from(entry.matchAll(AUTHOR), ([, author]) => elementText(author, "name")).join(", "),
      journal: "arXiv preprint", year: published.slice(0, 4), publication_date: published.slice(0, 10), url: link,
      origin: "arXiv",
    });
  });
}

export async function fetchArxiv(term: string, limit: number, fromYear: number): Promise<RawPaper[]> {
  const base = "https://export.arxiv.org/api/query";
  const results: RawPaper[] = [];
  for (let start = 0; results.length < limit; start += 100) {
    const params = new URLSearchParams({
      search_query: `all:"${term}"`, start: String(start), max_results: String(Math.min(limit - results.length, 100)),
      sortBy: "submittedDate", sortOrder: "descending",
    });
    const page = arxivParse(await http.get(`${base}?${params}`))
      .filter((paper) => /^\d+$/.test(paper.year) && Number(paper.year) >= fromYear);
    if (!page.length) break;
    results.push(...page);
    await http.sleep(3000); // arXiv asks clients to wait ~3 s between calls
  }
  return results.slice(0, limit);
}

export type Fetcher = (term: string, limit: number, fromYear: number) => Promise<RawPaper[]>;

export const SOURCES: Record<string, Fetcher> = {
  europepmc: fetchEuropepmc,
  openalex: fetchOpenalex,
  crossref: fetchCrossref,
  arxiv: fetchArxiv,
};

// --------------------------------------------------------------------------- driver

/** Run every term against one source; a failing term is reported, not fatal. */
export async function collect(source: string, terms: readonly string[], perTerm: number, fromYear: number): Promise<RawPaper[]> {
  const papers: RawPaper[] = [];
  const seen = new Set<string>();
  for (const [index, term] of terms.entries()) {
    let found: RawPaper[];
    try {
      found = await SOURCES[source](term, perTerm, fromYear);
    } catch (error) { // network hiccup, rate limit, API change
      console.log(`  [${source}] "${term}": FAILED (${error instanceof Error ? error.message : error})`);
      continue;
    }
    let fresh = 0;
    for (const paper of found) {
      const key = paper.doi || `${paper.source}:${paper.id}`;
      if (paper.title && !seen.has(key)) {
        seen.add(key);
        papers.push(paper);
        fresh++;
      }
    }
    console.log(`  [${source}] (${index + 1}/${terms.length}) "${term}": ${found.length} fetched, ${fresh} new`);
  }
  return papers;
}
