// GET/POST /api/warm — wakes the Modal GPU by pinging its /health so the model
// is loading by the time the user sends their first message. Fire-and-forget:
// returns fast; we don't wait for the full model load. No-op for the anthropic provider.
export default async function handler(req, res) {
  const base = (process.env.OPERATOR_BASE_URL || "").replace(/\/+$/, "");
  if ((process.env.OPERATOR_PROVIDER || "").toLowerCase() !== "openai" || !base)
    return res.status(200).json({ ok: true, warming: false });
  const health = base.replace(/\/v1$/, "") + "/health";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(health, { signal: ctrl.signal });
    clearTimeout(t);
    return res.status(200).json({ ok: true, warming: true, ready: r.ok });
  } catch {
    // Even on timeout, the request triggered the container to start booting.
    return res.status(200).json({ ok: true, warming: true, ready: false });
  }
}
