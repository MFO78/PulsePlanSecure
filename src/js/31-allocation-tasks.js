/* ============================================================================
 * 31. WEEKLY ALLOCATION TASKS, AUTOMATIC ROLLOVER & SAY-DO EXECUTION TRACKING
 * ============================================================================
 * Adds checkable weekly deliverables beside notes on each Department × Project
 * allocation cell (including Admin Non-FTE cells).
 *
 * Automatic Rollover:
 * - Every unchecked, non-dropped task whose currentWeek < todayWeek automatically
 *   rolls forward into todayWeek, incrementing rollCount by the number of weeks
 *   elapsed (deterministic & idempotent across clients — zero sync storms).
 * - Completed (done) or Dropped tasks stay frozen on their week with their exact
 *   rollCount for accurate weekly Say-Do history and auditability.
 * ============================================================================ */
(function ppAllocationTasksModule() {
  const ISO_WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

  function injectTaskStyles() {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.getElementById('ppAllocTaskStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppAllocTaskStyles';
    style.textContent = `
      .pp-cell-tasks { margin-top: .32rem; padding: .3rem .4rem; border-radius: .5rem; font-size: 11px; line-height: 1.3; user-select: text; }
      .pp-cell-tasks-accent { background: #f8fafc; border: 1px solid #e2e8f0; color: #1e293b; }
      .pp-task-list { display: flex; flex-direction: column; gap: .22rem; }
      .pp-task-row { display: flex; align-items: flex-start; gap: .32rem; min-width: 0; }
      .pp-task-cb { width: 13px; height: 13px; margin-top: 1px; accent-color: #4f46e5; cursor: pointer; flex-shrink: 0; }
      .pp-task-txt { flex: 1 1 auto; min-width: 0; word-break: break-word; font-weight: 500; }
      .pp-task-txt.is-done { text-decoration: line-through; opacity: .62; }
      .pp-task-txt.is-dropped { text-decoration: line-through; font-style: italic; opacity: .52; }
      .pp-task-wk-tag { font-family: ui-monospace, monospace; font-size: 9.5px; font-weight: 700; opacity: .75; margin-right: .22rem; }
      .pp-task-roll { display: inline-flex; align-items: center; gap: .1rem; padding: 0 .3rem; border-radius: 9999px; font-size: 9.5px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.35; flex-shrink: 0; white-space: nowrap; }
      .pp-task-roll-1 { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
      .pp-task-roll-2 { background: #ffe4e6; color: #be123c; border: 1px solid #fda4af; }
      .pp-task-roll-done { background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
      .pp-task-add-btn { display: inline-flex; align-items: center; gap: .18rem; padding: .1rem .34rem; border-radius: .35rem; font-size: 10px; font-weight: 700; cursor: pointer; opacity: .78; transition: opacity .12s, background .12s; }
      .pp-task-add-btn:hover { opacity: 1; }
      .pp-task-quick-wrap { display: flex; align-items: center; gap: .25rem; margin-top: .25rem; }
      .pp-task-quick-input { flex: 1 1 auto; min-width: 0; padding: .2rem .38rem; border-radius: .38rem; border: 1px solid #6366f1; background: #ffffff; color: #0f172a; font-size: 11px; outline: none; }
      .pp-task-quick-save { padding: .18rem .42rem; border-radius: .38rem; background: #4f46e5; color: #ffffff; font-size: 10px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
      .pp-task-quick-save:hover { background: #4338ca; }
      .pp-saydo-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem .85rem; margin-bottom: .6rem; border-radius: .85rem; border: 1px solid #e2e8f0; background: #ffffff; font-size: 11.5px; }
      .pp-saydo-pill { display: inline-flex; align-items: center; gap: .25rem; padding: .18rem .52rem; border-radius: 9999px; font-size: 10.5px; font-weight: 700; border: 1px solid transparent; }
      .pp-saydo-filter { cursor: pointer; background: #f8fafc; color: #475569; border-color: #cbd5e1; transition: all .12s; }
      .pp-saydo-filter:hover { background: #eef2ff; color: #3730a3; border-color: #a5b4fc; }
      .pp-saydo-filter.is-active { background: #4f46e5; color: #ffffff; border-color: #4f46e5; }
      html.dark .pp-cell-tasks-accent, body.dark .pp-cell-tasks-accent { background: rgba(15, 23, 42, .65); border-color: #334155; color: #e2e8f0; }
      html.dark .pp-task-quick-input, body.dark .pp-task-quick-input { background: #0f172a; color: #f8fafc; border-color: #818cf8; }
      html.dark .pp-task-roll-1, body.dark .pp-task-roll-1 { background: rgba(217, 119, 6, .28); color: #fde68a; border-color: #d97706; }
      html.dark .pp-task-roll-2, body.dark .pp-task-roll-2 { background: rgba(225, 29, 72, .28); color: #fda4af; border-color: #e11d48; }
      html.dark .pp-task-roll-done, body.dark .pp-task-roll-done { background: #334155; color: #cbd5e1; border-color: #475569; }
      html.dark .pp-saydo-bar, body.dark .pp-saydo-bar { background: #0f172a; border-color: #334155; color: #e2e8f0; }
      html.dark .pp-saydo-filter, body.dark .pp-saydo-filter { background: #1e293b; color: #cbd5e1; border-color: #475569; }
      html.dark .pp-saydo-filter:hover, body.dark .pp-saydo-filter:hover { background: #334155; color: #ffffff; }
      html.dark .pp-saydo-filter.is-active, body.dark .pp-saydo-filter.is-active { background: #4f46e5; color: #ffffff; border-color: #6366f1; }
    `;
    document.head.appendChild(style);
  }

  function isValidWeekKey(wk) {
    return typeof wk === 'string' && ISO_WEEK_RE.test(wk.trim());
  }

  function safeTodayWeek(overrideWeek) {
    if (isValidWeekKey(overrideWeek)) return overrideWeek.trim();
    if (typeof getCurrentWeekKey === 'function') return getCurrentWeekKey();
    return '2026-W01';
  }

  /* Exact signed ISO week difference (wEnd - wStart). Positive if wEnd is after wStart. */
  function ppWeeksBetweenIsoWeeks(wStart, wEnd) {
    if (!isValidWeekKey(wStart) || !isValidWeekKey(wEnd)) return 0;
    if (wStart === wEnd) return 0;
    if (typeof isoWeekKeyToMonday === 'function') {
      const a = isoWeekKeyToMonday(wStart).getTime();
      const b = isoWeekKeyToMonday(wEnd).getTime();
      return Math.round((b - a) / (7 * 86400000));
    }
    return wEnd > wStart ? 1 : -1;
  }

  function ppResolveTaskWeekForPeriod(periodKey, timeUnit, todayWeek) {
    const pk = String(periodKey || '').trim();
    if (isValidWeekKey(pk)) return pk;
    const nowWk = safeTodayWeek(todayWeek);
    if (timeUnit === 'month' || /^\d{4}-\d{2}$/.test(pk)) {
      const wks = typeof getWeeksInMonth === 'function' ? getWeeksInMonth(pk) : [];
      if (wks.length) {
        return wks.includes(nowWk) ? nowWk : wks[0];
      }
    }
    return nowWk;
  }

  function ppNormalizeAllocationTasksCollection(rawList, validDeptIds, validProjIds) {
    const arr = Array.isArray(rawList) ? rawList : [];
    const seenIds = new Set();
    const out = [];
    const fallbackWk = safeTodayWeek();

    arr.forEach((raw, idx) => {
      if (!raw || typeof raw !== 'object') return;
      const text = String(raw.text || raw.title || raw.label || '').trim().slice(0, 300);
      if (!text) return;
      const deptId = String(raw.deptId || '').trim();
      const projectId = String(raw.projectId || raw.projId || '').trim();
      if (!deptId || !projectId) return;
      if (validDeptIds && validDeptIds.size && !validDeptIds.has(deptId)) return;
      if (validProjIds && validProjIds.size && !validProjIds.has(projectId)) return;

      let id = String(raw.id || '').trim();
      if (!id || seenIds.has(id)) {
        id = typeof uid === 'function' ? uid('tsk') : `tsk_${idx}_${Date.now()}`;
      }
      seenIds.add(id);

      const rawOrigin = String(raw.originWeek || raw.weekKey || raw.currentWeek || '').trim();
      const originWeek = isValidWeekKey(rawOrigin) ? rawOrigin : fallbackWk;
      const rawCurrent = String(raw.currentWeek || originWeek).trim();
      const currentWeek = isValidWeekKey(rawCurrent) ? rawCurrent : originWeek;

      const done = Boolean(raw.done);
      const dropped = !done && Boolean(raw.dropped);
      const rollCount = Math.max(0, Math.floor(Number(raw.rollCount) || 0));

      out.push({
        id,
        deptId,
        projectId,
        originWeek,
        currentWeek,
        text,
        done,
        doneAt: done ? String(raw.doneAt || '') : '',
        doneWeek: done && isValidWeekKey(raw.doneWeek) ? raw.doneWeek : (done ? currentWeek : ''),
        rollCount,
        dropped,
        createdAt: String(raw.createdAt || ''),
        updatedAt: String(raw.updatedAt || ''),
      });
    });

    return out;
  }

  /* Deterministic, path-independent automatic rollover calculation for a single task. */
  function ppGetEffectiveTaskState(task, todayWeek) {
    if (!task) return null;
    const nowWk = safeTodayWeek(todayWeek);
    const curWk = isValidWeekKey(task.currentWeek) ? task.currentWeek : nowWk;
    const baseRolls = Math.max(0, Math.floor(Number(task.rollCount) || 0));

    if (!task.done && !task.dropped) {
      const delta = ppWeeksBetweenIsoWeeks(curWk, nowWk);
      if (delta > 0) {
        return {
          ...task,
          currentWeek: nowWk,
          rollCount: baseRolls + delta,
          wasAutoRolled: true,
        };
      }
    }
    return {
      ...task,
      currentWeek: curWk,
      rollCount: baseRolls,
      wasAutoRolled: false,
    };
  }

  /* Materializes automatic rollovers in-place on db.allocationTasks (idempotent, no unsolicited disk write). */
  function ppAutoRolloverAllocationTasks(db = (typeof getActiveDB === 'function' ? getActiveDB() : null), todayWeek) {
    if (!db || typeof db !== 'object') return { rolledCount: 0, tasks: [] };
    if (!Array.isArray(db.allocationTasks)) db.allocationTasks = [];
    const nowWk = safeTodayWeek(todayWeek);
    let rolledCount = 0;

    db.allocationTasks.forEach(task => {
      if (!task || task.done || task.dropped) return;
      const curWk = isValidWeekKey(task.currentWeek) ? task.currentWeek : nowWk;
      const delta = ppWeeksBetweenIsoWeeks(curWk, nowWk);
      if (delta > 0) {
        task.currentWeek = nowWk;
        task.rollCount = Math.max(0, Math.floor(Number(task.rollCount) || 0)) + delta;
        rolledCount++;
      }
    });

    return { rolledCount, tasks: db.allocationTasks };
  }

  /* Returns tasks visible in a (deptId, projId, periodKey) cell, respecting Week or Month view and automatic rollover. */
  function ppGetCellTasks(deptId, projId, periodKey, timeUnit, db = (typeof getActiveDB === 'function' ? getActiveDB() : null), todayWeek) {
    if (!db || !Array.isArray(db.allocationTasks) || !db.allocationTasks.length) return [];
    const nowWk = safeTodayWeek(todayWeek);
    const targetWeeks = (timeUnit === 'month' || /^\d{4}-\d{2}$/.test(String(periodKey || '')))
      ? new Set(typeof getWeeksInMonth === 'function' ? getWeeksInMonth(periodKey) : [])
      : new Set([String(periodKey || '')]);

    const list = [];
    db.allocationTasks.forEach(raw => {
      if (!raw || raw.deptId !== deptId || raw.projectId !== projId) return;
      const eff = ppGetEffectiveTaskState(raw, nowWk);
      if (eff && targetWeeks.has(eff.currentWeek)) list.push(eff);
    });

    // Sort: open rolled-most first -> open fresh -> done -> dropped
    list.sort((a, b) => {
      const rank = (t) => (t.dropped ? 3 : (t.done ? 2 : 0));
      const rDiff = rank(a) - rank(b);
      if (rDiff !== 0) return rDiff;
      if (b.rollCount !== a.rollCount) return b.rollCount - a.rollCount;
      return String(a.originWeek || '').localeCompare(String(b.originWeek || '')) || String(a.text || '').localeCompare(String(b.text || ''));
    });

    return list;
  }

  /* Checks if a task list satisfies the active Roadmap meeting task filter (ui.taskFilter). */
  function ppMatchesTaskFilter(cellTasks, filterMode) {
    const mode = filterMode || (typeof ui !== 'undefined' && ui && ui.taskFilter) || 'all';
    if (!mode || mode === 'all') return true;
    const list = Array.isArray(cellTasks) ? cellTasks : [];
    if (mode === 'hasTasks') return list.length > 0;
    if (mode === 'open') return list.some(t => !t.done && !t.dropped);
    if (mode === 'rolled') return list.some(t => !t.done && !t.dropped && t.rollCount > 0);
    return true;
  }

  /* Computes Say-Do completion and rollover statistics across visible periods, departments, and projects. */
  function ppComputeWeeklyTaskStats(db, periods, timeUnit, visibleDeptIds, visibleProjIds, todayWeek) {
    const empty = {
      total: 0, activeTotal: 0, done: 0, open: 0, dropped: 0, rolledOpen: 0, agingOpen: 0,
      sayDoPct: 0, currentWeek: safeTodayWeek(todayWeek),
      currentWeekTotal: 0, currentWeekDone: 0, currentWeekOpen: 0, currentWeekSayDoPct: 0,
      topAgingTasks: [], allVisibleTasks: [],
    };
    if (!db || !Array.isArray(db.allocationTasks) || !db.allocationTasks.length) return empty;
    const nowWk = safeTodayWeek(todayWeek);
    const deptSet = visibleDeptIds ? new Set(visibleDeptIds) : null;
    const projSet = visibleProjIds ? new Set(visibleProjIds) : null;

    let periodWeekSet = null;
    if (Array.isArray(periods) && periods.length) {
      periodWeekSet = new Set();
      periods.forEach(pk => {
        if (timeUnit === 'month' || /^\d{4}-\d{2}$/.test(String(pk))) {
          (typeof getWeeksInMonth === 'function' ? getWeeksInMonth(pk) : []).forEach(w => periodWeekSet.add(w));
        } else {
          periodWeekSet.add(pk);
        }
      });
    }

    let total = 0; let done = 0; let open = 0; let dropped = 0; let rolledOpen = 0; let agingOpen = 0;
    let cwDone = 0; let cwOpen = 0;
    const allVisibleTasks = [];

    db.allocationTasks.forEach(raw => {
      if (!raw) return;
      if (deptSet && !deptSet.has(raw.deptId)) return;
      if (projSet && !projSet.has(raw.projectId)) return;
      const eff = ppGetEffectiveTaskState(raw, nowWk);
      if (!eff) return;
      if (periodWeekSet && !periodWeekSet.has(eff.currentWeek)) return;

      total++;
      allVisibleTasks.push(eff);
      if (eff.dropped) {
        dropped++;
      } else if (eff.done) {
        done++;
        if (eff.currentWeek === nowWk) cwDone++;
      } else {
        open++;
        if (eff.rollCount > 0) rolledOpen++;
        if (eff.rollCount >= 2) agingOpen++;
        if (eff.currentWeek === nowWk) cwOpen++;
      }
    });

    const activeTotal = done + open;
    const cwTotal = cwDone + cwOpen;
    const topAgingTasks = allVisibleTasks
      .filter(t => !t.done && !t.dropped && t.rollCount > 0)
      .sort((a, b) => (b.rollCount - a.rollCount) || String(a.originWeek).localeCompare(String(b.originWeek)))
      .slice(0, 8);

    return {
      total,
      activeTotal,
      done,
      open,
      dropped,
      rolledOpen,
      agingOpen,
      sayDoPct: activeTotal > 0 ? Math.round((done / activeTotal) * 100) : 0,
      currentWeek: nowWk,
      currentWeekTotal: cwTotal,
      currentWeekDone: cwDone,
      currentWeekOpen: cwOpen,
      currentWeekSayDoPct: cwTotal > 0 ? Math.round((cwDone / cwTotal) * 100) : 0,
      topAgingTasks,
      allVisibleTasks,
    };
  }

  function renderRollBadgeHtml(task) {
    const r = Number(task.rollCount) || 0;
    if (r <= 0) return '';
    const tip = `Rolled over ${r} week${r === 1 ? '' : 's'} (started in ${task.originWeek || task.currentWeek})`;
    if (task.done || task.dropped) {
      return `<span class="pp-task-roll pp-task-roll-done" title="${escapeHtml(tip)}">&#8635;${r}</span>`;
    }
    const cls = r >= 2 ? 'pp-task-roll-2' : 'pp-task-roll-1';
    return `<span class="pp-task-roll ${cls}" title="${escapeHtml(tip)}">&#8635;${r}</span>`;
  }

  /* Renders interactive task checklist + inline quick-add right inside a Roadmap cell card (Desktop & Mobile). */
  function ppRenderInlineCellTasksHtml(deptId, projId, periodKey, cellTasks, filledTheme = null, isPresent = false, isOverview = false) {
    injectTaskStyles();
    const list = Array.isArray(cellTasks) ? cellTasks : [];
    const isMonth = typeof ui !== 'undefined' && ui && ui.timeUnit === 'month';

    // In 12–24 period simplified overview mode, show a compact status chip only
    if (isOverview) {
      if (!list.length) return '';
      const active = list.filter(t => !t.dropped);
      const doneCnt = active.filter(t => t.done).length;
      const maxRoll = active.filter(t => !t.done).reduce((m, t) => Math.max(m, t.rollCount || 0), 0);
      const chipStyle = filledTheme
        ? `background-color:${filledTheme.chipBg}; color:${filledTheme.text};`
        : '';
      return `<div class="mt-0.5 flex items-center gap-1 text-[9px] font-bold" onclick="event.stopPropagation()">
        <span class="px-1 rounded ${filledTheme ? '' : 'bg-indigo-50 text-indigo-700'}" style="${chipStyle}" title="${doneCnt}/${active.length} weekly tasks completed">&#9745; ${doneCnt}/${active.length}</span>
        ${maxRoll > 0 ? `<span class="pp-task-roll ${maxRoll >= 2 ? 'pp-task-roll-2' : 'pp-task-roll-1'}">&#8635;${maxRoll}</span>` : ''}
      </div>`;
    }

    const safeD = escapeHtml(deptId);
    const safeP = escapeHtml(projId);
    const safePk = escapeHtml(periodKey);
    const containerKey = `${deptId}::${projId}::${periodKey}`;

    const rowsHtml = list.map(t => {
      const safeId = escapeHtml(t.id);
      const wkTag = isMonth && t.currentWeek ? `<span class="pp-task-wk-tag">${escapeHtml(t.currentWeek.split('-')[1] || t.currentWeek)}</span>` : '';
      const txtCls = t.dropped ? 'is-dropped' : (t.done ? 'is-done' : '');
      const statusTip = t.dropped
        ? 'Dropped task (will not roll over)'
        : (t.done ? `Completed${t.doneWeek ? ' in ' + t.doneWeek : ''}` : `Open task (origin ${t.originWeek})`);
      return `<label class="pp-task-row" title="${escapeHtml(statusTip)}" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
        <input type="checkbox" class="pp-task-cb" ${t.done ? 'checked' : ''} ${isPresent || t.dropped ? 'disabled' : ''}
          onchange="ppToggleAllocationTask('${safeId}', event)" aria-label="Toggle task: ${escapeHtml(t.text)}" />
        <span class="pp-task-txt ${txtCls}">${wkTag}${escapeHtml(t.text)}</span>
        ${renderRollBadgeHtml(t)}
      </label>`;
    }).join('');

    const addBtnStyle = filledTheme
      ? `color:${filledTheme.commentText}; background-color:${filledTheme.chipBg};`
      : 'color:#4338ca; background-color:rgba(79,70,229,.08);';

    const quickAddBtn = !isPresent
      ? `<button type="button" class="pp-task-add-btn ${list.length ? '' : 'desktop-hover-reveal opacity-0 group-hover/pill:opacity-100'}" style="${addBtnStyle}"
           onclick="ppOpenInlineTaskInput('${safeD}', '${safeP}', '${safePk}', event)" onmousedown="event.stopPropagation()"
           title="Add a weekly checkable task directly to this allocation">+ Task</button>`
      : '';

    const active = list.filter(t => !t.dropped);
    const doneCnt = active.filter(t => t.done).length;
    const headerHtml = list.length
      ? `<div class="flex items-center justify-between gap-1 mb-1 text-[10px] font-bold" style="opacity:.82">
           <span>Tasks ${doneCnt}/${active.length}</span>
           ${quickAddBtn}
         </div>`
      : '';

    if (!list.length) {
      if (isPresent) return '';
      return `<div class="mt-1 flex items-center justify-between" data-pp-task-slot="${escapeHtml(containerKey)}" draggable="false" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
        ${quickAddBtn}
      </div>`;
    }

    const boxStyle = filledTheme
      ? `background-color:${filledTheme.commentBg}; border: 1px solid ${filledTheme.commentBorder}; color:${filledTheme.commentText};`
      : '';
    const boxCls = filledTheme ? 'pp-cell-tasks' : 'pp-cell-tasks pp-cell-tasks-accent';

    return `<div class="${boxCls}" data-pp-task-slot="${escapeHtml(containerKey)}" style="${boxStyle}" draggable="false" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
      ${headerHtml}
      <div class="pp-task-list">${rowsHtml}</div>
    </div>`;
  }

  /* Renders the compact Weekly Meeting Task Completion (Say-Do) bar & Meeting Filter pills above the Roadmap. */
  function ppRenderWeeklyTaskSummaryBar(db, periods, visibleDepts, visibleProjs) {
    injectTaskStyles();
    if (!db || !Array.isArray(db.allocationTasks)) return '';
    const activeFilter = (typeof ui !== 'undefined' && ui && ui.taskFilter) || 'all';
    const deptIds = (visibleDepts || []).map(d => d.id);
    const projIds = (visibleProjs || []).map(p => p.id);
    const stats = ppComputeWeeklyTaskStats(db, periods, ui.timeUnit, deptIds, projIds);
    const allStats = ppComputeWeeklyTaskStats(db, null, ui.timeUnit, deptIds, projIds);

    if (allStats.total === 0 && activeFilter === 'all') return '';

    const barColor = stats.sayDoPct >= 80 ? '#059669' : (stats.sayDoPct >= 50 ? '#d97706' : '#4f46e5');
    const filterBtn = (mode, label) => {
      const on = activeFilter === mode;
      return `<button type="button" onclick="ppSetTaskFilter('${mode}')" class="pp-saydo-pill pp-saydo-filter${on ? ' is-active' : ''}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
    };

    const cwNote = stats.currentWeekTotal > 0
      ? `<span class="pp-saydo-pill" style="background:#eef2ff;color:#3730a3;border-color:#c7d2fe" title="Current ISO week (${escapeHtml(stats.currentWeek)}) completion rate">${escapeHtml(stats.currentWeek.split('-')[1] || stats.currentWeek)}: ${stats.currentWeekDone}/${stats.currentWeekTotal} (${stats.currentWeekSayDoPct}%)</span>`
      : '';

    return `<div id="ppWeeklyTaskBar" class="pp-saydo-bar" role="region" aria-label="Weekly meeting task completion summary">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wide text-[10px]">&#9745; Weekly Tasks (Say-Do)</span>
        <span class="font-extrabold tabular-nums">${stats.done}/${stats.activeTotal} done (${stats.sayDoPct}%)</span>
        <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.sayDoPct}" style="width:74px;height:7px;border-radius:9999px;background:#e2e8f0;overflow:hidden"><div style="width:${stats.sayDoPct}%;height:100%;background:${barColor}"></div></div>
        ${cwNote}
        ${stats.open > 0 ? `<span class="pp-saydo-pill" style="background:#f1f5f9;color:#334155">${stats.open} open</span>` : ''}
        ${stats.rolledOpen > 0 ? `<span class="pp-saydo-pill pp-task-roll-1" title="Unchecked tasks automatically rolled from previous weeks">&#8635; ${stats.rolledOpen} rolled</span>` : ''}
        ${stats.agingOpen > 0 ? `<span class="pp-saydo-pill pp-task-roll-2" title="Tasks rolled 2 or more consecutive weeks — review blockers">&#9888; ${stats.agingOpen} aging (&ge;2&times;)</span>` : ''}
      </div>
      <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter roadmap by tasks">
        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Meeting Filter:</span>
        ${filterBtn('all', 'All')}
        ${filterBtn('hasTasks', 'Has Tasks')}
        ${filterBtn('open', 'Open Only')}
        ${filterBtn('rolled', '&#8635; Rolled Only')}
      </div>
    </div>`;
  }

  /* ---------- Direct Interactive Actions ---------- */
  function ppSetTaskFilter(mode) {
    if (typeof ui === 'undefined' || !ui) return;
    ui.taskFilter = ['all', 'hasTasks', 'open', 'rolled'].includes(mode) ? mode : 'all';
    if (typeof renderAll === 'function') renderAll();
  }

  function ppAddAllocationTask(deptId, projId, periodKey, text, timeUnitOverride) {
    const cleanText = String(text || '').trim().slice(0, 300);
    if (!cleanText) return null;
    const db = typeof getActiveDB === 'function' ? getActiveDB() : null;
    if (!db) return null;
    if (!Array.isArray(db.allocationTasks)) db.allocationTasks = [];

    const unit = timeUnitOverride || (typeof ui !== 'undefined' && ui ? ui.timeUnit : 'week');
    const wk = ppResolveTaskWeekForPeriod(periodKey, unit);
    const nowIso = new Date().toISOString();

    if (typeof pushUndoState === 'function') pushUndoState('Add Weekly Task');
    ppAutoRolloverAllocationTasks(db);

    const task = {
      id: typeof uid === 'function' ? uid('tsk') : `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      deptId: String(deptId),
      projectId: String(projId),
      originWeek: wk,
      currentWeek: wk,
      text: cleanText,
      done: false,
      doneAt: '',
      doneWeek: '',
      rollCount: 0,
      dropped: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    db.allocationTasks.push(task);

    const d = (db.departments || []).find(x => x.id === deptId);
    const p = (db.projects || []).find(x => x.id === projId);
    if (typeof addChangeLog === 'function') {
      addChangeLog('Task', `Added task [${d ? d.code : deptId} -> ${p ? p.code : projId} · ${wk}]: ${cleanText.slice(0, 80)}`);
    }
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
    if (typeof renderAll === 'function') renderAll();
    return task;
  }

  function ppToggleAllocationTask(taskId, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    const db = typeof getActiveDB === 'function' ? getActiveDB() : null;
    if (!db || !Array.isArray(db.allocationTasks)) return null;

    ppAutoRolloverAllocationTasks(db);
    const task = db.allocationTasks.find(t => t && t.id === taskId);
    if (!task) return null;

    if (typeof pushUndoState === 'function') pushUndoState(task.done ? 'Reopen Task' : 'Complete Task');
    const nowIso = new Date().toISOString();
    const nowWk = safeTodayWeek();
    task.done = !task.done;
    task.dropped = false;
    task.updatedAt = nowIso;
    if (task.done) {
      task.doneAt = nowIso;
      task.doneWeek = nowWk;
    } else {
      task.doneAt = '';
      task.doneWeek = '';
      // If reopening a past-week task, auto-roll it forward immediately
      ppAutoRolloverAllocationTasks(db, nowWk);
    }

    if (typeof addChangeLog === 'function') {
      addChangeLog('Task', `${task.done ? 'Completed' : 'Reopened'} task (${task.currentWeek}${task.rollCount ? ` ↻${task.rollCount}` : ''}): ${task.text.slice(0, 80)}`);
    }
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
    if (typeof renderAll === 'function') renderAll();
    return task;
  }

  function ppToggleDropAllocationTask(taskId, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    const db = typeof getActiveDB === 'function' ? getActiveDB() : null;
    if (!db || !Array.isArray(db.allocationTasks)) return null;

    ppAutoRolloverAllocationTasks(db);
    const task = db.allocationTasks.find(t => t && t.id === taskId);
    if (!task) return null;

    if (typeof pushUndoState === 'function') pushUndoState(task.dropped ? 'Restore Task' : 'Drop Task');
    task.dropped = !task.dropped;
    if (task.dropped) {
      task.done = false;
      task.doneAt = '';
      task.doneWeek = '';
    } else {
      ppAutoRolloverAllocationTasks(db);
    }
    task.updatedAt = new Date().toISOString();

    if (typeof addChangeLog === 'function') {
      addChangeLog('Task', `${task.dropped ? 'Dropped' : 'Restored'} task (${task.currentWeek}): ${task.text.slice(0, 80)}`);
    }
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
    if (typeof renderAll === 'function') renderAll();
    return task;
  }

  function ppUpdateAllocationTaskText(taskId, newText) {
    const clean = String(newText || '').trim().slice(0, 300);
    const db = typeof getActiveDB === 'function' ? getActiveDB() : null;
    if (!db || !Array.isArray(db.allocationTasks) || !clean) return null;
    const task = db.allocationTasks.find(t => t && t.id === taskId);
    if (!task || task.text === clean) return task;
    if (typeof pushUndoState === 'function') pushUndoState('Edit Task');
    task.text = clean;
    task.updatedAt = new Date().toISOString();
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
    if (typeof renderAll === 'function') renderAll();
    return task;
  }

  function ppDeleteAllocationTask(taskId, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    const db = typeof getActiveDB === 'function' ? getActiveDB() : null;
    if (!db || !Array.isArray(db.allocationTasks)) return false;
    const idx = db.allocationTasks.findIndex(t => t && t.id === taskId);
    if (idx < 0) return false;
    const removed = db.allocationTasks[idx];
    if (typeof pushUndoState === 'function') pushUndoState('Delete Task');
    db.allocationTasks.splice(idx, 1);
    if (typeof addChangeLog === 'function') {
      addChangeLog('Task', `Deleted task (${removed.currentWeek}): ${removed.text.slice(0, 80)}`);
    }
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
    if (typeof renderAll === 'function') renderAll();
    return true;
  }

  /* Inline quick-add input directly inside the Roadmap cell card */
  function ppOpenInlineTaskInput(deptId, projId, periodKey, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    const slotKey = `${deptId}::${projId}::${periodKey}`;
    const slot = document.querySelector(`[data-pp-task-slot="${CSS.escape(slotKey)}"]`);
    if (!slot) {
      if (typeof openAllocationModal === 'function') openAllocationModal(deptId, projId, periodKey);
      return;
    }
    const existingInput = slot.querySelector('.pp-task-quick-input');
    if (existingInput) { existingInput.focus(); return; }

    const wrap = document.createElement('div');
    wrap.className = 'pp-task-quick-wrap';
    wrap.setAttribute('onclick', 'event.stopPropagation()');
    wrap.setAttribute('onmousedown', 'event.stopPropagation()');

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'pp-task-quick-input';
    inp.placeholder = 'New weekly task... (Enter)';
    inp.maxLength = 300;
    inp.setAttribute('aria-label', 'New weekly task');

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'pp-task-quick-save';
    saveBtn.textContent = 'Add';

    const commitInline = () => {
      const val = inp.value.trim();
      if (!val) { wrap.remove(); return; }
      ppAddAllocationTask(deptId, projId, periodKey, val);
    };

    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitInline(); }
      else if (e.key === 'Escape') { e.preventDefault(); wrap.remove(); }
    });
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); commitInline(); });

    wrap.appendChild(inp);
    wrap.appendChild(saveBtn);
    slot.appendChild(wrap);
    inp.focus();
  }

  /* ---------- Allocation Modal Task Editor ---------- */
  function ppRenderAllocModalTasks() {
    injectTaskStyles();
    const wrap = document.getElementById('mAllocTasksWrap');
    if (!wrap) return;
    const deptId = document.getElementById('mAllocDept')?.value;
    const projId = document.getElementById('mAllocProj')?.value;
    const pk = document.getElementById('mAllocPeriod')?.value;
    const db = typeof getActiveDB === 'function' ? getActiveDB() : null;
    if (!deptId || !projId || !pk || !db) { wrap.innerHTML = ''; return; }

    const tasks = ppGetCellTasks(deptId, projId, pk, ui.timeUnit, db);
    const active = tasks.filter(t => !t.dropped);
    const doneCnt = active.filter(t => t.done).length;
    const targetWk = ppResolveTaskWeekForPeriod(pk, ui.timeUnit);

    const rowsHtml = tasks.length
      ? tasks.map(t => {
          const safeId = escapeHtml(t.id);
          const originNote = t.rollCount > 0 ? `Started ${t.originWeek} • Rolled ${t.rollCount}×` : `Origin ${t.originWeek}`;
          return `<div class="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700">
            <input type="checkbox" class="pp-task-cb" ${t.done ? 'checked' : ''} ${t.dropped ? 'disabled' : ''}
              onchange="ppModalToggleTask('${safeId}')" aria-label="Toggle task completion" />
            <div class="flex-1 min-w-0">
              <input type="text" value="${escapeHtml(t.text)}" onchange="ppModalUpdateTaskText('${safeId}', this.value)"
                class="w-full bg-transparent text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:underline ${t.done || t.dropped ? 'line-through opacity-60' : ''}" />
              <div class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                <span>${escapeHtml(originNote)}</span>
                ${t.dropped ? '<span class="px-1 rounded bg-slate-100 text-slate-600 font-bold">Dropped</span>' : ''}
              </div>
            </div>
            ${renderRollBadgeHtml(t)}
            <button type="button" onclick="ppModalToggleDropTask('${safeId}')" title="${t.dropped ? 'Restore task so it tracks again' : 'Drop/cancel task so it stops rolling over'}"
              class="px-1.5 py-1 rounded-lg text-[10px] font-bold border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 shrink-0">${t.dropped ? 'Restore' : 'Drop'}</button>
            <button type="button" onclick="ppModalDeleteTask('${safeId}')" title="Delete task permanently" aria-label="Delete task"
              class="w-6 h-6 rounded-lg text-rose-600 hover:bg-rose-50 font-bold flex items-center justify-center shrink-0">&times;</button>
          </div>`;
        }).join('')
      : `<div class="text-[11px] text-slate-400 italic py-1">No weekly tasks yet. Unchecked tasks automatically roll to the next week and increment their &#8635; counter.</div>`;

    wrap.innerHTML = `
      <div class="p-3 rounded-xl border border-slate-200 bg-slate-50/80 dark:bg-slate-800/60 dark:border-slate-700 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <label for="mAllocNewTaskInput" class="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <span>Weekly Tasks (${escapeHtml(targetWk)})</span>
            ${active.length ? `<span class="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-extrabold">${doneCnt}/${active.length}</span>` : ''}
          </label>
          <span class="text-[10px] text-slate-400">Auto-rolls unchecked tasks weekly</span>
        </div>
        <div class="space-y-1.5 max-h-44 overflow-y-auto">${rowsHtml}</div>
        <div class="flex items-center gap-1.5 pt-1">
          <input id="mAllocNewTaskInput" type="text" maxlength="300" placeholder="Add a deliverable or action item for ${escapeHtml(targetWk)}..."
            onkeydown="if(event.key==='Enter'){event.preventDefault();ppModalAddTask();}"
            class="flex-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 text-xs" />
          <button type="button" onclick="ppModalAddTask()" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shrink-0">+ Add</button>
        </div>
      </div>`;
  }

  function ppModalAddTask() {
    const inp = document.getElementById('mAllocNewTaskInput');
    const deptId = document.getElementById('mAllocDept')?.value;
    const projId = document.getElementById('mAllocProj')?.value;
    const pk = document.getElementById('mAllocPeriod')?.value;
    if (!inp || !deptId || !projId || !pk) return;
    const txt = inp.value.trim();
    if (!txt) { inp.focus(); return; }
    ppAddAllocationTask(deptId, projId, pk, txt);
    ppRenderAllocModalTasks();
    const nextInp = document.getElementById('mAllocNewTaskInput');
    if (nextInp) nextInp.focus();
  }

  function ppFlushPendingModalTask(deptId, projId, pk) {
    const inp = document.getElementById('mAllocNewTaskInput');
    if (!inp) return;
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = '';
    ppAddAllocationTask(deptId, projId, pk, txt);
  }

  function ppModalToggleTask(taskId) {
    ppToggleAllocationTask(taskId);
    ppRenderAllocModalTasks();
  }

  function ppModalUpdateTaskText(taskId, val) {
    ppUpdateAllocationTaskText(taskId, val);
    ppRenderAllocModalTasks();
  }

  function ppModalToggleDropTask(taskId) {
    ppToggleDropAllocationTask(taskId);
    ppRenderAllocModalTasks();
  }

  function ppModalDeleteTask(taskId) {
    ppDeleteAllocationTask(taskId);
    ppRenderAllocModalTasks();
  }

  /* ---------- Drag/Move/Copy & Project Shift Helpers ---------- */
  function ppMoveOrCopyCellTasks(srcDept, srcProj, srcPeriod, dstDept, dstProj, dstPeriod, timeUnit, isCopy, db = (typeof getActiveDB === 'function' ? getActiveDB() : null)) {
    if (!db || !Array.isArray(db.allocationTasks) || !db.allocationTasks.length) return;
    const srcWeeks = (timeUnit === 'month' || /^\d{4}-\d{2}$/.test(String(srcPeriod)))
      ? new Set(typeof getWeeksInMonth === 'function' ? getWeeksInMonth(srcPeriod) : [])
      : new Set([String(srcPeriod)]);
    const dstWeek = ppResolveTaskWeekForPeriod(dstPeriod, timeUnit);
    const matches = db.allocationTasks.filter(t => t && t.deptId === srcDept && t.projectId === srcProj && srcWeeks.has(t.currentWeek));
    if (!matches.length) return;

    const nowIso = new Date().toISOString();
    matches.forEach(t => {
      if (isCopy) {
        db.allocationTasks.push({
          ...t,
          id: typeof uid === 'function' ? uid('tsk') : `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          deptId: dstDept,
          projectId: dstProj,
          originWeek: dstWeek,
          currentWeek: dstWeek,
          done: false,
          doneAt: '',
          doneWeek: '',
          rollCount: 0,
          dropped: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      } else {
        t.deptId = dstDept;
        t.projectId = dstProj;
        t.currentWeek = dstWeek;
        t.updatedAt = nowIso;
      }
    });
  }

  function ppShiftProjectAllocationTasks(projId, weekDelta, db = (typeof getActiveDB === 'function' ? getActiveDB() : null)) {
    if (!db || !Array.isArray(db.allocationTasks) || !weekDelta || typeof addWeeksToWeekKey !== 'function') return 0;
    let moved = 0;
    db.allocationTasks.forEach(t => {
      if (!t || t.projectId !== projId) return;
      if (isValidWeekKey(t.originWeek)) t.originWeek = addWeeksToWeekKey(t.originWeek, weekDelta);
      if (isValidWeekKey(t.currentWeek)) t.currentWeek = addWeeksToWeekKey(t.currentWeek, weekDelta);
      if (t.done && isValidWeekKey(t.doneWeek)) t.doneWeek = addWeeksToWeekKey(t.doneWeek, weekDelta);
      moved++;
    });
    return moved;
  }

  /* ---------- Health & Evolution Say-Do Summary Card ---------- */
  function ppRenderHealthTasksWidget(db, periods, filteredDepts, filteredProjs) {
    injectTaskStyles();
    if (!db || !Array.isArray(db.allocationTasks) || !db.allocationTasks.length) return '';
    const deptIds = (filteredDepts || db.departments || []).map(d => d.id);
    const projIds = (filteredProjs || db.projects || []).map(p => p.id);
    const stats = ppComputeWeeklyTaskStats(db, periods, ui.timeUnit, deptIds, projIds);
    const allStats = ppComputeWeeklyTaskStats(db, null, ui.timeUnit, deptIds, projIds);
    if (allStats.total === 0) return '';

    const deptMap = new Map((db.departments || []).map(d => [d.id, d]));
    const projMap = new Map((db.projects || []).map(p => [p.id, p]));
    const agingRows = allStats.topAgingTasks.map(t => {
      const d = deptMap.get(t.deptId);
      const p = projMap.get(t.projectId);
      return `<tr class="border-t border-slate-100 dark:border-slate-700">
        <td class="py-1.5 pr-2 font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(t.text)}</td>
        <td class="py-1.5 pr-2 text-slate-500 whitespace-nowrap">${d ? `[${escapeHtml(d.code)}] ${escapeHtml(d.name)}` : '—'}</td>
        <td class="py-1.5 pr-2 text-slate-500 whitespace-nowrap">${p ? `[${escapeHtml(p.code)}] ${escapeHtml(p.name)}` : '—'}</td>
        <td class="py-1.5 pr-2 font-mono text-slate-500 whitespace-nowrap">${escapeHtml(t.originWeek)} &rarr; ${escapeHtml(t.currentWeek)}</td>
        <td class="py-1.5 text-right whitespace-nowrap">${renderRollBadgeHtml(t)}</td>
      </tr>`;
    }).join('');

    return `<div id="ppHealthTasksCard" class="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-xs space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">Weekly Task Execution (Say-Do &amp; Rollover Tracker)</h3>
          <p class="text-[11px] text-slate-500">Tracks weekly deliverables completion rate and unchecked tasks automatically carried forward across weeks.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-extrabold">Window Say-Do: ${stats.done}/${stats.activeTotal} (${stats.sayDoPct}%)</span>
          <span class="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 font-bold">&#8635; ${allStats.rolledOpen} Rolled Open</span>
          ${allStats.agingOpen > 0 ? `<span class="px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-extrabold">&#9888; ${allStats.agingOpen} Aging (&ge;2&times;)</span>` : ''}
        </div>
      </div>
      ${agingRows ? `<div class="overflow-x-auto"><table class="w-full text-xs text-left"><thead><tr class="text-[10px] uppercase tracking-wider text-slate-400"><th class="pb-1.5 pr-2">Carried-Over Open Task</th><th class="pb-1.5 pr-2">Department</th><th class="pb-1.5 pr-2">Project</th><th class="pb-1.5 pr-2">Origin &rarr; Current</th><th class="pb-1.5 text-right">Rolls</th></tr></thead><tbody>${agingRows}</tbody></table></div>` : '<div class="text-xs text-emerald-700 font-semibold">&#10003; No carried-over open tasks in the selected scope.</div>'}
    </div>`;
  }

  // Expose public API cleanly on globalThis
  globalThis.ppWeeksBetweenIsoWeeks = ppWeeksBetweenIsoWeeks;
  globalThis.ppResolveTaskWeekForPeriod = ppResolveTaskWeekForPeriod;
  globalThis.ppNormalizeAllocationTasksCollection = ppNormalizeAllocationTasksCollection;
  globalThis.ppGetEffectiveTaskState = ppGetEffectiveTaskState;
  globalThis.ppAutoRolloverAllocationTasks = ppAutoRolloverAllocationTasks;
  globalThis.ppGetCellTasks = ppGetCellTasks;
  globalThis.ppMatchesTaskFilter = ppMatchesTaskFilter;
  globalThis.ppComputeWeeklyTaskStats = ppComputeWeeklyTaskStats;
  globalThis.ppRenderInlineCellTasksHtml = ppRenderInlineCellTasksHtml;
  globalThis.ppRenderWeeklyTaskSummaryBar = ppRenderWeeklyTaskSummaryBar;
  globalThis.ppSetTaskFilter = ppSetTaskFilter;
  globalThis.ppAddAllocationTask = ppAddAllocationTask;
  globalThis.ppToggleAllocationTask = ppToggleAllocationTask;
  globalThis.ppToggleDropAllocationTask = ppToggleDropAllocationTask;
  globalThis.ppUpdateAllocationTaskText = ppUpdateAllocationTaskText;
  globalThis.ppDeleteAllocationTask = ppDeleteAllocationTask;
  globalThis.ppOpenInlineTaskInput = ppOpenInlineTaskInput;
  globalThis.ppRenderAllocModalTasks = ppRenderAllocModalTasks;
  globalThis.ppModalAddTask = ppModalAddTask;
  globalThis.ppFlushPendingModalTask = ppFlushPendingModalTask;
  globalThis.ppModalToggleTask = ppModalToggleTask;
  globalThis.ppModalUpdateTaskText = ppModalUpdateTaskText;
  globalThis.ppModalToggleDropTask = ppModalToggleDropTask;
  globalThis.ppModalDeleteTask = ppModalDeleteTask;
  globalThis.ppMoveOrCopyCellTasks = ppMoveOrCopyCellTasks;
  globalThis.ppShiftProjectAllocationTasks = ppShiftProjectAllocationTasks;
  globalThis.ppRenderHealthTasksWidget = ppRenderHealthTasksWidget;
})();
