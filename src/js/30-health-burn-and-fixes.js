/* ============================================================================
 * 30. HEALTH & EVOLUTION BURN/BUDGET ANALYSIS (LABOUR + PBS MATERIALS +
 *     EXTERNAL CONSULTANTS), CAPACITY RESET HYGIENE, ROADMAP DEFAULT TO TODAY
 *     + PER-USER DEFAULT DEPT ROADMAP VIEW, LIFECYCLE HOOK BUS & A11Y
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

  function canSeeFinance() {
    return typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance();
  }

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
    const topArr = Array.isArray(db.externalCosts) ? db.externalCosts : null;
    const legacyArr = (db.settings && Array.isArray(db.settings.externalCosts)) ? db.settings.externalCosts : null;
    if (topArr && topArr.length > 0) {
      if (db.settings && 'externalCosts' in db.settings) delete db.settings.externalCosts;
      return topArr;
    }
    if (legacyArr && legacyArr.length > 0) {
      db.externalCosts = legacyArr.slice();
      delete db.settings.externalCosts;
      return db.externalCosts;
    }
    if (!topArr) db.externalCosts = [];
    if (db.settings && 'externalCosts' in db.settings) delete db.settings.externalCosts;
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
    const sym = (db && db.settings && (db.settings.currency || db.settings.currencySymbol)) || '€';
    return `${sym}${Math.round(Number(val) || 0).toLocaleString('en-GB')}`;
  }

  function fmtDays(val) {
    const n = Math.round((Number(val) || 0) * 10) / 10;
    return `${Number.isInteger(n) ? n : n.toFixed(1)}d`;
  }

  function getDeptRate(dept, db) {
    if (!dept || !canSeeFinance()) return 0;
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
    if (!canSeeFinance()) return { total: 0, itemCount: 0 };
    const cache = pbsCache || loadPbsCacheSafe();
    const idSet = new Set(projectIds || []);
    const treeApi = globalThis.__ppPbsV2 && globalThis.__ppPbsV2.tree;
    let total = 0;
    let itemCount = 0;
    idSet.forEach(pid => {
      const doc = cache[pid];
      const items = doc && Array.isArray(doc.items) ? doc.items : [];
      if (!items.length) return;
      if (treeApi && typeof treeApi.computeSwpRollups === 'function') {
        const rollups = treeApi.computeSwpRollups(doc);
        if (rollups && rollups.totalUnitCost != null && Number.isFinite(rollups.totalUnitCost) && rollups.totalUnitCost > 0) {
          total += rollups.totalUnitCost;
          itemCount += Number(rollups.unitCostCount) || 0;
        }
        return;
      }
      items.forEach(it => {
        const uc = Number(it && it.unitCost);
        if (Number.isFinite(uc) && uc > 0) {
          const q = (Number.isFinite(Number(it.qty)) && Number(it.qty) >= 1) ? Number(it.qty) : 1;
          total += uc * q;
          itemCount++;
        }
      });
    });
    return { total: Math.round(total * 100) / 100, itemCount };
  }

  function wireDomObserver() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.__ppUserDefaultViewObserver) return;
    document.__ppUserDefaultViewObserver = new MutationObserver(() => {
      if (typeof ppHasAdminAccess === 'function' && !ppHasAdminAccess()) return;
      if (document.querySelector('article.pp-user-card[data-pp-user-row]')) {
        injectUserDefaultViewCheckboxes();
      }
    });
    if (document.body) {
      document.__ppUserDefaultViewObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  /* ---------- Roadmap Default to Today (General) + Per-User Default Dept Roadmap View ---------- */
  let _initialTodayApplied = false;
  let _lastAppliedSessionKey = null;

  function resetRoadmapToTodaySilently() {
    if (typeof ui === 'undefined') return;
    if (typeof getCurrentMonthKey === 'function') ui.startMonth = getCurrentMonthKey();
    if (typeof getCurrentWeekKey === 'function') ui.startWeek = getCurrentWeekKey();
    ui.mobileSelectedPeriod = ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;
  }

  function userHasRoadmapAccess(u) {
    if (!u) return false;
    if (u.isAdmin) return true;
    const tabs = u.permissions && u.permissions.tabs;
    if (!tabs || typeof tabs !== 'object') return true;
    return tabs.matrix !== false;
  }

  /* Resolve the user's department from existing DB data (Departments.manager match, then roleTitle match) */
  function resolveUserDepartment(user, db) {
    if (!user || !db || !Array.isArray(db.departments)) return null;
    const depts = db.departments.filter(Boolean);
    if (!depts.length) return null;

    const uName = String(user.name || '').trim().toLowerCase();
    if (uName) {
      const byExactMgr = depts.find(d => String(d.manager || '').trim().toLowerCase() === uName);
      if (byExactMgr) return byExactMgr;
      const byListedMgr = depts.find(d => {
        const parts = String(d.manager || '').toLowerCase().split(/[,/&;]+/).map(s => s.trim()).filter(Boolean);
        return parts.includes(uName);
      });
      if (byListedMgr) return byListedMgr;
    }

    const uRole = String(user.roleTitle || '').trim().toLowerCase();
    if (uRole) {
      const byName = depts.find(d => String(d.name || '').trim().toLowerCase() === uRole);
      if (byName) return byName;
      const byCode = depts.find(d => {
        const c = String(d.code || '').trim().toLowerCase();
        return c && (uRole === c || new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(uRole));
      });
      if (byCode) return byCode;
      const byContains = depts.find(d => {
        const dn = String(d.name || '').trim().toLowerCase();
        return dn && uRole.includes(dn);
      });
      if (byContains) return byContains;
    }
    return null;
  }

  function applySessionStartupAndDefaultView() {
    if (typeof ui === 'undefined') return;

    const shiftedByLoad = Boolean(globalThis.__ppHorizonShiftedByLoad);

    // 1. Default Roadmap to Today on initial app startup (unless a DB load deliberately shifted to data start)
    if (!_initialTodayApplied) {
      _initialTodayApplied = true;
      if (!shiftedByLoad) resetRoadmapToTodaySilently();
    }

    if (typeof ppGetAuthSession !== 'function') {
      globalThis.__ppHorizonShiftedByLoad = false;
      return;
    }
    const session = ppGetAuthSession();
    if (!session || session.mode === 'locked') {
      _lastAppliedSessionKey = null;
      return;
    }

    const sessionKey = `${session.mode}:${session.userId || ''}`;
    if (_lastAppliedSessionKey === sessionKey) {
      globalThis.__ppHorizonShiftedByLoad = false;
      return;
    }
    _lastAppliedSessionKey = sessionKey;

    // 2. If named user has the Default Dept Roadmap View enabled & has Roadmap access, apply it cleanly
    let appliedPerUserView = false;
    if (session.mode === 'user' && session.userId) {
      const db = (typeof liveDB !== 'undefined' && liveDB) ? liveDB : getDb();
      const users = db && db.accessControl && Array.isArray(db.accessControl.users) ? db.accessControl.users : [];
      const userRec = users.find(u => u && u.id === session.userId);
      if (userRec && userRec.defaultDeptRoadmapView && userHasRoadmapAccess(userRec)) {
        const matchedDept = resolveUserDepartment(userRec, db);
        ui.activeTab = 'matrix';
        ui.timeUnit = 'week';
        ui.horizon = 2;
        ui.axis = 'department';
        ui.filterDept = matchedDept ? matchedDept.id : 'all';
        ui.filterProj = 'all';
        ui.matrixSearch = '';
        ui.spotlightProjId = '';
        resetRoadmapToTodaySilently();
        appliedPerUserView = true;
      }
    }

    // 3. Otherwise default Roadmap to Today upon sign-in, unless syncHorizonAfterDBLoad intentionally jumped to data start
    if (!appliedPerUserView && !shiftedByLoad) {
      resetRoadmapToTodaySilently();
    }

    globalThis.__ppHorizonShiftedByLoad = false;
    if (typeof persistUIPrefs === 'function') persistUIPrefs();
  }

  /* Inject the per-user checkbox directly inside each .pp-user-card (both Setup & Data and Team Users modal) */
  function injectUserDefaultViewCheckboxes() {
    if (typeof document === 'undefined') return;
    if (typeof ppHasAdminAccess === 'function' && !ppHasAdminAccess()) return;
    const db = (typeof liveDB !== 'undefined' && liveDB) ? liveDB : getDb();
    const users = db && db.accessControl && Array.isArray(db.accessControl.users) ? db.accessControl.users : [];
    if (!users.length) return;

    document.querySelectorAll('article.pp-user-card[data-pp-user-row]').forEach(card => {
      const uidVal = card.getAttribute('data-pp-user-row');
      const u = users.find(x => x && x.id === uidVal);
      if (!u) return;
      const hasRoadmap = userHasRoadmapAccess(u);
      const isDisabled = u.enabled === false;
      const canToggle = hasRoadmap && !isDisabled;
      const checked = hasRoadmap && Boolean(u.defaultDeptRoadmapView);
      const dept = resolveUserDepartment(u, db);
      const deptHint = dept
        ? `Department: ${dept.name}`
        : 'No department matched (set user as Manager in Setup → Departments)';

      const sig = `${hasRoadmap}|${isDisabled}|${checked}|${dept ? dept.id : ''}`;
      let wrap = card.querySelector('.pp-user-default-view-row');
      if (wrap && wrap.getAttribute('data-pp-sig') === sig) return;
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'pp-user-default-view-row pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2';
        card.appendChild(wrap);
      }
      wrap.setAttribute('data-pp-sig', sig);
      wrap.innerHTML = `
        <label class="inline-flex items-center gap-2 text-[11.5px] font-semibold ${canToggle ? 'text-slate-700 cursor-pointer' : 'text-slate-400 cursor-not-allowed'}">
          <input type="checkbox" data-pp-udv-cb="${esc(u.id)}" ${checked ? 'checked' : ''} ${canToggle ? '' : 'disabled'}
            class="w-4 h-4 rounded" />
          <span>Default after login: Roadmap &middot; 2 weeks &middot; Department view (Today)</span>
        </label>
        <span class="text-[10.5px] ${!hasRoadmap ? 'text-amber-600 font-semibold' : (dept ? 'text-indigo-600 font-semibold' : 'text-slate-400')}">
          ${!hasRoadmap ? 'Requires Roadmap access' : esc(deptHint)}
        </span>`;

      const cb = wrap.querySelector('[data-pp-udv-cb]');
      cb?.addEventListener('change', async () => {
        const targetDb = (typeof liveDB !== 'undefined' && liveDB) ? liveDB : getDb();
        const freshList = targetDb && targetDb.accessControl && Array.isArray(targetDb.accessControl.users)
          ? targetDb.accessControl.users
          : [];
        const freshUser = freshList.find(x => x && x.id === uidVal);
        if (!freshUser) return;
        if (!userHasRoadmapAccess(freshUser) || freshUser.enabled === false) {
          cb.checked = false;
          freshUser.defaultDeptRoadmapView = false;
          return;
        }
        freshUser.defaultDeptRoadmapView = Boolean(cb.checked);
        freshUser.updatedAt = new Date().toISOString();
        const msg = `${freshUser.defaultDeptRoadmapView ? 'Enabled' : 'Disabled'} default 2-week Department Roadmap view on login for "${freshUser.name}"`;

        const isNonLive = Boolean(typeof ui !== 'undefined' && (ui.demoMode || ui.whatIfMode));
        if (isNonLive) {
          // Persist directly to liveDB without mutating Demo/What-If sandbox
          if (Array.isArray(targetDb.changeLog)) {
            targetDb.changeLog.unshift({
              id: typeof uid === 'function' ? uid('log') : `log_${Date.now().toString(36)}`,
              timestamp: new Date().toISOString(),
              user: (typeof ui !== 'undefined' && ui.userName) || 'Administrator',
              type: 'Access',
              summary: msg,
            });
          }
          targetDb.meta = targetDb.meta || { version: 3, revision: 0 };
          targetDb.meta.revision = (targetDb.meta.revision || 0) + 1;
          targetDb.meta.lastModifiedAt = new Date().toISOString();
          if (typeof ppPersistLiveDBCacheSafe === 'function') ppPersistLiveDBCacheSafe(targetDb);
        } else if (typeof recordChange === 'function') {
          // recordChange already invokes touchDBAndSave() once — avoid double revision bump
          recordChange('Access', msg);
        } else if (typeof touchDBAndSave === 'function') {
          touchDBAndSave();
        }
        if (!isNonLive && typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof writeDBToLinkedFile === 'function') {
          try { await writeDBToLinkedFile(); } catch (_e) {}
        }
        if (typeof showToast === 'function') showToast(msg, 'success');
        injectUserDefaultViewCheckboxes();
      });
    });
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
      html.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/40,
      body.dark #ppHealthBurnBudgetFrame .bg-slate-50,
      body.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/70,
      body.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/60,
      body.dark #ppHealthBurnBudgetFrame .bg-slate-50\\/40 {
        background-color: var(--surface-subtle, #1e293b);
      }
      html.dark #ppHealthBurnBudgetFrame input,
      html.dark #ppHealthBurnBudgetFrame select,
      body.dark #ppHealthBurnBudgetFrame input,
      body.dark #ppHealthBurnBudgetFrame select {
        background-color: #0f172a;
        color: #f1f5f9;
        border-color: #334155;
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

  /* ---------- 1. HTML5 Landmarks & Tabpanel ARIA ---------- */
  function enhanceA11yLandmarksAndTabs() {
    if (typeof document === 'undefined' || !document.querySelector) return;

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

  // Wrap the real capacity override mutation functions (never prune passively inside renderAll or defaultCapacity stepping)
  [
    'saveCapacityModal',
    'resetCapacityOverrideFromModal',
    'applyPeriodDeptCapacityModal',
    'resetPeriodDeptCapacityModal',
    'resetCapacityOverrideSpan',
    'resetCompanyOverrideGroup',
  ].forEach(fnName => {
    if (typeof globalThis[fnName] === 'function') {
      const orig = globalThis[fnName];
      globalThis[fnName] = function (...args) {
        const res = orig.apply(this, args);
        const pruned = pruneNominalCapacityOverrides(getDb());
        if (pruned > 0 && typeof renderAll === 'function') renderAll();
        return res;
      };
    }
  });

  if (typeof touchDBAndSave === 'function') {
    const origTouch = touchDBAndSave;
    touchDBAndSave = function (...args) {
      ppHooks.emit('beforeSave', getDb());
      return origTouch.apply(this, args);
    };
  }

  /* ---------- 3. Burn & Budget Analysis Computation (Labour + PBS Materials + External Consultants) ---------- */
  function matchExternalCostForPeriod(cost, pk, timeUnit) {
    const p = String((cost && cost.period) || '').trim();
    const amt = Number(cost && cost.amount) || 0;
    if (!p || amt <= 0) return 0;
    if (p === pk) return amt;
    const isMonthPeriod = /^\d{4}-\d{2}$/.test(p);
    const isWeekPeriod = /^\d{4}-W\d{2}$/i.test(p);
    if (timeUnit === 'week' && isMonthPeriod && typeof getWeeksInMonth === 'function') {
      const wks = getWeeksInMonth(p);
      if (Array.isArray(wks) && wks.includes(pk) && wks.length > 0) {
        return amt / wks.length;
      }
    }
    if (timeUnit === 'month' && isWeekPeriod && typeof getWeekOwningMonth === 'function') {
      if (getWeekOwningMonth(p.toUpperCase()) === pk) {
        return amt;
      }
    }
    return 0;
  }

  function computeBurnBudgetAnalysis(db, periods, timeUnit, filterProj, filterDept, includeTentative, pbsCacheOverride) {
    const allowFinance = canSeeFinance();
    const allDepts = (db.departments || []).filter(d => filterDept === 'all' || d.id === filterDept);
    const deptIdSet = filterDept && filterDept !== 'all' ? new Set(allDepts.map(d => d.id)) : null;

    const activeProjs = (db.projects || []).filter(p => {
      if (!p) return false;
      if (typeof isNonFteProject === 'function' && isNonFteProject(p)) return false;
      if (p.nonFte || p.category === 'admin') return false;
      if (filterProj && filterProj !== 'all') return p.id === filterProj;
      if (p.archived) return false;
      if (typeof isProjectIncludedInPlan === 'function') return isProjectIncludedInPlan(p);
      if (!includeTentative && p.tentative) return false;
      return true;
    });
    const activeProjIds = new Set(activeProjs.map(p => p.id));

    const pbsMaterials = allowFinance
      ? computePbsMaterialCost(Array.from(activeProjIds), pbsCacheOverride)
      : { total: 0, itemCount: 0 };
    const allExternalCosts = allowFinance ? ensureExternalCosts(db) : [];
    const externalCosts = allowFinance
      ? allExternalCosts.filter(c => c && activeProjIds.has(c.projectId))
      : [];
    const externalTotalCost = allowFinance
      ? externalCosts.reduce((acc, c) => acc + (Number(c.amount) || 0), 0)
      : 0;

    const hasRates = allowFinance && (
      (typeof hasAnyDayRates === 'function' ? hasAnyDayRates(db) : false) ||
      allDepts.some(d => getDeptRate(d, db) > 0) ||
      pbsMaterials.total > 0 ||
      externalTotalCost > 0
    );

    const totalBudgetDays = activeProjs.reduce((acc, p) => acc + (Number(p.budgetDays) || 0), 0);
    const totalBudgetCost = allowFinance ? activeProjs.reduce((acc, p) => acc + (Number(p.budgetCost) || 0), 0) : 0;

    const dpw = Number(db && db.settings && db.settings.daysPerWeek) || 5;
    const rateByDept = new Map(allDepts.map(d => [d.id, getDeptRate(d, db)]));

    let allPlanDays = 0;
    let allPlanLabourCost = 0;
    if (!deptIdSet && typeof getProjectTotalPlannedDays === 'function' && typeof getProjectTotalPlannedCost === 'function') {
      allPlanDays = activeProjs.reduce((acc, p) => acc + (Number(getProjectTotalPlannedDays(p.id, db)) || 0), 0);
      allPlanLabourCost = hasRates
        ? activeProjs.reduce((acc, p) => acc + (Number(getProjectTotalPlannedCost(p.id, db)) || 0), 0)
        : 0;
    } else {
      Object.entries(db.allocations || {}).forEach(([key, fte]) => {
        const parts = key.split('::');
        const dId = parts[0];
        const pId = parts[1];
        if (!activeProjIds.has(pId)) return;
        if (deptIdSet && !deptIdSet.has(dId)) return;
        const days = (Number(fte) || 0) * dpw;
        allPlanDays += days;
        if (hasRates) {
          const rate = rateByDept.get(dId) || 0;
          if (rate > 0) allPlanLabourCost += days * rate;
        }
      });
      allPlanDays = Math.round(allPlanDays * 10) / 10;
      allPlanLabourCost = Math.round(allPlanLabourCost);
    }

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
            : dFte * dpw;
          const cost = allowFinance ? (days * rate) : 0;
          pDays += days;
          pCost += cost;
          const entry = deptTotals.get(d.id);
          if (entry) {
            entry.days += days;
            entry.cost += cost;
          }
        }
      });
      const periodExt = allowFinance
        ? externalCosts.reduce((acc, c) => acc + matchExternalCostForPeriod(c, pk, timeUnit), 0)
        : 0;
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
    const baseLabourCost = allowFinance
      ? (allPlanLabourCost > 0 ? allPlanLabourCost : Math.max(0, windowCost - externalWindowCost))
      : 0;
    const effectiveTotalCost = allowFinance ? (baseLabourCost + pbsMaterials.total + externalTotalCost) : 0;

    return {
      allowFinance,
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
    if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
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
    const allowFinance = data.allowFinance;

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

    const useCost = allowFinance && data.hasRates && (data.windowCost > 0 || data.totalBudgetCost > 0 || data.effectiveTotalCost > 0);
    // If cost mode is active but only effort budget (budgetDays) is set, fall back to effort budget for Budget KPI & % badge
    const useEffortBudgetFallback = useCost && data.totalBudgetCost <= 0 && data.totalBudgetDays > 0;
    const budgetPrimary = useCost
      ? (useEffortBudgetFallback ? data.totalBudgetDays : data.totalBudgetCost)
      : data.totalBudgetDays;
    const totalForBudget = useEffortBudgetFallback ? data.effectiveTotalDays : (useCost ? data.effectiveTotalCost : data.effectiveTotalDays);
    const windowForBudget = useEffortBudgetFallback ? data.windowDays : (useCost ? data.windowCost : data.windowDays);
    const totalPrimary = useCost ? data.effectiveTotalCost : data.effectiveTotalDays;
    const windowPrimary = useCost ? data.windowCost : data.windowDays;
    const avgPrimary = useCost ? data.avgPeriodCost : data.avgPeriodDays;
    const hasBudget = budgetPrimary > 0;
    const variance = hasBudget ? (budgetPrimary - totalForBudget) : 0;
    const pctUsed = hasBudget ? Math.round((totalForBudget / budgetPrimary) * 100) : 0;
    const windowPctOfBudget = hasBudget ? Math.round((windowForBudget / budgetPrimary) * 100) : 0;
    const overBudget = hasBudget && variance < -0.01;

    const fmtPrimary = (v) => (useCost ? fmtMoney(v, db) : fmtDays(v));
    const fmtBudgetVal = (v) => (useCost && !useEffortBudgetFallback ? fmtMoney(v, db) : fmtDays(v));
    const maxPeriodVal = Math.max(0.01, ...data.byPeriod.map(r => (useCost ? r.cost : r.days)));
    const breakdownTotalCost = data.byDepartment.reduce((a, r) => a + r.cost, 0) + data.pbsMaterialCost + data.externalTotalCost;
    const hasAnyBreakdown = useCost ? breakdownTotalCost > 0.001 : data.windowDays > 0.001;

    const periodColCount = useCost ? 5 : 4;
    const periodRowsHtml = data.byPeriod.length === 0
      ? `<tr><td colspan="${periodColCount}" class="px-3 py-4 text-center text-slate-400">No periods in current timeframe.</td></tr>`
      : data.byPeriod.map(r => {
          const val = useCost ? r.cost : r.days;
          const cum = useCost ? r.cumCost : r.cumDays;
          const cumBudgetRef = useEffortBudgetFallback ? r.cumDays : cum;
          const barW = Math.min(100, Math.round((val / maxPeriodVal) * 100));
          const cumPct = hasBudget ? `${Math.round((cumBudgetRef / budgetPrimary) * 100)}%` : '-';
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

    const deptColCount = useCost ? 5 : 3;
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
                <span>PBS Materials (${data.pbsMaterialItems} item${data.pbsMaterialItems === 1 ? '' : 's'}, project-wide)</span>
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
                <span class="w-2.5 h-2.5 rounded-full shrink-0 bg-sky-500" aria-hidden="true"></span>
                <span>External Consultants (${data.externalCosts.length}, project-wide)</span>
              </span>
            </th>
            <td class="px-3 py-2 text-right text-slate-400">&mdash;</td>
            <td class="px-3 py-2 text-right text-slate-400">&mdash;</td>
            <td class="px-3 py-2 text-right tabular-nums font-bold text-slate-900">${fmtMoney(data.externalTotalCost, db)}</td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                  <div class="h-full rounded-full bg-sky-500" style="width:${Math.min(100, sharePct)}%"></div>
                </div>
                <span class="text-[11px] font-bold tabular-nums text-slate-700 w-11 text-right">${sharePct}%</span>
              </div>
            </td>
          </tr>`;
      })()] : []),
    ].join('') || `<tr><td colspan="${deptColCount}" class="px-3 py-4 text-center text-slate-400">No spending allocated in this timeframe.</td></tr>`;

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

    const externalCostsSectionHtml = allowFinance ? `
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
            <span>Amount (${esc((db.settings && (db.settings.currency || db.settings.currencySymbol)) || '€')})</span>
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
      </div>` : '';

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
          ${hasBudget ? `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${overBudget ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">${pctUsed}% of ${useEffortBudgetFallback ? 'effort ' : ''}budget planned</span>` : ''}
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${useEffortBudgetFallback ? 'Effort Budget' : 'Budget'}</div>
          <div class="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">${hasBudget ? fmtBudgetVal(budgetPrimary) : 'Not set'}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">${useCost && !useEffortBudgetFallback && data.totalBudgetDays > 0 ? `Effort budget: ${fmtDays(data.totalBudgetDays)}` : (hasBudget ? 'Configured target' : 'Set in Setup & Data')}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Window Burn</div>
          <div class="text-lg font-extrabold text-indigo-600 mt-0.5 tabular-nums">${fmtPrimary(windowPrimary)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">${useCost ? `${fmtDays(data.windowDays)} in visible window` : 'Across visible periods'}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${hasBudget ? (overBudget ? 'Over Budget' : 'Remaining Budget') : 'Total Planned'}</div>
          <div class="text-lg font-extrabold mt-0.5 tabular-nums ${overBudget ? 'text-rose-600' : (hasBudget ? 'text-emerald-600' : 'text-slate-900')}">${hasBudget ? fmtBudgetVal(Math.abs(variance)) : fmtPrimary(totalPrimary)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">Total plan: ${fmtPrimary(totalPrimary)}${(useCost && (data.pbsMaterialCost > 0 || data.externalTotalCost > 0)) ? ` (incl. PBS &amp; Ext.)` : ''}</div>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg Burn / ${ui.timeUnit === 'week' ? 'Week' : 'Month'}</div>
          <div class="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">${fmtPrimary(avgPrimary)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">${allowFinance ? `PBS: ${fmtMoney(data.pbsMaterialCost, db)} &middot; Ext: ${fmtMoney(data.externalTotalCost, db)}` : `${fmtDays(data.effectiveTotalDays)} total planned`}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="rounded-xl border border-slate-200 overflow-hidden">
          <div class="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">${useCost ? 'Spending Split by Period' : 'Effort Split by Period'}</div>
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
                  <td class="px-3 py-2 text-right text-[11px] text-slate-500">${hasBudget ? `${windowPctOfBudget}%` : ''}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 overflow-hidden">
          <div class="px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">${useCost ? 'Spending Split by Department &amp; Non-Labour' : 'Effort Split by Department'}</div>
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
                  <td class="px-3 py-2 text-right tabular-nums">${hasAnyBreakdown ? '100%' : '0%'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      ${externalCostsSectionHtml}
    `;

    frame.querySelector('#ppMobileHealthProjectSel')?.addEventListener('change', (ev) => {
      ui.filterProj = ev.target.value || 'all';
      if (typeof renderAll === 'function') renderAll();
    });

    if (allowFinance) {
      frame.querySelector('#ppExtCostForm')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (!canSeeFinance()) return;
        const projId = frame.querySelector('#ppExtCostProj')?.value || '';
        const label = String(frame.querySelector('#ppExtCostLabel')?.value || '').trim().slice(0, 120);
        const amount = Number(frame.querySelector('#ppExtCostAmount')?.value);
        const period = String(frame.querySelector('#ppExtCostPeriod')?.value || '').trim();
        if (!projId || !label || !Number.isFinite(amount) || amount <= 0) return;
        if (typeof pushUndoState === 'function') pushUndoState(`Add external cost: ${label}`);
        const list = ensureExternalCosts(db);
        list.push({
          id: typeof uid === 'function' ? uid('ext') : `ext_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          projectId: projId,
          label,
          amount: Math.round(amount * 100) / 100,
          period,
        });
        if (typeof recordChange === 'function') recordChange('Finance', `Added external cost: ${label} (${fmtMoney(amount, db)})`);
        else if (typeof touchDBAndSave === 'function') touchDBAndSave();
        if (typeof showToast === 'function') showToast(`Saved external cost: ${label}`, 'success', { undoable: true });
        renderHealthBurnBudgetFrame();
      });

      frame.querySelectorAll('[data-pp-del-ext]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!canSeeFinance()) return;
          const id = btn.getAttribute('data-pp-del-ext');
          const list = ensureExternalCosts(db);
          const target = list.find(c => c && c.id === id);
          if (!target) return;

          const doDelete = () => {
            const curList = ensureExternalCosts(db);
            const idx = curList.findIndex(c => c && c.id === id);
            if (idx < 0) return;
            if (typeof pushUndoState === 'function') pushUndoState(`Remove external cost: ${curList[idx].label}`);
            const [removed] = curList.splice(idx, 1);
            if (typeof recordChange === 'function') recordChange('Finance', `Removed external cost: ${removed.label}`);
            else if (typeof touchDBAndSave === 'function') touchDBAndSave();
            if (typeof showToast === 'function') showToast(`Removed external cost: ${removed.label}`, 'info', { undoable: true });
            renderHealthBurnBudgetFrame();
          };

          if (typeof ppConfirmAction === 'function') {
            const ok = await ppConfirmAction({
              title: 'Remove External Cost',
              message: `Delete external / consultant cost "${target.label}" (${fmtMoney(target.amount, db)})?`,
              confirmLabel: 'Remove',
              tone: 'danger',
            });
            if (ok) doDelete();
          } else if (typeof openConfirmModal === 'function') {
            openConfirmModal(
              'Remove External Cost',
              `Delete external / consultant cost "${target.label}" (${fmtMoney(target.amount, db)})?`,
              'Remove',
              doDelete
            );
          } else {
            doDelete();
          }
        });
      });
    }
  }

  ppHooks.on('afterRenderHealth', renderHealthBurnBudgetFrame);
  ppHooks.on('afterPbsCommit', () => {
    if (typeof ui !== 'undefined' && ui.activeTab === 'health') {
      renderHealthBurnBudgetFrame();
    }
  });
  ppHooks.on('afterRenderAll', () => {
    enhanceA11yLandmarksAndTabs();
    wireDomObserver();
    injectUserDefaultViewCheckboxes();
    if (typeof ui !== 'undefined' && ui.activeTab === 'health') {
      renderHealthBurnBudgetFrame();
    }
  });

  if (typeof renderHealthDashboard === 'function') {
    const origRenderHealth = renderHealthDashboard;
    renderHealthDashboard = function (...args) {
      const res = origRenderHealth.apply(this, args);
      ppHooks.emit('afterRenderHealth', getDb());
      return res;
    };
  }

  if (typeof renderAll === 'function') {
    const origRenderAll = renderAll;
    renderAll = function (...args) {
      applySessionStartupAndDefaultView();
      const res = origRenderAll.apply(this, args);
      ppHooks.emit('afterRenderAll', getDb());
      return res;
    };
  }

  if (typeof document !== 'undefined') {
    const bootA11y = () => {
      enhanceA11yLandmarksAndTabs();
      wireDomObserver();
      injectUserDefaultViewCheckboxes();
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
    matchExternalCostForPeriod,
    userHasRoadmapAccess,
    resolveUserDepartment,
    applySessionStartupAndDefaultView,
    ppHooks,
  };
})();
