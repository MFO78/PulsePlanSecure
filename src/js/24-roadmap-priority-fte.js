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

  function findAllocationFteInputs(root) {
    const scope = root || document;
    const candidates = [
      scope.querySelector ? scope.querySelector('#allocFte') : document.getElementById('allocFte'),
      scope.querySelector ? scope.querySelector('#allocationFte') : document.getElementById('allocationFte'),
      scope.querySelector ? scope.querySelector('#fteInput') : document.getElementById('fteInput'),
      scope.querySelector ? scope.querySelector('input[name="fte"]') : null,
      scope.querySelector ? scope.querySelector('input[data-field="fte"]') : null,
    ].filter(Boolean);

    if (candidates.length === 0 && typeof scope.querySelectorAll === 'function') {
      const labels = Array.from(scope.querySelectorAll('label'));
      for (let i = 0; i < labels.length; i++) {
        const txt = String(labels[i].textContent || '').toLowerCase();
        if (txt.includes('fte')) {
          const forId = labels[i].getAttribute('for');
          const el = forId ? document.getElementById(forId) : (labels[i].parentElement ? labels[i].parentElement.querySelector('input[type="number"], input') : null);
          if (el) candidates.push(el);
        }
      }
    }
    return Array.from(new Set(candidates));
  }

  function isNullishOrBlank(val) {
    if (val === null || val === undefined) return true;
    const s = String(val).trim().toLowerCase();
    if (s === '' || s === 'null' || s === 'undefined' || s === 'nan') return true;
    return !Number.isFinite(Number(s));
  }

  function isEmptyOrZero(val) {
    if (isNullishOrBlank(val)) return true;
    return Number(String(val).trim()) <= 0;
  }

  function isNewActivityModal(modalRoot, openArgs) {
    if (openArgs && openArgs.length >= 3) {
      const [deptId, projId, periodKey] = openArgs;
      const db = getDb();
      if (deptId && projId && periodKey && db && db.allocations) {
        const directKey = `${deptId}::${projId}::${periodKey}`;
        const existing = db.allocations[directKey];
        if (existing == null || Number(existing) <= 0) return true;
      }
    }
    if (!modalRoot) return false;
    const heading = modalRoot.querySelector ? modalRoot.querySelector('h1, h2, h3, [data-modal-title]') : null;
    const titleTxt = String(heading ? heading.textContent : '').toLowerCase();
    if (/\b(add|new)\b/.test(titleTxt) && /\b(activity|allocation|task|assignment)\b/.test(titleTxt)) return true;
    return false;
  }

  let lastDesiredFte = '1';

  function restoreFteIfCleared(modalRoot) {
    const inputs = findAllocationFteInputs(modalRoot || document);
    inputs.forEach(inp => {
      if (isNullishOrBlank(inp.value)) {
        inp.value = lastDesiredFte || '1';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function wireDelegatedFteGuard() {
    if (document.__ppDelegatedFteGuardWired || typeof document.addEventListener !== 'function') return;
    document.__ppDelegatedFteGuardWired = true;

    const handleFieldMutation = (ev) => {
      const modalCard = document.getElementById('modalCard') || document.getElementById('modalOverlay');
      if (!modalCard || !ev.target || !modalCard.contains(ev.target)) return;
      const fteInputs = findAllocationFteInputs(modalCard);
      if (!fteInputs.length) return;

      // If the user is directly editing the FTE input, record valid values and do not override them.
      if (fteInputs.includes(ev.target)) {
        const raw = String(ev.target.value ?? '').trim();
        if (!isNullishOrBlank(raw) && Number(raw) > 0) lastDesiredFte = raw;
        return;
      }

      // Another field (select, date, period, unit toggle, etc.) changed: guard against FTE being wiped to null/blank.
      setTimeout(() => restoreFteIfCleared(modalCard), 0);
      setTimeout(() => restoreFteIfCleared(modalCard), 50);
    };

    document.addEventListener('change', handleFieldMutation, true);
    document.addEventListener('input', handleFieldMutation, true);
  }

  function applyDefaultFteIfNew(openArgs) {
    wireDelegatedFteGuard();
    const modalCard = document.getElementById('modalCard') || document.getElementById('modalOverlay');
    const candidates = findAllocationFteInputs(modalCard || document);
    if (!candidates.length) return;

    const modalRoot = candidates[0].closest ? (candidates[0].closest('form') || candidates[0].closest('[role="dialog"]') || modalCard || document) : (modalCard || document);
    const existingVal = String(candidates[0].value ?? '').trim();
    const isNew = isEmptyOrZero(existingVal) || isNewActivityModal(modalRoot, openArgs);

    if (!isNew) {
      if (!isNullishOrBlank(existingVal) && Number(existingVal) > 0) lastDesiredFte = existingVal;
      return;
    }

    lastDesiredFte = '1';
    candidates.forEach(inp => {
      if (isEmptyOrZero(inp.value) || inp.value !== '1') {
        inp.value = '1';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  ['openAllocationModal', 'openCellModal', 'openAddActivityModal'].forEach(fnName => {
    if (typeof globalThis[fnName] === 'function') {
      const nativeFn = globalThis[fnName];
      globalThis[fnName] = function (...args) {
        const res = nativeFn.apply(this, args);
        applyDefaultFteIfNew(args);
        setTimeout(() => applyDefaultFteIfNew(args), 0);
        return res;
      };
    }
  });

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
