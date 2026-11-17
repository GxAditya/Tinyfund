/** "any" is only ever the founder's choice ("any round"); rounds themselves always have a real stage. */
export type Stage = "pre-seed" | "seed" | "series-a" | "series-b" | "growth" | "grant" | "any";

export interface StartupProfile {
  description: string;
  sector: string;
  keywords: string[];
  stage: Stage;
  country: string;
  region: string;
  /** ISO date; only rounds on/after this count as recent */
  cutoffDate: string;
}

export interface Keys {
  tinyfishKey?: string | undefined;
  aiBaseUrl?: string | undefined;
  aiModel?: string | undefined;
  aiKey?: string | undefined;
}

export interface DealRow {
  company: string;
  website?: string | undefined;
  one_liner?: string | undefined;
  country?: string | undefined;
  round_stage?: string | undefined;
  amount_usd?: number | null | undefined;
  announce_date?: string | undefined;
  investors?: string | undefined;
  lead_investor?: string | undefined;
  lead_partner?: string | undefined;
  source_url?: string | undefined;
  similarity_reason?: string | undefined;
}

export interface VerifiedDeal extends DealRow {
  /** source page fetched and company name found on it */
  sourceVerified: boolean;
  /** investor names confirmed on the source page */
  verifiedInvestors: string[];
  recent: boolean;
  note?: string | undefined;
  /** where the row came from: the TinySet dataset or free Search+Fetch discovery */
  origin?: "tinyset" | "search" | undefined;
}

export interface StepResult {
  deals: VerifiedDeal[];
  notes: string[];
}

export interface InvestorProfileInfo {
  website?: string | undefined;
  typicalCheque?: string | undefined;
  stages?: string | undefined;
  geographies?: string | undefined;
  applicationUrl?: string | undefined;
  intakeType?: "application form" | "open intake" | "warm intro" | undefined;
  profileSource?: string | undefined;
}

export interface ScoreBreakdown {
  similarDeals: number;
  ledDeals: number;
  stageFit: number;
  geoFit: number;
  recency: number;
  accessibility: number;
  total: number;
}

export interface InvestorMatch {
  name: string;
  rank: number;
  score: ScoreBreakdown;
  why: string;
  deals: {
    company: string;
    round?: string | undefined;
    amount_usd?: number | null | undefined;
    date?: string | undefined;
    proof_url: string;
    led: boolean;
    partner?: string | undefined;
  }[];
  leadPartner?: string | undefined;
  leadPartnerSource?: string | undefined;
  typicalCheque: string;
  typicalStage: string;
  reach: { type: string; detail: string; url?: string | undefined };
  profile: InvestorProfileInfo;
}

export interface Report {
  id: string;
  generatedAt: string;
  startup: StartupProfile;
  companies: VerifiedDeal[];
  investors: InvestorMatch[];
  notes: string[];
  /** set when nothing matching the founder's input could be verified; shown instead of results */
  fallback?: string | undefined;
}
