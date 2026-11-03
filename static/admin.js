// Admin page: live progress + CSV export (same CSV layout the analysis script expects).
const $ = (q) => document.querySelector(q);
let DATA = null, timer = null;
try { $("#key").value = sessionStorage.getItem("a3key") || ""; } catch (e) {}

function headers() {
  const h = {};
  if (window.SB_PUBLIC_KEY) { h.apikey = window.SB_PUBLIC_KEY; h.Authorization = "Bearer " + window.SB_PUBLIC_KEY; }
  return h;
}
function flatten(table, r) {
  const d = { ...r.data };
  const out = { id: r.id, session_id: r.session_id, participant_id: r.participant_id, condition: r.condition };
  if (table === "sessions") {
    const sv = d.survey || {}; delete d.survey;
    for (const [k, v] of Object.entries(sv)) out["survey_" + k] = v;
  }
  for (const [k, v] of Object.entries(d)) {
    if (k in out) continue;
    out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  }
  return out;
}
function toCSV(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => { if (v === undefined || v === null) return ""; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name; a.click();
}
async function load() {
  const key = $("#key").value.trim();
  try { sessionStorage.setItem("a3key", key); } catch (e) {}
  const r = await fetch(`${window.API}/admin?key=${encodeURIComponent(key)}`, { headers: headers() });
  if (!r.ok) { $("#out").innerHTML = `<p class="err">${r.status} — wrong password?</p>`; return; }
  DATA = await r.json();
  render();
  $("#upd").textContent = "updated " + new Date().toLocaleTimeString() + " (auto-refresh 20 s)";
  clearTimeout(timer); timer = setTimeout(load, 20000);
}
function render() {
  const ses = DATA.sessions.map((r) => r.data);
  const done = ses.filter((s) => s.status === "completed" && !/^test/.test(s.participant_id));
  const n = (c) => new Set(done.filter((s) => s.condition === c).map((s) => s.participant_id)).size;
  const rows = ses.slice().sort((a, b) => b.started_at - a.started_at).map((s) =>
    `<tr><td>${s.participant_id}</td><td>${s.condition}</td><td>${s.order}</td><td>${s.status}</td><td>${s.n_answered ?? ""}</td>
     <td>${s.catch_pass ?? ""}</td><td>${s.duration_s ?? ""}</td><td>${s.quiz_attempts}</td><td>${s.completion_code ?? ""}</td>
     <td>${new Date(s.started_at * 1000).toLocaleString()}</td></tr>`).join("");
  const live = DATA.ai_logs.filter((r) => r.data.kind === "initial");
  const liveG = live.filter((r) => r.data.gemini?.source === "live").length;
  const liveO = live.filter((r) => String(r.data.own?.source).startsWith("live")).length;
  $("#out").innerHTML = `
    <p><b>Completed participants (excluding test*):</b> Without AI = ${n("noai")}, With AI = ${n("ai")} &nbsp;(target ≥ 5 each)</p>
    <p class="muted">AI outputs shown: ${live.length} · live Gemini ${liveG} · live browser model ${liveO}</p>
    <p><button class="btn" data-t="sessions">sessions.csv</button><button class="btn" data-t="responses">responses.csv</button>
       <button class="btn" data-t="ai_logs">ai_logs.csv</button></p>
    <h2>Sessions</h2>
    <table class="tbl"><tr><th>uniqname</th><th>cond</th><th>order</th><th>status</th><th>answered</th><th>catch</th><th>time (s)</th>
    <th>quiz tries</th><th>code</th><th>started</th></tr>${rows}</table>
    <h2>Answers (newest first)</h2>
    <p class="muted">Correct answer = ground truth (logged vs. weighed kcal, ±25 %). Only you can see this page (password).
    Green = correct, red = wrong. "AI" columns only in the With-AI condition.</p>
    <table class="tbl small"><tr><th>uniqname</th><th>cond</th><th>meal</th><th>trial</th><th>logged</th><th>true kcal</th>
    <th>correct answer</th><th>first answer</th><th>final answer</th><th>own estimate</th><th>conf</th><th>sec</th>
    <th>Gemini says</th><th>2nd AI says</th><th>corrections</th></tr>${answers()}</table>`;
  document.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () =>
    download(b.dataset.t + ".csv", toCSV(DATA[b.dataset.t].map((r) => flatten(b.dataset.t, r))))));
}
const N = { about_right: "About right", too_high: "Too high", too_low: "Too low" };
function cell(v, label) {
  if (!v) return "<td></td>";
  const ok = v === label;
  return `<td style="color:${ok ? "#1f8a4c" : "#b42318"};font-weight:600">${N[v] || v}</td>`;
}
function answers() {
  return DATA.responses.map((r) => ({ pid: r.participant_id, cond: r.condition, ...r.data }))
    .sort((a, b) => b.ts - a.ts).map((d) => `<tr>
      <td>${d.pid}</td><td>${d.cond}</td><td>${d.pos + 1}${d.is_catch ? " (attention check)" : ""}</td><td>${d.trial_id}</td>
      <td>${d.logged_kcal}</td><td>${Math.round(d.true_kcal)}</td><td><b>${d.is_catch ? "Too low (instructed)" : N[d.label]}</b></td>
      ${d.is_catch ? `<td></td>${cell(d.final_verdict, "too_low")}` : `${d.cond === "ai" ? cell(d.initial_verdict, d.label) : "<td></td>"}${cell(d.final_verdict, d.label)}`}
      <td>${d.final_kcal ?? ""}</td><td>${d.confidence ?? ""}</td><td>${d.rt_total_s ?? ""}</td>
      ${d.ai_gemini_verdict ? cell(d.ai_gemini_verdict, d.label).replace("</td>", ` <small>(${d.ai_gemini_kcal}, ${String(d.ai_gemini_source).startsWith("live") ? "live" : "cached"})</small></td>`) : "<td></td>"}
      ${d.ai_own_verdict ? cell(d.ai_own_verdict, d.label).replace("</td>", ` <small>(${d.ai_own_kcal}, ${String(d.ai_own_source).startsWith("live") ? "live" : "cached"})</small></td>`) : "<td></td>"}
      <td>${d.n_revisions ?? ""}</td></tr>`).join("");
}
$("#go").addEventListener("click", load);
