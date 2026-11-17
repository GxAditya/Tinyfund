import { regionOf, stageOf } from "./normalize";
import type { Stage, StartupProfile } from "./types";

const STOP = new Set(
  "a an the for and of to in on with by our we is are that this platform startup company app based using pre seed series stage helps help builds building".split(
    " ",
  ),
);

export function cutoffDate(now = new Date(), months = 18): string {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Rule-based fallback when no AI key is configured. */
export function parseStartupRules(
  description: string,
  stage?: string,
  country?: string,
  now = new Date(),
): StartupProfile {
  const st: Stage = /^\s*any\b/i.test(stage ?? "")
    ? "any"
    : ((stageOf(stage) ?? stageOf(description) ?? "seed") as Stage);
  let c = country?.trim() ?? "";
  if (!c) {
    const m = description.match(/\b(?:in|from|based in)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\b/);
    c = m?.[1] ?? "";
    if (!c) {
      const last = description.split(",").pop()?.trim() ?? "";
      if (/^[A-Z][a-zA-Z\s]{2,30}$/.test(last) && !stageOf(last)) c = last;
    }
  }
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && w !== c.toLowerCase());
  const keywords = [...new Set(words)].slice(0, 8);
  return {
    description,
    sector: keywords.slice(0, 3).join(" "),
    keywords,
    stage: st,
    country: c || "Global",
    region: regionOf(c || ""),
    cutoffDate: cutoffDate(now),
  };
}
