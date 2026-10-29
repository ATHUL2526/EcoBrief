# EcoBrief

EcoBrief is a local wildlife-research search dashboard built from Europe PMC records.
It needs Python 3.9+ and nothing else (standard library only).

## Start the dashboard

In VS Code, open a terminal in this folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\run_dashboard.ps1
```

On macOS/Linux: `python3 src/app.py 8765`

When it says `EcoBrief is running`, open http://127.0.0.1:8765 and press `Ctrl+C` to stop.

You can also open `web/index.html` directly (`file://`); search then runs in the browser
against `web/corpus.js`, with the same filters.

## Add more papers (multiple sources)

EcoBrief pulls from four open scholarly sources, so results don't depend on any one site:
**Europe PMC**, **OpenAlex**, **Crossref** and **arXiv**. Each is saved to its own file in `data/raw/`.

```powershell
$env:ECOBRIEF_EMAIL = "you@example.com"      # recommended: polite/faster API access
# $env:OPENALEX_API_KEY = "..."              # only if OpenAlex asks for a (free) key
python src/fetch_papers.py                   # all sources, 16 search terms, 100 records per term
python src/fetch_papers.py --sources openalex arxiv --per-term 200 --from-year 2015
python src/preprocess.py                     # merge, drop off-topic/duplicates, rebuild the corpus
```

`preprocess.py` merges every CSV in `data/raw/`, keeps the richest copy of papers found in several
sources (matched by DOI or title), drops off-topic, future-dated and abstract-less records, and
rewrites `data/processed/` and `web/corpus.js`. Each card shows which source it came from.
`data/raw/europepmc_initial.csv` is the original download (journal names missing); re-fetching Europe PMC
replaces it with complete records, and duplicates are removed automatically.

Run the offline tests with `python -m unittest discover -s tests`.

## Papers by animal

`src/animals.py` tags every paper with the animals it studies: a main **animal group** (Big cats, Elephants,
Primates, Birds, Reptiles, Insects, ... or "General / no specific animal"), any other groups it covers, and the
specific animals named (leopard, tiger, ...). Preprocessing writes the results to:

- `data/processed/papers_by_animal.md` - readable index grouped by animal, with links
- `data/processed/papers_by_animal.csv` - the same, for spreadsheets

In the dashboard use the **Animal** filter (counts shown) and the **By animal group** sort. Edit the `TAXA`
table in `src/animals.py` to add animals or groups, then re-run `python src/preprocess.py`.

## Filters

Region and topic filters use whole-word matching on title + abstract. The term lists live in
`src/search.py` and are mirrored in `web/app.js`; edit both together.
