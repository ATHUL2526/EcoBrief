// Classify papers by the animals they study (keyword taxonomy, whole-word matching).
//
// Each paper gets:
//   animal_group   the single best-matching group, e.g. "Big cats & wild cats"
//   animal_groups  every group it substantially covers, separated by "; "
//   animals        specific animals mentioned, e.g. "leopard; tiger"
import { GENERAL } from "./paper.ts";
import { escapeRegex, wholeWord } from "./text.ts";

// group -> {animal: [terms]}.  Terms are matched as whole words (plural 's' optional).
export const TAXA: Record<string, Record<string, string[]>> = {
  "Big cats & wild cats": {
    "leopard": ["leopard", "panthera pardus"], "snow leopard": ["snow leopard", "panthera uncia"],
    "tiger": ["tiger", "panthera tigris"], "lion": ["lion", "panthera leo"], "cheetah": ["cheetah"],
    "jaguar": ["jaguar"], "puma": ["puma", "cougar", "mountain lion"],
    "lynx & small wild cats": ["lynx", "wildcat", "ocelot", "fishing cat", "leopard cat", "clouded leopard", "caracal", "serval"],
  },
  "Elephants": { "elephant": ["elephant", "elephas", "loxodonta"] },
  "Primates": {
    "apes": ["gorilla", "chimpanzee", "bonobo", "orangutan", "gibbon", "great ape", "ape"],
    "monkeys": ["monkey", "macaque", "langur", "baboon", "colobus", "capuchin", "trachypithecus", "rhesus", "howler"],
    "lemurs & lorises": ["lemur", "aye-aye", "loris", "potto", "galago", "tarsier"], "primates (general)": ["primate"],
  },
  "Other carnivores": {
    "wolf": ["wolf", "wolves", "canis lupus"], "bear": ["bear", "ursus", "giant panda", "red panda"],
    "fox": ["fox", "foxes"], "hyena": ["hyena", "hyaena"],
    "dhole & jackal & coyote": ["dhole", "jackal", "coyote"],
    "otter & mustelids": ["otter", "badger", "marten", "wolverine", "weasel", "mink", "polecat"],
    "civet & mongoose": ["civet", "mongoose", "genet"], "carnivores (general)": ["carnivore"],
  },
  "Deer, antelope & other hoofed animals": {
    "deer": ["deer", "sika", "muntjac", "elk", "moose", "reindeer", "caribou", "sambar", "chital"],
    "antelope & gazelle": ["antelope", "gazelle", "impala", "wildebeest", "oryx", "kudu", "saiga", "bongo", "tragelaphus", "eland", "nyala"],
    "bison & buffalo": ["bison", "buffalo", "gaur", "yak"],
    "wild boar": ["wild boar", "wild pig", "feral pig", "sus scrofa"],
    "wild goat & sheep": ["ibex", "goral", "serow", "takin", "bharal", "argali", "markhor", "chamois"],
    "zebra & giraffe": ["zebra", "giraffe", "okapi"], "tapir": ["tapir"], "ungulates (general)": ["ungulate"],
  },
  "Rhinos & hippos": { "rhino": ["rhino", "rhinoceros"], "hippo": ["hippo", "hippopotamus"] },
  "Birds": {
    "birds (general)": ["bird", "avian", "avifauna", "ornithological"],
    "raptors & owls": ["eagle", "vulture", "owl", "falcon", "hawk", "raptor", "kite", "buzzard"],
    "waterbirds & seabirds": ["seabird", "shorebird", "waterbird", "waterfowl", "duck", "goose", "heron", "crane", "stork", "penguin", "albatross"],
    "songbirds & others": ["peafowl", "peacock", "grouse", "shrike", "quail", "partridge", "bulbul", "passerine", "songbird", "warbler", "sparrow", "parrot", "hornbill", "pheasant", "woodpecker", "finch"],
  },
  "Bats": { "bat": ["bat", "chiroptera", "chiropteran"] },
  "Rodents & small mammals": {
    "rodents": ["rodent", "rat", "mice", "mouse", "squirrel", "vole", "marmot", "beaver", "porcupine"],
    "hares & pikas": ["hare", "rabbit", "pika", "lagomorph"], "shrews & hedgehogs": ["shrew", "hedgehog", "mole"],
    "small mammals (general)": ["small mammal"],
  },
  "Marine mammals": {
    "dolphin & porpoise": ["dolphin", "porpoise"], "whale": ["whale", "cetacean"],
    "seal & sea lion": ["seal", "sea lion", "walrus"], "manatee & dugong": ["manatee", "dugong"],
    "marine mammals (general)": ["marine mammal"],
  },
  "Reptiles": {
    "snake": ["snake", "snakebite", "python", "cobra", "viper", "serpent"], "lizard": ["lizard", "gecko", "skink", "squamate", "iguana", "chameleon"],
    "turtle & tortoise": ["turtle", "tortoise", "terrapin"], "crocodilian": ["crocodile", "alligator", "gharial", "caiman"],
    "reptiles (general)": ["reptile", "herpetofauna"],
  },
  "Amphibians": { "amphibian": ["amphibian", "anura", "megophryidae", "frog", "toad", "salamander", "newt", "chytrid", "anuran"] },
  "Fish & aquatic life": {
    "fish": ["fish", "fishes", "seahorse", "sturgeon", "darter", "catostomid", "minnow", "eel", "teleost", "salmon", "trout", "catfish", "carp", "ichthyofauna"], "shark & ray": ["shark", "stingray"],
  },
  "Insects & other invertebrates": {
    "bees & pollinators": ["bee", "pollinator", "bumblebee", "pollination"], "butterflies & moths": ["butterfly", "butterflies", "moth"],
    "beetles, ants & others": ["hemiptera", "reduviid", "beetle", "ant", "dragonfly", "mosquito", "locust", "termite", "fly", "flies"],
    "insects (general)": ["insect", "arthropod", "entomological"],
    "other invertebrates": ["crayfish", "shrimp", "lobster", "macroinvertebrate", "molluscan", "invertebrate", "spider", "snail", "mollusc", "mollusk", "crab", "coral", "sea urchin", "crustacean"],
  },
  "Livestock & domestic animals": {
    "livestock": ["livestock", "cattle", "goat", "sheep", "cow", "poultry", "yak"],
    "dogs & cats": ["canine", "free-ranging cat", "stray cat", "domestic dog", "free-ranging dog", "feral dog", "stray dog", "dog", "domestic cat", "feral cat"],
  },
  "Mammals (general)": {
    "mammals": ["mammal", "mammalian", "pangolin", "marsupial", "kangaroo", "koala", "wallaby", "armadillo", "sloth", "anteater"],
  },
};

// Context words (livestock killed by a predator, "mammal" in passing) should not outrank the focal animal.
const WEIGHT: Record<string, number> = { "Livestock & domestic animals": 0.4, "Mammals (general)": 0.4 };
export const GROUP_ORDER = [...Object.keys(TAXA), GENERAL];

function pattern(terms: string[]): RegExp {
  // leopard must not match inside "snow leopard"; handled by letting both match and de-duplicating below.
  const body = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((term) => escapeRegex(term) + (term.endsWith("s") ? "" : "s?"))
    .join("|");
  return wholeWord(body, "gu");
}

const PATTERNS = new Map(Object.entries(TAXA).map(([group, animals]) =>
  [group, Object.entries(animals).map(([animal, terms]) => [animal, pattern(terms)] as const)]));

const COMPOUND_LEOPARD = wholeWord("(?:snow|clouded) leopards?", "gu");

/** Occurrences of an animal; plain "leopard" must not count "snow/clouded leopard". */
function count(animal: string, regex: RegExp, text: string): number {
  const hits = text.match(regex)?.length ?? 0;
  return animal === "leopard" ? hits - (text.match(COMPOUND_LEOPARD)?.length ?? 0) : hits;
}

export interface AnimalTags {
  animal_group: string;
  animal_groups: string;
  animals: string;
}

export function classify(title: string, abstract: string): AnimalTags {
  const titleText = title.toLowerCase();
  const abstractText = abstract.toLowerCase();
  const scores = new Map<string, number>();
  const strong = new Set<string>(); // groups substantial enough to show as tags
  const focal = new Set<string>(); // groups eligible to be the primary animal
  let animals: string[] = [];
  for (const [group, patterns] of PATTERNS) {
    let titleHits = 0;
    let abstractHits = 0;
    for (const [animal, regex] of patterns) {
      const inTitle = count(animal, regex, titleText);
      const inAbstract = count(animal, regex, abstractText);
      if ((inTitle > 0 || inAbstract >= 2) && !animal.endsWith("(general)")) animals.push(animal);
      if (inTitle > 0) titleHits++;
      abstractHits += inAbstract;
    }
    if (titleHits || abstractHits) {
      scores.set(group, (6 * Math.min(titleHits, 1) + Math.min(abstractHits, 6)) * (WEIGHT[group] ?? 1));
      if (titleHits || abstractHits >= 2) focal.add(group);
      if (titleHits || abstractHits >= 3) strong.add(group);
    }
  }

  // A specific group beats the catch-all groups when both are present in the title/abstract.
  let primary = GENERAL;
  for (const [group, score] of scores) {
    if (focal.has(group) && (primary === GENERAL || score > scores.get(primary)!)) primary = group;
  }
  const groups = GROUP_ORDER.filter((group) => strong.has(group));
  if (primary !== GENERAL && !groups.includes(primary)) groups.unshift(primary);
  // Name every animal of the main group that appears at all, so the card says what the paper is about.
  if (primary !== GENERAL) {
    const text = `${titleText} ${abstractText}`;
    const named = PATTERNS.get(primary)!
      .filter(([animal, regex]) => count(animal, regex, text) > 0 && !animal.endsWith("(general)"))
      .map(([animal]) => animal);
    animals = [...named, ...animals.filter((animal) => !named.includes(animal))];
  }
  // Drop the generic "Mammals" tag when a specific mammal group already covers the paper.
  const mammals = groups.indexOf("Mammals (general)");
  if (groups.length > 1 && mammals >= 0) groups.splice(mammals, 1);
  return {
    animal_group: primary,
    animal_groups: groups.length ? groups.join("; ") : GENERAL,
    animals: [...new Set(animals)].join("; "),
  };
}
