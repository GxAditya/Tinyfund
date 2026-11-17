import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  CircleNotch,
  Crosshair,
  Globe,
  MagnifyingGlass,
  Play,
  ShieldCheck,
  Trophy,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { startSearch } from "@/lib/tinyfund/functions";
import { loadKeys, saveRun } from "@/lib/tinyfund/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TinyFund: find the investors who'd actually fund you" },
      {
        name: "description",
        content:
          "Describe your startup in one line. Get a ranked investor list backed by live proof of similar deals.",
      },
      { property: "og:title", content: "TinyFund: find the investors who'd actually fund you" },
      {
        property: "og:description",
        content:
          "Ranked investors with proof links, cheque sizes, lead partners and how to reach them.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const DEMOS = [
  {
    description: "AI-powered bookkeeping and GST compliance for small businesses",
    stage: "Pre-seed",
    country: "India",
  },
  {
    description: "Open-source observability and tracing for LLM applications",
    stage: "Seed",
    country: "United States",
  },
  {
    description: "Battery recycling that recovers lithium from EV batteries",
    stage: "Series A",
    country: "Germany",
  },
  {
    description: "Embedded insurance API for e-commerce marketplaces",
    stage: "Seed",
    country: "Brazil",
  },
];

const STAGES = ["Any stage", "Pre-seed", "Seed", "Series A", "Series B", "Growth", "Grant"];

function Index() {
  const navigate = useNavigate();
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState("Seed");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  async function go(d = description, s = stage, c = country): Promise<unknown> {
    const keys = loadKeys();
    if (!keys.tinyfishKey) return toast.error("Add your TinyFish API key first (Keys, top right).");
    if (d.trim().length < 5) return toast.error("Describe your startup in a sentence.");
    setBusy(true);
    try {
      const res = await startSearch({
        data: { description: d, stage: s, country: c || undefined, keys },
      });
      saveRun({
        id: res.id,
        datasetId: res.datasetId,
        createdAt: new Date().toISOString(),
        profile: res.profile,
        phase: "populating",
        deals: [],
      });
      navigate({ to: "/run/$datasetId", params: { datasetId: res.datasetId } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return (
    <main className="mx-auto max-w-5xl px-5 pb-24 md:px-8">
      <section className="py-16 text-center md:py-24">
        <h1 className="whitespace-nowrap text-[clamp(1.75rem,6vw,4.5rem)]">
          Who would actually fund you?
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
          Describe your startup in one line. TinyFund finds similar companies that raised recently,
          verifies every round against a live source, and ranks the investors behind them.
        </p>
      </section>

      <form
        className="card-hard p-6 md:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <div className="flex items-center gap-3 rounded-lg border border-input bg-card px-4 focus-within:border-foreground">
          <MagnifyingGlass className="size-5 shrink-0 text-muted-foreground" weight="bold" />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Your startup in one line, e.g. Payroll software for restaurants"
            className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setStage(s)}
                aria-pressed={stage === s}
                title={
                  s === "Any stage"
                    ? "Look at every round type, from pre-seed to growth and grants"
                    : undefined
                }
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${stage === s ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-secondary"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-card px-3">
            <Globe className="size-4 text-muted-foreground" weight="bold" />
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Any country"
              className="w-32 bg-transparent text-sm outline-none"
            />
          </div>
          <Button type="submit" size="lg" className="ml-auto" disabled={busy}>
            {busy ? (
              <CircleNotch className="animate-spin" weight="bold" />
            ) : (
              <ArrowRight weight="bold" />
            )}{" "}
            Find investors
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Research runs live for about 5–20 minutes. Your search appears in the side panel so you
          can come back anytime.
        </p>
      </form>

      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={() => setDemoOpen(true)} disabled={busy}>
          <Play weight="bold" /> Try a demo run
        </Button>
      </div>

      <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">Pick a demo startup</DialogTitle>
            <DialogDescription>
              Choose one and the research run starts right away.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {DEMOS.map((d) => (
              <button
                key={d.description}
                disabled={busy}
                onClick={() => {
                  setDescription(d.description);
                  setStage(d.stage);
                  setCountry(d.country);
                  setDemoOpen(false);
                  go(d.description, d.stage, d.country);
                }}
                className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground"
              >
                <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                  {d.stage} · {d.country}
                </span>
                <p className="mt-2 text-sm leading-relaxed">{d.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                  Run it <ArrowRight className="size-3" weight="bold" />
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <section className="mt-16">
        <h2 className="text-center text-2xl">How it works</h2>
        <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-6">
          {[
            {
              icon: Crosshair,
              t: "Find look-alikes",
              d: "Finds 10+ similar companies that raised recently, from live news, investor sites and grant portals.",
            },
            {
              icon: ShieldCheck,
              t: "Verify every round",
              d: "Each proof link is opened live; investors not named on it are dropped.",
            },
            {
              icon: Trophy,
              t: "Rank for you",
              d: "Scored on similar deals, stage, country, recency and ease of reach.",
            },
          ].map(({ icon: Icon, t, d }, idx, arr) => (
            <li key={t} className="relative flex flex-col items-center text-center">
              {idx < arr.length - 1 && (
                <span
                  aria-hidden
                  className="timeline-line absolute top-[18px] hidden h-px overflow-visible bg-border md:block"
                  style={{ left: "calc(50% + 26px)", width: "calc(100% + 1.5rem - 52px)" }}
                >
                  <span className="timeline-glow" style={{ animationDelay: `${idx * 3}s` }} />
                </span>
              )}
              <span className="grid size-9 place-items-center rounded-md border border-border bg-card text-foreground">
                <Icon className="size-4" weight="bold" />
              </span>
              <p className="mt-4 text-sm font-semibold">
                <span className="mr-2 font-mono text-xs text-muted-foreground">0{idx + 1}</span>
                {t}
              </p>
              <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
