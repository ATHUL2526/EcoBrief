// Text helpers shared by the data pipeline and the search engine.
//
// Modules in lib/ import each other with explicit .ts extensions so they also run directly under
// Node (scripts/ and tests/), not only inside Next.js.

// Whole words are matched with lookarounds instead of `\b`: JavaScript's `\b` only treats ASCII
// letters as word characters, so "antílope" would match "ant" and "ratón" would match "rat".
const WORD_CHAR = "[\\p{L}\\p{N}_]";

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `body` (regex source) matched as whole words only; pass flags "gu" to count or iterate matches. */
export function wholeWord(body: string, flags = "u"): RegExp {
  return new RegExp(`(?<!${WORD_CHAR})(?:${body})(?!${WORD_CHAR})`, flags);
}

/** Any of `terms`, literally and as whole words, so "india" does not match "Indiana" or "indicate". */
export function anyTerm(terms: readonly string[], flags = "u"): RegExp {
  return wholeWord(terms.map(escapeRegex).join("|"), flags);
}

/** Plain code-unit string order (the same everywhere, unlike localeCompare). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normaliseDoi(doi: string | null | undefined): string {
  return (doi ?? "").trim().toLowerCase().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)/, "");
}
