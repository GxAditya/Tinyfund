import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-TinyFish-Key, X-AI-Key, X-AI-Base-Url, X-AI-Model",
};

const body = z.object({
  description: z.string().min(5).max(1000),
  stage: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
});

export const Route = createFileRoute("/api/public/search")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const tinyfishKey = request.headers.get("x-tinyfish-key") ?? undefined;
        if (!tinyfishKey) return Response.json({ error: "X-TinyFish-Key header required" }, { status: 401, headers: CORS });
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: z.flattenError(parsed.error) }, { status: 400, headers: CORS });
        const keys = {
          tinyfishKey,
          aiKey: request.headers.get("x-ai-key") ?? undefined,
          aiBaseUrl: request.headers.get("x-ai-base-url") ?? undefined,
          aiModel: request.headers.get("x-ai-model") ?? undefined,
        };
        try {
          const { parseStartup, createDealDataset, encodeRunId } = await import("@/lib/tinyfund/pipeline.server");
          const profile = await parseStartup(keys, parsed.data.description, parsed.data.stage, parsed.data.country);
          const datasetId = await createDealDataset(keys, profile);
          const id = encodeRunId(datasetId, profile);
          return Response.json(
            { id, status: "populating", poll: `/api/public/search/${id}`, startup: profile },
            { status: 202, headers: CORS },
          );
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502, headers: CORS });
        }
      },
    },
  },
});
