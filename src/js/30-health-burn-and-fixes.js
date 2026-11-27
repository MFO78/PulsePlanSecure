/* ============================================================================
 * 30. HEALTH & EVOLUTION BURN/BUDGET ANALYSIS (LABOUR + PBS MATERIALS +
 *     EXTERNAL CONSULTANTS), PBS UNIT COST UI ENHANCER, CAPACITY RESET FIX,
 *     LIFECYCLE HOOK BUS & ACCESSIBILITY / DARK-MODE ENHANCEMENTS
 * ============================================================================ */
(function ppHealthBurnAndFixesModule() {
  if (typeof globalThis === 'undefined') return;

  /* ---------- 0. Lightweight Lifecycle Hook Bus ---------- */
  const _hookListeners = new Map();
  const ppHooks = globalThis.ppHooks || {
    on(eventName, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!_hookListeners.has(eventName)) _hookListeners.set(eventName, new Set());
      _hookListeners.get(eventName).add(fn);
      return () => _hookListeners.get(eventName)?.delete(fn);
    },
    emit(eventName, ...args) {
      const set = _hookListeners.get(eventName);
      if (!set) return;
      set.forEach(fn => {
        try { fn(...args); } catch (_e) {}
      });
    },
  };
  globalThis.ppHooks = ppHooks;

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return {
      departments: [],
      projects: [],
      allocations: {},
      capacityOverrides: {},
      comments: {},
      milestones: [],
      snapshots: [],
      changeLog: [],
      externalCosts: [],
      settings: {},
    };
  }

  function ensureExternalCosts(db) {
    if (!db || typeof db !== 'object') return [];
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    if (Array.isArray(db.externalCosts) && db.externalCosts.length > 0) {
      db.settings.externalCosts = db.externalCosts;
      return db.externalCosts;
    }
    if (Array.isArray(db.settings.externalCosts)) {
      db.externalCosts = db.settings.externalCosts;
      return db.externalCosts;
    }
    if (!Array.isArray(db.externalCosts)) db.externalCosts = [];
    db.settings.externalCosts = db.externalCosts;
    return db.externalCosts;
  }

  function esc(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(str ?? ''));
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(val, db) {
    if (typeof formatCurrency === 'function') return formatCurrency(val, db);
    const sym = (db && db.settings && db.settings.currencySymbol) || '€';
    return `${sym}${Math.round(Number(val) || 0).toLocaleString('en-GB')}`;
  }

  function fmtDays(val) {
    const n = Math.round((Number(val) || 0) * 10) / 10;
    return `${Number.isInteger(n) ? n : n.toFixed(1)}d`;
  }

  function getDeptRate(dept, db) {
    if (!dept) return 0;
    if (typeof getDeptDayRate === 'function') return Number(getDeptDayRate(dept, db)) || 0;
    const direct = Number(dept.dayRate);
    if (!isNaN(direct) && direct > 0) return direct;
    const def = Number(db && db.settings && db.settings.defaultDayRate);
    return !isNaN(def) && def > 0 ? def : 0;
  }

  function loadPbsCacheSafe() {
    try {
      if (globalThis.__ppPbsV2 && globalThis.__ppPbsV2.data && typeof globalThis.__ppPbsV2.data.loadCache === 'function') {
        return globalThis.__ppPbsV2.data.loadCache() || {};
      }
      const raw = typeof safeGetStorage === 'function'
        ? safeGetStorage('pulseplan_pbs_cache_v1')
        : (typeof localStorage !== 'undefined' ? localStorage.getItem('pulseplan_pbs_cache_v1') : null);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function computePbsMaterialCost(projectIds, pbsCache) {
    const cache = pbsCache || loadPbsCacheSafe();
    const idSet = new Set(projectIds || []);
    let total = 0;
    let itemCount = 0;
    idSet.forEach(pid => {
      const doc = cache[pid];
      const items = doc && Array.isArray(doc.items) ? doc.items : [];
      items.forEach(it => {
        const uc = Number(it && it.unitCost);
        if (Number.isFinite(uc) && uc > 0) {
          const q = (Number.isFinite(Number(it.qty)) && Number(it.qty) >= 1) ? Number(it.qty) : 1;
          total += uc * q;
          itemCount++;
        }
      });
    });
    return { total, itemCount };
  }

  /* ---------- PBS Procurement Unit Cost UI Enhancer ---------- */
  function enhancePbsProcurementUnitCostForm() {
    if (typeof document === 'undefined' || !document.querySelector) return;
    const form = document.getElementById('ppPbsItemForm');
    if (!form || form.querySelector('#ppPbsFUnitCost')) return;
    const procSection = form.querySelector('details[data-pbs-section="proc"]');
    if (!procSection) return;

    const pbsCore = globalThis.__ppPbsV2 && globalThis.__ppPbsV2.core;
    const activeDoc = pbsCore && pbsCore.state ? pbsCore.state.activeDoc : null;
    const codeInput = form.querySelector('#ppPbsFCode');
    const currentCode = codeInput ? String(codeInput.value || '').trim() : '';
    const existingItem = activeDoc && Array.isArray(activeDoc.items)
      ? activeDoc.items.find(it => String(it.code || '').trim() === currentCode)
      : null;
    const initialVal = existingItem && existingItem.unitCost != null ? String(existingItem.unitCost) : '';

    const db = getDb();
    const sym = (db && db.settings && db.settings.currencySymbol) || '€';

    const wrap = document.createElement('label');
    wrap.className = 'block';
    wrap.innerHTML = `
      <span class="block text-[11px] font-semibold text-slate-600 mb-1">Unit Cost (${esc(sym)}) <span class="text-slate-400 font-normal">&times; Qty</span></span>
      <input id="ppPbsFUnitCost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(initialVal)}" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs" />
    `;
    const grid = procSection.querySelector('.grid') || procSection;
    grid.appendChild(wrap);

    if (!form.__ppUnitCostWired) {
      form.__ppUnitCostWired = true;
      form.addEventListener('submit', () => {
        const ucEl = form.querySelector('#ppPbsFUnitCost');
        const cEl = form.querySelector('#ppPbsFCode');
        const rawUc = ucEl ? String(ucEl.value || '').trim() : '';
        const targetCode = cEl ? String(cEl.value || '').trim() : '';
        const parsedUc = rawUc === '' ? null : (Number.isFinite(Number(rawUc)) && Number(rawUc) >= 0 ? Math.round(Number(rawUc) * 10000) / 10000 : null);
        setTimeout(() => {
          const core = globalThis.__ppPbsV2 && globalThis.__ppPbsV2.core;
          const doc = core && core.state ? core.state.activeDoc : null;
          if (!doc || !Array.isArray(doc.items)) return;
          const savedItem = doc.items.find(it => String(it.code || '').trim() === targetCode);
          if (savedItem) {
            savedItem.unitCost = parsedUc;
            if (typeof core.scheduleSave === 'function') core.scheduleSave();
            if (typeof ui !== 'undefined' && ui.activeTab === 'health') renderHealthBurnBudgetFrame();
          }
        }, 30);
      }, true);
    }
  }

  function wirePbsDialogObserver() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.__ppPbsUnitCostObserver) return;
    document.__ppPbsUnitCostObserver = new MutationObserver(() => {
      if (document.getElementById('ppPbsItemForm')) enhancePbsProcurementUnitCostForm();
    });
    if (document.body) {
      document.__ppPbsUnitCostObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function injectBurnAndA11yStyles() {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.getElementById('ppHealthBurnStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppHealthBurnStyles';
    style.textContent = `
      html.dark #ppHealthBurnBudgetFrame,
      body.dark #ppHealthBurnBudgetFrame,
      [data-theme="dark"] #ppHealthBurnBudgetFrame {
        background-color: var(--surface-card, #0f172a);
        border-color: var(--border-subtle, #334155);
        color: var(--text-primary, #f1f5f9);
      }
      html.dark #ppHealthBurnBudgetFrame .bg-slate-50,
      html.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/70,
      html.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/60,
      body.dark #ppHealthBurnBudgetFrame .bg-slate-50,
      body.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/70,
      body.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/60 {
        background-color: var(--surface-subtle, #1e293b);
      }
      html.dark #ppHealthBurnBudgetFrame .text-slate-900,
      html.dark #ppHealthBurnBudgetFrame .text-slate-800,
      body.dark #ppHealthBurnBudgetFrame .text-slate-900,
      body.dark #ppHealthBurnBudgetFrame .text-slate-800 {
        color: var(--text-primary, #f1f5f9);
      }
      html.dark #ppHealthBurnBudgetFrame .text-slate-700,
      html.dark #ppHealthBurnBudgetFrame .text-slate-600,
      body.dark #ppHealthBurnBudgetFrame .text-slate-700,
      body.dark #ppHealthBurnBudgetFrame .text-slate-600 {
        color: var(--text-secondary, #cbd5e1);
      }
      html.dark #ppHealthBurnBudgetFrame .border-slate-200,
      html.dark #ppHealthBurnBudgetFrame .border-slate-100,
      body.dark #ppHealthBurnBudgetFrame .border-slate-200,
      body.dark #ppHealthBurnBudgetFrame .border-slate-100 {
        border-color: var(--border-subtle, #334155);
      }
    `;
    document.head.appendChild(style);
  }

  /* ---------- 1. HTML5 Landmarks, Tabpanel ARIA & Modal Focus Trap ---------- */
  function enhanceA11yLandmarksAndTabs() {
    if (typeof document === 'undefined' || !document.querySelector) return;

    const nav = document.querySelector('header nav[role="tablist"]');
    if (nav && !nav.__ppLandmarkFixed && typeof nav.removeAttribute === 'function') {
      nav.__ppLandmarkFixed = true;
      nav.removeAttribute('role');
      const inner = document.createElement('div');
      inner.setAttribute('role', 'tablist');
      inner.setAttribute('aria-label', 'Workspace tabs');
      inner.className = 'flex items-center gap-1';
      while (nav.firstChild) inner.appendChild(nav.firstChild);
      nav.appendChild(inner);
    }

    const panelLabels = {
      'tab-matrix': 'Roadmap Matrix',
      'tab-health': 'Health and Evolution',
      'tab-data': 'Setup and Data',
      'tab-sync': 'Sync and Snapshots',
    };
    Object.entries(panelLabels).forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el && typeof el.getAttribute === 'function' && !el.getAttribute('aria-label')) {
        el.setAttribute('aria-label', label);
      }
    });
  }

  function wireCustomModalFocusTrap() {
    if (typeof document === 'undefined' || document.__ppModalTrapWired) return;
    document.__ppModalTrapWired = true;
    document.addEventListener('keydown', (ev) => {
      const overlay = document.getElementById('modalOverlay');
      const card = document.getElementById('modalCard');
      if (!overlay || !card || overlay.classList.contains('hidden')) return;
      if (ev.key === 'Escape') {
        if (typeof closeModal === 'function') {
          ev.preventDefault();
          closeModal();
        }
        return;
      }
      if (ev.key !== 'Tab') return;
      const focusables = Array.from(card.querySelectorAll(
        'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(el => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- 2. Variable Capacity Reset Hygiene ---------- */
  function pruneNominalCapacityOverrides(db = getDb()) {
    if (!db || !db.capacityOverrides || typeof db.capacityOverrides !== 'object') return 0;
    const deptMap = new Map((db.departments || []).map(d => [d.id, d]));
    let removed = 0;
    Object.keys(db.capacityOverrides).forEach(key => {
      const sep = key.indexOf('::');
      if (sep <= 0) {
        delete db.capacityOverrides[key];
        removed++;
        return;
      }
      const deptId = key.slice(0, sep);
      const dept = deptMap.get(deptId);
      const rawVal = db.capacityOverrides[key];
      const numVal = Number(rawVal);
      if (!dept || rawVal === undefined || rawVal === null || rawVal === '' || isNaN(numVal)) {
        delete db.capacityOverrides[key];
        removed++;
        return;
      }
      const nominal = Number(dept.defaultCapacity || 0);
      if (Math.abs(numVal - nominal) <= 0.0005) {
        delete db.capacityOverrides[key];
        removed++;
      }
    });
    return removed;
  }

  globalThis.pruneNominalCapacityOverrides = pruneNominalCapacityOverrides;

  [
    'resetCapacityOverride',
    'clearCapacityOverride',
    'resetDeptCapacity',
    'resetAllCapacityOverrides',
    'saveCapacityOverride',
    'setDeptCapacityForPeriod',
    'deleteCapacityOverride',
  ].forEach(fnName => {
    if (typeof globalThis[fnName] === 'function') {
      const orig = globalThis[fnName];
      globalThis[fnName] = function (...args) {
        const res = orig.apply(this, args);
        pruneNominalCapacityOverrides(getDb());
        return res;
      };
    }
  });

  if (typeof touchDBAndSave === 'function') {
    const origTouch = touchDBAndSave;
    touchDBAndSave = function (...args) {
      pruneNominalCapacityOverrides(getDb());
      ppHooks.emit('beforeSave', getDb());
      return origTouch.apply(this, args);
    };
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!btn) return;
      const txt = String(btn.textContent || '').trim().toLowerCase();
      const aria = String(btn.getAttribute('aria-label') || '').toLowerCase();
      const onClickAttr = String(btn.getAttribute('onclick') || '').toLowerCase();
      const isCapReset =
        (txt.includes('reset') || aria.includes('reset') || onClickAttr.includes('capacity') || onClickAttr.includes('capoverride')) &&
        (txt.includes('cap') || txt.includes('nominal') || txt === 'reset' || aria.includes('cap') || onClickAttr.includes('cap'));
      if (!isCapReset) return;
      setTimeout(() => {
        const db = getDb();
        const pruned = pruneNominalCapacityOverrides(db);
        if (pruned > 0) {
          if (typeof touchDBAndSave === 'function') touchDBAndSave();
          if (typeof renderAll === 'function') renderAll();
        }
      }, 20);
    }, true);
  }

  /* ---------- 3. Burn & Budget Analysis Computation (Labour + PBS Materials + External Consultants) ---------- */
  function computeBurnBudgetAnalysis(db, periods, timeUnit, filterProj, filterDept, includeTentative, pbsCacheOverride) {
    const allDepts = (db.departments || []).filter(d => filterDept === 'all' || d.id === filterDept);
    const activeProjs = (db.projects || []).filter(p => {
      if (!p || p.archived) return false;
      if (typeof isNonFteProject === 'function' && isNonFteProject(p)) return false;
      if (p.nonFte || p.category === 'admin') return false;
      if (filterProj && filterProj !== 'all') return p.id === filterProj;
      if (typeof isProjectIncludedInPlan === 'function') return isProjectIncludedInPlan(p);
      if (!includeTentative && p.tentative) return false;
      return true;
    });
    const activeProjIds = new Set(activeProjs.map(p => p.id));

    const pbsMaterials = computePbsMaterialCost(Array.from(activeProjIds), pbsCacheOverride);
    const allExternalCosts = ensureExternalCosts(db);
    const externalCosts = allExternalCosts.filter(c => c && activeProjIds.has(c.projectId));
    const externalTotalCost = externalCosts.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);

    const hasRates = (typeof hasAnyDayRates === 'function' ? hasAnyDayRates(db) : false) ||
      allDepts.some(d => getDeptRate(d, db) > 0) ||
      pbsMaterials.total > 0 ||
      externalTotalCost > 0;

    const totalBudgetDays = activeProjs.reduce((acc, p) => acc + (Number(p.budgetDays) || 0), 0);
    const totalBudgetCost = activeProjs.reduce((acc, p) => acc + (Number(p.budgetCost) || 0), 0);

    const allPlanDays = activeProjs.reduce((acc, p) => {
      if (typeof getProjectTotalPlannedDays === 'function') return acc + (Number(getProjectTotalPlannedDays(p.id, db)) || 0);
      return acc;
    }, 0);
    const allPlanLabourCost = hasRates ? activeProjs.reduce((acc, p) => {
      if (typeof getProjectTotalPlannedCost === 'function') return acc + (Number(getProjectTotalPlannedCost(p.id, db)) || 0);
      return acc;
    }, 0) : 0;

    const deptTotals = new Map();
    allDepts.forEach(d => {
      deptTotals.set(d.id, {
        dept: d,
        rate: getDeptRate(d, db),
        days: 0,
        cost: 0,
      });
    });

    let windowDays = 0;
    let windowCost = 0;
    let externalWindowCost = 0;
    let cumulativeDays = 0;
    let cumulativeCost = 0;

    const byPeriod = (periods || []).map(pk => {
      let pDays = 0;
      let pCost = 0;
      allDepts.forEach(d => {
        const rate = getDeptRate(d, db);
        let dFte = 0;
        activeProjs.forEach(p => {
          if (typeof getAllocationForPeriod === 'function') {
            dFte += getAllocationForPeriod(d.id, p.id, pk, timeUnit, db.allocations).avgFte;
          }
        });
        if (dFte > 0.0001) {
          const days = typeof fteToDisplayValue === 'function'
            ? fteToDisplayValue(dFte, pk, timeUnit, 'days')
            : dFte * (Number(db.settings && db.settings.daysPerWeek) || 5);
          const cost = days * rate;
          pDays += days;
          pCost += cost;
          const entry = deptTotals.get(d.id);
          if (entry) {
            entry.days += days;
            entry.cost += cost;
          }
        }
      });
      const periodExt = externalCosts
        .filter(c => String(c.period || '').trim() === pk)
        .reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
      pCost += periodExt;
      externalWindowCost += periodExt;

      windowDays += pDays;
      windowCost += pCost;
      cumulativeDays += pDays;
      cumulativeCost += pCost;
      const label = typeof formatPeriodHeader === 'function'
        ? formatPeriodHeader(pk, timeUnit).title
        : pk;
      return {
        pk,
        label,
        days: pDays,
        cost: pCost,
        externalCost: periodExt,
        cumDays: cumulativeDays,
        cumCost: cumulativeCost,
      };
    });

    const byDepartment = [...deptTotals.values()]
      .filter(row => row.days > 0.001 || row.cost > 0.001)
      .sort((a, b) => (hasRates ? (b.cost - a.cost) : (b.days - a.days)) || (b.days - a.days));

    const effectiveTotalDays = allPlanDays > 0 ? allPlanDays : windowDays;
    const baseLabourCost = allPlanLabourCost > 0 ? allPlanLabourCost : (windowCost - externalWindowCost);
    const effectiveTotalCost = baseLabourCost + pbsMaterials.total + externalTotalCost;

    return {
      activeProjs,
      hasRates,
      totalBudgetDays,
      totalBudgetCost,
      windowDays,
      windowCost,
      pbsMaterialCost: pbsMaterials.total,
      pbsMaterialItems: pbsMaterials.itemCount,
      externalCosts,
      externalTotalCost,
      externalWindowCost,
      effectiveTotalDays,
      effectiveTotalCost,
      avgPeriodDays: byPeriod.length ? windowDays / byPeriod.length : 0,
      avgPeriodCost: byPeriod.length ? windowCost / byPeriod.length : 0,
      byPeriod,
      byDepartment,
    };
  }

  function renderHealthBurnBudgetFrame() {
    if (typeof document === 'undefined') return;
    const healthTab = document.getElementById('tab-health');
    if (!healthTab || typeof ui === 'undefined') return;
    injectBurnAndA11yStyles();

    const db = getDb();
    ensureExternalCosts(db);
    const periods = typeof getVisiblePeriods === 'function' ? getVisiblePeriods() : [];
    const data = computeBurnBudgetAnalysis(
      db,
      periods,
      ui.timeUnit || 'month',
      ui.filterProj || 'all',
      ui.filterDept || 'all',
      Boolean(ui.includeTentative)
    );

    let frame = document.getElementById('ppHealthBurnBudgetFrame');
    if (!frame) {
      frame = document.createElement('section');
      frame.id = 'ppHealthBurnBudgetFrame';
      frame.setAttribute('aria-labelledby', 'ppBurnBudgetHeading');
      frame.className = 'bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow-xs space-y-4 mt-4';
      const kpisEl = document.getElementById('healthKpis');
      if (kpisEl && kpisEl.parentElement && typeof kpisEl.insertAdjacentElement === 'function') {
        kpisEl.insertAdjacentElement('afterend', frame);
      } else {
        healthTab.appendChild(frame);
      }
    }

    const selectedProj = ui.filterProj && ui.filterProj !== 'all'
      ? (db.projects || []).find(p => p.id === ui.filterProj)
      : null;
    const scopeLabel = selectedProj
      ? `[${selectedProj.code || ''}] ${selectedProj.name}`
      : `All Active Projects (${data.activeProjs.length})`;
    const sortedProjs = (typeof getSortedProjects === 'function' ? getSortedProjects(db) : (db.projects || []))
      .filter(p => !p.archived || ui.filterProj === p.id);
    const fmtProj = (p) => (typeof formatProjectOptionLabel === 'function'
      ? formatProjectOptionLabel(p)
      : (p.code ? `[${p.code}] ${p.name}` : p.name));

    const useCost = data.hasRates && (data.windowCost > 0 || data.totalBudgetCost > 0 || data.effectiveTotalCost > 0);
    const budgetPrimary = useCost ? data.totalBudgetCost : data.totalBudgetDays;
    const totalPrimary = useCost ? data.effectiveTotalCost : data.effectiveTotalDays;
    const windowPrimary = useCost ? data.windowCost : data.windowDays;
    const avgPrimary = useCost ? data.avgPeriodCost : data.avgPeriodDays;
    const hasBudget = budgetPrimary > 0;
    const variance = hasBudget ? (budgetPrimary - totalPrimary) : 0;
    const pctUsed = hasBudget ? Math.round((totalPrimary / budgetPrimary) * 100) : 0;
    const overBudget = hasBudget && variance < -0.01;

    const fmtPrimary = (v) => (useCost ? fmtMoney(v, db) : fmtDays(v));
    const maxPeriodVal = Math.max(0.01, ...data.byPeriod.map(r => (useCost ? r.cost : r.days)));
    const breakdownTotalCost = data.byDepartment.reduce((a, r) => a + r.cost, 0) + data.pbsMaterialCost + data.externalTotalCost;

    const periodRowsHtml = data.byPeriod.length === 0
      ? `<tr><td colspan="5" class="px-3 py-4 text-center text-slate-400">No periods in current timeframe.</td></tr>`
      : data.byPeriod.map(r => {
          const val = useCost ? r.cost : r.days;
          const cum = useCost ? r.cumCost : r.cumDays;
          const barW = Math.min(100, Math.round((val / maxPeriodVal) * 100));
          const cumPct = hasBudget ? `${Math.round((cum / budgetPrimary) * 100)}%` : '-';
          return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/70">
              <th scope="row" class="px-3 py-2 text-left font-semibold text-slate-800 whitespace-nowrap">${esc(r.label)}</th>
              <td class="px-3 py-2 text-right tabular-nums text-slate-700">${fmtDays(r.days)}</td>
              ${useCost ? `<td class="px-3 py-2 text-right tabular-nums font-bold text-slate-900">${fmtMoney(r.cost, db)}</td>` : ''}
              <td class="px-3 py-2 text-right tabular-nums text-slate-600">${fmtPrimary(cum)}</td>
              <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                    <div class="h-full rounded-full ${overBudget ? 'bg-rose-500' : 'bg-indigo-500'}" style="width:${barW}%"></div>
                  </div>
                  <span class="text-[11px] font-semibold tabular-nums text-slate-500 w-10 text-right">${cumPct}</span>
                </div>
              </td>
            </tr>`;
        }).join('');

    const deptRowsHtml = [
      ...data.byDepartment.map(r => {
        const val = useCost ? r.cost : r.days;
        const denom = useCost ? breakdownTotalCost : data.windowDays;
        const sharePct = denom > 0 ? Math.round((val / denom) * 1000) / 10 : 0;
        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50/70">
            <th scope="row" class="px-3 py-2 text-left font-semibold text-slate-800 whitespace-nowrap">
              <span class="inline-flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${esc(r.dept.color || '#6366f1')}" aria-hidden="true"></span>
                <span>${esc(r.dept.name)}</span>
              </span>
            </th>
            ${useCost ? `<td class="px-3 py-2 text-right tabular-nums text-slate-500">${fmtMoney(r.rate, db)}/d</td>` : ''}
            <td class="px-3 py-2 text-right tabular-nums text-slate-700">${fmtDays(r.days)}</td>
            ${useCost ? `<td class="px-3 py-2 text-right tabular-nums font-bold text-slate-900">${fmtMoney(r.cost, db)}</td>` : ''}
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                  <div class="h-full rounded-full" style="width:${Math.min(100, sharePct)}%;background:${esc(r.dept.color || '#6366f1')}"></div>
                </div>
                <span class="text-[11px] font-bold tabular-nums text-slate-700 w-11 text-right">${sharePct}%</span>
              </div>
            </td>
          </tr>`;
      }),
      ...(useCost && data.pbsMaterialCost > 0 ? [(() => {
        const sharePct = breakdownTotalCost > 0 ? Math.round((data.pbsMaterialCost / breakdownTotalCost) * 1000) / 10 : 0;
        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50/70">
            <th scope="row" class="px-3 py-2 text-left font-semibold text-slate-800 whitespace-nowrap">
              <span class="inline-flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full shrink-0 bg-amber-500" aria-hidden="true"></span>
                <span>PBS Materials (${data.pbsMaterialItems} item${data.pbsMaterialItems === 1 ? '' : 's'})</span>
              </span>
            </th>
            <td class="px-3 py-2 text-right text-slate-400">&mdash;</td>
            <td class="px-3 py-2 text-right text-slate-400">&mdash;</td>
            <td class="px-3 py-2 text-right tabular-nums font-bold text-slate-900">${fmtMoney(data.pbsMaterialCost, db)}</td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                  <div class="h-full rounded-full bg-amber-500" style="width:${Math.min(100, sharePct)}%"></div>
                </div>
                <span class="text-[11px] font-bold tabular-nums text-slate-700 w-11 text-right">${sharePct}%</span>
              </div>
            </td>
          </tr>`;
      })()] : []),
      ...(useCost && data.externalTotalCost > 0 ? [(() => {
        const sharePct = breakdownTotalCost > 0 ? Math.round((data.externalTotalCost / breakdownTotalCost) * 1000) / 10 : 0;
        return `
          <tr class="border-b border-slate-100 hover:bg-slate-50/70">
            <th scope="row" class="px-3 py-2 text-left font-semibold text-slate-800 whitespace-nowrap">
              <span class="inline-flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full shrink-0 bg-teal-500" aria-hidden="true"></span>
                <span>External Consultants (${data.externalCosts.length})</span>
              </span>
            </th>
            <td class="px-3 py-2 text-right text-slate-400">&mdash;</td>
            <td class="px-3 py-2 text-right text-slate-400">&mdash;</td>
            <td class="px-3 py-2 text-right tabular-nums font-bold text-slate-900">${fmtMoney(data.externalTotalCost, db)}</td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                  <div class="h-full rounded-full bg-teal-500" style="width:${Math.min(100, sharePct)}%"></div>
                </div>
                <span class="text-[11px] font-bold tabular-nums text-slate-700 w-11 text-right">${sharePct}%</span>
              </div>
            </td>
          </tr>`;
      })()] : []),
    ].join('') || `<tr><td colspan="${useCost ? 5 : 4}" class="px-3 py-4 text-center text-slate-400">No spending allocated in this timeframe.</td></tr>`;

    const projMap = new Map((db.projects || []).map(p => [p.id, p]));
    const extRowsHtml = data.externalCosts.length === 0
      ? `<tr><td colspan="5" class="px-3 py-3 text-center text-slate-400">No external / consultant costs recorded for this scope.</td></tr>`
      : data.externalCosts.map(c => {
          const p = projMap.get(c.projectId);
          return `
            <tr class="border-b border-slate-100 hover:bg-slate-50/70">
              <td class="px-3 py-1.5 font-semibold text-slate-800">${esc(p ? (p.code || p.name) : c.projectId)}</td>
              <td class="px-3 py-1.5 text-slate-700">${esc(c.label)}</td>
              <td class="px-3 py-1.5 text-slate-500 tabular-nums">${esc(c.period || 'Project-wide')}</td>
              <td class="px-3 py-1.5 text-right font-bold tabular-nums text-slate-900">${fmtMoney(c.amount, db)}</td>
              <td class="px-3 py-1.5 text-right">
                <button type="button" data-pp-del-ext="${esc(c.id)}" class="text-rose-600 hover:text-rose-800 text-[11px] font-semibold cursor-pointer" aria-label="Remove consultant cost ${esc(c.label)}">Remove</button>
              </td>
            </tr>`;
        }).join('');

    frame.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="ppBurnBudgetHeading" class="text-sm md:text-base font-extrabold text-slate-900">Burn &amp; Budget Analysis</h2>
          <p class="text-[11px] text-slate-500 mt-0.5">Scope: <strong class="text-slate-700">${esc(scopeLabel)}</strong> &middot; ${periods.length} ${ui.timeUnit || 'month'}${periods.length === 1 ? '' : 's'}</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <label class="md:hidden inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
            <span>Project:</span>
            <select id="ppMobileHealthProjectSel" class="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 text-[11px] font-bold" aria-label="Filter Health and Evolution by project">
              <option value="all" ${(!ui.filterProj || ui.filterProj === 'all') ? 'selected' : ''}>All Projects (${sortedProjs.length})</option>
              ${sortedProjs.map(p => `<option value="${esc(p.id)}" ${ui.filterProj === p.id ? 'selected' : ''}>${esc(fmtProj(p))}</option>`).join('')}
            </select>
          </label>
          ${hasBudget ? `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${overBudget ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${pctUsed}% of budget planned</span>` : ''}
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Budget</div>
          <div class="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">${hasBudget ? fmtPrimary(budgetPrimary) : 'Not set'}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">${useCost && data.totalBudgetDays > 0 ? `Effort budget: ${fmtDays(data.totalBudgetDays)}` : (hasBudget ? 'Configured target' : 'Set in Setup & Data')}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Window Burn</div>
          <div class="text-lg font-extrabold text-indigo-600 mt-0.5 tabular-nums">${fmtPrimary(windowPrimary)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">${useCost ? `${fmtDays(data.windowDays)} in visible window` : 'Across visible periods'}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${hasBudget ? (overBudget ? 'Over Budget' : 'Remaining Budget') : 'Total Planned'}</div>
          <div class="text-lg font-extrabold mt-0.5 tabular-nums ${overBudget ? 'text-rose-600' : (hasBudget ? 'text-emerald-600' : 'text-slate-900')}">${hasBudget ? fmtPrimary(Math.abs(variance)) : fmtPrimary(totalPrimary)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">Total plan: ${fmtPrimary(totalPrimary)}${(data.pbsMaterialCost > 0 || data.externalTotalCost > 0) ? ` (incl. PBS &amp; Ext.)` : ''}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg Burn / ${ui.timeUnit === 'week' ? 'Week' : 'Month'}</div>
          <div class="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">${fmtPrimary(avgPrimary)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">PBS: ${fmtMoney(data.pbsMaterialCost, db)} &middot; Ext: ${fmtMoney(data.externalTotalCost, db)}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="rounded-xl border border-slate-200 overflow-hidden">
          <div class="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">Spending Split by Period</div>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-xs">
              <caption class="sr-only">Planned burn and cumulative spending by period</caption>
              <thead>
                <tr class="bg-slate-50/60 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                  <th scope="col" class="px-3 py-2 text-left">Period</th>
                  <th scope="col" class="px-3 py-2 text-right">Days</th>
                  ${useCost ? '<th scope="col" class="px-3 py-2 text-right">Spend</th>' : ''}
                  <th scope="col" class="px-3 py-2 text-right">Cumulative</th>
                  <th scope="col" class="px-3 py-2 text-left">Profile</th>
                </tr>
              </thead>
              <tbody>${periodRowsHtml}</tbody>
              <tfoot>
                <tr class="bg-slate-50 font-bold text-slate-900 border-t border-slate-200">
                  <th scope="row" class="px-3 py-2 text-left">Window Total</th>
                  <td class="px-3 py-2 text-right tabular-nums">${fmtDays(data.windowDays)}</td>
                  ${useCost ? `<td class="px-3 py-2 text-right tabular-nums">${fmtMoney(data.windowCost, db)}</td>` : ''}
                  <td class="px-3 py-2 text-right tabular-nums">${fmtPrimary(windowPrimary)}</td>
                  <td class="px-3 py-2 text-right text-[11px] text-slate-500">${hasBudget ? `${pctUsed}%` : ''}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 overflow-hidden">
          <div class="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">Spending Split by Department &amp; Non-Labour</div>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-xs">
              <caption class="sr-only">Planned burn and spending share by department, PBS materials, and external consultants</caption>
              <thead>
                <tr class="bg-slate-50/60 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                  <th scope="col" class="px-3 py-2 text-left">Category</th>
                  ${useCost ? '<th scope="col" class="px-3 py-2 text-right">Rate</th>' : ''}
                  <th scope="col" class="px-3 py-2 text-right">Days</th>
                  ${useCost ? '<th scope="col" class="px-3 py-2 text-right">Spend</th>' : ''}
                  <th scope="col" class="px-3 py-2 text-left">Share</th>
                </tr>
              </thead>
              <tbody>${deptRowsHtml}</tbody>
              <tfoot>
                <tr class="bg-slate-50 font-bold text-slate-900 border-t border-slate-200">
                  <th scope="row" class="px-3 py-2 text-left">Total</th>
                  ${useCost ? '<td class="px-3 py-2"></td>' : ''}
                  <td class="px-3 py-2 text-right tabular-nums">${fmtDays(data.windowDays)}</td>
                  ${useCost ? `<td class="px-3 py-2 text-right tabular-nums">${fmtMoney(breakdownTotalCost, db)}</td>` : ''}
                  <td class="px-3 py-2 text-right tabular-nums">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-slate-200 overflow-hidden">
        <div class="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-bold text-slate-700">External / Consultant Costs</span>
          <span class="text-[11px] font-semibold text-slate-500">Total: ${fmtMoney(data.externalTotalCost, db)}</span>
        </div>
        <form id="ppExtCostForm" class="p-3 bg-slate-50/40 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
          <label class="block text-[11px] font-semibold text-slate-600">
            <span>Project</span>
            <select id="ppExtCostProj" class="mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs">
              ${sortedProjs.map(p => `<option value="${esc(p.id)}" ${ui.filterProj === p.id ? 'selected' : ''}>${esc(fmtProj(p))}</option>`).join('')}
            </select>
          </label>
          <label class="block text-[11px] font-semibold text-slate-600 sm:col-span-2">
            <span>Consultant / SOW Description</span>
            <input id="ppExtCostLabel" type="text" required maxlength="120" placeholder="e.g. EMC Lab Testing SOW" class="mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs" />
          </label>
          <label class="block text-[11px] font-semibold text-slate-600">
            <span>Amount (${esc((db.settings && db.settings.currencySymbol) || '€')})</span>
            <input id="ppExtCostAmount" type="number" required min="0.01" step="0.01" placeholder="5000" class="mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs" />
          </label>
          <div class="flex gap-1.5 items-end">
            <label class="block flex-1 text-[11px] font-semibold text-slate-600">
              <span>Period (opt.)</span>
              <select id="ppExtCostPeriod" class="mt-0.5 w-full px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs">
                <option value="">Project-wide</option>
                ${periods.map(pk => `<option value="${esc(pk)}">${esc(pk)}</option>`).join('')}
              </select>
            </label>
            <button type="submit" class="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer">Add</button>
          </div>
        </form>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <caption class="sr-only">External and consultant costs for in-scope projects</caption>
            <thead>
              <tr class="bg-slate-50/60 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                <th scope="col" class="px-3 py-1.5 text-left">Project</th>
                <th scope="col" class="px-3 py-1.5 text-left">Description</th>
                <th scope="col" class="px-3 py-1.5 text-left">Period</th>
                <th scope="col" class="px-3 py-1.5 text-right">Amount</th>
                <th scope="col" class="px-3 py-1.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>${extRowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    frame.querySelector('#ppMobileHealthProjectSel')?.addEventListener('change', (ev) => {
      ui.filterProj = ev.target.value || 'all';
      if (typeof renderAll === 'function') renderAll();
    });

    frame.querySelector('#ppExtCostForm')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const projId = frame.querySelector('#ppExtCostProj')?.value || '';
      const label = String(frame.querySelector('#ppExtCostLabel')?.value || '').trim().slice(0, 120);
      const amount = Number(frame.querySelector('#ppExtCostAmount')?.value);
      const period = String(frame.querySelector('#ppExtCostPeriod')?.value || '').trim();
      if (!projId || !label || !Number.isFinite(amount) || amount <= 0) return;
      const list = ensureExternalCosts(db);
      list.push({
        id: typeof uid === 'function' ? uid('ext') : `ext_${Date.now().toString(36)}`,
        projectId: projId,
        label,
        amount: Math.round(amount * 100) / 100,
        period,
      });
      db.settings.externalCosts = list;
      if (typeof recordChange === 'function') recordChange('Finance', `Added external cost: ${label} (${fmtMoney(amount, db)})`);
      if (typeof touchDBAndSave === 'function') touchDBAndSave();
      if (typeof showToast === 'function') showToast(`Saved external cost: ${label}`, 'success');
      renderHealthBurnBudgetFrame();
    });

    frame.querySelectorAll('[data-pp-del-ext]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pp-del-ext');
        const list = ensureExternalCosts(db);
        const idx = list.findIndex(c => c.id === id);
        if (idx >= 0) {
          const [removed] = list.splice(idx, 1);
          db.settings.externalCosts = list;
          if (typeof recordChange === 'function') recordChange('Finance', `Removed external cost: ${removed.label}`);
          if (typeof touchDBAndSave === 'function') touchDBAndSave();
          if (typeof showToast === 'function') showToast(`Removed external cost: ${removed.label}`, 'info');
          renderHealthBurnBudgetFrame();
        }
      });
    });
  }

  ppHooks.on('afterRenderHealth', renderHealthBurnBudgetFrame);
  ppHooks.on('afterRenderAll', () => {
    enhanceA11yLandmarksAndTabs();
    wireCustomModalFocusTrap();
    wirePbsDialogObserver();
    if (typeof ui !== 'undefined' && ui.activeTab === 'health') {
      renderHealthBurnBudgetFrame();
    }
  });

  if (typeof renderHealthDashboard === 'function') {
    const origRenderHealth = renderHealthDashboard;
    renderHealthDashboard = function (...args) {
      pruneNominalCapacityOverrides(getDb());
      const res = origRenderHealth.apply(this, args);
      ppHooks.emit('afterRenderHealth', getDb());
      return res;
    };
  }

  if (typeof renderAll === 'function') {
    const origRenderAll = renderAll;
    renderAll = function (...args) {
      pruneNominalCapacityOverrides(getDb());
      const res = origRenderAll.apply(this, args);
      ppHooks.emit('afterRenderAll', getDb());
      return res;
    };
  }

  if (typeof document !== 'undefined') {
    const bootA11y = () => {
      enhanceA11yLandmarksAndTabs();
      wireCustomModalFocusTrap();
      wirePbsDialogObserver();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootA11y);
    } else {
      bootA11y();
    }
  }

  globalThis.__ppHealthBurnTestApi = {
    pruneNominalCapacityOverrides,
    computePbsMaterialCost,
    computeBurnBudgetAnalysis,
    ppHooks,
  };
})();
