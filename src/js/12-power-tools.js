    /* ============================================================================
     * 14. POWER TOOLS: SHIFT PROJECT, HOLIDAYS, WHAT-IF, SAVED VIEWS, CSV IMPORT
     * ============================================================================ */

    /* ---------- 14A. Shift Project Schedule (±N Weeks / Months) ---------- */

    function shiftISODateByMonths(isoDate, deltaMonths) {
      if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
      const d = parseISODate(isoDate);
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + (parseInt(deltaMonths, 10) || 0));
      const maxDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, maxDay));
      return dateToISODate(d);
    }

    function computeWeekDeltaForMonthShift(anchorWeekKey, deltaMonths) {
      const srcMonth = getWeekOwningMonth(anchorWeekKey);
      const dstMonth = addMonthsToMonthKey(srcMonth, deltaMonths);
      const srcWks = getWeeksInMonth(srcMonth);
      const dstWks = getWeeksInMonth(dstMonth);
      const srcMon = isoWeekKeyToMonday(srcWks[0] || anchorWeekKey);
      const dstMon = isoWeekKeyToMonday(dstWks[0] || anchorWeekKey);
      return Math.round((dstMon - srcMon) / (7 * 86400000));
    }

    function shiftProjectSchedule(projId, delta, unit = 'week', opts = {}, db = getActiveDB()) {
      const shiftNum = parseInt(delta, 10) || 0;
      if (!projId || shiftNum === 0 || !db) return { movedAllocs: 0, movedComments: 0, movedMilestones: 0 };

      const shiftMilestones = opts.shiftMilestones !== false;
      const shiftBaseline = Boolean(opts.shiftBaseline);
      const shiftComments = opts.shiftComments !== false;

      // Collect existing project allocations
      const projAllocEntries = [];
      Object.entries(db.allocations || {}).forEach(([k, v]) => {
        const parts = k.split('::');
        if (parts[1] === projId && /^\d{4}-W\d{2}$/.test(parts[2])) {
          projAllocEntries.push({ key: k, deptId: parts[0], weekKey: parts[2], fte: Number(v) || 0 });
        }
      });

      // Compute exact lossless week delta (1-to-1 bijection across ISO weeks)
      let weekDelta = shiftNum;
      if (unit === 'month') {
        const sortedWks = projAllocEntries.map(e => e.weekKey).sort();
        const anchorWk = sortedWks[0] || ui.startWeek || getCurrentWeekKey();
        weekDelta = computeWeekDeltaForMonthShift(anchorWk, shiftNum);
      }

      // Remove old allocation keys first so overlapping shifts never clobber newly written keys
      projAllocEntries.forEach(e => { delete db.allocations[e.key]; });
      projAllocEntries.forEach(e => {
        const targetWk = addWeeksToWeekKey(e.weekKey, weekDelta);
        db.allocations[`${e.deptId}::${projId}::${targetWk}`] = e.fte;
      });

      let movedComments = 0;
      if (shiftComments && db.comments) {
        const projCommentEntries = [];
        Object.entries(db.comments).forEach(([k, text]) => {
          const parts = k.split('::');
          if (parts[1] === projId && parts[2]) {
            projCommentEntries.push({ key: k, deptId: parts[0], periodKey: parts[2], text });
          }
        });
        projCommentEntries.forEach(e => { delete db.comments[e.key]; });
        projCommentEntries.forEach(e => {
          let targetPk = e.periodKey;
          if (/^\d{4}-W\d{2}$/.test(e.periodKey)) {
            targetPk = addWeeksToWeekKey(e.periodKey, weekDelta);
          } else if (/^\d{4}-\d{2}$/.test(e.periodKey)) {
            targetPk = unit === 'month'
              ? addMonthsToMonthKey(e.periodKey, shiftNum)
              : getWeekOwningMonth(addWeeksToWeekKey(getWeeksInMonth(e.periodKey)[0] || getCurrentWeekKey(), weekDelta));
          }
          db.comments[`${e.deptId}::${projId}::${targetPk}`] = e.text;
          movedComments++;
        });
      }

      let movedMilestones = 0;
      if (shiftMilestones && Array.isArray(db.milestones)) {
        db.milestones.forEach(m => {
          if (m.projectId !== projId) return;
          if (m.date) {
            m.date = unit === 'month' ? shiftISODateByMonths(m.date, shiftNum) : addDaysToISODate(m.date, shiftNum * 7);
            movedMilestones++;
          }
          if (shiftBaseline && m.baselineDate) {
            m.baselineDate = unit === 'month' ? shiftISODateByMonths(m.baselineDate, shiftNum) : addDaysToISODate(m.baselineDate, shiftNum * 7);
          }
        });
      }

      return { movedAllocs: projAllocEntries.length, movedComments, movedMilestones, weekDelta };
    }

    function openShiftProjectModal(projId) {
      const db = getActiveDB();
      const p = db.projects.find(x => x.id === projId);
      if (!p) return;

      const allocCount = Object.keys(db.allocations || {}).filter(k => k.split('::')[1] === projId).length;
      const msCount = (db.milestones || []).filter(m => m.projectId === projId).length;
      const cmtCount = Object.keys(db.comments || {}).filter(k => k.split('::')[1] === projId).length;

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Shift Project Schedule</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">Move all allocations, notes, and milestones for <strong>[${escapeHtml(p.code)}] ${escapeHtml(p.name)}</strong> together.</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          <input type="hidden" id="mShiftProjId" value="${p.id}" />

          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-700">
            <span><strong>${allocCount}</strong> weekly allocation${allocCount === 1 ? '' : 's'}</span>
            <span class="text-slate-300">|</span>
            <span><strong>${msCount}</strong> milestone${msCount === 1 ? '' : 's'}</span>
            <span class="text-slate-300">|</span>
            <span><strong>${cmtCount}</strong> cell comment${cmtCount === 1 ? '' : 's'}</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mShiftDelta" class="block font-semibold text-slate-700 mb-1">Shift Amount (+ delay / &minus; pull forward)</label>
              <div class="flex items-center gap-1.5">
                <button type="button" aria-label="Decrease shift" onclick="stepNumericInput('mShiftDelta', -1, -52, 52, 0)"
                  class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base shrink-0">&minus;</button>
                <input id="mShiftDelta" type="number" inputmode="numeric" min="-52" max="52" step="1" value="1"
                  class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
                <button type="button" aria-label="Increase shift" onclick="stepNumericInput('mShiftDelta', 1, -52, 52, 0)"
                  class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base shrink-0">+</button>
              </div>
            </div>
            <div>
              <label for="mShiftUnit" class="block font-semibold text-slate-700 mb-1">Time Unit</label>
              <select id="mShiftUnit" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold">
                <option value="week" ${ui.timeUnit === 'week' ? 'selected' : ''}>ISO Weeks</option>
                <option value="month" ${ui.timeUnit === 'month' ? 'selected' : ''}>Calendar Months</option>
              </select>
            </div>
          </div>

          <div class="space-y-2 pt-1">
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input id="mShiftMilestones" type="checkbox" checked class="rounded text-indigo-600" />
              <span class="font-semibold text-slate-700">Shift project milestone target dates</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input id="mShiftBaseline" type="checkbox" class="rounded text-indigo-600" />
              <span class="text-slate-600">Also shift milestone baseline dates <span class="text-slate-400">(unchecked preserves slip drift tracking)</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input id="mShiftComments" type="checkbox" checked class="rounded text-indigo-600" />
              <span class="font-semibold text-slate-700">Shift cell comments along with allocations</span>
            </label>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button type="button" onclick="applyShiftProjectModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Shift Schedule</button>
          </div>
        </div>`, 'max-w-md');
    }

    function applyShiftProjectModal() {
      const db = getActiveDB();
      const projId = document.getElementById('mShiftProjId')?.value;
      const delta = parseInt(document.getElementById('mShiftDelta')?.value, 10) || 0;
      const unit = document.getElementById('mShiftUnit')?.value === 'month' ? 'month' : 'week';
      const shiftMilestones = Boolean(document.getElementById('mShiftMilestones')?.checked);
      const shiftBaseline = Boolean(document.getElementById('mShiftBaseline')?.checked);
      const shiftComments = Boolean(document.getElementById('mShiftComments')?.checked);

      if (!delta) { showToast('Enter a non-zero shift amount (e.g. +2 or -1).', 'warning'); return; }
      const p = db.projects.find(x => x.id === projId);
      if (!p) return;

      const signStr = delta > 0 ? `+${delta}` : String(delta);
      const unitLbl = `${unit}${Math.abs(delta) === 1 ? '' : 's'}`;
      pushUndoState(`Shift [${p.code}] by ${signStr} ${unitLbl}`);
      const res = shiftProjectSchedule(projId, delta, unit, { shiftMilestones, shiftBaseline, shiftComments }, db);
      recordChange('Project', `Shifted [${p.code}] ${p.name} by ${signStr} ${unitLbl} (${res.movedAllocs} alloc wks, ${res.movedMilestones} milestones)`);
      closeModal();
      renderAll();
      showToast(`Shifted [${p.code}] by ${signStr} ${unitLbl} (${res.movedAllocs} weeks, ${res.movedMilestones} milestones)`, 'success', { undoable: true });
    }

    /* ---------- 14B. Company-Wide Holiday / Shutdown Capacity Factor ---------- */

    function applyHolidayFactor(deptIds, startPk, count, timeUnit, pctFactor, db = getActiveDB()) {
      const cleanPct = Math.max(0, Math.min(200, Number(pctFactor)));
      const numPeriods = Math.max(1, Math.min(52, parseInt(count, 10) || 1));
      const targets = (db.departments || []).filter(d => deptIds.includes(d.id));
      let updatedWeeks = 0;

      let curPk = startPk;
      for (let i = 0; i < numPeriods; i++) {
        const wks = timeUnit === 'month' ? getWeeksInMonth(curPk) : [curPk];
        wks.forEach(wk => {
          targets.forEach(d => {
            const key = `${d.id}::${wk}`;
            if (Math.abs(cleanPct - 100) < 0.01) {
              delete db.capacityOverrides[key];
            } else {
              const scaled = Math.round(((Number(d.defaultCapacity) || 0) * (cleanPct / 100)) * 20) / 20;
              db.capacityOverrides[key] = Math.max(0, scaled);
            }
            updatedWeeks++;
          });
        });
        curPk = timeUnit === 'month' ? addMonthsToMonthKey(curPk, 1) : addWeeksToWeekKey(curPk, 1);
      }
      return { updatedWeeks, deptCount: targets.length };
    }

    function openHolidayFactorModal(prePeriod = '', opts = {}) {
      openPeriodCapacityModal(prePeriod, { ...opts, initialMode: 'holiday' });
    }

    function syncPeriodCapEndOptions(preferredEndPk = '') {
      const startEl = document.getElementById('mHolStart');
      const endEl = document.getElementById('mHolEnd');
      const unitEl = document.getElementById('mHolTimeUnit');
      const sumEl = document.getElementById('mHolRangeSummary');
      if (!startEl || !endEl || !unitEl) return;
      const unit = unitEl.value === 'month' ? 'month' : 'week';
      const startPk = startEl.value;
      let targetEnd = preferredEndPk || endEl.value || startPk;
      if (targetEnd < startPk) targetEnd = startPk;
      endEl.innerHTML = buildPeriodEndSelectOptionsHtml(startPk, unit, targetEnd, 26);
      if (sumEl) sumEl.textContent = formatPeriodRangeSummaryText(startPk, endEl.value, unit);
      syncPeriodCapDeptFte();
    }

    function updatePeriodCapSummary() {
      const startEl = document.getElementById('mHolStart');
      const endEl = document.getElementById('mHolEnd');
      const unitEl = document.getElementById('mHolTimeUnit');
      const sumEl = document.getElementById('mHolRangeSummary');
      if (!startEl || !endEl || !unitEl || !sumEl) return;
      const unit = unitEl.value === 'month' ? 'month' : 'week';
      sumEl.textContent = formatPeriodRangeSummaryText(startEl.value, endEl.value, unit);
    }

    function syncPeriodCapDeptFte() {
      const deptSel = document.getElementById('mHolDeptSelect');
      const fteInp = document.getElementById('mHolDeptFte');
      const startEl = document.getElementById('mHolStart');
      const unitEl = document.getElementById('mHolTimeUnit');
      const hintEl = document.getElementById('mHolDeptBaseHint');
      if (!deptSel || !fteInp || !startEl) return;
      const db = getActiveDB();
      const dept = db.departments.find(d => d.id === deptSel.value);
      if (!dept) return;
      const unit = unitEl?.value === 'month' ? 'month' : 'week';
      const capObj = getDeptCapacityForPeriod(dept.id, startEl.value, unit, db);
      fteInp.value = String(Math.round(capObj.avgFte * 100) / 100);
      if (hintEl) {
        hintEl.textContent = capObj.hasOverride
          ? `Base: ${dept.defaultCapacity} FTE • Current start override: ${Math.round(capObj.avgFte * 100) / 100} FTE`
          : `Base: ${dept.defaultCapacity} FTE (no active override at start)`;
      }
    }

    function setPeriodCapacityModalMode(mode) {
      const isDept = mode === 'dept';
      const modeInp = document.getElementById('mHolMode');
      if (modeInp) modeInp.value = isDept ? 'dept' : 'holiday';
      const holPanel = document.getElementById('mHolModeHolidayPanel');
      const deptPanel = document.getElementById('mHolModeDeptPanel');
      const holFoot = document.getElementById('mHolFootHoliday');
      const deptFoot = document.getElementById('mHolFootDept');
      if (holPanel) holPanel.classList.toggle('hidden', isDept);
      if (deptPanel) deptPanel.classList.toggle('hidden', !isDept);
      if (holFoot) holFoot.classList.toggle('hidden', isDept);
      if (deptFoot) deptFoot.classList.toggle('hidden', !isDept);

      const btnHol = document.getElementById('mHolTabHoliday');
      const btnDept = document.getElementById('mHolTabDept');
      const activeCls = 'flex-1 py-2 px-3 rounded-lg bg-white text-indigo-700 font-bold shadow-xs text-xs transition cursor-pointer';
      const idleCls = 'flex-1 py-2 px-3 rounded-lg text-slate-600 hover:text-slate-900 font-semibold text-xs transition cursor-pointer';
      if (btnHol) {
        btnHol.className = isDept ? idleCls : activeCls;
        btnHol.setAttribute('aria-pressed', String(!isDept));
      }
      if (btnDept) {
        btnDept.className = isDept ? activeCls : idleCls;
        btnDept.setAttribute('aria-pressed', String(isDept));
      }
      if (isDept) syncPeriodCapDeptFte();
    }

    function setPeriodCapacityModalUnit(nextUnit) {
      const curUnit = document.getElementById('mHolTimeUnit')?.value === 'month' ? 'month' : 'week';
      const curStart = document.getElementById('mHolStart')?.value || '';
      const curMode = document.getElementById('mHolMode')?.value === 'dept' ? 'dept' : 'holiday';
      const curDeptId = document.getElementById('mHolDeptSelect')?.value || '';
      const curPct = parseFloat(document.getElementById('mHolPct')?.value);
      if (nextUnit === curUnit) return;
      let nextStart = curStart;
      if (nextUnit === 'week' && /^\d{4}-\d{2}$/.test(curStart)) {
        nextStart = getWeeksInMonth(curStart)[0] || ui.startWeek;
      } else if (nextUnit === 'month' && /^\d{4}-W\d{2}$/.test(curStart)) {
        nextStart = getWeekOwningMonth(curStart);
      }
      openPeriodCapacityModal(nextStart, {
        timeUnit: nextUnit,
        initialMode: curMode,
        deptId: curDeptId,
        pct: isNaN(curPct) ? 80 : curPct,
      });
    }

    function openPeriodCapacityModal(prePeriod = '', opts = {}) {
      const db = getActiveDB();
      if (db.departments.length === 0) {
        showToast('Add at least one Department first.', 'warning');
        return;
      }
      let effectiveUnit = opts && opts.forceWeeks ? 'week' : ((opts && (opts.timeUnit === 'week' || opts.timeUnit === 'month')) ? opts.timeUnit : ui.timeUnit);
      let startPk = prePeriod || (effectiveUnit === 'month' ? ui.startMonth : ui.startWeek);
      if (effectiveUnit === 'week' && /^\d{4}-\d{2}$/.test(startPk)) {
        startPk = getWeeksInMonth(startPk)[0] || ui.startWeek;
      } else if (effectiveUnit === 'month' && /^\d{4}-W\d{2}$/.test(startPk)) {
        effectiveUnit = 'week';
      }

      let endPk = opts && opts.endPeriod ? opts.endPeriod : startPk;
      if (!opts?.endPeriod && opts && Number(opts.count) > 1) {
        const step = Math.min(24, Math.max(1, parseInt(opts.count, 10) || 1)) - 1;
        endPk = effectiveUnit === 'month' ? addMonthsToMonthKey(startPk, step) : addWeeksToWeekKey(startPk, step);
      }
      if (endPk < startPk) endPk = startPk;

      const initialMode = opts && opts.initialMode === 'dept' ? 'dept' : 'holiday';
      const initPct = (opts && opts.pct !== undefined && !isNaN(Number(opts.pct))) ? Math.max(0, Math.min(200, Math.round(Number(opts.pct)))) : 80;
      const initDeptId = (opts && opts.deptId && db.departments.some(d => d.id === opts.deptId))
        ? opts.deptId
        : ((ui.filterDept && ui.filterDept !== 'all' && db.departments.some(d => d.id === ui.filterDept)) ? ui.filterDept : db.departments[0].id);
      const initDept = db.departments.find(d => d.id === initDeptId) || db.departments[0];
      const initDeptCap = getDeptCapacityForPeriod(initDept.id, startPk, effectiveUnit, db);

      const startOpts = buildPeriodSelectOptions(startPk, effectiveUnit, 12, 36);
      const endOptsHtml = buildPeriodEndSelectOptionsHtml(startPk, effectiveUnit, endPk, 26);
      const summaryTxt = formatPeriodRangeSummaryText(startPk, endPk, effectiveUnit);

      const preCheckedSet = (opts && Array.isArray(opts.deptIds) && opts.deptIds.length > 0) ? new Set(opts.deptIds) : null;
      const deptChecks = db.departments.map(d => `
        <label class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer text-xs font-semibold text-slate-700">
          <input type="checkbox" data-holiday-dept="1" class="rounded text-indigo-600" value="${d.id}" ${!preCheckedSet || preCheckedSet.has(d.id) ? 'checked' : ''} />
          <span class="w-2 h-2 rounded-full shrink-0" style="background:${d.color}"></span>
          <span>${escapeHtml(d.code)}</span>
        </label>`).join('');

      const unitBtnCls = (active) => active
        ? 'px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-bold shadow-xs text-[11px] transition cursor-pointer'
        : 'px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 font-semibold text-[11px] transition cursor-pointer';
      const isDeptMode = initialMode === 'dept';
      const activeTabCls = 'flex-1 py-2 px-3 rounded-lg bg-white text-indigo-700 font-bold shadow-xs text-xs transition cursor-pointer';
      const idleTabCls = 'flex-1 py-2 px-3 rounded-lg text-slate-600 hover:text-slate-900 font-semibold text-xs transition cursor-pointer';

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Variable Capacity &amp; Holidays</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">Define either a company-wide holiday / shutdown percentage or a momentary FTE override for a specific department.</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none shrink-0">&times;</button>
          </div>

          <input type="hidden" id="mHolMode" value="${initialMode}" />
          <input type="hidden" id="mHolTimeUnit" value="${effectiveUnit}" />

          <!-- Mode Switcher: Company Holiday / % Scale vs Momentary Dept FTE Override -->
          <div class="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200 gap-1" role="group" aria-label="Capacity override mode">
            <button id="mHolTabHoliday" type="button" aria-pressed="${!isDeptMode}" onclick="setPeriodCapacityModalMode('holiday')" class="${isDeptMode ? idleTabCls : activeTabCls}">Company Holiday / %</button>
            <button id="mHolTabDept" type="button" aria-pressed="${isDeptMode}" onclick="setPeriodCapacityModalMode('dept')" class="${isDeptMode ? activeTabCls : idleTabCls}">Dept FTE Override</button>
          </div>

          <!-- Granularity + Start & End Period Pickers (with calendar dates) -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-semibold text-slate-700">Override Granularity</span>
            <div class="inline-flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200" role="group" aria-label="Period granularity">
              <button type="button" onclick="setPeriodCapacityModalUnit('week')" class="${unitBtnCls(effectiveUnit === 'week')}">ISO Weeks</button>
              <button type="button" onclick="setPeriodCapacityModalUnit('month')" class="${unitBtnCls(effectiveUnit === 'month')}">Months</button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mHolStart" class="block font-semibold text-slate-700 mb-1">Start ${effectiveUnit === 'month' ? 'Month' : 'ISO Week'}</label>
              <select id="mHolStart" onchange="syncPeriodCapEndOptions()" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${startOpts.map(o => `<option value="${o.key}" ${o.key === startPk ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="mHolEnd" class="block font-semibold text-slate-700 mb-1">End ${effectiveUnit === 'month' ? 'Month' : 'ISO Week'}</label>
              <select id="mHolEnd" onchange="updatePeriodCapSummary()" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${endOptsHtml}
              </select>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px]">
            <span class="text-slate-500 font-semibold">Selected Span</span>
            <span id="mHolRangeSummary" class="font-mono font-bold text-slate-800">${escapeHtml(summaryTxt)}</span>
          </div>

          <!-- Panel A: Company Holiday / Shutdown % -->
          <div id="mHolModeHolidayPanel" class="${isDeptMode ? 'hidden' : ''} space-y-3">
            <div>
              <label for="mHolPct" class="block font-semibold text-slate-700 mb-1">Available Capacity Factor (%)</label>
              <div class="flex flex-wrap items-center gap-1.5 mb-2">
                <button type="button" onclick="document.getElementById('mHolPct').value='0'" class="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[11px]">0% Shutdown</button>
                <button type="button" onclick="document.getElementById('mHolPct').value='50'" class="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold text-[11px]">50% Half-Week</button>
                <button type="button" onclick="document.getElementById('mHolPct').value='80'" class="px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 font-bold text-[11px]">80% 4-Day Wk</button>
                <button type="button" onclick="document.getElementById('mHolPct').value='100'" class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[11px]">100% Reset</button>
              </div>
              <input id="mHolPct" type="number" inputmode="numeric" min="0" max="200" step="5" value="${initPct}" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold" />
            </div>
            <div>
              <div class="font-semibold text-slate-700 mb-1.5">Departments</div>
              <div class="flex flex-wrap gap-1.5">${deptChecks}</div>
            </div>
          </div>

          <!-- Panel B: Momentary Specific Department FTE Override -->
          <div id="mHolModeDeptPanel" class="${isDeptMode ? '' : 'hidden'} space-y-3">
            <div>
              <label for="mHolDeptSelect" class="block font-semibold text-slate-700 mb-1">Department</label>
              <select id="mHolDeptSelect" onchange="syncPeriodCapDeptFte()" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold">
                ${db.departments.map(d => `<option value="${d.id}" ${d.id === initDept.id ? 'selected' : ''}>${escapeHtml(d.name)} [${escapeHtml(d.code)}] — Base ${d.defaultCapacity} FTE</option>`).join('')}
              </select>
              <div id="mHolDeptBaseHint" class="text-[11px] text-slate-500 mt-1">
                ${initDeptCap.hasOverride
                  ? `Base: ${initDept.defaultCapacity} FTE &bull; Current start override: ${Math.round(initDeptCap.avgFte * 100) / 100} FTE`
                  : `Base: ${initDept.defaultCapacity} FTE (no active override at start)`}
              </div>
            </div>
            <div>
              <label for="mHolDeptFte" class="block font-semibold text-slate-700 mb-1">Overridden Capacity (FTE Rate)</label>
              <div class="flex items-center gap-1.5">
                <button type="button" aria-label="Decrease FTE" onclick="stepNumericInput('mHolDeptFte', -0.25, 0, 1000, 2)"
                  class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">&minus;</button>
                <input id="mHolDeptFte" type="number" inputmode="decimal" step="0.25" min="0" value="${Math.round(initDeptCap.avgFte * 100) / 100}"
                  class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
                <button type="button" aria-label="Increase FTE" onclick="stepNumericInput('mHolDeptFte', 0.25, 0, 1000, 2)"
                  class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">+</button>
              </div>
            </div>
          </div>

          <!-- Footers -->
          <div id="mHolFootHoliday" class="${isDeptMode ? 'hidden' : ''} flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button type="button" onclick="applyHolidayFactorModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Apply Capacity Factor</button>
          </div>
          <div id="mHolFootDept" class="${isDeptMode ? '' : 'hidden'} flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="resetPeriodDeptCapacityModal()" class="px-3 py-2 rounded-xl text-amber-700 hover:bg-amber-50 font-semibold transition">Reset Range to Base</button>
            <div class="flex items-center gap-2">
              <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
              <button type="button" onclick="applyPeriodDeptCapacityModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Save Dept Capacity</button>
            </div>
          </div>
        </div>`, 'max-w-xl');
    }

    function applyHolidayFactorModal() {
      const db = getActiveDB();
      const startPk = document.getElementById('mHolStart')?.value;
      const endPk = document.getElementById('mHolEnd')?.value || startPk;
      const effectiveUnit = document.getElementById('mHolTimeUnit')?.value === 'week' ? 'week' : (document.getElementById('mHolTimeUnit')?.value === 'month' ? 'month' : ui.timeUnit);
      const pks = collectPeriodKeysInRange(startPk, endPk, effectiveUnit);
      const count = Math.max(1, Math.min(52, pks.length));
      const pct = parseFloat(document.getElementById('mHolPct')?.value);
      const deptIds = [...document.querySelectorAll('input[data-holiday-dept]:checked')].map(el => el.value);

      if (isNaN(pct) || pct < 0 || pct > 200) { showToast('Enter a percentage between 0 and 200.', 'warning'); return; }
      if (deptIds.length === 0) { showToast('Select at least one department.', 'warning'); return; }

      pushUndoState(`Apply ${pct}% capacity factor`);
      const res = applyHolidayFactor(deptIds, startPk, count, effectiveUnit, pct, db);
      const spanTxt = pks.length > 1 ? `${pks[0]} → ${pks[pks.length - 1]}` : startPk;
      recordChange('Capacity', `Applied ${pct}% capacity factor to ${res.deptCount} dept(s) (${spanTxt})`);
      closeModal();
      renderAll();
      showToast(`Updated capacity for ${res.deptCount} department${res.deptCount === 1 ? '' : 's'} (${pct}%)`, 'success', { undoable: true });
    }

    function applyPeriodDeptCapacityModal() {
      const db = getActiveDB();
      const deptId = document.getElementById('mHolDeptSelect')?.value;
      const startPk = document.getElementById('mHolStart')?.value;
      const endPk = document.getElementById('mHolEnd')?.value || startPk;
      const effectiveUnit = document.getElementById('mHolTimeUnit')?.value === 'week' ? 'week' : 'month';
      const val = parseFloat(document.getElementById('mHolDeptFte')?.value);

      if (!deptId) { showToast('Select a department.', 'warning'); return; }
      if (isNaN(val) || val < 0) { showToast('Enter a valid FTE capacity.', 'warning'); return; }

      const pks = collectPeriodKeysInRange(startPk, endPk, effectiveUnit);
      if (pks.length === 0) return;

      const dept = db.departments.find(d => d.id === deptId);
      pushUndoState(`Update ${dept?.name || deptId} capacity`);
      pks.forEach(pk => {
        const wks = effectiveUnit === 'month' ? getWeeksInMonth(pk) : [pk];
        wks.forEach(wk => { db.capacityOverrides[`${deptId}::${wk}`] = val; });
      });
      const spanTxt = pks.length > 1 ? `${pks[0]} → ${pks[pks.length - 1]}` : pks[0];
      recordChange('Capacity', `${dept?.name || deptId} capacity set to ${val} FTE (${spanTxt})`);
      closeModal();
      renderAll();
      showToast(`Updated ${dept?.code || deptId} capacity to ${val} FTE (${pks.length} ${effectiveUnit}${pks.length === 1 ? '' : 's'})`, 'success', { undoable: true });
    }

    function resetPeriodDeptCapacityModal() {
      const db = getActiveDB();
      const deptId = document.getElementById('mHolDeptSelect')?.value;
      const startPk = document.getElementById('mHolStart')?.value;
      const endPk = document.getElementById('mHolEnd')?.value || startPk;
      const effectiveUnit = document.getElementById('mHolTimeUnit')?.value === 'week' ? 'week' : 'month';
      const pks = collectPeriodKeysInRange(startPk, endPk, effectiveUnit);
      if (!deptId || pks.length === 0) return;

      const dept = db.departments.find(d => d.id === deptId);
      const spanTxt = pks.length > 1 ? `${pks[0]} → ${pks[pks.length - 1]}` : pks[0];
      openConfirmModal(
        'Reset Capacity Overrides',
        `Delete custom capacity overrides for "${dept?.name || deptId}" across ${spanTxt} and revert to base ${dept?.defaultCapacity ?? ''} FTE?`,
        'Reset to Base',
        () => {
          pushUndoState(`Reset ${dept?.name || deptId} capacity`);
          pks.forEach(pk => {
            const wks = effectiveUnit === 'month' ? getWeeksInMonth(pk) : [pk];
            wks.forEach(wk => { delete db.capacityOverrides[`${deptId}::${wk}`]; });
          });
          recordChange('Capacity', `Reset ${dept?.name || deptId} capacity override (${spanTxt}) back to base`);
          closeModal();
          renderAll();
          showToast(`Reset ${dept?.code || deptId} capacity to base ${dept?.defaultCapacity ?? ''} FTE`, 'info', { undoable: true });
        }
      );
    }

    /* ---------- 14C. What-If Scenario Mode (Clone Live DB Safely) ---------- */

    function computeWhatIfDeltaSummary() {
      if (!whatIfDB || !liveDB) return 'Testing changes on a temporary clone of your Live DB.';
      const liveA = liveDB.allocations || {};
      const wiA = whatIfDB.allocations || {};
      const allKeys = new Set([...Object.keys(liveA), ...Object.keys(wiA)]);
      let changedAllocs = 0;
      let netFteWks = 0;
      allKeys.forEach(k => {
        const a = Number(liveA[k]) || 0;
        const b = Number(wiA[k]) || 0;
        if (Math.abs(a - b) > 0.001) {
          changedAllocs++;
          netFteWks += (b - a);
        }
      });

      const liveC = liveDB.capacityOverrides || {};
      const wiC = whatIfDB.capacityOverrides || {};
      const capKeys = new Set([...Object.keys(liveC), ...Object.keys(wiC)]);
      let changedCaps = 0;
      capKeys.forEach(k => {
        if (liveC[k] !== wiC[k]) changedCaps++;
      });

      if (changedAllocs === 0 && changedCaps === 0 && JSON.stringify(liveDB.milestones) === JSON.stringify(whatIfDB.milestones)) {
        return 'Cloned from Live DB — make test edits freely; your Live DB & shared file remain untouched.';
      }
      const parts = [];
      if (changedAllocs > 0) parts.push(`${changedAllocs} alloc wk${changedAllocs === 1 ? '' : 's'} (${netFteWks >= 0 ? '+' : ''}${Math.round(netFteWks * 10) / 10} FTE-wks)`);
      if (changedCaps > 0) parts.push(`${changedCaps} cap override${changedCaps === 1 ? '' : 's'}`);
      return `Sandbox diff vs. Live: ${parts.length ? parts.join(' • ') : 'metadata/milestone edits'} — Live DB untouched until Commit.`;
    }

    function enterWhatIfMode() {
      if (typeof ppIsStandardUser === 'function' && ppIsStandardUser()) {
        showToast('What-If Sandbox is restricted to Administrators.', 'warning');
        return;
      }
      if (!liveDB) return;
      ui.demoMode = false;
      whatIfDB = JSON.parse(JSON.stringify(liveDB));
      ui.whatIfMode = true;
      clearUndoHistory();
      renderAll();
      showToast('What-If Sandbox active — testing on a clone of your Live DB', 'info');
    }

    function discardWhatIfMode() {
      ui.whatIfMode = false;
      whatIfDB = null;
      clearUndoHistory();
      renderAll();
      showToast('What-If scenario discarded — Live DB restored', 'info');
    }

    function confirmDiscardWhatIfMode() {
      if (!ui.whatIfMode || !whatIfDB) {
        discardWhatIfMode();
        return;
      }
      openConfirmModal(
        'Discard What-If Sandbox?',
        'Exit What-If Mode and permanently discard all temporary sandbox edits? Your Live DB will remain unchanged.',
        'Discard Sandbox',
        () => discardWhatIfMode()
      );
    }

    function commitWhatIfToLive({ skipConfirm = false } = {}) {
      if (!whatIfDB || !ui.whatIfMode) return;
      const doCommit = () => {
        const prevLiveSnapshot = captureUndoSnapshot(liveDB);
        const preservedAccessControl = liveDB && liveDB.accessControl ? JSON.parse(JSON.stringify(liveDB.accessControl)) : null;
        const preservedFinanceVault = liveDB && liveDB.settings?.financeVault ? JSON.parse(JSON.stringify(liveDB.settings.financeVault)) : null;
        const preservedPbsFolder = liveDB && liveDB.settings?.pbsFolder ? JSON.parse(JSON.stringify(liveDB.settings.pbsFolder)) : null;
        liveDB = JSON.parse(JSON.stringify(whatIfDB));
        if (preservedAccessControl) liveDB.accessControl = preservedAccessControl;
        if (!liveDB.settings) liveDB.settings = {};
        if (preservedFinanceVault) liveDB.settings.financeVault = preservedFinanceVault;
        if (preservedPbsFolder) liveDB.settings.pbsFolder = preservedPbsFolder;
        ui.whatIfMode = false;
        whatIfDB = null;
        clearUndoHistory();
        _undoStack.push({ label: 'Commit What-If Scenario', data: prevLiveSnapshot });
        recordChange('Scenario', 'Committed What-If sandbox scenario to Live DB');
        renderAll();
        showToast('What-If scenario committed to Live DB', 'success', { undoable: true });
      };
      if (skipConfirm) {
        doCommit();
        return;
      }
      openConfirmModal(
        'Commit What-If Scenario to Live DB',
        'Apply all changes from your What-If sandbox to the Live Company Database (and sync to any linked shared file)?',
        'Commit to Live',
        doCommit,
        { tone: 'primary' }
      );
    }

    function toggleWhatIfMode() {
      if (ui.whatIfMode && whatIfDB) {
        confirmDiscardWhatIfMode();
      } else {
        enterWhatIfMode();
      }
    }

    /* ---------- 14D. Saved Views / Presets ---------- */

    function getSavedViews() {
      try {
        const raw = safeGetStorage(STORAGE_KEYS.SAVED_VIEWS);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    function persistSavedViews(list) {
      safeSetStorage(STORAGE_KEYS.SAVED_VIEWS, JSON.stringify(list.slice(0, 20)));
    }

    function openSavedViewsModal() {
      const views = getSavedViews();
      const rowsHtml = views.length === 0
        ? `<div class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-slate-500">No saved views yet. Save your current filters, horizon, row labels, and color mode below for 1-click recall.</div>`
        : views.map(v => {
            const hVal = v.state.horizon || v.state.meetingHorizon || 4;
            const uVal = v.state.timeUnit === 'week' ? (hVal === 1 ? 'Wk' : 'Wks') : (hVal === 1 ? 'Mo' : 'Mos');
            const cVal = v.state.cellColorMode || v.state.meetingCellColorMode || 'fill';
            const rLbl = v.state.compactRowLabels === false ? 'Detailed' : 'Vertical';
            return `
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="font-bold text-slate-900 truncate">${escapeHtml(v.name)}</div>
                <div class="text-[10px] text-slate-500 truncate">
                  ${v.state.axis === 'project' ? 'By Project' : v.state.axis === 'timeline' ? 'Timeline' : 'By Dept'} &bull; ${hVal} ${uVal} &bull; ${escapeHtml(cVal)} &bull; ${rLbl}${v.state.hideEmptyRows ? ' • Active Only' : ''}${v.state.includeTentative === false ? ' • Committed Only' : ''}
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button type="button" onclick="applySavedViewPreset('${v.id}')" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition">Load</button>
                <button type="button" onclick="deleteSavedViewPreset('${v.id}')" class="px-2 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 font-semibold text-[11px] transition">Delete</button>
              </div>
            </div>`;
          }).join('');

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Saved Views &amp; Presets</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">Bookmark filter combinations, horizons, row label styles, and card colours for instant switching.</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          <div class="flex items-center gap-2">
            <label for="mSavedViewName" class="sr-only">New view preset name</label>
            <input id="mSavedViewName" type="text" placeholder="e.g. Steering Committee 2W, Eng Bottlenecks..."
              onkeydown="if(event.key==='Enter'){event.preventDefault();saveCurrentViewPreset();}"
              class="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-800" />
            <button type="button" onclick="saveCurrentViewPreset()" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shrink-0">Save Current</button>
          </div>

          <div class="space-y-2 max-h-64 overflow-y-auto">${rowsHtml}</div>
        </div>`, 'max-w-md');
    }

    function saveCurrentViewPreset() {
      const name = (document.getElementById('mSavedViewName')?.value || '').trim();
      if (!name) { showToast('Enter a name for this view preset.', 'warning'); return; }
      const list = getSavedViews();
      list.unshift({
        id: uid('view'),
        name,
        createdAt: new Date().toISOString(),
        state: {
          axis: ui.axis,
          timeUnit: ui.timeUnit,
          manpowerUnit: ui.manpowerUnit,
          horizon: ui.horizon,
          cellColorMode: ui.cellColorMode,
          compactRowLabels: ui.compactRowLabels,
          noteSize: ui.noteSize,
          filterDept: ui.filterDept,
          filterProj: ui.filterProj,
          hideEmptyRows: ui.hideEmptyRows,
          includeTentative: ui.includeTentative,
          filterOverOnly: ui.filterOverOnly,
          filterAtRiskOnly: ui.filterAtRiskOnly,
          filterHasNotesOnly: ui.filterHasNotesOnly,
          spotlightProjId: ui.spotlightProjId,
          showCellComments: ui.showCellComments,
        },
      });
      persistSavedViews(list);
      openSavedViewsModal();
      renderAll();
      showToast(`Saved view "${name}"`, 'success');
    }

    function applySavedViewPreset(id) {
      const view = getSavedViews().find(v => v.id === id);
      if (!view || !view.state) return;
      const st = { ...view.state };
      if (st.meetingMode && st.meetingHorizon && st.horizon === undefined) st.horizon = st.meetingHorizon;
      if (st.meetingMode && st.meetingCellColorMode && st.cellColorMode === undefined) st.cellColorMode = st.meetingCellColorMode;
      delete st.meetingMode;
      delete st.meetingHorizon;
      delete st.meetingCellColorMode;
      Object.assign(ui, st, { activeTab: 'matrix' });
      persistUIPrefs();
      closeModal();
      renderAll();
      showToast(`Loaded view "${view.name}"`, 'info');
    }

    function deleteSavedViewPreset(id) {
      const views = getSavedViews();
      const target = views.find(v => v.id === id);
      if (!target) return;
      openConfirmModal(
        'Delete Saved View',
        `Permanently delete saved view preset "${target.name}"?`,
        'Delete View',
        () => {
          const list = getSavedViews().filter(v => v.id !== id);
          persistSavedViews(list);
          openSavedViewsModal();
          renderAll();
          showToast(`Deleted saved view "${target.name}"`, 'info');
        }
      );
    }

    /* ---------- 14E. Print Slide Export (Always Light Mode, Full-Width Fit) ---------- */

    function printMeetingSlide() {
      const root = document.documentElement;
      const wasDark = root.classList.contains('dark');
      const table = document.querySelector('#matrixWrapper table[data-period-count]');

      // Always print in crisp Light Mode and fit 100% of columns onto the landscape page
      if (wasDark) root.classList.remove('dark');
      root.classList.add('print-meeting-slide');
      if (table) {
        table.style.width = '100%';
        const stickyCol = table.querySelector('colgroup col[data-sticky-col]');
        if (stickyCol) stickyCol.style.width = ui.compactRowLabels ? '56px' : '150px';
        table.querySelectorAll('colgroup col[data-period-col]').forEach(col => {
          col.style.width = 'auto';
        });
      }

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        root.classList.remove('print-meeting-slide');
        if (wasDark) root.classList.add('dark');
        if (typeof applyMatrixFullColumnWidths === 'function') applyMatrixFullColumnWidths();
        if (typeof syncMatrixFloatingHeaderMetrics === 'function') syncMatrixFloatingHeaderMetrics();
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      setTimeout(() => {
        window.print();
        setTimeout(cleanup, 2000);
      }, 60);
    }

    /* ---------- 14F. Multi-Mode Paste from Excel / CSV Importer ---------- */

    function parseDelimitedAllocations(rawText, unit = 'fte', db = getActiveDB()) {
      const lines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      const valid = [];
      const errors = [];

      const findDept = (token) => {
        const t = token.trim().toLowerCase();
        return (db.departments || []).find(d => d.code.toLowerCase() === t || d.name.toLowerCase() === t || d.id.toLowerCase() === t) || null;
      };
      const findProj = (token) => {
        const t = token.trim().toLowerCase();
        return (db.projects || []).find(p => p.code.toLowerCase() === t || p.name.toLowerCase() === t || p.id.toLowerCase() === t) || null;
      };

      lines.forEach((line, idx) => {
        const sep = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : ',');
        const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 4) {
          errors.push({ line: idx + 1, raw: line, reason: 'Expected 4 columns: Dept, Project, Period, Value' });
          return;
        }
        // Skip header row automatically
        const numVal = parseFloat(cols[3].replace(',', '.'));
        if (idx === 0 && isNaN(numVal)) return;

        const dept = findDept(cols[0]);
        const proj = findProj(cols[1]);
        const pInfo = normalizeWeekKeyFormat(cols[2]);
        if (!dept) { errors.push({ line: idx + 1, raw: line, reason: `Unknown department "${cols[0]}"` }); return; }
        if (!proj) { errors.push({ line: idx + 1, raw: line, reason: `Unknown project "${cols[1]}"` }); return; }
        if (!pInfo) { errors.push({ line: idx + 1, raw: line, reason: `Invalid period "${cols[2]}" (use YYYY-MM or YYYY-Www)` }); return; }
        if (isNaN(numVal) || numVal < 0) { errors.push({ line: idx + 1, raw: line, reason: `Invalid value "${cols[3]}"` }); return; }

        const fte = displayValueToFte(numVal, pInfo.key, pInfo.kind, unit);
        valid.push({
          line: idx + 1,
          deptId: dept.id, deptCode: dept.code,
          projId: proj.id, projCode: proj.code,
          periodKey: pInfo.key, timeUnit: pInfo.kind,
          rawVal: numVal, unit, fte,
        });
      });

      return { valid, errors };
    }

    function parseDelimitedCapacities(rawText, unit = 'fte', db = getActiveDB()) {
      const lines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      const valid = [];
      const errors = [];
      const findDept = (token) => {
        const t = token.trim().toLowerCase();
        return (db.departments || []).find(d => d.code.toLowerCase() === t || d.name.toLowerCase() === t || d.id.toLowerCase() === t) || null;
      };

      lines.forEach((line, idx) => {
        const sep = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : ',');
        const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 3) {
          errors.push({ line: idx + 1, raw: line, reason: 'Expected 3 columns: Dept, Period, Capacity' });
          return;
        }
        const numVal = parseFloat(cols[2].replace(',', '.'));
        if (idx === 0 && isNaN(numVal)) return;

        const dept = findDept(cols[0]);
        const pInfo = normalizeWeekKeyFormat(cols[1]);
        if (!dept) { errors.push({ line: idx + 1, raw: line, reason: `Unknown department "${cols[0]}"` }); return; }
        if (!pInfo) { errors.push({ line: idx + 1, raw: line, reason: `Invalid period "${cols[1]}" (use YYYY-MM or YYYY-Www)` }); return; }
        if (isNaN(numVal) || numVal < 0) { errors.push({ line: idx + 1, raw: line, reason: `Invalid capacity "${cols[2]}"` }); return; }

        const fte = Math.round(displayValueToFte(numVal, pInfo.key, pInfo.kind, unit) * 1000) / 1000;
        valid.push({
          line: idx + 1,
          deptId: dept.id, deptCode: dept.code,
          periodKey: pInfo.key, timeUnit: pInfo.kind,
          rawVal: numVal, unit, fte,
        });
      });

      return { valid, errors };
    }

    function parseDelimitedMilestones(rawText, db = getActiveDB()) {
      const lines = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      const valid = [];
      const errors = [];
      const findDept = (token) => {
        const t = (token || '').trim().toLowerCase();
        if (!t) return null;
        return (db.departments || []).find(d => d.code.toLowerCase() === t || d.name.toLowerCase() === t || d.id.toLowerCase() === t) || null;
      };
      const findProj = (token) => {
        const t = (token || '').trim().toLowerCase();
        return (db.projects || []).find(p => p.code.toLowerCase() === t || p.name.toLowerCase() === t || p.id.toLowerCase() === t) || null;
      };
      const parseIso = (s) => {
        const m = String(s || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        return m ? `${m[1]}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[3], 10))}` : '';
      };

      lines.forEach((line, idx) => {
        const sep = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : ',');
        const cols = line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 3) {
          errors.push({ line: idx + 1, raw: line, reason: 'Expected at least 3 columns: Project, Title, TargetDate (YYYY-MM-DD)' });
          return;
        }
        const dateIso = parseIso(cols[2]);
        if (idx === 0 && !dateIso && /date|target/i.test(cols[2])) return;

        const proj = findProj(cols[0]);
        const title = cols[1];
        if (!proj) { errors.push({ line: idx + 1, raw: line, reason: `Unknown project "${cols[0]}"` }); return; }
        if (!title) { errors.push({ line: idx + 1, raw: line, reason: 'Milestone title is required' }); return; }
        if (!dateIso) { errors.push({ line: idx + 1, raw: line, reason: `Invalid target date "${cols[2]}" (use YYYY-MM-DD)` }); return; }

        const baseIso = cols[3] ? (parseIso(cols[3]) || dateIso) : dateIso;
        const dept = cols[4] ? findDept(cols[4]) : null;
        const status = cols[5] && ['Pending', 'In Progress', 'At Risk', 'Completed'].includes(cols[5]) ? cols[5] : 'Pending';
        const notes = cols[6] || '';

        valid.push({
          line: idx + 1,
          projectId: proj.id, projCode: proj.code,
          deptId: dept ? dept.id : '', deptCode: dept ? dept.code : 'Auto',
          title, date: dateIso, baselineDate: baseIso, status, notes,
        });
      });

      return { valid, errors };
    }

    let _pendingCsvImportRows = [];
    let _pendingCsvImportMode = 'allocations';

    function onCsvImportModeChange() {
      const mode = document.getElementById('mCsvMode')?.value || 'allocations';
      const db = getActiveDB();
      const exDept = db.departments[0]?.code || 'ENG';
      const exProj = db.projects[0]?.code || 'NVA';
      const exPeriod = ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;
      const todayISO = new Date().toISOString().slice(0, 10);

      const unitWrap = document.getElementById('mCsvUnitWrap');
      const hintEl = document.getElementById('mCsvFormatHint');
      const inp = document.getElementById('mCsvInput');
      if (unitWrap) unitWrap.classList.toggle('hidden', mode === 'milestones');
      if (hintEl) {
        if (mode === 'capacities') {
          hintEl.innerHTML = 'Columns: <code class="font-mono">Dept, Period, Capacity</code> (e.g. <code class="font-mono">ENG, 2026-05, 9.5</code>).';
        } else if (mode === 'milestones') {
          hintEl.innerHTML = 'Columns: <code class="font-mono">Project, Title, TargetDate</code> + optional <code class="font-mono">BaselineDate, Dept, Status, Notes</code>.';
        } else {
          hintEl.innerHTML = 'Columns: <code class="font-mono">Department, Project, Period, Value</code> (matches by Code or Name; Period: <code class="font-mono">YYYY-MM</code> or <code class="font-mono">YYYY-Www</code>).';
        }
      }
      if (inp) {
        inp.placeholder = mode === 'capacities'
          ? `${exDept}, ${exPeriod}, 9.5`
          : mode === 'milestones'
            ? `${exProj}, Beta Launch, ${todayISO}, ${todayISO}, ${exDept}, Pending`
            : `${exDept}, ${exProj}, ${exPeriod}, 2.5`;
      }
      previewCsvImport();
    }

    function openCsvImportModal(defaultMode = 'allocations') {
      _pendingCsvImportRows = [];
      _pendingCsvImportMode = defaultMode;
      const db = getActiveDB();
      const exDept = db.departments[0]?.code || 'ENG';
      const exProj = db.projects[0]?.code || 'NVA';
      const exPeriod = ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Import from Excel / CSV</h3>
              <p id="mCsvFormatHint" class="text-[11px] text-slate-500 mt-0.5">Columns: <code class="font-mono">Department, Project, Period, Value</code> (matches by Code or Name; Period: <code class="font-mono">YYYY-MM</code> or <code class="font-mono">YYYY-Www</code>).</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mCsvMode" class="block font-semibold text-slate-700 mb-1">Import Target</label>
              <select id="mCsvMode" onchange="onCsvImportModeChange()" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold">
                <option value="allocations" ${defaultMode === 'allocations' ? 'selected' : ''}>Allocations (Dept, Project, Period, Value)</option>
                <option value="capacities" ${defaultMode === 'capacities' ? 'selected' : ''}>Variable Capacities (Dept, Period, Capacity)</option>
                <option value="milestones" ${defaultMode === 'milestones' ? 'selected' : ''}>Milestones (Project, Title, TargetDate...)</option>
              </select>
            </div>
            <div id="mCsvUnitWrap" class="${defaultMode === 'milestones' ? 'hidden' : ''}">
              <label for="mCsvUnit" class="block font-semibold text-slate-700 mb-1">Input Value Unit</label>
              <select id="mCsvUnit" onchange="previewCsvImport()" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold">
                <option value="fte" ${ui.manpowerUnit === 'fte' ? 'selected' : ''}>FTE (Headcount Rate)</option>
                <option value="days" ${ui.manpowerUnit === 'days' ? 'selected' : ''}>Person-Days</option>
                <option value="hours" ${ui.manpowerUnit === 'hours' ? 'selected' : ''}>Hours</option>
              </select>
            </div>
          </div>

          <div>
            <label for="mCsvInput" class="block font-semibold text-slate-700 mb-1">Paste Rows Here (Tab, Comma, or Semicolon)</label>
            <textarea id="mCsvInput" rows="6" oninput="previewCsvImport()"
              placeholder="${escapeHtml(exDept)}, ${escapeHtml(exProj)}, ${escapeHtml(exPeriod)}, 2.5"
              class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono text-xs leading-relaxed"></textarea>
          </div>

          <div id="mCsvPreviewBox" class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500">
            Paste rows above to validate and preview before importing.
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button id="btnExecuteCsvImport" type="button" disabled onclick="executeCsvImport()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold">Import Valid Rows</button>
          </div>
        </div>`, 'max-w-2xl');
      onCsvImportModeChange();
    }

    function previewCsvImport() {
      const text = document.getElementById('mCsvInput')?.value || '';
      const unit = document.getElementById('mCsvUnit')?.value || 'fte';
      const mode = document.getElementById('mCsvMode')?.value || 'allocations';
      const box = document.getElementById('mCsvPreviewBox');
      const btn = document.getElementById('btnExecuteCsvImport');
      if (!box || !btn) return;

      _pendingCsvImportMode = mode;
      if (!text.trim()) {
        _pendingCsvImportRows = [];
        btn.disabled = true;
        box.innerHTML = 'Paste rows above to validate and preview before importing.';
        return;
      }

      const db = getActiveDB();
      const parsed = mode === 'capacities'
        ? parseDelimitedCapacities(text, unit, db)
        : mode === 'milestones'
          ? parseDelimitedMilestones(text, db)
          : parseDelimitedAllocations(text, unit, db);

      const { valid, errors } = parsed;
      _pendingCsvImportRows = valid;
      btn.disabled = valid.length === 0;
      btn.textContent = valid.length > 0 ? `Import ${valid.length} Row${valid.length === 1 ? '' : 's'}` : 'Import Valid Rows';

      let previewRows = '';
      if (mode === 'capacities') {
        previewRows = valid.slice(0, 6).map(r => `
          <tr class="border-t border-slate-200/70">
            <td class="py-1 pr-2 font-mono font-bold">${escapeHtml(r.deptCode)}</td>
            <td class="py-1 pr-2 font-mono">${escapeHtml(r.periodKey)}</td>
            <td class="py-1 font-bold text-sky-700 tabular-nums">${formatValue(r.rawVal, r.unit)} (${formatValue(r.fte, 'fte')})</td>
          </tr>`).join('');
      } else if (mode === 'milestones') {
        previewRows = valid.slice(0, 6).map(r => `
          <tr class="border-t border-slate-200/70">
            <td class="py-1 pr-2 font-mono font-bold text-indigo-700">${escapeHtml(r.projCode)}</td>
            <td class="py-1 pr-2 font-bold text-slate-800">${escapeHtml(r.title)}</td>
            <td class="py-1 pr-2 font-mono">${escapeHtml(r.date)}</td>
            <td class="py-1 text-slate-500">${escapeHtml(r.deptCode)}</td>
          </tr>`).join('');
      } else {
        previewRows = valid.slice(0, 6).map(r => `
          <tr class="border-t border-slate-200/70">
            <td class="py-1 pr-2 font-mono font-bold">${escapeHtml(r.deptCode)}</td>
            <td class="py-1 pr-2 font-mono font-bold text-indigo-700">${escapeHtml(r.projCode)}</td>
            <td class="py-1 pr-2 font-mono">${escapeHtml(r.periodKey)}</td>
            <td class="py-1 font-bold tabular-nums">${formatValue(r.rawVal, r.unit)} (${formatValue(r.fte, 'fte')})</td>
          </tr>`).join('');
      }

      const errHtml = errors.length > 0
        ? `<div class="mt-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 space-y-0.5 text-[11px]">
             <div class="font-bold">${errors.length} row${errors.length === 1 ? '' : 's'} skipped:</div>
             ${errors.slice(0, 4).map(e => `<div>Line ${e.line}: ${escapeHtml(e.reason)}</div>`).join('')}
           </div>`
        : '';

      box.innerHTML = `
        <div class="flex items-center justify-between font-bold text-slate-800 mb-1.5">
          <span class="text-emerald-700">${valid.length} valid row${valid.length === 1 ? '' : 's'} ready</span>
          ${valid.length > 6 ? `<span class="text-[10px] text-slate-400">Showing first 6</span>` : ''}
        </div>
        ${valid.length > 0 ? `<table class="w-full text-left text-[11px]"><tbody>${previewRows}</tbody></table>` : ''}
        ${errHtml}`;
    }

    function executeCsvImport() {
      if (_pendingCsvImportRows.length === 0) return;
      const db = getActiveDB();
      const mode = _pendingCsvImportMode || 'allocations';
      const count = _pendingCsvImportRows.length;

      if (mode === 'capacities') {
        pushUndoState(`Import ${count} CSV capacity overrides`);
        _pendingCsvImportRows.forEach(r => {
          const wks = r.timeUnit === 'month' ? getWeeksInMonth(r.periodKey) : [r.periodKey];
          wks.forEach(wk => { db.capacityOverrides[`${r.deptId}::${wk}`] = r.fte; });
        });
        recordChange('Capacity', `Bulk imported ${count} variable capacity row${count === 1 ? '' : 's'} via CSV/Excel paste`);
      } else if (mode === 'milestones') {
        pushUndoState(`Import ${count} CSV milestones`);
        _pendingCsvImportRows.forEach(r => {
          db.milestones.push({
            id: uid('ms'),
            title: r.title,
            projectId: r.projectId,
            deptId: r.deptId,
            date: r.date,
            baselineDate: r.baselineDate,
            status: r.status,
            notes: r.notes,
          });
        });
        recordChange('Milestone', `Bulk imported ${count} milestone${count === 1 ? '' : 's'} via CSV/Excel paste`);
      } else {
        pushUndoState(`Import ${count} CSV allocations`);
        _pendingCsvImportRows.forEach(r => {
          setAllocationForPeriod(r.deptId, r.projId, r.periodKey, r.timeUnit, r.fte, db);
        });
        recordChange('Import', `Bulk imported ${count} allocation row${count === 1 ? '' : 's'} via CSV/Excel paste`);
      }

      _pendingCsvImportRows = [];
      closeModal();
      renderAll();
      showToast(`Imported ${count} ${mode === 'capacities' ? 'capacity override' : mode === 'milestones' ? 'milestone' : 'allocation'}${count === 1 ? '' : 's'}`, 'success', { undoable: true });
    }

    /* ---------- 14G. Heatmap Cell Jump & Project Archiving ---------- */

    function jumpToMatrixCell(deptId, pk) {
      ui.activeTab = 'matrix';
      ui.axis = 'department';
      if (shouldRenderMobileCards()) {
        ui.mobileSelectedPeriod = pk;
      }
      persistUIPrefs();
      renderAll();
      setTimeout(() => openCellDetailModal(deptId, pk), 40);
    }

    function toggleArchiveProject(projId) {
      const db = getActiveDB();
      const p = db.projects.find(x => x.id === projId);
      if (!p) return;
      pushUndoState(`${p.archived ? 'Restore' : 'Archive'} project [${p.code}]`);
      p.archived = !p.archived;
      if (p.archived && ui.filterProj === projId) ui.filterProj = 'all';
      if (p.archived && ui.spotlightProjId === projId) ui.spotlightProjId = '';
      recordChange('Project', `${p.archived ? 'Archived' : 'Restored'} project [${p.code}] ${p.name}`);
      renderAll();
      showToast(`${p.archived ? 'Archived' : 'Restored'} [${p.code}] ${p.name}`, 'info', { undoable: true });
    }

    function toggleShowArchivedProjects() {
      ui.showArchivedProjects = !ui.showArchivedProjects;
      persistUIPrefs();
      renderDataTab();
    }

    /* ---------- 14H. One-Click Bottleneck Resolver ("Fix >100% Slot") ---------- */

    function computeBottleneckOptions(deptId, pk, timeUnit = ui.timeUnit, db = getActiveDB()) {
      const dept = (db.departments || []).find(d => d.id === deptId);
      if (!dept) return null;
      const capFte = getDeptCapacityForPeriod(deptId, pk, timeUnit, db).avgFte;
      const allocFte = getDeptTotalAllocatedFte(deptId, pk, timeUnit, db);
      const excessFte = Math.max(0, Math.round((allocFte - capFte) * 1000) / 1000);
      const pct = capFte > 0 ? Math.round((allocFte / capFte) * 100) : (allocFte > 0 ? 999 : 0);

      const prioRank = { Low: 0, Medium: 1, High: 2, Critical: 3 };
      const items = (db.projects || [])
        .filter(p => !p.archived && isProjectIncludedInPlan(p))
        .map(p => {
          const a = getAllocationForPeriod(deptId, p.id, pk, timeUnit, db.allocations);
          return a.hasData ? { proj: p, fte: a.avgFte } : null;
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (Boolean(b.proj.tentative) !== Boolean(a.proj.tentative)) return b.proj.tentative ? 1 : -1;
          const pa = prioRank[a.proj.priority] ?? 1;
          const pb = prioRank[b.proj.priority] ?? 1;
          if (pa !== pb) return pa - pb;
          return a.fte - b.fte;
        });

      const candidate = items[0] || null;
      const trimTargetFte = candidate ? Math.max(0, Math.round((candidate.fte - excessFte) * 100) / 100) : 0;
      const afterTrimAlloc = candidate ? Math.max(0, allocFte - (candidate.fte - trimTargetFte)) : allocFte;
      const afterTrimPct = capFte > 0 ? Math.round((afterTrimAlloc / capFte) * 100) : 0;

      const nextPk = timeUnit === 'month' ? addMonthsToMonthKey(pk, 1) : addWeeksToWeekKey(pk, 1);
      const nextCap = getDeptCapacityForPeriod(deptId, nextPk, timeUnit, db).avgFte;
      const nextAlloc = getDeptTotalAllocatedFte(deptId, nextPk, timeUnit, db);
      const afterShiftPctHere = candidate && capFte > 0 ? Math.round((Math.max(0, allocFte - candidate.fte) / capFte) * 100) : pct;
      const afterShiftPctNext = candidate && nextCap > 0 ? Math.round(((nextAlloc + candidate.fte) / nextCap) * 100) : 0;

      const bufferCapFte = Math.ceil(allocFte * 4) / 4;
      const afterBufferPct = bufferCapFte > 0 ? Math.round((allocFte / bufferCapFte) * 100) : 0;

      return {
        dept, pk, timeUnit, nextPk, capFte, allocFte, excessFte, pct,
        items, candidate, trimTargetFte, afterTrimPct,
        afterShiftPctHere, afterShiftPctNext,
        bufferCapFte, afterBufferPct,
      };
    }

    function openBottleneckResolverModal(deptId, pk) {
      const db = getActiveDB();
      const plan = computeBottleneckOptions(deptId, pk, ui.timeUnit, db);
      if (!plan) return;
      const hdr = formatPeriodHeader(pk, ui.timeUnit);
      const nextHdr = formatPeriodHeader(plan.nextPk, ui.timeUnit);

      const candOpts = plan.items.map((it, idx) =>
        `<option value="${it.proj.id}" ${idx === 0 ? 'selected' : ''}>[${escapeHtml(it.proj.code)}] ${escapeHtml(it.proj.name)} — ${formatValue(fteToDisplayValue(it.fte, pk, ui.timeUnit))} (${escapeHtml(it.proj.priority || 'Medium')}${it.proj.tentative ? ', Pipeline' : ''})</option>`
      ).join('');

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-rose-700">Resolve Bottleneck — ${escapeHtml(plan.dept.name)}</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(hdr.title)}: Allocated <strong>${formatValue(fteToDisplayValue(plan.allocFte, pk, ui.timeUnit))}</strong> vs. Capacity <strong>${formatValue(fteToDisplayValue(plan.capFte, pk, ui.timeUnit))}</strong> (<strong class="text-rose-600">${plan.pct}%</strong>, excess +${formatValue(fteToDisplayValue(plan.excessFte, pk, ui.timeUnit))}).</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          ${plan.items.length > 0 ? `
            <div>
              <label for="mBotProjSelect" class="block font-semibold text-slate-700 mb-1">Target Project for Trim / Shift (auto-suggested lowest priority / pipeline)</label>
              <select id="mBotProjSelect" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-800">
                ${candOpts}
              </select>
            </div>` : ''}

          <div class="space-y-2.5">
            ${plan.candidate ? `
              <div class="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0 flex-1 space-y-0.5">
                  <div class="font-bold text-slate-900">1. Trim Allocation to Fit Capacity</div>
                  <div class="text-[11px] text-slate-600">Reduce selected project by excess (${formatValue(fteToDisplayValue(plan.excessFte, pk, ui.timeUnit))}) so utilisation drops toward <strong>&le;100%</strong>.</div>
                </div>
                <button type="button" onclick="applyBottleneckTrim('${deptId}', '${pk}')"
                  class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shrink-0 transition">Apply Trim</button>
              </div>
              <div class="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0 flex-1 space-y-0.5">
                  <div class="font-bold text-slate-900">2. Defer Slot to ${escapeHtml(nextHdr.title)} (+1 ${ui.timeUnit})</div>
                  <div class="text-[11px] text-slate-600">Move selected project&rsquo;s load in ${escapeHtml(hdr.title)} forward into ${escapeHtml(nextHdr.title)} (current ${plan.afterShiftPctHere}% / next ~${plan.afterShiftPctNext}%).</div>
                </div>
                <button type="button" onclick="applyBottleneckShift('${deptId}', '${pk}')"
                  class="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold shrink-0 transition">Move +1</button>
              </div>` : ''}

            <div class="p-3 rounded-xl border border-sky-200 bg-sky-50/70 flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0 flex-1 space-y-0.5">
                <div class="font-bold text-sky-900">3. Add Temporary Capacity Buffer (Contractors / Surge)</div>
                <div class="text-[11px] text-sky-800">Set variable capacity override in ${escapeHtml(hdr.title)} to <strong>${plan.bufferCapFte} FTE</strong> (utilisation drops to <strong>${plan.afterBufferPct}%</strong>).</div>
              </div>
              <button type="button" onclick="applyBottleneckBuffer('${deptId}', '${pk}', ${plan.bufferCapFte})"
                class="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold shrink-0 transition">Set ${plan.bufferCapFte} FTE</button>
            </div>
          </div>

          <div class="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500">
            <span>All fixes are 1-click Undoable (Ctrl+Z).</span>
            <button type="button" onclick="closeModal()" class="px-3.5 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Close</button>
          </div>
        </div>`, 'max-w-lg');
    }

    function applyBottleneckTrim(deptId, pk) {
      const db = getActiveDB();
      const projId = document.getElementById('mBotProjSelect')?.value;
      const plan = computeBottleneckOptions(deptId, pk, ui.timeUnit, db);
      if (!plan || !projId) return;
      const cur = getAllocationForPeriod(deptId, projId, pk, ui.timeUnit, db.allocations);
      const nextFte = Math.max(0, Math.round((cur.avgFte - plan.excessFte) * 100) / 100);
      const pCode = db.projects.find(p => p.id === projId)?.code || projId;
      pushUndoState(`Trim [${plan.dept.code} -> ${pCode}] in ${pk}`);
      setAllocationForPeriod(deptId, projId, pk, ui.timeUnit, nextFte, db);
      recordChange('Bottleneck', `Resolved [${plan.dept.code}] bottleneck in ${pk}: trimmed [${pCode}] from ${formatValue(cur.avgFte, 'fte')} to ${formatValue(nextFte, 'fte')}`);
      closeModal();
      renderAll();
      showToast(`Trimmed [${pCode}] to ${formatValue(nextFte, 'fte')}`, 'success', { undoable: true });
    }

    function applyBottleneckShift(deptId, pk) {
      const db = getActiveDB();
      const projId = document.getElementById('mBotProjSelect')?.value;
      const plan = computeBottleneckOptions(deptId, pk, ui.timeUnit, db);
      if (!plan || !projId) return;
      const cur = getAllocationForPeriod(deptId, projId, pk, ui.timeUnit, db.allocations);
      if (!cur.hasData) return;
      const pCode = db.projects.find(p => p.id === projId)?.code || projId;
      const dstExisting = getAllocationForPeriod(deptId, projId, plan.nextPk, ui.timeUnit, db.allocations).avgFte;
      pushUndoState(`Defer [${plan.dept.code} -> ${pCode}] to ${plan.nextPk}`);
      setAllocationForPeriod(deptId, projId, pk, ui.timeUnit, 0, db);
      setAllocationForPeriod(deptId, projId, plan.nextPk, ui.timeUnit, dstExisting + cur.avgFte, db);
      recordChange('Bottleneck', `Resolved [${plan.dept.code}] bottleneck in ${pk}: moved [${pCode}] (${formatValue(cur.avgFte, 'fte')}) to ${plan.nextPk}`);
      closeModal();
      renderAll();
      showToast(`Moved [${pCode}] to ${formatPeriodHeader(plan.nextPk, ui.timeUnit).title}`, 'success', { undoable: true });
    }

    function applyBottleneckBuffer(deptId, pk, targetCapFte) {
      const db = getActiveDB();
      const dept = db.departments.find(d => d.id === deptId);
      if (!dept) return;
      const cleanCap = Math.max(0, Math.round(Number(targetCapFte) * 100) / 100);
      pushUndoState(`Add capacity buffer for [${dept.code}] in ${pk}`);
      const wks = ui.timeUnit === 'month' ? getWeeksInMonth(pk) : [pk];
      wks.forEach(wk => { db.capacityOverrides[`${deptId}::${wk}`] = cleanCap; });
      recordChange('Bottleneck', `Resolved [${dept.code}] bottleneck in ${pk}: temporary capacity buffer set to ${cleanCap} FTE`);
      closeModal();
      renderAll();
      showToast(`Set [${dept.code}] capacity to ${cleanCap} FTE`, 'success', { undoable: true });
    }

    /* ---------- 14I. Executive Summary Briefing Copy ---------- */

    function buildExecutiveBriefingText(db = getActiveDB()) {
      const periods = getVisiblePeriods();
      const warnT = db.settings.warnThreshold || 85;
      const overT = db.settings.overThreshold || 100;
      const visibleDepts = (db.departments || []).filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
      const visibleProjs = getSortedProjects(db).filter(p => !p.archived && isProjectIncludedInPlan(p) && (ui.filterProj === 'all' || p.id === ui.filterProj));
      const startLbl = periods.length ? formatPeriodHeader(periods[0], ui.timeUnit).title : '';
      const endLbl = periods.length ? formatPeriodHeader(periods[periods.length - 1], ui.timeUnit).title : '';

      let totA = 0, totC = 0;
      const bottlenecks = [];
      const periodSummaries = [];

      periods.forEach(pk => {
        let pA = 0, pC = 0;
        const pTitle = formatPeriodHeader(pk, ui.timeUnit).title;
        visibleDepts.forEach(d => {
          const da = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
          const dc = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
          pA += da; pC += dc;
          const dp = dc > 0 ? Math.round((da / dc) * 100) : (da > 0 ? 999 : 0);
          if (dp > overT) {
            const topProjs = visibleProjs
              .map(p => ({ p, fte: getAllocationForPeriod(d.id, p.id, pk, ui.timeUnit, db.allocations).avgFte }))
              .filter(x => x.fte > 0.001)
              .sort((a, b) => b.fte - a.fte)
              .slice(0, 3)
              .map(x => `[${x.p.code}] ${formatValue(fteToDisplayValue(x.fte, pk, ui.timeUnit))}`);
            bottlenecks.push(`- ${d.name} (${pTitle}): ${dp > 990 ? '>100%' : dp + '%'} (${formatValue(fteToDisplayValue(da, pk, ui.timeUnit))} / ${formatValue(fteToDisplayValue(dc, pk, ui.timeUnit))}) — ${topProjs.join(', ')}`);
          }
        });
        totA += pA; totC += pC;
        const pPct = pC > 0 ? Math.round((pA / pC) * 100) : 0;
        periodSummaries.push(`${pTitle}: ${pPct}%`);
      });

      const avgPct = totC > 0 ? Math.round((totA / totC) * 100) : 0;
      const slippedMs = (db.milestones || []).filter(m => getMilestoneDriftDays(m) > 0 && m.status !== 'Completed');
      const atRiskMs = (db.milestones || []).filter(m => m.status === 'At Risk' && getMilestoneDriftDays(m) <= 0);

      const budgetWarnings = [];
      const hasRates = hasAnyDayRates(db);
      let totalCost = 0;
      visibleProjs.forEach(p => {
        const dPlanned = getProjectTotalPlannedDays(p.id, db);
        const dBud = Number(p.budgetDays) || 0;
        if (dBud > 0 && (dPlanned / dBud) * 100 >= warnT) {
          budgetWarnings.push(`- [${p.code}] ${p.name}: ${dPlanned}/${dBud}d (${Math.round((dPlanned / dBud) * 100)}%)`);
        }
        if (hasRates) {
          const cPlanned = getProjectTotalPlannedCost(p.id, db);
          totalCost += cPlanned;
          const cBud = Number(p.budgetCost) || 0;
          if (cBud > 0 && (cPlanned / cBud) * 100 >= warnT) {
            budgetWarnings.push(`- [${p.code}] ${p.name} Cost: ${formatCurrency(cPlanned, db)} / ${formatCurrency(cBud, db)} (${Math.round((cPlanned / cBud) * 100)}%)`);
          }
        }
      });

      const notes = [];
      const adminNotes = [];
      periods.forEach(pk => {
        const pTitle = formatPeriodHeader(pk, ui.timeUnit).title;
        visibleDepts.forEach(d => {
          visibleProjs.forEach(p => {
            const c = getCellProjectComments(d.id, p.id, pk, ui.timeUnit, db);
            if (!c.direct) return;
            const line = `- ${pTitle} | ${d.code} -> [${p.code}]: ${c.direct.replace(/\s+/g, ' ').slice(0, 140)}`;
            if (isNonFteProject(p)) {
              if (adminNotes.length < 12) adminNotes.push(line);
            } else if (notes.length < 8) {
              notes.push(line);
            }
          });
        });
      });

      const lines = [
        `PULSEPLAN EXECUTIVE BRIEFING (${startLbl}${endLbl && endLbl !== startLbl ? ' – ' + endLbl : ''})`,
        `Horizon: ${periods.length} ${ui.timeUnit}${periods.length === 1 ? '' : 's'} | Scope: ${ui.includeTentative ? 'Committed + Pipeline' : 'Committed Only'} | Unit: ${unitShortLabel()}`,
        `Org Utilisation: ${avgPct}% avg (${periodSummaries.join(' | ')})`,
      ];
      if (hasRates && totalCost > 0) lines.push(`Estimated Portfolio Cost: ${formatCurrency(totalCost, db)}`);

      lines.push('');
      lines.push(`BOTTLENECKS (>${overT}%): ${bottlenecks.length}`);
      if (bottlenecks.length > 0) lines.push(...bottlenecks);
      else lines.push('- None in visible horizon.');

      lines.push('');
      lines.push(`MILESTONES: ${slippedMs.length} slipped, ${atRiskMs.length} at risk (of ${(db.milestones || []).length} total)`);
      [...slippedMs, ...atRiskMs].forEach(m => {
        const p = db.projects.find(x => x.id === m.projectId);
        const drift = getMilestoneDriftDays(m);
        lines.push(`- ${m.title}${p ? ` [${p.code}]` : ''}: ${m.date}${drift > 0 ? ` (+${drift}d slip)` : ''} [${m.status}]`);
      });

      if (budgetWarnings.length > 0) {
        lines.push('');
        lines.push('BUDGET WATCHLIST:');
        lines.push(...budgetWarnings);
      }

      if (adminNotes.length > 0) {
        lines.push('');
        lines.push('ADMIN — DEPT ISSUES & REQUESTED MEETINGS:');
        lines.push(...adminNotes);
      }

      if (notes.length > 0) {
        lines.push('');
        lines.push('KEY NOTES:');
        lines.push(...notes);
      }

      return lines.join('\n');
    }

    async function copyExecutiveBriefing() {
      const text = buildExecutiveBriefingText(getActiveDB());
      let copied = false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch (e) {}

      if (copied) {
        showToast('Executive briefing copied to clipboard — ready to paste into Email/Slack/Teams', 'success');
        return;
      }

      showModal(`
        <div class="p-5 space-y-3 text-xs">
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">Executive Summary Briefing</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          <p class="text-slate-500">Select all and copy (<code class="font-mono">Ctrl+C</code> / <code class="font-mono">Cmd+C</code>) to share in Email, Slack, or Teams:</p>
          <textarea id="mBriefingText" rows="12" readonly class="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-mono text-[11px] leading-relaxed">${escapeHtml(text)}</textarea>
          <div class="flex justify-end gap-2">
            <button type="button" onclick="const t=document.getElementById('mBriefingText'); if(t){t.select(); document.execCommand?.('copy'); showToast('Copied briefing','success');}" class="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold">Select &amp; Copy</button>
            <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold">Close</button>
          </div>
        </div>`, 'max-w-xl');
    }

    /* ---------- 14J. Clear Period Allocations & Duplicate Project ---------- */

    function clearPeriodAllocations(periodKey) {
      const db = getActiveDB();
      const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
      const visibleProjs = db.projects.filter(p => (ui.filterProj === 'all' || p.id === ui.filterProj) && isProjectIncludedInPlan(p));
      const targets = [];
      visibleDepts.forEach(d => {
        visibleProjs.forEach(p => {
          if (getAllocationForPeriod(d.id, p.id, periodKey, ui.timeUnit, db.allocations).hasData) {
            targets.push({ deptId: d.id, projId: p.id });
          }
        });
      });
      const title = formatPeriodHeader(periodKey, ui.timeUnit).title;
      if (targets.length === 0) {
        showToast(`No visible allocations to clear in ${title}.`, 'info');
        return;
      }
      openConfirmModal(
        `Clear ${title}`,
        `Remove all ${targets.length} visible allocation${targets.length === 1 ? '' : 's'} in ${title}? You can undo this immediately with Ctrl+Z.`,
        'Clear Period',
        () => {
          pushUndoState(`Clear allocations in ${title}`);
          targets.forEach(({ deptId, projId }) => setAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, 0, db));
          recordChange('Allocation', `Cleared ${targets.length} visible allocation${targets.length === 1 ? '' : 's'} in ${title}`);
          renderAll();
          showToast(`Cleared ${targets.length} allocation${targets.length === 1 ? '' : 's'} in ${title}`, 'info', { undoable: true });
        }
      );
    }

    function duplicateProject(projId, opts = {}, db = getActiveDB()) {
      const src = (db.projects || []).find(p => p.id === projId);
      if (!src) return null;
      const newId = uid('p');
      const existingCodes = new Set((db.projects || []).map(p => String(p.code || '').toUpperCase()));
      let defaultCode = `${src.code}2`.slice(0, 8);
      let n = 2;
      while (existingCodes.has(defaultCode.toUpperCase()) && n < 99) {
        defaultCode = `${src.code.slice(0, 6)}${n}`;
        n++;
      }
      const newProj = {
        ...src,
        id: newId,
        name: String(opts.name || `${src.name} (Copy)`).trim(),
        code: String(opts.code || defaultCode).trim().toUpperCase(),
        tentative: opts.tentative !== undefined ? Boolean(opts.tentative) : Boolean(src.tentative),
        archived: false,
      };
      db.projects.push(newProj);
      db.projects = getSortedProjects(db);

      let copiedAllocs = 0;
      if (opts.copyAllocations !== false) {
        Object.entries({ ...(db.allocations || {}) }).forEach(([k, v]) => {
          const parts = k.split('::');
          if (parts[1] === projId) {
            db.allocations[`${parts[0]}::${newId}::${parts[2]}`] = v;
            copiedAllocs++;
          }
        });
      }
      let copiedMs = 0;
      if (opts.copyMilestones !== false) {
        const srcMs = (db.milestones || []).filter(m => m.projectId === projId);
        srcMs.forEach(m => {
          db.milestones.push({ ...m, id: uid('ms'), projectId: newId });
          copiedMs++;
        });
      }
      return { project: newProj, copiedAllocs, copiedMs };
    }

    function openDuplicateProjectModal(projId) {
      const db = getActiveDB();
      const src = db.projects.find(p => p.id === projId);
      if (!src) return;
      const suggestedCode = `${src.code.slice(0, 6)}2`.toUpperCase();
      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">Duplicate Project</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          <input type="hidden" id="mDupProjId" value="${src.id}" />
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">
              <label for="mDupProjName" class="block font-semibold text-slate-700 mb-1">New Project Name</label>
              <input id="mDupProjName" type="text" value="${escapeHtml(src.name)} (Copy)" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
            </div>
            <div>
              <label for="mDupProjCode" class="block font-semibold text-slate-700 mb-1">Code</label>
              <input id="mDupProjCode" type="text" maxlength="8" value="${escapeHtml(suggestedCode)}" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono uppercase font-bold" />
            </div>
          </div>
          <div class="space-y-2">
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input id="mDupCopyAllocs" type="checkbox" checked class="rounded text-indigo-600" />
              <span class="font-semibold text-slate-700">Copy all weekly manpower allocations</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input id="mDupCopyMs" type="checkbox" checked class="rounded text-indigo-600" />
              <span class="font-semibold text-slate-700">Copy project milestones</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input id="mDupTentative" type="checkbox" ${src.tentative ? 'checked' : ''} class="rounded text-indigo-600" />
              <span class="font-semibold text-violet-800">Mark duplicate as Tentative / Pipeline</span>
            </label>
          </div>
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button type="button" onclick="applyDuplicateProjectModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Duplicate Project</button>
          </div>
        </div>`, 'max-w-md');
    }

    function applyDuplicateProjectModal() {
      const db = getActiveDB();
      const srcId = document.getElementById('mDupProjId')?.value;
      const name = (document.getElementById('mDupProjName')?.value || '').trim();
      const code = (document.getElementById('mDupProjCode')?.value || '').trim().toUpperCase();
      const copyAllocations = Boolean(document.getElementById('mDupCopyAllocs')?.checked);
      const copyMilestones = Boolean(document.getElementById('mDupCopyMs')?.checked);
      const tentative = Boolean(document.getElementById('mDupTentative')?.checked);
      if (!name) { showToast('Project name is required.', 'warning'); return; }

      pushUndoState(`Duplicate project [${code || 'COPY'}]`);
      const res = duplicateProject(srcId, { name, code, copyAllocations, copyMilestones, tentative }, db);
      if (!res) return;
      recordChange('Project', `Duplicated project as [${res.project.code}] ${res.project.name} (${res.copiedAllocs} alloc wks, ${res.copiedMs} milestones)`);
      closeModal();
      renderAll();
      showToast(`Created [${res.project.code}] ${res.project.name}`, 'success', { undoable: true });
    }
