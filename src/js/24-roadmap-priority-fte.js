/* Isolated Roadmap enhancements: Default 1 FTE on new allocations + Priority colour-coded project codes. */
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

  function setDefaultAllocationFte() {
    const candidates = [
      document.getElementById('allocFte'),
      document.getElementById('allocationFte'),
      document.getElementById('fteInput'),
    ].filter(Boolean);

    if (candidates.length === 0) {
      const labels = Array.from(document.querySelectorAll('label'));
      for (let i = 0; i < labels.length; i++) {
        const txt = String(labels[i].textContent || '').toLowerCase();
        if (txt.includes('fte')) {
          const forId = labels[i].getAttribute('for');
          const el = forId ? document.getElementById(forId) : (labels[i].parentElement ? labels[i].parentElement.querySelector('input[type="number"], input') : null);
          if (el) candidates.push(el);
        }
      }
    }

    candidates.forEach(inp => {
      inp.value = '1';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  if (typeof openAllocationModal === 'function') {
    const nativeOpenAlloc = openAllocationModal;
    openAllocationModal = function (...args) {
      const res = nativeOpenAlloc.apply(this, args);
      // Only apply 1 FTE default when creating a new allocation (not editing an existing one)
      const isEdit = args.some(a => typeof a === 'string' && a.startsWith('alloc_'));
      if (!isEdit) {
        setDefaultAllocationFte();
        setTimeout(setDefaultAllocationFte, 0);
      }
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

  if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
    const wn = MANUAL_SECTIONS.find(s => s && s.id === 'whatsnew');
    if (wn && typeof wn.bodyHtml === 'string' && !wn.bodyHtml.includes('Priority Colour-Coded Project Codes')) {
      wn.keywords = `${wn.keywords || ''} priority colour code roadmap 1 fte default allocation`;
      wn.bodyHtml = wn.bodyHtml.replace(
        '</ul>',
        `<li>&bull; <strong>Priority Colour-Coded Project Codes &amp; 1 FTE Default:</strong> Project codes in Roadmap view are colour-coded by priority (High = rose, Medium = amber, Low = slate), and new manpower allocations now default to <strong>1 FTE</strong>.</li></ul>`
      );
    }
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__ppRoadmapPrioTestApi = {
      normalizePriority,
      applyPriorityColorsToRoadmap,
      setDefaultAllocationFte,
    };
  }
})();
