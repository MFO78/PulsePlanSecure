    /* ============================================================================
     * 3. PRO-RATA CONVERSION & AGGREGATION ENGINE
     * ============================================================================ */

    function unitShortLabel(unit = ui.manpowerUnit) {
      if (unit === 'days') return 'Days';
      if (unit === 'hours') return 'Hours';
      return 'FTE';
    }

    function formatValue(val, unit = ui.manpowerUnit, includeUnit = true) {
      if (val === null || val === undefined || isNaN(val)) return '-';
      const rounded = unit === 'fte'
        ? Math.round(val * 100) / 100
        : Math.round(val * 10) / 10;
      const numStr = Number.isInteger(rounded) ? String(rounded) : String(rounded);
      if (!includeUnit) return numStr;
      if (unit === 'days') return `${numStr}d`;
      if (unit === 'hours') return `${numStr}h`;
      return `${numStr} FTE`;
    }

    function formatSignedValue(val, unit = ui.manpowerUnit, includeUnit = true) {
      if (Math.abs(val) < 0.005) return includeUnit ? `0${unit === 'fte' ? ' FTE' : unit === 'days' ? 'd' : 'h'}` : '0';
      const sign = val > 0 ? '+' : '-';
      return `${sign}${formatValue(Math.abs(val), unit, includeUnit)}`;
    }

    function fteToDisplayValue(fte, periodKey, timeUnit, unit = ui.manpowerUnit) {
      const db = getActiveDB();
      const dpw = Number(db.settings.daysPerWeek) || 5;
      const hpd = Number(db.settings.hoursPerDay) || 8;
      if (unit === 'fte') return fte;
      const numWeeks = timeUnit === 'month' ? getWeeksInMonth(periodKey).length : 1;
      const days = fte * dpw * numWeeks;
      if (unit === 'days') return days;
      return days * hpd;
    }

    function displayValueToFte(displayVal, periodKey, timeUnit, unit = ui.manpowerUnit) {
      const db = getActiveDB();
      const dpw = Number(db.settings.daysPerWeek) || 5;
      const hpd = Number(db.settings.hoursPerDay) || 8;
      if (unit === 'fte') return displayVal;
      const numWeeks = timeUnit === 'month' ? getWeeksInMonth(periodKey).length : 1;
      if (unit === 'days') return displayVal / (dpw * numWeeks);
      return displayVal / (dpw * hpd * numWeeks);
    }

    function getVisiblePeriods() {
      const periods = [];
      const count = Math.max(1, Math.min(24, getActiveHorizon()));
      for (let i = 0; i < count; i++) {
        if (ui.timeUnit === 'month') periods.push(addMonthsToMonthKey(ui.startMonth, i));
        else periods.push(addWeeksToWeekKey(ui.startWeek, i));
      }
      return periods;
    }

    function getAllocationForPeriod(deptId, projId, periodKey, timeUnit, allocMap = getActiveDB().allocations) {
      const weeks = timeUnit === 'month' ? getWeeksInMonth(periodKey) : [periodKey];
      let sum = 0;
      let hasData = false;
      const vals = [];
      weeks.forEach(wk => {
        const v = Number((allocMap && allocMap[`${deptId}::${projId}::${wk}`]) || 0);
        if (v > 0.0001) hasData = true;
        sum += v;
        vals.push(v);
      });
      const avgFte = weeks.length ? sum / weeks.length : 0;
      const isUneven = timeUnit === 'month' && vals.some(v => Math.abs(v - vals[0]) > 0.001);
      return { avgFte, hasData, isUneven, weeks };
    }

    function setAllocationForPeriod(deptId, projId, periodKey, timeUnit, fteVal, db = getActiveDB()) {
      const weeks = timeUnit === 'month' ? getWeeksInMonth(periodKey) : [periodKey];
      const cleanFte = Math.max(0, Math.round(fteVal * 1000) / 1000);
      weeks.forEach(wk => {
        const key = `${deptId}::${projId}::${wk}`;
        if (cleanFte <= 0.0001) delete db.allocations[key];
        else db.allocations[key] = cleanFte;
      });
    }

    function getDeptCapacityForPeriod(deptId, periodKey, timeUnit, db = getActiveDB(), overrideMap = null) {
      const dept = db.departments.find(d => d.id === deptId);
      const base = dept ? Number(dept.defaultCapacity || 0) : 0;
      const capOverrides = overrideMap !== null ? overrideMap : (db.capacityOverrides || {});
      const weeks = timeUnit === 'month' ? getWeeksInMonth(periodKey) : [periodKey];
      let sum = 0;
      let hasOverride = false;
      weeks.forEach(wk => {
        const key = `${deptId}::${wk}`;
        if (capOverrides && capOverrides[key] !== undefined) {
          sum += Number(capOverrides[key]);
          hasOverride = true;
        } else {
          sum += base;
        }
      });
      return { avgFte: weeks.length ? sum / weeks.length : base, hasOverride };
    }

    function getDeptTotalAllocatedFte(deptId, periodKey, timeUnit, db = getActiveDB(), opts = {}) {
      const includeTentative = opts && opts.includeTentative !== undefined ? Boolean(opts.includeTentative) : Boolean(ui.includeTentative);
      let total = 0;
      db.projects.forEach(p => {
        if (isNonFteProject(p)) return;
        if (ui.filterProj !== 'all' && p.id !== ui.filterProj) return;
        if (!includeTentative && p.tentative && ui.filterProj !== p.id) return;
        total += getAllocationForPeriod(deptId, p.id, periodKey, timeUnit, db.allocations).avgFte;
      });
      return total;
    }

    function getDeptCommittedVsTentativeFte(deptId, periodKey, timeUnit, db = getActiveDB()) {
      let committed = 0;
      let tentative = 0;
      db.projects.forEach(p => {
        if (isNonFteProject(p)) return;
        if (ui.filterProj !== 'all' && p.id !== ui.filterProj) return;
        const val = getAllocationForPeriod(deptId, p.id, periodKey, timeUnit, db.allocations).avgFte;
        if (val <= 0.0001) return;
        if (p.tentative) {
          if (ui.includeTentative || ui.filterProj === p.id) tentative += val;
        } else {
          committed += val;
        }
      });
      return { committed, tentative, total: committed + tentative };
    }

    function getProjTotalAllocatedFte(projId, periodKey, timeUnit, db = getActiveDB()) {
      const proj = (db.projects || []).find(p => p.id === projId);
      if (isNonFteProject(proj)) return 0;
      let total = 0;
      db.departments.forEach(d => {
        if (ui.filterDept !== 'all' && d.id !== ui.filterDept) return;
        total += getAllocationForPeriod(d.id, projId, periodKey, timeUnit, db.allocations).avgFte;
      });
      return total;
    }

    function getMilestonesInPeriod(periodKey, timeUnit, msList = getActiveDB().milestones) {
      return msList.filter(m => {
        if (!m.date) return false;
        if (timeUnit === 'month') return m.date.slice(0, 7) === periodKey;
        return dateToISOWeekKey(parseISODate(m.date)) === periodKey;
      });
    }

    function getMilestoneDriftDays(ms) {
      if (!ms.baselineDate || !ms.date) return 0;
      const b = parseISODate(ms.baselineDate);
      const c = parseISODate(ms.date);
      return Math.round((c - b) / 86400000);
    }

    function getCommentKey(deptId, projId, periodKey) {
      return `${deptId}::${projId}::${periodKey}`;
    }

    function getCellProjectComments(deptId, projId, periodKey, timeUnit, db = getActiveDB()) {
      const commentsMap = db.comments || {};
      const direct = (commentsMap[getCommentKey(deptId, projId, periodKey)] || '').trim();
      const weekEntries = [];
      let monthNote = '';

      if (timeUnit === 'month') {
        getWeeksInMonth(periodKey).forEach(wk => {
          const txt = (commentsMap[getCommentKey(deptId, projId, wk)] || '').trim();
          if (txt) weekEntries.push({ weekKey: wk, weekShort: wk.split('-')[1], text: txt });
        });
      } else {
        const owningMonth = getWeekOwningMonth(periodKey);
        monthNote = (commentsMap[getCommentKey(deptId, projId, owningMonth)] || '').trim();
      }

      return { direct, weekEntries, monthNote, hasAny: Boolean(direct || weekEntries.length > 0) };
    }

    function setCellProjectComment(deptId, projId, periodKey, text, db = getActiveDB()) {
      if (!db.comments) db.comments = {};
      const key = getCommentKey(deptId, projId, periodKey);
      const trimmed = String(text || '').trim();
      if (!trimmed) delete db.comments[key];
      else db.comments[key] = trimmed;
    }

    function getCellTotalCommentCount(rowId, periodKey, axis, timeUnit, db = getActiveDB()) {
      let count = 0;
      if (axis === 'department') {
        db.projects.forEach(p => {
          if (ui.filterProj !== 'all' && p.id !== ui.filterProj) return;
          if (!ui.includeTentative && p.tentative && ui.filterProj !== p.id) return;
          if (getCellProjectComments(rowId, p.id, periodKey, timeUnit, db).hasAny) count++;
        });
      } else {
        db.departments.forEach(d => {
          if (ui.filterDept !== 'all' && d.id !== ui.filterDept) return;
          if (getCellProjectComments(d.id, rowId, periodKey, timeUnit, db).hasAny) count++;
        });
      }
      return count;
    }

