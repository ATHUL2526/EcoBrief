"use client";

import { type FormEvent, useRef, useState } from "react";
import type { SearchResponse, Stats } from "@/lib/api";
import { paperId } from "@/lib/paper";
import { PaperCard } from "./PaperCard";
import { ReadingList } from "./ReadingList";
import { useSavedPapers } from "./useSavedPapers";

const SORTS = [
  ["relevance", "Relevance"], ["newest", "Newest first"], ["oldest", "Oldest first"], ["animal", "By animal group"],
] as const;
const NO_FILTERS = { year: "", animal: "", region: "", topic: "", sort: "relevance" };
type Filters = typeof NO_FILTERS;

const label = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

interface Props {
  stats: Stats;
  /** Results of the empty search, rendered on the server. */
  initialResults: SearchResponse;
  regions: string[];
  topics: string[];
}

export function Dashboard({ stats, initialResults, regions, topics }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [data, setData] = useState(initialResults);
  const [status, setStatus] = useState(""); // replaces the result count while searching or after an error
  const [showSaved, setShowSaved] = useState(false);
  const saved = useSavedPapers();
  const pending = useRef<AbortController | null>(null);

  async function runSearch(nextFilters: Filters, nextQuery = query) {
    pending.current?.abort(); // a newer search replaces one still in flight
    const controller = new AbortController();
    pending.current = controller;
    setStatus("Searching…");
    const params = new URLSearchParams({ q: nextQuery.trim(), ...nextFilters, limit: "20" });
    try {
      const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Search request failed");
      setData(body);
      setStatus("");
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "";
      setStatus(`Search could not load${message ? ` (${message})` : ""}.`);
    }
  }

  function applyFilters(change: Partial<Filters>) {
    const next = { ...filters, ...change };
    setFilters(next);
    void runSearch(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(filters);
  }

  function clearSearch() {
    setQuery("");
    setFilters(NO_FILTERS);
    void runSearch(NO_FILTERS, "");
  }

  const searchActive = Boolean(data.query || filters.year || filters.animal || filters.region || filters.topic)
    || filters.sort !== "relevance";
  const resultCount = status
    || (data.query ? `${plural(data.total, "top result")} for “${data.query}”` : `Showing ${plural(data.total, "paper")}`);

  return (
    <>
      <section className="search-panel" aria-label="Search research papers">
        <form id="search-form" onSubmit={submit}>
          <label htmlFor="query">What are you researching?</label>
          <div className="query-row">
            <input
              id="query" name="query" type="search" placeholder="Try: elephant habitat fragmentation" autoComplete="off"
              value={query} onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit">Search papers</button>
          </div>
          <div className="filter-row">
            <label htmlFor="year">Publication year</label>
            <select id="year" name="year" value={filters.year} onChange={(event) => applyFilters({ year: event.target.value })}>
              <option value="">All years</option>
              {stats.years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
          <div className="filter-grid">
            <label htmlFor="animal">Animal
              <select id="animal" value={filters.animal} onChange={(event) => applyFilters({ animal: event.target.value })}>
                <option value="">Any animal</option>
                {stats.animals.map(({ name, count }) => <option key={name} value={name}>{`${name} (${count})`}</option>)}
              </select>
            </label>
            <label htmlFor="region">Region
              <select id="region" value={filters.region} onChange={(event) => applyFilters({ region: event.target.value })}>
                <option value="">Any region</option>
                {regions.map((region) => <option key={region} value={region}>{label(region)}</option>)}
              </select>
            </label>
            <label htmlFor="sort">Sort results
              <select id="sort" value={filters.sort} onChange={(event) => applyFilters({ sort: event.target.value })}>
                {SORTS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
          </div>
          <div className="topics" role="group" aria-label="Research topic filters">
            {["", ...topics].map((topic) => (
              <button
                key={topic} type="button" className={filters.topic === topic ? "topic active" : "topic"}
                aria-pressed={filters.topic === topic} onClick={() => applyFilters({ topic })}
              >
                {topic ? label(topic) : "All topics"}
              </button>
            ))}
          </div>
        </form>
      </section>

      <section className="results-section" aria-live="polite">
        <div className="results-heading">
          <p id="result-count">{resultCount}</p>
          <div>
            <button
              id="saved-papers" className="text-button" type="button" aria-expanded={showSaved}
              onClick={() => setShowSaved(!showSaved)}
            >
              Saved (<span>{saved.papers.length}</span>)
            </button>
            {searchActive && (
              <button id="clear-search" className="text-button" type="button" onClick={clearSearch}>Clear search</button>
            )}
          </div>
        </div>
        {showSaved && <ReadingList papers={saved.papers} />}
        <div id="results" className="results">
          {data.results.length ? data.results.map((paper) => (
            <PaperCard key={paperId(paper)} paper={paper} saved={saved.isSaved(paper)} onToggleSave={() => saved.toggle(paper)} />
          )) : <p className="empty">No papers matched. Try fewer or broader terms.</p>}
        </div>
      </section>
    </>
  );
}
