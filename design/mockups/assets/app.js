/* CF AGENT FACTORY · shared shell + motion helpers.
   Each sheet sets <body data-sheet="04" data-title="..."> and includes
   <div id="rail"></div> + <header id="topbar"></header> placeholders. */
(function () {
  const SHEETS = [
    { group: "Văn phòng · Office", items: [
      { no: "25", file: "25-office-hq.html", vi: "Tòa văn phòng" },
      { no: "26", file: "26-workstation.html", vi: "Bàn làm việc" }
    ]},
    { group: "Vận hành · Operate", items: [
      { no: "01", file: "01-factory-floor.html", vi: "Sàn nhà máy" },
      { no: "09", file: "09-control-room.html", vi: "Phòng điều khiển" },
      { no: "11", file: "11-flow-motion.html", vi: "Luồng vận hành" },
      { no: "10", file: "10-activity.html", vi: "Nhật ký hoạt động" }
    ]},
    { group: "Sản xuất · Produce", items: [
      { no: "04", file: "04-mission-line.html", vi: "Dây chuyền nhiệm vụ" },
      { no: "06", file: "06-pick-task.html", vi: "Trạm nhận việc" },
      { no: "05", file: "05-work-order.html", vi: "Phiếu công việc" },
      { no: "12", file: "12-approval-gate.html", vi: "Cổng phê duyệt", badge: "2" },
      { no: "13", file: "13-qc-review.html", vi: "Trạm nghiệm thu", badge: "2" }
    ]},
    { group: "Nhân lực · Workforce", items: [
      { no: "07", file: "07-workforce.html", vi: "Đội ngũ Agent" },
      { no: "08", file: "08-agent-profile.html", vi: "Hồ sơ Agent" },
      { no: "02", file: "02-departments.html", vi: "Phòng ban" },
      { no: "03", file: "03-department-detail.html", vi: "Chi tiết phòng ban" },
      { no: "21", file: "21-hr-teams.html", vi: "Nhân sự & Thành viên" }
    ]},
    { group: "Đời sống · Life", items: [
      { no: "14", file: "14-meeting-room.html", vi: "Phòng họp" },
      { no: "15", file: "15-lounge.html", vi: "Khu giải trí" },
      { no: "16", file: "16-scenarios.html", vi: "Kịch bản mô phỏng" },
      { no: "17", file: "17-mailroom.html", vi: "Phòng thư" }
    ]},
    { group: "Hạ tầng · Infrastructure", items: [
      { no: "18", file: "18-warehouse.html", vi: "Kho Artifact" },
      { no: "19", file: "19-security-gate.html", vi: "Cổng an ninh" },
      { no: "22", file: "22-loading-dock.html", vi: "Bến kết nối" },
      { no: "20", file: "20-maintenance.html", vi: "Phòng bảo trì" },
      { no: "23", file: "23-settings.html", vi: "Cấu hình nhà máy" },
      { no: "24", file: "24-onboarding.html", vi: "Khởi công" }
    ]}
  ];
  const TOTAL = 26;
  const THEMES = [
    { id: "blueprint", vi: "Blueprint", sw: ["#0a2342", "#e8f3ff", "#5ccfff"] },
    { id: "paper", vi: "Giấy trắng", sw: ["#f7f9fc", "#0d2a4f", "#0a76b3"] },
    { id: "graphite", vi: "Graphite", sw: ["#181c21", "#eef2f6", "#5fe3b0"] },
    { id: "cad", vi: "CAD xanh lá", sw: ["#0a241c", "#e6fff4", "#7dffb5"] },
    { id: "sunset", vi: "Hoàng hôn", sw: ["#26152f", "#fff1ea", "#ffbf5e"] }
  ];
  // apply saved theme as early as possible
  try { const qp = new URLSearchParams(location.search).get("theme"); if (qp) localStorage.setItem("cfaf-theme", qp); } catch (e) {}
  try { const t = new URLSearchParams(location.search).get("theme") || localStorage.getItem("cfaf-theme"); if (t && t !== "blueprint") document.documentElement.dataset.theme = t; } catch (e) {}

  const BP = (window.BP = {
    sheets: SHEETS,
    themes: THEMES,
    theme() { return document.documentElement.dataset.theme || "blueprint"; },
    setTheme(id) {
      if (id === "blueprint") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = id;
      try { localStorage.setItem("cfaf-theme", id); } catch (e) {}
      document.querySelectorAll("[data-theme-pick]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themePick === id)));
      document.dispatchEvent(new CustomEvent("bp:theme", { detail: { theme: id } }));
    },
    paused: false,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    F: window.FACTORY || {},

    /* ---------- tiny DOM helpers ---------- */
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },
    h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; },
    rand(a, b) { return a + Math.random() * (b - a); },
    pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    now() { const d = new Date(); return d.toTimeString().slice(0, 8); },
    agent(id) { return (BP.F.agents || []).find(a => a.id === id); },
    dept(id) { return (BP.F.departments || []).find(d => d.id === id); },
    task(id) { return (BP.F.tasks || []).find(t => t.id === id); },
    stateChip(s, label) { return `<span class="state ${s}">${label || (BP.F.stateLabel || {})[s] || s}</span>`; },

    /* SVG element factory. IMPORTANT: CSS var() does not work inside SVG
       presentation attributes, so fill/stroke/etc. containing var() are moved
       into inline style automatically. */
    svg(tag, attrs, parent) {
      const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
      const styleProps = ["fill", "stroke", "stop-color", "color", "opacity", "stroke-width", "stroke-dasharray"];
      let style = "";
      for (const k in attrs || {}) {
        const v = attrs[k];
        if (v === "" || v == null) continue;
        if (styleProps.includes(k) && String(v).includes("var(")) style += `${k}:${v};`;
        else if (k === "style") style += v;
        else e.setAttribute(k, v);
      }
      if (style) e.setAttribute("style", style);
      if (parent) parent.appendChild(e);
      return e;
    },

    /* ---------- shell ---------- */
    shell() {
      const body = document.body;
      const sheet = body.dataset.sheet || "00";
      const title = body.dataset.title || document.title;
      const rail = document.getElementById("rail");
      if (rail) {
        rail.outerHTML = `
        <nav class="rail" aria-label="Điều hướng nhà máy">
          <a class="rail-brand" href="index.html" aria-label="Mục lục bản vẽ">
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <rect x="1" y="1" width="28" height="28" fill="none" stroke="var(--line-strong)"/>
              <path d="M5 23V12l6 4V12l6 4V8h8v15z" fill="none" stroke="var(--s-ready)" stroke-width="1.5"/>
              <circle cx="21" cy="5" r="1.6" fill="var(--amber)"/>
            </svg>
            <span><b>AGENT FACTORY</b><small>CF AGENT HUB · BLUEPRINT</small></span>
          </a>
          ${SHEETS.map(g => `
            <div class="rail-group">
              <h6>${g.group}</h6>
              ${g.items.map(i => `
                <a class="nav" href="${i.file}" ${i.no === sheet ? 'aria-current="page"' : ""}>
                  <span class="no">${i.no}</span><span>${i.vi}</span>${i.badge ? `<span class="badge" aria-label="${i.badge} mục cần xử lý">${i.badge}</span>` : ""}
                </a>`).join("")}
            </div>`).join("")}
          <div class="rail-foot">WS · ${(BP.F.workspace || {}).id || "ws"}<br>Bản vẽ mockup · không phải số liệu thật</div>
        </nav>`;
      }
      const top = document.getElementById("topbar");
      if (top) {
        top.outerHTML = `
        <header class="topbar">
          <div class="crumb"><span class="sheet">SHEET ${sheet}/${TOTAL}</span><h1>${title}</h1></div>
          <div class="spacer"></div>
          <div class="search" role="button" tabindex="0" aria-label="Tìm nhanh task, agent, phòng ban">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor"/><path d="M9.5 9.5L13 13" stroke="currentColor"/></svg>
            Tìm task, agent, phòng ban <kbd>Ctrl K</kbd>
          </div>
          <span class="sim-flag" title="Toàn bộ số liệu là dữ liệu mô phỏng">SIM DATA</span>
          <div class="theme-pick" role="group" aria-label="Đổi màu giao diện">
            ${THEMES.map(t => `<button data-theme-pick="${t.id}" aria-pressed="${BP.theme() === t.id}" title="Màu: ${t.vi}" aria-label="Màu ${t.vi}"><i style="background:${t.sw[0]}"></i><i style="background:${t.sw[2]}"></i></button>`).join("")}
          </div>
          <button class="btn sm" id="motionToggle" aria-pressed="false" title="Tạm dừng / tiếp tục chuyển động">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2v8M9 2v8" stroke="currentColor" stroke-width="2"/></svg>
            <span>Dừng motion</span>
          </button>
          <span class="clock">${(BP.F.workspace || {}).shift || ""} · <b id="clock">--:--:--</b></span>
          <span class="me"><span class="av" aria-hidden="true">QĐ</span>Quản đốc</span>
        </header>`;
      }
      const tb = document.getElementById("titleblock");
      if (tb) {
        tb.outerHTML = `
        <footer class="titleblock" aria-label="Khung tên bản vẽ">
          <div><span>Dự án</span><b>CF Agent Hub · AI Factory UI</b></div>
          <div><span>Bản vẽ</span><b>${title}</b></div>
          <div><span>Sheet</span><b>${sheet} / ${TOTAL}</b></div>
          <div><span>Tỉ lệ</span><b>1 : 1 px</b></div>
          <div><span>Trạng thái</span><b>Specified</b></div>
          <div><span>Rev</span><b>${(BP.F.workspace || {}).revision || "R1"} · 2026-10</b></div>
        </footer>`;
      }
      document.querySelectorAll("[data-theme-pick]").forEach(b => b.addEventListener("click", () => {
        // on narrow screens only the active swatch is visible: tapping it cycles themes
        if (window.matchMedia("(max-width: 720px)").matches) {
          const i = THEMES.findIndex(t => t.id === BP.theme());
          BP.setTheme(THEMES[(i + 1) % THEMES.length].id);
        } else BP.setTheme(b.dataset.themePick);
      }));
      // clock
      const tick = () => { const c = document.getElementById("clock"); if (c) c.textContent = BP.now(); };
      tick(); setInterval(tick, 1000);
      // motion toggle
      const mt = document.getElementById("motionToggle");
      if (mt) {
        if (BP.reduced) BP.setPaused(true);
        mt.addEventListener("click", () => BP.setPaused(!BP.paused));
      }
    },

    setPaused(p) {
      BP.paused = p;
      document.documentElement.classList.toggle("motion-paused", p);
      const mt = document.getElementById("motionToggle");
      if (mt) {
        mt.setAttribute("aria-pressed", String(p));
        mt.querySelector("span").textContent = p ? "Chạy motion" : "Dừng motion";
        mt.querySelector("svg").innerHTML = p
          ? '<path d="M3 2l7 4-7 4z" fill="currentColor"/>'
          : '<path d="M3 2v8M9 2v8" stroke="currentColor" stroke-width="2"/>';
      }
      document.querySelectorAll("svg").forEach(s => { try { p ? s.pauseAnimations() : s.unpauseAnimations(); } catch (e) {} });
      document.dispatchEvent(new CustomEvent("bp:motion", { detail: { paused: p } }));
    },

    /* ---------- motion engine ---------- */
    // Move an SVG element (translate) along a <path>. Resolves when done.
    moveAlong(el, path, ms, opts = {}) {
      const len = path.getTotalLength();
      const from = opts.reverse ? len : 0, to = opts.reverse ? 0 : len;
      // reduced motion: jump straight to the end state instead of tweening
      if (BP.reduced && BP.paused) {
        const p = path.getPointAtLength(to);
        el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
        if (opts.onStep) opts.onStep(1, p);
        return new Promise(r => setTimeout(r, 0));
      }
      return new Promise(resolve => {
        let elapsed = 0, last = performance.now();
        const ease = opts.linear ? t => t : t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const step = now => {
          const dt = now - last; last = now;
          if (!BP.paused) elapsed += dt;
          const t = Math.min(1, elapsed / ms);
          const p = path.getPointAtLength(from + (to - from) * ease(t));
          el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
          if (opts.onStep) opts.onStep(t, p);
          t < 1 ? requestAnimationFrame(step) : resolve();
        };
        requestAnimationFrame(step);
      });
    },
    // Loop an element forever along a path.
    loopAlong(el, path, ms, opts = {}) {
      const go = () => BP.moveAlong(el, path, ms, { linear: true, ...opts }).then(() => opts.pingpong ? BP.moveAlong(el, path, ms, { linear: true, reverse: true }).then(go) : go());
      setTimeout(go, opts.delay || 0);
    },
    // Pause-aware wait.
    wait(ms) {
      return new Promise(r => {
        let left = ms, last = performance.now();
        const f = now => { if (!BP.paused || BP.reduced) left -= now - last; last = now; left <= 0 ? r() : requestAnimationFrame(f); };
        requestAnimationFrame(f);
      });
    },
    // Pause-aware interval.
    every(ms, fn) {
      let acc = 0, last = performance.now();
      const f = now => { if (!BP.paused) acc += now - last; last = now; if (acc >= ms) { acc = 0; fn(); } requestAnimationFrame(f); };
      requestAnimationFrame(f);
    },
    // Prepend a row into a .log list, cap length.
    logPush(list, html, max = 40) {
      const li = document.createElement("li"); li.className = "enter"; li.innerHTML = html;
      list.prepend(li);
      while (list.children.length > max) list.lastElementChild.remove();
      return li;
    },
    toast(code, text, ms = 3600) {
      let w = document.querySelector(".toast-wrap");
      if (!w) { w = document.createElement("div"); w.className = "toast-wrap"; w.setAttribute("role", "status"); w.setAttribute("aria-live", "polite"); document.body.appendChild(w); }
      const t = document.createElement("div"); t.className = "toast";
      t.innerHTML = `<span class="code">${code}</span>${text}`;
      w.appendChild(t); setTimeout(() => t.remove(), ms);
    }
  });

  // Pausing CSS animations globally.
  const st = document.createElement("style");
  st.textContent = `.motion-paused *, .motion-paused *::before, .motion-paused *::after { animation-play-state: paused !important; }`;
  document.head.appendChild(st);

  // Include app.js at the END of <body>, after the placeholders, so the shell is
  // built synchronously before page scripts run.
  if (document.getElementById("rail") || document.getElementById("topbar")) BP.shell();
  else document.addEventListener("DOMContentLoaded", BP.shell);
})();
