"""Download wildlife-conservation research metadata from several open scholarly APIs.

Sources (all free; none needs a key, though OpenAlex may ask for one):
    europepmc  Europe PMC      biomedical + life-science articles and preprints
    openalex   OpenAlex        250M+ works across every publisher (CC0)
    crossref   Crossref        DOI registry, covers most journals
    arxiv      arXiv           preprints (ecology, computer vision, remote sensing...)

Each source is written to its own file, data/raw/<source>.csv. Run src/preprocess.py
afterwards to merge, de-duplicate and build the search corpus.

Examples:
    python src/fetch_papers.py                          # every source, defaults
    python src/fetch_papers.py --sources openalex arxiv --per-term 200
    set ECOBRIEF_EMAIL=you@example.com                  # polite-pool access (recommended)
    set OPENALEX_API_KEY=...                            # only if OpenAlex asks for one
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
CONTACT = os.environ.get("ECOBRIEF_EMAIL", "")
FIELDS = ["id", "source", "doi", "title", "abstract", "authors", "journal", "year",
          "publication_date", "url", "origin"]

GENERAL_TERMS = [
    "wildlife conservation", "biodiversity conservation", "habitat fragmentation",
    "animal movement ecology", "human-wildlife conflict", "wildlife monitoring",
    "camera trap wildlife", "protected areas wildlife", "endangered species conservation",
    "poaching wildlife trade",
]
# Species terms make the UI's species filters (elephant, tiger, ...) worth using.
SPECIES_TERMS = [
    "elephant conservation", "tiger conservation", "leopard conservation",
    "lion conservation", "primate conservation", "bird conservation",
]
SEARCH_TERMS = GENERAL_TERMS + SPECIES_TERMS


# --------------------------------------------------------------------------- helpers

def http_get(url: str, retries: int = 4, timeout: int = 40) -> bytes:
    """GET with a descriptive User-Agent and exponential backoff on 429/5xx."""
    agent = f"EcoBrief/1.0 (research dashboard{'; mailto:' + CONTACT if CONTACT else ''})"
    for attempt in range(retries):
        try:
            request = Request(url, headers={"User-Agent": agent, "Accept": "application/json, application/atom+xml"})
            with urlopen(request, timeout=timeout) as response:  # nosec B310: fixed HTTPS API hosts
                return response.read()
        except HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
        except URLError:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def get_json(url: str) -> dict:
    return json.loads(http_get(url))


def clean_abstract(text: str | None) -> str:
    """Strip JATS/HTML tags and a leading 'Abstract' label; collapse whitespace."""
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"^\s*abstract[:.\s]+", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def normalise_doi(doi: str | None) -> str:
    doi = (doi or "").strip().lower()
    return re.sub(r"^(https?://(dx\.)?doi\.org/|doi:)", "", doi)


def row(**values: str) -> dict[str, str]:
    record = {field: "" for field in FIELDS}
    record.update({key: str(value or "").strip() for key, value in values.items()})
    return record


# --------------------------------------------------------------------------- Europe PMC

def europepmc_normalise(record: dict) -> dict:
    journal = (record.get("journalInfo", {}).get("journal", {}).get("title")
               or record.get("journalTitle", ""))
    urls = (record.get("fullTextUrlList") or {}).get("fullTextUrl") or [{}]
    return row(id=record.get("id"), source=record.get("source"), doi=normalise_doi(record.get("doi")),
               title=record.get("title"), abstract=clean_abstract(record.get("abstractText")),
               authors=record.get("authorString"), journal=journal, year=record.get("pubYear"),
               publication_date=record.get("firstPublicationDate"), url=urls[0].get("url"),
               origin="Europe PMC")


def fetch_europepmc(term: str, limit: int, from_year: int) -> list[dict]:
    base = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
    query = f'"{term}" AND HAS_ABSTRACT:Y AND PUB_YEAR:[{from_year} TO {date.today().year}]'
    cursor, results = "*", []
    while len(results) < limit:
        params = {"query": query, "format": "json", "resultType": "core",
                  "pageSize": min(limit - len(results), 1000), "cursorMark": cursor}
        payload = get_json(f"{base}?{urlencode(params)}")
        page = payload.get("resultList", {}).get("result", [])
        results.extend(europepmc_normalise(record) for record in page)
        next_cursor = payload.get("nextCursorMark")
        if not page or not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor
        time.sleep(0.3)
    return results[:limit]


# --------------------------------------------------------------------------- OpenAlex

def openalex_abstract(inverted_index: dict | None) -> str:
    """OpenAlex stores abstracts as {word: [positions]}; rebuild the running text."""
    if not inverted_index:
        return ""
    words: dict[int, str] = {}
    for word, positions in inverted_index.items():
        for position in positions:
            words[position] = word
    return " ".join(words[position] for position in sorted(words))


def openalex_normalise(work: dict) -> dict:
    location = work.get("primary_location") or {}
    source = location.get("source") or {}
    authors = ", ".join(
        (authorship.get("author") or {}).get("display_name", "")
        for authorship in work.get("authorships") or []
    ).strip(", ")
    doi = normalise_doi(work.get("doi"))
    return row(id=(work.get("id") or "").rsplit("/", 1)[-1], source="OA", doi=doi,
               title=work.get("title") or work.get("display_name"),
               abstract=clean_abstract(openalex_abstract(work.get("abstract_inverted_index"))),
               authors=authors, journal=source.get("display_name"), year=work.get("publication_year"),
               publication_date=work.get("publication_date"),
               url=location.get("landing_page_url") or (f"https://doi.org/{doi}" if doi else ""),
               origin="OpenAlex")


def fetch_openalex(term: str, limit: int, from_year: int) -> list[dict]:
    base = "https://api.openalex.org/works"
    cursor, results = "*", []
    while len(results) < limit:
        params = {
            "search": term,
            "filter": f"has_abstract:true,language:en,from_publication_date:{from_year}-01-01,type:article|preprint",
            "per-page": min(limit - len(results), 200),
            "cursor": cursor,
            "select": "id,doi,title,display_name,abstract_inverted_index,authorships,primary_location,publication_year,publication_date",
        }
        if CONTACT:
            params["mailto"] = CONTACT
        if os.environ.get("OPENALEX_API_KEY"):
            params["api_key"] = os.environ["OPENALEX_API_KEY"]
        payload = get_json(f"{base}?{urlencode(params)}")
        page = payload.get("results", [])
        results.extend(openalex_normalise(work) for work in page)
        cursor = (payload.get("meta") or {}).get("next_cursor")
        if not page or not cursor:
            break
        time.sleep(0.2)
    return results[:limit]


# --------------------------------------------------------------------------- Crossref

def crossref_normalise(item: dict) -> dict:
    parts = ((item.get("issued") or {}).get("date-parts") or [[None]])[0]
    year = str(parts[0]) if parts and parts[0] else ""
    date_text = "-".join(f"{part:02d}" if index else str(part) for index, part in enumerate(parts) if part)
    authors = ", ".join(
        " ".join(filter(None, [author.get("given"), author.get("family")])) or author.get("name", "")
        for author in item.get("author") or []
    )
    doi = normalise_doi(item.get("DOI"))
    return row(id=doi, source="CR", doi=doi, title=" ".join(item.get("title") or []),
               abstract=clean_abstract(item.get("abstract")), authors=authors,
               journal=" ".join((item.get("container-title") or [])[:1]), year=year,
               publication_date=date_text, url=item.get("URL") or (f"https://doi.org/{doi}" if doi else ""),
               origin="Crossref")


def fetch_crossref(term: str, limit: int, from_year: int) -> list[dict]:
    base = "https://api.crossref.org/works"
    cursor, results = "*", []
    while len(results) < limit:
        params = {
            "query.bibliographic": term,
            "filter": f"has-abstract:true,from-pub-date:{from_year},type:journal-article",
            "rows": min(limit - len(results), 200),
            "cursor": cursor,
            "select": "DOI,title,abstract,author,container-title,issued,URL",
        }
        if CONTACT:
            params["mailto"] = CONTACT
        message = get_json(f"{base}?{urlencode(params)}").get("message", {})
        page = message.get("items", [])
        results.extend(crossref_normalise(item) for item in page)
        cursor = message.get("next-cursor")
        if not page or not cursor:
            break
        time.sleep(0.3)
    return results[:limit]


# --------------------------------------------------------------------------- arXiv

ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"


def arxiv_parse(xml_bytes: bytes) -> list[dict]:
    results = []
    for entry in ET.fromstring(xml_bytes).findall(f"{ATOM}entry"):
        text = lambda tag: (entry.findtext(f"{ATOM}{tag}") or "").strip()
        link = text("id")
        published = text("published")
        results.append(row(
            id=link.rsplit("/abs/", 1)[-1], source="ARXIV",
            doi=normalise_doi(entry.findtext(f"{ARXIV}doi")),
            title=re.sub(r"\s+", " ", text("title")), abstract=clean_abstract(text("summary")),
            authors=", ".join((a.findtext(f"{ATOM}name") or "").strip() for a in entry.findall(f"{ATOM}author")),
            journal="arXiv preprint", year=published[:4], publication_date=published[:10], url=link,
            origin="arXiv"))
    return results


def fetch_arxiv(term: str, limit: int, from_year: int) -> list[dict]:
    base = "http://export.arxiv.org/api/query"
    results, start = [], 0
    while len(results) < limit:
        params = {"search_query": f'all:"{term}"', "start": start, "max_results": min(limit - len(results), 100),
                  "sortBy": "submittedDate", "sortOrder": "descending"}
        page = arxiv_parse(http_get(f"{base}?{urlencode(params)}"))
        page = [paper for paper in page if paper["year"].isdigit() and int(paper["year"]) >= from_year]
        if not page:
            break
        results.extend(page)
        start += 100
        time.sleep(3)  # arXiv asks clients to wait ~3 s between calls
    return results[:limit]


SOURCES = {
    "europepmc": fetch_europepmc,
    "openalex": fetch_openalex,
    "crossref": fetch_crossref,
    "arxiv": fetch_arxiv,
}


# --------------------------------------------------------------------------- driver

def collect(source: str, terms: list[str], per_term: int, from_year: int) -> list[dict]:
    """Run every term against one source; a failing term is reported, not fatal."""
    fetch = SOURCES[source]
    papers: list[dict] = []
    seen: set[str] = set()
    for number, term in enumerate(terms, start=1):
        try:
            found = fetch(term, per_term, from_year)
        except Exception as error:  # network hiccup, rate limit, API change
            print(f"  [{source}] {term!r}: FAILED ({error})")
            continue
        fresh = 0
        for paper in found:
            key = paper["doi"] or f"{paper['source']}:{paper['id']}"
            if paper["title"] and key not in seen:
                seen.add(key)
                papers.append(paper)
                fresh += 1
        print(f"  [{source}] ({number}/{len(terms)}) {term!r}: {len(found)} fetched, {fresh} new")
    return papers


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sources", nargs="+", choices=list(SOURCES), default=list(SOURCES))
    parser.add_argument("--per-term", type=int, default=100, help="max records per search term per source")
    parser.add_argument("--from-year", type=int, default=2010)
    parser.add_argument("--terms", nargs="+", default=SEARCH_TERMS, help="override the search terms")
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for source in args.sources:
        print(f"\n== {source} ==")
        papers = collect(source, args.terms, args.per_term, args.from_year)
        if not papers:
            print(f"  No records from {source}; keeping any existing file.")
            continue
        output = RAW_DIR / f"{source}.csv"
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(papers)
        with_abstract = sum(bool(paper["abstract"]) for paper in papers)
        print(f"  Saved {len(papers)} papers ({with_abstract} with abstracts) to {output}")
        total += len(papers)

    if not total:
        raise RuntimeError("No source returned records. Check your connection and try again.")
    print(f"\nDone: {total} records. Now run: python src/preprocess.py")


if __name__ == "__main__":
    main()
