(() => {
  const COND = document.body.dataset.cond;
  const IS_AI = COND === "ai";
  const OWN_LIVE = !!window.OWN_DTYPE && window.OWN_DTYPE !== "off";
  const NAMES = { about_right: "About right", too_high: "Too high", too_low: "Too low" };
  let S = null;        // {session_id, order, trials}
  let idx = 0;         // current trial index
  let st = {};         // per-trial state
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));

  document.body.classList.add(IS_AI ? "is-ai" : "is-noai");

  async function post(url, body) {
    const headers = { "Content-Type": "application/json" };
    if (window.SB_PUBLIC_KEY) { headers.apikey = window.SB_PUBLIC_KEY; headers.Authorization = "Bearer " + window.SB_PUBLIC_KEY; }
    const r = await fetch(window.API + url.replace("/api", ""), { method: "POST", headers, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch (e) { /* ignore */ }
    if (!r.ok) throw new Error(j.error || `Server error (${r.status}) — please try again.`);
    return j;
  }

  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
  }
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));

  // ---------- confidence widget (1–5) ----------
  function confHTML(name) {
    return `<p class="lbl">How confident are you in this answer?</p><div class="conf" data-name="${name}">` +
      [1, 2, 3, 4, 5].map((v) => `<button data-c="${v}">${v}</button>`).join("") +
      `</div><div class="conf-ends"><span>not at all</span><span>very</span></div>`;
  }
  $$(".conf-block").forEach((el, i) => (el.innerHTML = confHTML("c" + i)));
  document.addEventListener("click", (e) => {
    const c = e.target.closest(".conf button");
    if (c) { c.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b === c)); st.conf = +c.dataset.c; }
    const v = e.target.closest(".verdicts .v");
    if (v) {
      const grp = v.parentElement;
      grp.querySelectorAll(".v").forEach((b) => b.classList.toggle("sel", b === v));
      st[grp.dataset.name] = v.dataset.v;
    }
  });

  // ---------- start ----------
  $("#btn-start").addEventListener("click", async () => {
    $("#start-err").textContent = "";
    try {
      S = await post("/api/start", { participant_id: $("#pid").value, condition: COND, ua: navigator.userAgent });
      S.trials.forEach((t) => { t.img = window.ASSET + "img/" + t.dish + ".jpg"; const im = new Image(); im.src = t.img; }); // preload photos
      if (IS_AI && window.OwnModel && OWN_LIVE) window.OwnModel.load().catch(() => {}); // start loading the browser-side CLIP model
      show("s-instr");
    } catch (e) { $("#start-err").textContent = e.message; }
  });

  // ---------- quiz ----------
  $("#btn-quiz").addEventListener("click", async () => {
    const ans = {};
    ["q1", "q2", "q3"].forEach((q) => { const el = document.querySelector(`input[name=${q}]:checked`); if (el) ans[q] = el.value; });
    try {
      const r = await post("/api/quiz", { session_id: S.session_id, answers: ans });
      if (r.ok) { startTrial(0); }
      else if (r.terminated) { show("s-term"); }
      else { $("#quiz-msg").textContent = `Not quite — please re-read the instructions and try again (${r.attempts_left} tries left).`; }
    } catch (e) { $("#quiz-msg").textContent = e.message; }
  });

  // ---------- trials ----------
  function setProgress() {
    const n = S.trials.length;
    $("#progress-text").textContent = `Meal ${Math.min(idx + 1, n)} of ${n}`;
    $("#progress-bar").style.width = `${(100 * idx) / n}%`;
  }

  function resetSel(root) {
    root.querySelectorAll(".sel").forEach((b) => b.classList.remove("sel"));
  }

  function startTrial(i) {
    idx = i;
    const t = S.trials[i];
    st = { t0: performance.now(), pos: t.pos, attention: t.attention };
    show("s-trial");
    setProgress();
    $("#t-img").src = t.img;
    $("#t-logged").textContent = t.logged_kcal;
    $("#t-attention").textContent = t.attention
      ? `Attention check: for this meal, please select "Too low" and type ${window.CATCH.kcal} as your estimate.` : "";
    $("#t-attention").style.display = t.attention ? "block" : "none";
    resetSel(document.getElementById("s-trial"));
    $("#initial-kcal").value = ""; $("#final-kcal").value = "";
    $("#initial-kcal").disabled = false;
    $$("#step1 .v").forEach((b) => (b.disabled = false));
    ["#step1-err", "#step2-err", "#rev-status"].forEach((q) => ($(q).textContent = ""));
    $("#rev-out").innerHTML = ""; $("#rev-msg").value = "";
    $("#ai-panel").classList.add("hidden"); $("#step2").classList.add("hidden");
    $("#ai-loading").classList.remove("hidden"); $("#ai-content").classList.add("hidden");
    const step1Btn = $("#btn-step1");
    step1Btn.disabled = false;
    step1Btn.textContent = IS_AI && !t.attention ? "Submit my answer & see the AI analysis" : (i === S.trials.length - 1 ? "Submit & finish" : "Submit & next meal");
    // attention trial in AI condition: single step, so show a confidence widget in step 1 too
    $("#step1 .conf-block").style.display = (!IS_AI || t.attention) ? "block" : "none";
    post("/api/view", { session_id: S.session_id, pos: t.pos }).catch(() => {});
    st.own = (IS_AI && !t.attention) ? ownPredict(t.dish) : null;
  }

  // own model (CLIP ViT-B/32 + MLP head) runs in the participant's browser; null result -> server shows A2 prediction
  async function ownPredict(dish) {
    if (!OWN_LIVE) return { error: "browser model disabled (A2 prediction shown)" };
    if (!window.OwnModel) return { error: "own model script not loaded" };
    try {
      const r = await Promise.race([window.OwnModel.predict(window.ASSET + "png/" + dish + ".png"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("own model timeout")), 25000))]);
      return r;
    } catch (e) { return { error: String(e.message || e).slice(0, 80) }; }
  }

  function readKcal(sel) {
    const v = $(sel).value.trim();
    if (v === "" || isNaN(+v) || +v < 0 || +v > 5000) return null;
    return Math.round(+v);
  }

  $("#btn-step1").addEventListener("click", async () => {
    const t = S.trials[idx];
    const k = readKcal("#initial-kcal");
    const singleStep = !IS_AI || t.attention;
    if (!st.initial || k === null || (singleStep && !st.conf)) {
      $("#step1-err").textContent = singleStep ? "Please choose an answer, enter your estimate, and rate your confidence." : "Please choose an answer and enter your estimate.";
      return;
    }
    st.initial_kcal = k;
    st.t_step1 = performance.now();
    if (singleStep) { return submit({ initial_verdict: st.initial, initial_kcal: k, confidence: st.conf }); }
    // AI condition: lock step 1, fetch AI
    $("#btn-step1").disabled = true; $("#initial-kcal").disabled = true;
    $$("#step1 .v").forEach((b) => (b.disabled = true));
    $("#ai-panel").classList.remove("hidden");
    try {
      const own = st.own ? await Promise.race([st.own, new Promise((r) => setTimeout(() => r({ error: "not ready in time" }), 6000))]) : null;
      const a = await post("/api/ai", { session_id: S.session_id, pos: t.pos, own });
      renderAI(a, t.logged_kcal);
      st.t_ai = performance.now();
      $("#ai-loading").classList.add("hidden"); $("#ai-content").classList.remove("hidden");
      // prefill step 2 with the initial answer
      st.final = st.initial;
      $$("#step2 .v").forEach((b) => b.classList.toggle("sel", b.dataset.v === st.initial));
      $("#final-kcal").value = k;
      st.conf = null; $$("#step2 .conf button").forEach((b) => b.classList.remove("sel"));
      $("#step2").classList.remove("hidden");
      $("#btn-step2").textContent = idx === S.trials.length - 1 ? "Submit final answer & finish" : "Submit final answer & next meal";
    } catch (e) {
      $("#ai-loading").textContent = "The AI could not be reached: " + e.message + " — reload the page to retry.";
    }
  });

  $("#btn-step2").addEventListener("click", () => {
    const k = readKcal("#final-kcal");
    if (!st.final || k === null || !st.conf) { $("#step2-err").textContent = "Please choose a final answer, enter your estimate, and rate your confidence."; return; }
    submit({ initial_verdict: st.initial, initial_kcal: st.initial_kcal, final_verdict: st.final, final_kcal: k, confidence: st.conf });
  });

  async function submit(body) {
    // Guard against double clicks: without it a second click while the request was in flight advanced
    // two meals at once and silently skipped the next one (seen twice in the in-class session, Nov 12).
    if (st.submitting) return;
    st.submitting = true;
    const cur = idx;
    $$("#btn-step1, #btn-step2").forEach((b) => (b.disabled = true));
    const now = performance.now();
    body.timing = { step1_ms: Math.round((st.t_step1 || now) - st.t0), ai_view_ms: st.t_ai ? Math.round(now - st.t_ai) : null, total_ms: Math.round(now - st.t0) };
    try {
      await post("/api/response", { session_id: S.session_id, pos: S.trials[idx].pos, ...body });
    } catch (e) {
      st.submitting = false;
      $$("#btn-step1, #btn-step2").forEach((b) => (b.disabled = false));
      const el = IS_AI && !S.trials[idx].attention ? "#step2-err" : "#step1-err"; $(el).textContent = e.message; return;
    }
    if (idx !== cur) return;
    $("#btn-step2").disabled = false;
    if (idx + 1 < S.trials.length) startTrial(idx + 1);
    else { idx = S.trials.length; setProgress(); buildSurvey(); show("s-survey"); }
  }

  // ---------- AI panel ----------
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function pill(el, v) { el.className = "pill " + v; el.textContent = "→ " + NAMES[v]; }

  function renderAI(a, logged) {
    const g = a.gemini, o = a.own;
    $("#g-total").textContent = g.total_kcal; pill($("#g-verdict"), g.verdict);
    $("#g-conf").textContent = g.confidence;
    $("#g-ingr").innerHTML = "<tr><th>Food</th><th>Est. grams</th><th>Est. kcal</th></tr>" +
      (g.ingredients || []).map((x) => `<tr><td>${esc(x.name)}</td><td>${Math.round(x.est_grams)}</td><td>${Math.round(x.est_kcal)}</td></tr>`).join("");
    $("#g-note").textContent = g.note ? "AI note: " + g.note : "";
    $("#o-total").textContent = o.total_kcal; pill($("#o-verdict"), o.verdict);
    $("#ai-agree").innerHTML = a.agree
      ? `<div class="agree yes">Both AI models reach the same verdict: <b>${NAMES[g.verdict]}</b>.<br><small>In our tests, when the two AIs agreed their verdict was right about 84 % of the time.</small></div>`
      : `<div class="agree no">The two AI models <b>disagree</b> (${NAMES[g.verdict]} vs. ${NAMES[o.verdict]}).<br><small>In our tests, when they disagreed the detailed AI was right only about 42 % of the time — check the portion sizes yourself.</small></div>`;
    drawScale(logged, g.total_kcal, o.total_kcal);
  }

  function drawScale(logged, ge, oe, rev) {
    const mx = Math.max(logged, ge * 1.25, oe, rev || 0) * 1.15;
    const p = (v) => `${Math.min(100, (100 * v) / mx)}%`;
    const m = (v, cls, label) => `<div class="mk ${cls}" style="left:${p(v)}"><span>${label}</span></div>`;
    const ref = rev || ge;
    $("#ai-scale").innerHTML = `<div class="scale">
        <div class="band" style="left:${p(ref * 0.75)};width:calc(${p(ref * 1.25)} - ${p(ref * 0.75)})"></div>
        ${m(logged, "lg", `Logged ${logged}`)}${m(ge, "gem", `Detailed AI ${ge}`)}${m(oe, "own", `2nd AI ${oe}`)}
        ${rev ? m(rev, "rev", `Revised ${rev}`) : ""}
      </div><div class="scale-cap">Green zone = "About right" range around the ${rev ? "revised" : "detailed"} AI estimate (±25 %). If the orange “Logged” mark is inside the green zone the AI says About right; to the right → Too high; to the left → Too low.</div>`;
  }

  $("#btn-rev").addEventListener("click", async () => {
    const msg = $("#rev-msg").value.trim();
    if (!msg) return;
    const t = S.trials[idx];
    $("#btn-rev").disabled = true; $("#rev-status").innerHTML = '<span class="spinner"></span> Re-estimating…';
    try {
      const r = await post("/api/revise", { session_id: S.session_id, pos: t.pos, message: msg });
      $("#rev-status").textContent = "";
      $("#rev-out").insertAdjacentHTML("beforeend", `<div class="rev-card"><div class="muted">You said: “${esc(msg)}”</div>
        <div class="ai-total">Revised: ${r.total_kcal} kcal <span class="pill ${r.verdict}">→ ${NAMES[r.verdict]}</span></div>
        <table class="tbl small"><tr><th>Food</th><th>Est. grams</th><th>Est. kcal</th></tr>${(r.ingredients || []).map((x) => `<tr><td>${esc(x.name)}</td><td>${Math.round(x.est_grams)}</td><td>${Math.round(x.est_kcal)}</td></tr>`).join("")}</table>
        <p class="ai-note">AI note: ${esc(r.note)}</p></div>`);
      drawScale(t.logged_kcal, +$("#g-total").textContent, +$("#o-total").textContent, r.total_kcal);
      $("#rev-msg").value = "";
    } catch (e) { $("#rev-status").textContent = e.message; }
    $("#btn-rev").disabled = false;
  });

  // ---------- survey ----------
  function likert(name, text, lo, hi, n = 7, na = false) {
    return `<div class="q" data-q="${name}"><p>${text}</p><div class="likert">` +
      Array.from({ length: n }, (_, i) => `<label><input type="radio" name="${name}" value="${i + 1}"><span>${i + 1}</span></label>`).join("") +
      (na ? `<label class="na"><input type="radio" name="${name}" value="na"><span>did not use</span></label>` : "") +
      `</div><div class="conf-ends"><span>${lo}</span><span>${hi}</span></div></div>`;
  }
  function choice(name, text, opts) {
    return `<div class="q" data-q="${name}"><p>${text}</p>` + opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}"> ${l}</label>`).join("") + "</div>";
  }
  function buildSurvey() {
    let h = likert("overall_conf", "Overall, how confident are you in your answers?", "not at all", "very") +
      likert("mental_demand", "How mentally demanding was this task?", "very low", "very high");
    if (IS_AI) {
      h += likert("trust", "I trusted the AI's calorie analysis.", "strongly disagree", "strongly agree") +
        likert("reliable", "The AI's analysis was reliable.", "strongly disagree", "strongly agree") +
        likert("breakdown_helpful", "The ingredient breakdown helped me judge the logged value.", "strongly disagree", "strongly agree") +
        likert("correction_useful", "Being able to tell the AI what it got wrong was useful.", "strongly disagree", "strongly agree", 7, true) +
        likert("would_use", "I would want this AI check in a food-diary app I use.", "strongly disagree", "strongly agree") +
        choice("relied_on", "Which AI did you rely on more?", [["detailed", "Detailed AI (Gemini)"], ["second", "Second-opinion AI"], ["both", "Both equally"], ["neither", "Neither — mostly my own judgment"]]);
    }
    if (S.order === 1) h += likert("calorie_experience", "How experienced are you with estimating food calories (e.g. calorie tracking)?", "none", "a lot", 5);
    h += `<div class="q"><p>${IS_AI ? "What did you like or dislike about the AI assistance?" : "Any comments about the task?"} <span class="muted">(optional)</span></p><textarea name="comment" rows="3"></textarea></div>`;
    $("#survey").innerHTML = h;
  }
  $("#btn-survey").addEventListener("click", async () => {
    const f = new FormData($("#survey")); const ans = {};
    for (const [k, v] of f.entries()) ans[k] = v;
    const req = $$("#survey .q[data-q]").map((q) => q.dataset.q);
    if (req.some((k) => !(k in ans))) { $("#survey-err").textContent = "Please answer all rating questions."; return; }
    try {
      const r = await post("/api/survey", { session_id: S.session_id, answers: ans });
      $("#done-code").textContent = r.code;
      $("#done-next").innerHTML = r.did_other ? "You have finished <b>both</b> conditions of this study."
        : `Please remember to also complete the <b>${r.other === "ai" ? "With AI" : "Without AI"}</b> condition of this study (link in the class spreadsheet), using the same uniqname.`;
      show("s-done");
    } catch (e) { $("#survey-err").textContent = e.message; }
  });

  show("s-welcome");
})();
