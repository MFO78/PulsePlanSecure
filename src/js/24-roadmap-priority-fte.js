/* Isolated Roadmap enhancements: Default 1 FTE on NEW allocations, prevent FTE clearing on field change + Priority colour-coded project codes. */
(function ppRoadmapPriorityFteModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { projects: [] };
  }

  function injectStyles() {
    if (document.getElementById('ppPrioFteStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppPrioFteStyles';
    style.textContent = `
      .pp-prio-high { background: #ffe4e6 !important; color: #be123c !important; border: 1px solid #fda4af !important; border-radius: .375rem; padding: 0 .35rem; font-weight: 800; }
      .pp-prio-medium { background: #fef3c7 !important; color: #92400e !important; border: 1px solid #fcd34d !important; border-radius: .375rem; padding: 0 .35rem; font-weight: 800; }
      .pp-prio-low { background: #f1f5f9 !important; color: #475569 !important; border: 1px solid #cbd5e1 !important; border-radius: .375rem; padding: 0 .35rem; font-weight: 700; }
      html.dark .pp-prio-high, body.dark .pp-prio-high { background: rgba(244,63,94,.24) !important; color: #fda4af !important; border-color: rgba(244,63,94,.5) !important; }
      html.dark .pp-prio-medium, body.dark .pp-prio-medium { background: rgba(245,158,11,.22) !important; color: #fcd34d !important; border-color: rgba(245,158,11,.48) !important; }
      html.dark .pp-prio-low, body.dark .pp-prio-low { background: rgba(148,163,184,.18) !important; color: #cbd5e1 !important; border-color: rgba(148,163,184,.38) !important; }
    `;
    document.head.appendChild(style);
  }

  function normalizePriority(raw) {
    const p = String(raw || 'Medium').trim().toLowerCase();
    if (p === 'high' || p === 'critical' || p === 'p1') return 'high';
    if (p === 'low' || p === 'p3') return 'low';
    return 'medium';
  }

  function applyPriorityColorsToRoadmap() {
    const db = getDb();
    const projects = db && Array.isArray(db.projects) ? db.projects : [];
    if (!projects.length) return;
    injectStyles();

    const byCode = new Map();
    projects.forEach(p => {
      if (!p || !p.code) return;
      const code = String(p.code).trim();
      const prio = normalizePriority(p.priority);
      const label = String(p.priority || 'Medium').trim();
      byCode.set(code, { prio, label });
      byCode.set(`[${code}]`, { prio, label });
    });

    const roots = [
      document.getElementById('tab-roadmap'),
      document.getElementById('roadmapContainer'),
      document.getElementById('matrixContainer'),
    ].filter(Boolean);
    const searchRoot = roots[0] || document.body;
    if (!searchRoot || typeof searchRoot.querySelectorAll !== 'function') return;

    searchRoot.querySelectorAll('span, code, strong, div').forEach(el => {
      if (el.children && el.children.length > 0) return;
      const txt = String(el.textContent || '').trim();
      if (!txt || txt.length > 24) return;
      const hit = byCode.get(txt);
      if (!hit) return;
      el.classList.remove('pp-prio-high', 'pp-prio-medium', 'pp-prio-low');
      el.classList.add(`pp-prio-${hit.prio}`);
      el.title = `Priority: ${hit.label}`;
    });
  }

  function getAllocationModalEls() {
    const modalCard = document.getElementById('modalCard');
    if (!modalCard) return null;
    const deptEl = modalCard.querySelector('#mAllocDept');
    const projEl = modalCard.querySelector('#mAllocProj');
    const periodEl = modalCard.querySelector('#mAllocPeriod');
    const valEl = modalCard.querySelector('#mAllocValue');
    if (!deptEl || !projEl || !periodEl || !valEl) return null;
    return { modalCard, deptEl, projEl, periodEl, valEl };
  }

  function isSelectedProjAdmin(projId) {
    const db = getDb();
    const proj = (db && Array.isArray(db.projects)) ? db.projects.find(p => p && p.id === projId) : null;
    if (!proj) return false;
    if (typeof isNonFteProject === 'function') return Boolean(isNonFteProject(proj));
    return Boolean(proj.nonFte || proj.category === 'admin');
  }

  function isNullishOrBlank(val) {
    if (val === null || val === undefined) return true;
    const s = String(val).trim().toLowerCase();
    if (s === '' || s === 'null' || s === 'undefined' || s === 'nan') return true;
    return !Number.isFinite(Number(s));
  }

  function getDefaultOneFteDisplay(periodKey) {
    const unit = (typeof ui !== 'undefined' && ui.manpowerUnit) || 'fte';
    const timeUnit = (typeof ui !== 'undefined' && ui.timeUnit) || 'month';
    if (unit === 'fte') return '1';
    if (typeof fteToDisplayValue === 'function' && periodKey) {
      const converted = Math.round(fteToDisplayValue(1, periodKey, timeUnit, unit) * 100) / 100;
      if (Number.isFinite(converted) && converted > 0) return String(converted);
    }
    return '1';
  }

  function cellHasExistingAllocation(deptId, projId, periodKey) {
    if (!deptId || !projId || !periodKey) return false;
    const db = getDb();
    const timeUnit = (typeof ui !== 'undefined' && ui.timeUnit) || 'month';
    if (typeof getAllocationForPeriod === 'function' && db && db.allocations) {
      return Boolean(getAllocationForPeriod(deptId, projId, periodKey, timeUnit, db.allocations).hasData);
    }
    const existing = db && db.allocations ? db.allocations[`${deptId}::${projId}::${periodKey}`] : null;
    return existing != null && Number(existing) > 0.0001;
  }

  let lastDesiredVal = '1';

  function wireDelegatedFteGuard() {
    if (document.__ppDelegatedFteGuardWired || typeof document.addEventListener !== 'function') return;
    document.__ppDelegatedFteGuardWired = true;

    const handleFieldMutation = (ev) => {
      const els = getAllocationModalEls();
      if (!els || !ev.target || !els.modalCard.contains(ev.target)) return;

      // Track user's explicit numeric entries in #mAllocValue without interfering
      if (ev.target === els.valEl) {
        const raw = String(els.valEl.value ?? '').trim();
        if (!isNullishOrBlank(raw) && Number(raw) > 0) lastDesiredVal = raw;
        return;
      }

      // Only guard against onAllocModalContextChange() blanking out #mAllocValue when switching Dept/Proj/Period
      const isContextSelect = ev.target === els.deptEl || ev.target === els.projEl || ev.target === els.periodEl;
      if (!isContextSelect) return;

      const preserveVal = (!isNullishOrBlank(els.valEl.value) && Number(els.valEl.value) > 0)
        ? String(els.valEl.value).trim()
        : lastDesiredVal;

      setTimeout(() => {
        const cur = getAllocationModalEls();
        if (!cur) return;
        if (isSelectedProjAdmin(cur.projEl.value)) return;
        // If onAllocModalContextChange cleared #mAllocValue because the newly selected cell is empty, restore desired value
        if (isNullishOrBlank(cur.valEl.value)) {
          const fallback = (!isNullishOrBlank(preserveVal) && Number(preserveVal) > 0)
            ? preserveVal
            : getDefaultOneFteDisplay(cur.periodEl.value);
          cur.valEl.value = fallback;
          lastDesiredVal = fallback;
          if (typeof refreshAllocModalPreview === 'function') refreshAllocModalPreview();
        } else if (Number(cur.valEl.value) > 0) {
          lastDesiredVal = String(cur.valEl.value).trim();
        }
      }, 0);
    };

    document.addEventListener('change', handleFieldMutation, true);
    document.addEventListener('input', handleFieldMutation, true);
  }

  function applyDefaultFteIfNew() {
    wireDelegatedFteGuard();
    const els = getAllocationModalEls();
    if (!els) return;
    if (isSelectedProjAdmin(els.projEl.value)) return;

    const existingVal = String(els.valEl.value ?? '').trim();
    const hasExisting = cellHasExistingAllocation(els.deptEl.value, els.projEl.value, els.periodEl.value);

    // Never overwrite an existing allocation (works identically in Month and Week views)
    if (hasExisting || (!isNullishOrBlank(existingVal) && Number(existingVal) > 0)) {
      if (!isNullishOrBlank(existingVal) && Number(existingVal) > 0) {
        lastDesiredVal = existingVal;
      }
      return;
    }

    const defVal = getDefaultOneFteDisplay(els.periodEl.value);
    lastDesiredVal = defVal;
    els.valEl.value = defVal;
    if (typeof refreshAllocModalPreview === 'function') refreshAllocModalPreview();
  }

  if (typeof openAllocationModal === 'function') {
    const nativeOpenAlloc = openAllocationModal;
    openAllocationModal = function (...args) {
      const res = nativeOpenAlloc.apply(this, args);
      applyDefaultFteIfNew();
      return res;
    };
  }

  if (typeof renderRoadmap === 'function') {
    const nativeRenderRoadmap = renderRoadmap;
    renderRoadmap = function (...args) {
      const res = nativeRenderRoadmap.apply(this, args);
      applyPriorityColorsToRoadmap();
      return res;
    };
  }

  if (typeof renderAll === 'function') {
    const nativeRenderAll = renderAll;
    renderAll = function (...args) {
      const res = nativeRenderAll.apply(this, args);
      applyPriorityColorsToRoadmap();
      return res;
    };
  }

  wireDelegatedFteGuard();
})();
