// POST /api/agent  { connection:{subdomain,email,token}, messages:[...], mode:"dry"|"live" }
// Provider-pluggable operator brain. Set OPERATOR_PROVIDER=openai to use any
// OpenAI-compatible endpoint (your Modal vLLM server, Fireworks, etc.); default
// is Anthropic. Zendesk reads + the verify check always run live; writes are
// simulated in "dry" mode. The verify gate is enforced in the tools themselves,
// so a smaller/cheaper model is still bounded by the guardrails.
//
// Env:
//   OPERATOR_PROVIDER  "anthropic" (default) | "openai"
//   OPERATOR_MODEL     model id  (default: claude-sonnet-4-6 | Qwen/Qwen2.5-7B-Instruct)
//   OPERATOR_BASE_URL  openai-compatible base, e.g. https://...modal.run/v1
//   OPERATOR_API_KEY   bearer key for the openai-compatible endpoint
//   ANTHROPIC_API_KEY  required when provider=anthropic

const PROVIDER = (process.env.OPERATOR_PROVIDER || "anthropic").toLowerCase();
const MODEL = process.env.OPERATOR_MODEL || (PROVIDER === "openai" ? "Qwen/Qwen2.5-7B-Instruct" : "claude-sonnet-4-6");
const OAI_BASE = (process.env.OPERATOR_BASE_URL || "").replace(/\/+$/, "");
const OAI_KEY = process.env.OPERATOR_API_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const PERSONAS = { anne: "6b4df3c2-c9ce-49e7-a95b-8816e8216586", gabriel: "e6db066d-80f1-49c6-96e9-a9c10af18397", mia: "77b7e33a-c096-4bb4-b70f-bdc988cf8925" };
const SITE = process.env.GOBLIN_SITE_URL || "https://www.usegoblin.xyz";

function zdClient(conn) {
  const base = `https://${conn.subdomain}.zendesk.com/api/v2`;
  const auth = "Basic " + Buffer.from(`${conn.email}/token:${conn.token}`).toString("base64");
  const call = async (path, init) => {
    const r = await fetch(base + path, { ...init, headers: { authorization: auth, "content-type": "application/json", ...(init?.headers || {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      let detail = (body.error || body.description || "").toString();
      // Zendesk 422 RecordInvalid puts the real reason in body.details: { field: [{ description }] }
      if (body.details && typeof body.details === "object") {
        const parts = [];
        for (const k of Object.keys(body.details)) {
          const arr = body.details[k];
          if (Array.isArray(arr)) for (const d of arr) parts.push(`${k}: ${d.description || d.error || JSON.stringify(d)}`);
          else if (arr) parts.push(`${k}: ${typeof arr === "string" ? arr : JSON.stringify(arr)}`);
        }
        if (parts.length) detail = parts.join("; ");
      }
      throw new Error(`Zendesk ${r.status}: ${detail.toString().slice(0, 240)}`);
    }
    return body;
  };
  return { call };
}
const slim = (t) => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority ?? null, updated_at: t.updated_at });

export const TOOLS = [
  { name: "zendesk_search", description: "Search tickets with Zendesk query syntax, e.g. 'type:ticket status:solved'. Read-only.", input_schema: { type: "object", properties: { query: { type: "string" }, per_page: { type: "number" } }, required: ["query"] } },
  { name: "zendesk_list_tickets", description: "List recent tickets, optional status filter (new/open/pending/solved/closed). Read-only.", input_schema: { type: "object", properties: { status: { type: "string" }, limit: { type: "number" } } } },
  { name: "zendesk_get_ticket", description: "Fetch one ticket by id. Read-only.", input_schema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] } },
  { name: "zendesk_add_note", description: "Add a private internal note to a ticket. Write.", input_schema: { type: "object", properties: { ticket_id: { type: "number" }, note: { type: "string" } }, required: ["ticket_id", "note"] } },
  { name: "zendesk_update_ticket", description: "Update a ticket: status (open/pending/solved), priority, or add a public reply. Accepts a single id or comma-separated ids for bulk. Write.", input_schema: { type: "object", properties: { ticket_ids: { type: "string" }, status: { type: "string" }, priority: { type: "string" }, reply: { type: "string" } }, required: ["ticket_ids"] } },
  { name: "zendesk_create_ticket", description: "Open a new ticket. Write.", input_schema: { type: "object", properties: { subject: { type: "string" }, description: { type: "string" }, priority: { type: "string" } }, required: ["subject", "description"] } },
  { name: "goblin_verify_resolution", description: "Check a proposed resolution against guardrails (over-refund, out-of-window, duplicate) BEFORE it runs. Always call this before a bulk close, refund, or other destructive action.", input_schema: { type: "object", properties: { action_type: { type: "string" }, count: { type: "number" }, amount: { type: "number" }, order_age_days: { type: "number" }, already_resolved: { type: "boolean" } }, required: ["action_type"] } },
  { name: "goblin_start_embodied_session", description: "Hand off to a live face+voice persona session (anne/gabriel/mia) and return a link. Use when a customer needs a human-feeling touch.", input_schema: { type: "object", properties: { persona: { type: "string" }, context: { type: "string" } } } },
];

const isWrite = (n) => ["zendesk_add_note", "zendesk_update_ticket", "zendesk_create_ticket"].includes(n);

export async function runTool(name, input, conn, mode) {
  const dry = mode !== "live";
  if (isWrite(name) && dry) return { simulated: true, mode: "dry-run", would: { tool: name, input } };
  const zd = conn ? zdClient(conn) : null;
  if (name === "zendesk_search") { const out = await zd.call(`/search.json?query=${encodeURIComponent(input.query)}&per_page=${Math.min(input.per_page || 10, 100)}`); return { count: out.count, results: (out.results || []).slice(0, 12).map(slim) }; }
  if (name === "zendesk_list_tickets") { const out = await zd.call("/tickets.json?page[size]=100&sort_order=desc"); let t = (out.tickets || []).map(slim); if (input.status) t = t.filter((x) => x.status === String(input.status).toLowerCase()); return { count: t.length, tickets: t.slice(0, input.limit || 10) }; }
  if (name === "zendesk_get_ticket") { const out = await zd.call(`/tickets/${parseInt(input.id, 10)}.json`); return { ticket: slim(out.ticket) }; }
  if (name === "zendesk_add_note") { const out = await zd.call(`/tickets/${parseInt(input.ticket_id, 10)}.json`, { method: "PUT", body: JSON.stringify({ ticket: { comment: { body: `[Operator] ${input.note}`, public: false } } }) }); return { ok: true, ticket: slim(out.ticket), message: `Internal note added to #${input.ticket_id}` }; }
  if (name === "zendesk_update_ticket") {
    const ids = String(input.ticket_ids).split(",").map((x) => parseInt(x.trim(), 10)).filter(Boolean);
    const ticket = {}; if (input.status) { let s = input.status.toLowerCase(); if (s === "closed") s = "solved"; ticket.status = s; } if (input.priority) ticket.priority = input.priority; if (input.reply) ticket.comment = { body: input.reply, public: true };
    if (ids.length === 1) { const out = await zd.call(`/tickets/${ids[0]}.json`, { method: "PUT", body: JSON.stringify({ ticket }) }); return { ok: true, ticket: slim(out.ticket), message: `Updated #${ids[0]}` }; }
    await zd.call(`/tickets/update_many.json?ids=${ids.join(",")}`, { method: "PUT", body: JSON.stringify({ ticket }) }); return { ok: true, count: ids.length, message: `Updated ${ids.length} tickets` };
  }
  if (name === "zendesk_create_ticket") { const out = await zd.call("/tickets.json", { method: "POST", body: JSON.stringify({ ticket: { subject: input.subject, comment: { body: input.description }, priority: ["low", "normal", "high", "urgent"].includes(input.priority) ? input.priority : "normal", tags: ["created-via-operator"] } }) }); return { ok: true, ticket: slim(out.ticket), message: `Created #${out.ticket.id}` }; }
  if (name === "goblin_verify_resolution") {
    const policy = { max_refund_amount: 500, resolution_window_days: 30 }; const v = [];
    const valueAction = ["refund", "credit", "replace"].includes((input.action_type || "").toLowerCase());
    if (valueAction && typeof input.amount === "number" && input.amount > policy.max_refund_amount) v.push({ code: "over_refund", detail: `Amount ${input.amount} exceeds max ${policy.max_refund_amount}.` });
    if (typeof input.order_age_days === "number" && input.order_age_days > policy.resolution_window_days) v.push({ code: "out_of_window", detail: `Age ${input.order_age_days}d exceeds ${policy.resolution_window_days}d window.` });
    if (input.already_resolved === true) v.push({ code: "duplicate_resolution", detail: "Item already resolved; would be a duplicate." });
    return { approved: v.length === 0, violations: v, checked_against: policy, count: input.count ?? null };
  }
  if (name === "goblin_start_embodied_session") { const persona = ["anne", "gabriel", "mia"].includes(input.persona) ? input.persona : "anne"; return { url: `${SITE}/p/${PERSONAS[persona]}`, persona, context_relayed: input.context ?? null }; }
  return { error: `unknown tool ${name}` };
}

function summarize(out) {
  if (out.error) return out.error;
  if (out.message) return out.message;
  if (out.simulated) return "simulated (dry-run)";
  if (out.url) return out.url;
  if (out.approved !== undefined) return out.approved ? "approved" : "blocked: " + (out.violations || []).map((v) => v.code).join(",");
  if (out.count != null) return out.count + " results";
  return "done";
}

const SYSTEM = (sub, mode) => `You are Anne, the AI operator for the Zendesk account "${sub}". You help the user run it by chatting.
Use your tools to read and act — never invent ticket numbers, counts, or statuses; only report what tools return.
Before any destructive or bulk write (closing/solving multiple tickets, refunds, mass updates), FIRST call goblin_verify_resolution, summarize the result, and ask the user to confirm before you execute the write.
${mode === "live" ? "You are in LIVE mode: writes really happen, so confirm first." : "You are in DRY-RUN mode: write tools return simulated results without changing anything. Make clear what WOULD happen."}
Keep replies short and conversational. When you hand off to an embodied session, share the link.`;

// ---------- Anthropic ----------
async function callAnthropic(system, messages) {
  const r = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, tools: TOOLS, messages }) });
  const body = await r.json(); if (!r.ok) throw new Error(body?.error?.message || `Anthropic ${r.status}`); return body;
}
async function runAnthropic(system, messages, conn, mode) {
  let convo = messages; const trace = [];
  for (let i = 0; i < 6; i++) {
    const resp = await callAnthropic(system, convo);
    convo = [...convo, { role: "assistant", content: resp.content }];
    const toolUses = (resp.content || []).filter((c) => c.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !toolUses.length) return { reply: (resp.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim() || "(no reply)", trace, messages: convo };
    const results = [];
    for (const tu of toolUses) { let out; try { out = await runTool(tu.name, tu.input, conn, mode); } catch (e) { out = { error: e.message }; } trace.push({ tool: tu.name, input: tu.input, ok: !out.error, summary: summarize(out) }); results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 6000) }); }
    convo = [...convo, { role: "user", content: results }];
  }
  return { reply: "(Paused after several steps — say 'continue'.)", trace, messages: convo };
}

// ---------- OpenAI-compatible (Modal vLLM / Fireworks / etc.) ----------
const OAI_TOOLS = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
async function callOpenAI(system, messages) {
  const r = await fetch(`${OAI_BASE}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${OAI_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, ...messages], tools: OAI_TOOLS, tool_choice: "auto", max_tokens: 1024, temperature: 0.2 }) });
  const body = await r.json(); if (!r.ok) throw new Error(body?.error?.message || `LLM ${r.status}`); return body.choices?.[0]?.message;
}
// Some self-hosted models emit tool calls as <tool_call>{...}</tool_call> text in the
// message content instead of using the structured tool_calls channel. Parse those out so
// they actually execute, and so the raw syntax never reaches the user.
function firstJsonObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
function parseTextToolCalls(content) {
  const calls = [];
  if (!content || content.indexOf("<tool_call>") === -1) return calls;
  for (let chunk of content.split("<tool_call>").slice(1)) {
    chunk = chunk.split("</tool_call>")[0];
    const obj = firstJsonObject(chunk);
    if (obj && obj.name) calls.push({ id: "call_" + Math.random().toString(36).slice(2, 10), type: "function", function: { name: obj.name, arguments: JSON.stringify(obj.arguments || obj.parameters || {}) } });
  }
  return calls;
}
function cleanReply(content) {
  if (!content) return "";
  let t = String(content)
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, " ") // closed blocks
    .replace(/<tool_call>[\s\S]*$/g, " ")               // unclosed trailing block
    .replace(/<\/?tool_call>/g, " ")                    // stray tags
    .replace(/<\|[^|]*\|>/g, " ");                       // stray special tokens
  return t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export async function runOpenAI(system, messages, conn, mode) {
  let convo = [...messages]; const trace = [];
  for (let i = 0; i < 6; i++) {
    const msg = await callOpenAI(system, convo); if (!msg) throw new Error("Empty response from model.");
    let calls = msg.tool_calls || [];
    if (!calls.length) { const textCalls = parseTextToolCalls(msg.content); if (textCalls.length) calls = textCalls; }
    if (!calls.length) {
      convo.push({ role: "assistant", content: cleanReply(msg.content) });
      return { reply: cleanReply(msg.content) || "(no reply)", trace, messages: convo };
    }
    // record a clean assistant turn that carries the calls, so history stays coherent
    convo.push({ role: "assistant", content: cleanReply(msg.content) || null, tool_calls: calls });
    for (const c of calls) {
      let input = {}; try { input = JSON.parse(c.function.arguments || "{}"); } catch {}
      let out; try { out = await runTool(c.function.name, input, conn, mode); } catch (e) { out = { error: e.message }; }
      trace.push({ tool: c.function.name, input, ok: !out.error, summary: summarize(out) });
      convo.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out).slice(0, 6000) });
    }
  }
  return { reply: "(Paused after several steps. Say 'continue'.)", trace, messages: convo };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (PROVIDER === "openai") { if (!OAI_BASE || !OAI_KEY) return res.status(500).json({ ok: false, error: "OPERATOR_BASE_URL and OPERATOR_API_KEY must be set for the openai provider." }); }
  else if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY is not set." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const { connection, messages, mode } = body;
  if (!connection?.subdomain || !connection?.token) return res.status(400).json({ ok: false, error: "Not connected." });
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: "No messages." });

  const system = SYSTEM(connection.subdomain, mode === "live" ? "live" : "dry");
  try {
    const out = PROVIDER === "openai" ? await runOpenAI(system, messages, connection, mode) : await runAnthropic(system, messages, connection, mode);
    return res.status(200).json({ ok: true, ...out });
  } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
}
