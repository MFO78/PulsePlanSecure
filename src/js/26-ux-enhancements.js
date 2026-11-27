/* Isolated UX Enhancements:
 * 1. Sortable Setup & Data tables (live column index, dates, currency/units, priority, select inputs)
 * 2. Exclude Admin (nonFte) projects from Project Portfolio & Effort Summary
 * 3. Log Notes in ChangeLog + Show/Hide Notes toggle in Evolution & Snapshot Comparison
 * 4. Bidirectional Weeks/Months, Horizon, Project, Period Span & Prev/Today/Next controls + Arrow shortcuts in Health & Evolution tab
 * 5. Password-gated Clear DB + "Clear Plan (Keep Setup & Data)" button in Sync & Snapshots
 * 6. EUPL-1.2 User Licence badge & dialog alignment
 */
(function ppUxEnhancementsModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { departments: [], projects: [], allocations: {}, capacityOverrides: {}, comments: {}, milestones: [], snapshots: [], changeLog: [] };
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
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

  function injectStyles() {
    if (document.getElementById('ppUxEnhStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppUxEnhStyles';
    style.textContent = `
      .pp-sort-th { cursor: pointer; user-select: none; white-space: nowrap; }
      .pp-sort-th:hover { color: #4f46e5; }
      .pp-sort-ind { margin-left: .25rem; font-size: 9px; opacity: .65; }
      .pp-health-ctrl-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .6rem; padding: .55rem .85rem; margin-bottom: .85rem; border-radius: .85rem; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); font-size: 12px; }
      @media (max-width: 767px) { .pp-health-ctrl-bar { display: none !important; } }
      .pp-health-btn-grp { display: inline-flex; border-radius: .6rem; overflow: hidden; border: 1px solid var(--border-subtle, #cbd5e1); }
      .pp-health-seg { padding: .3rem .65rem; font-size: 11.5px; font-weight: 700; cursor: pointer; background: transparent; color: var(--text-primary, #334155); border: none; }
      .pp-health-seg:hover { background: var(--surface-subtle, #f1f5f9); }
      .pp-health-seg.active { background: #4f46e5; color: #ffffff; }
      .pp-health-sel { padding: .3rem .55rem; border-radius: .55rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 11.5px; font-weight: 700; max-width: 100%; }
      .pp-health-span-pill { padding: .28rem .6rem; border-radius: .55rem; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); color: var(--text-secondary, #475569); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
      .pp-notes-diff-card { margin-top: .75rem; border: 1px solid var(--border-subtle, #e2e8f0); border-radius: .85rem; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); padding: .85rem; font-size: 12px; }
      .pp-notes-diff-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: .5rem; padding: .45rem 0; border-bottom: 1px solid var(--border-subtle, #e2e8f0); }
      @media (max-width: 639px) { .pp-notes-diff-row { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  /* ---------- 1. Sortable Tables in Setup & Data ---------- */
  const PRIO_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
  const PURE_NUM_RE = /^[€$£\s+-]*\d[\d,\s.]*\s*(fte|days?|d|hrs?|h|%)?$/i;

  function getCellSortValue(cell) {
    if (!cell) return '';
    const ctrl = cell.querySelector ? cell.querySelector('select, input:not([type="checkbox"])') : null;
    if (ctrl && ctrl.value !== undefined) return String(ctrl.value).trim();
    return String(cell.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function compareSortValues(aVal, bVal) {
    const aLow = aVal.toLowerCase();
    const bLow = bVal.toLowerCase();
    if (PRIO_RANK[aLow] && PRIO_RANK[bLow]) return PRIO_RANK[aLow] - PRIO_RANK[bLow];
    if (/^\d{4}-\d{2}-\d{2}/.test(aVal) && /^\d{4}-\d{2}-\d{2}/.test(bVal)) {
      return aVal.localeCompare(bVal);
    }
    if (PURE_NUM_RE.test(aVal) && PURE_NUM_RE.test(bVal)) {
      const aNum = parseFloat(aVal.replace(/[^0-9.-]+/g, ''));
      const bNum = parseFloat(bVal.replace(/[^0-9.-]+/g, ''));
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    }
    return aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
  }

  function makeSetupTablesSortable() {
    const dataTab = document.getElementById('tab-data');
    if (!dataTab) return;
    injectStyles();
    dataTab.querySelectorAll('table').forEach(table => {
      const thead = table.querySelector('thead');
      const tbody = table.querySelector('tbody');
      if (!thead || !tbody) return;
      const ths = Array.from(thead.querySelectorAll('th'));
      ths.forEach(th => {
        if (th.__ppSortWired) return;
        const txt = String(th.textContent || '').trim().toLowerCase();
        if (!txt || txt === 'actions' || th.querySelector('input[type="checkbox"]')) return;
        th.__ppSortWired = true;
        th.classList.add('pp-sort-th');
        const ind = document.createElement('span');
        ind.className = 'pp-sort-ind';
        ind.textContent = '⇅';
        th.appendChild(ind);
        th.addEventListener('click', () => {
          const liveThs = Array.from(th.parentElement.children);
          const liveColIdx = liveThs.indexOf(th);
          if (liveColIdx < 0) return;

          const dir = th.getAttribute('data-pp-sort-dir') === 'asc' ? 'desc' : 'asc';
          liveThs.forEach(h => {
            h.removeAttribute('data-pp-sort-dir');
            const s = h.querySelector('.pp-sort-ind');
            if (s) s.textContent = '⇅';
          });
          th.setAttribute('data-pp-sort-dir', dir);
          ind.textContent = dir === 'asc' ? '▲' : '▼';

          const rows = Array.from(tbody.querySelectorAll('tr')).filter(r => r.children.length > liveColIdx);
          rows.sort((a, b) => {
            const cmp = compareSortValues(getCellSortValue(a.children[liveColIdx]), getCellSortValue(b.children[liveColIdx]));
            return dir === 'asc' ? cmp : -cmp;
          });
          rows.forEach(r => tbody.appendChild(r));
        });
      });
    });
  }

  /* ---------- 2. Exclude Admin Projects from Project Portfolio & Effort Summary ---------- */
  function filterAdminFromPortfolioSummary() {
    const healthTab = document.getElementById('tab-health');
    if (!healthTab) return;
    const db = getDb();
    const adminProjs = (db.projects || []).filter(p => p && (p.nonFte || p.category === 'admin'));
    if (!adminProjs.length) return;
    const adminCodes = new Set(adminProjs.map(p => String(p.code || '').trim().toUpperCase()).filter(Boolean));
    const adminNames = new Set(adminProjs.map(p => String(p.name || '').trim().toLowerCase()).filter(Boolean));

    const headings = Array.from(healthTab.querySelectorAll('h2, h3, div'));
    const portHeading = headings.find(h => String(h.textContent || '').includes('Project Portfolio'));
    if (!portHeading) return;
    const container = portHeading.closest('section, div.rounded-2xl, div.rounded-xl') || portHeading.parentElement;
    if (!container || container === healthTab) return;

    container.querySelectorAll('tbody tr').forEach(tr => {
      const txt = String(tr.textContent || '');
      const txtLower = txt.toLowerCase();
      let isAdmin = false;
      adminCodes.forEach(c => { if (txt.includes(`[${c}]`) || txt.trim().startsWith(c)) isAdmin = true; });
      adminNames.forEach(n => { if (n && txtLower.includes(n)) isAdmin = true; });
      if (isAdmin) tr.style.display = 'none';
    });
  }

  /* ---------- 3. Log Notes in ChangeLog + Show/Hide Notes in Snapshot Comparison ---------- */
  if (typeof setCellProjectComment === 'function') {
    const nativeSetComment = setCellProjectComment;
    setCellProjectComment = function (deptId, projId, periodKey, text, db = getDb()) {
      const prev = (db && db.comments && db.comments[`${deptId}::${projId}::${periodKey}`]) || '';
      const res = nativeSetComment.apply(this, arguments);
      const next = String(text || '').trim();
      if (prev.trim() !== next && db && Array.isArray(db.changeLog)) {
        const dName = (db.departments || []).find(d => d.id === deptId)?.name || deptId;
        const pName = (db.projects || []).find(p => p.id === projId)?.name || projId;
        const action = !next ? 'Cleared note' : (!prev.trim() ? 'Added note' : 'Updated note');
        db.changeLog.unshift({
          id: typeof uid === 'function' ? uid('log') : `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          user: (typeof ui !== 'undefined' && ui.userName) || 'Project Mgr',
          type: 'Note',
          summary: `${action} (${dName} -> ${pName} · ${periodKey}): ${next || '(empty)'}`,
        });
      }
      return res;
    };
  }

  function syncSnapshotNotesUI(container, notesBtn) {
    const hasValidPair = Boolean(
      typeof ui !== 'undefined' &&
      ui.compareSnapshotId &&
      ui.compareSnapshotId !== (ui.compareTargetId || '__CURRENT__')
    );
    const show = hasValidPair && Boolean(typeof ui !== 'undefined' && ui.showSnapshotNotes);
    if (notesBtn) {
      notesBtn.setAttribute('aria-pressed', String(show));
      notesBtn.textContent = show ? 'Hide Notes' : 'Show Notes';
      notesBtn.classList.toggle('bg-indigo-600', show);
      notesBtn.classList.toggle('text-white', show);
    }
    if (show && container) {
      renderSnapshotNotesDiff(container, notesBtn);
    } else {
      document.getElementById('ppNotesDiffCard')?.remove();
    }
  }

  function enhanceSnapshotNotesTab() {
    const healthTab = document.getElementById('tab-health');
    if (!healthTab) return;
    const capBtn = document.getElementById('snapTab-capacity') || Array.from(healthTab.querySelectorAll('button')).find(b => /^capacity\b/i.test(String(b.textContent || '').trim()));
    if (!capBtn || !capBtn.parentElement) return;

    const tabsBox = document.getElementById('snapshotCompareTabs') || capBtn.parentElement;
    const container = tabsBox.closest('section, div.rounded-2xl') || tabsBox.parentElement || healthTab;
    let notesBtn = document.getElementById('ppCompareNotesBtn');
    if (!notesBtn) {
      notesBtn = document.createElement('button');
      notesBtn.id = 'ppCompareNotesBtn';
      notesBtn.type = 'button';
      notesBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition whitespace-nowrap cursor-pointer';
      notesBtn.addEventListener('click', () => {
        if (typeof ui !== 'undefined') ui.showSnapshotNotes = !ui.showSnapshotNotes;
        syncSnapshotNotesUI(container, notesBtn);
      });
      tabsBox.appendChild(notesBtn);
    }
    syncSnapshotNotesUI(container, notesBtn);
  }

  function renderSnapshotNotesDiff(container, notesBtn) {
    document.getElementById('ppNotesDiffCard')?.remove();
    const db = getDb();
    const snapId = typeof ui !== 'undefined' ? ui.compareSnapshotId : '';
    const targetId = typeof ui !== 'undefined' ? (ui.compareTargetId || '__CURRENT__') : '__CURRENT__';
    if (!snapId || snapId === targetId) return;
    const baseSnap = (db.snapshots || []).find(s => s.id === snapId);
    if (!baseSnap) return;
    const targetSnap = targetId && targetId !== '__CURRENT__'
      ? (db.snapshots || []).find(s => s.id === targetId)
      : null;
    if (targetId !== '__CURRENT__' && !targetSnap) return;
    const baseComments = (baseSnap && baseSnap.data && baseSnap.data.comments) || {};
    const curComments = targetSnap ? ((targetSnap.data && targetSnap.data.comments) || {}) : (db.comments || {});
    const deptMap = new Map((db.departments || []).map(d => [d.id, d.name]));
    const projMap = new Map((db.projects || []).map(p => [p.id, p.code ? `[${p.code}] ${p.name}` : p.name]));

    const allKeys = Array.from(new Set([...Object.keys(baseComments), ...Object.keys(curComments)])).sort();
    const diffs = allKeys.filter(k => {
      const [dId, pId] = k.split('::');
      if (typeof ui !== 'undefined' && ui.filterDept && ui.filterDept !== 'all' && dId !== ui.filterDept) return false;
      if (typeof ui !== 'undefined' && ui.filterProj && ui.filterProj !== 'all' && pId !== ui.filterProj) return false;
      return String(baseComments[k] || '').trim() !== String(curComments[k] || '').trim();
    });

    const formatKeyLabel = (k) => {
      const [dId, pId, pk] = k.split('::');
      if (!pId || !pk) return k;
      return `${deptMap.get(dId) || dId} -> ${projMap.get(pId) || pId} (${pk})`;
    };

    const card = document.createElement('div');
    card.id = 'ppNotesDiffCard';
    card.className = 'pp-notes-diff-card';
    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.5rem">
        <div style="font-weight:800">Notes Comparison (${diffs.length} change${diffs.length === 1 ? '' : 's'})</div>
        <button type="button" id="ppHideNotesDiffBtn" class="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold cursor-pointer">Hide Notes</button>
      </div>
      ${diffs.length ? diffs.map(k => `
        <div class="pp-notes-diff-row">
          <div><strong>${esc(formatKeyLabel(k))}</strong></div>
          <div style="color:var(--text-muted, #64748b)">${esc(baseComments[k] || '(none)')}</div>
          <div style="color:var(--text-primary, #0f172a)">${esc(curComments[k] || '(removed)')}</div>
        </div>`).join('') : '<div style="color:var(--text-muted, #64748b)">No note differences between baseline and target.</div>'}
    `;
    card.querySelector('#ppHideNotesDiffBtn')?.addEventListener('click', () => {
      if (typeof ui !== 'undefined') ui.showSnapshotNotes = false;
      syncSnapshotNotesUI(container, notesBtn || document.getElementById('ppCompareNotesBtn'));
    });
    container.appendChild(card);
  }

  /* ---------- 4. Bidirectional Weeks/Months, Horizon, Project, Period Span & Prev/Today/Next Bar in Health & Evolution ---------- */
  function navigateHealthTimeline(action, shiftByHorizon = false) {
    if (action === 'prev') {
      if (shiftByHorizon && typeof shiftStartByInterval === 'function') return shiftStartByInterval(-1);
      if (typeof shiftStartPeriod === 'function') return shiftStartPeriod(-1);
      return;
    }
    if (action === 'next') {
      if (shiftByHorizon && typeof shiftStartByInterval === 'function') return shiftStartByInterval(1);
      if (typeof shiftStartPeriod === 'function') return shiftStartPeriod(1);
      return;
    }
    if (action === 'today') {
      if (typeof jumpToToday === 'function') return jumpToToday();
    }
  }

  function wireHealthArrowShortcuts() {
    if (document.__ppHealthArrowShortcutsWired || typeof document.addEventListener !== 'function') return;
    document.__ppHealthArrowShortcutsWired = true;
    document.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented) return;
      if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
      if (typeof ui === 'undefined' || ui.activeTab !== 'health') return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t && typeof t.getAttribute === 'function' && t.getAttribute('role') === 'tab' && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) return;
      const overlay = document.getElementById('modalOverlay');
      if (overlay && !overlay.classList.contains('hidden')) return;
      if (document.querySelector('dialog[open]')) return;

      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        navigateHealthTimeline('prev', ev.shiftKey);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        navigateHealthTimeline('next', ev.shiftKey);
      } else if (ev.key === 't' || ev.key === 'T') {
        ev.preventDefault();
        navigateHealthTimeline('today');
      }
    });
  }

  function getVisiblePeriodSpanText() {
    const periods = typeof getVisiblePeriods === 'function' ? getVisiblePeriods() : [];
    if (!Array.isArray(periods) || periods.length === 0) return '';
    const tu = (typeof ui !== 'undefined' && ui.timeUnit) || 'month';
    const fmt = (pk) => (typeof formatPeriodHeader === 'function' ? formatPeriodHeader(pk, tu).title : pk);
    const first = fmt(periods[0]);
    const last = fmt(periods[periods.length - 1]);
    return periods.length === 1 ? `Showing ${first}` : `Showing ${first} – ${last}`;
  }

  function renderHealthControlBar() {
    const healthTab = document.getElementById('tab-health');
    if (!healthTab || typeof ui === 'undefined') return;
    injectStyles();
    wireHealthArrowShortcuts();
    const db = getDb();
    let bar = document.getElementById('ppHealthCtrlBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ppHealthCtrlBar';
      bar.className = 'pp-health-ctrl-bar';
      healthTab.prepend(bar);
    }
    const horizons = (typeof VALID_HORIZONS !== 'undefined' && Array.isArray(VALID_HORIZONS))
      ? VALID_HORIZONS
      : [1, 2, 3, 4, 6, 12, 18, 24];
    const curHorizon = typeof getActiveHorizon === 'function'
      ? Number(getActiveHorizon()) || 4
      : (Number(ui.horizon) || 4);
    const sortedProjs = (typeof getSortedProjects === 'function' ? getSortedProjects(db) : (db.projects || []))
      .filter(p => !p.archived || ui.filterProj === p.id);
    const fmtProj = (p) => (typeof formatProjectOptionLabel === 'function'
      ? formatProjectOptionLabel(p)
      : (p.code ? `[${p.code}] ${p.name}` : p.name));
    const spanText = getVisiblePeriodSpanText();

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;width:100%">
        <strong style="font-size:12px">Synced with Roadmap:</strong>
        <div class="pp-health-btn-grp" role="group" aria-label="Timeframe navigation">
          <button type="button" class="pp-health-seg" data-pp-nav="prev" aria-label="Previous period" title="Previous period (Left Arrow)">&larr;</button>
          <button type="button" class="pp-health-seg" data-pp-nav="today" aria-label="Jump to today" title="Jump to today (T)">Today</button>
          <button type="button" class="pp-health-seg" data-pp-nav="next" aria-label="Next period" title="Next period (Right Arrow)">&rarr;</button>
        </div>
        <div class="pp-health-btn-grp" role="group" aria-label="Time unit">
          <button type="button" class="pp-health-seg ${ui.timeUnit === 'month' ? 'active' : ''}" data-pp-tu="month">Months</button>
          <button type="button" class="pp-health-seg ${ui.timeUnit === 'week' ? 'active' : ''}" data-pp-tu="week">Weeks</button>
        </div>
        <label style="display:inline-flex;align-items:center;gap:.35rem;font-weight:600">
          <span>Periods:</span>
          <select id="ppHealthHorizonSel" class="pp-health-sel">
            ${horizons.map(h => `<option value="${h}" ${h === curHorizon ? 'selected' : ''}>${h} ${ui.timeUnit === 'week' ? 'weeks' : 'months'}</option>`).join('')}
          </select>
        </label>
        ${spanText ? `<span id="ppHealthPeriodSpan" class="pp-health-span-pill" aria-live="polite">${esc(spanText)}</span>` : ''}
        <label style="display:inline-flex;align-items:center;gap:.35rem;font-weight:600">
          <span>Project:</span>
          <select id="ppHealthProjectSel" class="pp-health-sel" aria-label="Filter Health and Evolution by project">
            <option value="all" ${(!ui.filterProj || ui.filterProj === 'all') ? 'selected' : ''}>All Projects (${sortedProjs.length})</option>
            ${sortedProjs.map(p => `<option value="${esc(p.id)}" ${ui.filterProj === p.id ? 'selected' : ''}>${esc(fmtProj(p))}</option>`).join('')}
          </select>
        </label>
      </div>`;

    bar.querySelectorAll('[data-pp-nav]').forEach(btn => {
      btn.addEventListener('click', (ev) => navigateHealthTimeline(btn.getAttribute('data-pp-nav'), ev.shiftKey));
    });

    bar.querySelectorAll('[data-pp-tu]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextTu = btn.getAttribute('data-pp-tu');
        if (typeof setTimeUnit === 'function') setTimeUnit(nextTu);
        else {
          ui.timeUnit = nextTu;
          if (typeof renderAll === 'function') renderAll();
        }
      });
    });

    bar.querySelector('#ppHealthHorizonSel')?.addEventListener('change', (ev) => {
      const nextHor = parseInt(ev.target.value, 10) || 4;
      if (typeof setHorizon === 'function') {
        setHorizon(nextHor);
      } else {
        ui.horizon = nextHor;
        if (typeof renderAll === 'function') renderAll();
      }
    });

    bar.querySelector('#ppHealthProjectSel')?.addEventListener('change', (ev) => {
      ui.filterProj = ev.target.value || 'all';
      if (typeof renderAll === 'function') renderAll();
    });
  }

  /* ---------- 5. Sync & Snapshots: Masked Password-Gated Clear Plan (Keep Setup & Data) ---------- */
  function enhanceSyncClearButtons() {
    const syncTab = document.getElementById('tab-sync');
    if (!syncTab) return;
    const isRestricted = typeof ppHasAdminAccess === 'function'
      ? !ppHasAdminAccess()
      : (typeof ppIsStandardUser === 'function' && ppIsStandardUser());
    const dangerZone = document.getElementById('syncDangerZone');
    if (dangerZone) dangerZone.classList.toggle('hidden', isRestricted);

    const clearBtn = Array.from(syncTab.querySelectorAll('button')).find(b => /clear\s+current\s+db/i.test(b.textContent || ''));
    if (!clearBtn) return;
    clearBtn.classList.toggle('hidden', isRestricted);

    let clearPlanBtn = document.getElementById('ppClearPlanOnlyBtn');
    if (!clearPlanBtn && clearBtn.parentElement) {
      clearPlanBtn = document.createElement('button');
      clearPlanBtn.id = 'ppClearPlanOnlyBtn';
      clearPlanBtn.type = 'button';
      clearPlanBtn.className = 'px-3 py-1.5 rounded-xl border border-amber-200 bg-white hover:bg-amber-50 text-amber-800 text-xs font-semibold transition cursor-pointer';
      clearPlanBtn.textContent = 'Clear Plan (Keep Setup & Data)';
      clearPlanBtn.title = 'Clears allocations, overrides, notes, milestones, snapshots & logs while keeping Departments, Projects, Users & Settings';
      clearPlanBtn.addEventListener('click', async () => {
        const hasAdmin = typeof ppHasAdminAccess === 'function'
          ? ppHasAdminAccess()
          : !(typeof ppIsStandardUser === 'function' && ppIsStandardUser());
        if (!hasAdmin) {
          toast('Administrator privileges are required for this action.', 'error');
          return;
        }
        const isDelegated = typeof ppIsDelegatedAdmin === 'function' && ppIsDelegatedAdmin();
        const expectedPass = (!isDelegated && typeof ppSyncPassphrase === 'string' && ppSyncPassphrase.length >= 8) ? ppSyncPassphrase : '';
        const ok = typeof ppConfirmWithPassword === 'function'
          ? await ppConfirmWithPassword({
              title: 'Clear Plan Only (Keep Setup & Data)',
              message: 'This will permanently clear all roadmap allocations, variable capacity overrides, notes, milestones, snapshots, and change log entries.\n\nYour Departments, Projects, People Directory, Team Users, and Settings will be preserved.',
              confirmLabel: 'Clear Plan Only',
              expectedPassword: expectedPass,
              requireWord: 'CLEAR',
            })
          : false;
        if (!ok) return;

        const db = getDb();
        if (typeof pushUndoState === 'function') pushUndoState('Clear Plan Only');
        db.allocations = {};
        db.capacityOverrides = {};
        db.comments = {};
        db.milestones = [];
        db.snapshots = [];
        db.changeLog = [];
        db.externalCosts = [];
        db.allocationTasks = [];
        if (db.settings && 'externalCosts' in db.settings) delete db.settings.externalCosts;
        if (typeof recordChange === 'function') recordChange('Plan', 'Cleared roadmap plan, notes, milestones & snapshots (kept Setup & Data)');
        else if (typeof touchDBAndSave === 'function') touchDBAndSave();
        if (typeof renderAll === 'function') renderAll();
        toast('Cleared roadmap plan, notes, milestones & snapshots while preserving Setup & Data.', 'success', { undoable: true });
      });
      clearBtn.parentElement.insertBefore(clearPlanBtn, clearBtn);
    }
    if (clearPlanBtn) clearPlanBtn.classList.toggle('hidden', isRestricted);
  }

  /* ---------- 6. EUPL-1.2 User Licence Alignment ---------- */
  function applyEuplLicenceBranding() {
    const licBtn = document.getElementById('ppLicenceMenuBtn');
    if (licBtn) {
      licBtn.querySelectorAll('span').forEach(sp => {
        if (sp.children.length === 0 && sp.textContent.trim() === 'MIT') {
          sp.textContent = 'EUPL-1.2';
        }
      });
    }
    const dlg = document.getElementById('ppLicenceDialog');
    if (dlg && !dlg.__ppEuplApplied) {
      dlg.__ppEuplApplied = true;
      dlg.innerHTML = `
        <div class="p-5 space-y-3 text-xs">
          <header class="flex items-start justify-between gap-3">
            <div>
              <h2 id="ppLicenceDialogTitle" class="text-base font-extrabold text-slate-900">PulsePlanSecure — User Licence (EUPL-1.2)</h2>
              <p class="text-[11px] text-slate-500 mt-0.5">European Union Public Licence v. 1.2 &middot; Official EU Open-Source Licence</p>
            </div>
            <button type="button" id="ppEuplCloseTop" aria-label="Close licence dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
          </header>
          <section class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-slate-700 leading-relaxed max-h-72 overflow-y-auto">
            <p><strong>Licensed under the EUPL-1.2.</strong> Copyright &copy; 2026 PulsePlanSecure Contributors.</p>
            <p>You are granted a worldwide, royalty-free, non-exclusive licence to use, reproduce, modify, communicate to the public, and distribute this Work under the terms of the <strong>European Union Public Licence v. 1.2 (EUPL-1.2)</strong>.</p>
            <p><strong>Key Conditions:</strong> Retain all copyright, patent, trademark, and licence notices. If you distribute or communicate modified versions (including hosting over a network / SaaS), you must provide the Source Code under EUPL-1.2 or a listed Compatible Licence (GPL, AGPL, MPL-2.0, LGPL, EPL, CeCILL, OSL).</p>
            <p><strong>Warranty &amp; Liability (Articles 7 &amp; 8):</strong> The Work is provided on an &ldquo;as is&rdquo; basis without warranties of any kind. Except in cases of wilful misconduct, damages directly caused to natural persons, or mandatory statutory product liability laws, the Licensor is not liable for damages arising from use of the Work.</p>
            <p><strong>Applicable Law &amp; Jurisdiction (Articles 14 &amp; 15):</strong> Governed by the law of the EU Member State where the Licensor resides or has its registered office.</p>
            <p><strong>Local-First Privacy:</strong> All roadmap, capacity, and finance data stays in your browser or local/synced files; optional AES-256-GCM encryption runs locally via the Web Crypto API.</p>
          </section>
          <footer class="flex items-center justify-between gap-2 pt-1">
            <a href="./LICENSE.txt" target="_blank" rel="noopener noreferrer" class="text-[11px] font-semibold text-emerald-700 hover:underline">View full EUPL-1.2 LICENSE.txt</a>
            <button type="button" id="ppEuplCloseBtn" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer">Close</button>
          </footer>
        </div>`;
      const closeFn = () => {
        if (typeof dlg.close === 'function') dlg.close();
        else dlg.removeAttribute('open');
      };
      dlg.querySelector('#ppEuplCloseTop')?.addEventListener('click', closeFn);
      dlg.querySelector('#ppEuplCloseBtn')?.addEventListener('click', closeFn);
    }
  }

  function runAllUxHooks() {
    makeSetupTablesSortable();
    filterAdminFromPortfolioSummary();
    enhanceSnapshotNotesTab();
    renderHealthControlBar();
    enhanceSyncClearButtons();
    applyEuplLicenceBranding();
  }

  if (typeof openLicenceDialog === 'function') {
    const nativeOpenLicence = openLicenceDialog;
    openLicenceDialog = function (...args) {
      applyEuplLicenceBranding();
      return nativeOpenLicence.apply(this, args);
    };
  }

  if (typeof renderSnapshotComparison === 'function') {
    const nativeRenderSnapshotComparison = renderSnapshotComparison;
    renderSnapshotComparison = function (...args) {
      const res = nativeRenderSnapshotComparison.apply(this, args);
      enhanceSnapshotNotesTab();
      return res;
    };
  }

  if (typeof renderAll === 'function') {
    const nativeRenderAll = renderAll;
    renderAll = function (...args) {
      const res = nativeRenderAll.apply(this, args);
      runAllUxHooks();
      return res;
    };
  }

  if (typeof renderDataTab === 'function') {
    const nativeRenderData = renderDataTab;
    renderDataTab = function (...args) {
      const res = nativeRenderData.apply(this, args);
      makeSetupTablesSortable();
      return res;
    };
  }

  if (typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
      applyEuplLicenceBranding();
      wireHealthArrowShortcuts();
      setTimeout(applyEuplLicenceBranding, 0);
      setTimeout(applyEuplLicenceBranding, 300);
    });
  }
  setTimeout(applyEuplLicenceBranding, 0);
  setTimeout(applyEuplLicenceBranding, 300);

  if (typeof globalThis !== 'undefined') {
    globalThis.__ppUxSortTestApi = { compareSortValues };
  }
})();
