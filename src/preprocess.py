"""Merge, clean and de-duplicate records from every source in data/raw/.

Produces data/processed/wildlife_papers_clean.csv and web/corpus.js.
"""

from __future__ import annotations

import csv
import html
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

from animals import GENERAL, GROUP_ORDER, classify

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_OUTPUT = ROOT / "data" / "processed" / "wildlife_papers_clean.csv"
WEB_CORPUS_OUTPUT = ROOT / "web" / "corpus.js"
MIN_ABSTRACT_LENGTH = 80
MIN_YEAR = 1900
LEGACY_ORIGIN = "Europe PMC"  # rows written before the `origin` column existed

# Broad keyword searches on Crossref/OpenAlex pull in off-topic papers ("energy conservation",
# "reactive oxygen species"). Keep a paper only if it has a wildlife-specific term AND at least
# two distinct ecology terms overall.
CORE_PATTERN = re.compile(
    r"\b(wildlife|biodiversity|endangered|poaching|fauna|habitats?|conservation|camera[- ]traps?|"
    r"protected areas?|national parks?|nature reserves?|human[- ]wildlife|animal movement)\b")
BROAD_PATTERN = re.compile(
    r"\b(wildlife|biodiversity|endangered|poaching|fauna|habitats?|conservation|camera[- ]traps?|"
    r"protected areas?|ecosystems?|mammals?|birds?|reptiles?|amphibians?|elephants?|tigers?|leopards?|"
    r"lions?|primates?|carnivores?|ungulates?|populations?|species|migration|corridors?|forests?|"
    r"wolf|wolves|bears?|deer|dolphins?|whales?|lemurs?|bats?|rhinos?|zoo|animals?)\b")


# Unambiguous in a title; bare "conservation" is not ("energy conservation", "water conservation").
STRONG_TITLE_PATTERN = re.compile(
    r"\b(wildlife|biodiversity|endangered|poaching|fauna|habitats?|camera[- ]traps?|protected areas?|"
    r"national parks?|nature reserves?|human[- ]wildlife|animal movement|conservation (biology|planning|status|genetics))\b")


def clean_text(value: str | None) -> str:
    """Decode HTML entities, strip stray tags and normalise whitespace; wording is untouched."""
    text = html.unescape(html.unescape(value or ""))  # some feeds double-encode (&amp;lt;i&amp;gt;)
    return re.sub(r"\s+", " ", re.sub(r"</?[a-zA-Z][^>]{0,40}>", "", text)).strip()


def title_key(title: str) -> str:
    """Case/punctuation-insensitive title, used to spot the same paper from different sources."""
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def normalise_doi(doi: str) -> str:
    return re.sub(r"^(https?://(dx\.)?doi\.org/|doi:)", "", doi.strip().lower())


def valid_year(year: str) -> bool:
    """Reject missing, malformed or future-dated years."""
    return year.isdigit() and MIN_YEAR <= int(year) <= date.today().year


def is_relevant(title: str, abstract: str) -> bool:
    """An unambiguous term in the title is enough; otherwise need a core term plus another ecology term."""
    if STRONG_TITLE_PATTERN.search(title.lower()):
        return True
    text = f"{title} {abstract}".lower()
    return bool(CORE_PATTERN.search(text)) and len({m.group(0) for m in BROAD_PATTERN.finditer(text)}) >= 2


def quality(row: dict[str, str]) -> tuple:
    """Prefer the richest copy of a duplicated paper (journal name, link, longer abstract)."""
    return (bool(row.get("journal")), bool(row.get("url") or row.get("doi")), len(row.get("abstract", "")))


def read_raw_rows() -> list[dict[str, str]]:
    files = sorted(RAW_DIR.glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"No CSV files in {RAW_DIR}. Run src/fetch_papers.py first.")
    rows: list[dict[str, str]] = []
    for path in files:
        with path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                row["origin"] = row.get("origin") or LEGACY_ORIGIN
                rows.append(row)
        print(f"  {path.name}: {len(rows)} rows so far")
    return rows


def build_corpus(source_rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], dict[str, int]]:
    dropped = {"incomplete": 0, "bad_year": 0, "off_topic": 0, "duplicate": 0}
    candidates: list[dict[str, str]] = []
    for raw in source_rows:
        row = {key: clean_text(value) for key, value in raw.items() if key}
        row["doi"] = normalise_doi(row.get("doi", ""))
        if not row.get("title") or len(row.get("abstract", "")) < MIN_ABSTRACT_LENGTH:
            dropped["incomplete"] += 1
        elif not valid_year(row.get("year", "")):
            dropped["bad_year"] += 1
        elif not is_relevant(row["title"], row["abstract"]):
            dropped["off_topic"] += 1
        else:
            candidates.append(row)

    candidates.sort(key=quality, reverse=True)  # best copy of each paper is seen first
    seen: set[str] = set()
    corpus: list[dict[str, str]] = []
    for row in candidates:
        keys = {title_key(row["title"])} | ({row["doi"]} if row["doi"] else set())
        if keys & seen:
            dropped["duplicate"] += 1
            continue
        seen |= keys
        if not row.get("url") and row["doi"]:
            row["url"] = f"https://doi.org/{row['doi']}"
        row.update(classify(row["title"], row["abstract"]))
        row["search_text"] = f"{row['title']}. {row['abstract']}"
        corpus.append(row)

    corpus.sort(key=lambda r: (r["year"], r.get("publication_date", ""), r["title"]), reverse=True)
    return corpus, dropped


def write_animal_outputs(corpus: list[dict[str, str]]) -> None:
    """Papers sorted by animal: a CSV for spreadsheets and a readable Markdown index."""
    counts = Counter(paper["animal_group"] for paper in corpus)
    order = {group: index for index, group in enumerate(sorted(GROUP_ORDER, key=lambda g: (g == GENERAL, -counts[g])))}
    ranked = sorted(corpus, key=lambda p: (order[p["animal_group"]], p["animals"], -int(p["year"]), p["title"]))

    by_animal_csv = PROCESSED_OUTPUT.with_name("papers_by_animal.csv")
    columns = ["animal_group", "animals", "animal_groups", "year", "title", "journal", "origin", "doi", "url"]
    with by_animal_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(ranked)

    lines = ["# EcoBrief papers by animal", "", f"{len(corpus)} papers. Each paper is listed under its main animal group; "
             "the *also* note lists other groups it covers.", "", "| Animal group | Papers |", "|---|---|"]
    lines += [f"| {group} | {counts[group]} |" for group in sorted(order, key=order.get) if counts[group]]
    for group in sorted(order, key=order.get):
        members = [paper for paper in ranked if paper["animal_group"] == group]
        if not members:
            continue
        lines += ["", f"## {group} ({len(members)})", ""]
        for paper in members:
            title = paper["title"].rstrip(".")
            link = f"[{title}]({paper['url']})" if paper.get("url") else title
            extra = [name for name in paper["animal_groups"].split("; ") if name not in (group, GENERAL)]
            tags = f" — {paper['animals']}" if paper["animals"] else ""
            also = f" *(also: {', '.join(extra)})*" if extra else ""
            lines.append(f"- {paper['year']} · {link}{tags}{also}")
    PROCESSED_OUTPUT.with_name("papers_by_animal.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("Reading raw files:")
    source_rows = read_raw_rows()
    cleaned_rows, dropped = build_corpus(source_rows)
    if not cleaned_rows:
        raise RuntimeError("No usable records remain after cleaning.")

    fieldnames = list(dict.fromkeys(key for row in cleaned_rows for key in row))
    PROCESSED_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with PROCESSED_OUTPUT.open("w", encoding="utf-8", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames, restval="")
        writer.writeheader()
        writer.writerows(cleaned_rows)

    write_animal_outputs(cleaned_rows)
    WEB_CORPUS_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    browser_fields = ("title", "abstract", "authors", "journal", "year", "doi", "url", "origin",
                      "animal_group", "animal_groups", "animals")
    browser_rows = [{field: paper.get(field, "") for field in browser_fields} for paper in cleaned_rows]
    WEB_CORPUS_OUTPUT.write_text(
        "window.ECOBRIEF_PAPERS = " + json.dumps(browser_rows, ensure_ascii=False) + ";\n", encoding="utf-8")

    by_origin: dict[str, int] = {}
    for paper in cleaned_rows:
        by_origin[paper["origin"]] = by_origin.get(paper["origin"], 0) + 1
    print("Animal groups: " + ", ".join(f"{g} {n}" for g, n in Counter(p["animal_group"] for p in cleaned_rows).most_common()))
    print(f"\nRead {len(source_rows)} raw records")
    print("Dropped " + ", ".join(f"{count} {reason.replace('_', ' ')}" for reason, count in dropped.items()))
    print(f"Saved {len(cleaned_rows)} searchable papers: " + ", ".join(f"{k} {v}" for k, v in sorted(by_origin.items())))


if __name__ == "__main__":
    main()
