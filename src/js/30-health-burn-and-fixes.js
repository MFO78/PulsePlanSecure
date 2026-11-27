/* ============================================================================
 * 30. HEALTH & EVOLUTION BURN/BUDGET ANALYSIS + VARIABLE CAPACITY RESET FIX
 * ============================================================================ */
(function ppHealthBurnAndFixesModule() {
  if (typeof globalThis === 'undefined') return;

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
      settings: {},
    };
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

  /* ---------- 1. Variable Capacity Reset Hygiene ---------- */
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

  if (typeof globalThis !== 'undefined') {
    globalThis.pruneNominalCapacityOverrides = pruneNominalCapacityOverrides;
  }

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

  /* ---------- 2. Burn & Budget Analysis Computation ---------- */
  function computeBurnBudgetAnalysis(db, periods, timeUnit, filterProj, filterDept, includeTentative) {
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

    const hasRates = (typeof hasAnyDayRates === 'function' ? hasAnyDayRates(db) : false) ||
      allDepts.some(d => getDeptRate(d, db) > 0);

    const totalBudgetDays = activeProjs.reduce((acc, p) => acc + (Number(p.budgetDays) || 0), 0);
    const totalBudgetCost = activeProjs.reduce((acc, p) => acc + (Number(p.budgetCost) || 0), 0);

    const allPlanDays = activeProjs.reduce((acc, p) => {
      if (typeof getProjectTotalPlannedDays === 'function') return acc + (Number(getProjectTotalPlannedDays(p.id, db)) || 0);
      return acc;
    }, 0);
    const allPlanCost = hasRates ? activeProjs.reduce((acc, p) => {
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
        cumDays: cumulativeDays,
        cumCost: cumulativeCost,
      };
    });

    const byDepartment = [...deptTotals.values()]
      .filter(row => row.days > 0.001 || row.cost > 0.001)
      .sort((a, b) => (hasRates ? (b.cost - a.cost) : (b.days - a.days)) || (b.days - a.days));

    const effectiveTotalDays = allPlanDays > 0 ? allPlanDays : windowDays;
    const effectiveTotalCost = allPlanCost > 0 ? allPlanCost : windowCost;

    return {
      activeProjs,
      hasRates,
      totalBudgetDays,
      totalBudgetCost,
      windowDays,
      windowCost,
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

    const db = getDb();
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
      if (kpisEl && kpisEl.parentElement) {
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

    const deptRowsHtml = data.byDepartment.length === 0
      ? `<tr><td colspan="${useCost ? 5 : 4}" class="px-3 py-4 text-center text-slate-400">No spending allocated in this timeframe.</td></tr>`
      : data.byDepartment.map(r => {
          const val = useCost ? r.cost : r.days;
          const sharePct = windowPrimary > 0 ? Math.round((val / windowPrimary) * 1000) / 10 : 0;
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
        }).join('');

    frame.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="ppBurnBudgetHeading" class="text-sm md:text-base font-extrabold text-slate-900">Burn &amp; Budget Analysis</h2>
          <p class="text-[11px] text-slate-500 mt-0.5">Scope: <strong class="text-slate-700">${esc(scopeLabel)}</strong> &middot; ${periods.length} ${ui.timeUnit || 'month'}${periods.length === 1 ? '' : 's'}</p>
        </div>
        ${hasBudget ? `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${overBudget ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${pctUsed}% of budget planned</span>` : ''}
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
          <div class="text-[11px] text-slate-500 mt-0.5">Total plan: ${fmtPrimary(totalPrimary)}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg Burn / ${ui.timeUnit === 'week' ? 'Week' : 'Month'}</div>
          <div class="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">${fmtPrimary(avgPrimary)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">${data.byDepartment.length} active department${data.byDepartment.length === 1 ? '' : 's'}</div>
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
          <div class="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">Spending Split by Department</div>
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-xs">
              <caption class="sr-only">Planned burn and spending share by department</caption>
              <thead>
                <tr class="bg-slate-50/60 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                  <th scope="col" class="px-3 py-2 text-left">Department</th>
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
                  ${useCost ? `<td class="px-3 py-2 text-right tabular-nums">${fmtMoney(data.windowCost, db)}</td>` : ''}
                  <td class="px-3 py-2 text-right tabular-nums">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  if (typeof renderHealthDashboard === 'function') {
    const origRenderHealth = renderHealthDashboard;
    renderHealthDashboard = function (...args) {
      pruneNominalCapacityOverrides(getDb());
      const res = origRenderHealth.apply(this, args);
      renderHealthBurnBudgetFrame();
      return res;
    };
  }

  if (typeof renderAll === 'function') {
    const origRenderAll = renderAll;
    renderAll = function (...args) {
      pruneNominalCapacityOverrides(getDb());
      const res = origRenderAll.apply(this, args);
      if (typeof ui !== 'undefined' && ui.activeTab === 'health') {
        renderHealthBurnBudgetFrame();
      }
      return res;
    };
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__ppHealthBurnTestApi = {
      pruneNominalCapacityOverrides,
      computeBurnBudgetAnalysis,
    };
  }
})();
