import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api-docs")({
  head: () => ({
    meta: [
      { title: "TinyFund API: investor matches as JSON or CSV" },
      {
        name: "description",
        content: "Start a TinyFund search and fetch ranked investors as JSON or CSV.",
      },
      { property: "og:title", content: "TinyFund API" },
      {
        property: "og:description",
        content: "Start a TinyFund search and fetch ranked investors as JSON or CSV.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ApiDocs,
});

const Code = ({ children }: { children: string }) => (
  <pre className="card-hard mt-3 overflow-x-auto p-4 font-mono text-xs leading-relaxed">
    {children}
  </pre>
);

function ApiDocs() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-5xl font-extrabold">API</h1>
      <p className="mt-4 text-muted-foreground">
        Bring your own keys. Send your TinyFish key as{" "}
        <code className="font-mono">X-TinyFish-Key</code>. Optionally add{" "}
        <code className="font-mono">X-AI-Base-Url</code>,{" "}
        <code className="font-mono">X-AI-Model</code>, <code className="font-mono">X-AI-Key</code>{" "}
        for any OpenAI-compatible model.
      </p>
      <h2 className="mt-10 text-2xl font-bold">1. Start a search</h2>
      <Code>{`curl -X POST $HOST/api/public/search \\
  -H "Content-Type: application/json" \\
  -H "X-TinyFish-Key: $TINYFISH_KEY" \\
  -d '{"description":"Payroll for restaurants","stage":"Seed","country":"Mexico"}'

→ 202 { "id": "<run id>", "status": "populating", "poll": "/api/public/search/<run id>" }`}</Code>
      <h2 className="mt-10 text-2xl font-bold">2. Poll for results</h2>
      <Code>{`curl $HOST/api/public/search/<run id> -H "X-TinyFish-Key: $TINYFISH_KEY"
# ?partial=1  rank with rows found so far
# ?format=csv CSV export`}</Code>
      <h2 className="mt-10 text-2xl font-bold">Response shape</h2>
      <Code>{`{
  "status": "ready",
  "startup": { "description", "sector", "keywords", "stage", "country", "region", "cutoffDate" },
  "companies": [{ "company", "website", "country", "round_stage", "amount_usd", "announce_date",
                  "investors", "lead_investor", "lead_partner", "source_url",
                  "sourceVerified", "verifiedInvestors", "recent", "note",
                  "origin": "tinyset | search" }],
  "investors": [{
    "rank", "name", "why",
    "score": { "similarDeals", "ledDeals", "stageFit", "geoFit", "recency", "accessibility", "total" },
    "deals": [{ "company", "round", "amount_usd", "date", "proof_url", "led", "partner" }],
    "leadPartner", "leadPartnerSource", "typicalCheque", "typicalStage",
    "reach": { "type": "Application form | Open intake | Warm intro", "detail", "url" }
  }],
  "notes": [],
  "fallback": "set (with no investors) when nothing matching the input could be verified"
}`}</Code>
      <p className="mt-6 text-sm text-muted-foreground">
        An investor is only listed when its name appears on a fetched live page that also names the
        company's round within the last 18 months.
      </p>
    </main>
  );
}
