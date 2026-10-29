import type { SearchResult } from "@/lib/api";
import { GENERAL, animalGroups, paperUrl, plainText, takeaway } from "@/lib/paper";

interface Props {
  paper: SearchResult;
  saved: boolean;
  onToggleSave: () => void;
}

export function PaperCard({ paper, saved, onToggleSave }: Props) {
  const meta = [paper.year, paper.journal, paper.origin].filter(Boolean).join(" · ") || "Publication details unavailable";
  const tags = [
    ...(paper.animals ? paper.animals.split("; ") : []),
    ...animalGroups(paper).filter((group) => group !== GENERAL),
  ].slice(0, 6);
  const url = paperUrl(paper);
  return (
    <article className="paper-card">
      <div className="paper-meta">{meta}</div>
      <h2>{paper.title}</h2>
      {tags.length > 0 && (
        <div className="animal-tags">
          {tags.map((tag, index) => <span key={`${index}:${tag}`}>{tag}</span>)}
        </div>
      )}
      <p className="authors">{paper.authors || "Authors unavailable"}</p>
      <div className="takeaway">
        <strong>Abstract opening</strong>
        <p>{takeaway(paper)}</p>
      </div>
      <p className="abstract">{plainText(paper.abstract)}</p>
      <div className="card-actions">
        {url && (
          <a className="paper-link" href={url} target="_blank" rel="noreferrer">
            Read publication <span aria-hidden="true">↗</span>
          </a>
        )}
        <button className="save-paper" type="button" onClick={onToggleSave}>{saved ? "Saved ✓" : "Save paper"}</button>
      </div>
      <p className="related">{paper.related.length ? `Related: ${paper.related.join(" · ")}` : ""}</p>
    </article>
  );
}
