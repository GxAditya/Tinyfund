// Pure, rule-based extraction of a funding round from a news headline + article text.
// Used for Search-discovered pages when no AI key is configured. Returns only what the text states.
import { normalizeName, stageLabel, stageOf } from "./normalize";
import type { DealRow } from "./types";

const VERBS =
  "raises|raised|secures|secured|closes|closed|lands|landed|bags|bagged|nabs|snags|gets|announces|completes|picks up|scores|receives|wins";
const HEADLINE_RE = new RegExp(`^(.{2,90}?)\\s+(?:${VERBS})\\b(.*)$`, "i");
const GENERIC_WORD =
  /^(startups?|start-up|company|firm|platform|app|maker|provider|developer|unicorn|tech|fintech|healthtech|edtech|insurtech|proptech|agritech|cleantech|climatetech|climate|deeptech|biotech|ai|saas|b2b|b2c|d2c|software|e-?commerce|[a-z]+-(?:based|backed|focused|powered))$/i;
const NATIONALITY = /^[A-Z][a-z]+(?:ian|ese|ish|ean|an|i)$/;
const isGeneric = (w: string) => GENERIC_WORD.test(w) || NATIONALITY.test(w);
const NOT_NAME = /^(the|a|an|this|its|their|with|and|from|new|how|why|exclusive)$/i;

/** "Brazilian fintech Acme Pay raises $5M seed" -> "Acme Pay" */
export function companyFromHeadline(title: string): string | undefined {
  const t = title.replace(/\s+[|\u2013\u2014-]\s+[^|\u2013\u2014-]{2,40}$/, "").trim();
  const m = t.match(HEADLINE_RE);
  if (!m) return undefined;
  const head = m[1]!.trim();
  const words = head.split(/\s+/);
  let out: string[] = [];
  for (let i = words.length - 1; i >= 0 && out.length < 5; i--) {
    const w = words[i]!.replace(/[,:;]$/, "");
    if (/^[A-Z0-9][\w.&'’+-]*$/.test(w) && !NOT_NAME.test(w)) out.unshift(w);
    else break;
  }
  while (out.length > 1 && isGeneric(out[0]!)) out = out.slice(1);
  let name = out.join(" ") || head.split(",")[0]!.trim();
  name = name.replace(/^[A-Z][a-z]+['’]s\s+/, "").replace(/['’]s$/, "");
  return name && name.split(" ").length <= 5 && name.length <= 60 ? name : undefined;
}

const UNIT: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/** First USD amount in the text. Other currencies are left empty rather than converted by guess. */
export function usdAmount(s: string): number | undefined {
  const m = s.match(/(?:US\$|\$|USD\s?)\s?(\d+(?:[.,]\d+)*)\s?(k|mn|m|million|bn|b|billion)?\b/i);
  if (!m) return undefined;
  const raw = m[1]!;
  const n = parseFloat(
    /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", "."),
  );
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * (UNIT[(m[2] ?? "").toLowerCase()] ?? 1));
}

const INVESTOR_PATTERNS = [
  /\bled by\s+([^.;:\n]+)/gi,
  /\bparticipation (?:from|of|by)\s+([^.;:\n]+)/gi,
  /\b(?:backed|funded|joined) by\s+([^.;:\n]+)/gi,
  /\binvestors?\s+(?:include|including|such as|like)\s+([^.;:\n]+)/gi,
  /\balongside\s+([^.;:\n]+)/gi,
];
const BAD_ITEM =
  /^(it|its|the company|this|other|others|several|existing|angel|angels|undisclosed|investors?|a|an|new|both|all|some|many|participation)\b/i;

function cleanItems(capture: string): string[] {
  return capture
    .split(/,|;|\band\b|\bas well as\b|\bwith\b|\bplus\b|\bamong others\b/)
    .map((x) =>
      x
        .trim()
        .replace(/\(.*?\)/g, "")
        .replace(/[*_`"“”]/g, "")
        .replace(/^\s*(?:existing investors?|investors?|the)\s+/i, "")
        .replace(/^[A-Z][\w .]*?-based\s+/, "")
        .replace(/\s+(?:also|too|participated|joined|in the round|in this round).*$/i, "")
        .trim(),
    )
    .filter(
      (x) =>
        /^[A-Z0-9]/.test(x) &&
        x.length >= 2 &&
        x.length <= 60 &&
        x.split(/\s+/).length <= 6 &&
        !BAD_ITEM.test(x),
    );
}

/** Investors named in the article's opening (where the headline round is described). */
export function investorsFromText(text: string): {
  investors: string[];
  lead?: string | undefined;
} {
  const scope = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").slice(0, 4000);
  const seen = new Map<string, string>();
  let leads: string[] = [];
  for (const re of INVESTOR_PATTERNS) {
    for (const m of scope.matchAll(re)) {
      const items = cleanItems(m[1]!);
      // "led by A, B and C, with participation from D" -> A, B and C co-led
      if (re === INVESTOR_PATTERNS[0] && !leads.length)
        leads = cleanItems(m[1]!.split(/\bwith\b|\balongside\b|\bparticipation\b/)[0]!);
      for (const i of items) if (!seen.has(normalizeName(i))) seen.set(normalizeName(i), i);
    }
  }
  return { investors: [...seen.values()], lead: leads.length ? leads.join("; ") : undefined };
}

const PARTNER_RE =
  /([A-Z][a-z]+(?:\s[A-Z][a-z'’-]+){1,2}),\s+(?:a\s+)?(?:general\s+|managing\s+|founding\s+|investment\s+)?partner\s+(?:at|of|with)\s+([A-Z][\w&.'’ -]{1,50})/g;

/** "Jane Doe, partner at Accel" -> "Jane Doe" when the firm is the given one. */
export function partnerFor(text: string, firm: string): string | undefined {
  const f = normalizeName(firm);
  if (!f) return undefined;
  for (const m of text.matchAll(PARTNER_RE)) if (normalizeName(m[2]!).startsWith(f)) return m[1];
  return undefined;
}

export function isoDate(s?: string | null): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

export interface ArticlePage {
  url: string;
  title: string;
  text: string;
  date?: string | undefined;
}

/** One deal (the headline round) from a funding article, or undefined when it isn't one. */
export function dealFromArticle(page: ArticlePage): DealRow | undefined {
  const company = companyFromHeadline(page.title);
  if (!company) return undefined;
  const { investors, lead } = investorsFromText(page.text);
  if (!investors.length) return undefined;
  const opening = `${page.title}\n${page.text.slice(0, 800)}`;
  // Title first; in body text "angel investors" would otherwise read as a pre-seed round.
  const stage =
    stageOf(page.title) ??
    stageOf(page.text.slice(0, 800).replace(/angels?(?: investors?)?/gi, ""));
  const leads = lead?.split("; ") ?? [];
  return {
    company,
    one_liner: undefined,
    round_stage: stage ? stageLabel(stage) : undefined,
    amount_usd: usdAmount(opening) ?? null,
    announce_date: isoDate(page.date),
    investors: investors.join("; "),
    lead_investor: lead,
    lead_partner: leads.map((l) => partnerFor(page.text, l)).find(Boolean),
    source_url: page.url,
  };
}
