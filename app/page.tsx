import { Dashboard } from "@/components/Dashboard";
import { getSearchEngine } from "@/lib/corpus";
import { REGION_TERMS, TOPIC_TERMS } from "@/lib/search";

// Render on every request: the corpus is read from disk and reloaded when preprocessing rewrites it.
export const dynamic = "force-dynamic";

function loadCorpus() {
  try {
    const engine = getSearchEngine();
    return { stats: engine.stats(), initialResults: engine.search() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export default function Home() {
  const corpus = loadCorpus();
  return (
    <main>
      <header>
        <p className="eyebrow">EVIDENCE FOR CONSERVATION</p>
        <h1>EcoBrief</h1>
        <p className="intro">Search a curated local corpus of wildlife conservation research from Europe PMC.</p>
      </header>
      {"error" in corpus ? (
        <p className="empty">The research corpus could not be loaded: {corpus.error}</p>
      ) : (
        <Dashboard
          stats={corpus.stats}
          initialResults={corpus.initialResults}
          regions={Object.keys(REGION_TERMS)}
          topics={Object.keys(TOPIC_TERMS)}
        />
      )}
    </main>
  );
}
