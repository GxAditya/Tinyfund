import { describe, expect, it } from "vitest";
import { aggregateInvestors, rankInvestors, scoreInvestor } from "./rank";
import { parseStartupRules } from "./parse";
import type { VerifiedDeal } from "./types";

const now = new Date("2026-11-07");
const startup = parseStartupRules("AI bookkeeping for SMBs", "Seed", "Brazil", now);

const deal = (o: Partial<VerifiedDeal>): VerifiedDeal => ({
  company: "X",
  source_url: "https://news.example/x",
  sourceVerified: true,
  verifiedInvestors: [],
  recent: true,
  ...o,
});

describe("ranking rules", () => {
  it("excludes investors whose deal has no verified live link", () => {
    const aggs = aggregateInvestors([
      deal({ company: "A", sourceVerified: false, verifiedInvestors: ["Fund One"] }),
      deal({ company: "B", source_url: undefined, verifiedInvestors: ["Fund Two"] }),
      deal({ company: "C", verifiedInvestors: ["Fund Three"] }),
    ]);
    expect(aggs.map((a) => a.name)).toEqual(["Fund Three"]);
  });

  it("excludes rounds older than the 18-month window", () => {
    expect(
      aggregateInvestors([deal({ recent: false, verifiedInvestors: ["Old VC"] })]),
    ).toHaveLength(0);
  });

  it("ranks a local, same-stage investor with more similar deals above a generic one", () => {
    const deals = [
      deal({
        company: "A",
        country: "Brazil",
        round_stage: "Seed",
        announce_date: "2026-08-01",
        verifiedInvestors: ["Local VC", "Big VC"],
        lead_investor: "Local VC",
      }),
      deal({
        company: "B",
        country: "Brazil",
        round_stage: "Seed",
        announce_date: "2026-05-01",
        verifiedInvestors: ["Local VC"],
      }),
      deal({
        company: "C",
        country: "United States",
        round_stage: "Series B",
        announce_date: "2025-08-01",
        verifiedInvestors: ["Big VC"],
      }),
    ];
    const ranked = rankInvestors(aggregateInvestors(deals), startup, {}, now);
    expect(ranked[0]!.name).toBe("Local VC");
    expect(ranked[0]!.score.geoFit).toBe(15);
    expect(ranked[0]!.score.stageFit).toBe(15);
  });

  it("gives 10 points for an open application form", () => {
    const [agg] = aggregateInvestors([deal({ verifiedInvestors: ["Form VC"] })]);
    expect(
      scoreInvestor(agg!, startup, { intakeType: "application form" }, now).accessibility,
    ).toBe(10);
  });

  it("credits the lead partner only to the firm that led the round", () => {
    const deals = [
      deal({
        company: "A",
        verifiedInvestors: ["Lead VC", "Co VC"],
        lead_investor: "Lead VC",
        lead_partner: "Jane Doe",
      }),
    ];
    const ranked = rankInvestors(aggregateInvestors(deals), startup, {}, now);
    expect(ranked.find((r) => r.name === "Lead VC")!.leadPartner).toBe("Jane Doe");
    expect(ranked.find((r) => r.name === "Co VC")!.leadPartner).toBeUndefined();
  });

  it("uses an 18-month cutoff", () => {
    expect(startup.cutoffDate).toBe("2025-05-07");
  });
});
