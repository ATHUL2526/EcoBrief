"""Offline tests: parsers use sample payloads shaped like each API's documented response."""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import fetch_papers as fp  # noqa: E402
import preprocess as pp  # noqa: E402
from animals import GENERAL, classify  # noqa: E402
from search import matches_filter  # noqa: E402

ABSTRACT = "Camera traps reveal how elephants use corridors between protected areas across the landscape. " * 2


class ParserTests(unittest.TestCase):
    def test_europepmc_journal_and_missing_url_list(self):
        record = {"id": "1", "source": "MED", "doi": "10.1/X", "title": "T", "abstractText": f"<h4>Abstract</h4>{ABSTRACT}",
                  "journalInfo": {"journal": {"title": "Biol Conserv"}}, "pubYear": "2024", "fullTextUrlList": {"fullTextUrl": []}}
        paper = fp.europepmc_normalise(record)
        self.assertEqual(paper["journal"], "Biol Conserv")
        self.assertEqual(paper["doi"], "10.1/x")
        self.assertEqual(paper["url"], "")
        self.assertTrue(paper["abstract"].startswith("Camera traps"))

    def test_openalex_inverted_index_and_authors(self):
        work = {"id": "https://openalex.org/W42", "doi": "https://doi.org/10.2/Y", "title": "Tigers",
                "abstract_inverted_index": {"Tigers": [0], "roam": [1], "widely": [2, 4], "and": [3]},
                "authorships": [{"author": {"display_name": "A B"}}, {"author": {"display_name": "C D"}}],
                "primary_location": {"landing_page_url": "https://x.org/p", "source": {"display_name": "PeerJ"}},
                "publication_year": 2023, "publication_date": "2023-05-01"}
        paper = fp.openalex_normalise(work)
        self.assertEqual(paper["abstract"], "Tigers roam widely and widely")
        self.assertEqual((paper["id"], paper["doi"], paper["journal"], paper["authors"]), ("W42", "10.2/y", "PeerJ", "A B, C D"))

    def test_openalex_without_abstract_or_location(self):
        paper = fp.openalex_normalise({"id": "https://openalex.org/W1", "title": "x", "abstract_inverted_index": None, "primary_location": None})
        self.assertEqual((paper["abstract"], paper["journal"]), ("", ""))

    def test_crossref_jats_abstract(self):
        item = {"DOI": "10.3/Z", "title": ["Lions"], "abstract": "<jats:p>Abstract Lions &amp; prey.</jats:p>",
                "author": [{"given": "Ann", "family": "Lee"}, {"name": "Consortium"}], "container-title": ["Oryx"],
                "issued": {"date-parts": [[2022, 3, 9]]}, "URL": "http://dx.doi.org/10.3/Z"}
        paper = fp.crossref_normalise(item)
        self.assertEqual(paper["abstract"], "Lions & prey.")
        self.assertEqual((paper["year"], paper["publication_date"], paper["authors"], paper["journal"]), ("2022", "2022-03-09", "Ann Lee, Consortium", "Oryx"))

    def test_arxiv_atom(self):
        xml = b"""<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
        <entry><id>http://arxiv.org/abs/2501.00001v1</id><published>2025-01-02T00:00:00Z</published>
        <title>Wildlife
          detection</title><summary> Detecting animals in drone imagery. </summary>
        <author><name>Z Q</name></author><arxiv:doi>10.4/ABC</arxiv:doi></entry></feed>"""
        paper = fp.arxiv_parse(xml)[0]
        self.assertEqual((paper["title"], paper["id"], paper["year"], paper["doi"]), ("Wildlife detection", "2501.00001v1", "2025", "10.4/abc"))

    def test_cursor_pagination_stops_and_limits(self):
        pages = [{"results": [{"id": f"https://openalex.org/W{i}", "title": "t"} for i in range(3)], "meta": {"next_cursor": "c2"}},
                 {"results": [{"id": "https://openalex.org/W9", "title": "t"}], "meta": {"next_cursor": None}}]
        with mock.patch.object(fp, "get_json", side_effect=pages), mock.patch.object(fp.time, "sleep"):
            self.assertEqual(len(fp.fetch_openalex("x", 100, 2020)), 4)
        with mock.patch.object(fp, "get_json", side_effect=pages), mock.patch.object(fp.time, "sleep"):
            self.assertEqual(len(fp.fetch_openalex("x", 2, 2020)), 2)

    def test_failed_term_does_not_abort_source(self):
        good = [fp.row(id="1", source="OA", title="t", doi="10.1/a")]
        with mock.patch.dict(fp.SOURCES, {"openalex": mock.Mock(side_effect=[RuntimeError("429"), good])}):
            self.assertEqual(len(fp.collect("openalex", ["a", "b"], 10, 2020)), 1)


class PreprocessTests(unittest.TestCase):
    def rows(self):
        base = {"abstract": ABSTRACT, "year": "2024", "url": "", "journal": "", "origin": "A"}
        return [
            {**base, "title": "Elephant corridors", "doi": "10.1/a", "origin": "arXiv"},
            {**base, "title": "Elephant Corridors.", "doi": "https://doi.org/10.1/A", "journal": "Oryx", "origin": "Crossref"},
            {**base, "title": "Energy conservation in buildings", "abstract": "Energy conservation reduces power use in buildings. " * 3},
            {**base, "title": "Future paper on wildlife", "year": "2999"},
            {**base, "title": "Short", "abstract": "too short"},
            {**base, "title": "Habitat &lt;i&gt;loss&lt;/i&gt; in tigers", "doi": ""},
        ]

    def test_merge_dedupe_filters(self):
        corpus, dropped = pp.build_corpus(self.rows())
        titles = [r["title"] for r in corpus]
        self.assertEqual(len(corpus), 2, titles)
        kept = next(r for r in corpus if r["doi"] == "10.1/a")
        self.assertEqual((kept["journal"], kept["origin"]), ("Oryx", "Crossref"))  # richest copy wins
        self.assertIn("Habitat loss in tigers", titles)  # entities/tags decoded
        self.assertEqual(dropped, {"incomplete": 1, "bad_year": 1, "off_topic": 1, "duplicate": 1})
        self.assertEqual(kept["url"], "https://doi.org/10.1/a")


class FilterTests(unittest.TestCase):
    def test_whole_word_region(self):
        self.assertFalse(matches_filter({"title": "Indiana bats", "abstract": "We indicate trends"}, "region", "india"))
        self.assertTrue(matches_filter({"title": "Indian tigers", "abstract": ""}, "region", "india"))


class AnimalTests(unittest.TestCase):
    def test_primary_animal_beats_livestock_context(self):
        result = classify("Livestock depredation by snow leopards", "Snow leopards kill livestock such as sheep and goats in villages. " * 2)
        self.assertEqual(result["animal_group"], "Big cats & wild cats")
        self.assertIn("snow leopard", result["animals"])
        self.assertNotIn("; leopard", "; " + result["animals"])

    def test_multi_animal_and_general(self):
        both = classify("Tortoises and birds at a wildlife centre", "We sampled tortoises and birds for bacteria.")
        self.assertEqual(set(both["animal_groups"].split("; ")), {"Birds", "Reptiles"})
        plain = classify("Wildlife policy in protected areas", "Governance of reserves and community attitudes.")
        self.assertEqual((plain["animal_group"], plain["animals"]), (GENERAL, ""))

    def test_no_substring_matches(self):
        self.assertEqual(classify("Combat strategies", "A combatant battled the acrobat.")["animal_group"], GENERAL)


if __name__ == "__main__":
    unittest.main()
