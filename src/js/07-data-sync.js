    /* ============================================================================
     * 7. DATA & SETUP TAB RENDERER (WITH MOD 3 RETENTION & MOD 4 3-LEVEL SETTINGS)
     * ============================================================================ */

    function switchDataSubTab(sub) {
      ui.dataSubTab = sub;
      persistUIPrefs();
      renderDataTab();
    }

    function onFte3BasisChange(basis) {
      const isAbs = basis === 'absoluteFte';
      const pctWrap = document.getElementById('fte3PctInputsWrap');
      const absWrap = document.getElementById('fte3AbsInputsWrap');
      if (pctWrap) pctWrap.classList.toggle('hidden', isAbs);
      if (absWrap) absWrap.classList.toggle('hidden', !isAbs);
    }

    function renderDataTab() {
      const db = getActiveDB();
      ['departments', 'projects', 'milestones', 'settings'].forEach(s => {
        const active = ui.dataSubTab === s;
        const btn = document.getElementById(`subnav-${s}`);
        const panel = document.getElementById(`subtab-${s}`);
        if (btn) {
          btn.setAttribute('aria-selected', String(active));
          btn.className = active
            ? 'px-3 py-2 md:py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white transition whitespace-nowrap'
            : 'px-3 py-2 md:py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition whitespace-nowrap';
        }
        if (panel) panel.classList.toggle('hidden', !active);
      });

      const actionBox = document.getElementById('dataSubTabAction');
      const archivedCount = db.projects.filter(p => p.archived).length;
      if (ui.dataSubTab === 'departments') {
        actionBox.innerHTML = `
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onclick="openHolidayFactorModal()" class="px-3 py-2 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold transition">Holiday / Shutdown %</button>
            <button type="button" onclick="openCsvImportModal()" class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition">Import CSV / Excel</button>
            <button type="button" onclick="openDeptModal()" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition">+ Add Department</button>
          </div>`;
      } else if (ui.dataSubTab === 'projects') {
        actionBox.innerHTML = `
          <div class="flex flex-wrap items-center gap-2">
            ${archivedCount > 0 ? `<button type="button" onclick="toggleShowArchivedProjects()" class="px-3 py-2 rounded-xl border text-xs font-semibold transition ${ui.showArchivedProjects ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}">${ui.showArchivedProjects ? 'Hide' : 'Show'} Archived (${archivedCount})</button>` : ''}
            <button type="button" onclick="openCsvImportModal()" class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition">Import CSV / Excel</button>
            <button type="button" onclick="openProjectModal()" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition">+ Add Project</button>
          </div>`;
      } else if (ui.dataSubTab === 'milestones') {
        actionBox.innerHTML = `<button type="button" onclick="openMilestoneModal()" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition">+ Add Milestone</button>`;
      } else {
        actionBox.innerHTML = '';
      }

      const dBody = document.getElementById('dataDepartmentsBody');
      const curSym = getCurrencySymbol(db);
      const canSeeFinance = typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance();
      if (db.departments.length === 0) {
        dBody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400">No departments yet. Click "+ Add Department" to start.</td></tr>`;
      } else {
        dBody.innerHTML = db.departments.map((d, idx) => {
          const deptSpans = getGroupedCapacityOverrides(db, d.id);
          const overrideCount = deptSpans.reduce((acc, sp) => acc + sp.weekKeys.length, 0);
          const rateVal = canSeeFinance ? (Number(d.dayRate) || 0) : 0;
          const rateTxt = !canSeeFinance
            ? 'Restricted'
            : (rateVal > 0 ? `${curSym.length > 1 ? curSym + ' ' : curSym}${rateVal.toLocaleString('en-US')}/d` : '—');
          const ovSummary = overrideCount > 0
            ? `${deptSpans.length} span${deptSpans.length === 1 ? '' : 's'} (${overrideCount} wk${overrideCount === 1 ? '' : 's'}) &bull; + / Edit`
            : '+ Add Override';
          return `
            <tr class="hover:bg-slate-50/70">
              <th scope="row" class="px-4 py-3 font-bold text-slate-900 text-left">
                <div class="flex items-center gap-2">
                  <div class="inline-flex flex-col text-[10px] leading-none text-slate-400">
                    <button type="button" aria-label="Move ${escapeHtml(d.name)} up" onclick="moveRowOrder('department', '${d.id}', -1)" ${idx === 0 ? 'disabled' : ''} title="Move up" class="p-1 hover:text-indigo-700 disabled:opacity-25">&#9650;</button>
                    <button type="button" aria-label="Move ${escapeHtml(d.name)} down" onclick="moveRowOrder('department', '${d.id}', 1)" ${idx === db.departments.length - 1 ? 'disabled' : ''} title="Move down" class="p-1 hover:text-indigo-700 disabled:opacity-25">&#9660;</button>
                  </div>
                  <span class="w-3 h-3 rounded-full shrink-0" style="background:${d.color}" aria-hidden="true"></span>
                  <span>${escapeHtml(d.name)}</span>
                </div>
              </th>
              <td class="px-4 py-3 font-mono font-bold text-slate-600">${escapeHtml(d.code)}</td>
              <td class="px-4 py-3 text-slate-600">${escapeHtml(d.manager || '—')}</td>
              <td class="px-4 py-3 font-bold text-slate-900">
                <div class="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                  <button type="button" aria-label="Decrease ${escapeHtml(d.name)} default capacity" onclick="quickStepDeptDefaultCapacity('${d.id}', -0.5)" title="Decrease default capacity by 0.5 FTE" class="px-2.5 py-1.5 md:px-2 md:py-0.5 hover:bg-rose-50 hover:text-rose-700 text-slate-600 font-bold transition">&minus;</button>
                  <span class="px-2.5 py-1.5 md:py-0.5 tabular-nums border-x border-slate-200 bg-white">${d.defaultCapacity} FTE</span>
                  <button type="button" aria-label="Increase ${escapeHtml(d.name)} default capacity" onclick="quickStepDeptDefaultCapacity('${d.id}', 0.5)" title="Increase default capacity by 0.5 FTE" class="px-2.5 py-1.5 md:px-2 md:py-0.5 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 font-bold transition">+</button>
                </div>
              </td>
              <td class="px-4 py-3 font-semibold tabular-nums ${!canSeeFinance ? 'text-slate-400 italic text-[11px]' : (rateVal > 0 ? 'text-slate-800' : 'text-slate-400')} whitespace-nowrap">${escapeHtml(rateTxt)}</td>
              <td class="px-4 py-3">
                <button type="button" onclick="openCapacityModal('${d.id}', '${ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek}')"
                  class="px-2.5 py-1.5 md:px-2 md:py-1 rounded-lg ${overrideCount > 0 ? 'bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100' : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-sky-50 hover:text-sky-700'} text-[11px] font-semibold transition whitespace-nowrap">
                  ${ovSummary}
                </button>
              </td>
              <td class="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                <button type="button" onclick="openDeptModal('${d.id}')" class="px-2 py-1 text-indigo-600 hover:underline font-semibold">Edit</button>
                <button type="button" onclick="deleteDept('${d.id}')" class="px-2 py-1 text-rose-600 hover:underline font-semibold">Delete</button>
              </td>
            </tr>`;
        }).join('');
      }

      renderCapacityOverridesTable(db);

      const pBody = document.getElementById('dataProjectsBody');
      const sortedProjectsAll = getSortedProjects(db);
      const displayedProjects = ui.showArchivedProjects ? sortedProjectsAll : sortedProjectsAll.filter(p => !p.archived);
      const hasRates = hasAnyDayRates(db);
      if (displayedProjects.length === 0) {
        pBody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">${db.projects.length > 0 ? 'All projects are archived. Click "Show Archived" above to view them.' : 'No projects yet. Click "+ Add Project" to start.'}</td></tr>`;
      } else {
        pBody.innerHTML = displayedProjects.map((p, pIdx) => {
          const plannedDays = getProjectTotalPlannedDays(p.id, db);
          const budgetDays = Number(p.budgetDays) || 0;
          const pct = budgetDays > 0 ? Math.round((plannedDays / budgetDays) * 100) : 0;
          const plannedCost = hasRates ? getProjectTotalPlannedCost(p.id, db) : 0;
          const budgetCost = Number(p.budgetCost) || 0;
          const costPct = budgetCost > 0 ? Math.round((plannedCost / budgetCost) * 100) : 0;
          const isAdminProj = isNonFteProject(p);
          const isFirstAdminSetupRow = isAdminProj && pIdx > 0 && !isNonFteProject(displayedProjects[pIdx - 1]);
          const swatchHtml = isAdminProj
            ? `<span class="w-3.5 h-3.5 rounded shrink-0 admin-hashed-swatch" style="--admin-accent:${p.color}" title="Admin (Non-FTE) hashed style" aria-hidden="true"></span>`
            : `<span class="w-3 h-3 rounded-full shrink-0" style="background:${p.color}" aria-hidden="true"></span>`;
          const effortPart = isAdminProj
            ? `<span class="px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-bold">Non-FTE (Issues &amp; Meetings)</span>`
            : (budgetDays > 0
                ? `<div class="space-y-1 min-w-[110px]">
                     <div class="flex items-center justify-between text-[11px] font-bold tabular-nums">
                       <span class="${pct > 100 ? 'text-rose-600' : pct >= 85 ? 'text-amber-700' : 'text-slate-700'}">${plannedDays} / ${budgetDays}d</span>
                       <span class="${pct > 100 ? 'text-rose-600' : 'text-slate-500'}">${pct}%</span>
                     </div>
                     <div class="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full ${pct > 100 ? 'bg-rose-500' : pct >= 85 ? 'bg-amber-500' : 'bg-indigo-500'}" style="width:${Math.min(100, pct)}%"></div></div>
                   </div>`
                : `<span class="text-slate-400 tabular-nums">${plannedDays > 0 ? `${plannedDays}d planned` : '—'}</span>`);
          const costPart = (!isAdminProj && hasRates && (plannedCost > 0 || budgetCost > 0))
            ? `<div class="text-[10px] font-bold tabular-nums mt-1 ${budgetCost > 0 && costPct > 100 ? 'text-rose-600' : 'text-emerald-700'}">${formatCurrency(plannedCost, db)}${budgetCost > 0 ? ` / ${formatCurrency(budgetCost, db)} (${costPct}%)` : ' est.'}</div>`
            : '';
          return `
            <tr class="hover:bg-slate-50/70 ${p.archived ? 'opacity-65' : ''} ${isFirstAdminSetupRow ? 'admin-row-divider' : ''}">
              <th scope="row" class="px-4 py-3 font-bold text-slate-900 text-left">
                <div class="flex flex-wrap items-center gap-1.5">
                  ${swatchHtml}
                  <span>${escapeHtml(p.name)}</span>
                  ${isAdminProj ? '<span class="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-bold uppercase">Admin</span>' : ''}
                  ${p.tentative ? '<span class="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold uppercase">Pipeline</span>' : ''}
                  ${p.archived ? '<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold uppercase">Archived</span>' : ''}
                </div>
              </th>
              <td class="px-4 py-3 font-mono font-bold text-indigo-700">${escapeHtml(p.code)}</td>
              <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-md bg-slate-100 font-semibold">${escapeHtml(p.status)}</span></td>
              <td class="px-4 py-3 text-slate-600">${escapeHtml(p.priority || 'Medium')}</td>
              <td class="px-4 py-3 text-slate-600">${escapeHtml(p.owner || '—')}</td>
              <td class="px-4 py-3 text-slate-600">${escapeHtml(p.techLead || '—')}</td>
              <td class="px-4 py-3">${effortPart}${costPart}</td>
              <td class="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                <button type="button" onclick="openShiftProjectModal('${p.id}')" title="Shift all allocations, comments, and milestones by ±N weeks/months" class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 font-semibold transition">&#8644; Shift</button>
                <button type="button" onclick="openDuplicateProjectModal('${p.id}')" title="Duplicate project (with optional allocations &amp; milestones)" class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 font-semibold transition">Copy</button>
                <button type="button" onclick="toggleArchiveProject('${p.id}')" class="px-2 py-1 text-slate-600 hover:text-indigo-700 hover:underline font-semibold">${p.archived ? 'Restore' : 'Archive'}</button>
                <button type="button" onclick="openProjectModal('${p.id}')" class="px-2 py-1 text-indigo-600 hover:underline font-semibold">Edit</button>
                <button type="button" onclick="deleteProject('${p.id}')" class="px-2 py-1 text-rose-600 hover:underline font-semibold">Delete</button>
              </td>
            </tr>`;
        }).join('');
      }

      const mBody = document.getElementById('dataMilestonesBody');
      if (db.milestones.length === 0) {
        mBody.innerHTML = `<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">No milestones yet. Click "+ Add Milestone" to track key deliverables.</td></tr>`;
      } else {
        mBody.innerHTML = db.milestones.map(m => {
          const p = db.projects.find(x => x.id === m.projectId);
          const d = db.departments.find(x => x.id === m.deptId);
          const drift = getMilestoneDriftDays(m);
          const driftHtml = drift === 0
            ? '<span class="text-emerald-700 font-semibold">On Plan</span>'
            : drift > 0
              ? `<span class="text-rose-600 font-bold">▲ +${drift}d Slip</span>`
              : `<span class="text-emerald-600 font-bold">▼ ${drift}d Early</span>`;
          return `
            <tr class="hover:bg-slate-50/70">
              <th scope="row" class="px-4 py-3 font-bold text-slate-900 text-left"><span class="text-violet-600 mr-1" aria-hidden="true">◆</span>${escapeHtml(m.title)}</th>
              <td class="px-4 py-3 text-slate-700">${p ? `[${escapeHtml(p.code)}] ${escapeHtml(p.name)}` : '—'}</td>
              <td class="px-4 py-3 text-slate-600">${d ? escapeHtml(d.name) : 'Auto'}</td>
              <td class="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">${escapeHtml(m.baselineDate || '—')}</td>
              <td class="px-4 py-3 font-mono font-semibold text-slate-800 whitespace-nowrap">${escapeHtml(m.date || '—')}</td>
              <td class="px-4 py-3 whitespace-nowrap">${driftHtml}</td>
              <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-md bg-slate-100 font-semibold">${escapeHtml(m.status || 'Pending')}</span></td>
              <td class="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                <button type="button" onclick="openMilestoneModal('${m.id}')" class="px-2 py-1 text-indigo-600 hover:underline font-semibold">Edit</button>
                <button type="button" onclick="deleteMilestoneFromModal('${m.id}')" class="px-2 py-1 text-rose-600 hover:underline font-semibold">Delete</button>
              </td>
            </tr>`;
        }).join('');
      }

      document.getElementById('setDaysPerWeek').value = db.settings.daysPerWeek || 5;
      document.getElementById('setHoursPerDay').value = db.settings.hoursPerDay || 8;
      document.getElementById('setWarnThreshold').value = db.settings.warnThreshold || 85;
      document.getElementById('setOverThreshold').value = db.settings.overThreshold || 100;
      document.getElementById('setUserName').value = ui.userName || 'Project Mgr';
      const curSel = document.getElementById('setCurrency');
      if (curSel) curSel.value = getCurrencySymbol(db);

      const fte3 = getFte3Settings(db);
      document.getElementById('setFte3Basis').value = fte3.basis;
      document.getElementById('setFte3YellowPct').value = fte3.yellowPct;
      document.getElementById('setFte3RedPct').value = fte3.redPct;
      document.getElementById('setFte3YellowFte').value = fte3.yellowFte;
      document.getElementById('setFte3RedFte').value = fte3.redFte;
      onFte3BasisChange(fte3.basis);

      const ret = getRetentionSettings(db);
      document.getElementById('setMaxDumpHistory').value = ret.maxDumpHistory;
      document.getElementById('setMaxChangeLog').value = ret.maxChangeLog;
      document.getElementById('setMaxSnapshots').value = ret.maxSnapshots;
      document.getElementById('setAutoPruneOnSave').checked = Boolean(ret.autoPruneOnSave);
    }

    function saveSettingsFromTab() {
      const db = getActiveDB();
      db.settings.daysPerWeek = Math.max(1, Math.min(7, parseFloat(document.getElementById('setDaysPerWeek').value) || 5));
      db.settings.hoursPerDay = Math.max(1, Math.min(24, parseFloat(document.getElementById('setHoursPerDay').value) || 8));
      db.settings.warnThreshold = Math.max(50, Math.min(150, parseInt(document.getElementById('setWarnThreshold').value, 10) || 85));
      db.settings.overThreshold = Math.max(80, Math.min(200, parseInt(document.getElementById('setOverThreshold').value, 10) || 100));
      const curSel = document.getElementById('setCurrency');
      if (curSel && curSel.value) db.settings.currency = curSel.value;

      const basis = document.getElementById('setFte3Basis').value === 'absoluteFte' ? 'absoluteFte' : 'capacityPct';
      const yellowPct = Math.max(5, Math.min(95, parseInt(document.getElementById('setFte3YellowPct').value, 10) || 25));
      const redPct = Math.max(yellowPct + 5, Math.min(150, parseInt(document.getElementById('setFte3RedPct').value, 10) || 50));
      const yellowFte = Math.max(0.25, Math.min(50, parseFloat(document.getElementById('setFte3YellowFte').value) || 1.0));
      const redFte = Math.max(yellowFte + 0.25, Math.min(100, parseFloat(document.getElementById('setFte3RedFte').value) || 2.5));
      db.settings.fte3Scheme = { basis, yellowPct, redPct, yellowFte, redFte };

      const maxDumpHistory = Math.max(5, Math.min(100, parseInt(document.getElementById('setMaxDumpHistory').value, 10) || 15));
      const maxChangeLog = Math.max(10, Math.min(500, parseInt(document.getElementById('setMaxChangeLog').value, 10) || 100));
      const maxSnapshots = Math.max(1, Math.min(50, parseInt(document.getElementById('setMaxSnapshots').value, 10) || 10));
      const autoPruneOnSave = Boolean(document.getElementById('setAutoPruneOnSave').checked);
      db.settings.retention = { maxDumpHistory, maxChangeLog, maxSnapshots, autoPruneOnSave };

      if (!(typeof ppIsNamedUser === 'function' && ppIsNamedUser())) {
        setActiveUserName(document.getElementById('setUserName').value || 'Project Mgr', false);
      }
      if (autoPruneOnSave) enforceRollingHistory(db);

      recordChange('Settings', `Updated units (${db.settings.daysPerWeek}d/wk, ${db.settings.hoursPerDay}h/d), 3-level FTE (${basis}), & rolling limits (${maxDumpHistory}/${maxChangeLog}/${maxSnapshots})`);
      renderAll();
      showToast('Settings saved', 'success');
    }

    function quickStepDeptDefaultCapacity(deptId, delta) {
      const db = getActiveDB();
      const d = db.departments.find(x => x.id === deptId);
      if (!d) return;
      const next = Math.max(0, Math.round(((Number(d.defaultCapacity) || 0) + delta) * 100) / 100);
      pushUndoState(`Adjust [${d.code}] default capacity`);
      d.defaultCapacity = next;
      triggerHaptic(8);
      recordChange('Department', `Adjusted [${d.code}] ${d.name} default capacity to ${next} FTE`);
      renderAll();
    }

    /* ---------- Setup Tab: Active Variable Capacity Overrides Panel ---------- */

    function formatWeekSpanDateRange(startWk, endWk) {
      const mon = isoWeekKeyToMonday(startWk);
      const endSun = new Date(isoWeekKeyToMonday(endWk).getTime() + 6 * 86400000);
      const y1 = mon.getUTCFullYear();
      const y2 = endSun.getUTCFullYear();
      const startStr = `${MONTH_NAMES_SHORT[mon.getUTCMonth()]} ${mon.getUTCDate()}`;
      const endStr = `${MONTH_NAMES_SHORT[endSun.getUTCMonth()]} ${endSun.getUTCDate()}`;
      return y1 === y2 ? `${startStr} – ${endStr}, ${y2}` : `${startStr}, ${y1} – ${endStr}, ${y2}`;
    }

    function setOverrideDeptFilter(val) {
      ui.overrideDeptFilter = val || 'all';
      renderCapacityOverridesTable(getActiveDB());
    }

    function editCapacityOverrideSpan(deptId, startWk, endWk = startWk) {
      openCapacityModal(deptId, startWk, { forceWeeks: true, endPeriod: endWk || startWk });
    }

    function enumerateIsoWeekSpan(startWk, endWk) {
      const out = [];
      if (!startWk || !endWk || startWk > endWk) return out;
      let cur = startWk;
      let guard = 0;
      while (cur <= endWk && guard < 260) {
        out.push(cur);
        if (cur === endWk) break;
        cur = addWeeksToWeekKey(cur, 1);
        guard++;
      }
      return out;
    }

    function resetCapacityOverrideSpan(deptId, startWk, endWk) {
      const db = getActiveDB();
      const dept = db.departments.find(d => d.id === deptId);
      const wks = enumerateIsoWeekSpan(startWk, endWk).filter(wk => Object.prototype.hasOwnProperty.call(db.capacityOverrides || {}, `${deptId}::${wk}`));
      if (wks.length === 0) return;
      const baseFte = Number(dept?.defaultCapacity) || 0;
      const spanTxt = `${startWk}${endWk !== startWk ? ' → ' + endWk : ''}`;
      pushUndoState(`Reset ${dept?.code || deptId} capacity override (${startWk})`);
      wks.forEach(wk => { delete db.capacityOverrides[`${deptId}::${wk}`]; });
      recordChange('Capacity', `Reset [${dept?.code || deptId}] variable capacity override (${spanTxt}) back to base ${baseFte} FTE`);
      renderAll();
      showToast(`Reset ${wks.length} week${wks.length === 1 ? '' : 's'} to base ${baseFte} FTE`, 'info', { undoable: true });
    }

    function confirmResetCapacityOverrideSpan(deptId, startWk, endWk, onAfter = null) {
      const db = getActiveDB();
      const dept = db.departments.find(d => d.id === deptId);
      const wks = enumerateIsoWeekSpan(startWk, endWk).filter(wk => Object.prototype.hasOwnProperty.call(db.capacityOverrides || {}, `${deptId}::${wk}`));
      if (wks.length === 0) return;
      const baseFte = Number(dept?.defaultCapacity) || 0;
      const spanTxt = `${startWk}${endWk !== startWk ? ' → ' + endWk : ''}`;
      openConfirmModal(
        'Reset Capacity Override',
        `Delete ${wks.length} variable capacity week${wks.length === 1 ? '' : 's'} for [${dept?.code || deptId}] (${spanTxt}) and revert to base ${baseFte} FTE?`,
        'Reset Override',
        () => {
          resetCapacityOverrideSpan(deptId, startWk, endWk);
          if (typeof onAfter === 'function') onAfter();
        }
      );
    }

    function editCompanyOverrideGroup(startWk, endWk, pctFactor, deptIdsCsv = '') {
      const deptIds = deptIdsCsv ? String(deptIdsCsv).split(',').filter(Boolean) : null;
      openHolidayFactorModal(startWk, { forceWeeks: true, endPeriod: endWk, pct: pctFactor, deptIds });
    }

    function resetCompanyOverrideGroup(startWk, endWk, deptIdsCsv = '') {
      const db = getActiveDB();
      const wks = enumerateIsoWeekSpan(startWk, endWk);
      if (wks.length === 0) return;
      const targetIdSet = deptIdsCsv ? new Set(String(deptIdsCsv).split(',').filter(Boolean)) : null;
      const targetDepts = targetIdSet
        ? (db.departments || []).filter(d => targetIdSet.has(d.id))
        : (db.departments || []);
      let removed = 0;
      const spanTxt = `${startWk}${endWk !== startWk ? ' → ' + endWk : ''}`;
      pushUndoState(`Reset company-wide override (${spanTxt})`);
      targetDepts.forEach(d => {
        wks.forEach(wk => {
          const key = `${d.id}::${wk}`;
          if (Object.prototype.hasOwnProperty.call(db.capacityOverrides || {}, key)) {
            delete db.capacityOverrides[key];
            removed++;
          }
        });
      });
      if (removed === 0) return;
      recordChange('Capacity', `Reset company-wide capacity override (${spanTxt}, ${wks.length} wk${wks.length === 1 ? '' : 's'}) across ${targetDepts.length} department(s)`);
      renderAll();
      showToast(`Reset company-wide override (${wks.length} wk${wks.length === 1 ? '' : 's'}) for ${targetDepts.length} department${targetDepts.length === 1 ? '' : 's'}`, 'info', { undoable: true });
    }

    function confirmResetCompanyOverrideGroup(startWk, endWk, deptIdsCsv = '') {
      const db = getActiveDB();
      const wks = enumerateIsoWeekSpan(startWk, endWk);
      if (wks.length === 0) return;
      const targetIdSet = deptIdsCsv ? new Set(String(deptIdsCsv).split(',').filter(Boolean)) : null;
      const targetDepts = targetIdSet
        ? (db.departments || []).filter(d => targetIdSet.has(d.id))
        : (db.departments || []);
      let existingCount = 0;
      targetDepts.forEach(d => {
        wks.forEach(wk => {
          if (Object.prototype.hasOwnProperty.call(db.capacityOverrides || {}, `${d.id}::${wk}`)) existingCount++;
        });
      });
      if (existingCount === 0) return;
      const spanTxt = `${startWk}${endWk !== startWk ? ' → ' + endWk : ''}`;
      openConfirmModal(
        'Reset Company-Wide Override',
        `Delete company-wide capacity overrides (${spanTxt}, ${wks.length} week${wks.length === 1 ? '' : 's'}) across ${targetDepts.length} department${targetDepts.length === 1 ? '' : 's'} (${existingCount} entries)?`,
        'Reset All',
        () => resetCompanyOverrideGroup(startWk, endWk, deptIdsCsv)
      );
    }

    function toggleOverrideGroup(groupId) {
      if (!Array.isArray(ui.expandedOverrideGroups)) ui.expandedOverrideGroups = [];
      const idx = ui.expandedOverrideGroups.indexOf(groupId);
      if (idx >= 0) ui.expandedOverrideGroups.splice(idx, 1);
      else ui.expandedOverrideGroups.push(groupId);
      renderCapacityOverridesTable(getActiveDB());
    }

    function toggleAllOverrideGroups() {
      const db = getActiveDB();
      const entries = getStructuredCapacityOverrides(db, ui.overrideDeptFilter || 'all');
      const groupIds = entries.filter(e => e.kind === 'company').map(e => e.id);
      if (groupIds.length === 0) return;
      if (!Array.isArray(ui.expandedOverrideGroups)) ui.expandedOverrideGroups = [];
      const allExpanded = groupIds.every(id => ui.expandedOverrideGroups.includes(id));
      ui.expandedOverrideGroups = allExpanded ? [] : [...groupIds];
      renderCapacityOverridesTable(db);
    }

    function confirmClearCapacityOverrides() {
      const db = getActiveDB();
      const filterId = ui.overrideDeptFilter || 'all';
      const spans = getGroupedCapacityOverrides(db, filterId);
      const totalWks = spans.reduce((acc, sp) => acc + sp.weekKeys.length, 0);
      if (totalWks === 0) return;
      const scopeLabel = filterId === 'all'
        ? 'all departments'
        : (db.departments.find(d => d.id === filterId)?.name || 'this department');
      openConfirmModal(
        'Clear Variable Capacity Overrides',
        `Reset ${totalWks} overridden week${totalWks === 1 ? '' : 's'} across ${scopeLabel} back to default base FTE?`,
        'Clear Overrides',
        () => {
          pushUndoState(`Clear variable capacity overrides (${scopeLabel})`);
          spans.forEach(sp => {
            sp.weekKeys.forEach(wk => { delete db.capacityOverrides[`${sp.deptId}::${wk}`]; });
          });
          recordChange('Capacity', `Cleared ${totalWks} variable capacity override week(s) for ${scopeLabel}`);
          renderAll();
          showToast(`Cleared ${totalWks} overridden week${totalWks === 1 ? '' : 's'}`, 'info', { undoable: true });
        }
      );
    }

    function renderCapacityOverridesTable(db = getActiveDB()) {
      const box = document.getElementById('dataCapacityOverridesTable');
      const badge = document.getElementById('capacityOverridesCountBadge');
      const filterSel = document.getElementById('overrideDeptFilter');
      const clearBtn = document.getElementById('btnClearCapacityOverrides');
      const expandAllBtn = document.getElementById('btnToggleExpandAllOverrides');
      const expandAllIcon = document.getElementById('btnToggleExpandAllOverridesIcon');
      const expandAllLabel = document.getElementById('btnToggleExpandAllOverridesLabel');
      if (!box) return;

      if (ui.overrideDeptFilter !== 'all' && !db.departments.some(d => d.id === ui.overrideDeptFilter)) {
        ui.overrideDeptFilter = 'all';
      }

      const allRawSpans = getGroupedCapacityOverrides(db, 'all');
      const allStructured = getStructuredCapacityOverrides(db, 'all');
      const filterId = ui.overrideDeptFilter || 'all';

      if (filterSel) {
        filterSel.innerHTML = `<option value="all">All Departments (${allStructured.length})</option>` +
          db.departments.map(d => {
            const cnt = allRawSpans.filter(sp => sp.deptId === d.id).length;
            return `<option value="${d.id}" ${filterId === d.id ? 'selected' : ''}>${escapeHtml(d.name)} [${escapeHtml(d.code)}]${cnt > 0 ? ` (${cnt})` : ''}</option>`;
          }).join('');
      }

      const entries = filterId === 'all' ? allStructured : getStructuredCapacityOverrides(db, filterId);
      const companyGroups = entries.filter(e => e.kind === 'company');
      const deptRows = entries.filter(e => e.kind === 'dept');
      const shownWeeks = entries.reduce((acc, e) => acc + e.weekKeys.length, 0);

      if (!Array.isArray(ui.expandedOverrideGroups)) ui.expandedOverrideGroups = [];
      const validGroupSet = new Set(companyGroups.map(g => g.id));
      ui.expandedOverrideGroups = ui.expandedOverrideGroups.filter(id => validGroupSet.has(id));
      const allGroupsExpanded = companyGroups.length > 0 && companyGroups.every(g => ui.expandedOverrideGroups.includes(g.id));

      if (expandAllBtn) {
        const showExpandToggle = companyGroups.length > 0;
        expandAllBtn.classList.toggle('hidden', !showExpandToggle);
        expandAllBtn.classList.toggle('inline-flex', showExpandToggle);
        expandAllBtn.setAttribute('aria-expanded', String(allGroupsExpanded));
        if (expandAllIcon) expandAllIcon.textContent = allGroupsExpanded ? '▾' : '▸';
        if (expandAllLabel) expandAllLabel.textContent = allGroupsExpanded ? 'Collapse All' : 'Expand All';
      }

      if (badge) {
        if (entries.length === 0) {
          badge.textContent = '0 overrides';
        } else if (companyGroups.length > 0) {
          const parts = [`${companyGroups.length} company`];
          if (deptRows.length > 0) parts.push(`${deptRows.length} dept`);
          parts.push(`${shownWeeks} wk${shownWeeks === 1 ? '' : 's'}`);
          badge.textContent = parts.join(' • ');
        } else {
          badge.textContent = `${deptRows.length} span${deptRows.length === 1 ? '' : 's'} • ${shownWeeks} wk${shownWeeks === 1 ? '' : 's'}`;
        }
      }
      if (clearBtn) clearBtn.classList.toggle('hidden', entries.length === 0);

      if (entries.length === 0) {
        box.innerHTML = `
          <div class="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-slate-500">
            No active variable capacity overrides${filterId !== 'all' ? ' for this department' : ''}. Use a department&rsquo;s <strong>+ Add Override</strong> button in the table above, click <strong>Cap</strong> on any Roadmap column, or use <strong>Holiday / Shutdown %</strong>.
          </div>`;
        return;
      }

      const formatDeltaBadge = (deltaFte) => {
        const cls = deltaFte > 0.005
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : deltaFte < -0.005
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : 'bg-slate-100 text-slate-600 border-slate-200';
        const txt = deltaFte > 0.005 ? `+${deltaFte} FTE` : deltaFte < -0.005 ? `${deltaFte} FTE` : '0 FTE';
        return `<span class="px-2 py-0.5 rounded-md border text-[11px] font-bold tabular-nums ${cls}">${txt}</span>`;
      };

      const rowsHtml = entries.map(entry => {
        const spanLabel = entry.startWk === entry.endWk ? entry.startWk : `${entry.startWk} → ${entry.endWk}`;
        const dateRange = formatWeekSpanDateRange(entry.startWk, entry.endWk);

        if (entry.kind === 'company') {
          const isExpanded = ui.expandedOverrideGroups.includes(entry.id);
          const isShutdown = entry.eventType === 'shutdown';
          const pillCls = isShutdown
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-violet-50 text-violet-800 border-violet-200';
          const rowBgCls = isShutdown ? 'bg-rose-50/50 hover:bg-rose-50' : 'bg-violet-50/70 hover:bg-violet-50';
          const deptScopeTxt = entry.isPartial ? `(${entry.items.length}/${entry.totalDepts} depts)` : `(${entry.items.length} depts)`;
          const deptIdsAttr = escapeHtml((entry.deptIds || []).join(','));
          const mainRow = `
            <tr class="${rowBgCls} transition" data-override-group-id="${escapeHtml(entry.id)}">
              <th scope="row" class="px-3.5 py-2.5 font-bold text-slate-900 whitespace-nowrap cursor-pointer" onclick="toggleOverrideGroup('${escapeHtml(entry.id)}')">
                <div class="inline-flex items-center gap-1.5">
                  <button type="button" aria-expanded="${isExpanded}" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(entry.label)} (${escapeHtml(spanLabel)})"
                    onclick="event.stopPropagation(); toggleOverrideGroup('${escapeHtml(entry.id)}')"
                    class="w-6 h-6 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 flex items-center justify-center text-[11px] font-bold transition shrink-0 cursor-pointer">${isExpanded ? '&#9662;' : '&#9656;'}</button>
                  <span class="px-2 py-0.5 rounded-md border text-[10px] font-extrabold ${pillCls}">${escapeHtml(entry.label)}</span>
                  <span class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-extrabold text-slate-700 tabular-nums">${escapeHtml(entry.pctLabel)}</span>
                  <span class="text-[10px] font-semibold text-slate-500">${deptScopeTxt}</span>
                </div>
              </th>
              <td class="px-3.5 py-2.5 whitespace-nowrap cursor-pointer" onclick="toggleOverrideGroup('${escapeHtml(entry.id)}')">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-mono font-bold text-slate-800">${escapeHtml(spanLabel)}</span>
                  <span class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 text-[10px] font-bold">${entry.weekKeys.length} wk${entry.weekKeys.length === 1 ? '' : 's'}</span>
                  <span class="text-[11px] font-medium text-slate-500">(${escapeHtml(dateRange)})</span>
                </div>
              </td>
              <td class="px-3.5 py-2.5 text-right tabular-nums text-slate-600 font-semibold whitespace-nowrap">${entry.totalBaseFte} FTE</td>
              <td class="px-3.5 py-2.5 text-right tabular-nums font-extrabold ${isShutdown ? 'text-rose-700' : 'text-violet-700'} whitespace-nowrap">${entry.totalFte} FTE</td>
              <td class="px-3.5 py-2.5 text-right whitespace-nowrap">${formatDeltaBadge(entry.totalDeltaFte)}</td>
              <td class="px-3.5 py-2.5 text-right space-x-2 whitespace-nowrap">
                <button type="button" onclick="editCompanyOverrideGroup('${entry.startWk}', '${entry.endWk}', ${entry.pctFactor}, '${deptIdsAttr}')" class="text-indigo-600 hover:underline font-semibold">Edit %</button>
                <button type="button" onclick="confirmResetCompanyOverrideGroup('${entry.startWk}', '${entry.endWk}', '${deptIdsAttr}')" class="text-amber-700 hover:underline font-semibold">Reset All</button>
              </td>
            </tr>`;

          if (!isExpanded) return mainRow;

          const subRows = entry.items.map(it => `
            <tr class="bg-slate-50/70 hover:bg-slate-100" data-override-group-child="${escapeHtml(entry.id)}">
              <th scope="row" class="pl-11 pr-3.5 py-2 font-semibold text-slate-800 whitespace-nowrap">
                <span class="inline-flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full shrink-0" style="background:${it.dept.color}" aria-hidden="true"></span>
                  <span>${escapeHtml(it.dept.name)}</span>
                  <span class="font-mono text-[10px] text-slate-400">[${escapeHtml(it.dept.code)}]</span>
                  <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold tabular-nums">${it.pct}%</span>
                </span>
              </th>
              <td class="px-3.5 py-2 text-[11px] text-slate-400 whitespace-nowrap">
                <span class="font-mono">${escapeHtml(spanLabel)}</span>
                <span class="ml-1">&middot; ${entry.weekKeys.length} wk${entry.weekKeys.length === 1 ? '' : 's'}</span>
              </td>
              <td class="px-3.5 py-2 text-right tabular-nums text-slate-500 whitespace-nowrap">${it.baseFte} FTE</td>
              <td class="px-3.5 py-2 text-right tabular-nums font-bold text-sky-700 whitespace-nowrap">${it.fte} FTE</td>
              <td class="px-3.5 py-2 text-right whitespace-nowrap">${formatDeltaBadge(it.deltaFte)}</td>
              <td class="px-3.5 py-2 text-right space-x-2 whitespace-nowrap">
                <button type="button" onclick="editCapacityOverrideSpan('${it.deptId}', '${entry.startWk}', '${entry.endWk}')" class="text-indigo-600 hover:underline font-semibold">Edit</button>
                <button type="button" onclick="confirmResetCapacityOverrideSpan('${it.deptId}', '${entry.startWk}', '${entry.endWk}')" class="text-amber-700 hover:underline font-semibold">Reset</button>
              </td>
            </tr>`).join('');

          return mainRow + subRows;
        }

        const coChip = entry.companyBadge
          ? `<span class="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 text-[9px] font-bold">${escapeHtml(entry.companyBadge)}</span>`
          : '';
        return `
          <tr class="hover:bg-slate-50/70">
            <th scope="row" class="px-3.5 py-2.5 font-bold text-slate-900 whitespace-nowrap">
              <span class="inline-flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${entry.dept.color}" aria-hidden="true"></span>
                <span>${escapeHtml(entry.dept.name)}</span>
                <span class="font-mono text-[10px] text-slate-400">[${escapeHtml(entry.dept.code)}]</span>
                ${coChip}
              </span>
            </th>
            <td class="px-3.5 py-2.5 whitespace-nowrap">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-mono font-bold text-slate-800">${escapeHtml(spanLabel)}</span>
                <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">${entry.weekKeys.length} wk${entry.weekKeys.length === 1 ? '' : 's'}</span>
                <span class="text-[11px] font-medium text-slate-500">(${escapeHtml(dateRange)})</span>
              </div>
            </td>
            <td class="px-3.5 py-2.5 text-right tabular-nums text-slate-500 whitespace-nowrap">${entry.baseFte} FTE</td>
            <td class="px-3.5 py-2.5 text-right tabular-nums font-extrabold text-sky-700 whitespace-nowrap">${entry.fte} FTE</td>
            <td class="px-3.5 py-2.5 text-right whitespace-nowrap">${formatDeltaBadge(entry.deltaFte)}</td>
            <td class="px-3.5 py-2.5 text-right space-x-2 whitespace-nowrap">
              <button type="button" onclick="editCapacityOverrideSpan('${entry.deptId}', '${entry.startWk}', '${entry.endWk}')" class="text-indigo-600 hover:underline font-semibold">Edit</button>
              <button type="button" onclick="confirmResetCapacityOverrideSpan('${entry.deptId}', '${entry.startWk}', '${entry.endWk}')" class="text-amber-700 hover:underline font-semibold">Reset</button>
            </td>
          </tr>`;
      }).join('');

      box.innerHTML = `
        <table class="w-full text-left text-xs">
          <caption class="sr-only">Active variable capacity overrides with automatic company-wide holiday and shutdown grouping</caption>
          <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th scope="col" class="px-3.5 py-2.5 font-bold">Scope / Department</th>
              <th scope="col" class="px-3.5 py-2.5 font-bold">Weeks &amp; Date Range</th>
              <th scope="col" class="px-3.5 py-2.5 font-bold text-right">Base FTE</th>
              <th scope="col" class="px-3.5 py-2.5 font-bold text-right">Override FTE</th>
              <th scope="col" class="px-3.5 py-2.5 font-bold text-right">Delta</th>
              <th scope="col" class="px-3.5 py-2.5 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rowsHtml}
          </tbody>
        </table>`;
    }

    /* ============================================================================
     * 8. MOBILE-AWARE SHARED FILE SYNC, SNAPSHOTS & MOD 3 PAYLOAD HYGIENE
     * ============================================================================ */

    function supportsFileSystemAccess() {
      return typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
    }

    function openHandleIDB() {
      return withTimeout(new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('IndexedDB unavailable'));
          return;
        }
        try {
          const req = indexedDB.open(IDB_NAME, 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(IDB_STORE)) {
              req.result.createObjectStore(IDB_STORE);
            }
          };
          req.onblocked = () => {
            ppDebug('WARN', 'IndexedDB open blocked (another tab or browser lock)');
            reject(new Error('IndexedDB open blocked'));
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
        } catch (e) {
          reject(e);
        }
      }), 1500, 'IndexedDB open timed out after 1500ms');
    }

    async function saveRememberedHandle(handle) {
      let db = null;
      try {
        db = await openHandleIDB();
        await withTimeout(new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IDB write error'));
          tx.onabort = () => reject(tx.error || new Error('IDB write aborted'));
          tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
        }), 1500, 'IndexedDB save timed out');
        ppDebug('INFO', 'Saved remembered file handle to IndexedDB', { name: handle?.name });
      } catch (e) {
        ppDebug('WARN', 'Could not persist remembered handle to IndexedDB (non-fatal)', { name: e?.name, message: e?.message });
      } finally {
        try { if (db) db.close(); } catch (e) {}
      }
    }

    async function loadRememberedHandle() {
      let db = null;
      try {
        db = await openHandleIDB();
        const handle = await withTimeout(new Promise((resolve) => {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        }), 1500, 'IndexedDB read timed out');
        ppDebug('INFO', 'Loaded remembered file handle from IndexedDB', { found: Boolean(handle), name: handle?.name || null });
        return handle;
      } catch (e) {
        ppDebug('WARN', 'Could not read remembered handle from IndexedDB (non-fatal)', { name: e?.name, message: e?.message });
        return null;
      } finally {
        try { if (db) db.close(); } catch (e) {}
      }
    }

    async function clearRememberedHandle() {
      let db = null;
      try {
        db = await openHandleIDB();
        await withTimeout(new Promise((resolve) => {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
          tx.objectStore(IDB_STORE).delete(HANDLE_KEY);
        }), 1500, 'IndexedDB delete timed out');
        ppDebug('INFO', 'Cleared remembered file handle from IndexedDB');
      } catch (e) {
        ppDebug('WARN', 'Could not clear remembered handle in IndexedDB', { name: e?.name, message: e?.message });
      } finally {
        try { if (db) db.close(); } catch (e) {}
      }
    }

    function getDetectedChromeVersion() {
      try {
        const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
        const m = ua.match(/(?:Chrome|Edg)\/(\d+)/);
        return m ? parseInt(m[1], 10) : null;
      } catch (e) {
        return null;
      }
    }

    function formatLinkedFileFullPath(fileName, rawPath = '') {
      const name = String(fileName || '').trim();
      let p = String(rawPath || '').trim().replace(/^["']+|["']+$/g, '').trim();
      if (!p) return name;
      if (!name) return p;
      const lowerP = p.toLowerCase();
      const lowerName = name.toLowerCase();
      if (lowerP === lowerName || lowerP.endsWith('\\' + lowerName) || lowerP.endsWith('/' + lowerName)) {
        return p;
      }
      const sep = p.includes('\\') ? '\\' : '/';
      return p.endsWith('\\') || p.endsWith('/') ? `${p}${name}` : `${p}${sep}${name}`;
    }

    function getConnectedFileDisplayPath(fileName) {
      const name = String(fileName || '').trim();
      if (!name) return '';
      if (linkedFileHandle && linkedFileHandle.name === name && linkedFileDetectedPath) {
        return formatLinkedFileFullPath(name, linkedFileDetectedPath);
      }
      const saved = ui && ui.linkedFilePaths && typeof ui.linkedFilePaths === 'object' ? ui.linkedFilePaths[name] : '';
      if (saved) return formatLinkedFileFullPath(name, saved);
      return name;
    }

    function hasStoredPathForFile(fileName) {
      const name = String(fileName || '').trim();
      if (!name) return false;
      if (linkedFileHandle && linkedFileHandle.name === name && linkedFileDetectedPath) return true;
      return Boolean(ui && ui.linkedFilePaths && ui.linkedFilePaths[name]);
    }

    function openLinkedFilePathModal(fileName = '') {
      const name = String(fileName || linkedFileHandle?.name || rememberedFileHandle?.name || '').trim();
      if (!name) return;
      const currentSaved = (ui && ui.linkedFilePaths && ui.linkedFilePaths[name]) || linkedFileDetectedPath || '';
      const preview = formatLinkedFileFullPath(name, currentSaved);
      showModal(`
        <form onsubmit="saveLinkedFilePathFromModal(event)" class="p-5 space-y-4 text-xs">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Set Connected File Path</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">For security, Chrome &amp; Edge only expose the filename (<code class="font-mono">${escapeHtml(name)}</code>), not your full local disk path. Paste the folder or full path here to display it on this device.</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">&times;</button>
          </div>
          <input type="hidden" id="mLinkedPathFileName" value="${escapeHtml(name)}" />
          <div class="space-y-1.5">
            <label for="mLinkedFilePathInput" class="block font-semibold text-slate-700">Full Path or Folder Location (this device only)</label>
            <input id="mLinkedFilePathInput" type="text" value="${escapeHtml(currentSaved)}" placeholder="e.g. G:\\My Drive\\PulsePlan\\${escapeHtml(name)}"
              class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:border-indigo-400" />
            <p class="text-[11px] text-slate-500">Tip: In Windows File Explorer, right-click the JSON file &rarr; <strong>Copy as path</strong> (<code class="font-mono">Ctrl+Shift+C</code>) and paste it directly above (quotes are stripped automatically).</p>
          </div>
          ${currentSaved ? `<div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]"><span class="text-slate-500">Displayed as:</span> <code class="font-mono font-bold text-slate-800 break-all">${escapeHtml(preview)}</code></div>` : ''}
          <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            ${currentSaved ? `<button type="button" onclick="clearLinkedFilePathFromModal('${escapeHtml(name).replace(/'/g, "\\'")}')" class="px-3 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold transition">Clear Path</button>` : '<span></span>'}
            <div class="flex items-center gap-2">
              <button type="button" onclick="closeModal()" class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition">Cancel</button>
              <button type="submit" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">Save Path</button>
            </div>
          </div>
        </form>
      `, 'max-w-lg');
    }

    function saveLinkedFilePathFromModal(event) {
      if (event) event.preventDefault();
      const name = String(document.getElementById('mLinkedPathFileName')?.value || '').trim();
      const raw = String(document.getElementById('mLinkedFilePathInput')?.value || '').trim().replace(/^["']+|["']+$/g, '').trim();
      if (!name) { closeModal(); return; }
      if (!ui.linkedFilePaths || typeof ui.linkedFilePaths !== 'object') ui.linkedFilePaths = {};
      if (raw) {
        ui.linkedFilePaths[name] = formatLinkedFileFullPath(name, raw);
      } else {
        delete ui.linkedFilePaths[name];
      }
      persistUIPrefs();
      closeModal();
      renderSyncTab();
      updateSyncStatusUI();
      showToast(raw ? 'Saved connected file path for this device' : 'Cleared saved file path', 'success');
    }

    function clearLinkedFilePathFromModal(fileName) {
      const name = String(fileName || '').trim();
      openConfirmModal(
        'Clear Saved File Path',
        `Remove the remembered folder path display for "${name || 'this file'}" on this device?`,
        'Clear Path',
        () => {
          if (name && ui.linkedFilePaths && ui.linkedFilePaths[name]) {
            delete ui.linkedFilePaths[name];
            persistUIPrefs();
          }
          closeModal();
          renderSyncTab();
          updateSyncStatusUI();
          showToast('Cleared saved file path', 'info');
        }
      );
    }

    async function openSharedDatabaseFile() {
      const env = getDebugEnvironmentSummary();
      const chromeVer = getDetectedChromeVersion();
      ppDebug('INFO', 'openSharedDatabaseFile triggered', {
        protocol: env.protocol,
        isSecureContext: env.isSecureContext,
        inIframe: env.inIframe,
        hasFsApi: env.hasFsApi,
        chromeVer,
        activeTab: env.activeTab,
        isReloadingFromFile,
      });

      if (!supportsFileSystemAccess()) {
        ppDebug('WARN', 'File System Access API unavailable on this browser');
        showToast('Direct folder sync requires desktop Chrome 158+ / Edge over HTTPS. Use "Import JSON" in Sync.', 'warning');
        return;
      }
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        ppDebug('WARN', 'Direct file linking attempted on file:// protocol');
        showToast('Browser security blocks direct folder linking on local file:// pages. Open PulsePlan via HTTPS or use "Import JSON" in Sync.', 'warning');
        return;
      }

      const t0 = Date.now();
      let handle = null;
      const verHint = chromeVer && chromeVer < 158 ? ` (detected v${chromeVer})` : '';
      const fallbackAction = { actionLabel: 'Import JSON', onAction: () => triggerJsonImportPicker(), durationMs: 9500 };
      try {
        ppDebug('INFO', 'Opening window.showOpenFilePicker (with .json filter)...');
        const handles = await window.showOpenFilePicker({
          id: 'pulseplan-db',
          types: [{ description: 'PulsePlan JSON Database', accept: { 'application/json': ['.json'] } }],
          excludeAcceptAllOption: false,
          multiple: false,
        });
        handle = handles && handles[0];
      } catch (e) {
        const elapsedMs = Date.now() - t0;
        if (e && e.name === 'TypeError') {
          ppDebug('WARN', 'showOpenFilePicker rejected filter options (TypeError); retrying without types filter', { message: e.message, elapsedMs });
          try {
            const handles = await window.showOpenFilePicker({ multiple: false });
            handle = handles && handles[0];
          } catch (e2) {
            const elapsed2 = Date.now() - t0;
            ppDebug('ERROR', 'showOpenFilePicker fallback retry failed', { name: e2?.name, message: e2?.message, elapsedMs: elapsed2 });
            if (e2 && e2.name === 'AbortError') {
              showToast(
                `File picker closed without linking. Chrome 158+ is required on Windows${verHint} for direct file sync — update Chrome, shrink the file dialog, or click Import JSON.`,
                'warning',
                fallbackAction
              );
              return;
            }
            showToast(`Could not open file picker (${e2?.name || 'Error'}: ${e2?.message || 'blocked'}). Chrome 158+ is required on Windows${verHint}.`, 'warning', fallbackAction);
            return;
          }
        } else if (e && e.name === 'AbortError') {
          ppDebug('WARN', 'showOpenFilePicker AbortError', { elapsedMs, chromeVer, message: e.message || '' });
          if (elapsedMs < 200) {
            showToast(`Direct file picker was blocked (Chrome 158+ is required on Windows${verHint}, or browser policy blocked it). Update Chrome or click Import JSON.`, 'warning', fallbackAction);
          } else {
            showToast(
              `File picker closed without linking. If you clicked Open and nothing loaded, Chrome 158+ is required on Windows${verHint} (or a folder/permission block occurred) — update Chrome, shrink the file dialog, or click Import JSON.`,
              'warning',
              fallbackAction
            );
          }
          return;
        } else {
          ppDebug('ERROR', 'showOpenFilePicker failed', { name: e?.name, message: e?.message, elapsedMs });
          if (e && e.name === 'SecurityError') {
            showToast(`Browser blocked direct linking to this folder (Chrome 158+ required${verHint}; avoid Desktop/Downloads roots). Move the .json into a subfolder or click Import JSON.`, 'warning', fallbackAction);
          } else {
            const detail = e && (e.message || e.name) ? ` (${e.name || 'Error'}: ${e.message || ''})` : '';
            showToast(`Could not open file picker${detail}. Chrome 158+ is required on Windows${verHint}.`, 'warning', fallbackAction);
          }
          return;
        }
      }

      if (!handle) {
        ppDebug('WARN', 'showOpenFilePicker resolved with no file handle');
        showToast('No file handle was returned by the browser. Try "Import JSON" instead.', 'warning');
        return;
      }

      ppDebug('INFO', 'showOpenFilePicker selected file', { name: handle.name, kind: handle.kind, elapsedMs: Date.now() - t0 });
      await attachAndLoadFileHandle(handle, false);
    }

    async function createSharedDatabaseFile() {
      ppDebug('INFO', 'createSharedDatabaseFile triggered', { hasFsApi: supportsFileSystemAccess(), protocol: typeof location !== 'undefined' ? location.protocol : 'n/a' });
      if (!supportsFileSystemAccess()) {
        downloadJsonBackup();
        return;
      }
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        showToast('Direct folder linking is blocked on local file:// pages — downloading a JSON backup instead.', 'warning');
        downloadJsonBackup();
        return;
      }
      const t0 = Date.now();
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'pulseplan_company_roadmap.json',
          types: [{ description: 'PulsePlan JSON Database', accept: { 'application/json': ['.json'] } }],
        });
        if (!handle) return;
        ui.demoMode = false;
        ui.whatIfMode = false;
        whatIfDB = null;
        persistUIPrefs();
        linkedFileHandle = handle;
        rememberedFileHandle = handle;
        syncWarningState = { type: null, fileName: '', dismissed: false };
        await writeDBToLinkedFile();
        startFilePolling();
        renderAll();
        showToast(`Created & linked "${handle.name}" for auto-save`, 'success');
        saveRememberedHandle(handle);
      } catch (e) {
        const elapsedMs = Date.now() - t0;
        ppDebug('WARN', 'createSharedDatabaseFile failed/aborted', { name: e?.name, message: e?.message, elapsedMs });
        if (e && e.name === 'AbortError') {
          const cv = getDetectedChromeVersion();
          const vh = cv && cv < 158 ? ` (detected v${cv})` : '';
          showToast(
            elapsedMs < 200
              ? `Save file picker was blocked (Chrome 158+ is required on Windows${vh}). Use "Share / Save JSON" instead.`
              : `Save file picker closed without creating a linked file. If you clicked Save and nothing happened, Chrome 158+ is required on Windows${vh} — update Chrome or use "Share / Save JSON".`,
            'warning'
          );
          return;
        }
        if (e && e.name === 'SecurityError') {
          showToast('Browser blocked saving directly in this folder (Chrome restricts Desktop/Downloads roots). Choose a subfolder or use "Share / Save JSON".', 'warning');
        } else {
          showToast(`Could not create linked file (${e?.name || 'Error'}). Use "Share / Save JSON" instead.`, 'warning');
        }
      }
    }

    /**
     * Creates a timestamped backup copy of the connected JSON file (or active DB)
     * by prompting the user for the destination folder via showDirectoryPicker
     * (with showSaveFilePicker and direct download fallbacks). Never alters the active sync link.
     */
    async function backupConnectedJsonToFolder() {
      const db = linkedFileHandle ? liveDB : getActiveDB();
      const now = new Date();
      const pad2 = (n) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
      const rawBase = linkedFileHandle && linkedFileHandle.name
        ? linkedFileHandle.name.replace(/\.json$/i, '')
        : `pulseplan_${ui.demoMode ? 'demo' : 'live'}`;
      const safeBase = rawBase.replace(/[^a-zA-Z0-9._-]/g, '_') || 'pulseplan_roadmap';
      const backupName = `${safeBase}_backup_${stamp}.json`;

      let jsonStr = '';
      const hasEncKey = !ui.demoMode && typeof ppSyncPassphrase === 'string' && ppSyncPassphrase.length >= 8 && typeof encryptPulsePlanData === 'function';
      if (linkedFileHandle && (ui.demoMode || ui.whatIfMode)) {
        try {
          const f = await linkedFileHandle.getFile();
          jsonStr = typeof ppReadRawFileText === 'function' ? await ppReadRawFileText(f) : await f.text();
        } catch (e) {
          jsonStr = hasEncKey
            ? JSON.stringify(await encryptPulsePlanData(JSON.parse(JSON.stringify(liveDB)), ppSyncPassphrase), null, 2)
            : JSON.stringify(liveDB, null, 2);
        }
      } else if (hasEncKey) {
        const envelope = await encryptPulsePlanData(JSON.parse(JSON.stringify(db)), ppSyncPassphrase);
        jsonStr = JSON.stringify(envelope, null, 2);
      } else {
        jsonStr = JSON.stringify(db, null, 2);
      }

      const sourceLabel = linkedFileHandle ? linkedFileHandle.name : (ui.demoMode ? 'Demo DB' : 'Live DB');
      ppDebug('INFO', 'backupConnectedJsonToFolder triggered', { backupName, sourceLabel, bytes: jsonStr.length });

      // Primary path: Prompt directly for the destination folder (File System Access Directory Picker)
      if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && (typeof location === 'undefined' || location.protocol !== 'file:')) {
        try {
          const dirHandle = await window.showDirectoryPicker({
            id: 'pulseplan-backup-dir',
            mode: 'readwrite',
          });
          if (!dirHandle) return;
          const fileHandle = await dirHandle.getFileHandle(backupName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(jsonStr);
          await writable.close();
          const savedLabel = `${dirHandle.name}/${backupName}`;
          recordDumpEvent('BACKUP', savedLabel, jsonStr.length, `Backup of ${sourceLabel} (Rev ${db.meta?.revision || 1})`);
          renderSyncTab();
          showToast(`Backup saved to "${savedLabel}" (${formatBytes(jsonStr.length)})`, 'success');
          return;
        } catch (e) {
          ppDebug('WARN', 'showDirectoryPicker backup aborted/failed', { name: e?.name, message: e?.message });
          if (e && e.name === 'AbortError') return;
          if (e && e.name === 'SecurityError' && typeof window.showSaveFilePicker === 'function') {
            showToast('Chrome restricts direct folder access on Desktop/Downloads roots — opening Save As dialog instead.', 'info');
          }
          // Fall through to showSaveFilePicker / direct download
        }
      }

      // Secondary path: Native Save As file picker (lets user choose any folder & filename) or direct disk download
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const outcome = await shareOrDownloadFile(blob, backupName, 'application/json', 'PulsePlan JSON Backup', {
        mode: (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') ? 'disk' : 'download',
      });
      if (outcome === 'cancelled') return;
      recordDumpEvent('BACKUP', backupName, jsonStr.length, `Backup of ${sourceLabel} (Rev ${db.meta?.revision || 1})`);
      renderSyncTab();
      showToast(`Backup ${outcome === 'saved' ? 'saved to disk' : 'downloaded'}: "${backupName}" (${formatBytes(jsonStr.length)})`, 'success');
    }

    async function reconnectRememberedFile() {
      ppDebug('INFO', 'reconnectRememberedFile triggered', { hasRemembered: Boolean(rememberedFileHandle), name: rememberedFileHandle?.name || null });
      if (!rememberedFileHandle) {
        ppDebug('WARN', 'No remembered handle in memory; falling back to openSharedDatabaseFile');
        await openSharedDatabaseFile();
        return;
      }
      try {
        const perm = await rememberedFileHandle.requestPermission({ mode: 'readwrite' });
        ppDebug('INFO', 'requestPermission result', { name: rememberedFileHandle.name, perm });
        if (perm === 'granted') {
          await attachAndLoadFileHandle(rememberedFileHandle, false);
        } else {
          setSyncWarning('permission', rememberedFileHandle.name);
          showToast('Permission denied to access the remembered sync file.', 'warning');
        }
      } catch (e) {
        ppDebug('ERROR', 'reconnectRememberedFile failed', { name: e?.name, message: e?.message });
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
          setSyncWarning('permission', rememberedFileHandle.name);
          showToast(`Browser blocked permission for "${rememberedFileHandle.name}". Click "Choose Different File" or use "Import JSON".`, 'warning');
        } else {
          setSyncWarning('missing', rememberedFileHandle.name);
          showToast(`Sync file "${rememberedFileHandle.name}" could not be found or accessed (${e?.name || 'Error'}).`, 'error');
        }
      }
    }

    function isConnectionLostError(err) {
      if (!err) return false;
      const name = String(err.name || '');
      const msg = String(err.message || '').toLowerCase();
      if ([
        'NotFoundError',
        'NotReadableError',
        'NotAllowedError',
        'SecurityError',
        'InvalidStateError',
        'NoModificationAllowedError',
        'TimeoutError',
      ].includes(name)) return true;
      if (
        msg.includes('timed out') ||
        msg.includes('not found') ||
        msg.includes('disconnected') ||
        msg.includes('permission') ||
        msg.includes('passphrase changed') ||
        msg.includes('session locked')
      ) return true;
      return false;
    }

    async function handleDatabaseConnectionLost(detail = '', fileName = '', warnType = 'missing') {
      const targetName = String(fileName || linkedFileHandle?.name || rememberedFileHandle?.name || '');
      ppDebug('WARN', 'Database connection lost — clearing local data and locking workspace', { targetName, warnType, detail });
      linkedFileHandle = null;
      saveQueued = false;
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
      }
      stopFilePolling();
      setSyncWarning(warnType === 'permission' ? 'permission' : 'missing', targetName);
      if (typeof ppSignOutAndLockSession === 'function') {
        await ppSignOutAndLockSession('connection_lost', {
          fileName: targetName,
          detail: detail || `Connection to "${targetName || 'shared database'}" was lost.`,
          skipFlush: true,
          skipEnvelope: true,
        });
      }
    }

    async function autoReconnectSyncFile() {
      ppDebug('INFO', 'autoReconnectSyncFile check', {
        hasFsApi: supportsFileSystemAccess(),
        hasRemembered: Boolean(rememberedFileHandle),
        rememberedName: rememberedFileHandle?.name || null,
        demoMode: ui.demoMode,
      });
      // On mobile browsers without File System Access API, stay cleanly in local storage without showing desktop warnings
      if (!supportsFileSystemAccess()) {
        syncWarningState = { type: null, fileName: '', dismissed: false };
        renderSyncWarningBanner();
        return;
      }
      if (!rememberedFileHandle) {
        if (!ui.demoMode) setSyncWarning('unlinked', '');
        return;
      }
      try {
        if (typeof rememberedFileHandle.queryPermission === 'function') {
          const perm = await withTimeout(
            rememberedFileHandle.queryPermission({ mode: 'readwrite' }),
            3000,
            'queryPermission timed out'
          );
          ppDebug('INFO', 'autoReconnect queryPermission', { name: rememberedFileHandle.name, perm });
          if (perm === 'granted') {
            await attachAndLoadFileHandle(rememberedFileHandle, true);
            return;
          } else {
            setSyncWarning('permission', rememberedFileHandle.name);
            if (typeof ppReadSecureSessionFlag === 'function' && ppReadSecureSessionFlag()?.protected && typeof ppEnterInitialLockedGate === 'function') {
              ppEnterInitialLockedGate(rememberedFileHandle.name, 'reconnect_required');
            }
            return;
          }
        }
      } catch (e) {
        ppDebug('WARN', 'autoReconnectSyncFile failed', { name: e?.name, message: e?.message });
        if (e && (e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
          setSyncWarning('missing', rememberedFileHandle.name);
          if (typeof ppReadSecureSessionFlag === 'function' && ppReadSecureSessionFlag()?.protected) {
            await handleDatabaseConnectionLost(`Database "${rememberedFileHandle.name}" is unreachable or disconnected.`, rememberedFileHandle.name, 'missing');
            return;
          }
          showToast(`Warning: Sync file "${rememberedFileHandle.name}" is missing or disconnected.`, 'error');
          return;
        }
        setSyncWarning('permission', rememberedFileHandle.name);
      }
    }

    function setSyncWarning(type, fileName = '') {
      syncWarningState = { type, fileName, dismissed: false };
      renderSyncWarningBanner();
      updateSyncStatusUI();
    }

    function dismissSyncWarning() {
      syncWarningState.dismissed = true;
      renderSyncWarningBanner();
    }

    function renderSyncWarningBanner() {
      const banner = document.getElementById('syncWarningBanner');
      const msgEl = document.getElementById('syncWarningMsg');
      const actionsEl = document.getElementById('syncWarningActions');
      if (!banner || !msgEl || !actionsEl) return;

      // Never clutter mobile browsers (which lack FS Access API) with desktop-only file-link warnings
      if (!supportsFileSystemAccess() || ui.demoMode || linkedFileHandle || !syncWarningState.type || syncWarningState.dismissed) {
        banner.classList.add('hidden');
        return;
      }

      const name = escapeHtml(syncWarningState.fileName || 'shared database');
      banner.classList.remove('hidden');

      if (syncWarningState.type === 'missing') {
        banner.className = 'border-t border-rose-200 bg-rose-50 text-rose-900 px-4 py-2';
        msgEl.innerHTML = `<strong>Sync File Not Found:</strong> "${name}" could not be accessed (file moved, renamed, or drive disconnected). Reconnect and re-enter your password to resume.`;
        actionsEl.innerHTML = `
          <button type="button" onclick="openSharedDatabaseFile()" class="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold transition">Locate / Relink File</button>
          <button type="button" onclick="createSharedDatabaseFile()" class="px-2.5 py-1 rounded-lg bg-white border border-rose-300 hover:bg-rose-100 text-rose-800 font-semibold transition">Create New</button>
          <button type="button" onclick="dismissSyncWarning()" class="px-2 py-1 rounded-lg text-rose-700 hover:underline font-medium">Dismiss</button>`;
      } else if (syncWarningState.type === 'permission') {
        banner.className = 'border-t border-amber-200 bg-amber-50 text-amber-900 px-4 py-2';
        msgEl.innerHTML = `<strong>Reconnect Sync File:</strong> Click to restore automatic sync with <code class="font-mono px-1 rounded bg-white/70">${name}</code> (browser security requires 1 click after restart).`;
        actionsEl.innerHTML = `
          <button type="button" onclick="reconnectRememberedFile()" class="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">Reconnect Now</button>
          <button type="button" onclick="openSharedDatabaseFile()" class="px-2.5 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 font-semibold transition">Choose Different File</button>
          <button type="button" onclick="dismissSyncWarning()" class="px-2 py-1 rounded-lg text-amber-800 hover:underline font-medium">Dismiss</button>`;
      } else if (syncWarningState.type === 'unlinked') {
        banner.className = 'border-t border-amber-200 bg-amber-50 text-amber-900 px-4 py-2';
        msgEl.innerHTML = `<strong>No Sync File Connected:</strong> Working in browser storage only. Link a shared <code class="font-mono px-1 rounded bg-white/70">.json</code> file (Google Drive or company server) for automatic team sync.`;
        actionsEl.innerHTML = `
          <button type="button" onclick="openSharedDatabaseFile()" class="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">Open &amp; Link File</button>
          <button type="button" onclick="createSharedDatabaseFile()" class="px-2.5 py-1 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 font-semibold transition">Create Sync File</button>
          <button type="button" onclick="dismissSyncWarning()" class="px-2 py-1 rounded-lg text-amber-800 hover:underline font-medium">Dismiss</button>`;
      }
    }

    async function attachAndLoadFileHandle(handle, isAutoReconnect = false, isSilentAutoReload = false) {
      const tStart = Date.now();
      const wasActiveLinkedHandle = Boolean(linkedFileHandle && (linkedFileHandle === handle || linkedFileHandle.name === handle?.name));
      const isSwitchingFile = Boolean(!isSilentAutoReload && linkedFileHandle && linkedFileHandle !== handle && linkedFileHandle.name !== handle?.name);
      ppDebug('INFO', 'attachAndLoadFileHandle start', {
        name: handle?.name,
        isAutoReconnect,
        isSilentAutoReload,
        wasReloading: isReloadingFromFile,
      });

      let file;
      try {
        file = await withTimeout(
          handle.getFile(),
          15000,
          'Reading file handle timed out after 15s (cloud drive / OneDrive / Google Drive may be offline or syncing)'
        );
        ppDebug('INFO', 'handle.getFile succeeded', {
          name: file?.name,
          size: file?.size,
          type: file?.type,
          lastModified: file?.lastModified,
          elapsedMs: Date.now() - tStart,
        });
      } catch (e) {
        ppDebug('ERROR', 'handle.getFile failed', { name: e?.name, message: e?.message, elapsedMs: Date.now() - tStart });
        const warnType = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? 'permission' : 'missing';
        if (isSilentAutoReload || wasActiveLinkedHandle || (typeof ppShouldSuppressPlaintextStorage === 'function' && ppShouldSuppressPlaintextStorage())) {
          await handleDatabaseConnectionLost(e?.message || `Could not read "${handle?.name || 'database'}"`, handle?.name || '', warnType);
          return;
        }
        linkedFileHandle = null;
        setSyncWarning(warnType, handle.name);
        if (!isSilentAutoReload) {
          showToast(
            warnType === 'permission'
              ? `Permission required to read "${handle.name}". Click Reconnect or choose the file again.`
              : `Could not read "${handle.name}": ${e?.message || e?.name || 'file unreachable'}.`,
            warnType === 'permission' ? 'warning' : 'error'
          );
        }
        return;
      }

      isReloadingFromFile = true;
      let wasEncryptedFile = false;
      try {
        let migrated = null;
        try {
          const readRawPromise = (typeof ppReadRawFileText === 'function')
            ? ppReadRawFileText(file)
            : file.text();
          let rawText = (await withTimeout(
            readRawPromise,
            15000,
            'Reading file contents timed out after 15s'
          )).replace(/^\uFEFF/, '');
          wasEncryptedFile = typeof PP_ENC_FORMAT === 'string' && rawText.includes(PP_ENC_FORMAT);
          if (typeof ppResolveEncryptedJsonText === 'function') {
            rawText = await ppResolveEncryptedJsonText(rawText, { fileName: handle.name, isSilentAutoReload });
          }
          ppDebug('INFO', 'file.text succeeded', {
            chars: rawText.length,
            startsWithBrace: rawText.trimStart().startsWith('{'),
            elapsedMs: Date.now() - tStart,
          });
          if (!rawText.trim()) {
            throw new Error('File is empty (0 bytes — cloud placeholder may not be downloaded locally)');
          }
          const parsed = JSON.parse(rawText);
          ppDebug('INFO', 'JSON.parse succeeded', {
            topKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 12) : typeof parsed,
          });
          migrated = normalizeAndMigrateDB(parsed);
          if (!migrated) {
            ppDebug('ERROR', 'normalizeAndMigrateDB returned null (missing departments/projects)');
            if (!isSilentAutoReload) showToast(`"${handle.name}" is not a valid PulsePlan database (missing departments/projects).`, 'error');
            return;
          }
          ppDebug('INFO', 'normalizeAndMigrateDB succeeded', {
            depts: migrated.departments.length,
            projs: migrated.projects.length,
            allocs: Object.keys(migrated.allocations || {}).length,
            overrides: Object.keys(migrated.capacityOverrides || {}).length,
            milestones: (migrated.milestones || []).length,
            snapshots: (migrated.snapshots || []).length,
          });
        } catch (err) {
          ppDebug('ERROR', 'Sync file parse/migrate error', { name: err?.name, message: err?.message });
          const isAuthOrLockErr = wasEncryptedFile && (
            isSilentAutoReload ||
            isAutoReconnect ||
            wasActiveLinkedHandle ||
            /cancelled|passphrase|locked/i.test(String(err?.message || ''))
          );
          if (isAuthOrLockErr) {
            if (isSilentAutoReload || /passphrase changed|session locked/i.test(String(err?.message || ''))) {
              await handleDatabaseConnectionLost(err?.message || 'Sign in again to access this encrypted database.', handle.name, 'permission');
            } else if (typeof ppEnterInitialLockedGate === 'function' && (isAutoReconnect || (typeof ppReadSecureSessionFlag === 'function' && ppReadSecureSessionFlag()?.protected))) {
              ppEnterInitialLockedGate(handle.name, 'reconnect_required');
            }
            return;
          }
          if (!isSilentAutoReload) {
            showToast(`Failed to open "${handle.name}": ${err?.message || 'invalid JSON'}`, 'error');
          }
          return;
        }

        try {
          if (isSwitchingFile) {
            if (typeof window !== 'undefined' && typeof window.ppResetFinanceVaultForDbSwitch === 'function') {
              window.ppResetFinanceVaultForDbSwitch();
            }
            if (typeof window !== 'undefined' && typeof window.ppClearPbsMemoryAndStopSync === 'function') {
              window.ppClearPbsMemoryAndStopSync();
            }
            if (typeof window !== 'undefined' && typeof window.ppResetPeopleDirectoryMemory === 'function') {
              window.ppResetPeopleDirectoryMemory();
            }
          }

          liveDB = migrated;
          ui.demoMode = false;
          ui.whatIfMode = false;
          whatIfDB = null;
          clearUndoHistory();
          if (typeof ppSyncAuthAfterDbLoad === 'function') {
            const authRes = ppSyncAuthAfterDbLoad(liveDB);
            if (authRes && authRes.revoked) {
              return;
            }
          }

          let shifted = false;
          if (!isSilentAutoReload) {
            try {
              shifted = syncHorizonAfterDBLoad(liveDB);
              ppDebug('INFO', 'syncHorizonAfterDBLoad completed', { shifted, startMonth: ui.startMonth, startWeek: ui.startWeek });
            } catch (hErr) {
              ppDebug('WARN', 'Horizon alignment error after DB load', { name: hErr?.name, message: hErr?.message });
            }
          }

          persistUIPrefs();
          linkedFileHandle = handle;
          linkedFileDetectedPath = (file && typeof file.path === 'string' && file.path.trim())
            ? file.path.trim()
            : ((file && typeof file.webkitRelativePath === 'string' && (file.webkitRelativePath.includes('/') || file.webkitRelativePath.includes('\\')))
              ? file.webkitRelativePath.trim()
              : '');
          rememberedFileHandle = handle;
          lastKnownFileModified = file.lastModified;
          lastWrittenId = String(liveDB.meta?.lastWriteId || '');
          lastSyncedSnapshot = cloneSyncSnapshot(liveDB);
          saveQueued = false;
          pendingAutoReload = false;
          syncWarningState = { type: null, fileName: '', dismissed: false };
          document.getElementById('externalUpdateBanner')?.classList.add('hidden');
          if (wasEncryptedFile && typeof ppMarkSecureSessionFlag === 'function') {
            ppMarkSecureSessionFlag(handle.name, true);
          }
          ppPersistLiveDBCacheSafe(liveDB);
          startFilePolling();

          // On silent external reload, immediately re-apply/re-poll unlocked Finance Vault BEFORE rendering so costs never flash 0 or get wiped!
          if (isSilentAutoReload && typeof window !== 'undefined' && typeof window.ppOnMainDbReloadedForFinance === 'function') {
            await window.ppOnMainDbReloadedForFinance(liveDB).catch(() => {});
          }

          try {
            renderAll();
            ppDebug('INFO', 'Post-load renderAll completed', { activeTab: ui.activeTab, elapsedMs: Date.now() - tStart });
          } catch (renderErr) {
            ppDebug('ERROR', 'Post-load renderAll error', { name: renderErr?.name, message: renderErr?.message });
            if (!isSilentAutoReload) showToast(`Loaded "${handle.name}", but a view render error occurred (${renderErr?.message || 'Error'}).`, 'warning');
            return;
          }
          if (typeof ppCheckForcedPasswordChange === 'function' && !isSilentAutoReload) {
            setTimeout(() => ppCheckForcedPasswordChange(), 120);
          }

          if (isSilentAutoReload) {
            const who = liveDB.meta?.lastModifiedBy || 'a teammate';
            showToast(`Auto-reloaded latest changes from "${handle.name}" (${who}, Rev ${liveDB.meta?.revision || '?'})`, 'info');
          } else {
            const allocCount = Object.keys(liveDB.allocations).length;
            showToast(
              `${isAutoReconnect ? 'Auto-reconnected' : 'Connected'} to "${handle.name}" (${liveDB.departments.length} depts, ${liveDB.projects.length} projects, ${allocCount} wk allocs${shifted ? ' — jumped to data start' : ''})`,
              'success'
            );
          }

          // Persist handle to IndexedDB non-blockingly AFTER UI has already rendered so IDB stalls never freeze file opening
          if (!isSilentAutoReload) {
            saveRememberedHandle(handle);
          }

          // Automatically open the linked Finance Vault & reconnect PBS folder if remembered and authorized
          if (!isSilentAutoReload && typeof window !== 'undefined') {
            (async () => {
              if (typeof window.ppTryAutoOpenFinanceVault === 'function') {
                try {
                  await window.ppTryAutoOpenFinanceVault({
                    allowPermissionPrompt: !isAutoReconnect,
                    silent: isSilentAutoReload,
                  });
                } catch (_e) {}
              }
              if (typeof window.ppTryAutoReconnectPbsFolder === 'function') {
                try {
                  await window.ppTryAutoReconnectPbsFolder({
                    allowPrompt: !isAutoReconnect,
                    force: true,
                  });
                } catch (_e) {}
              }
            })();
          } else if (isSilentAutoReload && typeof window !== 'undefined' && typeof window.ppPollPbsFolderNow === 'function') {
            window.ppPollPbsFolderNow({ force: false }).catch(() => {});
          }
        } catch (postErr) {
          ppDebug('ERROR', 'Post-load attach error', { name: postErr?.name, message: postErr?.message });
          if (!isSilentAutoReload) showToast(`Loaded "${handle.name}", but setup failed: ${postErr?.message || 'unexpected error'}`, 'error');
        }
      } finally {
        isReloadingFromFile = false;
      }
    }

    function unlinkSharedFile() {
      const targetName = linkedFileHandle?.name || rememberedFileHandle?.name || 'the connected file';
      const isProtected = typeof ppShouldSuppressPlaintextStorage === 'function' && ppShouldSuppressPlaintextStorage();
      openConfirmModal(
        'Unlink Shared Database File?',
        isProtected
          ? `Disconnect "${targetName}"? Because this workspace is protected, all local data will be cleared from screen and memory until you reconnect and re-enter your password.`
          : `Disconnect "${targetName}" and stop automatic file sync?`,
        'Unlink & Disconnect',
        async () => {
          if (isProtected && typeof ppSignOutAndLockSession === 'function') {
            await ppSignOutAndLockSession('unlinked', { fileName: targetName, skipFlush: false, skipEnvelope: true });
          }
          linkedFileHandle = null;
          linkedFileDetectedPath = '';
          rememberedFileHandle = null;
          lastKnownFileModified = 0;
          lastWrittenId = '';
          lastSyncedSnapshot = null;
          saveQueued = false;
          pendingAutoReload = false;
          stopFilePolling();
          clearRememberedHandle();
          if (typeof window !== 'undefined' && typeof window.ppResetFinanceVaultForDbSwitch === 'function') {
            window.ppResetFinanceVaultForDbSwitch();
          }
          if (typeof window !== 'undefined' && typeof window.ppClearPbsMemoryAndStopSync === 'function') {
            window.ppClearPbsMemoryAndStopSync();
          }
          document.getElementById('externalUpdateBanner')?.classList.add('hidden');
          setSyncWarning('unlinked', '');
          if (isProtected && typeof ppRefreshLockedScreenUI === 'function') {
            ppRefreshLockedScreenUI();
            showToast(`Unlinked "${targetName}" and cleared local data.`, 'info');
            return;
          }
          renderSyncTab();
          updateSyncStatusUI();
          showToast('Unlinked shared file — continuing in browser storage', 'info');
        }
      );
    }

    /* ---------- Serialized Write Queue & 3-Way Buffered Auto-Merge Helpers ---------- */

    function cloneSyncSnapshot(db) {
      if (!db || typeof db !== 'object') return null;
      try {
        const snap = JSON.parse(JSON.stringify({
          meta: db.meta || {},
          settings: db.settings || {},
          departments: db.departments || [],
          projects: db.projects || [],
          allocations: db.allocations || {},
          capacityOverrides: db.capacityOverrides || {},
          comments: db.comments || {},
          milestones: db.milestones || [],
          snapshots: db.snapshots || [],
          changeLog: db.changeLog || [],
          dumpHistory: db.dumpHistory || [],
          peopleDirectory: db.peopleDirectory || [],
          externalCosts: db.externalCosts || [],
          accessControl: db.accessControl || { version: 1, adminName: 'Administrator', users: [] },
        }));
        // Always strip Finance Vault fields from Main DB sync snapshot so 3-way merge matches stripped disk file!
        if (snap.settings?.financeVault?.enabled) {
          (snap.departments || []).forEach(d => { if (d) d.dayRate = 0; });
          (snap.projects || []).forEach(p => { if (p) p.budgetCost = 0; });
          snap.externalCosts = [];
          if (snap.settings && 'externalCosts' in snap.settings) delete snap.settings.externalCosts;
        }
        return snap;
      } catch (e) {
        return null;
      }
    }

    function syncValuesEqual(a, b) {
      if (a === b) return true;
      if (a === undefined || b === undefined || a === null || b === null) return false;
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0005;
      if (typeof a === 'object' && typeof b === 'object') {
        try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
      }
      return false;
    }

    function areDBDataEqual(a, b) {
      if (!a || !b) return false;
      const fields = ['settings', 'departments', 'projects', 'allocations', 'capacityOverrides', 'comments', 'milestones', 'snapshots', 'peopleDirectory', 'externalCosts', 'accessControl'];
      for (const f of fields) {
        if (!syncValuesEqual(a[f], b[f])) return false;
      }
      return true;
    }

    function mergeMapThreeWay(baseMap = {}, localMap = {}, diskMap = {}, sectionName = 'map') {
      const merged = {};
      const conflicts = [];
      let localApplied = 0;
      let diskApplied = 0;
      const keys = new Set([...Object.keys(baseMap || {}), ...Object.keys(localMap || {}), ...Object.keys(diskMap || {})]);
      keys.forEach(k => {
        const bVal = baseMap ? baseMap[k] : undefined;
        const lVal = localMap ? localMap[k] : undefined;
        const dVal = diskMap ? diskMap[k] : undefined;
        const localChanged = !syncValuesEqual(bVal, lVal);
        const diskChanged = !syncValuesEqual(bVal, dVal);
        if (!localChanged && !diskChanged) {
          if (dVal !== undefined) merged[k] = dVal;
        } else if (localChanged && !diskChanged) {
          if (lVal !== undefined) merged[k] = lVal;
          localApplied++;
        } else if (!localChanged && diskChanged) {
          if (dVal !== undefined) merged[k] = dVal;
          diskApplied++;
        } else {
          if (syncValuesEqual(lVal, dVal)) {
            if (dVal !== undefined) merged[k] = dVal;
          } else {
            conflicts.push({ section: sectionName, key: k, base: bVal, local: lVal, disk: dVal });
          }
        }
      });
      return { merged, conflicts, localApplied, diskApplied };
    }

    function mergeArrayByIdThreeWay(baseArr = [], localArr = [], diskArr = [], sectionName = 'list') {
      const baseById = new Map((baseArr || []).filter(Boolean).map(x => [x.id, x]));
      const localById = new Map((localArr || []).filter(Boolean).map(x => [x.id, x]));
      const diskById = new Map((diskArr || []).filter(Boolean).map(x => [x.id, x]));
      const orderedIds = [];
      const seen = new Set();
      [...(diskArr || []), ...(localArr || [])].forEach(x => {
        if (x && x.id && !seen.has(x.id)) {
          seen.add(x.id);
          orderedIds.push(x.id);
        }
      });

      const merged = [];
      const conflicts = [];
      let localApplied = 0;
      let diskApplied = 0;

      orderedIds.forEach(id => {
        const bVal = baseById.get(id);
        const lVal = localById.get(id);
        const dVal = diskById.get(id);
        const localChanged = !syncValuesEqual(bVal, lVal);
        const diskChanged = !syncValuesEqual(bVal, dVal);
        if (!localChanged && !diskChanged) {
          if (dVal !== undefined) merged.push(JSON.parse(JSON.stringify(dVal)));
        } else if (localChanged && !diskChanged) {
          if (lVal !== undefined) merged.push(JSON.parse(JSON.stringify(lVal)));
          localApplied++;
        } else if (!localChanged && diskChanged) {
          if (dVal !== undefined) merged.push(JSON.parse(JSON.stringify(dVal)));
          diskApplied++;
        } else {
          if (syncValuesEqual(lVal, dVal)) {
            if (dVal !== undefined) merged.push(JSON.parse(JSON.stringify(dVal)));
          } else {
            conflicts.push({ section: sectionName, key: id, base: bVal, local: lVal, disk: dVal });
          }
        }
      });

      return { merged, conflicts, localApplied, diskApplied };
    }

    function mergeLogEntriesById(localList = [], diskList = [], limit = 200) {
      const seen = new Map();
      [...(localList || []), ...(diskList || [])].forEach(item => {
        if (!item) return;
        const key = item.id || `${item.timestamp || ''}::${item.summary || item.filename || ''}`;
        if (!seen.has(key)) seen.set(key, item);
      });
      return [...seen.values()]
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
        .slice(0, limit);
    }

    function tryThreeWayAutoMerge(baseDB, localDB, diskDB) {
      if (!baseDB || !localDB || !diskDB) {
        return { ok: false, reason: 'no-base', conflicts: [] };
      }

      const mAlloc = mergeMapThreeWay(baseDB.allocations, localDB.allocations, diskDB.allocations, 'allocations');
      const mCap = mergeMapThreeWay(baseDB.capacityOverrides, localDB.capacityOverrides, diskDB.capacityOverrides, 'capacityOverrides');
      const mCmt = mergeMapThreeWay(baseDB.comments, localDB.comments, diskDB.comments, 'comments');
      const mSet = mergeMapThreeWay(baseDB.settings, localDB.settings, diskDB.settings, 'settings');
      const mDept = mergeArrayByIdThreeWay(baseDB.departments, localDB.departments, diskDB.departments, 'departments');
      const mProj = mergeArrayByIdThreeWay(baseDB.projects, localDB.projects, diskDB.projects, 'projects');
      const mMs = mergeArrayByIdThreeWay(baseDB.milestones, localDB.milestones, diskDB.milestones, 'milestones');
      const mSnap = mergeArrayByIdThreeWay(baseDB.snapshots, localDB.snapshots, diskDB.snapshots, 'snapshots');
      const mPeople = mergeArrayByIdThreeWay(baseDB.peopleDirectory || [], localDB.peopleDirectory || [], diskDB.peopleDirectory || [], 'peopleDirectory');
      const mExt = mergeArrayByIdThreeWay(baseDB.externalCosts || [], localDB.externalCosts || [], diskDB.externalCosts || [], 'externalCosts');
      const mUsers = mergeArrayByIdThreeWay(baseDB.accessControl?.users || [], localDB.accessControl?.users || [], diskDB.accessControl?.users || [], 'accessControl.users');

      const allConflicts = [
        ...mAlloc.conflicts,
        ...mCap.conflicts,
        ...mCmt.conflicts,
        ...mSet.conflicts,
        ...mDept.conflicts,
        ...mProj.conflicts,
        ...mMs.conflicts,
        ...mSnap.conflicts,
        ...mPeople.conflicts,
        ...mExt.conflicts,
        ...mUsers.conflicts,
      ];
      if (allConflicts.length > 0) {
        return { ok: false, reason: 'collision', conflicts: allConflicts };
      }

      const baseAdminName = baseDB.accessControl?.adminName || 'Administrator';
      const localAdminName = localDB.accessControl?.adminName || 'Administrator';
      const diskAdminName = diskDB.accessControl?.adminName || 'Administrator';
      const mergedAdminName = localAdminName !== baseAdminName ? localAdminName : diskAdminName;

      const mergedDB = {
        meta: {
          version: 3,
          revision: Math.max(Number(diskDB.meta?.revision) || 1, Number(localDB.meta?.revision) || 1) + 1,
          lastModifiedAt: new Date().toISOString(),
          lastModifiedBy: ui.userName || 'Project Mgr',
          lastWriteId: '',
          lastClientId: SESSION_CLIENT_ID,
        },
        settings: mSet.merged,
        departments: mDept.merged,
        projects: getSortedProjects({ projects: mProj.merged }),
        allocations: mAlloc.merged,
        capacityOverrides: mCap.merged,
        comments: mCmt.merged,
        milestones: mMs.merged,
        snapshots: mSnap.merged,
        changeLog: mergeLogEntriesById(localDB.changeLog, diskDB.changeLog, 500),
        dumpHistory: mergeLogEntriesById(localDB.dumpHistory, diskDB.dumpHistory, 100),
        peopleDirectory: mPeople.merged,
        externalCosts: mExt.merged,
        accessControl: {
          version: 1,
          adminName: mergedAdminName,
          users: mUsers.merged,
        },
      };

      const localAppliedCount = mAlloc.localApplied + mCap.localApplied + mCmt.localApplied + mSet.localApplied + mDept.localApplied + mProj.localApplied + mMs.localApplied + mSnap.localApplied + mPeople.localApplied + mExt.localApplied + mUsers.localApplied;
      const diskAppliedCount = mAlloc.diskApplied + mCap.diskApplied + mCmt.diskApplied + mSet.diskApplied + mDept.diskApplied + mProj.diskApplied + mMs.diskApplied + mSnap.diskApplied + mPeople.diskApplied + mExt.diskApplied + mUsers.diskApplied;
      return { ok: true, mergedDB, localAppliedCount, diskAppliedCount, conflicts: [] };
    }

    function scheduleAutoSaveToFile() {
      if (!linkedFileHandle || !ui.autoSaveToFile || ui.demoMode) return;
      if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
      if (typeof ppIsSigningOut === 'function' && ppIsSigningOut()) return;
      // Serialized write-buffer: if a write is already in flight, queue one coalesced follow-up write instead of racing
      if (isSavingToFile) {
        saveQueued = true;
        updateSyncStatusUI('saving');
        return;
      }
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      updateSyncStatusUI('saving');
      saveDebounceTimer = setTimeout(() => {
        saveDebounceTimer = null;
        writeDBToLinkedFile();
      }, 600);
    }

    async function writeDBToLinkedFile({ forceOverwrite = false, allowWhileSigningOut = false } = {}) {
      if (!linkedFileHandle || ui.demoMode) return { ok: false, skipped: true };
      if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return { ok: false, locked: true };
      if (!allowWhileSigningOut && typeof ppIsSigningOut === 'function' && ppIsSigningOut()) return { ok: false, signingOut: true };
      if (isSavingToFile) {
        saveQueued = true;
        return { ok: false, queued: true };
      }
      isSavingToFile = true;
      let didConflict = false;
      let autoMergedFrom = null;
      let connectionLost = false;
      try {
        // Pre-write guard: ignore our own cloud-drive timestamp drift, auto-merge disjoint edits, enforce revocation, and only halt on real collisions
        if (!forceOverwrite && lastKnownFileModified) {
          const diskFile = await withTimeout(
            linkedFileHandle.getFile(),
            10000,
            'Reading linked file before save timed out'
          );
          if (diskFile.lastModified > lastKnownFileModified + 500) {
            let extMeta = { lastModifiedBy: 'a teammate', revision: '?' };
            let diskDB = null;
            let parsed = null;
            let decryptError = null;
            try {
              const rawDisk = (typeof ppReadRawFileText === 'function'
                ? await ppReadRawFileText(diskFile)
                : await diskFile.text()).replace(/^\uFEFF/, '');
              const resolvedDisk = typeof ppResolveEncryptedJsonText === 'function'
                ? await ppResolveEncryptedJsonText(rawDisk, { fileName: linkedFileHandle.name, isSilentAutoReload: true })
                : rawDisk;
              parsed = JSON.parse(resolvedDisk);
              if (parsed && parsed.meta) extMeta = parsed.meta;
              diskDB = normalizeAndMigrateDB(parsed);
            } catch (parseErr) {
              decryptError = parseErr;
            }

            if (decryptError && /passphrase changed|session locked/i.test(String(decryptError.message || ''))) {
              connectionLost = true;
              saveQueued = false;
              await handleDatabaseConnectionLost(decryptError.message, linkedFileHandle.name, 'permission');
              return { ok: false, connectionLost: true };
            }

            const isOurOwnWrite = Boolean(parsed?.meta?.lastWriteId && lastWrittenId && parsed.meta.lastWriteId === lastWrittenId);
            const isIdenticalToBase = Boolean(!isOurOwnWrite && diskDB && lastSyncedSnapshot && areDBDataEqual(diskDB, lastSyncedSnapshot));

            if (isOurOwnWrite || isIdenticalToBase) {
              ppDebug('INFO', isOurOwnWrite ? 'Absorbed self-write cloud timestamp drift before save' : 'Absorbed unchanged disk timestamp before save', {
                lastWriteId: lastWrittenId,
                diskLastModified: diskFile.lastModified,
              });
              lastKnownFileModified = diskFile.lastModified;
            } else {
              // Enforce live user revocation BEFORE merging/writing so a deleted/disabled user can never write back to disk!
              if (diskDB && typeof ppGetAuthSession === 'function') {
                const sess = ppGetAuthSession();
                if (sess && sess.mode === 'user' && sess.userId) {
                  const diskUser = (diskDB.accessControl?.users || []).find(u => u && u.id === sess.userId);
                  if (!diskUser || diskUser.enabled === false) {
                    saveQueued = false;
                    didConflict = true;
                    if (typeof ppSignOutAndLockSession === 'function') {
                      await ppSignOutAndLockSession('revoked', { skipFlush: true, skipEnvelope: true });
                    }
                    return { ok: false, revoked: true };
                  }
                }
              }

              // Compare stripped local clone against stripped base & disk so Finance Vault overlays NEVER cause false conflicts or zero out rates!
              const localForMerge = cloneSyncSnapshot(liveDB) || liveDB;
              const mergeRes = (diskDB && lastSyncedSnapshot)
                ? tryThreeWayAutoMerge(lastSyncedSnapshot, localForMerge, diskDB)
                : { ok: false, reason: 'no-base', conflicts: [] };

              if (mergeRes.ok) {
                ppDebug('INFO', 'Auto-merged buffered local edits with external disk update', {
                  localApplied: mergeRes.localAppliedCount,
                  diskApplied: mergeRes.diskAppliedCount,
                  diskRev: extMeta.revision,
                  by: extMeta.lastModifiedBy,
                });
                liveDB = mergeRes.mergedDB;
                if (typeof ppSyncAuthAfterDbLoad === 'function') {
                  const authRes = ppSyncAuthAfterDbLoad(liveDB);
                  if (authRes && authRes.revoked) {
                    saveQueued = false;
                    didConflict = true;
                    return { ok: false, revoked: true };
                  }
                }
                if (typeof window !== 'undefined' && typeof window.ppReapplyFinanceOverlayAfterMainReload === 'function') {
                  window.ppReapplyFinanceOverlayAfterMainReload(liveDB);
                }
                ppPersistLiveDBCacheSafe(liveDB);
                lastKnownFileModified = diskFile.lastModified;
                autoMergedFrom = {
                  by: extMeta.lastModifiedBy || 'shared file',
                  rev: extMeta.revision || '?',
                };
              } else {
                ppDebug('WARN', 'True sync collision detected — pausing auto-save', {
                  reason: mergeRes.reason,
                  collisionCount: (mergeRes.conflicts || []).length,
                  diskRev: extMeta.revision,
                  by: extMeta.lastModifiedBy,
                });
                didConflict = true;
                saveQueued = false;
                updateSyncStatusUI('conflict');
                openSyncConflictModal(extMeta, diskFile.lastModified, diskDB, mergeRes.conflicts || []);
                return { ok: false, conflict: true };
              }
            }
          }
        }
        if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) {
          return { ok: false, locked: true };
        }
        if (getRetentionSettings(liveDB).autoPruneOnSave) {
          enforceRollingHistory(liveDB);
        }
        const writeId = uid('w');
        liveDB.meta = liveDB.meta || { version: 3, revision: 1 };
        liveDB.meta.lastWriteId = writeId;
        liveDB.meta.lastClientId = SESSION_CLIENT_ID;

        const payloadToWrite = JSON.stringify(liveDB, null, 2);
        const writable = await linkedFileHandle.createWritable();
        await writable.write(payloadToWrite);
        await writable.close();
        const file = await withTimeout(linkedFileHandle.getFile(), 10000, 'Post-write stat timed out');
        lastKnownFileModified = file.lastModified;
        lastWrittenId = writeId;
        lastSyncedSnapshot = cloneSyncSnapshot(liveDB);
        pendingAutoReload = false;
        document.getElementById('externalUpdateBanner')?.classList.add('hidden');
        updateSyncStatusUI('synced');
        if (autoMergedFrom) {
          renderAll();
          showToast(`Auto-merged your edit with latest update from ${autoMergedFrom.by} (Rev ${autoMergedFrom.rev})`, 'info');
        } else if (ui.activeTab === 'sync') {
          renderSyncTab();
        }
        return { ok: true };
      } catch (e) {
        console.warn('Auto-save failed:', e);
        if (isConnectionLostError(e)) {
          connectionLost = true;
          saveQueued = false;
          const warnType = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? 'permission' : 'missing';
          const missingName = linkedFileHandle?.name || rememberedFileHandle?.name || '';
          await handleDatabaseConnectionLost(
            `Sync connection to "${missingName || 'shared database'}" failed during save (${e?.name || 'Error'}). Local data was cleared until you reconnect and sign in.`,
            missingName,
            warnType
          );
          return { ok: false, connectionLost: true, error: e };
        }
        saveQueued = false;
        updateSyncStatusUI('error');
        showToast(`Auto-save to linked file failed (${e?.message || 'check file permissions'}).`, 'error');
        return { ok: false, error: e };
      } finally {
        isSavingToFile = false;
        const lockedNow = typeof ppIsSessionLocked === 'function' && ppIsSessionLocked();
        const signingOutNow = typeof ppIsSigningOut === 'function' && ppIsSigningOut();
        if (!didConflict && !connectionLost && !lockedNow && !signingOutNow && saveQueued && linkedFileHandle && ui.autoSaveToFile && !ui.demoMode) {
          saveQueued = false;
          if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
          saveDebounceTimer = setTimeout(() => {
            saveDebounceTimer = null;
            writeDBToLinkedFile();
          }, 150);
        }
      }
    }

    async function forceOverwriteLinkedFile() {
      closeModal();
      const res = await writeDBToLinkedFile({ forceOverwrite: true });
      if (res && res.ok) {
        showToast('Kept your local changes and updated the shared sync file', 'success');
      }
    }

    function startFilePolling() {
      stopFilePolling();
      if (!linkedFileHandle || !ui.pollIntervalMs) return;
      pollTimerId = setInterval(checkExternalFileUpdates, ui.pollIntervalMs);
    }

    function stopFilePolling() {
      if (pollTimerId) {
        clearInterval(pollTimerId);
        pollTimerId = null;
      }
    }

    function isModalOpen() {
      const overlay = document.getElementById('modalOverlay');
      return overlay && !overlay.classList.contains('hidden');
    }

    async function checkExternalFileUpdates() {
      if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
      if (typeof ppIsSigningOut === 'function' && ppIsSigningOut()) return;
      if (!linkedFileHandle || ui.demoMode || isSavingToFile || isReloadingFromFile || saveDebounceTimer || saveQueued) return;
      try {
        const file = await withTimeout(
          linkedFileHandle.getFile(),
          10000,
          'Checking linked database timed out (drive may be offline)'
        );
        if (lastKnownFileModified && file.lastModified > lastKnownFileModified + 500) {
          let parsed = null;
          let diskDB = null;
          try {
            const rawText = (typeof ppReadRawFileText === 'function'
              ? await ppReadRawFileText(file)
              : await file.text()).replace(/^\uFEFF/, '');
            const text = typeof ppResolveEncryptedJsonText === 'function'
              ? await ppResolveEncryptedJsonText(rawText, { fileName: linkedFileHandle.name, isSilentAutoReload: true })
              : rawText;
            parsed = JSON.parse(text);
            diskDB = normalizeAndMigrateDB(parsed);
          } catch (parseErr) {
            if (/passphrase changed|session locked/i.test(String(parseErr?.message || ''))) {
              await handleDatabaseConnectionLost(parseErr.message, linkedFileHandle.name, 'permission');
            }
            return;
          }

          // Ignore our own write when OneDrive / Google Drive Desktop touches the local mtime after upload
          if (parsed?.meta?.lastWriteId && lastWrittenId && parsed.meta.lastWriteId === lastWrittenId) {
            ppDebug('INFO', 'Poll absorbed self-write cloud timestamp drift', { lastWriteId: lastWrittenId, mtime: file.lastModified });
            lastKnownFileModified = file.lastModified;
            return;
          }
          if (diskDB && lastSyncedSnapshot && areDBDataEqual(diskDB, lastSyncedSnapshot)) {
            lastKnownFileModified = file.lastModified;
            return;
          }

          // Check immediate revocation even when autoReloadFromFile is OFF or a modal / What-If sandbox is open!
          if (diskDB && typeof ppGetAuthSession === 'function') {
            const sess = ppGetAuthSession();
            if (sess && sess.mode === 'user' && sess.userId) {
              const fresh = (diskDB.accessControl?.users || []).find(u => u && u.id === sess.userId);
              if (!fresh || fresh.enabled === false) {
                if (typeof ppSignOutAndLockSession === 'function') {
                  await ppSignOutAndLockSession('revoked', { skipFlush: true, skipEnvelope: true });
                }
                return;
              }
            }
          }

          if (ui.autoReloadFromFile && !ui.whatIfMode) {
            if (isModalOpen()) {
              pendingAutoReload = true;
              const who = parsed.meta?.lastModifiedBy || 'a teammate';
              document.getElementById('externalUpdateMsg').textContent =
                `New update from ${who} will auto-load when you close this dialog.`;
              document.getElementById('externalUpdateBanner').classList.remove('hidden');
              return;
            }
            await attachAndLoadFileHandle(linkedFileHandle, false, true);
          } else {
            const who = parsed.meta?.lastModifiedBy || 'a teammate';
            const when = new Date(file.lastModified).toLocaleTimeString();
            document.getElementById('externalUpdateMsg').textContent =
              `New update in "${linkedFileHandle.name}" saved by ${who} at ${when} (Rev ${parsed.meta?.revision || '?'})${ui.whatIfMode ? ' — exit or commit What-If to reload.' : '.'}`;
            document.getElementById('externalUpdateBanner').classList.remove('hidden');
          }
        }
      } catch (e) {
        if (isConnectionLostError(e)) {
          const missingName = linkedFileHandle?.name || rememberedFileHandle?.name || '';
          const warnType = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? 'permission' : 'missing';
          await handleDatabaseConnectionLost(
            `Database "${missingName || 'shared file'}" was disconnected or became unreachable (${e?.name || 'Error'}). Local data was cleared until you reconnect and sign in.`,
            missingName,
            warnType
          );
        }
      }
    }

    async function reloadFromLinkedFile() {
      if (!linkedFileHandle) return;
      if (ui.whatIfMode && whatIfDB && typeof ppConfirmAction === 'function') {
        const ok = await ppConfirmAction({
          title: 'Reload Latest & Discard What-If?',
          message: 'Reloading the latest database from disk will discard your temporary What-If sandbox edits. Continue?',
          confirmLabel: 'Reload Latest',
        });
        if (!ok) return;
      }
      document.getElementById('externalUpdateBanner')?.classList.add('hidden');
      await attachAndLoadFileHandle(linkedFileHandle, false, true);
    }

    function dismissExternalUpdate() {
      pendingAutoReload = false;
      document.getElementById('externalUpdateBanner').classList.add('hidden');
    }

    function updateSyncStatusUI(state = 'idle') {
      const dot = document.getElementById('headerSyncDot');
      const text = document.getElementById('headerSyncText');
      const mDot = document.getElementById('mobileNavSyncDot');

      const setDots = (cls) => {
        if (dot) dot.className = `w-2 h-2 rounded-full ${cls}`;
        if (mDot) mDot.className = `absolute top-1.5 right-4 w-2 h-2 rounded-full ${cls}`;
      };

      if (ui.demoMode) {
        setDots('bg-amber-500');
        if (text) text.textContent = 'Demo Sandbox';
        return;
      }
      if (!linkedFileHandle) {
        if (!supportsFileSystemAccess()) {
          setDots('bg-emerald-500');
          if (text) text.textContent = 'Browser Saved';
          return;
        }
        if (syncWarningState.type === 'missing') {
          setDots('bg-rose-500');
          if (text) text.textContent = 'Sync Missing';
        } else if (syncWarningState.type === 'permission') {
          setDots('bg-amber-500');
          if (text) text.textContent = 'Reconnect Sync';
        } else {
          setDots('bg-amber-400');
          if (text) text.textContent = 'Local Only';
        }
        return;
      }
      if (state === 'saving') {
        setDots('bg-indigo-500 animate-ping');
        if (text) text.textContent = 'Saving...';
      } else if (state === 'conflict') {
        setDots('bg-rose-500 animate-pulse');
        if (text) text.textContent = 'Sync Conflict';
      } else if (state === 'error') {
        setDots('bg-rose-500');
        if (text) text.textContent = 'Sync Error';
      } else {
        setDots('bg-emerald-500');
        const fullPath = getConnectedFileDisplayPath(linkedFileHandle.name);
        if (text) {
          text.textContent = ui.autoReloadFromFile ? `Auto-Sync: ${linkedFileHandle.name}` : `Synced: ${linkedFileHandle.name}`;
          if (text.parentElement) text.parentElement.title = `Connected File: ${fullPath}`;
        }
      }
    }

    function renderSyncTab() {
      const db = getActiveDB();
      const ret = getRetentionSettings(db);
      const metrics = computePayloadMetrics(db);
      const hasFsApi = supportsFileSystemAccess();

      const badge = document.getElementById('syncCardBadge');
      const statusBox = document.getElementById('syncFileStatusBox');
      const fsControls = document.getElementById('desktopFsSyncControls');
      const btnReconnect = document.getElementById('btnReconnectFile');
      const btnUnlink = document.getElementById('btnUnlinkFile');

      if (fsControls) fsControls.classList.toggle('hidden', !hasFsApi);

      const chkSave = document.getElementById('chkAutoSave');
      const chkRel = document.getElementById('chkAutoReload');
      const pollSel = document.getElementById('pollIntervalSelect');
      if (chkSave) chkSave.checked = Boolean(ui.autoSaveToFile);
      if (chkRel) chkRel.checked = Boolean(ui.autoReloadFromFile);
      if (pollSel) pollSel.value = String(ui.pollIntervalMs);

      const fsNote = document.getElementById('fsApiNote');
      if (fsNote) {
        fsNote.textContent = hasFsApi
          ? 'Your browser supports direct auto-save & live reload with Google Drive Desktop / network folders (Chrome 158+ required on Windows; keep the .json in a subfolder, or use Import JSON).'
          : 'Mobile / Portable Mode: Your changes save automatically on this device. Use "Share / Save JSON" to send directly to Google Drive, iCloud Files, or Teams, and "Import JSON" to load updates.';
      }

      if (linkedFileHandle) {
        const displayPath = getConnectedFileDisplayPath(linkedFileHandle.name);
        const hasFullPath = hasStoredPathForFile(linkedFileHandle.name);
        const safeNameArg = escapeHtml(linkedFileHandle.name).replace(/'/g, "\\'");
        if (badge) {
          badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-100 text-emerald-800 whitespace-nowrap shrink-0';
          badge.textContent = ui.autoReloadFromFile ? 'Auto-Sync Active' : 'Live Linked';
        }
        if (statusBox) statusBox.innerHTML = `
          <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <span class="text-slate-500 shrink-0">Connected File:</span>
            <div class="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 min-w-0">
              <span class="font-mono font-bold text-slate-900 break-all text-right" title="${escapeHtml(displayPath)}">${escapeHtml(displayPath)}</span>
              <button type="button" onclick="openLinkedFilePathModal('${safeNameArg}')" class="text-[11px] font-semibold text-indigo-600 hover:underline whitespace-nowrap shrink-0">${hasFullPath ? 'Edit path' : '+ Set path'}</button>
            </div>
          </div>
          ${!hasFullPath ? '<div class="text-[10px] text-slate-400 text-right leading-snug">Browsers hide full local paths (<code class="font-mono">C:\\...</code>) for security — click <strong>+ Set path</strong> to record its folder on this device.</div>' : ''}
          <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"><span class="text-slate-500 shrink-0">Revision:</span><span class="font-semibold text-slate-800">Rev ${db.meta?.revision || 1}</span></div>
          <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"><span class="text-slate-500 shrink-0">Last Saved:</span><span class="text-slate-700 break-words text-right">${new Date(db.meta?.lastModifiedAt || Date.now()).toLocaleString()} by ${escapeHtml(db.meta?.lastModifiedBy || ui.userName)}</span></div>`;
        if (btnReconnect) btnReconnect.classList.add('hidden');
        if (btnUnlink) btnUnlink.classList.remove('hidden');
      } else if (!hasFsApi) {
        if (badge) {
          badge.className = 'px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-100 text-indigo-800 whitespace-nowrap shrink-0';
          badge.textContent = 'Mobile / Local';
        }
        if (statusBox) statusBox.innerHTML = `
          <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"><span class="text-slate-500 shrink-0">Storage:</span><span class="font-bold text-slate-900">Saved on Device (Rev ${db.meta?.revision || 1})</span></div>
          <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"><span class="text-slate-500 shrink-0">Last Updated:</span><span class="text-slate-700 text-right">${new Date(db.meta?.lastModifiedAt || Date.now()).toLocaleString()}</span></div>
          <div class="text-[11px] text-slate-600 pt-1 leading-relaxed">Tap <strong>Share / Save JSON</strong> below to push updates straight to Google Drive, Files, or Teams, or tap <strong>Import JSON</strong> to open a colleague&rsquo;s latest file.</div>`;
      } else {
        const remDisplayPath = rememberedFileHandle ? getConnectedFileDisplayPath(rememberedFileHandle.name) : '';
        if (badge) {
          badge.className = syncWarningState.type === 'missing'
            ? 'px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-100 text-rose-700 whitespace-nowrap shrink-0'
            : 'px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-100 text-amber-800 whitespace-nowrap shrink-0';
          badge.textContent = syncWarningState.type === 'missing' ? 'File Missing' : 'Local Only';
        }
        if (statusBox) statusBox.innerHTML = `
          <div class="text-slate-700 break-words">
            ${rememberedFileHandle
              ? `Last linked file: <code class="font-mono font-bold break-all">${escapeHtml(remDisplayPath)}</code> — click <strong>Reconnect Remembered File</strong> or relink it.`
              : 'Currently saving to browser storage only. Link a shared <code class="font-mono">.json</code> file in your Google Drive Desktop or network folder to sync with your team.'}
          </div>`;
        if (btnReconnect) btnReconnect.classList.toggle('hidden', !rememberedFileHandle);
        if (btnUnlink) btnUnlink.classList.add('hidden');
      }

      // Snapshots List (with Mod 3 Baseline Pinning)
      const snapBadge = document.getElementById('snapshotsCountBadge');
      if (snapBadge) {
        snapBadge.textContent = `${metrics.unpinnedSnapCount}/${ret.maxSnapshots} unpinned${metrics.pinnedSnapCount ? ` • ${metrics.pinnedSnapCount} pinned` : ''}`;
      }
      const snapList = document.getElementById('snapshotsList');
      if (snapList && db.snapshots.length === 0) {
        snapList.innerHTML = '<p class="text-xs text-slate-400 py-8 text-center">No snapshots saved yet. Tap "+ Save" to freeze a baseline.</p>';
      } else if (snapList) {
        snapList.innerHTML = db.snapshots.map(s => `
          <div class="p-3.5 rounded-xl border ${s.pinned ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50/70'} flex flex-wrap items-start justify-between gap-2 text-xs">
            <div class="space-y-0.5 min-w-0 flex-1">
              <div class="font-bold text-slate-900 flex items-center gap-1.5 break-words">
                ${s.pinned ? '<span title="Pinned baseline (protected from rolling eviction)" class="text-amber-600 shrink-0">📌</span>' : ''}
                <span class="break-words">${escapeHtml(s.name)}</span>
              </div>
              <div class="text-[11px] text-slate-500 break-words">${new Date(s.createdAt).toLocaleString()} &bull; ${escapeHtml(s.createdBy || 'PM')}</div>
              ${s.notes ? `<div class="text-[11px] text-slate-600 pt-1 break-words">${escapeHtml(s.notes)}</div>` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
              <button type="button" onclick="toggleSnapshotPin('${s.id}')" title="${s.pinned ? 'Unpin snapshot' : 'Pin baseline to protect from rolling eviction'}"
                class="px-2.5 py-1.5 md:px-2 md:py-1 rounded-lg border text-[11px] font-semibold transition ${s.pinned ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}">
                ${s.pinned ? 'Pinned' : 'Pin'}
              </button>
              <button type="button" onclick="ui.compareSnapshotId='${s.id}'; ui.compareTargetId='__CURRENT__'; switchTab('health')" class="px-2.5 py-1.5 md:py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold transition">Compare</button>
              <button type="button" onclick="restoreSnapshot('${s.id}')" class="px-2.5 py-1.5 md:py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold transition">Restore</button>
              <button type="button" onclick="deleteSnapshot('${s.id}')" class="px-2 py-1.5 md:py-1 rounded-lg text-rose-600 hover:bg-rose-50 font-semibold transition">Delete</button>
            </div>
          </div>`).join('');
      }

      // Mod 3: Rolling Dump History & Payload Breakdown UI
      const totalBadge = document.getElementById('payloadTotalBadge');
      if (totalBadge) totalBadge.textContent = `Total DB: ${formatBytes(metrics.totalBytes)}`;

      const grid = document.getElementById('payloadBreakdownGrid');
      if (grid) {
        const snapHigh = Math.max(1, Math.round(ret.maxSnapshots * 0.8));
        const logHigh = Math.max(1, Math.round(ret.maxChangeLog * 0.8));
        const dumpHigh = Math.max(1, Math.round(ret.maxDumpHistory * 0.8));
        grid.innerHTML = `
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <dt class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Core Roadmap Data</dt>
            <dd class="text-sm font-extrabold text-slate-900 tabular-nums">${formatBytes(metrics.coreBytes)}</dd>
            <div class="text-[11px] text-slate-500">${db.departments.length} depts &bull; ${db.projects.length} projs &bull; ${Object.keys(db.allocations || {}).length} wk allocs</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="flex items-center justify-between">
              <dt class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Snapshots</dt>
              <span class="text-[11px] font-bold text-slate-700 tabular-nums">${formatBytes(metrics.snapsBytes)}</span>
            </div>
            <dd class="text-xs font-bold text-slate-800 tabular-nums">${metrics.unpinnedSnapCount} / ${ret.maxSnapshots} unpinned ${metrics.pinnedSnapCount ? `(+${metrics.pinnedSnapCount} 📌)` : ''}</dd>
            <meter class="retention-meter" min="0" max="${ret.maxSnapshots}" low="${Math.max(1, Math.round(ret.maxSnapshots * 0.5))}" high="${snapHigh}" optimum="0" value="${Math.min(ret.maxSnapshots, metrics.unpinnedSnapCount)}">${metrics.unpinnedSnapCount} of ${ret.maxSnapshots}</meter>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="flex items-center justify-between">
              <dt class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Change Log</dt>
              <span class="text-[11px] font-bold text-slate-700 tabular-nums">${formatBytes(metrics.logBytes)}</span>
            </div>
            <dd class="text-xs font-bold text-slate-800 tabular-nums">${metrics.logCount} / ${ret.maxChangeLog} records</dd>
            <meter class="retention-meter" min="0" max="${ret.maxChangeLog}" low="${Math.max(1, Math.round(ret.maxChangeLog * 0.5))}" high="${logHigh}" optimum="0" value="${Math.min(ret.maxChangeLog, metrics.logCount)}">${metrics.logCount} of ${ret.maxChangeLog}</meter>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="flex items-center justify-between">
              <dt class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Dump History</dt>
              <span class="text-[11px] font-bold text-slate-700 tabular-nums">${formatBytes(metrics.dumpBytes)}</span>
            </div>
            <dd class="text-xs font-bold text-slate-800 tabular-nums">${metrics.dumpCount} / ${ret.maxDumpHistory} records</dd>
            <meter class="retention-meter" min="0" max="${ret.maxDumpHistory}" low="${Math.max(1, Math.round(ret.maxDumpHistory * 0.5))}" high="${dumpHigh}" optimum="0" value="${Math.min(ret.maxDumpHistory, metrics.dumpCount)}">${metrics.dumpCount} of ${ret.maxDumpHistory}</meter>
          </div>`;
      }

      const inpDump = document.getElementById('syncMaxDumpHistory');
      const inpLog = document.getElementById('syncMaxChangeLog');
      const inpSnap = document.getElementById('syncMaxSnapshots');
      if (inpDump) inpDump.value = ret.maxDumpHistory;
      if (inpLog) inpLog.value = ret.maxChangeLog;
      if (inpSnap) inpSnap.value = ret.maxSnapshots;
      previewRollingPrune();

      const dumpTable = document.getElementById('dumpHistoryTable');
      const dumps = db.dumpHistory || [];
      if (dumpTable) {
        if (dumps.length === 0) {
          dumpTable.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">No exports or dumps recorded yet. Share or save a JSON, CSV, or PDF to populate the rolling history.</p>';
        } else {
          const fmtStyles = {
            JSON: 'bg-indigo-50 text-indigo-700 border-indigo-200',
            PDF: 'bg-rose-50 text-rose-700 border-rose-200',
            CSV: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            ARCHIVE: 'bg-amber-50 text-amber-800 border-amber-200',
          };
          dumpTable.innerHTML = `
            <table class="w-full text-left text-xs">
              <caption class="sr-only">Rolling history of recent database exports and dumps</caption>
              <thead class="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-200 sticky top-0">
                <tr>
                  <th scope="col" class="px-3 py-2">When</th>
                  <th scope="col" class="px-3 py-2">Format</th>
                  <th scope="col" class="px-3 py-2">File</th>
                  <th scope="col" class="px-3 py-2">User</th>
                  <th scope="col" class="px-3 py-2">Rev</th>
                  <th scope="col" class="px-3 py-2 text-right">Size</th>
                  <th scope="col" class="px-3 py-2">Summary</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${dumps.map(d => `
                  <tr class="hover:bg-slate-50/70">
                    <td class="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">${new Date(d.timestamp).toLocaleString()}</td>
                    <td class="px-3 py-2"><span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${fmtStyles[d.format] || 'bg-slate-100 text-slate-700 border-slate-200'}">${escapeHtml(d.format)}</span></td>
                    <td class="px-3 py-2 font-mono text-[11px] text-slate-800 max-w-[180px] truncate" title="${escapeHtml(d.filename)}">${escapeHtml(d.filename || '—')}</td>
                    <td class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">${escapeHtml(d.user)}</td>
                    <td class="px-3 py-2 font-mono text-slate-500">v${d.revision || 1}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-slate-600 whitespace-nowrap">${d.sizeBytes ? formatBytes(d.sizeBytes) : '—'}</td>
                    <td class="px-3 py-2 text-slate-600">${escapeHtml(d.summary || '—')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>`;
        }
      }

      renderSyncDebugPanel();
      if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
    }

    function renderSyncDebugPanel() {
      const envEl = document.getElementById('syncDebugEnvSummary');
      const logEl = document.getElementById('syncDebugLogOutput');
      const cntEl = document.getElementById('syncDebugCountBadge');
      if (!envEl && !logEl) return;

      const env = getDebugEnvironmentSummary();
      if (cntEl) cntEl.textContent = `${_debugLogEntries.length} event${_debugLogEntries.length === 1 ? '' : 's'}`;
      if (envEl) {
        envEl.innerHTML = `
          <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">Build: ${escapeHtml(env.build)}</span>
          <span class="px-2 py-0.5 rounded ${env.hasFsApi && env.protocol !== 'file:' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'} font-mono">FS API: ${env.hasFsApi ? 'Yes' : 'No'} (${escapeHtml(env.protocol)})</span>
          <span class="px-2 py-0.5 rounded ${env.isSecureContext ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'} font-mono">Secure: ${env.isSecureContext ? 'Yes' : 'No'}</span>
          <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">SW: ${env.swControlled ? 'Active' : 'None'}</span>
          <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">Iframe: ${env.inIframe ? 'Yes' : 'No'}</span>`;
      }
      if (logEl) {
        if (_debugLogEntries.length === 0) {
          logEl.textContent = 'No events logged yet. Click "Open & Link Shared File" or "Import JSON" to capture a trace.';
        } else {
          logEl.textContent = _debugLogEntries
            .slice()
            .reverse()
            .map(e => `[${e.time}] [${e.level}] ${e.message}${e.details ? ' | ' + e.details : ''}`)
            .join('\n');
        }
      }
    }

    async function resetPwaCacheAndReload() {
      if (typeof ppConfirmAction === 'function') {
        const ok = await ppConfirmAction({
          title: 'Clear App Cache & Reload?',
          message: 'Unregister the offline app cache and reload the page? Any unsaved dialog edits or temporary What-If sandbox changes will be lost.',
          confirmLabel: 'Clear Cache & Reload',
        });
        if (!ok) return;
      }
      ppDebug('INFO', 'User triggered Clear App Cache & Reload');
      try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        showToast('App cache cleared — reloading fresh copy...', 'info');
        setTimeout(() => { location.reload(); }, 350);
      } catch (e) {
        ppDebug('ERROR', 'resetPwaCacheAndReload failed', { name: e?.name, message: e?.message });
        showToast(`Could not clear cache automatically (${e?.message || 'Error'}). Press Ctrl+Shift+R.`, 'warning');
      }
    }

    function readSyncRetentionLimitsFromUI() {
      const db = getActiveDB();
      const cur = getRetentionSettings(db);
      return {
        maxDumpHistory: Math.max(5, Math.min(100, parseInt(document.getElementById('syncMaxDumpHistory')?.value, 10) || cur.maxDumpHistory)),
        maxChangeLog: Math.max(10, Math.min(500, parseInt(document.getElementById('syncMaxChangeLog')?.value, 10) || cur.maxChangeLog)),
        maxSnapshots: Math.max(1, Math.min(50, parseInt(document.getElementById('syncMaxSnapshots')?.value, 10) || cur.maxSnapshots)),
        autoPruneOnSave: cur.autoPruneOnSave,
      };
    }

    function previewRollingPrune() {
      const db = getActiveDB();
      const limits = readSyncRetentionLimitsFromUI();
      const dry = enforceRollingHistory(db, { dryRun: true, limits });
      const previewEl = document.getElementById('retentionPrunePreview');
      const archBtn = document.getElementById('btnArchiveAndPrune');
      const totalWillPrune = dry.prunedLog + dry.prunedSnaps + dry.prunedDumps;

      if (previewEl) {
        if (totalWillPrune > 0 || dry.orphansRemoved > 0) {
          const parts = [];
          if (dry.prunedDumps) parts.push(`${dry.prunedDumps} dump record(s)`);
          if (dry.prunedLog) parts.push(`${dry.prunedLog} change log entry(ies)`);
          if (dry.prunedSnaps) parts.push(`${dry.prunedSnaps} unpinned snapshot(s)`);
          if (dry.orphansRemoved) parts.push(`${dry.orphansRemoved} orphan key(s)`);
          previewEl.innerHTML = `<span class="text-amber-700 font-semibold">Pending cleanup:</span> will trim ${parts.join(', ')} (~${formatBytes(dry.savedBytes)} saved).`;
        } else {
          previewEl.textContent = 'All rolling history streams are cleanly within your selected limits.';
        }
      }
      if (archBtn) archBtn.classList.toggle('hidden', totalWillPrune === 0);
    }

    function executeCompactDatabaseNow(limits) {
      const db = getActiveDB();
      db.settings.retention = limits;
      const res = enforceRollingHistory(db, { dryRun: false, limits });
      touchDBAndSave();
      renderAll();
      const out = document.getElementById('compactOutputMsg');
      const totalPruned = res.prunedLog + res.prunedSnaps + res.prunedDumps + res.orphansRemoved;
      const msg = totalPruned > 0
        ? `Compacted: removed ${totalPruned} item(s), saved ${formatBytes(res.savedBytes)}.`
        : 'Retention limits saved — database is already compact.';
      if (out) out.textContent = msg;
      showToast(msg, 'success');
    }

    function compactDatabaseNow() {
      const db = getActiveDB();
      const limits = readSyncRetentionLimitsFromUI();
      const dry = enforceRollingHistory(db, { dryRun: true, limits });
      const totalWillPrune = dry.prunedLog + dry.prunedSnaps + dry.prunedDumps + dry.orphansRemoved;
      if (totalWillPrune > 0 && typeof openConfirmModal === 'function') {
        const parts = [];
        if (dry.prunedSnaps) parts.push(`${dry.prunedSnaps} unpinned snapshot(s)`);
        if (dry.prunedLog) parts.push(`${dry.prunedLog} change log entry(ies)`);
        if (dry.prunedDumps) parts.push(`${dry.prunedDumps} dump record(s)`);
        if (dry.orphansRemoved) parts.push(`${dry.orphansRemoved} orphan key(s)`);
        openConfirmModal(
          'Compact & Prune Database?',
          `Permanently delete ${parts.join(', ')} (~${formatBytes(dry.savedBytes)})? This cannot be undone.`,
          'Compact & Delete',
          () => executeCompactDatabaseNow(limits)
        );
        return;
      }
      executeCompactDatabaseNow(limits);
    }

    async function archiveAndPruneHistory() {
      const db = getActiveDB();
      const limits = readSyncRetentionLimitsFromUI();
      const dry = enforceRollingHistory(db, { dryRun: true, limits });
      const totalWillPrune = dry.prunedLog + dry.prunedSnaps + dry.prunedDumps + dry.orphansRemoved;
      if (totalWillPrune > 0 && typeof ppConfirmAction === 'function') {
        const ok = await ppConfirmAction({
          title: 'Archive & Prune Retired History?',
          message: `Export ${dry.prunedSnaps} snapshot(s), ${dry.prunedLog} change log entry(ies), and ${dry.prunedDumps} dump record(s) to an archive file, then permanently prune them from the active database?`,
          confirmLabel: 'Archive & Prune',
          tone: 'amber',
        });
        if (!ok) return;
      }
      if (dry.retiredArchive) {
        const hasEnc = !ui.demoMode && typeof ppSyncPassphrase === 'string' && ppSyncPassphrase.length >= 8 && typeof encryptPulsePlanData === 'function';
        const archiveJson = hasEnc
          ? JSON.stringify(await encryptPulsePlanData(dry.retiredArchive, ppSyncPassphrase), null, 2)
          : JSON.stringify(dry.retiredArchive, null, 2);
        const fname = `pulseplan_retired_history_${hasEnc ? 'enc_' : ''}${new Date().toISOString().slice(0, 10)}.json`;
        const outcome = await shareOrDownloadFile(new Blob([archiveJson], { type: 'application/json' }), fname, 'application/json', 'PulsePlan Retired History Archive');
        if (outcome === 'cancelled') return;
        recordDumpEvent('ARCHIVE', fname, archiveJson.length, `${hasEnc ? 'AES-256-GCM · ' : ''}Archived ${dry.prunedSnaps} snaps, ${dry.prunedLog} logs, ${dry.prunedDumps} dumps`);
      }
      executeCompactDatabaseNow(limits);
    }

    function clearDumpHistory() {
      const db = getActiveDB();
      if (!db.dumpHistory || db.dumpHistory.length === 0) return;
      openConfirmModal('Clear Rolling Dump History', `Clear all ${db.dumpHistory.length} entries from the rolling dump log? Your roadmap data and snapshots will not be affected.`, 'Clear Log', () => {
        db.dumpHistory = [];
        touchDBAndSave();
        renderSyncTab();
        showToast('Dump history cleared', 'info');
      });
    }

    function toggleSnapshotPin(id) {
      const db = getActiveDB();
      const snap = db.snapshots.find(s => s.id === id);
      if (!snap) return;
      snap.pinned = !snap.pinned;
      touchDBAndSave();
      renderAll();
      showToast(snap.pinned ? `Pinned "${snap.name}" (protected from rolling eviction)` : `Unpinned "${snap.name}"`, 'info');
    }

    function toggleAutoSave(checked) {
      ui.autoSaveToFile = checked;
      persistUIPrefs();
      showToast(checked ? 'Auto-save enabled' : 'Auto-save paused', 'info');
    }

    function toggleAutoReload(checked) {
      ui.autoReloadFromFile = checked;
      persistUIPrefs();
      updateSyncStatusUI();
      if (ui.activeTab === 'sync') renderSyncTab();
      if (checked && linkedFileHandle) checkExternalFileUpdates();
      showToast(
        checked
          ? 'Auto-reload enabled — team updates will load automatically'
          : 'Auto-reload paused — banner will prompt before reloading',
        'info'
      );
    }

    function setPollInterval(val) {
      ui.pollIntervalMs = parseInt(val, 10) || 0;
      persistUIPrefs();
      startFilePolling();
      showToast(ui.pollIntervalMs ? `Checking shared file every ${ui.pollIntervalMs / 1000}s` : 'Auto-polling disabled', 'info');
    }

