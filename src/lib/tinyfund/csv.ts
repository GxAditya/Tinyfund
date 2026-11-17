import type { Report } from "./types";

const esc = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function reportToCsv(r: Report): string {
  const header = [
    "rank",
    "investor",
    "score",
    "why",
    "similar_companies",
    "proof_links",
    "lead_partner",
    "lead_partner_source",
    "typical_cheque",
    "typical_stage",
    "reach_type",
    "reach_detail",
    "reach_url",
  ];
  const lines = r.investors.map((i) =>
    [
      i.rank,
      i.name,
      i.score.total,
      i.why,
      i.deals.map((d) => d.company).join(" | "),
      i.deals.map((d) => d.proof_url).join(" | "),
      i.leadPartner ?? "not found",
      i.leadPartnerSource ?? "",
      i.typicalCheque,
      i.typicalStage,
      i.reach.type,
      i.reach.detail,
      i.reach.url ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
