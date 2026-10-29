import { paperId } from "@/lib/paper";
import { type SavedPaper, readingListCsv } from "@/lib/reading-list";

function exportCsv(papers: readonly SavedPaper[]) {
  const url = URL.createObjectURL(new Blob([readingListCsv(papers)], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: "ecobrief-reading-list.csv" }).click();
  URL.revokeObjectURL(url);
}

export function ReadingList({ papers }: { papers: readonly SavedPaper[] }) {
  return (
    <aside id="reading-list" className="reading-list">
      <div>
        <strong>Reading list</strong>
        <button id="export-saved" className="text-button" type="button" onClick={() => exportCsv(papers)}>Export CSV</button>
      </div>
      <div id="saved-list">
        {papers.length
          ? papers.map((paper) => <p key={paperId(paper)}>{`${paper.year || "Undated"} — ${paper.title}`}</p>)
          : "No papers saved yet."}
      </div>
    </aside>
  );
}
