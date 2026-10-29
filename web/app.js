const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const yearInput = document.querySelector("#year");
const animalInput = document.querySelector("#animal");
const regionInput = document.querySelector("#region");
const sortInput = document.querySelector("#sort");
const resultsElement = document.querySelector("#results");
const countElement = document.querySelector("#result-count");
const clearButton = document.querySelector("#clear-search");
const template = document.querySelector("#result-template");
const topicButtons = [...document.querySelectorAll(".topic")];
const savedButton = document.querySelector("#saved-papers");
const savedCount = savedButton.querySelector("span");
const readingList = document.querySelector("#reading-list");
const savedList = document.querySelector("#saved-list");
const exportSaved = document.querySelector("#export-saved");
let selectedTopic = "";
let saved = JSON.parse(localStorage.getItem("ecobrief-saved") || "[]");

const TOPIC_TERMS = {
  conflict: ["human-wildlife conflict", "conflict", "crop raiding", "fence", "coexistence"],
  monitoring: ["monitoring", "camera trap", "camera-trap", "survey", "detection", "uav"],
  habitat: ["habitat", "fragmentation", "connectivity", "landscape", "corridor"],
  movement: ["movement", "migration", "space use", "tracking", "dispersal"],
  conservation: ["conservation", "biodiversity", "protected area", "management", "endangered"],
};

// Keep these in sync with the term lists in src/search.py (used when the page is opened as file://).
const REGION_TERMS = { africa: ["africa", "african"], asia: ["asia", "asian"], india: ["india", "indian"], amazon: ["amazon", "amazonia", "amazonian"], europe: ["europe", "european"] };
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRegex = (terms) => new RegExp("\\b(?:" + terms.map(escapeRegex).join("|") + ")\\b");
const FILTER_REGEX = {
  region: Object.fromEntries(Object.entries(REGION_TERMS).map(([key, terms]) => [key, wordRegex(terms)])),
};
const TOPIC_REGEX = Object.fromEntries(Object.entries(TOPIC_TERMS).map(([key, terms]) => [key, wordRegex(terms)]));

function paperUrl(paper) {
  if (paper.url) return paper.url;
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  return "";
}

function plainText(text) { return (text || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(); }
function paperId(paper) { return paper.doi || `${paper.title}|${paper.year}`; }
function tokens(text) { return new Set((plainText(text).toLowerCase().match(/[a-z]{4,}/g) || []).filter((word) => !["this", "that", "with", "from", "their", "were", "which", "study", "wildlife"].includes(word))); }
const GENERAL_ANIMAL = "General / no specific animal";
let animalOrder = [];
function paperGroups(paper) { return (paper.animal_groups || GENERAL_ANIMAL).split("; "); }
function matchesAnimal(paper) { return !animalInput.value || paperGroups(paper).includes(animalInput.value); }
function populateAnimals(groups) {
  animalOrder = groups.map((group) => group.name);
  for (const group of groups) animalInput.add(new Option(`${group.name} (${group.count})`, group.name));
}
function matchesFilter(paper, kind, value) { return !value || FILTER_REGEX[kind][value].test(`${paper.title} ${paper.abstract}`.toLowerCase()); }
function takeaway(paper) {
  const firstSentence = plainText(paper.abstract).split(/(?<=[.!?])\s/)[0] || "This paper contributes evidence relevant to wildlife conservation.";
  return firstSentence.length > 290 ? `${firstSentence.slice(0, 287)}…` : firstSentence;
}
const tokenCache = new Map();
function cachedTokens(paper) {
  const id = paperId(paper);
  if (!tokenCache.has(id)) tokenCache.set(id, tokens(`${paper.title} ${paper.abstract}`));
  return tokenCache.get(id);
}
function relatedTitles(paper) {
  const terms = cachedTokens(paper);
  const id = paperId(paper);
  return (window.ECOBRIEF_PAPERS || []).filter((candidate) => paperId(candidate) !== id).map((candidate) => { const other = cachedTokens(candidate); return { candidate, shared: [...terms].filter((term) => other.has(term)).length }; }).filter((result) => result.shared >= 3).sort((a, b) => b.shared - a.shared).slice(0, 2).map((result) => result.candidate.title);
}
function savePaper(paper) {
  const id = paperId(paper);
  saved = saved.some((item) => paperId(item) === id) ? saved.filter((item) => paperId(item) !== id) : [...saved, paper];
  localStorage.setItem("ecobrief-saved", JSON.stringify(saved));
  updateSavedList();
  runSearch();
}
function updateSavedList() {
  savedCount.textContent = saved.length;
  savedList.replaceChildren();
  if (!saved.length) { savedList.textContent = "No papers saved yet."; return; }
  saved.forEach((paper) => { const item = document.createElement("p"); item.textContent = `${paper.year || "Undated"} — ${paper.title}`; savedList.append(item); });
}

function renderResults(data) {
  resultsElement.replaceChildren();
  countElement.textContent = data.query
    ? `${data.total} top result${data.total === 1 ? "" : "s"} for “${data.query}”`
    : `Showing ${data.total} paper${data.total === 1 ? "" : "s"}`;
  clearButton.hidden = !data.query && !yearInput.value && !animalInput.value && !regionInput.value && !selectedTopic && sortInput.value === "relevance";

  if (!data.results.length) {
    resultsElement.innerHTML = "<p class=\"empty\">No papers matched. Try fewer or broader terms.</p>";
    return;
  }
  for (const paper of data.results) {
    const card = template.content.cloneNode(true);
    card.querySelector(".paper-meta").textContent = [paper.year, paper.journal, paper.origin].filter(Boolean).join(" · ") || "Publication details unavailable";
    card.querySelector("h2").textContent = paper.title;
    const tags = card.querySelector(".animal-tags");
    for (const name of [...(paper.animals ? paper.animals.split("; ") : []), ...paperGroups(paper).filter((group) => group !== GENERAL_ANIMAL)].slice(0, 6)) {
      const tag = document.createElement("span"); tag.textContent = name; tags.append(tag);
    }
    if (!tags.children.length) tags.remove();
    card.querySelector(".authors").textContent = paper.authors || "Authors unavailable";
    card.querySelector(".takeaway p").textContent = takeaway(paper);
    card.querySelector(".abstract").textContent = plainText(paper.abstract);
    const link = card.querySelector(".paper-link");
    const url = paperUrl(paper);
    if (url) link.href = url;
    else link.remove();
    const save = card.querySelector(".save-paper");
    save.textContent = saved.some((item) => paperId(item) === paperId(paper)) ? "Saved ✓" : "Save paper";
    save.addEventListener("click", () => savePaper(paper));
    const related = relatedTitles(paper);
    card.querySelector(".related").textContent = related.length ? `Related: ${related.join(" · ")}` : "";
    resultsElement.append(card);
  }
}

function localSearch() {
  const query = queryInput.value.trim();
  const terms = query.toLowerCase().match(/[a-z]{2,}/g) || [];
  const phrase = query.toLowerCase();
  const papers = (window.ECOBRIEF_PAPERS || [])
    .filter((paper) => !yearInput.value || paper.year === yearInput.value)
    .filter((paper) => matchesAnimal(paper) && matchesFilter(paper, "region", regionInput.value))
    .map((paper) => {
      const title = paper.title.toLowerCase();
      const abstract = paper.abstract.toLowerCase();
      const content = `${title} ${abstract}`;
      const titleScore = terms.reduce((total, term) => total + 6 * (title.split(term).length - 1), 0);
      const abstractScore = terms.reduce((total, term) => total + (abstract.split(term).length - 1), 0);
      const phraseScore = phrase.length > 2 && content.includes(phrase) ? 18 : 0;
      const topicScore = !selectedTopic || TOPIC_REGEX[selectedTopic].test(content) ? 0 : -1000;
      const score = titleScore + abstractScore + phraseScore + topicScore;
      return { ...paper, score };
    })
    .filter((paper) => (!terms.length || paper.score > 0) && paper.score > -1000)
    .sort((first, second) => sortInput.value === "animal" ? (animalOrder.indexOf(first.animal_group) - animalOrder.indexOf(second.animal_group)) || String(second.year).localeCompare(String(first.year)) : sortInput.value === "newest" ? String(second.year).localeCompare(String(first.year)) : sortInput.value === "oldest" ? String(first.year).localeCompare(String(second.year)) : second.score - first.score || String(second.year).localeCompare(String(first.year)))
    .slice(0, 20);
  return { query, total: papers.length, results: papers };
}

async function runSearch() {
  const params = new URLSearchParams({ q: queryInput.value.trim(), year: yearInput.value, animal: animalInput.value, region: regionInput.value, topic: selectedTopic, sort: sortInput.value, limit: "20" });
  countElement.textContent = "Searching…";
  if (location.protocol === "file:") {
    renderResults(localSearch());
    return;
  }
  try {
    const response = await fetch(`/api/search?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search request failed");
    renderResults(data);
  } catch (error) {
    countElement.textContent = `Search could not load${error.message ? ` (${error.message})` : ""}.`;
  }
}

async function initialise() {
  if (location.protocol === "file:") {
    const papers = window.ECOBRIEF_PAPERS || [];
    const years = [...new Set(papers.map((paper) => paper.year).filter(Boolean))].sort().reverse();
    const counts = {};
    for (const paper of papers) for (const group of paperGroups(paper)) counts[group] = (counts[group] || 0) + 1;
    populateAnimals(Object.keys(counts).sort((a, b) => (a === GENERAL_ANIMAL) - (b === GENERAL_ANIMAL) || counts[b] - counts[a]).map((name) => ({ name, count: counts[name] })));
    for (const year of years) yearInput.add(new Option(year, year));
    runSearch();
    return;
  }
  const stats = await (await fetch("/api/stats")).json();
  for (const year of stats.years) yearInput.add(new Option(year, year));
  populateAnimals(stats.animals || []);
  await runSearch();
}

form.addEventListener("submit", (event) => { event.preventDefault(); runSearch(); });
yearInput.addEventListener("change", runSearch);
[animalInput, regionInput, sortInput].forEach((input) => input.addEventListener("change", runSearch));
clearButton.addEventListener("click", () => { queryInput.value = ""; yearInput.value = ""; animalInput.value = ""; regionInput.value = ""; sortInput.value = "relevance"; selectedTopic = ""; topicButtons.forEach((item) => item.classList.toggle("active", !item.dataset.topic)); runSearch(); });
topicButtons.forEach((button) => button.addEventListener("click", () => {
  selectedTopic = button.dataset.topic;
  topicButtons.forEach((item) => item.classList.toggle("active", item === button));
  runSearch();
}));
savedButton.addEventListener("click", () => { readingList.hidden = !readingList.hidden; });
exportSaved.addEventListener("click", () => {
  const headers = ["title", "year", "authors", "journal", "doi", "url"];
  const escape = (value) => `"${String(value || "").replaceAll('"', '""')}"`;
  const csv = [headers.join(","), ...saved.map((paper) => headers.map((header) => escape(paper[header])).join(","))].join("\n");
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "ecobrief-reading-list.csv" });
  link.click(); URL.revokeObjectURL(link.href);
});
updateSavedList();
initialise();
