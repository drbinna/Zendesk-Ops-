/* help-widget.js — embeddable self-service search for any product or website.
 *
 * Embed on a customer's site with one tag:
 *   <script src="https://YOUR-APP.vercel.app/help-widget.js"
 *           data-endpoint="https://YOUR-APP.vercel.app/api/help"
 *           data-title="Help"
 *           data-accent="#0E6E6B"
 *           data-contact="https://acme.com/contact"></script>
 *
 * It mounts a launcher in the corner. Asking a question calls /api/help, which
 * answers ONLY from the Help Center and shows the source articles it used. When
 * the knowledge base has no answer, it says so and (server-side) logs the gap.
 *
 * Everything lives in a Shadow DOM, so host-page CSS can't touch it and vice versa.
 */
(function () {
  "use strict";
  var s = document.currentScript || (function () { var a = document.getElementsByTagName("script"); return a[a.length - 1]; })();
  var cfg = {
    endpoint: s.getAttribute("data-endpoint") || (new URL(s.src).origin + "/api/help"),
    title: s.getAttribute("data-title") || "Help",
    accent: s.getAttribute("data-accent") || "#0E6E6B",
    contact: s.getAttribute("data-contact") || "",
    placeholder: s.getAttribute("data-placeholder") || "Ask a question…",
  };

  var host = document.createElement("div");
  host.setAttribute("data-help-widget", "");
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '.launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;' +
      'padding:12px 16px;border:0;border-radius:999px;cursor:pointer;color:#fff;font-size:14px;font-weight:600;' +
      'background:var(--accent);box-shadow:0 8px 24px rgba(0,0,0,.22);transition:transform .15s ease}' +
    '.launch:hover{transform:translateY(-1px)}' +
    '.launch:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 50%,#fff);outline-offset:2px}' +
    '.panel{position:fixed;right:20px;bottom:84px;z-index:2147483000;width:360px;max-width:calc(100vw - 32px);' +
      'max-height:min(560px,calc(100vh - 120px));display:none;flex-direction:column;overflow:hidden;' +
      'background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28)}' +
    '.panel.open{display:flex;animation:rise .18s ease}' +
    '@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.panel.open{animation:none}.launch{transition:none}}' +
    '.head{display:flex;align-items:center;gap:8px;padding:14px 16px;color:#fff;background:var(--accent)}' +
    '.head b{font-size:15px;font-weight:700;flex:1}' +
    '.x{border:0;background:transparent;color:#fff;opacity:.85;cursor:pointer;font-size:18px;line-height:1;padding:4px}' +
    '.x:hover{opacity:1}' +
    '.body{padding:14px 16px;overflow:auto;flex:1}' +
    '.ask{display:flex;gap:8px;padding:12px 16px;border-top:1px solid rgba(0,0,0,.07)}' +
    '.ask input{flex:1;min-width:0;padding:10px 12px;font-size:14px;border:1px solid rgba(0,0,0,.18);border-radius:10px;outline:none}' +
    '.ask input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}' +
    '.ask button{border:0;border-radius:10px;padding:0 14px;cursor:pointer;color:#fff;font-weight:600;background:var(--accent)}' +
    '.ask button:disabled{opacity:.5;cursor:default}' +
    '.hint{color:#667085;font-size:13px;line-height:1.5}' +
    '.answer{font-size:14px;line-height:1.6;color:#1d2433;white-space:pre-wrap}' +
    '.srcs{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px}' +
    '.srcs a{display:inline-flex;align-items:center;gap:5px;max-width:100%;text-decoration:none;font-size:12px;' +
      'color:#344054;background:#f2f4f7;border:1px solid rgba(0,0,0,.06);border-radius:8px;padding:5px 9px;overflow:hidden}' +
    '.srcs a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.srcs a:hover{background:#e9edf2}' +
    '.lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#98a2b3;margin:0 0 6px}' +
    '.gap{font-size:14px;line-height:1.6;color:#1d2433}' +
    '.gap a{color:var(--accent);font-weight:600}' +
    '.err{font-size:13px;color:#b42318}' +
    '.spin{display:inline-block;width:16px;height:16px;border:2px solid rgba(0,0,0,.15);border-top-color:var(--accent);' +
      'border-radius:50%;animation:sp .7s linear infinite;vertical-align:-3px;margin-right:8px}' +
    '@keyframes sp{to{transform:rotate(360deg)}}' +
    '</style>' +
    '<button class="launch" part="launch" aria-haspopup="dialog" aria-expanded="false">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17h.01M9.1 9a3 3 0 1 1 4.4 2.6c-.8.5-1.5 1.2-1.5 2.4"/></svg>' +
      '<span class="lt"></span></button>' +
    '<div class="panel" role="dialog" aria-modal="false" aria-label="Help">' +
      '<div class="head"><b class="ht"></b><button class="x" aria-label="Close">✕</button></div>' +
      '<div class="body"><p class="hint"></p></div>' +
      '<div class="ask"><input type="text" aria-label="Your question" /><button>Ask</button></div>' +
    '</div>';

  host.style.setProperty("--accent", cfg.accent);
  root.host.style.setProperty("--accent", cfg.accent);
  var panel = root.querySelector(".panel");
  panel.style.setProperty("--accent", cfg.accent);
  root.querySelector(".launch").style.setProperty("--accent", cfg.accent);

  var launch = root.querySelector(".launch");
  var bodyEl = root.querySelector(".body");
  var input = root.querySelector(".ask input");
  var askBtn = root.querySelector(".ask button");
  root.querySelector(".lt").textContent = cfg.title;
  root.querySelector(".ht").textContent = cfg.title;
  input.placeholder = cfg.placeholder;
  root.querySelector(".hint").textContent = "Search our help center. Answers come straight from our published articles.";

  function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

  function open() { panel.classList.add("open"); launch.setAttribute("aria-expanded", "true"); setTimeout(function () { input.focus(); }, 50); }
  function close() { panel.classList.remove("open"); launch.setAttribute("aria-expanded", "false"); launch.focus(); }
  launch.addEventListener("click", function () { panel.classList.contains("open") ? close() : open(); });
  root.querySelector(".x").addEventListener("click", close);
  root.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  function render(html) { bodyEl.innerHTML = html; bodyEl.scrollTop = 0; }

  async function ask() {
    var q = input.value.trim();
    if (q.length < 3) return;
    askBtn.disabled = true;
    render('<p class="hint"><span class="spin"></span>Looking through the help center…</p>');
    try {
      var r = await fetch(cfg.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      var d = await r.json();
      if (!d.ok) throw new Error(d.error || "Something went wrong.");

      if (d.answer) {
        var srcs = (d.sources || []).map(function (s) {
          return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7M21 3l-9 9M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>' +
            '<span>' + esc(s.title) + "</span></a>";
        }).join("");
        render('<div class="answer">' + esc(d.answer).replace(/\[(\d+)\]/g, '<sup>[$1]</sup>') + "</div>" +
          (srcs ? '<p class="lbl" style="margin-top:14px">Sources</p><div class="srcs">' + srcs + "</div>" : ""));
      } else {
        // Honest empty state — the gap was logged server-side.
        var contact = cfg.contact ? ' <a href="' + esc(cfg.contact) + '" target="_blank" rel="noopener">Contact us</a> and we\'ll help directly.' : "";
        render('<div class="gap"><b>We don\'t have an answer for that yet.</b><br>' +
          "Our support team has been notified so we can add it." + contact + "</div>");
      }
    } catch (e) {
      render('<p class="err">' + esc(e.message || "Couldn’t reach the help center. Try again in a moment.") + "</p>");
    } finally {
      askBtn.disabled = false;
    }
  }

  askBtn.addEventListener("click", ask);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") ask(); });
})();
