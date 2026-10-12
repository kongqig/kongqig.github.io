// 红色工具箱 · 浏览器版（v4 重构）
// 桌面(≥1024px)：左侧栏（搜索/快捷/分类竖排常显）+ 右侧内容
// 移动(<1024px)：单列块流；分类为折叠面板，默认收起，选中后自动收起
// 纯静态前端：加载数据 → glob 搜索 → 分类筛选 → 打开 / 复制
// glob 匹配逻辑与 cli/src/glob.rs 保持一致
// 性能策略：卡片一次性构建 + 索引，过滤只切 hidden 不重建 DOM

(() => {
  "use strict";

  const DATA_URL = "./data/websites.json";
  const GUIDE_URL = "./data/guide.json";
  const CONTACTS_URL = "./data/contacts.json";

  // ===== 快捷方式固定清单（按 id 索引）=====
  const QUICK_PICKS = [
    "gov-cn",
    "xuexi-cn",
    "gjzwfw-gov-cn",
    "weather-com-cn",
    "12306-cn",
    "12315-cn",
    "wenshu-court-gov-cn",
    "cnki-net",
    "ceic-ac-cn",
    "cas-cn",
  ];

  // 标签折叠数量
  const CORE_TAG_COUNT = 3;   // 始终显示
  const COMMON_TAG_COUNT = 2; // 折叠时额外显示

  // ===== 工具 =====
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  function debounce(fn, wait) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(t); // 取消挂起的防抖
    return wrapped;
  }

  // ===== glob 匹配（与 cli/src/glob.rs 等价）=====
  function globMatch(pattern, text) {
    if (!pattern.includes("*") && !pattern.includes("?")) {
      return text.toLowerCase().includes(pattern.toLowerCase());
    }
    const p = pattern.toLowerCase(), t = text.toLowerCase();
    let pi = 0, ti = 0, star = -1, matchStart = 0;
    while (ti < t.length) {
      if (pi < p.length && (p[pi] === "?" || p[pi] === t[ti])) { pi++; ti++; }
      else if (pi < p.length && p[pi] === "*") { star = pi; matchStart = ti; pi++; }
      else if (star !== -1) { pi = star + 1; matchStart++; ti = matchStart; }
      else return false;
    }
    while (pi < p.length && p[pi] === "*") pi++;
    return pi === p.length;
  }

  // ===== 状态 =====
  const state = {
    sites: [],
    categories: [],
    activeCategory: "全部",
    searchTerm: "",
    catFilterTerm: "",
    cardIndex: new Map(), // id → 卡片元素（过滤只切 hidden）
  };

  // ===== DOM 引用 =====
  const els = {
    search: $("#search"),
    clearBtn: $("#clear-btn"),
    hintToggle: $("#hint-toggle"),
    searchHint: $("#search-hint"),
    catFold: $("#cat-fold"),
    catNow: $("#cat-now"),
    catFoldCount: $("#cat-fold-count"),
    catFilter: $("#cat-filter"),
    catCount: $("#cat-count"),
    categories: $("#categories"),
    quickPanel: $("#quick-panel"),
    quickGrid: $("#quick-grid"),
    resultCount: $("#result-count"),
    resetBtn: $("#reset-btn"),
    results: $("#results"),
    emptyState: $("#empty-state"),
    errorState: $("#error-state"),
    errMsg: $("[data-err-msg]"),
    headerMeta: $("#header-meta"),
    footerCount: $("#footer-count"),
    toast: $("#toast"),
    guideBtn: $("#guide-btn"),
    guideModal: $("#guide-modal"),
    guideBody: $("#guide-body"),
    guideSearch: $("#guide-search"),
  };

  const isMobile = () => window.matchMedia("(max-width: 1023px)").matches;

  // ===== 渲染：分类列表 =====
  function renderCategories() {
    const q = state.catFilterTerm.trim().toLowerCase();
    const list = q
      ? state.categories.filter((c) => c.name.toLowerCase().includes(q))
      : state.categories;

    const frag = document.createDocumentFragment();
    const makeChip = (name, count) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.category = name;
      b.setAttribute("aria-pressed", String(name === state.activeCategory));
      b.innerHTML = `<span>${esc(name)}</span><span class="n">${count}</span>`;
      b.addEventListener("click", () => selectCategory(name));
      return b;
    };

    frag.appendChild(makeChip("全部", state.sites.length));
    for (const c of list) frag.appendChild(makeChip(c.name, c.count));

    els.categories.innerHTML = "";
    els.categories.appendChild(frag);

    const total = state.categories.length;
    els.catCount.textContent = q
      ? `匹配 ${list.length} / ${total} 个分类`
      : `共 ${total} 个分类`;
    els.catFoldCount.textContent = q
      ? `匹配 ${list.length} / ${total} 个`
      : `共 ${total} 个`;
  }

  function selectCategory(name) {
    state.activeCategory = name;
    els.catNow.textContent = name;
    $$(".chip", els.categories).forEach((el) => {
      el.setAttribute("aria-pressed", String(el.dataset.category === name));
    });
    // 移动端：选完自动收起折叠面板
    if (isMobile()) els.catFold.open = false;
    applyFilters();
  }

  // ===== 渲染：快捷方式 =====
  function renderQuick() {
    const picks = QUICK_PICKS.map((id) => state.sites.find((s) => s.id === id)).filter(Boolean);
    if (!picks.length) { els.quickPanel.hidden = true; return; }
    els.quickPanel.hidden = false;
    els.quickGrid.innerHTML = picks.map((w) => `
      <a class="quick-btn" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer"
         title="${esc(w.name)} — ${esc(w.url)}">${esc(w.name)}</a>
    `).join("");
  }

  // ===== 渲染：卡片（分帧构建 + 索引，避免 341 张同帧插入卡顿）=====
  function buildCards(chunkSize = 50) {
    const list = state.sites;
    state.cardIndex.clear();
    els.results.innerHTML = "";

    let i = 0;

    function step() {
      const frag = document.createDocumentFragment();
      const end = Math.min(i + chunkSize, list.length);

      for (; i < end; i++) {
        const w = list[i];
        const card = document.createElement("article");
        card.className = "card";
        card.dataset.id = w.id;

        const kw = String(w.keywords || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        const core = kw.slice(0, CORE_TAG_COUNT);
        const common = kw.slice(CORE_TAG_COUNT);

        let tagsHtml = core.map((k) => `<span class="tag" data-kw="${esc(k)}">${esc(k)}</span>`).join("");
        if (common.length) {
          tagsHtml += common.map((k, idx) =>
            `<span class="tag${idx >= COMMON_TAG_COUNT ? " tag--extra" : ""}" data-kw="${esc(k)}">${esc(k)}</span>`
          ).join("");
          if (common.length > COMMON_TAG_COUNT) {
            tagsHtml += `<span class="tag tag--more">+${common.length - COMMON_TAG_COUNT}</span>`;
          }
        }

        card.innerHTML = `
          <div class="card-top">
            <span class="card-cat">${esc(w.category)}</span>
            <span class="card-id">${esc(w.id)}</span>
          </div>
          <h3 class="card-name">${esc(w.name)}</h3>
          <p class="card-desc" title="${esc(w.description)}">${esc(w.description)}</p>
          <div class="card-tags">${tagsHtml}</div>
          <button class="card-toggle" type="button" aria-expanded="false" hidden>
            展开 <span class="chev">▾</span>
          </button>
          <a class="card-url" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(w.url)}</a>
          <div class="card-actions">
            <a class="btn btn--primary" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">打开网站</a>
            <button class="btn btn--ghost" type="button" data-copy>复制网址</button>
          </div>
        `;

        // 只标记候选，不做 scrollHeight 测量（后置批量测量）
        if (common.length > COMMON_TAG_COUNT) card.dataset.hasExtraTags = "1";

        // 标签点击 → 搜索
        $$(".tag[data-kw]", card).forEach((tag) => {
          tag.title = `点击搜索「${tag.dataset.kw}」`;
          tag.addEventListener("click", () => {
            const k = tag.dataset.kw;
            onSearch.cancel();
            els.search.value = k;
            els.clearBtn.hidden = false;
            state.searchTerm = k;
            applyFilters();
            // 移动端聚焦会弹键盘，这里只滚动不动焦点
            $(".results-meta").scrollIntoView({ behavior: "smooth", block: "start" });
          });
        });

        $("[data-copy]", card).addEventListener("click", (e) => copyUrl(w.url, e.currentTarget));

        state.cardIndex.set(w.id, card);
        frag.appendChild(card);
      }

      els.results.appendChild(frag);

      if (i < list.length) requestAnimationFrame(step);
      else {
        applyFilters(); // 全部就绪后再算显隐
        requestAnimationFrame(decorateCards); // 全部插入后再批量测量展开按钮
      }
    }

    step();
  }

  // 批量读 → 批量写，避免逐卡片强制同步布局
  function decorateCards() {
    const needToggle = [];
    for (const card of state.cardIndex.values()) {
      const descEl = $(".card-desc", card);
      const needDesc = descEl.scrollHeight > descEl.clientHeight + 1;
      const needTags = card.dataset.hasExtraTags === "1";
      if (needDesc || needTags) needToggle.push(card);
    }
    for (const card of needToggle) {
      const toggle = $(".card-toggle", card);
      toggle.hidden = false;
      toggle.addEventListener("click", () => {
        const open = card.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        toggle.innerHTML = open
          ? `收起 <span class="chev">▾</span>`
          : `展开 <span class="chev">▾</span>`;
      });
    }
  }

  // ===== 过滤 + 显隐（不重建 DOM）=====
  function applyFilters() {
    const term = state.searchTerm.trim();
    const cat = state.activeCategory;

    let visible = 0;
    for (const w of state.sites) {
      let ok = true;
      if (cat !== "全部" && w.category !== cat) ok = false;
      if (ok && term) {
        ok = globMatch(term, w.name) ||
             globMatch(term, w.url) ||
             globMatch(term, w.description) ||
             globMatch(term, w.keywords || "");
      }
      const el = state.cardIndex.get(w.id);
      if (el) {
        el.hidden = !ok;
        if (ok) visible++;
      }
    }

    els.resultCount.textContent = `共 ${visible} 个网站`;
    els.emptyState.hidden = visible !== 0;
    els.resetBtn.hidden = (cat === "全部" && !term);
  }

  // ===== 复制到剪贴板 =====
  async function copyUrl(url, btn) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (_) { ok = false; }

    if (ok) {
      showToast(`已复制：${url}`);
      if (btn) {
        const html = btn.innerHTML;
        btn.classList.add("is-copied");
        btn.textContent = "已复制 ✓";
        setTimeout(() => {
          btn.classList.remove("is-copied");
          btn.innerHTML = html;
        }, 1200);
      }
    } else {
      showToast("复制失败，请手动复制", true);
    }
  }

  // ===== Toast =====
  let toastTimer = null;
  function showToast(msg, isError = false) {
    els.toast.textContent = msg;
    els.toast.classList.toggle("is-error", isError);
    els.toast.hidden = false;
    void els.toast.offsetWidth;
    els.toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("is-show");
      setTimeout(() => { els.toast.hidden = true; }, 220);
    }, 1800);
  }

  // ===== 加载骨架 =====
  function showSkeleton() {
    const grid = document.createElement("div");
    grid.className = "loading-grid";
    for (let i = 0; i < 6; i++) {
      const card = document.createElement("div");
      card.className = "skeleton-card";
      card.innerHTML = `
        <div class="skeleton-line short"></div>
        <div class="skeleton-line mid"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      `;
      grid.appendChild(card);
    }
    els.results.innerHTML = "";
    els.results.appendChild(grid);
  }

  // ===== 初始化数据 =====
  async function init() {
    showSkeleton();
    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("数据格式不是数组");

      state.sites = data;

      // 分类统计（"综合政务"置顶，"其他"置底，按数量降序）
      const counts = new Map();
      for (const w of state.sites) {
        counts.set(w.category, (counts.get(w.category) || 0) + 1);
      }
      state.categories = [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
          if (a.name === "综合政务") return -1;
          if (b.name === "综合政务") return 1;
          if (a.name === "其他") return 1;
          if (b.name === "其他") return -1;
          return b.count - a.count || a.name.localeCompare(b.name, "zh-CN");
        });

      els.headerMeta.textContent = `${state.sites.length} 网站 · ${state.categories.length} 分类`;
      els.footerCount.textContent = String(state.sites.length);

      renderQuick();
      renderCategories();
      buildCards();      // 分帧构建，完成时自动 applyFilters
    } catch (err) {
      console.error("加载数据失败:", err);
      els.results.innerHTML = "";
      els.resultCount.textContent = "加载失败";
      els.errorState.hidden = false;
      if (els.errMsg) {
        els.errMsg.innerHTML =
          `错误：${esc(String(err.message || err))}<br>` +
          `请通过本地服务器访问（如 <code>python -m http.server</code>），不能直接双击打开 HTML。`;
      }
    }
  }

  // ===== 事件绑定 =====
  const onSearch = debounce((v) => { state.searchTerm = v; applyFilters(); }, 140);
  const onCatFilter = debounce((v) => { state.catFilterTerm = v; renderCategories(); }, 100);

  els.search.addEventListener("input", (e) => {
    const v = e.target.value;
    els.clearBtn.hidden = !v;
    onSearch(v);
  });
  els.clearBtn.addEventListener("click", () => {
    onSearch.cancel(); // 取消挂起的搜索，防止清空后被回填
    els.search.value = "";
    els.clearBtn.hidden = true;
    state.searchTerm = "";
    applyFilters();
    els.search.focus();
  });
  els.catFilter.addEventListener("input", (e) => onCatFilter(e.target.value));

  els.hintToggle.addEventListener("click", () => {
    els.searchHint.classList.toggle("is-open");
  });

  els.resetBtn.addEventListener("click", () => {
    onSearch.cancel();
    onCatFilter.cancel();
    els.search.value = "";
    els.clearBtn.hidden = true;
    els.catFilter.value = "";
    state.searchTerm = "";
    state.catFilterTerm = "";
    state.activeCategory = "全部";
    els.catNow.textContent = "全部";
    renderCategories();
    applyFilters();
  });

  // 键盘：/ 聚焦搜索；Esc 优先关弹窗，其次清搜索
  document.addEventListener("keydown", (e) => {
    const inInput = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !inInput) {
      e.preventDefault();
      els.search.focus();
      return;
    }
    if (e.key === "Escape") {
      if (!els.guideModal.hidden) { closeGuide(); return; }
      if (document.activeElement === els.search && els.search.value) {
        onSearch.cancel();
        els.search.value = "";
        els.clearBtn.hidden = true;
        state.searchTerm = "";
        applyFilters();
      }
    }
  });

  // 桌面端：折叠面板强制展开（避免用户手动收起后看不见分类）
  const mq = window.matchMedia("(min-width: 1024px)");
  function syncFoldState() {
    if (mq.matches) els.catFold.setAttribute("open", "");
  }
  if (mq.addEventListener) mq.addEventListener("change", syncFoldState);
  else if (mq.addListener) mq.addListener(syncFoldState);
  syncFoldState();

  // ===== 办事指南 / 联系电话 =====
  let guideData = null;
  let contactData = null;
  let guideTab = "guide";
  let lastFocus = null;

  async function loadGuide() {
    if (guideData) return guideData;
    try {
      const res = await fetch(GUIDE_URL, { cache: "no-cache" });
      guideData = await res.json();
      return guideData;
    } catch (err) {
      console.error("加载办事指南失败:", err);
      return null;
    }
  }

  async function loadContacts() {
    if (contactData) return contactData;
    try {
      const res = await fetch(CONTACTS_URL, { cache: "no-cache" });
      contactData = await res.json();
      return contactData;
    } catch (err) {
      console.error("加载联系方式失败:", err);
      return null;
    }
  }

  // 联系电话：按分组渲染，支持搜索（名称/号码/单位/说明）
  function renderPhones(q = "") {
    if (!contactData) return;
    const body = els.guideBody;
    const kw = q.trim().toLowerCase();
    const note = contactData.note ? `<p class="phone-note">${esc(contactData.note)}</p>` : "";
    let html = note;
    let shown = 0;
    for (const g of contactData.groups || []) {
      const items = (g.items || []).filter((it) =>
        !kw || `${it.name} ${it.num} ${it.org} ${it.desc}`.toLowerCase().includes(kw));
      if (!items.length) continue;
      shown += items.length;
      html += `<div class="phone-group">${esc(g.category)}</div>`;
      html += items.map((it) => `
        <div class="phone-item">
          <div class="phone-main">
            <span class="phone-name">${esc(it.name)}</span>
            <span class="phone-org">${esc(it.org)}</span>
            <p class="phone-desc">${esc(it.desc)}</p>
          </div>
          <span class="phone-num">${esc(it.num)}</span>
          <span class="phone-actions">
            <a class="pill-btn" href="tel:${esc(it.num)}">拨打</a>
            <button class="pill-btn" type="button" data-copy-num="${esc(it.num)}">复制</button>
          </span>
        </div>`).join("");
    }
    body.innerHTML = shown ? html : `<p class="modal-empty">未找到「${esc(q)}」相关电话</p>`;
    $$("[data-copy-num]", body).forEach((btn) =>
      btn.addEventListener("click", (e) => copyUrl(btn.dataset.copyNum, e.currentTarget)));
  }

  // 首次进入"联系电话"页签时按需加载
  async function ensurePhones() {
    if (!contactData) {
      els.guideBody.innerHTML = `<p class="modal-loading">加载中…</p>`;
      const d = await loadContacts();
      if (!d) {
        els.guideBody.innerHTML = `<p class="modal-empty">加载联系方式失败，请检查 data/contacts.json 是否存在</p>`;
        return;
      }
    }
    renderPhones(els.guideSearch.value);
  }

  function findSiteUrl(id) {
    const site = state.sites.find((s) => s.id === id);
    return site ? site.url : null;
  }

  function renderGuide(tab, q = "") {
    if (!guideData) return;
    const body = els.guideBody;
    const kw = q.trim().toLowerCase();

    if (tab === "guide") {
      const items = guideData.guide.filter((g) =>
        !kw || g.situation.toLowerCase().includes(kw) ||
        g.department.toLowerCase().includes(kw) ||
        (g.website_id && g.website_id.toLowerCase().includes(kw)));
      body.innerHTML = items.length
        ? items.map((g) => {
            const url = findSiteUrl(g.website_id);
            const link = url
              ? `<a class="go" href="${esc(url)}" target="_blank" rel="noopener noreferrer">前往 →</a>`
              : "";
            return `<div class="guide-item"><b>${esc(g.situation)}</b><span class="dept">→ ${esc(g.department)}</span>${link}</div>`;
          }).join("")
        : `<p class="modal-empty">未找到「${esc(q)}」相关办事事项</p>`;

    } else if (tab === "depts") {
      const items = guideData.departments.filter((d) =>
        !kw || d.dept.toLowerCase().includes(kw) ||
        d.matters.some((m) => m.toLowerCase().includes(kw)));
      body.innerHTML = items.length
        ? items.map((d) => {
            const url = findSiteUrl(d.website_id);
            const link = url
              ? `<a class="go" href="${esc(url)}" target="_blank" rel="noopener noreferrer">前往 →</a>`
              : "";
            return `<div class="guide-item"><b>${esc(d.dept)}</b><span class="dept">${esc(d.matters.join(" · "))}</span>${link}</div>`;
          }).join("")
        : `<p class="modal-empty">未找到「${esc(q)}」相关部门</p>`;

    } else {
      body.innerHTML = guideData.levels.map((l) => `
        <div class="guide-item guide-item--level">
          <span class="lv">${esc(l.level)}</span>
          <span class="org">${esc(l.org)}</span>
          <p class="desc">${esc(l.desc)}</p>
          <p class="sub">下属：${esc(l.subordinate.join(" · "))}</p>
        </div>`).join("");
    }
  }

  function openGuide() {
    lastFocus = document.activeElement;
    els.guideModal.hidden = false;
    // 用 html 的 overflow 锁滚动：只影响滚动条，不触发子元素重排
    document.documentElement.style.overflow = "hidden";
    if (guideTab === "phones") {
      ensurePhones();
    } else if (guideData) {
      renderGuide(guideTab, els.guideSearch.value);
    } else {
      loadGuide().then((d) => {
        if (d) renderGuide(guideTab, els.guideSearch.value);
        else els.guideBody.innerHTML = `<p class="modal-empty">加载办事指南失败，请检查 data/guide.json 是否存在</p>`;
      });
    }
    els.guideSearch.focus();
  }

  function closeGuide() {
    els.guideModal.hidden = true;
    document.documentElement.style.overflow = ""; // 对应恢复
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  els.guideBtn.addEventListener("click", openGuide);
  $$("[data-close-modal]", els.guideModal).forEach((el) =>
    el.addEventListener("click", closeGuide));

  $$(".modal-tab", els.guideModal).forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".modal-tab", els.guideModal).forEach((t) =>
        t.setAttribute("aria-selected", String(t === tab)));
      guideTab = tab.dataset.tab;
      els.guideSearch.value = "";
      els.guideSearch.placeholder = guideTab === "phones"
        ? "搜索电话，如：社保、报警、维权…"
        : "搜索办事事项，如：身份证、护照、社保…";
      if (guideTab === "phones") ensurePhones();
      else if (guideData) renderGuide(guideTab, "");
    });
  });

  els.guideSearch.addEventListener("input", debounce((e) => {
    if (guideTab === "phones") {
      if (contactData) renderPhones(e.target.value);
    } else {
      renderGuide(guideTab, e.target.value);
    }
  }, 150));

  // 简单的焦点陷阱
  els.guideModal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = $$(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
      els.guideModal
    ).filter((el) => !el.hidden && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // 启动
  init();
})();
