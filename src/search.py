"""A dependency-free TF-IDF search engine for the EcoBrief corpus."""

from __future__ import annotations

import csv
import math
import re
import sys
from collections import Counter
from functools import lru_cache
from pathlib import Path

CORPUS = Path(__file__).resolve().parent.parent / "data" / "processed" / "wildlife_papers_clean.csv"
TOKEN_PATTERN = re.compile(r"[a-z]{2,}")
STOP_WORDS = {
    "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "of",
    "on", "or", "that", "the", "this", "to", "with", "we", "were", "was",
}

# Keep these lists in sync with REGION_TERMS / TOPIC_TERMS in web/app.js.
REGION_TERMS = {
    "africa": ["africa", "african"],
    "asia": ["asia", "asian"],
    "india": ["india", "indian"],
    "amazon": ["amazon", "amazonia", "amazonian"],
    "europe": ["europe", "european"],
}
TOPIC_TERMS = {
    "conflict": ["human-wildlife conflict", "conflict", "crop raiding", "fence", "coexistence"],
    "monitoring": ["monitoring", "camera trap", "camera-trap", "survey", "detection", "uav"],
    "habitat": ["habitat", "fragmentation", "connectivity", "landscape", "corridor"],
    "movement": ["movement", "migration", "space use", "tracking", "dispersal"],
    "conservation": ["conservation", "biodiversity", "protected area", "management", "endangered"],
}


def tokenize(text: str) -> list[str]:
    return [word for word in TOKEN_PATTERN.findall(text.lower()) if word not in STOP_WORDS]


def _term_regex(terms: list[str]) -> re.Pattern[str]:
    """Whole-word match, so 'india' does not match 'Indiana' or 'indicate'."""
    return re.compile(r"\b(?:" + "|".join(re.escape(term) for term in terms) + r")\b")


_FILTER_PATTERNS = {
    "region": {key: _term_regex(terms) for key, terms in REGION_TERMS.items()},
    "topic": {key: _term_regex(terms) for key, terms in TOPIC_TERMS.items()},
}


def matches_filter(paper: dict[str, str], kind: str, value: str) -> bool:
    """True when ``value`` is empty/unknown-free or the paper mentions it."""
    if not value:
        return True
    pattern = _FILTER_PATTERNS[kind].get(value)
    if pattern is None:
        pattern = _term_regex([value.lower()])
    return bool(pattern.search(f"{paper.get('title', '')} {paper.get('abstract', '')}".lower()))


@lru_cache(maxsize=1)
def load_corpus() -> tuple[dict[str, str], ...]:
    with CORPUS.open(encoding="utf-8", newline="") as corpus_file:
        return tuple(csv.DictReader(corpus_file))


@lru_cache(maxsize=1)
def _index() -> tuple[list[Counter], Counter]:
    """Build the term-frequency index once and reuse it for every query."""
    documents = [Counter(tokenize(paper["search_text"])) for paper in load_corpus()]
    document_frequency: Counter[str] = Counter()
    for document in documents:
        document_frequency.update(document)
    return documents, document_frequency


def search(query: str, limit: int | None = 5) -> list[tuple[float, dict[str, str]]]:
    """Rank papers by TF-IDF score. ``limit=None`` returns every match."""
    papers = load_corpus()
    documents, document_frequency = _index()

    query_terms = Counter(tokenize(query))
    if not query_terms:
        return []

    total_documents = len(documents)
    scores: dict[int, float] = {}
    for term, query_count in query_terms.items():
        if term not in document_frequency:
            continue
        inverse_frequency = math.log((total_documents + 1) / (document_frequency[term] + 1)) + 1
        for index, document in enumerate(documents):
            if term in document:
                scores[index] = scores.get(index, 0.0) + query_count * (1 + math.log(document[term])) * inverse_frequency

    ranked = sorted(scores.items(), key=lambda result: result[1], reverse=True)
    if limit is not None:
        ranked = ranked[:limit]
    return [(score, papers[index]) for index, score in ranked]


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    query = " ".join(sys.argv[1:]) or "wildlife conservation"
    results = search(query)
    print(f"\nTop results for: {query}\n")
    for number, (score, paper) in enumerate(results, start=1):
        print(f"{number}. {paper['title']} ({paper['year']}) - score {score:.2f}")
        print(f"   {paper['journal'] or 'Journal unavailable'}")
        print(f"   {paper['abstract'][:220]}...\n")


if __name__ == "__main__":
    main()
