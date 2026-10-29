// The paper fields served by the API, and display helpers shared by the server and the browser UI.

export const GENERAL = "General / no specific animal";

export const PAPER_FIELDS = [
  "title", "abstract", "authors", "journal", "year", "doi", "url", "origin",
  "animal_group", "animal_groups", "animals",
] as const;
export type Paper = Record<(typeof PAPER_FIELDS)[number], string>;

export function plainText(text: string): string {
  return (text || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** A paper's identity: its DOI, or title and year when it has none. */
export function paperId(paper: Pick<Paper, "doi" | "title" | "year">): string {
  return paper.doi || `${paper.title}|${paper.year}`;
}

export function paperUrl(paper: Pick<Paper, "url" | "doi">): string {
  if (paper.url) return paper.url;
  return paper.doi ? `https://doi.org/${paper.doi}` : "";
}

/** Every animal group the paper covers (the general group when it has none). */
export function animalGroups(paper: Pick<Paper, "animal_groups">): string[] {
  return (paper.animal_groups || GENERAL).split("; ");
}

/** The abstract's first sentence, shortened to fit a card. */
export function takeaway(paper: Pick<Paper, "abstract">): string {
  const firstSentence = plainText(paper.abstract).split(/(?<=[.!?])\s/)[0]
    || "This paper contributes evidence relevant to wildlife conservation.";
  return firstSentence.length > 290 ? `${firstSentence.slice(0, 287)}…` : firstSentence;
}
