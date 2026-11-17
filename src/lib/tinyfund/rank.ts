import { normalizeName, regionOf, splitInvestors, stageDistance, stageOf } from "./normalize";
import type {
  InvestorMatch,
  InvestorProfileInfo,
  ScoreBreakdown,
  StartupProfile,
  VerifiedDeal,
} from "./types";

/** Companies we aim for; below this, free discovery tops up (once, at most two query rounds). */
export const TARGET_COMPANIES = 10;

/** A deal counts only when its live page names the company and an investor, inside the window. */
export const isUsable = (d: VerifiedDeal) =>
  d.sourceVerified && d.recent && d.verifiedInvestors.length > 0;

export interface InvestorAggregate {
  key: string;
  name: string;
  deals: VerifiedDeal[];
  ledDeals: VerifiedDeal[];
}

/** Group deals by investor. Only investor/deal pairs confirmed on a live source page count. */
export function aggregateInvestors(deals: VerifiedDeal[]): InvestorAggregate[] {
  const map = new Map<string, InvestorAggregate>();
  for (const d of deals) {
    if (!d.sourceVerified || !d.source_url || !d.recent) continue;
    const leadKeys = new Set(splitInvestors(d.lead_investor).map(normalizeName));
    for (const inv of d.verifiedInvestors) {
      const key = normalizeName(inv);
      if (!key) continue;
      const agg = map.get(key) ?? { key, name: inv, deals: [], ledDeals: [] };
      if (!agg.deals.some((x) => x.company === d.company)) {
        agg.deals.push(d);
        if (leadKeys.has(key)) agg.ledDeals.push(d);
      }
      if (inv.length > agg.name.length && inv.length < 60) agg.name = inv;
      map.set(key, agg);
    }
  }
  return [...map.values()];
}

function monthsAgo(date?: string, now = new Date()): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / (30.44 * 864e5);
}

export function scoreInvestor(
  agg: InvestorAggregate,
  startup: StartupProfile,
  profile: InvestorProfileInfo = {},
  now = new Date(),
): ScoreBreakdown {
  // Similar verified deals: up to 40 (10 per deal, capped at 4)
  const similarDeals = Math.min(agg.deals.length, 4) * 10;
  // Led at least one similar deal: up to 10
  const ledDeals = Math.min(agg.ledDeals.length, 2) * 5;

  // Stage fit (15): based on stages of their matching deals, plus stated stages
  const dealStages = agg.deals.map((d) => stageOf(d.round_stage)).filter(Boolean) as ReturnType<
    typeof stageOf
  >[];
  const stated = stageOf(profile.stages);
  const stages = [...dealStages, ...(stated ? [stated] : [])];
  let stageFit = 0;
  // Founder is open to any round: stage can't separate investors, so nobody is penalised.
  if (startup.stage === "any") stageFit = 15;
  else if (stages.length) {
    const best = Math.min(...stages.map((s) => stageDistance(s!, startup.stage)));
    stageFit = best === 0 ? 15 : best === 1 ? 8 : 0;
  }

  // Geo fit (15): matching deals in the founder's country / region, or stated geography
  const country = startup.country.toLowerCase();
  const region = regionOf(startup.country);
  let geoFit = 0;
  const geoText = (profile.geographies ?? "").toLowerCase();
  if (country && agg.deals.some((d) => (d.country ?? "").toLowerCase() === country)) geoFit = 15;
  else if (country && geoText.includes(country)) geoFit = 15;
  else if (
    region !== "Global" &&
    (agg.deals.some((d) => regionOf(d.country ?? "") === region) ||
      geoText.includes(region.toLowerCase()))
  )
    geoFit = 9;
  else if (/global|worldwide|anywhere/.test(geoText)) geoFit = 6;

  // Recency (10): most recent matching deal
  const ages = agg.deals
    .map((d) => monthsAgo(d.announce_date, now))
    .filter((x) => x !== null) as number[];
  const freshest = ages.length ? Math.min(...ages) : null;
  const recency = freshest === null ? 0 : freshest <= 6 ? 10 : freshest <= 12 ? 6 : 3;

  // Accessibility (10)
  const accessibility =
    profile.intakeType === "application form" ? 10 : profile.intakeType === "open intake" ? 6 : 0;

  const total = similarDeals + ledDeals + stageFit + geoFit + recency + accessibility;
  return { similarDeals, ledDeals, stageFit, geoFit, recency, accessibility, total };
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

export function observedCheque(agg: InvestorAggregate): string {
  const amts = agg.deals.map((d) => d.amount_usd).filter((x): x is number => !!x && x > 0);
  if (!amts.length) return "not found";
  const lo = Math.min(...amts);
  const hi = Math.max(...amts);
  return `rounds of ${lo === hi ? fmtUsd(lo) : `${fmtUsd(lo)}–${fmtUsd(hi)}`} (round size, not cheque)`;
}

const dealStagesText = (agg: InvestorAggregate) =>
  [...new Set(agg.deals.map((d) => d.round_stage).filter(Boolean))].slice(0, 3).join(", ");

export function templateWhy(
  agg: InvestorAggregate,
  s: ScoreBreakdown,
  startup: StartupProfile,
): string {
  const parts: string[] = [];
  parts.push(
    `Backed ${agg.deals.length} verified similar compan${agg.deals.length === 1 ? "y" : "ies"} (${agg.deals
      .map((d) => d.company)
      .slice(0, 4)
      .join(", ")})`,
  );
  if (agg.ledDeals.length) parts.push(`led ${agg.ledDeals.length} of those rounds`);
  if (startup.stage === "any") {
    if (dealStagesText(agg)) parts.push(`backs ${dealStagesText(agg)} rounds`);
  } else if (s.stageFit === 15) parts.push(`invests at your stage (${startup.stage})`);
  else if (s.stageFit === 8) parts.push(`invests one stage away from ${startup.stage}`);
  else parts.push(`stage fit for ${startup.stage} is unconfirmed`);
  if (s.geoFit === 15) parts.push(`active in ${startup.country}`);
  else if (s.geoFit === 9) parts.push(`active in ${regionOf(startup.country)}`);
  if (s.recency === 10) parts.push("deployed in the last 6 months");
  if (s.accessibility === 10) parts.push("takes applications directly");
  return parts.join("; ") + ".";
}

export function reachFor(agg: InvestorAggregate, p: InvestorProfileInfo): InvestorMatch["reach"] {
  if (p.intakeType === "application form" && p.applicationUrl)
    return {
      type: "Application form",
      detail: "Submit through their pitch form",
      url: p.applicationUrl,
    };
  if (p.intakeType === "open intake")
    return {
      type: "Open intake",
      detail: "Accepts cold pitches via their site/contact",
      url: p.applicationUrl ?? p.website,
    };
  const d = agg.deals[0];
  return {
    type: "Warm intro",
    detail: `Ask the founders of ${agg.deals
      .map((x) => x.company)
      .slice(0, 3)
      .join(" or ")} (portfolio) for an intro`,
    url: d?.website,
  };
}

export function rankInvestors(
  aggs: InvestorAggregate[],
  startup: StartupProfile,
  profiles: Record<string, InvestorProfileInfo>,
  now = new Date(),
): InvestorMatch[] {
  const rows = aggs.map((agg) => {
    const profile = profiles[agg.key] ?? {};
    const score = scoreInvestor(agg, startup, profile, now);
    // The partner named for a round belongs to the firm that led it, so only led rounds count.
    const partnerDeal = agg.ledDeals.find((d) => d.lead_partner);
    const dealStages = [...new Set(agg.deals.map((d) => d.round_stage).filter(Boolean))].join(", ");
    return {
      name: agg.name,
      rank: 0,
      score,
      why: templateWhy(agg, score, startup),
      deals: agg.deals.map((d) => ({
        company: d.company,
        round: d.round_stage,
        amount_usd: d.amount_usd,
        date: d.announce_date,
        proof_url: d.source_url!,
        led: agg.ledDeals.includes(d),
        partner: agg.ledDeals.includes(d) ? d.lead_partner || undefined : undefined,
      })),
      leadPartner: partnerDeal?.lead_partner || undefined,
      leadPartnerSource: partnerDeal?.source_url,
      typicalCheque: profile.typicalCheque || observedCheque(agg),
      typicalStage: profile.stages || dealStages || "not found",
      reach: reachFor(agg, profile),
      profile,
    } satisfies InvestorMatch;
  });
  rows.sort(
    (a, b) =>
      b.score.total - a.score.total ||
      b.deals.length - a.deals.length ||
      a.name.localeCompare(b.name),
  );
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}
