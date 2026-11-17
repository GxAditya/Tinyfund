import { describe, expect, it } from "vitest";
import {
  companyFromHeadline,
  dealFromArticle,
  investorsFromText,
  partnerFor,
  usdAmount,
} from "./extract";
import { leadFromInvestors, stagesFromText, textMentions } from "./normalize";

describe("name matching", () => {
  it("requires the whole firm name, not a common first word", () => {
    expect(
      textMentions("The general manager said the catalyst was growth.", "General Catalyst"),
    ).toBe(false);
    expect(textMentions("The round was led by General Catalyst.", "General Catalyst")).toBe(true);
  });
  it("needs a single-word firm to appear as a proper noun", () => {
    expect(textMentions("Rapid elevation of prices hurt sales.", "Elevation Capital")).toBe(false);
    expect(textMentions("Backed by Elevation and others.", "Elevation Capital")).toBe(true);
  });
  it("ignores suffixes like Ventures / Capital on either side", () => {
    expect(textMentions("Sequoia Capital India joined.", "Sequoia India")).toBe(true);
  });
});

describe("headline + article extraction", () => {
  it("pulls the company out of descriptive headlines", () => {
    expect(
      companyFromHeadline("Brazilian fintech Acme Pay raises $5M seed round - TechCrunch"),
    ).toBe("Acme Pay");
    expect(companyFromHeadline("Indian Fintech Startup Zolo Raises $3 Million")).toBe("Zolo");
    expect(companyFromHeadline("Ledgerly, a bookkeeping startup, secures seed funding")).toBe(
      "Ledgerly",
    );
    expect(companyFromHeadline("Why founders should care about seed rounds")).toBeUndefined();
  });

  it("reads USD amounts only", () => {
    expect(usdAmount("raises $5M")).toBe(5_000_000);
    expect(usdAmount("a US$1.5 million round")).toBe(1_500_000);
    expect(usdAmount("$1,250,000 in funding")).toBe(1_250_000);
    expect(usdAmount("raises €4M")).toBeUndefined();
  });

  it("finds investors and the lead", () => {
    const r = investorsFromText(
      "Acme raised $5M in a seed round led by [Kaszek](https://kaszek.com), with participation from Y Combinator and Canary. The company was founded in 2023.",
    );
    expect(r.lead).toBe("Kaszek");
    expect([...r.investors].sort()).toEqual(["Canary", "Kaszek", "Y Combinator"]);
  });

  it("keeps every co-lead and strips location prefixes (real Tech.eu / Mint phrasing)", () => {
    expect(
      investorsFromText(
        "raised the funds in a round co-led by Elaia and LEA Ventures, with participation from Seedcamp.",
      ).lead,
    ).toBe("Elaia; LEA Ventures");
    expect(
      investorsFromText(
        "saw participation from Micromax, New York-based Gaingels, and angel investors.",
      ).investors,
    ).toEqual(["Micromax", "Gaingels"]);
  });

  it("only credits a partner to the firm they work at", () => {
    const text = '"We love this team," said Maria Silva, partner at Kaszek.';
    expect(partnerFor(text, "Kaszek")).toBe("Maria Silva");
    expect(partnerFor(text, "Canary")).toBeUndefined();
  });

  it("returns nothing when no investor is named", () => {
    expect(
      dealFromArticle({ url: "u", title: "Acme raises $5M", text: "Acme raised money to grow." }),
    ).toBeUndefined();
  });

  it("builds a deal from a typical article", () => {
    const d = dealFromArticle({
      url: "https://news.example/acme",
      title: "Acme raises $5M seed round to automate bookkeeping",
      text: "Acme, a bookkeeping startup, raised a $5M seed round led by Kaszek with participation from Canary.",
      date: "2026-09-01T10:00:00Z",
    });
    expect(d).toMatchObject({
      company: "Acme",
      round_stage: "Seed",
      amount_usd: 5_000_000,
      announce_date: "2026-09-01",
      lead_investor: "Kaszek",
    });
  });
});

describe("TinySet helpers", () => {
  it("reads the lead marker from the investors column", () => {
    expect(leadFromInvestors("Accel (lead); Y Combinator")).toBe("Accel");
    expect(leadFromInvestors("Accel; Y Combinator")).toBeUndefined();
  });
  it("reads stages only from investing context", () => {
    expect(stagesFromText("We invest at pre-seed and seed in Europe.")).toBe("Pre-seed, Seed");
    expect(stagesFromText("Plant a seed today.")).toBeUndefined();
  });
});
