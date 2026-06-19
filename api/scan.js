// POST /api/scan  { subdomain, email, token }
// Connects to the given Zendesk subdomain in real time (token auth) and returns a
// read-only workspace summary. Credentials are used transiently and never stored.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const { subdomain, email, token } = body;
  if (!subdomain || !email || !token)
    return res.status(400).json({ ok: false, error: "subdomain, email, and API token are all required." });
  // SSRF guard: only allow a bare Zendesk subdomain.
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(subdomain))
    return res.status(400).json({ ok: false, error: "That doesn't look like a Zendesk subdomain." });

  const base = `https://${subdomain}.zendesk.com/api/v2`;
  const auth = "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64");
  const get = async (path) => {
    const r = await fetch(base + path, { headers: { authorization: auth, "content-type": "application/json" } });
    if (!r.ok) { const e = new Error(`Zendesk ${r.status}`); e.status = r.status; throw e; }
    return r.json();
  };

  try {
    const me = await get("/users/me.json");
    if (!me?.user?.id) throw Object.assign(new Error("auth"), { status: 401 });

    const q = (s) => "/search.json?query=" + encodeURIComponent(s) + "&per_page=1";
    const [groups, views, fields, allT, openT] = await Promise.all([
      get("/groups.json?page[size]=100"),
      get("/views.json?active=true&page[size]=100"),
      get("/ticket_fields.json?page[size]=100"),
      get(q("type:ticket")),
      get(q("type:ticket status:open")),
    ]);

    const titles = (fields.ticket_fields || []).map((f) => f.title);
    return res.status(200).json({
      ok: true,
      account: { name: me.user.name, role: me.user.role, subdomain },
      counts: {
        tickets: allT.count ?? 0,
        open: openT.count ?? 0,
        groups: (groups.groups || []).length,
        views: (views.views || []).length,
        fields: titles.length,
      },
      groups: (groups.groups || []).map((g) => g.name).slice(0, 8),
      field_highlights: titles.filter((t) => /intent|sentiment|priority|language|csat/i.test(t)).slice(0, 4),
    });
  } catch (e) {
    if (e.status === 401 || e.status === 403)
      return res.status(401).json({ ok: false, error: "Authentication failed — check the email and API token." });
    return res.status(502).json({ ok: false, error: `Couldn't reach ${subdomain}.zendesk.com — check the subdomain.` });
  }
}
