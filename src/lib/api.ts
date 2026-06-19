export type Conn = { subdomain: string; email: string; token: string };

export type ScanResult = {
  ok: true;
  account: { name: string; role: string; subdomain: string };
  counts: { tickets: number; open: number; groups: number; views: number; fields: number };
  groups: string[];
  field_highlights: string[];
};

export type TraceEntry = { tool: string; input: unknown; ok: boolean; summary: string };
export type Msg = { role: string; content: unknown };
export type AgentResult = { reply: string; trace: TraceEntry[]; messages: Msg[] };

export async function scan(c: Conn): Promise<ScanResult> {
  const r = await fetch("/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(c),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || "Connection failed.");
  return d as ScanResult;
}

export function warm(): void {
  fetch("/api/warm").catch(() => {});
}

export async function agent(connection: Conn, messages: Msg[], mode: string): Promise<AgentResult> {
  const r = await fetch("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ connection, messages, mode }),
  });
  const raw = await r.text();
  let d: { ok?: boolean; error?: string } & Partial<AgentResult>;
  try {
    d = JSON.parse(raw);
  } catch {
    throw new Error(
      r.status === 504 || /timeout|FUNCTION_INVOCATION/i.test(raw)
        ? "The model is warming up — first request after idle can take ~90s. Give it a few seconds and resend."
        : "Server error — please resend.",
    );
  }
  if (!d.ok) throw new Error(d.error || "Agent error.");
  return d as AgentResult;
}
