import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Check, DownloadSimple, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  cancelSearch,
  discoverSearch,
  pollSearch,
  reportSearch,
  verifySearch,
} from "@/lib/tinyfund/functions";
import { isUsable, TARGET_COMPANIES } from "@/lib/tinyfund/rank";
import { stageLabel } from "@/lib/tinyfund/normalize";
import { RunProgress } from "@/components/RunProgress";
import { download, getRun, loadKeys, saveRun, type RunRecord } from "@/lib/tinyfund/store";
import { reportToCsv } from "@/lib/tinyfund/csv";
import type { InvestorMatch } from "@/lib/tinyfund/types";

export const Route = createFileRoute("/run/$datasetId")({
  head: () => ({
    meta: [
      { title: "Investor shortlist | TinyFund" },
      { name: "description", content: "Ranked investors with proof links for every similar deal." },
      { property: "og:title", content: "Investor shortlist | TinyFund" },
      {
        property: "og:description",
        content: "Ranked investors with proof links for every similar deal.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RunPage,
});

const stepOf = (p?: RunRecord["phase"]) =>
  p
    ? { populating: 1, verifying: 2, discovering: 2, ranking: 3, done: 4, error: 1, cancelled: 1 }[
        p
      ]
    : 1;
const POLL_MS = 15_000;
/** After this, the TinySet run is cancelled (no more rows billed) and we rank what it found. */
const MAX_WAIT_MS = 20 * 60_000;
/** Consecutive failed polls before we stop polling and show the error. */
const MAX_POLL_ERRORS = 4;

const fmt = (n?: number | null) =>
  !n
    ? "-"
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
      : n >= 1e3
        ? `$${Math.round(n / 1e3)}K`
        : `$${n}`;

function RunPage() {
  const { datasetId } = Route.useParams();
  const [run, setRun] = useState<RunRecord | null | undefined>(undefined);
  const [dsStatus, setDsStatus] = useState<string>("");
  const busy = useRef(false);
  const latest = useRef<RunRecord | null>(null);
  const cancelled = useRef(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const r = getRun(datasetId) ?? null;
    latest.current = r;
    setRun(r);
  }, [datasetId]);
  const update = (r: RunRecord) => {
    latest.current = r;
    saveRun(r);
    setRun({ ...r });
  };

  // verify -> (free discovery, once, only if short) -> rank. Runs once per call; a failure ends in
  // the error state instead of going back to polling, so nothing re-triggers on its own.
  const finish = useCallback(async (r: RunRecord, warning?: string) => {
    if (busy.current) return;
    busy.current = true;
    cancelled.current = false;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const { signal } = ctrl;
    const keys = loadKeys();
    try {
      update({ ...r, phase: "verifying", error: undefined });
      const v = await verifySearch({ data: { profile: r.profile, deals: r.deals, keys }, signal });
      if (cancelled.current) return;
      let deals = v.deals;
      const notes = [...(warning ? [warning] : []), ...v.notes];
      if (deals.filter(isUsable).length < TARGET_COMPANIES) {
        update({ ...r, phase: "discovering", verified: deals });
        const d = await discoverSearch({ data: { profile: r.profile, deals, keys }, signal });
        if (cancelled.current) return;
        deals = d.deals;
        notes.push(...d.notes);
      }
      update({ ...r, phase: "ranking", verified: deals });
      const report = await reportSearch({
        data: { id: r.id, profile: r.profile, deals, notes, keys },
        signal,
      });
      if (cancelled.current) return;
      update({ ...r, phase: "done", verified: deals, report });
    } catch (e) {
      if (cancelled.current) return;
      toast.error((e as Error).message);
      update({
        ...r,
        phase: "error",
        stoppedFrom: latest.current?.phase,
        error: (e as Error).message,
      });
    } finally {
      busy.current = false;
      abort.current = null;
    }
  }, []);

  // Stops everything: the TinySet run (so it bills no more rows) and any in-flight step.
  const cancelRun = useCallback(async () => {
    const cur = latest.current;
    if (!cur) return;
    cancelled.current = true;
    abort.current?.abort();
    update({ ...cur, phase: "cancelled", stoppedFrom: cur.phase, error: undefined });
    try {
      const r = await cancelSearch({ data: { datasetId, keys: loadKeys() } });
      toast.success(
        r.cancelled
          ? "Run cancelled. TinySet stopped, so no more rows will be billed."
          : "Run cancelled. TinySet had already finished, so nothing more is billed.",
      );
    } catch (e) {
      toast.error(`Stopped here, but TinySet couldn't be cancelled: ${(e as Error).message}`);
    }
  }, [datasetId]);

  useEffect(() => {
    if (!run || run.phase !== "populating") return;
    let stop = false;
    let errors = 0;
    const tick = async () => {
      try {
        const keys = loadKeys();
        const res = await pollSearch({ data: { datasetId, keys } });
        if (stop || cancelled.current) return;
        errors = 0;
        setDsStatus(res.runStatus ?? res.status);
        const next = { ...run, deals: res.deals };
        if (!res.inProgress) {
          stop = true;
          const warning =
            res.status === "failed"
              ? `TinySet run failed (${res.error ?? "unknown error"}); continued with free Search + Fetch.`
              : res.status === "cancelled"
                ? "TinySet run was cancelled; ranked with the rows it had."
                : undefined;
          return finish(next, warning);
        }
        if (Date.now() - Date.parse(run.createdAt) > MAX_WAIT_MS) {
          stop = true;
          await cancelSearch({ data: { datasetId, keys } }).catch(() => undefined);
          return finish(
            next,
            "TinySet was still running after 20 minutes, so it was stopped (no more rows billed) and we ranked what it had found.",
          );
        }
        saveRun(next);
        setRun((cur) => (cur ? { ...cur, deals: res.deals } : cur));
      } catch (e) {
        console.error(e);
        if (++errors >= MAX_POLL_ERRORS && !stop) {
          stop = true;
          update({
            ...run,
            phase: "error",
            stoppedFrom: "populating",
            error: `Couldn't reach TinySet after ${MAX_POLL_ERRORS} tries: ${(e as Error).message}`,
          });
        }
      }
    };
    tick();
    const t = setInterval(() => !stop && tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.phase, datasetId]);

  if (run === undefined) return null;
  if (run === null)
    return (
      <main className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h1 className="text-3xl font-bold">Search not found in this browser</h1>
        <p className="mt-3 text-muted-foreground">
          Results are saved locally. Use the API to fetch it from anywhere.
        </p>
        <Link to="/" className="mt-6 inline-block text-primary underline">
          Start a new search
        </Link>
      </main>
    );

  const report = run.report;
  const companies = (run.verified ?? run.deals).map((d) => d.company);
  const verifiedCount = (run.verified ?? []).filter(isUsable).length;
  const apiUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/public/search/${run.id}` : "";

  return (
    <main className="mx-auto max-w-6xl px-5 pb-24 md:px-8">
      <section className="py-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Investor shortlist
        </p>
        <h1 className="mt-2 text-4xl md:text-5xl">{run.profile.description}</h1>
        <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
          {[
            `sector: ${run.profile.sector}`,
            `stage: ${stageLabel(run.profile.stage)}`,
            `country: ${run.profile.country}`,
            `region: ${run.profile.region}`,
            `rounds since ${run.profile.cutoffDate}`,
          ].map((t) => (
            <span key={t} className="rounded-full border border-border bg-card px-3 py-1">
              {t}
            </span>
          ))}
          {run.profile.keywords.map((k) => (
            <span key={k} className="font-mono text-xs text-muted-foreground">
              {k}
            </span>
          ))}
        </div>
      </section>

      <RunProgress
        phase={run.phase}
        stoppedAt={stepOf(run.stoppedFrom)}
        companies={companies}
        verified={verifiedCount}
        target={TARGET_COMPANIES}
        cutoff={run.profile.cutoffDate}
        startedAt={run.createdAt}
        datasetStatus={dsStatus}
        onCancel={cancelRun}
      />

      {run.phase === "populating" && run.deals.length >= 3 && (
        <div className="activity-in mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>Don't want to wait?</span>
          <Button variant="outline" size="sm" onClick={() => finish(run)}>
            Rank the {run.deals.length} found so far
          </Button>
        </div>
      )}

      {run.phase === "error" && (
        <div className="activity-in mt-4 flex flex-wrap items-center gap-3">
          <p className="text-destructive">{run.error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => update({ ...run, phase: "populating", error: undefined })}
          >
            Try again
          </Button>
        </div>
      )}

      {run.phase === "cancelled" && (
        <div className="activity-in card-hard mt-4 p-5">
          <h2 className="text-xl">Run cancelled</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            TinySet was stopped, so no more rows are billed.{" "}
            {run.deals.length
              ? `The ${run.deals.length} compan${run.deals.length === 1 ? "y" : "ies"} it already found are kept.`
              : "It hadn't found any companies yet."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {run.deals.length > 0 && (
              <Button size="sm" onClick={() => finish(run)}>
                Rank the {run.deals.length} found
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/">New search</Link>
            </Button>
          </div>
        </div>
      )}

      {report && (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              onClick={() =>
                download("tinyfund.json", JSON.stringify(report, null, 2), "application/json")
              }
            >
              <DownloadSimple weight="bold" /> JSON
            </Button>
            <Button
              variant="outline"
              onClick={() => download("tinyfund.csv", reportToCsv(report), "text/csv")}
            >
              <DownloadSimple weight="bold" /> CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(apiUrl);
                toast.success("API link copied (send your X-TinyFish-Key header)");
              }}
            >
              Copy API link
            </Button>
            <Button
              variant="ghost"
              onClick={() => update({ ...run, phase: "populating", report: undefined })}
            >
              Refresh
            </Button>
          </div>
          {report.notes.map((n) => (
            <p key={n} className="mt-3 font-mono text-xs text-muted-foreground">
              ※ {n}
            </p>
          ))}

          {report.fallback ? (
            <div className="card-hard mt-10 p-6">
              <h2 className="text-2xl">No matching rounds found</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{report.fallback}</p>
              <Link to="/" className="mt-4 inline-block text-sm underline underline-offset-2">
                Start a new search
              </Link>
            </div>
          ) : (
            <h2 className="mt-12 text-3xl">Ranked investors</h2>
          )}
          {!report.fallback && report.investors.length === 0 && (
            <p className="mt-3 text-muted-foreground">
              No investor could be verified against a live source.
            </p>
          )}
          <div className="mt-6 space-y-6">
            {report.investors.map((i) => (
              <InvestorCard key={i.name} i={i} />
            ))}
          </div>
        </>
      )}

      {(run.verified ?? run.deals).length > 0 && (
        <section className="mt-14">
          <h2 className="text-3xl">Similar companies that raised</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="font-mono text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  {["Company", "Country", "Round", "Amount", "Date", "Investors", "Proof"].map(
                    (h) => (
                      <th key={h} className="px-2 py-2 text-left font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(run.verified ?? run.deals).map((d) => {
                  const v =
                    "sourceVerified" in d
                      ? (d as import("@/lib/tinyfund/types").VerifiedDeal)
                      : null;
                  return (
                    <tr key={d.company} className="border-b border-border align-top">
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          {d.website ? (
                            <a
                              href={d.website}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:text-primary"
                            >
                              {d.company}
                            </a>
                          ) : (
                            d.company
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{d.one_liner}</div>
                      </td>
                      <td className="px-2 py-2">{d.country ?? "-"}</td>
                      <td className="px-2 py-2">{d.round_stage ?? "-"}</td>
                      <td className="px-2 py-2 font-mono">{fmt(d.amount_usd)}</td>
                      <td className="px-2 py-2 font-mono">{d.announce_date ?? "-"}</td>
                      <td className="px-2 py-2 text-xs">{d.investors}</td>
                      <td className="px-2 py-2">
                        {d.source_url && (
                          <a
                            href={d.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            link <ArrowSquareOut className="size-3" weight="bold" />
                          </a>
                        )}
                        {v && (
                          <div
                            className={`mt-1 flex items-center gap-1 font-mono text-[10px] ${v.sourceVerified && v.recent ? "text-verified" : "text-destructive"}`}
                            title={v.note}
                          >
                            {v.sourceVerified && v.recent ? (
                              <Check className="size-3" />
                            ) : (
                              <X className="size-3" />
                            )}
                            {isUsable(v)
                              ? v.origin === "search"
                                ? "verified · via Search"
                                : "verified"
                              : (v.note ?? "unverified")}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function InvestorCard({ i }: { i: InvestorMatch }) {
  const parts: [string, number, number][] = [
    ["Similar deals", i.score.similarDeals, 40],
    ["Led rounds", i.score.ledDeals, 10],
    ["Stage fit", i.score.stageFit, 15],
    ["Geo fit", i.score.geoFit, 15],
    ["Recency", i.score.recency, 10],
    ["Reachable", i.score.accessibility, 10],
  ];
  return (
    <article className="card-hard fade-up grid gap-6 p-6 md:grid-cols-[auto_1fr_260px]">
      <div className="font-display text-6xl leading-none text-muted-foreground/40">
        {String(i.rank).padStart(2, "0")}
      </div>
      <div>
        <h3 className="text-2xl">{i.name}</h3>
        <p className="mt-2 text-sm">{i.why}</p>
        <ul className="mt-4 space-y-1 text-sm">
          {i.deals.map((d) => (
            <li key={d.company} className="flex flex-wrap items-baseline gap-2">
              <Check className="size-3 text-verified" weight="bold" />
              <span className="font-medium">{d.company}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {[d.round, fmt(d.amount_usd), d.date].filter(Boolean).join(" · ")}
              </span>
              {d.led && (
                <span className="font-mono text-xs font-medium uppercase text-verified">led</span>
              )}
              <a
                href={d.proof_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
              >
                proof <ArrowSquareOut className="size-3" weight="bold" />
              </a>
            </li>
          ))}
        </ul>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-mono text-xs uppercase text-muted-foreground">Typical cheque</dt>
            <dd>{i.typicalCheque}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase text-muted-foreground">Stage</dt>
            <dd>{i.typicalStage}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase text-muted-foreground">Lead partner</dt>
            <dd>
              {i.leadPartner ?? "not found"}
              {i.leadPartner && i.leadPartnerSource && (
                <a
                  href={i.leadPartnerSource}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-xs underline underline-offset-2"
                >
                  source
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase text-muted-foreground">
              How to reach: {i.reach.type}
            </dt>
            <dd>
              {i.reach.url ? (
                <a
                  href={i.reach.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {i.reach.detail}
                </a>
              ) : (
                i.reach.detail
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-xs uppercase">Fit score</span>
          <span className="font-display text-3xl">{i.score.total}</span>
        </div>
        <div className="mt-3 space-y-2">
          {parts.map(([label, v, max]) => (
            <div key={label}>
              <div className="flex justify-between font-mono text-[11px]">
                <span>{label}</span>
                <span>
                  {v}/{max}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${(v / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
