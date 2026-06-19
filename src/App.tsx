import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, RotateCcw, Clock3, ShieldCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import BlurredOrb from "@/components/blurred-orb";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { scan, agent, warm, type Conn, type ScanResult, type Msg, type TraceEntry } from "@/lib/api";

const PETROL = "#0E6E6B";
const HONEY = "#B26F1E";

type Screen = "connect" | "scan" | "chat";
type ChatMsg = { role: "user" | "anne" | "sys"; text: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>("connect");
  const [conn, setConn] = useState<Conn | null>(null);
  const [data, setData] = useState<ScanResult | null>(null);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background flex items-center justify-center p-4 md:p-8 font-sans text-foreground">
      <BlurredOrb className="!w-[34rem] !h-[34rem] absolute -top-40 -right-32 opacity-40 blur-[120px]" style={{ background: `radial-gradient(circle at 30% 30%, ${PETROL}, transparent 70%)` }} />
      <BlurredOrb className="!w-[30rem] !h-[30rem] absolute -bottom-40 -left-32 opacity-30 blur-[120px]" style={{ background: `radial-gradient(circle at 60% 40%, ${HONEY}, transparent 70%)` }} />

      <main className="relative w-full max-w-4xl rounded-[2rem] border border-border bg-card/80 backdrop-blur-xl shadow-2xl shadow-black/10 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 text-[#EAF3F1]" style={{ background: "linear-gradient(180deg,#0E3A38,#0A4B49)" }}>
          <span className="flex gap-1.5">
            <i className="size-2.5 rounded-full" style={{ background: "#E8A85C" }} />
            <i className="size-2.5 rounded-full bg-white/25" />
            <i className="size-2.5 rounded-full bg-white/25" />
          </span>
          <span className="font-heading font-semibold text-sm">Goblin <span style={{ color: "#E8A85C" }}>Operator</span></span>
          <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-white/60"><i className="size-1.5 rounded-full bg-emerald-300 animate-pulse" /> real-time</span>
        </div>

        <div className="min-h-[560px] p-8 md:p-11">
          <AnimatePresence mode="wait">
            {screen === "connect" && (
              <Connect key="connect" onConnected={(c, d) => { setConn(c); setData(d); warm(); setScreen("scan"); }} />
            )}
            {screen === "scan" && data && (
              <Scan key="scan" data={data} onChat={() => { warm(); setScreen("chat"); }} onReset={() => { setConn(null); setData(null); setScreen("connect"); }} />
            )}
            {screen === "chat" && conn && data && <Chat key="chat" conn={conn} sub={data.account.subdomain} />}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

const rise = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: 0.4 } };
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-[11px] uppercase tracking-[0.18em] mb-4" style={{ color: PETROL }}>{children}</p>
);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block font-mono text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Connect({ onConnected }: { onConnected: (c: Conn, d: ScanResult) => void }) {
  const [sub, setSub] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const subdomain = sub.trim().replace(/\.zendesk\.com$/i, "");
    if (!subdomain || !email.trim() || !token.trim()) return setErr("Fill in all three fields.");
    setBusy(true);
    try {
      const c = { subdomain, email: email.trim(), token: token.trim() };
      const d = await scan(c);
      onConnected(c, d);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full bg-background border border-input rounded-lg px-3.5 py-2.5 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 transition";

  return (
    <motion.div {...rise}>
      <Eyebrow>Connect</Eyebrow>
      <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight leading-[1.05] mb-3">Point Anne at your <span style={{ color: HONEY }}>Zendesk.</span></h1>
      <p className="text-[15px] leading-relaxed text-muted-foreground max-w-prose mb-7">Enter your subdomain and an API token. We connect live and read your workspace — nothing is stored.</p>

      <div className="grid md:grid-cols-[1.05fr_.95fr] gap-7">
        <form onSubmit={submit}>
          <Field label="Zendesk address">
            <div className="flex items-stretch bg-background border border-input rounded-lg overflow-hidden focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 transition">
              <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="your-company" autoComplete="off" className="flex-1 bg-transparent px-3.5 py-2.5 font-mono text-sm outline-none" />
              <span className="px-3 flex items-center font-mono text-[13px] text-muted-foreground border-l border-border bg-muted">.zendesk.com</span>
            </div>
          </Field>
          <Field label="Agent email"><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" autoComplete="off" className={inputCls} /></Field>
          <Field label="API token"><input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="••••••••••••••••" autoComplete="off" className={inputCls} /></Field>
          <Button type="submit" disabled={busy} size="lg" className="h-11 px-5 text-[15px] rounded-xl">{busy ? "Connecting…" : "Connect & scan"} <ArrowRight /></Button>
          {err && <p className="mt-3.5 text-sm font-medium text-destructive">{err}</p>}
          <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">Generate a token in Admin Center → Apps and integrations → APIs → Zendesk API. Used live for this session only, never saved.</p>
        </form>

        <div className="rounded-2xl border border-border bg-muted/50 p-5 self-start">
          <h4 className="font-heading text-sm mb-4">What this does</h4>
          {([
            [<Clock3 className="size-4" />, "Reads your tickets, groups, views, and fields", "so Anne understands your setup.", false],
            [<RefreshCw className="size-4" />, "Acts only when you ask, gated by verification", "destructive writes pause for confirm.", true],
            [<ShieldCheck className="size-4" />, "No storage", "credentials live in your browser for this session only.", false],
          ] as [React.ReactNode, string, string, boolean][]).map(([icon, head, tail, warm2], i) => (
            <div key={i} className="flex gap-3 mb-3.5 last:mb-0">
              <span className="shrink-0 size-7 grid place-items-center rounded-lg" style={warm2 ? { background: "#F6ECD9", color: HONEY } : { background: "#E8F0EF", color: PETROL }}>{icon}</span>
              <p className="text-[13px] leading-snug">{head} <span className="text-muted-foreground">— {tail}</span></p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function Scan({ data, onChat, onReset }: { data: ScanResult; onChat: () => void; onReset: () => void }) {
  const lines: [string, string][] = [
    ["zendesk_get_current_user", `${data.account.role} · ${data.account.name}`],
    ["zendesk_list_groups", `${data.counts.groups} groups`],
    ["zendesk_list_views", `${data.counts.views} views`],
    ["zendesk_list_ticket_fields", `${data.counts.fields} fields`],
    ["zendesk_count_tickets", `${data.counts.tickets} tickets`],
  ];
  const tiles: [number, string][] = [
    [data.counts.tickets, "tickets total"],
    [data.counts.open, "open now"],
    [data.counts.groups, "agent groups"],
    [data.counts.fields, data.field_highlights.length ? "fields · " + data.field_highlights.slice(0, 2).join(", ") : "ticket fields"],
  ];
  const base = lines.length * 0.32;
  return (
    <motion.div {...rise}>
      <Eyebrow>Reading your workspace</Eyebrow>
      <div className="grid md:grid-cols-[.85fr_1.15fr] gap-6">
        <div className="rounded-2xl p-5 font-mono text-[12.5px] min-h-[280px]" style={{ background: "#0E2B2A", color: "#BFEAE6" }}>
          {lines.map(([t, r], i) => (
            <motion.div key={t} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.32 }} className="flex gap-2.5 items-baseline mb-3 leading-snug">
              <span style={{ color: "#5FA9A4" }}>→</span><span>{t}</span><span className="ml-auto text-[11px]" style={{ color: "#E8A85C" }}>{r}</span>
            </motion.div>
          ))}
        </div>
        <div>
          <motion.h3 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: base }} className="font-heading text-[15px] mb-1">Your Zendesk, at a glance</motion.h3>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: base + 0.1 }} className="text-[13px] text-muted-foreground mb-4">Connected as <b style={{ color: PETROL }}>{data.account.name}</b> · {data.account.role} · {data.account.subdomain}.zendesk.com</motion.p>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map(([n, l], i) => (
              <motion.div key={l} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: base + 0.2 + i * 0.1 }} className="rounded-xl border border-border bg-muted/40 px-4 py-3.5">
                <div className="font-heading font-bold text-3xl leading-none">{n}</div><div className="text-xs text-muted-foreground mt-1.5">{l}</div>
              </motion.div>
            ))}
          </div>
          {data.groups.length > 0 && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: base + 0.7 }} className="mt-4 font-mono text-xs text-muted-foreground">groups: <b style={{ color: PETROL }}>{data.groups.join(" · ")}</b></motion.p>
          )}
          <div className="mt-6 flex items-center gap-4">
            <Button onClick={onChat} size="lg" className="h-11 px-5 text-[15px] rounded-xl">Open operator chat <ArrowRight /></Button>
            <button onClick={onReset} className="font-mono text-xs flex items-center gap-1.5" style={{ color: PETROL }}><RotateCcw className="size-3.5" /> Connect a different account</button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Chat({ conn, sub }: { conn: Conn; sub: string }) {
  const [thread, setThread] = useState<ChatMsg[]>([{ role: "anne", text: `Connected to ${sub}.zendesk.com. Ask me to triage, search, update, or hand off a ticket. I'm in dry-run — flip the switch for live writes.` }]);
  const [convo, setConvo] = useState<Msg[]>([]);
  const [calls, setCalls] = useState<TraceEntry[]>([]);
  const [embed, setEmbed] = useState<string | null>(null);
  const [mode, setMode] = useState<"dry" | "live">("dry");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    const nextThread: ChatMsg[] = [...thread, { role: "user", text }];
    setThread(nextThread);
    const nextConvo: Msg[] = [...convo, { role: "user", content: text }];
    try {
      const d = await agent(conn, nextConvo, mode);
      setConvo(d.messages);
      setThread([...nextThread, { role: "anne", text: d.reply }]);
      if (d.trace?.length) {
        setCalls((c) => [...c, ...d.trace]);
        const e = d.trace.find((x) => x.tool === "goblin_start_embodied_session" && /^https?:/.test(String(x.summary)));
        if (e) setEmbed(String(e.summary));
      }
    } catch (e2) {
      setThread([...nextThread, { role: "sys", text: (e2 as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div {...rise} className="flex flex-col h-[560px] -m-1">
      <div className="flex items-center mb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: PETROL }}>Operate · {sub}.zendesk.com</p>
        <button onClick={() => setMode((m) => (m === "dry" ? "live" : "dry"))} className="ml-auto flex items-center gap-2.5 font-mono text-[11px] text-muted-foreground" aria-pressed={mode === "live"}>
          <span className="text-foreground/70">{mode === "live" ? "Live writes" : "Dry-run"}</span>
          <span className="relative w-11 h-[23px] rounded-full transition-colors" style={{ background: mode === "live" ? HONEY : "#D8D0C2" }}>
            <span className="absolute top-0.5 size-[19px] rounded-full bg-white shadow transition-all" style={{ left: mode === "live" ? 21 : 2 }} />
          </span>
        </button>
      </div>

      <div className="grid md:grid-cols-[1.45fr_.55fr] gap-5 flex-1 min-h-0">
        <div className="flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1.5">
            {thread.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={m.role === "user" ? "self-end max-w-[88%] text-right" : "max-w-[88%]"}>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{m.role === "user" ? "You" : m.role === "sys" ? "Anne · verify" : "Anne"}</div>
                <div className={m.role === "user" ? "px-3.5 py-2.5 rounded-2xl rounded-br-sm bg-primary text-primary-foreground text-sm whitespace-pre-wrap" : m.role === "sys" ? "px-3.5 py-2.5 rounded-2xl text-sm border whitespace-pre-wrap" : "px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-muted border border-border text-sm"} style={m.role === "sys" ? { background: "#FBF3E4", borderColor: HONEY, color: HONEY } : undefined}>{m.role === "anne" ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div> : m.text}</div>
              </motion.div>
            ))}
            {busy && <div className="max-w-[88%]"><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Anne</div><div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-muted border border-border text-sm">…</div></div>}
            {embed && <a href={embed} target="_blank" rel="noopener" className="inline-flex items-center gap-2 font-mono text-xs px-3.5 py-2.5 rounded-xl no-underline w-fit" style={{ background: "#0E2B2A", color: "#F6ECD9", border: `1px solid ${HONEY}` }}>▶ Open live session with Anne</a>}
          </div>
          <div className="flex gap-2.5 mt-3.5">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const t = input; setInput(""); send(t); } }} placeholder="Ask Anne to do something…" autoComplete="off" className="flex-1 bg-background border border-input rounded-xl px-3.5 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 transition" />
            <Button onClick={() => { const t = input; setInput(""); send(t); }} size="lg" className="h-auto px-5 rounded-xl">Send</Button>
          </div>
        </div>

        <aside className="border-l border-border pl-4 flex flex-col min-h-0">
          <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Tool activity</h4>
          <div className="flex-1 overflow-y-auto">
            {calls.map((c, i) => (
              <div key={i} className="font-mono text-[11px] mb-2.5">
                <span style={{ color: c.ok ? PETROL : "var(--destructive)" }}>{c.tool}</span>
                <span className="block text-muted-foreground mt-0.5 break-words">→ {String(c.summary)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-3 mt-2.5 border-t border-border">
            {["How many open tickets?", "Find tickets solved over 30 days", "Ticket #54 needs a human"].map((c) => (
              <button key={c} onClick={() => send(c)} className="font-mono text-[11px] border border-border bg-muted/50 rounded-full px-2.5 py-1.5 text-muted-foreground hover:text-foreground transition">{c}</button>
            ))}
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
