import type { Stage } from "./types";

const SUFFIXES =
  /\b(capital|ventures?|partners|vc|fund|funds|management|llc|inc|ltd|lp|group|investments?|holdings|the|technologies|technology|labs|corp|corporation|limited|gmbh|pvt|private|plc)\b/g;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function splitInvestors(s?: string): string[] {
  if (!s) return [];
  return s
    .split(/;|,|\band\b|\n|\|/i)
    .map((x) => x.replace(/\(.*?\)/g, "").trim())
    .filter((x) => x.length > 1 && !/^(others?|undisclosed|angels?|existing investors)$/i.test(x));
}

/** "Accel (lead); Y Combinator; Elaia (co-lead)" -> "Accel; Elaia" */
export function leadFromInvestors(s?: string): string | undefined {
  const items = (s ?? "").split(/;|\n|\|/).filter((x) => /\(\s*(co-?)?lead/i.test(x));
  return (
    items
      .map((x) => x.replace(/\(.*?\)/g, "").trim())
      .filter(Boolean)
      .join("; ") || undefined
  );
}

export function stageOf(text?: string): Stage | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/grant/.test(t)) return "grant";
  if (/pre[-\s]?seed|angel/.test(t)) return "pre-seed";
  if (/seed/.test(t)) return "seed";
  if (/series\s?a\b/.test(t)) return "series-a";
  if (/series\s?b\b/.test(t)) return "series-b";
  if (/series\s?[c-h]\b|growth|late/.test(t)) return "growth";
  return null;
}

const ORDER: Stage[] = ["pre-seed", "seed", "series-a", "series-b", "growth"];
export function stageDistance(a: Stage, b: Stage): number {
  if (a === "any" || b === "any") return 0;
  if (a === "grant" || b === "grant") return a === b ? 0 : 1;
  return Math.abs(ORDER.indexOf(a) - ORDER.indexOf(b));
}

export interface Haystack {
  raw: string;
  norm: string;
}

/** Normalize a page once so many names can be checked against it cheaply. */
export function haystack(text: string): Haystack {
  return { raw: text, norm: ` ${normalizeName(text)} ` };
}

/**
 * Strict match: the whole normalized name must appear as a phrase. A name that normalizes to a
 * single word ("Elevation Capital" -> "elevation") must also appear capitalized in the raw text,
 * so a common word in running prose doesn't count as the firm.
 */
export function mentions(h: Haystack, name: string): boolean {
  const n = normalizeName(name);
  if (n.length < 3 || !h.norm.includes(` ${n} `)) return false;
  if (n.includes(" ")) return true;
  return new RegExp(
    `(^|[^A-Za-z0-9])(${n[0]!.toUpperCase()}${n.slice(1)}|${n.toUpperCase()})(?![a-z0-9])`,
  ).test(h.raw);
}

export function textMentions(text: string, name: string): boolean {
  return mentions(haystack(text), name);
}

const STAGE_LABEL: Record<Stage, string> = {
  "pre-seed": "Pre-seed",
  seed: "Seed",
  "series-a": "Series A",
  "series-b": "Series B",
  growth: "Series C",
  grant: "Grant",
  any: "Any stage",
};
export const stageLabel = (s: Stage) => STAGE_LABEL[s];

const STAGE_TEXT: Partial<Record<Stage, RegExp>> = {
  "pre-seed": /pre[-\s]?seed/,
  seed: /(?<!pre[-\s]?)\bseed\b/,
  "series-a": /series\s?a\b/,
  "series-b": /series\s?b\b/,
  growth: /growth[-\s]stage|series\s?[c-e]\b/,
};

/** Stages a page says the investor backs, e.g. "Pre-seed, Seed". Only from investing context. */
export function stagesFromText(text: string): string | undefined {
  const scope = text.toLowerCase();
  if (!/invest|back|cheque|check size|we fund|we lead/.test(scope)) return undefined;
  const found = ORDER.filter((s) => STAGE_TEXT[s]?.test(scope));
  return found.length ? found.map(stageLabel).join(", ") : undefined;
}

const COUNTRY_CODES: Record<string, string> = {
  "united states": "US",
  usa: "US",
  us: "US",
  canada: "CA",
  mexico: "MX",
  brazil: "BR",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  "united kingdom": "GB",
  uk: "GB",
  ireland: "IE",
  germany: "DE",
  france: "FR",
  spain: "ES",
  italy: "IT",
  portugal: "PT",
  netherlands: "NL",
  belgium: "BE",
  switzerland: "CH",
  austria: "AT",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  poland: "PL",
  estonia: "EE",
  india: "IN",
  pakistan: "PK",
  bangladesh: "BD",
  "sri lanka": "LK",
  singapore: "SG",
  indonesia: "ID",
  vietnam: "VN",
  thailand: "TH",
  philippines: "PH",
  malaysia: "MY",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  taiwan: "TW",
  "hong kong": "HK",
  australia: "AU",
  "new zealand": "NZ",
  israel: "IL",
  uae: "AE",
  "united arab emirates": "AE",
  "saudi arabia": "SA",
  qatar: "QA",
  turkey: "TR",
  egypt: "EG",
  nigeria: "NG",
  kenya: "KE",
  "south africa": "ZA",
  ghana: "GH",
  morocco: "MA",
  rwanda: "RW",
};
export const countryCode = (country: string) => COUNTRY_CODES[country.toLowerCase().trim()];

export const REGIONS: Record<string, string[]> = {
  "South Asia": ["india", "pakistan", "bangladesh", "sri lanka", "nepal"],
  "Southeast Asia": ["singapore", "indonesia", "vietnam", "thailand", "philippines", "malaysia"],
  "East Asia": ["china", "japan", "south korea", "korea", "taiwan", "hong kong"],
  "Middle East": [
    "uae",
    "united arab emirates",
    "saudi arabia",
    "israel",
    "qatar",
    "egypt",
    "turkey",
  ],
  Africa: ["nigeria", "kenya", "south africa", "ghana", "egypt", "morocco", "rwanda"],
  Europe: [
    "uk",
    "united kingdom",
    "germany",
    "france",
    "spain",
    "italy",
    "netherlands",
    "sweden",
    "denmark",
    "norway",
    "finland",
    "ireland",
    "poland",
    "portugal",
    "switzerland",
    "austria",
    "belgium",
    "estonia",
    "czech republic",
  ],
  "North America": ["usa", "us", "united states", "canada", "mexico"],
  "Latin America": ["brazil", "argentina", "chile", "colombia", "mexico", "peru", "uruguay"],
  Oceania: ["australia", "new zealand"],
};

export function regionOf(country: string): string {
  const c = country.toLowerCase().trim();
  for (const [r, list] of Object.entries(REGIONS)) if (list.includes(c)) return r;
  return "Global";
}
