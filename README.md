# Goblin Operator — v0 (connect + live scan)

A zero-config Vercel app: a static front-end (`index.html`) plus one serverless
function (`api/scan.js`) that connects to any Zendesk subdomain in real time
(token auth) and returns a read-only workspace summary. No build step, no database,
no env vars — credentials are passed per request from the browser and never stored.

## Deploy (one command)
```bash
cd goblin-operator
npx vercel          # log in, accept defaults -> preview URL
npx vercel --prod   # promote to a production URL
```
That's it — Vercel auto-detects the static file + the `/api` function.

## Test it
Open the URL, enter a Zendesk subdomain + agent email + API token, hit
**Connect & scan**. Generate a token in Admin Center → Apps and integrations →
APIs → Zendesk API.

## Next layer (chat agent)
The chat/operate screen calls an LLM and is the next addition. When we add it,
set `ANTHROPIC_API_KEY` in Vercel → Settings → Environment Variables. The
connect+scan here needs no keys.

## OAuth (later)
To replace token-paste with "Authorize with Zendesk" for *any* customer account,
apply for a Zendesk **global OAuth client** (Marketplace portal, App Developer/ISV,
~1 week review). Single-account OAuth works today without approval.
