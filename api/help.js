// POST /api/help  { question }  — PUBLIC, anonymous deflection endpoint.
//
// This is the customer-facing counterpart to /api/agent. It never receives or
// trusts Zendesk credentials from the browser: it uses server-side, narrowly
// scoped Guide creds (HELP_*) to (a) search the Help Center, (b) answer ONLY from
// what it finds, with citations, and (c) log a deduped knowledge-gap ticket when
// the KB has no answer. That single flow covers three of the four requirements:
// verified-content answering, self-service deflection, and gap identification.
//
// It reuses runTool from agent.js for all Zendesk I/O, so the verify gate and the
// read/write guardrails defined there apply unchanged.
//
// Env (set in Vercel → Project → Settings → Environment Variables):
//   HELP_SUBDOMAIN          Zendesk subdomain (e.g. "acme")
//   HELP_EMAIL              agent email for the scoped token
//   HELP_TOKEN              API token — scope it to read Guide + create tickets only
//   HELP_ALLOWED_ORIGINS    comma list of sites allowed to embed the widget,
//                           e.g. "https://acme.com,https://app.acme.com" ("*" = dev only)
//   OPERATOR_PROVIDER       "anthropic" (default) | "openai"  (reused from agent.js)
//   OPERATOR_MODEL          optional model override
//   OPERATOR_BASE_URL       openai-compatible base, when provider=openai
//   OPERATOR_API_KEY        bearer key, when provider=openai
//   ANTHROPIC_API_KEY       required when provider=anthropic

import { runTool } from "./agent.js";

const CONN = {
  subdomain: process.env.HELP_SUBDOMAIN,
  email: process.env.HELP_EMAIL,
  token: process.env.HELP_TOKEN,
};

const PROVIDER = (process.env.OPERATOR_PROVIDER || "anthropic").toLowerCase();
const MODEL = process.env.OPERATOR_MODEL || (PROVIDER === "openai" ? "Qwen/Qwen2.5-7B-Instruct" : "claude-sonnet-4-6");
const OAI_BASE = (process.env.OPERATOR_BASE_URL || "").replace(/\/+$/, "");
const OAI_KEY = process.env.OPERATOR_API_KEY || "";

// Sentinel the model must emit when the sources don't actually contain the answer.
// We treat it as a gap rather than letting the model improvise — this is what keeps
// answers "verified" instead of plausible-sounding.
const NO_ANSWER = "NO_ANSWER";

// ---------- single tool-less completion, provider-pluggable ----------
async function complete(system, user) {
  if (PROVIDER === "openai") {
    if (!OAI_BASE || !OAI_KEY) throw new Error("OPERATOR_BASE_URL and OPERATOR_API_KEY must be set for the openai provider.");
    const r = await fetch(`${OAI_BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${OAI_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0.1, max_tokens: 700, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.error?.message || `LLM ${r.status}`);
    return (body.choices?.[0]?.message?.content || "").trim();
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, temperature: 0.1, system, messages: [{ role: "user", content: user }] }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `Anthropic ${r.status}`);
  return (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
}

// ---------- CORS: only the customer's own sites may call this ----------
const ORIGINS = (process.env.HELP_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
function applyCors(req, res) {
  const origin = req.headers.origin || "";
  const allowAll = ORIGINS.includes("*");
  const ok = allowAll || ORIGINS.includes(origin);
  if (ok) res.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  return ok || ORIGINS.length === 0; // if unset, don't hard-block (dev); set it in prod
}

// ---------- best-effort rate limit ----------
// NOTE: in-memory + per-instance only. Serverless spins up many instances, so this
// is a courtesy brake, not real protection. For production put a shared counter in
// Vercel KV / Upstash Redis and check it here instead.
const HITS = new Map();
const LIMIT = 20, WINDOW_MS = 60_000;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear(); // crude memory cap
  return arr.length > LIMIT;
}

export default async function handler(req, res) {
  const corsOk = applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(corsOk ? 204 : 403).end();
  if (!corsOk) return res.status(403).json({ ok: false, error: "Origin not allowed." });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  if (!CONN.subdomain || !CONN.email || !CONN.token)
    return res.status(500).json({ ok: false, error: "Help Center is not configured. Set HELP_SUBDOMAIN, HELP_EMAIL, HELP_TOKEN." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: "Too many questions — give it a minute." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const question = String(body.question || "").trim().slice(0, 500);
  if (question.length < 3) return res.status(400).json({ ok: false, error: "Ask a question." });

  try {
    // 1) Retrieve candidate articles from the live KB.
    const found = await runTool("zendesk_search_articles", { query: question, per_page: 4 }, CONN, "live");
    const hits = found.results || [];

    // 2) Nothing matched → log the gap, tell the customer plainly.
    if (!hits.length) {
      const gap = await runTool("zendesk_log_knowledge_gap", { question }, CONN, "live");
      return res.status(200).json({ ok: true, answer: null, sources: [], gap_logged: true, ticket_id: gap.ticket_id ?? null });
    }

    // 3) Pull fuller text for the top hits (search returns short snippets only).
    const top = hits.slice(0, 3);
    const full = await Promise.all(top.map((a) =>
      runTool("zendesk_get_article", { id: a.id }, CONN, "live").then((r) => r.article).catch(() => null)
    ));
    const sources = full
      .map((a, i) => a ? { n: i + 1, id: a.id, title: a.title, url: a.url, body: a.body } : null)
      .filter(Boolean);

    if (!sources.length) {
      const gap = await runTool("zendesk_log_knowledge_gap", { question }, CONN, "live");
      return res.status(200).json({ ok: true, answer: null, sources: [], gap_logged: true, ticket_id: gap.ticket_id ?? null });
    }

    // 4) Answer strictly from those sources, with citations.
    const system =
      "You are a customer support assistant. Answer the customer's question using ONLY the numbered SOURCES provided. " +
      "Do not use outside knowledge. Cite the sources you use inline as [1], [2], etc. " +
      "Be concise and friendly: a short direct answer, then steps if the source gives them. " +
      `If the SOURCES do not actually contain the answer, reply with exactly ${NO_ANSWER} and nothing else.`;
    const sourceBlock = sources.map((s) => `[${s.n}] ${s.title}\n${s.body}`).join("\n\n");
    const user = `QUESTION:\n${question}\n\nSOURCES:\n${sourceBlock}`;

    const raw = await complete(system, user);

    // 5) Model says the KB can't answer → treat as a gap, not a guess.
    if (!raw || raw.replace(/[^A-Z_]/g, "").includes(NO_ANSWER)) {
      const gap = await runTool("zendesk_log_knowledge_gap", { question }, CONN, "live");
      return res.status(200).json({ ok: true, answer: null, sources: [], gap_logged: true, ticket_id: gap.ticket_id ?? null });
    }

    // Return only the sources actually cited, so the customer sees real provenance.
    const cited = new Set((raw.match(/\[(\d+)\]/g) || []).map((m) => parseInt(m.slice(1, -1), 10)));
    const shown = (cited.size ? sources.filter((s) => cited.has(s.n)) : sources)
      .map((s) => ({ title: s.title, url: s.url }));

    return res.status(200).json({ ok: true, answer: raw, sources: shown, gap_logged: false });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || "Something went wrong." });
  }
}
