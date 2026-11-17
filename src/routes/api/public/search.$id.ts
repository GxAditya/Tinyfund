import { createFileRoute } from "@tanstack/react-router";
import type { Report } from "@/lib/tinyfund/types";

// Best-effort, per-instance cache so clients polling a finished run don't re-run Search/Fetch
// (and burn the free rate limit) on every request. Keyed by row count, so new rows recompute.
const CACHE_MS = 60 * 60_000;
const reports = new Map<string, { at: number; report: Report }>();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "X-TinyFish-Key, X-AI-Key, X-AI-Base-Url, X-AI-Model",
};

export const Route = createFileRoute("/api/public/search/$id")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request, params }) => {
        const tinyfishKey = request.headers.get("x-tinyfish-key") ?? undefined;
        if (!tinyfishKey)
          return Response.json(
            { error: "X-TinyFish-Key header required" },
            { status: 401, headers: CORS },
          );
        const url = new URL(request.url);
        const format = url.searchParams.get("format");
        const force = url.searchParams.get("partial") === "1";
        const keys = {
          tinyfishKey,
          aiKey: request.headers.get("x-ai-key") ?? undefined,
          aiBaseUrl: request.headers.get("x-ai-base-url") ?? undefined,
          aiModel: request.headers.get("x-ai-model") ?? undefined,
        };
        try {
          const m = await import("@/lib/tinyfund/pipeline.server");
          const { datasetId, profile } = m.decodeRunId(params.id);
          // Always read the dataset first: it's free and proves this key owns the run before any cache hit.
          const ds = await m.getDataset(keys, datasetId);
          const running = ds.inProgress;
          if (running && !force)
            return Response.json(
              {
                id: params.id,
                status: "populating",
                rows_so_far: ds.deals.length,
                hint: "Poll again, or add ?partial=1",
              },
              { headers: CORS },
            );
          const cacheKey = `${params.id}:${ds.deals.length}:${running}`;
          const hit = reports.get(cacheKey);
          const fresh = hit && Date.now() - hit.at < CACHE_MS ? hit.report : undefined;
          const report = fresh ?? (await m.runPipeline(keys, params.id, profile, ds.deals));
          if (!fresh) {
            reports.delete(cacheKey);
            if (reports.size > 200) reports.delete(reports.keys().next().value!);
            reports.set(cacheKey, { at: Date.now(), report });
          }
          if (format === "csv") {
            const { reportToCsv } = await import("@/lib/tinyfund/csv");
            return new Response(reportToCsv(report), {
              headers: {
                ...CORS,
                "Content-Type": "text/csv",
                "Content-Disposition": "attachment; filename=tinyfund.csv",
              },
            });
          }
          return Response.json(
            { status: running ? "partial" : "ready", ...report },
            { headers: CORS },
          );
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502, headers: CORS });
        }
      },
    },
  },
});
