## TinyFund rules
- No hosted backend or bundled AI: keys are BYOK (browser localStorage, sent per request; server env TINYFISH_API_KEY fallback). User requirement.
- Pipeline lives in src/lib/tinyfund/pipeline.server.ts (TinySet dataset -> Fetch verify -> free Search/Fetch discovery if <10 -> Search/Fetch enrich -> rank); ranking is pure in rank.ts, article extraction pure in extract.ts.
- Cost rules (user requirement): TinySet is the only paid call (DEAL_ROWS=15 rows, $0.10 each). Search/Fetch are free but rate-limited: every step has a `Budget`, batches Fetch 10 URLs per call, and stops on the first limit error: no retries, no loops. Never call the Agent API to read pages; use it only for tasks that must fill/submit a form or type into a site (none today).
- TinySet specs allow at most 10 columns; the lead investor is marked inside `investors` as "Name (lead)".
- Testing: never make paid TinyFish calls (TinySet, Agent); the user tests those manually. Only Search and Fetch may be used in tests.
- Runs are stateless: run id = TinySet dataset id + base64url profile, so the public API needs no database.
- An investor is listed only when named on a fetched live page for a recent (18-month) round; never invent fields.

## Commands
- Install: `npm install` (package-lock.json is the lockfile; `.npmrc` sets `min-release-age=1` as a supply-chain guard)
- Repo: https://github.com/GxAditya/Tinyfund
- Dev: `npm run dev` (port 8080) · Build: `npm run build` · Test: `npm test` · Lint: `npm run lint`
- Deploy: Cloudflare Workers free plan via Workers Builds (GitHub connect): build `npm run build`, deploy `npx wrangler deploy`. Nitro (`cloudflare-module`) merges root `wrangler.jsonc` into `.output/server/wrangler.json`; never put `main`/`assets` or secrets in `wrangler.jsonc`. Verify config with `npx wrangler deploy --dry-run` (no account needed).
- Free plan limits: 50 subrequests and 10 ms CPU per request. Keep each server function step under ~45 outbound calls (Search/Fetch/AI); the one-request public API runs discovery without per-article AI for this reason.
