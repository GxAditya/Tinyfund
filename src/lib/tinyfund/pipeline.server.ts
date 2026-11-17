// Server-only: talks to TinyFish (TinySet, Search, Fetch) and an optional BYOK OpenAI-compatible model.
//
// Cost policy:
// - TinySet is the only paid TinyFish call ($0.10 per complete row), capped by DEAL_ROWS.
// - Search and Fetch are free but rate-limited, so every step has a hard call budget and stops on
//   the first limit error instead of retrying.
// - The Agent API is never called: nothing here needs to submit a form or type into a site. Pitch
//   forms are discovered as links with Fetch; reading any page, JS-heavy or not, is Fetch's job.
import { aggregateInvestors, isUsable, rankInvestors, TARGET_COMPANIES } from "./rank";
import {
  countryCode,
  haystack,
  leadFromInvestors,
  mentions,
  normalizeName,
  regionOf,
  splitInvestors,
  stageLabel,
  stagesFromText,
} from "./normalize";
import { cutoffDate, parseStartupRules } from "./parse";
import { dealFromArticle, isoDate } from "./extract";
import type {
  DealRow,
  InvestorProfileInfo,
  Keys,
  Report,
  StartupProfile,
  StepResult,
  VerifiedDeal,
} from "./types";

const AGENT = "https://agent.tinyfish.ai";
/** TinySet rows per run. At $0.10 per complete row this caps the paid part of a run at $1.50. */
export const DEAL_ROWS = 15;
const ENRICH_TOP = 10;

// ---------- TinyFish HTTP ----------
export class TinyFishError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

const LIMIT_CODES = new Set([
  "RATE_LIMIT_EXCEEDED",
  "DAILY_LIMIT_EXCEEDED",
  "FREE_ALLOWANCE_EXHAUSTED",
  "INSUFFICIENT_CREDITS",
]);
const isLimitError = (e: unknown) =>
  e instanceof TinyFishError &&
  (e.status === 429 || e.status === 402 || LIMIT_CODES.has(e.code ?? ""));

function tfKey(keys: Keys): string {
  const k = keys.tinyfishKey || process.env["TINYFISH_API_KEY"];
  if (!k) throw new Error("Missing TinyFish API key. Add it in Settings.");
  return k;
}

async function tf(keys: Keys, url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-API-Key": tfKey(keys),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 300);
    throw new TinyFishError(`TinyFish ${res.status}: ${msg}`, res.status, json?.error?.code);
  }
  return json;
}

/**
 * Hard cap on free Search/Fetch usage for one step. The first rate-limit / allowance error
 * trips the breaker and every later call in the step returns empty instead of retrying.
 */
export class Budget {
  searches = 0;
  urls = 0;
  stopped: string | undefined;
  constructor(
    public step: string,
    public maxSearches: number,
    public maxUrls: number,
  ) {}
  canSearch() {
    return !this.stopped && this.searches < this.maxSearches;
  }
  urlsLeft() {
    return this.stopped ? 0 : Math.max(0, this.maxUrls - this.urls);
  }
  trip(e: unknown) {
    if (isLimitError(e)) this.stopped = (e as Error).message;
  }
  note(): string | undefined {
    return this.stopped
      ? `TinyFish limit reached during ${this.step}; stopped early instead of retrying (${this.stopped}).`
      : undefined;
  }
}

interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  date?: string;
  site_name?: string;
}

export async function tfSearch(
  keys: Keys,
  budget: Budget,
  query: string,
  opts: Record<string, string> = {},
): Promise<SearchHit[]> {
  if (!budget.canSearch()) return [];
  budget.searches++;
  try {
    const j = await tf(
      keys,
      `https://api.search.tinyfish.ai?${new URLSearchParams({ query, ...opts })}`,
    );
    return (j.results ?? []) as SearchHit[];
  } catch (e) {
    budget.trip(e);
    console.error("search failed", e);
    return [];
  }
}

interface FetchedPage {
  text: string;
  links: string[];
  title: string;
  published_date?: string | undefined;
}

const MAX_PAGE_CHARS = 30_000;
const MAX_PAGE_LINKS = 400;

/** Batched (10 URLs per request), deduped, and trimmed to what's left of the budget. */
export async function tfFetch(
  keys: Keys,
  budget: Budget,
  urls: string[],
  opts: { links?: boolean; purpose?: string } = {},
): Promise<Record<string, FetchedPage>> {
  const out: Record<string, FetchedPage> = {};
  const todo = [...new Set(urls.filter((u) => /^https?:\/\//.test(u)))].slice(0, budget.urlsLeft());
  for (let i = 0; i < todo.length && !budget.stopped; i += 10) {
    const batch = todo.slice(i, i + 10);
    budget.urls += batch.length;
    try {
      const j = await tf(keys, "https://api.fetch.tinyfish.ai", {
        method: "POST",
        body: JSON.stringify({
          urls: batch,
          format: "markdown",
          links: !!opts.links,
          per_url_timeout_ms: 25000,
          ...(opts.purpose ? { purpose: opts.purpose } : {}),
        }),
      });
      // Facts we check (names, round, date, pitch links) sit near the top of a page. Capping text
      // keeps per-request CPU low enough for Cloudflare's free plan (10 ms CPU per request).
      for (const r of j.results ?? [])
        out[r.url] = {
          text: String(r.text ?? "").slice(0, MAX_PAGE_CHARS),
          links: (r.links ?? []).slice(0, MAX_PAGE_LINKS),
          title: r.title ?? "",
          published_date: r.published_date ?? undefined,
        };
    } catch (e) {
      budget.trip(e);
      console.error("fetch failed", e);
    }
  }
  return out;
}

// ---------- AI (BYOK, optional) ----------
function hasAi(keys: Keys) {
  return !!(keys.aiKey && keys.aiBaseUrl && keys.aiModel);
}

async function aiJson<T>(keys: Keys, system: string, user: string): Promise<T | null> {
  if (!hasAi(keys)) return null;
  try {
    const url = `${keys.aiBaseUrl!.replace(/\/$/, "")}/chat/completions`;
    const messages = [
      { role: "system", content: system + " Respond with a single JSON object only." },
      { role: "user", content: user },
    ];
    const send = (extra: Record<string, unknown>) =>
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${keys.aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: keys.aiModel, messages, ...extra }),
      });
    let res = await send({ temperature: 0, response_format: { type: "json_object" } });
    // Some providers (newer OpenAI reasoning models, Claude, Grok) reject these optional params, so retry once plainly.
    if (res.status === 400) res = await send({});
    if (!res.ok) {
      console.error("AI error", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const j: any = await res.json();
    const content: string = j.choices?.[0]?.message?.content ?? "";
    const m = content.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch (e) {
    console.error("AI failed", e);
    return null;
  }
}

// ---------- 1. Parse ----------
export async function parseStartup(
  keys: Keys,
  description: string,
  stage?: string,
  country?: string,
): Promise<StartupProfile> {
  const base = parseStartupRules(description, stage, country);
  const ai = await aiJson<{
    sector?: string;
    keywords?: string[];
    stage?: string;
    country?: string;
  }>(
    keys,
    "You classify startups for investor research.",
    `Startup: "${description}". Stage hint: ${stage || "none"}. Country hint: ${country || "none"}.
Return {"sector": short sector name, "keywords": 5-8 search keywords incl. synonyms, "stage": one of pre-seed|seed|series-a|series-b|growth|grant|any, "country": country name in English or "Global"}.`,
  );
  if (!ai) return base;
  const c = country?.trim() || ai.country || base.country;
  return {
    ...base,
    sector: ai.sector || base.sector,
    keywords: ai.keywords?.length ? ai.keywords.slice(0, 8) : base.keywords,
    stage: (stage ? base.stage : (ai.stage as StartupProfile["stage"])) || base.stage,
    country: c,
    region: regionOf(c),
  };
}

// ---------- 2. TinySet dataset of similar funded companies ----------
export function dealSpec(p: StartupProfile) {
  const geo =
    p.country === "Global"
      ? "anywhere in the world"
      : `in ${p.country} first, then elsewhere in ${p.region === "Global" ? "the world" : p.region} and globally if fewer than 10 local matches exist`;
  return {
    name: `Similar funded startups: ${p.sector}`.slice(0, 200),
    description: `Startups similar to "${p.description}" (sector: ${p.sector}; keywords: ${p.keywords.join(", ")}) that announced a funding round or grant on or after ${p.cutoffDate}, ${p.stage === "any" ? "at any stage (pre-seed through growth rounds, or grants)" : `ideally at ${p.stage} or adjacent stages`}, located ${geo}. One row per company's most recent qualifying round. Use live sources: funding news (TechCrunch, local tech press in the local language), company and investor websites/portfolio pages, founder posts on LinkedIn/X, and government grant portals.`,
    columns: [
      {
        name: "company",
        label: "Company",
        type: "string",
        is_primary_key: true,
        format: "Company name, no Inc/Ltd",
      },
      { name: "website", label: "Website", type: "url", is_primary_key: false, is_unique: true },
      {
        name: "country",
        label: "HQ country",
        type: "string",
        is_primary_key: false,
        format: "Country name in English",
      },
      {
        name: "round_stage",
        label: "Round",
        type: "string",
        is_primary_key: false,
        // TinySet allows at most 3 examples per column.
        examples: ["Pre-seed", "Seed", "Series A"],
        format: "Pre-seed, Seed, Series A, Series B, Series C+ or Grant",
      },
      {
        name: "amount_usd",
        label: "Amount (USD)",
        type: "number",
        is_primary_key: false,
        format: "Round size converted to USD, digits only",
      },
      {
        name: "announce_date",
        label: "Announced",
        type: "date",
        is_primary_key: false,
        format: "YYYY-MM-DD",
      },
      {
        name: "investors",
        label: "Investors",
        type: "string",
        is_primary_key: false,
        format:
          "All named investors in this round, separated by semicolons, exactly as the source names them; mark the firm that led the round with ' (lead)', e.g. 'Accel (lead); Y Combinator'",
        examples: ["Accel (lead); Y Combinator; Kima Ventures"],
      },
      {
        name: "lead_partner",
        label: "Lead partner",
        type: "string",
        is_primary_key: false,
        retrieval_hint:
          "The named partner/person at the lead firm who led or sourced the deal, as named on the proof link page. Leave empty if not stated there.",
      },
      {
        name: "source_url",
        label: "Proof link",
        type: "url",
        is_primary_key: false,
        retrieval_hint:
          "A live page (news article, press release, investor blog/portfolio page, founder post, grant portal) that names this company, this round, its investors and the announcement date.",
      },
      {
        name: "is_match",
        label: "Similar & recent",
        type: "boolean",
        is_primary_key: false,
        retrieval_hint: `True only if the company does something similar to "${p.description}" AND the round was announced on or after ${p.cutoffDate} AND at least one investor is named.`,
      },
    ],
    keep_when: { column: "is_match" },
  };
}

function friendlyCreateError(e: unknown): Error {
  if (!(e instanceof TinyFishError)) return e as Error;
  if (e.code === "INSUFFICIENT_CREDITS" || e.status === 402)
    return new Error(
      `Your TinyFish wallet can't cover this search (TinySet bills $0.10 per filled row, at most $${(DEAL_ROWS * 0.1).toFixed(2)} here). Top up at https://agent.tinyfish.ai/wallet.`,
    );
  if (e.status === 403)
    return new Error("TinySet needs a personal TinyFish API key; organization keys are refused.");
  if (e.status === 429)
    return new Error(
      "TinySet already has 3 runs in progress on this account. Wait for one to finish, then try again.",
    );
  return e;
}

export async function createDealDataset(keys: Keys, p: StartupProfile, targetRows = DEAL_ROWS) {
  try {
    const ds = await tf(keys, `${AGENT}/v1/datasets`, {
      method: "POST",
      body: JSON.stringify({ spec: dealSpec(p), target_rows: targetRows, populate: true }),
    });
    return ds.id as string;
  } catch (e) {
    throw friendlyCreateError(e);
  }
}

const IN_PROGRESS = new Set(["queued", "running"]);

export async function getDataset(keys: Keys, id: string) {
  const ds = await tf(keys, `${AGENT}/v1/datasets/${id}`);
  const rows = await tf(keys, `${AGENT}/v1/datasets/${id}/rows?limit=500`);
  const deals: DealRow[] = (rows.rows ?? [])
    .map((r: any) => r.data as DealRow)
    .filter((r: DealRow) => r?.company)
    .map((r: DealRow) => ({
      ...r,
      lead_investor: r.lead_investor || leadFromInvestors(r.investors),
    }));
  const runStatus = ds.run?.status as string | undefined;
  return {
    status: ds.status as string,
    runStatus,
    /** only a live run (or a populating dataset) counts as in progress; `empty` with a finished run is final */
    inProgress: ds.status === "populating" || (!!runStatus && IN_PROGRESS.has(runStatus)),
    error: ds.run?.error as string | undefined,
    deals,
  };
}

/** Stop a live TinySet run so it stops billing rows. Rows already filled are kept. */
export async function cancelDataset(keys: Keys, id: string) {
  const ds = await tf(keys, `${AGENT}/v1/datasets/${id}`);
  const run = ds.run as { id?: string; status?: string } | null;
  if (!run?.id || !IN_PROGRESS.has(run.status ?? "")) return { cancelled: false };
  await tf(keys, `${AGENT}/v1/datasets/${id}/runs/${run.id}/cancel`, { method: "POST" });
  return { cancelled: true };
}

// ---------- 3. Verify every deal against its live source ----------
/** Checks a deal against one fetched page. Investors, lead and partner survive only if the page names them. */
function checkAgainstPage(
  d: DealRow,
  page: FetchedPage | undefined,
  cutoff: number,
): Omit<VerifiedDeal, "origin"> {
  if (!page || page.text.length < 200)
    return {
      ...d,
      sourceVerified: false,
      verifiedInvestors: [],
      recent: false,
      note: "Proof link could not be fetched",
    };
  const h = haystack(page.text);
  if (!mentions(h, d.company))
    return {
      ...d,
      sourceVerified: false,
      verifiedInvestors: [],
      recent: false,
      note: "Company not found on proof page",
    };
  const investors = splitInvestors(d.investors);
  const verifiedInvestors = investors.filter((i) => mentions(h, i));
  const verifiedKeys = new Set(verifiedInvestors.map(normalizeName));
  const lead =
    splitInvestors(d.lead_investor)
      .filter((l) => verifiedKeys.has(normalizeName(l)))
      .join("; ") || undefined;
  const partner =
    lead && d.lead_partner && mentions(h, d.lead_partner) ? d.lead_partner : undefined;
  const date = isoDate(d.announce_date) ?? isoDate(page.published_date);
  const recent = !!date && Date.parse(date) >= cutoff;
  let note: string | undefined;
  if (!date) note = "No announcement date on record or on the proof page";
  else if (!recent) note = `Round announced before the 18-month window`;
  else if (!verifiedInvestors.length) note = "No listed investor is named on the proof page";
  else if (verifiedInvestors.length < investors.length)
    note = "Investors not named on the proof page were dropped";
  return {
    ...d,
    announce_date: date,
    lead_investor: lead,
    lead_partner: partner,
    sourceVerified: true,
    verifiedInvestors,
    recent,
    note,
  };
}

export async function verifyDeals(
  keys: Keys,
  p: StartupProfile,
  deals: DealRow[],
): Promise<StepResult> {
  const budget = new Budget("verification", 5, 35);
  const cutoff = Date.parse(p.cutoffDate || cutoffDate());
  const pages = await tfFetch(
    keys,
    budget,
    deals.map((d) => d.source_url ?? ""),
    {
      purpose:
        "Confirm that each startup funding round, its date and its investors are named on this page",
    },
  );
  const result: VerifiedDeal[] = deals.map((d) => ({
    ...checkAgainstPage(d, d.source_url ? pages[d.source_url] : undefined, cutoff),
    origin: "tinyset",
  }));

  // One alternate-source search per failed row (max 5), then a single batched fetch for all candidates.
  const retry = result.filter((r) => !r.sourceVerified).slice(0, 5);
  const alt = await Promise.all(
    retry.map((r) =>
      tfSearch(
        keys,
        budget,
        `${r.company} raises funding ${splitInvestors(r.investors)[0] ?? ""}`.trim(),
        {
          domain_type: "news",
          after_date: p.cutoffDate,
          purpose: `Find a news article confirming ${r.company}'s funding round and its investors`,
        },
      ).then((hits) => hits.slice(0, 2).map((h) => h.url)),
    ),
  );
  const altPages = await tfFetch(keys, budget, alt.flat(), {
    purpose: "Confirm a startup funding round and its investors",
  });
  retry.forEach((r, i) => {
    for (const u of alt[i] ?? []) {
      const c = checkAgainstPage({ ...r, source_url: u }, altPages[u], cutoff);
      if (c.sourceVerified && c.recent && c.verifiedInvestors.length) {
        Object.assign(r, c, { note: "Verified via an alternate live source (TinyFish Search)" });
        return;
      }
    }
  });
  const notes = [budget.note()].filter((x): x is string => !!x);
  return { deals: result, notes };
}

// ---------- 3b. Free discovery top-up (Search + Fetch) ----------
const FUNDING_RE =
  /\b(rais(?:es|ed|ing)|secures?|secured|closes?|closed|lands?|bags?|funding|seed|series [a-e]|grant|backs?|backed|invest(?:s|ment|ed)?|round|led)\b/i;
const SKIP_HOSTS =
  /(^|\.)(crunchbase|pitchbook|tracxn|cbinsights|dealroom|linkedin|twitter|x|facebook|instagram|youtube|reddit|wikipedia|glassdoor|zoominfo|owler)\.(com|org|co|io)$/i;

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function keywordHits(text: string, p: StartupProfile) {
  const t = text.toLowerCase();
  return p.keywords.filter((k) => k.length > 2 && t.includes(k.toLowerCase())).length;
}

function discoveryQueries(
  p: StartupProfile,
  round: 1 | 2,
): { query: string; opts: Record<string, string> }[] {
  const kw = p.keywords.slice(0, 3).join(" ") || p.sector;
  const st = p.stage === "any" ? "" : stageLabel(p.stage);
  const purpose = `Find startups similar to "${p.description}" that announced a funding round or grant since ${p.cutoffDate}, with the investors named`;
  const news = { domain_type: "news", after_date: p.cutoffDate, purpose };
  const local = p.country !== "Global";
  const loc = local ? countryCode(p.country) : undefined;
  if (round === 1)
    return [
      { query: `${kw} startup raises ${st} funding`.replace(/\s+/g, " "), opts: news },
      { query: `${p.sector} ${st || "funding"} round led by`, opts: news },
      local
        ? {
            query: `${kw} startup ${p.country} funding round investors`,
            opts: { ...news, ...(loc ? { location: loc } : {}) },
          }
        : { query: `${kw} startup secures investment`, opts: news },
      ...(p.stage === "grant"
        ? [
            {
              query: `${p.sector} startups awarded grant ${local ? p.country : ""}`.trim(),
              opts: { after_date: p.cutoffDate, purpose },
            },
          ]
        : []),
    ];
  // Round 2 widens: any stage, any country, and web pages (investor blogs, company announcements).
  return [
    {
      query: `${kw} startup raised funding investors`,
      opts: { after_date: p.cutoffDate, purpose },
    },
    {
      query: `excited to lead investment in ${p.sector} startup`,
      opts: { after_date: p.cutoffDate, purpose },
    },
    { query: `${p.sector} startup announces funding`, opts: news },
  ];
}

function pickCandidates(
  hits: SearchHit[],
  p: StartupProfile,
  used: Set<string>,
  limit = 10,
): SearchHit[] {
  const seen = new Set<string>();
  return hits
    .filter((h) => {
      if (!h.url || used.has(h.url) || seen.has(h.url) || SKIP_HOSTS.test(hostOf(h.url)))
        return false;
      seen.add(h.url);
      return FUNDING_RE.test(`${h.title} ${h.snippet}`);
    })
    .map((h) => ({ h, s: keywordHits(h.title, p) * 2 + keywordHits(h.snippet, p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.h);
}

interface AiDeal {
  company?: string;
  website?: string;
  one_liner?: string;
  country?: string;
  round_stage?: string;
  amount_usd?: number | null;
  announce_date?: string;
  investors?: string[];
  lead_investor?: string;
  lead_partner?: string;
  similar?: boolean;
}

async function dealsFromPage(
  keys: Keys,
  p: StartupProfile,
  hit: SearchHit,
  page: FetchedPage,
): Promise<DealRow[]> {
  const ai = await aiJson<{ deals?: AiDeal[] }>(
    keys,
    "You extract startup funding rounds from a news article, strictly from its text. Never guess; use null for anything the text does not state.",
    `Founder's startup: "${p.description}" (sector ${p.sector}).
Article: ${hit.url}
Title: ${page.title || hit.title}
Text:
${page.text.slice(0, 6000)}

Return {"deals": [{"company", "website", "one_liner", "country", "round_stage", "amount_usd" (USD number or null), "announce_date" (YYYY-MM-DD), "investors" (array of firm/angel names as written), "lead_investor", "lead_partner" (person at the lead firm, only if named), "similar" (true if the company does something similar to the founder's startup)}]} for each round announced in the article, at most 5.`,
  );
  if (ai?.deals)
    return ai.deals
      .filter((d) => d.similar && d.company)
      .map((d) => ({
        company: d.company!,
        website: d.website || undefined,
        one_liner: d.one_liner || undefined,
        country: d.country || undefined,
        round_stage: d.round_stage || undefined,
        amount_usd: typeof d.amount_usd === "number" ? d.amount_usd : null,
        announce_date: d.announce_date || hit.date || page.published_date,
        investors: (d.investors ?? []).join("; "),
        lead_investor: d.lead_investor || undefined,
        lead_partner: d.lead_partner || undefined,
        source_url: hit.url,
      }));
  const d = dealFromArticle({
    url: hit.url,
    title: page.title || hit.title,
    text: page.text,
    date: hit.date ?? page.published_date,
  });
  const similar =
    keywordHits(`${hit.title}\n${page.text.slice(0, 2000)}`, p) >= Math.min(2, p.keywords.length);
  return d && similar ? [d] : [];
}

/**
 * Runs at most once per search, with at most two query rounds and a hard budget, then stops,
 * whatever it found. Never loops waiting for a target the web may not have.
 */
export async function discoverDeals(
  keys: Keys,
  p: StartupProfile,
  existing: VerifiedDeal[],
  /** per-article AI extraction (one model call per page); off for single-request runs */
  aiExtract = true,
): Promise<StepResult> {
  const budget = new Budget("discovery", 7, 20);
  const cutoff = Date.parse(p.cutoffDate || cutoffDate());
  const known = new Set(existing.filter(isUsable).map((d) => normalizeName(d.company)));
  const used = new Set(existing.map((d) => d.source_url ?? ""));
  const found: VerifiedDeal[] = [];

  for (const round of [1, 2] as const) {
    if (known.size >= TARGET_COMPANIES || !budget.canSearch()) break;
    const hits = (
      await Promise.all(
        discoveryQueries(p, round).map((q) => tfSearch(keys, budget, q.query, q.opts)),
      )
    ).flat();
    const candidates = pickCandidates(hits, p, used, Math.min(10, budget.urlsLeft()));
    if (!candidates.length) continue;
    candidates.forEach((c) => used.add(c.url));
    const pages = await tfFetch(
      keys,
      budget,
      candidates.map((c) => c.url),
      {
        purpose: `Read funding announcements of startups similar to "${p.description}"`,
      },
    );
    const extracted = await Promise.all(
      candidates
        .filter((c) => (pages[c.url]?.text.length ?? 0) > 300)
        .map((c) =>
          dealsFromPage(aiExtract ? keys : { ...keys, aiKey: undefined }, p, c, pages[c.url]!),
        ),
    );
    for (const d of extracted.flat()) {
      const v = checkAgainstPage(d, pages[d.source_url!], cutoff);
      const key = normalizeName(v.company);
      if (!key || known.has(key) || !isUsable(v as VerifiedDeal)) continue;
      known.add(key);
      found.push({
        ...v,
        origin: "search",
        note: "Found and verified with TinyFish Search + Fetch",
      });
    }
  }

  const foundKeys = new Set(found.map((d) => normalizeName(d.company)));
  const merged = [
    ...existing.filter((d) => isUsable(d) || !foundKeys.has(normalizeName(d.company))),
    ...found,
  ];
  const notes = [
    found.length
      ? `Found ${found.length} more similar compan${found.length === 1 ? "y" : "ies"} with free TinyFish Search + Fetch.`
      : undefined,
    budget.note(),
  ].filter((x): x is string => !!x);
  return { deals: merged, notes };
}

// ---------- 4. Enrich investors (cheque, stage, intake) ----------
const CHEQUE_RANGE_RE =
  /(?:US)?\$\s?\d+(?:\.\d+)?\s?(?:k|m|mm|million|thousand)?\s?(?:-|–|to)\s?(?:US)?\$?\s?\d+(?:\.\d+)?\s?(?:k|m|mm|million|thousand)\b/i;
const CHEQUE_UPTO_RE =
  /(?:invest|cheques?|checks?|tickets?)[^.\n]{0,40}?(?:up to|between|from)\s+(?:US)?\$\s?\d[\d.,]*\s?(?:k|m|mn|million)?(?:\s?(?:-|–|to|and)\s?(?:US)?\$?\s?\d[\d.,]*\s?(?:k|m|mn|million)?)?/i;
const APPLY_RE =
  /apply|pitch|submit|founders?-?form|typeform\.com|airtable\.com\/(shr|app)|forms\.gle|docs\.google\.com\/forms|jotform|tally\.so|hsforms/i;
const NOT_FOUNDER_LINK = /job|career|hiring|lp-|limited-partner|login|signin/i;
const INFO_RE =
  /about|approach|thesis|faq|for-founders|what-we-do|how-we-invest|invest|strategy|focus/i;

function pickSite(name: string, hits: SearchHit[]): string | undefined {
  const n = normalizeName(name);
  const first = n.split(" ")[0] ?? "";
  const compactName = n.replace(/\s/g, "");
  for (const h of hits) {
    const host = hostOf(h.url);
    if (!host || SKIP_HOSTS.test(host)) continue;
    const compactHost = host
      .split(".")
      .slice(0, -1)
      .join("")
      .replace(/[^a-z0-9]/g, "");
    if (
      (first.length >= 3 && compactHost.includes(first)) ||
      (compactHost.length >= 4 && compactName.includes(compactHost))
    ) {
      try {
        return new URL(h.url).origin;
      } catch {
        /* skip */
      }
    }
  }
  return undefined;
}

async function enrichInvestors(
  keys: Keys,
  names: string[],
): Promise<Record<string, InvestorProfileInfo>> {
  const budget = new Budget("investor profiles", names.length, 25);
  const sites = await Promise.all(
    names.map((name) =>
      tfSearch(keys, budget, `${name} venture capital firm official website`, {
        purpose: `Find the official website of the investor ${name} to read its cheque size, stages and how founders can pitch`,
      }).then((hits) => pickSite(name, hits)),
    ),
  );
  const purpose =
    "Read an investor's website for cheque size, stages, geographies and how founders can pitch";
  const homes = await tfFetch(
    keys,
    budget,
    sites.filter((s): s is string => !!s),
    { links: true, purpose },
  );

  // One extra page per investor, only when it adds something: their pitch page, or an about/thesis page.
  const plan = names.map((_, i) => {
    const site = sites[i];
    const home = site ? homes[site] : undefined;
    if (!site || !home) return undefined;
    const host = hostOf(site);
    const apply = home.links.find((l) => APPLY_RE.test(l) && !NOT_FOUNDER_LINK.test(l));
    const contact = home.links.find((l) => /contact|mailto:/i.test(l));
    const hasFacts = CHEQUE_RANGE_RE.test(home.text) || CHEQUE_UPTO_RE.test(home.text);
    const info = hasFacts
      ? undefined
      : home.links.find(
          (l) => hostOf(l) === host && INFO_RE.test(new URL(l).pathname) && l !== apply,
        );
    const extra = apply && hostOf(apply) === host ? apply : info;
    return { site, home, apply, contact, extra };
  });
  const extras = await tfFetch(
    keys,
    budget,
    plan.map((x) => x?.extra ?? ""),
    { purpose },
  );

  const out: Record<string, InvestorProfileInfo> = {};
  await Promise.all(
    names.map(async (name, i) => {
      const x = plan[i];
      if (!x) return;
      const text = [x.home.text, x.extra ? (extras[x.extra]?.text ?? "") : ""]
        .join("\n")
        .slice(0, 12000);
      const info: InvestorProfileInfo = {
        website: x.site,
        profileSource: x.site,
        typicalCheque: text.match(CHEQUE_RANGE_RE)?.[0] ?? text.match(CHEQUE_UPTO_RE)?.[0],
        stages: stagesFromText(text),
        applicationUrl: x.apply ?? x.contact,
        intakeType: x.apply ? "application form" : x.contact ? "open intake" : "warm intro",
      };
      const ai = await aiJson<{
        typical_cheque?: string;
        stages?: string;
        geographies?: string;
        accepts_cold_pitches?: boolean;
      }>(
        keys,
        "Extract facts about a venture investor strictly from the provided page text. Use null when the text does not state it. Never guess.",
        `Investor: ${name}\nPage text:\n${text.slice(0, 8000)}\nReturn {"typical_cheque": string|null, "stages": string|null, "geographies": string|null, "accepts_cold_pitches": boolean|null}`,
      );
      if (ai) {
        info.typicalCheque = ai.typical_cheque || info.typicalCheque;
        info.stages = ai.stages || info.stages;
        info.geographies = ai.geographies || undefined;
        if (ai.accepts_cold_pitches && info.intakeType === "warm intro")
          info.intakeType = "open intake";
      }
      out[normalizeName(name)] = info;
    }),
  );
  return out;
}

// ---------- 5. Rank + report ----------
export function fallbackMessage(p: StartupProfile): string {
  const where = p.country === "Global" ? "" : ` in or near ${p.country}`;
  return `We couldn't verify any company similar to "${p.description}"${where} that raised since ${p.cutoffDate} on a live page, so we stopped rather than keep searching. Try describing the category instead of the product (e.g. "accounting software for small businesses"), choosing an adjacent stage, or setting the country to "Any country".`;
}

export async function buildReport(
  keys: Keys,
  id: string,
  p: StartupProfile,
  deals: VerifiedDeal[],
  extraNotes: string[] = [],
): Promise<Report> {
  const verified = deals.filter(isUsable);
  const notes = [...extraNotes];
  if (!verified.length)
    return {
      id,
      generatedAt: new Date().toISOString(),
      startup: p,
      companies: deals,
      investors: [],
      notes,
      fallback: fallbackMessage(p),
    };

  const aggs = aggregateInvestors(deals);
  // preliminary rank without profiles to decide whom to enrich
  const prelim = rankInvestors(aggs, p, {});
  const profiles = await enrichInvestors(
    keys,
    prelim.slice(0, ENRICH_TOP).map((m) => m.name),
  );
  const investors = rankInvestors(aggs, p, profiles);

  // Optional: AI rewrites the "why" from the computed numbers (no new facts).
  const ai = await aiJson<{ explanations?: Record<string, string> }>(
    keys,
    "You explain investor rankings to a founder. Use only the facts given. One or two sentences each.",
    `Founder startup: ${p.description} (stage ${p.stage}, ${p.country}).\n${investors
      .slice(0, 15)
      .map(
        (i) =>
          `${i.rank}. ${i.name}: score ${i.score.total} ${JSON.stringify(i.score)}; deals: ${i.deals.map((d) => `${d.company} ${d.round ?? ""}${d.led ? " (led)" : ""}`).join(", ")}; stage: ${i.typicalStage}; reach: ${i.reach.type}`,
      )
      .join("\n")}\nReturn {"explanations": {"<investor name>": "why it ranks here"}}`,
  );
  if (ai?.explanations)
    for (const i of investors) {
      const w = ai.explanations[i.name];
      if (w) i.why = w;
    }

  if (verified.length < TARGET_COMPANIES)
    notes.push(
      `${verified.length} similar compan${verified.length === 1 ? "y" : "ies"} verified (we aim for ${TARGET_COMPANIES}+). The search stopped here instead of looping; a broader description or stage will usually find more.`,
    );
  if (!hasAi(keys))
    notes.push("No AI key set: rule-based parsing and templated explanations used.");
  return {
    id,
    generatedAt: new Date().toISOString(),
    startup: p,
    companies: deals,
    investors,
    notes,
  };
}

/**
 * verify -> (discover if short) -> report, for callers that run the whole pipeline in one go
 * (the public API). Cloudflare's free plan allows 50 subrequests per request, so discovery uses
 * the rule-based extractor here instead of one AI call per article (~40 subrequests worst case).
 */
export async function runPipeline(
  keys: Keys,
  id: string,
  p: StartupProfile,
  rows: DealRow[],
): Promise<Report> {
  const v = await verifyDeals(keys, p, rows);
  const d =
    v.deals.filter(isUsable).length < TARGET_COMPANIES
      ? await discoverDeals(keys, p, v.deals, false)
      : { deals: v.deals, notes: [] };
  return buildReport(keys, id, p, d.deals, [...v.notes, ...d.notes]);
}

// ---------- Stateless run id: dataset id + encoded profile ----------
export function encodeRunId(datasetId: string, p: StartupProfile): string {
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(p))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${datasetId}.${b}`;
}
export function decodeRunId(id: string): { datasetId: string; profile: StartupProfile } {
  const [datasetId = "", b = ""] = id.split(".");
  const s = b.replace(/-/g, "+").replace(/_/g, "/");
  const profile = JSON.parse(
    decodeURIComponent(escape(atob(s + "=".repeat((4 - (s.length % 4)) % 4)))),
  );
  return { datasetId, profile };
}
