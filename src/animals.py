"""Classify papers by the animals they study (keyword taxonomy, whole-word matching).

Each paper gets:
    animal_group   the single best-matching group, e.g. "Big cats & wild cats"
    animal_groups  every group it substantially covers, separated by "; "
    animals        specific animals mentioned, e.g. "leopard; tiger"
"""

from __future__ import annotations

import re

GENERAL = "General / no specific animal"

# group -> {animal: [terms]}.  Terms are matched as whole words (plural 's' optional).
TAXA: dict[str, dict[str, list[str]]] = {
    "Big cats & wild cats": {
        "leopard": ["leopard", "panthera pardus"], "snow leopard": ["snow leopard", "panthera uncia"],
        "tiger": ["tiger", "panthera tigris"], "lion": ["lion", "panthera leo"], "cheetah": ["cheetah"],
        "jaguar": ["jaguar"], "puma": ["puma", "cougar", "mountain lion"],
        "lynx & small wild cats": ["lynx", "wildcat", "ocelot", "fishing cat", "leopard cat", "clouded leopard", "caracal", "serval"],
    },
    "Elephants": {"elephant": ["elephant", "elephas", "loxodonta"]},
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
    "Rhinos & hippos": {"rhino": ["rhino", "rhinoceros"], "hippo": ["hippo", "hippopotamus"]},
    "Birds": {
        "birds (general)": ["bird", "avian", "avifauna", "ornithological"],
        "raptors & owls": ["eagle", "vulture", "owl", "falcon", "hawk", "raptor", "kite", "buzzard"],
        "waterbirds & seabirds": ["seabird", "shorebird", "waterbird", "waterfowl", "duck", "goose", "heron", "crane", "stork", "penguin", "albatross"],
        "songbirds & others": ["peafowl", "peacock", "grouse", "shrike", "quail", "partridge", "bulbul", "passerine", "songbird", "warbler", "sparrow", "parrot", "hornbill", "pheasant", "woodpecker", "finch"],
    },
    "Bats": {"bat": ["bat", "chiroptera", "chiropteran"]},
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
    "Amphibians": {"amphibian": ["amphibian", "anura", "megophryidae", "frog", "toad", "salamander", "newt", "chytrid", "anuran"]},
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
}

# Context words (livestock killed by a predator, "mammal" in passing) should not outrank the focal animal.
WEIGHT = {"Livestock & domestic animals": 0.4, "Mammals (general)": 0.4}
GROUP_ORDER = list(TAXA) + [GENERAL]


def _pattern(terms: list[str]) -> re.Pattern[str]:
    # leopard must not match inside "snow leopard"; handled by letting both match and de-duplicating below.
    body = "|".join(re.escape(term) + ("s?" if not term.endswith("s") else "") for term in sorted(terms, key=len, reverse=True))
    return re.compile(r"\b(?:" + body + r")\b")


_PATTERNS = {group: {animal: _pattern(terms) for animal, terms in animals.items()} for group, animals in TAXA.items()}


_COMPOUND_LEOPARD = re.compile(r"\b(?:snow|clouded) leopards?\b")


def _count(animal: str, pattern: re.Pattern[str], text: str) -> int:
    """Occurrences of an animal; plain 'leopard' must not count 'snow/clouded leopard'."""
    hits = len(pattern.findall(text))
    return hits - len(_COMPOUND_LEOPARD.findall(text)) if animal == "leopard" else hits


def classify(title: str, abstract: str) -> dict[str, str]:
    title_l, abstract_l = title.lower(), abstract.lower()
    scores: dict[str, float] = {}
    strong: set[str] = set()   # groups substantial enough to show as tags
    focal: set[str] = set()    # groups eligible to be the primary animal
    animals: list[str] = []
    for group, patterns in _PATTERNS.items():
        title_hits = abstract_hits = 0
        for animal, pattern in patterns.items():
            in_title, in_abstract = _count(animal, pattern, title_l), _count(animal, pattern, abstract_l)
            if (in_title > 0 or in_abstract >= 2) and not animal.endswith("(general)"):
                animals.append(animal)
            title_hits += in_title > 0
            abstract_hits += in_abstract
        if title_hits or abstract_hits:
            scores[group] = (6 * min(title_hits, 1) + min(abstract_hits, 6)) * WEIGHT.get(group, 1.0)
            if title_hits or abstract_hits >= 2:
                focal.add(group)
            if title_hits or abstract_hits >= 3:
                strong.add(group)

    # A specific group beats the catch-all groups when both are present in the title/abstract.
    qualifying = [g for g in scores if g in focal]
    primary = max(qualifying, key=scores.get) if qualifying else GENERAL
    groups = [g for g in GROUP_ORDER if g in strong]
    if primary not in groups and primary != GENERAL:
        groups.insert(0, primary)
    # Name every animal of the main group that appears at all, so the card says what the paper is about.
    if primary != GENERAL:
        text = f"{title_l} {abstract_l}"
        named = [animal for animal, pattern in _PATTERNS[primary].items() if _count(animal, pattern, text) > 0 and not animal.endswith("(general)")]
        animals = named + [animal for animal in animals if animal not in named]
    # Drop the generic "Mammals" tag when a specific mammal group already covers the paper.
    if len(groups) > 1 and "Mammals (general)" in groups:
        groups.remove("Mammals (general)")
    return {
        "animal_group": primary,
        "animal_groups": "; ".join(groups) if groups else GENERAL,
        "animals": "; ".join(dict.fromkeys(animals)),
    }
