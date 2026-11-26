    /* ============================================================================
     * 14. PULSEPLANSECURE: PLANNING INTELLIGENCE SUITE
     *     - Milestone Dependencies & Critical Path
     *     - Resource Leveling / Auto-Balance Suggestions
     *     - Executive Diff Summary on Commit from What-If
     * ============================================================================ */

    if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
      MANUAL_SECTIONS.push({
        id: 'intelligence',
        title: 'Planning Intelligence: Critical Path, Leveling & What-If Diff',
        badge: 'Intelligence',
        keywords: 'critical path milestone dependencies predecessor slip cascade resource leveling auto balance bottleneck what-if executive diff commit',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Milestone Dependencies &amp; Critical Path</div>
              <p class="text-slate-600 leading-relaxed">
                Open <strong>Workspace Menu &rarr; Planning Intelligence</strong> to link predecessor milestones (<code class="px-1 rounded bg-white font-mono">MS-A &rarr; MS-B</code>) with automatic cycle detection.
                PulsePlanSecure computes the longest dependency chain (<strong>Critical Path</strong>), flags date inversions where a predecessor finishes after a dependent milestone, and offers one-click <strong>Cascade Dates</strong> (fully Undoable).
              </p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Resource Leveling / Auto-Balance Suggestions</div>
              <p class="text-slate-600 leading-relaxed">
                Scans overallocated department-weeks (&gt;100% capacity) and proposes shifting lower-priority or flexible project allocations into neighbouring weeks with spare capacity. Click <strong>Apply</strong> on any suggestion to rebalance immediately with full <strong>Ctrl+Z</strong> Undo support.
              </p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Executive Diff Summary on What-If Commit</div>
              <p class="text-slate-600 leading-relaxed">
                Clicking <strong>Commit to Live</strong> in the What-If Sandbox now displays a before/after KPI summary (total FTE-weeks delta, resolved vs. new bottlenecks, and milestone slip delta) before overwriting your Live database.
              </p>
            </div>
          </div>`,
      });
    }

    function ppIntelGetDb() {
      if (typeof getActiveDB === 'function') return getActiveDB();
      if (typeof ui !== 'undefined' && ui.whatIfMode && typeof whatIfDB !== 'undefined' && whatIfDB) return whatIfDB;
      if (typeof ui !== 'undefined' && ui.demoMode && typeof demoDB !== 'undefined' && demoDB) return demoDB;
      if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
      return null;
    }

    function ppIntelDeptCapacity(db, dept, weekKey) {
      const ov = db.capacityOverrides && db.capacityOverrides[`${dept.id}::${weekKey}`];
      if (ov !== undefined && ov !== null && isFinite(Number(ov))) return Math.max(0, Number(ov));
      return Math.max(0, Number(dept.defaultCapacity) || 0);
    }

    function ppIntelComputeDbMetrics(db) {
      if (!db) return { totalFteWeeks: 0, bottlenecks: 0, peakPct: 0, milestoneSlipDays: 0, milestoneCount: 0 };
      const nonFteIds = new Set((db.projects || []).filter(p => p.nonFte || p.category === 'admin').map(p => p.id));
      const deptMap = new Map((db.departments || []).map(d => [d.id, d]));
      const deptWeekLoad = {};
      let totalFteWeeks = 0;

      Object.entries(db.allocations || {}).forEach(([k, v]) => {
        const val = Number(v) || 0;
        if (val <= 0) return;
        const parts = k.split('::');
        if (parts.length !== 3) return;
        const [deptId, projId, wk] = parts;
        if (nonFteIds.has(projId)) return;
        totalFteWeeks += val;
        const dwKey = `${deptId}::${wk}`;
        deptWeekLoad[dwKey] = (deptWeekLoad[dwKey] || 0) + val;
      });

      let bottlenecks = 0;
      let peakPct = 0;
      const overThresh = Number(db.settings?.overThreshold) || 100;
      Object.entries(deptWeekLoad).forEach(([dwKey, load]) => {
        const [deptId, wk] = dwKey.split('::');
        const dept = deptMap.get(deptId);
        if (!dept) return;
        const cap = ppIntelDeptCapacity(db, dept, wk);
        const pct = cap > 0 ? (load / cap) * 100 : (load > 0 ? 999 : 0);
        if (pct > peakPct) peakPct = pct;
        if (pct > overThresh + 0.01) bottlenecks++;
      });

      let milestoneSlipDays = 0;
      (db.milestones || []).forEach(m => {
        if (m.baselineDate && m.date) {
          const diff = Math.round((new Date(m.date) - new Date(m.baselineDate)) / 86400000);
          if (diff > 0) milestoneSlipDays += diff;
        }
      });

      return {
        totalFteWeeks: Math.round(totalFteWeeks * 100) / 100,
        bottlenecks,
        peakPct: Math.round(peakPct),
        milestoneSlipDays,
        milestoneCount: (db.milestones || []).length,
      };
    }

    /* ---------- 1. Resource Leveling / Auto-Balance Engine ---------- */

    function ppIntelBuildLevelingSuggestions(db) {
      if (!db || !Array.isArray(db.departments) || !Array.isArray(db.projects)) return [];
      const priorityRank = { Low: 1, Medium: 2, High: 3, Critical: 4 };
      const projMap = new Map(db.projects.map(p => [p.id, p]));
      const deptMap = new Map(db.departments.map(d => [d.id, d]));
      const overThresh = (Number(db.settings?.overThreshold) || 100) / 100;

      const deptWeekLoad = {};
      const deptWeekItems = {};
      Object.entries(db.allocations || {}).forEach(([k, v]) => {
        const fte = Number(v) || 0;
        if (fte <= 0.001) return;
        const [deptId, projId, wk] = k.split('::');
        const p = projMap.get(projId);
        if (!p || p.nonFte || p.category === 'admin' || p.archived) return;
        const dwKey = `${deptId}::${wk}`;
        deptWeekLoad[dwKey] = (deptWeekLoad[dwKey] || 0) + fte;
        if (!deptWeekItems[dwKey]) deptWeekItems[dwKey] = [];
        deptWeekItems[dwKey].push({ projId, proj: p, fte });
      });

      const suggestions = [];
      const offsets = [1, 2, -1, 3, -2];

      Object.entries(deptWeekLoad).forEach(([dwKey, load]) => {
        const [deptId, wk] = dwKey.split('::');
        const dept = deptMap.get(deptId);
        if (!dept) return;
        const cap = ppIntelDeptCapacity(db, dept, wk);
        if (cap <= 0 || load <= cap * overThresh + 0.01) return;

        const excess = Math.round((load - cap) * 100) / 100;
        const candidates = (deptWeekItems[dwKey] || []).slice().sort((a, b) => {
          const tA = a.proj.tentative ? 0 : 1;
          const tB = b.proj.tentative ? 0 : 1;
          if (tA !== tB) return tA - tB;
          return (priorityRank[a.proj.priority] || 2) - (priorityRank[b.proj.priority] || 2);
        });

        for (const cand of candidates) {
          if (typeof addWeeksToWeekKey !== 'function') break;
          let foundTarget = null;
          for (const off of offsets) {
            const targetWk = addWeeksToWeekKey(wk, off);
            const targetCap = ppIntelDeptCapacity(db, dept, targetWk);
            const targetLoad = deptWeekLoad[`${deptId}::${targetWk}`] || 0;
            const headroom = Math.round((targetCap - targetLoad) * 100) / 100;
            if (headroom >= 0.25) {
              const shiftFte = Math.round(Math.min(excess, cand.fte, headroom) * 100) / 100;
              if (shiftFte >= 0.25) {
                foundTarget = { targetWk, shiftFte, targetCap, targetLoad };
                break;
              }
            }
          }
          if (foundTarget) {
            suggestions.push({
              deptId,
              deptName: dept.name,
              deptCode: dept.code,
              projId: cand.projId,
              projName: cand.proj.name,
              projCode: cand.proj.code,
              priority: cand.proj.priority || 'Medium',
              fromWeek: wk,
              toWeek: foundTarget.targetWk,
              shiftFte: foundTarget.shiftFte,
              beforePct: Math.round((load / cap) * 100),
              afterPct: Math.round(((load - foundTarget.shiftFte) / cap) * 100),
            });
            break;
          }
        }
      });

      return suggestions.sort((a, b) => b.beforePct - a.beforePct).slice(0, 15);
    }

    function ppIntelApplyLevelingSuggestion(sug) {
      const db = ppIntelGetDb();
      if (!db || !sug) return;
      const fromKey = `${sug.deptId}::${sug.projId}::${sug.fromWeek}`;
      const toKey = `${sug.deptId}::${sug.projId}::${sug.toWeek}`;
      const curFrom = Number(db.allocations[fromKey]) || 0;
      const moveAmt = Math.min(curFrom, sug.shiftFte);
      if (moveAmt <= 0.001) return;

      if (typeof pushUndoState === 'function') {
        pushUndoState(`Auto-balance ${sug.projCode} in ${sug.deptCode} (${sug.fromWeek} -> ${sug.toWeek})`);
      }
      const nextFrom = Math.round((curFrom - moveAmt) * 1000) / 1000;
      if (nextFrom <= 0.001) delete db.allocations[fromKey];
      else db.allocations[fromKey] = nextFrom;

      const curTo = Number(db.allocations[toKey]) || 0;
      db.allocations[toKey] = Math.round((curTo + moveAmt) * 1000) / 1000;

      if (typeof recordChange === 'function') {
        recordChange('Allocation', `Auto-leveled ${moveAmt} FTE of [${sug.projCode}] in [${sug.deptCode}] from ${sug.fromWeek} to ${sug.toWeek}`);
      }
      if (typeof renderAll === 'function') renderAll();
      if (typeof showToast === 'function') {
        showToast(`Shifted ${moveAmt} FTE of [${sug.projCode}] to ${sug.toWeek}`, 'success', { undoable: true });
      }
      renderPlanningIntelligenceDialog();
    }

    /* ---------- 2. Milestone Dependencies & Critical Path Engine ---------- */

    function ppIntelWouldCreateCycle(milestones, childId, predId) {
      if (childId === predId) return true;
      const map = new Map(milestones.map(m => [m.id, Array.isArray(m.dependsOn) ? m.dependsOn : []]));
      const visited = new Set();
      const stack = [predId];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (cur === childId) return true;
        if (visited.has(cur)) continue;
        visited.add(cur);
        (map.get(cur) || []).forEach(p => stack.push(p));
      }
      return false;
    }

    function ppIntelComputeCriticalPath(db) {
      const msList = (db && Array.isArray(db.milestones)) ? db.milestones : [];
      const msMap = new Map(msList.map(m => [m.id, m]));
      const conflicts = [];
      const depthMemo = new Map();

      function getDepth(id, visiting = new Set()) {
        if (depthMemo.has(id)) return depthMemo.get(id);
        if (visiting.has(id)) return { len: 1, path: [id] };
        visiting.add(id);
        const m = msMap.get(id);
        const preds = (m && Array.isArray(m.dependsOn) ? m.dependsOn : []).filter(pid => msMap.has(pid));
        let best = { len: 1, path: [id] };
        for (const pid of preds) {
          const sub = getDepth(pid, new Set(visiting));
          if (sub.len + 1 > best.len) {
            best = { len: sub.len + 1, path: [...sub.path, id] };
          }
        }
        depthMemo.set(id, best);
        return best;
      }

      let criticalChain = { len: 0, path: [] };
      msList.forEach(m => {
        const res = getDepth(m.id);
        if (res.len > criticalChain.len) criticalChain = res;
        const preds = Array.isArray(m.dependsOn) ? m.dependsOn : [];
        preds.forEach(pid => {
          const pred = msMap.get(pid);
          if (pred && pred.date && m.date && pred.date > m.date) {
            const overlapDays = Math.round((new Date(pred.date) - new Date(m.date)) / 86400000);
            conflicts.push({ pred, succ: m, overlapDays });
          }
        });
      });

      return {
        criticalPathIds: criticalChain.len >= 2 ? criticalChain.path : [],
        conflicts,
      };
    }

    function ppIntelToggleMilestoneDep(childId, predId) {
      const db = ppIntelGetDb();
      if (!db || !Array.isArray(db.milestones)) return;
      const child = db.milestones.find(m => m.id === childId);
      if (!child) return;
      if (!Array.isArray(child.dependsOn)) child.dependsOn = [];

      if (!predId) {
        if (typeof pushUndoState === 'function') pushUndoState(`Clear dependencies for ${child.title}`);
        child.dependsOn = [];
      } else {
        if (ppIntelWouldCreateCycle(db.milestones, childId, predId)) {
          if (typeof showToast === 'function') showToast('Cannot add dependency: would create a circular loop.', 'error');
          return;
        }
        if (typeof pushUndoState === 'function') pushUndoState(`Update dependency for ${child.title}`);
        if (!child.dependsOn.includes(predId)) child.dependsOn = [predId];
      }
      if (typeof recordChange === 'function') recordChange('Milestone', `Updated dependency for "${child.title}"`);
      if (typeof renderAll === 'function') renderAll();
      renderPlanningIntelligenceDialog();
    }

    function ppIntelCascadeConflictedDates() {
      const db = ppIntelGetDb();
      if (!db || !Array.isArray(db.milestones)) return;
      const { conflicts } = ppIntelComputeCriticalPath(db);
      if (conflicts.length === 0) return;

      if (typeof pushUndoState === 'function') pushUndoState('Cascade conflicted milestone dates');
      let updated = 0;
      for (let pass = 0; pass < 5; pass++) {
        let changed = false;
        const msMap = new Map(db.milestones.map(m => [m.id, m]));
        db.milestones.forEach(m => {
          (Array.isArray(m.dependsOn) ? m.dependsOn : []).forEach(pid => {
            const pred = msMap.get(pid);
            if (pred && pred.date && m.date && pred.date > m.date) {
              const nextDate = new Date(pred.date);
              nextDate.setUTCDate(nextDate.getUTCDate() + 1);
              m.date = nextDate.toISOString().slice(0, 10);
              updated++;
              changed = true;
            }
          });
        });
        if (!changed) break;
      }
      if (typeof recordChange === 'function') recordChange('Milestone', `Cascaded ${updated} conflicted downstream milestone date(s)`);
      if (typeof renderAll === 'function') renderAll();
      if (typeof showToast === 'function') showToast(`Cascaded ${updated} downstream milestone date(s).`, 'success', { undoable: true });
      renderPlanningIntelligenceDialog();
    }

    /* ---------- 3. Executive Diff Summary on Commit from What-If ---------- */

    function openWhatIfExecutiveDiffDialog() {
      const dlg = document.getElementById('ppWhatIfDiffDialog');
      if (!dlg || typeof liveDB === 'undefined' || typeof whatIfDB === 'undefined' || !liveDB || !whatIfDB) {
        if (typeof commitWhatIfToLive === 'function') commitWhatIfToLive();
        return;
      }
      const before = ppIntelComputeDbMetrics(liveDB);
      const after = ppIntelComputeDbMetrics(whatIfDB);
      const fmtDelta = (d, suffix = '', invertGood = false) => {
        if (d === 0) return `<span class="text-slate-400">0${suffix}</span>`;
        const good = invertGood ? d < 0 : d > 0;
        const sign = d > 0 ? '+' : '';
        return `<span class="font-bold ${good ? 'text-emerald-600' : 'text-rose-600'}">${sign}${d}${suffix}</span>`;
      };

      const body = document.getElementById('ppWhatIfDiffBody');
      if (body) {
        body.innerHTML = `
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                <tr>
                  <th scope="col" class="px-3 py-2">Executive KPI</th>
                  <th scope="col" class="px-3 py-2 text-right">Live (Before)</th>
                  <th scope="col" class="px-3 py-2 text-right">What-If (After)</th>
                  <th scope="col" class="px-3 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr>
                  <td class="px-3 py-2 font-semibold">Total Allocated Effort</td>
                  <td class="px-3 py-2 text-right tabular-nums">${before.totalFteWeeks} FTE-wk</td>
                  <td class="px-3 py-2 text-right tabular-nums">${after.totalFteWeeks} FTE-wk</td>
                  <td class="px-3 py-2 text-right tabular-nums">${fmtDelta(Math.round((after.totalFteWeeks - before.totalFteWeeks) * 100) / 100, ' FTE-wk')}</td>
                </tr>
                <tr>
                  <td class="px-3 py-2 font-semibold">Bottleneck Slots (&gt;100%)</td>
                  <td class="px-3 py-2 text-right tabular-nums">${before.bottlenecks}</td>
                  <td class="px-3 py-2 text-right tabular-nums">${after.bottlenecks}</td>
                  <td class="px-3 py-2 text-right tabular-nums">${fmtDelta(after.bottlenecks - before.bottlenecks, '', true)}</td>
                </tr>
                <tr>
                  <td class="px-3 py-2 font-semibold">Peak Dept Utilisation</td>
                  <td class="px-3 py-2 text-right tabular-nums">${before.peakPct}%</td>
                  <td class="px-3 py-2 text-right tabular-nums">${after.peakPct}%</td>
                  <td class="px-3 py-2 text-right tabular-nums">${fmtDelta(after.peakPct - before.peakPct, '%', true)}</td>
                </tr>
                <tr>
                  <td class="px-3 py-2 font-semibold">Cumulative Milestone Slip</td>
                  <td class="px-3 py-2 text-right tabular-nums">${before.milestoneSlipDays}d</td>
                  <td class="px-3 py-2 text-right tabular-nums">${after.milestoneSlipDays}d</td>
                  <td class="px-3 py-2 text-right tabular-nums">${fmtDelta(after.milestoneSlipDays - before.milestoneSlipDays, 'd', true)}</td>
                </tr>
              </tbody>
            </table>
          </div>`;
      }
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', 'open');
    }

    /* ---------- Unified Planning Intelligence Dialog UI ---------- */

    let _ppIntelLastSuggestions = [];

    function openPlanningIntelligenceDialog() {
      const dlg = document.getElementById('ppPlanningIntelDialog');
      if (!dlg) return;
      renderPlanningIntelligenceDialog();
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', 'open');
    }

    function renderPlanningIntelligenceDialog() {
      const db = ppIntelGetDb();
      const lvlBox = document.getElementById('ppIntelLevelingList');
      const cpBox = document.getElementById('ppIntelCriticalPathBox');
      if (!db || !lvlBox || !cpBox) return;

      // Render Resource Leveling Suggestions
      _ppIntelLastSuggestions = ppIntelBuildLevelingSuggestions(db);
      if (_ppIntelLastSuggestions.length === 0) {
        lvlBox.innerHTML = `<div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">No overallocated department-weeks with available neighbouring capacity detected.</div>`;
      } else {
        lvlBox.innerHTML = _ppIntelLastSuggestions.map((s, idx) => `
          <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div class="space-y-0.5">
              <div class="font-bold text-slate-900">[${s.deptCode}] ${s.deptName}: Shift ${s.shiftFte} FTE of [${s.projCode}] ${s.projName}</div>
              <div class="text-[11px] text-slate-600">${s.fromWeek} &rarr; ${s.toWeek} &middot; Priority: ${s.priority} &middot; Load: <span class="text-rose-600 font-bold">${s.beforePct}%</span> &rarr; <span class="text-emerald-600 font-bold">${s.afterPct}%</span></div>
            </div>
            <button type="button" data-pp-apply-lvl="${idx}" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition cursor-pointer">Apply</button>
          </div>`).join('');
        lvlBox.querySelectorAll('[data-pp-apply-lvl]').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-pp-apply-lvl'), 10);
            ppIntelApplyLevelingSuggestion(_ppIntelLastSuggestions[idx]);
          });
        });
      }

      // Render Milestone Dependencies & Critical Path
      const { criticalPathIds, conflicts } = ppIntelComputeCriticalPath(db);
      const msList = db.milestones || [];
      const msMap = new Map(msList.map(m => [m.id, m]));
      const cpSummary = criticalPathIds.length >= 2
        ? `<div class="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900">
             <strong>Critical Path (${criticalPathIds.length} milestones):</strong> ${criticalPathIds.map(id => msMap.get(id)?.title || id).join(' &rarr; ')}
           </div>`
        : `<div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600">Link at least two milestones below to calculate the Critical Path.</div>`;

      const conflictBanner = conflicts.length > 0
        ? `<div class="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex flex-wrap items-center justify-between gap-2">
             <span><strong>${conflicts.length} Dependency Conflict(s):</strong> Predecessor finishes after dependent milestone.</span>
             <button type="button" id="ppCascadeDatesBtn" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold transition cursor-pointer">Cascade Dates</button>
           </div>`
        : '';

      const rows = msList.length === 0
        ? `<div class="text-slate-400 py-2">No milestones defined yet. Add milestones in Setup &amp; Data.</div>`
        : msList.map(m => {
            const curPred = (Array.isArray(m.dependsOn) && m.dependsOn[0]) ? m.dependsOn[0] : '';
            const isCrit = criticalPathIds.includes(m.id);
            const opts = `<option value="">No predecessor</option>` + msList
              .filter(other => other.id !== m.id)
              .map(other => `<option value="${other.id}" ${curPred === other.id ? 'selected' : ''}>${other.title} (${other.date || 'no date'})</option>`)
              .join('');
            return `
              <div class="p-2.5 rounded-xl border ${isCrit ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'} flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span class="font-bold text-slate-900">${m.title}</span>
                  <span class="ml-1.5 font-mono text-[11px] text-slate-500">${m.date || 'No date'}</span>
                  ${isCrit ? '<span class="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-bold uppercase">Critical</span>' : ''}
                </div>
                <select data-pp-ms-dep="${m.id}" aria-label="Predecessor for ${m.title}" class="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800">${opts}</select>
              </div>`;
          }).join('');

      cpBox.innerHTML = `<div class="space-y-2.5">${cpSummary}${conflictBanner}<div class="space-y-1.5">${rows}</div></div>`;
      cpBox.querySelectorAll('[data-pp-ms-dep]').forEach(sel => {
        sel.addEventListener('change', () => {
          ppIntelToggleMilestoneDep(sel.getAttribute('data-pp-ms-dep'), sel.value);
        });
      });
      document.getElementById('ppCascadeDatesBtn')?.addEventListener('click', ppIntelCascadeConflictedDates);
    }

    function initPlanningIntelligenceUI() {
      if (typeof document === 'undefined' || !document.body) return;

      // Add "Planning Intelligence" button inside Workspace Menu (Appearance & Help)
      const manualBtn = document.getElementById('manualBtn');
      if (manualBtn && manualBtn.parentElement && !document.getElementById('ppPlanningIntelMenuBtn')) {
        const intelBtn = document.createElement('button');
        intelBtn.id = 'ppPlanningIntelMenuBtn';
        intelBtn.type = 'button';
        intelBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 font-semibold transition cursor-pointer';
        intelBtn.innerHTML = `
          <span class="flex items-center gap-2">
            <svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            <span>Planning Intelligence</span>
          </span>
          <span class="text-[10px] font-bold text-indigo-600">AI/CP</span>`;
        intelBtn.addEventListener('click', () => {
          if (typeof closeHeaderWorkspaceMenu === 'function') closeHeaderWorkspaceMenu();
          openPlanningIntelligenceDialog();
        });
        manualBtn.parentElement.insertBefore(intelBtn, manualBtn);
      }

      // Intercept "Commit to Live" in What-If Banner to show Executive Diff Summary first
      if (!document.__ppWhatIfDiffHooked && typeof document.addEventListener === 'function') {
        document.addEventListener('click', (e) => {
          const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('#whatIfBanner button') : null;
          if (!btn) return;
          if ((btn.textContent || '').trim() === 'Commit to Live') {
            e.preventDefault();
            e.stopImmediatePropagation();
            openWhatIfExecutiveDiffDialog();
          }
        }, true);
        document.__ppWhatIfDiffHooked = true;
      }

      if (!document.getElementById('ppPlanningIntelDialog')) {
        const dlg = document.createElement('dialog');
        dlg.id = 'ppPlanningIntelDialog';
        dlg.setAttribute('aria-labelledby', 'ppPlanningIntelTitle');
        dlg.className = 'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 w-full max-w-2xl';
        dlg.innerHTML = `
          <div class="p-5 space-y-4 text-xs">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 id="ppPlanningIntelTitle" class="text-base font-extrabold text-slate-900">Planning Intelligence</h2>
                <p class="text-[11px] text-slate-500 mt-0.5">Resource Leveling Suggestions &amp; Milestone Critical Path Dependencies</p>
              </div>
              <button type="button" id="ppPlanningIntelCloseBtn" aria-label="Close planning intelligence dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
            </header>
            <div class="space-y-4 max-h-[65dvh] overflow-y-auto pr-1">
              <section class="space-y-2">
                <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">1. Resource Leveling / Auto-Balance</h3>
                <div id="ppIntelLevelingList" class="space-y-2"></div>
              </section>
              <hr class="border-slate-200" />
              <section class="space-y-2">
                <h3 class="text-xs font-extrabold uppercase tracking-wider text-slate-500">2. Milestone Dependencies &amp; Critical Path</h3>
                <div id="ppIntelCriticalPathBox"></div>
              </section>
            </div>
            <footer class="flex justify-end">
              <button type="button" id="ppPlanningIntelDoneBtn" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition cursor-pointer">Close</button>
            </footer>
          </div>`;
        document.body.appendChild(dlg);
        document.getElementById('ppPlanningIntelCloseBtn')?.addEventListener('click', () => dlg.close());
        document.getElementById('ppPlanningIntelDoneBtn')?.addEventListener('click', () => dlg.close());
      }

      if (!document.getElementById('ppWhatIfDiffDialog')) {
        const diffDlg = document.createElement('dialog');
        diffDlg.id = 'ppWhatIfDiffDialog';
        diffDlg.setAttribute('aria-labelledby', 'ppWhatIfDiffTitle');
        diffDlg.className = 'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 w-full max-w-lg';
        diffDlg.innerHTML = `
          <div class="p-5 space-y-4 text-xs">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 id="ppWhatIfDiffTitle" class="text-base font-extrabold text-slate-900">Executive Diff Summary (What-If &rarr; Live)</h2>
                <p class="text-[11px] text-slate-500 mt-0.5">Review KPI impact before committing your sandbox scenario to the Live database.</p>
              </div>
              <button type="button" id="ppWhatIfDiffCloseBtn" aria-label="Close executive diff dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
            </header>
            <div id="ppWhatIfDiffBody"></div>
            <footer class="flex justify-end gap-2">
              <button type="button" id="ppWhatIfDiffCancelBtn" class="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer">Cancel</button>
              <button type="button" id="ppWhatIfDiffConfirmBtn" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold transition cursor-pointer">Confirm &amp; Commit to Live</button>
            </footer>
          </div>`;
        document.body.appendChild(diffDlg);
        document.getElementById('ppWhatIfDiffCloseBtn')?.addEventListener('click', () => diffDlg.close());
        document.getElementById('ppWhatIfDiffCancelBtn')?.addEventListener('click', () => diffDlg.close());
        document.getElementById('ppWhatIfDiffConfirmBtn')?.addEventListener('click', () => {
          diffDlg.close();
          if (typeof commitWhatIfToLive === 'function') commitWhatIfToLive({ skipConfirm: true });
        });
      }
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPlanningIntelligenceUI);
      } else {
        initPlanningIntelligenceUI();
      }
    }
