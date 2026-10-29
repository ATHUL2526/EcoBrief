# EcoBrief

EcoBrief is a local wildlife-research search dashboard built from open scholarly records
(Europe PMC, OpenAlex, Crossref and arXiv). It is a single Next.js app: the dashboard and its JSON API
run in one Node.js process and search the corpus in `data/processed/`. There is no database, Python
or other service to install.

## Start the dashboard

You need Node.js 22.18 or newer. In a terminal in this folder:

```bash
npm install
npm run dev
```

Open http://localhost:3000 and press `Ctrl+C` to stop. For a production server, run `npm run build`
once and then `npm start`.

Next.js sends anonymous usage telemetry by default; `npx next telemetry disable` turns it off.

## API

The dashboard is built on two endpoints, which you can also call directly:

- `GET /api/search` takes `q` (search words), `year`, `animal` (an animal group name), `region`
  (`africa`, `asia`, `india`, `amazon`, `europe`), `topic` (`conflict`, `monitoring`, `habitat`,
  `movement`, `conservation`), `sort` (`relevance`, `newest`, `oldest`, `animal`) and `limit`
  (1-50, default 20). It returns `{ query, total, matched, results }`; each result has the paper's
  fields, its TF-IDF `score` and up to two `related` paper titles.
- `GET /api/stats` returns `{ papers, years, animals }`: the corpus size, publication years and
  animal groups with paper counts.

Example: http://localhost:3000/api/search?q=elephant%20corridors&region=africa&limit=5

## Add more papers (multiple sources)

EcoBrief pulls from four open scholarly sources, so results don't depend on any one site:
**Europe PMC**, **OpenAlex**, **Crossref** and **arXiv**. Each is saved to its own file in `data/raw/`.

```bash
npm run fetch-papers                     # all sources, 16 search terms, 100 records per term
npm run fetch-papers -- --sources openalex arxiv --per-term 200 --from-year 2015
npm run preprocess                       # merge, drop off-topic/duplicates, rebuild the corpus
```

Set `ECOBRIEF_EMAIL` to your address for polite (faster) API access, and `OPENALEX_API_KEY` only if
OpenAlex asks for a (free) key. `npm run fetch-papers -- --help` lists every option.

`npm run preprocess` merges every CSV in `data/raw/`, keeps the richest copy of papers found in several
sources (matched by DOI or title), drops off-topic, future-dated and abstract-less records, and rewrites
`data/processed/`. A running server picks up the new corpus on its next request. Each card shows which
source a paper came from. `data/raw/europepmc_initial.csv` is the original download (journal names
missing); re-fetching Europe PMC adds complete records, and duplicates are removed automatically.

Run the offline tests with `npm test`, and check types with `npm run typecheck`.

## Papers by animal

`lib/animals.ts` tags every paper with the animals it studies: a main **animal group** (Big cats, Elephants,
Primates, Birds, Reptiles, Insects, ... or "General / no specific animal"), any other groups it covers, and the
specific animals named (leopard, tiger, ...). Preprocessing writes the results to:

- `data/processed/papers_by_animal.md` - readable index grouped by animal, with links
- `data/processed/papers_by_animal.csv` - the same, for spreadsheets

In the dashboard use the **Animal** filter (counts shown) and the **By animal group** sort. Edit the `TAXA`
table in `lib/animals.ts` to add animals or groups, then re-run `npm run preprocess`.

## Filters

Region and topic filters use whole-word matching on title + abstract. The term lists are `REGION_TERMS`
and `TOPIC_TERMS` in `lib/search.ts`; the dashboard offers whichever regions and topics they define.

## Project layout

- `app/` - the Next.js page and the API route handlers (`api/search`, `api/stats`)
- `components/` - the dashboard UI (React)
- `lib/` - the backend: search engine, corpus loading, animal classifier and data pipeline. It is plain
  TypeScript with no Next.js or React code, and also runs directly under Node (so its imports end in `.ts`)
- `scripts/` - the `fetch-papers` and `preprocess` commands
- `tests/` - `node:test` suites
- `data/raw/`, `data/processed/` - downloaded records and the cleaned corpus the app searches
