// 红色工具箱 · 浏览器版
// 纯静态前端：加载数据 → glob 搜索 → 分类筛选 → 打开 / 复制
// glob 匹配逻辑与 cli/src/glob.rs 保持一致

(() => {
  "use strict";

  const DATA_URL = "./data/websites.json";

  // ===== DOM 引用 =====
  const $ = (sel) => document.querySelector(sel);
  const els = {
    search: $("#search"),
    clearBtn: $("#clear-btn"),
    catFilter: $("#cat-filter"),
    catCount: $("#cat-count"),
    categories: $("#categories"),
    quickAccess: $("#quick-access"),
    quickGrid: $("#quick-grid"),
    resultCount: $("#result-count"),
    resetBtn: $("#reset-btn"),
    results: $("#results"),
    cardTemplate: $("#card-template"),
    emptyState: $("#empty-state"),
    errorState: $("#error-state"),
    errMsg: $('[data-err-msg]'),
    headerMeta: $("#header-meta"),
    footerCount: $("#footer-count"),
    toast: $("#toast"),
    guideBtn: $("#guide-btn"),
    guideModal: $("#guide-modal"),
    guideBody: $("#guide-body"),
    guideSearch: $("#guide-search"),
  };

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

  // ===== 状态 =====
  const state = {
    sites: [],          // 全量数据
    categories: [],     // [{name, count}]（不含"全部"，全部在渲染时补）
    filteredCategories: [], // 当前显示的分类（受 cat-filter 影响）
    filtered: [],       // 当前过滤结果
    activeCategory: "全部", // 当前选中分类
    searchTerm: "",     // 当前搜索词
    catFilterTerm: "",  // 当前分类筛选词
  };

  // ===== glob 匹配（与 cli/src/glob.rs 等价）=====
  // - 无 * ? 时按子串匹配（大小写不敏感）
  // - * 匹配任意字符序列（含空），? 匹配单字符
  function globMatch(pattern, text) {
    if (!pattern.includes("*") && !pattern.includes("?")) {
      return text.toLowerCase().includes(pattern.toLowerCase());
    }
    const p = pattern.toLowerCase();
    const t = text.toLowerCase();
    return globImpl(p, t);
  }

  function globImpl(p, t) {
    let pi = 0, ti = 0;
    let star = -1, matchStart = 0;
    while (ti < t.length) {
      if (pi < p.length && (p[pi] === "?" || p[pi] === t[ti])) {
        pi++; ti++;
      } else if (pi < p.length && p[pi] === "*") {
        star = pi;
        matchStart = ti;
        pi++;
      } else if (star !== -1) {
        pi = star + 1;
        matchStart++;
        ti = matchStart;
      } else {
        return false;
      }
    }
    while (pi < p.length && p[pi] === "*") pi++;
    return pi === p.length;
  }

  // ===== 过滤逻辑 =====
  function applyFilters() {
    const term = state.searchTerm.trim();
    const cat = state.activeCategory;

    state.filtered = state.sites.filter((w) => {
      if (cat !== "全部" && w.category !== cat) return false;
      if (!term) return true;
      // 与 CLI search 一致：匹配 name / url / description / keywords
      return (
        globMatch(term, w.name) ||
        globMatch(term, w.url) ||
        globMatch(term, w.description) ||
        globMatch(term, w.keywords || "")
      );
    });

    renderResults();
  }

  // ===== 渲染：分类芯片（可被 cat-filter 过滤）=====
  function renderCategories() {
    const q = state.catFilterTerm.trim().toLowerCase();
    // 始终保留"全部"芯片
    const allChip = { name: "全部", count: state.sites.length };
    const visibleCats = q
      ? state.categories.filter((c) => c.name.toLowerCase().includes(q))
      : state.categories;

    const frag = document.createDocumentFragment();

    // "全部"芯片
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "chip" + (state.activeCategory === "全部" ? " active" : "");
    allBtn.dataset.category = "全部";
    allBtn.innerHTML = `${escapeHtml(allChip.name)}<span class="chip-count">${allChip.count}</span>`;
    allBtn.addEventListener("click", () => {
      state.activeCategory = "全部";
      document.querySelectorAll(".chip").forEach((el) => el.classList.remove("active"));
      allBtn.classList.add("active");
      applyFilters();
    });
    frag.appendChild(allBtn);

    for (const c of visibleCats) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (c.name === state.activeCategory ? " active" : "");
      btn.dataset.category = c.name;
      btn.innerHTML = `${escapeHtml(c.name)}<span class="chip-count">${c.count}</span>`;
      btn.addEventListener("click", () => {
        state.activeCategory = c.name;
        document.querySelectorAll(".chip").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        applyFilters();
      });
      frag.appendChild(btn);
    }
    els.categories.innerHTML = "";
    els.categories.appendChild(frag);

    // 分类计数显示
    if (els.catCount) {
      const totalCats = state.categories.length;
      const shownCats = q ? visibleCats.length : totalCats;
      els.catCount.textContent = q
        ? `${shownCats} / ${totalCats} 个分类`
        : `共 ${totalCats} 个分类`;
    }
  }

  // ===== 渲染：快捷方式置顶区 =====
  function renderQuickAccess() {
    if (!els.quickGrid || !els.quickAccess) return;
    const picks = QUICK_PICKS
      .map((id) => state.sites.find((w) => w.id === id))
      .filter(Boolean);
    if (picks.length === 0) {
      els.quickAccess.hidden = true;
      return;
    }
    els.quickAccess.hidden = false;
    const frag = document.createDocumentFragment();
    for (const w of picks) {
      const a = document.createElement("a");
      a.className = "quick-btn";
      a.href = w.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `${w.name} — ${w.url}`;
      a.dataset.id = w.id;
      a.innerHTML = `<span class="quick-name">${escapeHtml(w.name)}</span>`;
      frag.appendChild(a);
    }
    els.quickGrid.innerHTML = "";
    els.quickGrid.appendChild(frag);
  }

  // ===== 渲染：结果卡片 =====
  function renderResults() {
    const count = state.filtered.length;
    els.resultCount.textContent = `共 ${count} 个网站`;
    els.footerCount.textContent = String(state.sites.length);
    els.headerMeta.textContent = `${state.sites.length} 网站 · ${state.categories.length} 分类`;

    // 重置按钮显隐
    const hasFilter = state.activeCategory !== "全部" || state.searchTerm.trim() !== "";
    els.resetBtn.hidden = !hasFilter;

    // 空状态
    els.emptyState.hidden = count !== 0;
    if (count === 0) {
      els.results.innerHTML = "";
      return;
    }

    const frag = document.createDocumentFragment();
    for (const w of state.filtered) {
      const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector('[data-cat]').textContent = w.category;
      node.querySelector('[data-id]').textContent = w.id;
      node.querySelector('[data-name]').textContent = w.name;
      const descEl = node.querySelector('[data-desc]');
      descEl.textContent = w.description;
      descEl.title = w.description;

      // 功能标签：从 keywords 生成，分为「核心功能」和「常用功能」
      // 核心功能：前 3 个关键词，始终显示
      // 常用功能：第 4 个起，默认显示前 2 个，展开显示全部
      const tagsEl = node.querySelector('[data-tags]');
      const keywords = (w.keywords || "").split(/[,，]/).map(s => s.trim()).filter(Boolean);
      let hasOverflow = false;

      if (tagsEl && keywords.length > 0) {
        const coreCount = Math.min(3, keywords.length);
        const coreKeywords = keywords.slice(0, coreCount);
        const commonKeywords = keywords.slice(coreCount);
        const commonVisible = 2; // 常用功能默认显示数量
        hasOverflow = commonKeywords.length > commonVisible;

        // 创建标签的辅助函数
        const makeTag = (kw) => {
          const tag = document.createElement("span");
          tag.className = "card-tag";
          tag.textContent = kw;
          tag.title = `点击搜索「${kw}」`;
          tag.addEventListener("click", (e) => {
            e.stopPropagation();
            els.search.value = kw;
            state.searchTerm = kw;
            applyFilters();
          });
          return tag;
        };

        // 核心功能区（始终显示）
        const coreSection = document.createElement("div");
        coreSection.className = "tag-section";
        const coreLabel = document.createElement("span");
        coreLabel.className = "tag-section-title";
        coreLabel.textContent = "核心功能：";
        coreSection.appendChild(coreLabel);
        coreKeywords.forEach((kw) => coreSection.appendChild(makeTag(kw)));
        tagsEl.appendChild(coreSection);

        // 常用功能区（默认显示前 commonVisible 个，展开显示全部）
        if (commonKeywords.length > 0) {
          const commonSection = document.createElement("div");
          commonSection.className = "tag-section tag-common";
          const commonLabel = document.createElement("span");
          commonLabel.className = "tag-section-title";
          commonLabel.textContent = "常用功能：";
          commonSection.appendChild(commonLabel);
          commonKeywords.forEach((kw, i) => {
            const tag = makeTag(kw);
            if (i >= commonVisible) tag.classList.add("tag-collapsed");
            commonSection.appendChild(tag);
          });
          // 超出部分添加 +N 提示
          if (hasOverflow) {
            const more = document.createElement("span");
            more.className = "card-tag tag-more";
            more.textContent = `+${commonKeywords.length - commonVisible}`;
            more.title = "点击展开查看全部";
            commonSection.appendChild(more);
          }
          tagsEl.appendChild(commonSection);
        }
      }

      // 展开/收起按钮：联动描述和常用功能标签
      const toggleBtn = node.querySelector('[data-desc-toggle]');
      if (toggleBtn) {
        const descLong = w.description.length > 40;
        if (!hasOverflow && !descLong) {
          // 描述短且常用功能无溢出：隐藏按钮
          toggleBtn.style.display = "none";
        } else {
          toggleBtn.addEventListener("click", () => {
            const expanded = descEl.classList.toggle("expanded");
            if (tagsEl) tagsEl.classList.toggle("expanded", expanded);
            // CSS 通过 .card-tags.expanded 控制标签显隐
            toggleBtn.textContent = expanded ? "收起 ▴" : "展开 ▾";
          });
        }
      }
      const urlEl = node.querySelector('[data-url]');
      urlEl.textContent = w.url;
      urlEl.href = w.url;
      const openEl = node.querySelector('[data-open]');
      openEl.href = w.url;
      const copyBtn = node.querySelector('[data-copy]');
      copyBtn.addEventListener("click", () => copyUrl(w.url, copyBtn));
      frag.appendChild(node);
    }
    els.results.innerHTML = "";
    els.results.appendChild(frag);
  }

  // ===== 复制到剪贴板 =====
  async function copyUrl(url, btn) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        // 回退：临时 textarea + execCommand（file:// 或非安全上下文）
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (_) {
      ok = false;
    }
    if (ok) {
      showToast(`已复制：${url}`);
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "已复制 ✓";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("copied");
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
    els.toast.classList.toggle("error", isError);
    els.toast.hidden = false;
    // 强制 reflow 触发动画
    void els.toast.offsetWidth;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
      setTimeout(() => { els.toast.hidden = true; }, 200);
    }, 1800);
  }

  // ===== 工具：HTML 转义 =====
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ===== 防抖 =====
  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
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

      // 统计分类（按数量降序，"综合政务"置顶，"其他"置底，"全部"在渲染时补）
      const counts = new Map();
      for (const w of state.sites) {
        counts.set(w.category, (counts.get(w.category) || 0) + 1);
      }
      state.categories = [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
          // "综合政务"置顶
          if (a.name === "综合政务") return -1;
          if (b.name === "综合政务") return 1;
          // "其他"置底
          if (a.name === "其他") return 1;
          if (b.name === "其他") return -1;
          // 其余按数量降序，再按名称
          return b.count - a.count || a.name.localeCompare(b.name, "zh-CN");
        });

      renderQuickAccess();
      renderCategories();
      applyFilters();
    } catch (err) {
      console.error("加载数据失败:", err);
      els.results.innerHTML = "";
      els.resultCount.textContent = "加载失败";
      els.errorState.hidden = false;
      if (els.errMsg) {
        els.errMsg.innerHTML =
          `错误：${escapeHtml(String(err.message || err))}<br>` +
          `请通过本地服务器访问（如 <code>python -m http.server</code>），不能直接双击打开 HTML。`;
      }
    }
  }

  // ===== 事件绑定 =====
  const onSearch = debounce((value) => {
    state.searchTerm = value;
    applyFilters();
  }, 120);

  const onCatFilter = debounce((value) => {
    state.catFilterTerm = value;
    renderCategories();
  }, 100);

  els.search.addEventListener("input", (e) => {
    const v = e.target.value;
    els.clearBtn.hidden = !v;
    onSearch(v);
  });

  els.clearBtn.addEventListener("click", () => {
    els.search.value = "";
    els.clearBtn.hidden = true;
    state.searchTerm = "";
    applyFilters();
    els.search.focus();
  });

  if (els.catFilter) {
    els.catFilter.addEventListener("input", (e) => {
      onCatFilter(e.target.value);
    });
  }

  els.resetBtn.addEventListener("click", () => {
    els.search.value = "";
    els.clearBtn.hidden = true;
    state.searchTerm = "";
    state.activeCategory = "全部";
    if (els.catFilter) {
      els.catFilter.value = "";
      state.catFilterTerm = "";
    }
    renderCategories();
    document.querySelectorAll(".chip").forEach((el) => el.classList.remove("active"));
    const allChip = document.querySelector('.chip[data-category="全部"]');
    if (allChip) allChip.classList.add("active");
    applyFilters();
  });

  // 键盘快捷键：/ 聚焦搜索框，Esc 清空搜索
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== els.search) {
      e.preventDefault();
      els.search.focus();
    } else if (e.key === "Escape" && document.activeElement === els.search) {
      els.search.value = "";
      els.clearBtn.hidden = true;
      state.searchTerm = "";
      applyFilters();
    }
  });

  // ===== 办事指南功能 =====
  let guideData = null;
  let guideTab = "guide";

  async function loadGuide() {
    if (guideData) return guideData;
    try {
      const res = await fetch("./data/guide.json", { cache: "no-cache" });
      guideData = await res.json();
      return guideData;
    } catch (err) {
      console.error("加载办事指南失败:", err);
      return null;
    }
  }

  function findSiteUrl(id) {
    const site = state.sites.find((s) => s.id === id);
    return site ? site.url : null;
  }

  function renderGuideTab(tab, searchTerm = "") {
    if (!guideData) return;
    const body = els.guideBody;
    const q = searchTerm.trim().toLowerCase();

    if (tab === "guide") {
      const items = guideData.guide.filter((g) => {
        if (!q) return true;
        return g.situation.toLowerCase().includes(q) ||
               g.department.toLowerCase().includes(q) ||
               (g.website_id && g.website_id.toLowerCase().includes(q));
      });
      if (items.length === 0) {
        body.innerHTML = `<p class="modal-empty">未找到「${escapeHtml(searchTerm)}」相关办事事项</p>`;
        return;
      }
      body.innerHTML = items.map((g) => {
        const url = findSiteUrl(g.website_id);
        const link = url ? `<a class="go-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">前往 →</a>` : "";
        return `<div class="guide-item">
          <span class="situation">${escapeHtml(g.situation)}</span>
          <span class="dept">→ ${escapeHtml(g.department)}</span>
          ${link}
        </div>`;
      }).join("");

    } else if (tab === "depts") {
      const items = guideData.departments.filter((d) => {
        if (!q) return true;
        return d.dept.toLowerCase().includes(q) ||
               d.matters.some((m) => m.toLowerCase().includes(q));
      });
      if (items.length === 0) {
        body.innerHTML = `<p class="modal-empty">未找到「${escapeHtml(searchTerm)}」相关部门</p>`;
        return;
      }
      body.innerHTML = items.map((d) => {
        const url = findSiteUrl(d.website_id);
        const link = url ? `<a class="go-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">前往 →</a>` : "";
        return `<div class="dept-item">
          <div class="dept-name">${escapeHtml(d.dept)} ${link}</div>
          <div class="dept-matters">${escapeHtml(d.matters.join(" · "))}</div>
        </div>`;
      }).join("");

    } else if (tab === "levels") {
      body.innerHTML = guideData.levels.map((l) => {
        return `<div class="level-item">
          <span class="level-name">${escapeHtml(l.level)}</span>
          <span class="level-org">${escapeHtml(l.org)}</span>
          <p class="level-desc">${escapeHtml(l.desc)}</p>
          <p class="level-sub">下属：${escapeHtml(l.subordinate.join(" · "))}</p>
        </div>`;
      }).join("");
    }
  }

  async function openGuide() {
    els.guideModal.hidden = false;
    els.guideBody.innerHTML = `<p class="modal-loading">加载中…</p>`;
    await loadGuide();
    if (!guideData) {
      els.guideBody.innerHTML = `<p class="modal-empty">加载办事指南失败，请检查 data/guide.json 是否存在</p>`;
      return;
    }
    renderGuideTab(guideTab, els.guideSearch.value);
    els.guideSearch.focus();
  }

  function closeGuide() {
    els.guideModal.hidden = true;
  }

  els.guideBtn.addEventListener("click", openGuide);
  els.guideModal.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeGuide);
  });
  els.guideModal.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      els.guideModal.querySelectorAll(".modal-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      guideTab = tab.dataset.tab;
      els.guideSearch.value = "";
      renderGuideTab(guideTab, "");
    });
  });
  els.guideSearch.addEventListener("input", debounce((e) => {
    renderGuideTab(guideTab, e.target.value);
  }, 150));

  // 启动
  init();
})();
