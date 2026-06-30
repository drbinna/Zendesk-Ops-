// POST /api/ticket-reply — Zendesk webhook target for auto-replying to incoming email tickets.
//
// A Zendesk trigger (new ticket, channel = email) calls this with the ticket id and
// the customer's question. The endpoint answers ONLY from the published Help Center
// (the same grounded logic as /api/help), then:
//   • AUTOREPLY_MODE=draft (default): posts the proposed reply as an INTERNAL note for
//     a human to review/send. Nothing reaches the customer.
//   • AUTOREPLY_MODE=public: posts the reply as a PUBLIC comment to the customer.
//   • No confident KB answer → it NEVER guesses: it leaves an internal note flagging
//     the ticket for a human (both modes).
//
// Guardrails: shared-secret auth, idempotent (skips tickets it already handled),
// confidence-gated (no public guesses), and it never auto-solves a ticket.
//
// Env (Vercel → zendesk-ops → Settings → Environment Variables):
//   AUTOREPLY_SECRET   required — must match the x-autoreply-secret header the webhook sends
//   AUTOREPLY_MODE     "draft" (default) | "public"
//   HELP_SUBDOMAIN / HELP_EMAIL / HELP_TOKEN     reused from /api/help (post + read)
//   OPERATOR_PROVIDER / OPERATOR_MODEL / OPERATOR_BASE_URL / OPERATOR_API_KEY / ANTHROPIC_API_KEY  reused

import { runTool } from "./agent.js";

const CONN = { subdomain: process.env.HELP_SUBDOMAIN, email: process.env.HELP_EMAIL, token: process.env.HELP_TOKEN };
const PROVIDER = (process.env.OPERATOR_PROVIDER || "anthropic").toLowerCase();
const MODEL = process.env.OPERATOR_MODEL || (PROVIDER === "openai" ? "Qwen/Qwen2.5-7B-Instruct" : "claude-sonnet-4-6");
const OAI_BASE = (process.env.OPERATOR_BASE_URL || "").replace(/\/+$/, "");
const OAI_KEY = process.env.OPERATOR_API_KEY || "";
const NO_ANSWER = "NO_ANSWER";
const MODE = (process.env.AUTOREPLY_MODE || "draft").toLowerCase();
const TAG_PUBLIC = "anne-auto-replied";
const TAG_DRAFT = "anne-draft-reply";
const TAG_HUMAN = "anne-needs-human";

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

async function zd(path, init) {
  const auth = Buffer.from(`${CONN.email}/token:${CONN.token}`).toString("base64");
  const r = await fetch(`https://${CONN.subdomain}.zendesk.com/api/v2${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, "content-type": "application/json", ...(init?.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof body?.error === "string" ? body.error : `Zendesk ${r.status}`);
  return body;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!process.env.AUTOREPLY_SECRET) return res.status(500).json({ ok: false, error: "AUTOREPLY_SECRET is not set." });
  const provided = String(req.headers["x-autoreply-secret"] || "") ||
    String(req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (provided !== process.env.AUTOREPLY_SECRET)
    return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!CONN.subdomain || !CONN.email || !CONN.token)
    return res.status(500).json({ ok: false, error: "HELP_SUBDOMAIN, HELP_EMAIL, HELP_TOKEN must be set." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const ticketId = parseInt(body.ticket_id, 10);
  if (!ticketId) return res.status(400).json({ ok: false, error: "ticket_id required" });

  try {
    // Load the ticket: gives us idempotency tags + the question text (safer than
    // passing the email body through the webhook JSON, where quotes/newlines break it).
    const t = await zd(`/tickets/${ticketId}.json`);
    const tk = t.ticket || {};
    const tags = tk.tags || [];
    if ([TAG_PUBLIC, TAG_DRAFT, TAG_HUMAN].some((x) => tags.includes(x)))
      return res.status(200).json({ ok: true, skipped: "already handled" });
    const question = `${String(tk.subject || "").trim()}\n\n${String(tk.description || "").trim()}`.trim();
    if (question.length < 3) return res.status(200).json({ ok: true, skipped: "empty question" });

    // 1) Retrieve from the published Help Center.
    let answer = null, sources = [];
    const found = await runTool("zendesk_search_articles", { query: question, per_page: 4 }, CONN, "live");
    const hits = found.results || [];
    if (hits.length) {
      const full = await Promise.all(hits.slice(0, 3).map((a) =>
        runTool("zendesk_get_article", { id: a.id }, CONN, "live").then((r) => r.article).catch(() => null)));
      sources = full.map((a, i) => (a ? { n: i + 1, title: a.title, url: a.url, body: a.body } : null)).filter(Boolean);
      if (sources.length) {
        const system =
          "You are the support assistant for the company described in the SOURCES below. " +
          "Answer the customer's question using ONLY the numbered SOURCES; do not use outside knowledge. " +
          "Interpret the question charitably: 'you', 'your company', 'we', 'this', and 'your product' refer to the company and product in the SOURCES. " +
          "A source counts as relevant even when its wording differs from the question — match on meaning, not keywords. " +
          "Cite the sources you use inline as [1], [2], etc. Be concise, warm, and direct: a short answer, then steps if a source gives them. " +
          `Reply with exactly ${NO_ANSWER} (and nothing else) ONLY when none of the SOURCES are relevant. If even one source addresses the question, answer from it.`;
        const sourceBlock = sources.map((s) => `[${s.n}] ${s.title}\n${s.body}`).join("\n\n");
        const raw = await complete(system, `QUESTION:\n${question}\n\nSOURCES:\n${sourceBlock}`);
        if (raw && !raw.replace(/[^A-Z_]/g, "").includes(NO_ANSWER)) answer = raw;
      }
    }

    // 2) No confident KB answer → flag for a human, never guess.
    if (!answer) {
      await zd(`/tickets/${ticketId}.json`, { method: "PUT", body: JSON.stringify({
        ticket: { comment: { body: "Anne: no confident Help Center answer for this ticket — leaving it for a human.", public: false }, tags: [...new Set([...tags, TAG_HUMAN])] } }) });
      return res.status(200).json({ ok: true, answered: false, action: "flagged_for_human" });
    }

    // 3) Grounded answer in hand.
    const srcLines = sources.length ? "\n\nSources:\n" + sources.map((s) => `• ${s.title} — ${s.url}`).join("\n") : "";
    if (MODE === "public") {
      const reply = `${answer}${srcLines}\n\n— Answered automatically from our Help Center. Just reply to this email if you'd like a person to take a look.`;
      await zd(`/tickets/${ticketId}.json`, { method: "PUT", body: JSON.stringify({
        ticket: { comment: { body: reply, public: true }, tags: [...new Set([...tags, TAG_PUBLIC])] } }) });
      return res.status(200).json({ ok: true, answered: true, mode: "public" });
    }
    const note = `Anne drafted this reply from the Help Center — NOT sent. Review and send if it's good:\n\n${answer}${srcLines}`;
    await zd(`/tickets/${ticketId}.json`, { method: "PUT", body: JSON.stringify({
      ticket: { comment: { body: note, public: false }, tags: [...new Set([...tags, TAG_DRAFT])] } }) });
    return res.status(200).json({ ok: true, answered: true, mode: "draft" });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || "error" });
  }
}
