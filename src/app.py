"""Local EcoBrief dashboard server with no third-party dependencies."""

from __future__ import annotations

import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from animals import GENERAL
from search import load_corpus, matches_filter, search

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = PROJECT_ROOT / "web"


def animal_counts() -> list[dict]:
    """Animal groups with paper counts (a paper counts once per group it covers), biggest first."""
    counts: dict[str, int] = {}
    for paper in load_corpus():
        for group in (paper.get("animal_groups") or GENERAL).split("; "):
            counts[group] = counts.get(group, 0) + 1
    ordered = sorted(counts, key=lambda group: (group == GENERAL, -counts[group], group))
    return [{"name": group, "count": counts[group]} for group in ordered]


def parse_limit(raw: str, default: int = 20) -> int:
    try:
        return min(max(int(raw), 1), 50)
    except (TypeError, ValueError):
        return default


class EcoBriefHandler(SimpleHTTPRequestHandler):
    """Serve the dashboard and its compact JSON search API."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/search":
                self.handle_search(parse_qs(parsed.query))
                return
            if parsed.path == "/api/stats":
                self.handle_stats()
                return
        except Exception as error:  # keep the server alive and tell the browser what happened
            self.send_json({"error": str(error)}, status=500)
            return
        super().do_GET()

    def handle_search(self, params: dict[str, list[str]]) -> None:
        def param(name: str) -> str:
            return params.get(name, [""])[0].strip()

        query, year = param("q"), param("year")
        animal, region, topic = param("animal"), param("region").lower(), param("topic").lower()
        sort = param("sort") or "relevance"
        limit = parse_limit(param("limit"))

        if query:
            matches = search(query, limit=None)
        else:
            matches = [(0.0, paper) for paper in load_corpus()]

        filtered = [
            (score, paper) for score, paper in matches
            if (not year or paper.get("year") == year)
            and (not animal or animal in (paper.get("animal_groups") or GENERAL).split("; "))
            and matches_filter(paper, "region", region)
            and matches_filter(paper, "topic", topic)
        ]
        if sort == "newest":
            filtered.sort(key=lambda item: item[1].get("year", ""), reverse=True)
        elif sort == "oldest":
            filtered.sort(key=lambda item: item[1].get("year", "") or "9999")
        elif sort == "animal":
            rank = {entry["name"]: index for index, entry in enumerate(animal_counts())}
            filtered.sort(key=lambda item: item[1].get("year", ""), reverse=True)
            filtered.sort(key=lambda item: rank.get(item[1].get("animal_group") or GENERAL, 99))
        # "relevance": search() is already ranked; the empty-query corpus is already newest-first.

        results = [{
            "score": round(score, 2),
            "title": paper.get("title", "Untitled"),
            "abstract": paper.get("abstract", ""),
            "authors": paper.get("authors", ""),
            "journal": paper.get("journal", ""),
            "year": paper.get("year", ""),
            "doi": paper.get("doi", ""),
            "url": paper.get("url", ""),
            "origin": paper.get("origin", ""),
            "animal_group": paper.get("animal_group", ""),
            "animal_groups": paper.get("animal_groups", ""),
            "animals": paper.get("animals", ""),
        } for score, paper in filtered[:limit]]
        self.send_json({"query": query, "total": len(results), "matched": len(filtered), "results": results})

    def handle_stats(self) -> None:
        papers = load_corpus()
        years = sorted({paper["year"] for paper in papers if paper.get("year")}, reverse=True)
        self.send_json({"papers": len(papers), "years": years, "animals": animal_counts()})

    def send_json(self, payload: dict, status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args) -> None:
        print(format % args)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), EcoBriefHandler)
    print(f"EcoBrief is running at http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop the server.")
    server.serve_forever()


if __name__ == "__main__":
    main()
