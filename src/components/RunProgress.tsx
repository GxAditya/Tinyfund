import { useEffect, useRef, useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { RunRecord } from "@/lib/tinyfund/store";

type Phase = RunRecord["phase"];
const ACTIVE: Phase[] = ["populating", "verifying", "discovering", "ranking"];

const STEPS = [
  { key: "understand", label: "Understanding your startup" },
  { key: "find", label: "Finding similar companies" },
  { key: "verify", label: "Verifying rounds" },
  { key: "rank", label: "Ranking investors" },
] as const;

const stepOf = (p: Phase) =>
  ({ populating: 1, verifying: 2, discovering: 2, ranking: 3, done: 4, error: -1, cancelled: -1 })[
    p
  ];

interface Props {
  phase: Phase;
  /** step the run stopped at, for error/cancelled */
  stoppedAt?: number;
  companies: string[];
  verified: number;
  target: number;
  cutoff: string;
  startedAt: string;
  datasetStatus?: string;
  onCancel?: () => void;
}

/** What the tool is doing right now, in plain words. Rotates slowly so the user sees progress. */
function activityLines(p: Props): string[] {
  const n = p.companies.length;
  switch (p.phase) {
    case "populating":
      return [
        `TinySet is searching funding news, investor portfolios and founder posts since ${p.cutoff}`,
        n
          ? `${n} similar compan${n === 1 ? "y" : "ies"} found so far`
          : "Looking for startups that do what you do",
        "Keeping only rounds where the investors are named",
        p.datasetStatus === "queued"
          ? "Waiting for a TinySet worker to pick this up"
          : "Checking new results every 15 seconds",
      ];
    case "verifying":
      return [
        `Opening the proof link for each of the ${n} rounds`,
        "Checking the company and every investor are named on the page",
        "Dropping rounds older than 18 months",
      ];
    case "discovering":
      return [
        `${p.verified} of ${p.target} rounds verified, so we're looking for more`,
        "Searching funding news for similar startups (free Search + Fetch)",
        "Reading articles and pulling out rounds and investors",
        "One pass only, then we rank what we have",
      ];
    case "ranking":
      return [
        "Finding each investor's website",
        "Looking for cheque size, stages and pitch forms",
        "Scoring similar deals, stage, country, recency and how to reach them",
      ];
    default:
      return [];
  }
}

function useElapsed(since: string, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function RunProgress(props: Props) {
  const { phase, companies, onCancel } = props;
  const running = ACTIVE.includes(phase);
  const step = running || phase === "done" ? stepOf(phase) : (props.stoppedAt ?? 1);
  const lines = activityLines(props);
  const [lineIdx, setLineIdx] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const elapsed = useElapsed(props.startedAt, running);

  useEffect(() => setLineIdx(0), [phase]);
  useEffect(() => {
    if (!running || lines.length < 2) return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % lines.length), 3600);
    return () => clearInterval(t);
  }, [running, lines.length]);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  // Stagger only the chips that just arrived, not the whole list on every poll.
  const seen = useRef(0);
  const prevSeen = seen.current;
  useEffect(() => {
    seen.current = companies.length;
  }, [companies.length]);

  if (phase === "done") return null;
  const line = lines[lineIdx % Math.max(1, lines.length)];

  return (
    <section className="card-hard overflow-hidden" aria-live="polite">
      <ol className="grid gap-3 p-4 sm:grid-cols-4 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step && running;
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-sm">
              <span className="relative grid size-5 shrink-0 place-items-center">
                {done ? (
                  <span className="pop-in grid size-5 place-items-center rounded-full bg-verified text-white">
                    <Check className="size-3" weight="bold" />
                  </span>
                ) : active ? (
                  <span className="size-2.5 rounded-full bg-foreground" />
                ) : i === step && !running ? (
                  <span className="grid size-5 place-items-center rounded-full border border-destructive text-destructive">
                    <X className="size-3" weight="bold" />
                  </span>
                ) : (
                  <span className="size-2.5 rounded-full border border-border" />
                )}
              </span>
              <span className={done || active ? "text-foreground" : "text-muted-foreground"}>
                {s.label}
                {s.key === "verify" && phase === "discovering" && (
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    + searching for more
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Real progress, one segment per step: finished segments fill, the current one breathes. */}
      <div className="flex gap-1 px-4 pb-4" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s.key} className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={`segment-fill absolute inset-0 rounded-full bg-foreground ${i < step ? "scale-x-100" : "scale-x-0"}`}
            />
            {i === step && running && (
              <span className="breathe absolute inset-0 rounded-full bg-foreground" />
            )}
          </span>
        ))}
      </div>

      {running && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3">
            <p
              key={`${phase}-${lineIdx}`}
              className="activity-in min-w-0 flex-1 text-sm text-muted-foreground"
            >
              {line}
            </p>
            <span
              className="font-mono text-xs tabular-nums text-muted-foreground"
              title="Time since the search started"
            >
              {elapsed}
            </span>
            {onCancel && (
              <Button
                variant={confirming ? "destructive" : "ghost"}
                size="sm"
                onClick={() =>
                  confirming ? (setConfirming(false), onCancel()) : setConfirming(true)
                }
              >
                <X weight="bold" /> {confirming ? "Confirm cancel" : "Cancel run"}
              </Button>
            )}
          </div>
          {companies.length > 0 && (phase === "populating" || phase === "verifying") && (
            <ul
              className="flex flex-wrap gap-1.5 border-t border-border px-4 py-3"
              aria-label="Companies found so far"
            >
              {companies.slice(0, 24).map((c, i) => (
                <li
                  key={c}
                  className="activity-in rounded-full border border-border bg-background px-2.5 py-0.5 text-xs"
                  style={{ animationDelay: `${Math.max(0, Math.min(i - prevSeen, 8)) * 40}ms` }}
                >
                  {c}
                </li>
              ))}
              {companies.length > 24 && (
                <li className="px-1 py-0.5 text-xs text-muted-foreground">
                  +{companies.length - 24} more
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
