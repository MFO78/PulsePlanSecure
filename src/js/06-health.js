    /* ============================================================================
     * 6. TOUCH-READY HEALTH DASHBOARD & MOD 2 SNAPSHOT COMPARISON ENGINE
     * ============================================================================ */

    let _lastHealthChartStats = [];

    function selectHealthChartBar(idx) {
      ui.selectedChartPeriodIdx = idx;
      const readout = document.getElementById('healthChartReadout');
      const s = _lastHealthChartStats[idx];
      if (!readout || !s) return;
      const db = getActiveDB();
      const overT = db.settings.overThreshold || 100;
      const warnT = db.settings.warnThreshold || 85;
      const statusTxt = s.pct > overT ? 'Overallocated' : s.pct >= warnT ? 'High Load' : 'Healthy';
      const statusCls = s.pct > overT ? 'text-rose-600' : s.pct >= warnT ? 'text-amber-700' : 'text-emerald-700';
      readout.classList.remove('hidden');
      const pipeNote = s.tentativeDisp > 0.005
        ? ` <span class="text-violet-700 font-semibold">(Committed ${formatValue(s.committedDisp)} + Pipeline ${formatValue(s.tentativeDisp)})</span>`
        : '';
      readout.innerHTML = `
        <span class="min-w-0 break-words"><strong>${escapeHtml(s.label)}</strong>: Allocated ${formatValue(s.allocDisp)} / Cap ${formatValue(s.capDisp)}${pipeNote}</span>
        <span class="font-extrabold shrink-0 ${statusCls}">${s.pct}% (${statusTxt})</span>`;
      triggerHaptic(6);
    }

    function renderHealthDashboard() {
      const db = getActiveDB();
      const periods = getVisiblePeriods();
      const warnT = db.settings.warnThreshold || 85;
      const overT = db.settings.overThreshold || 100;
      const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);

      let totalAllocFte = 0, totalCapFte = 0, overSlots = 0, highSlots = 0;
      const stats = periods.map(pk => {
        let a = 0, comm = 0, tent = 0, c = 0;
        visibleDepts.forEach(d => {
          const split = getDeptCommittedVsTentativeFte(d.id, pk, ui.timeUnit, db);
          const dc = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
          comm += split.committed;
          tent += split.tentative;
          a += split.total;
          c += dc;
          const dpct = dc > 0 ? Math.round((split.total / dc) * 100) : (split.total > 0 ? 999 : 0);
          if (dpct > overT) overSlots++;
          else if (dpct >= warnT) highSlots++;
        });
        totalAllocFte += a; totalCapFte += c;
        const pct = c > 0 ? Math.round((a / c) * 100) : 0;
        return {
          pk,
          label: formatPeriodHeader(pk, ui.timeUnit).title,
          allocDisp: fteToDisplayValue(a, pk, ui.timeUnit),
          committedDisp: fteToDisplayValue(comm, pk, ui.timeUnit),
          tentativeDisp: fteToDisplayValue(tent, pk, ui.timeUnit),
          capDisp: fteToDisplayValue(c, pk, ui.timeUnit),
          pct,
        };
      });
      _lastHealthChartStats = stats;

      const avgPct = totalCapFte > 0 ? Math.round((totalAllocFte / totalCapFte) * 100) : 0;
      const slippedMs = db.milestones.filter(m => getMilestoneDriftDays(m) > 0 && m.status !== 'Completed').length;
      const activeProjs = db.projects.filter(p => !p.archived && isProjectIncludedInPlan(p));
      const budgetedProjs = activeProjs.filter(p => (Number(p.budgetDays) || 0) > 0);
      const overBudgetCount = budgetedProjs.filter(p => getProjectTotalPlannedDays(p.id, db) > Number(p.budgetDays)).length;
      const hasRates = hasAnyDayRates(db);
      const totalPortfolioCost = hasRates ? activeProjs.reduce((acc, p) => acc + getProjectTotalPlannedCost(p.id, db), 0) : 0;
      const costBudgetProjs = activeProjs.filter(p => (Number(p.budgetCost) || 0) > 0);
      const overCostCount = hasRates ? costBudgetProjs.filter(p => getProjectTotalPlannedCost(p.id, db) > Number(p.budgetCost)).length : 0;

      let kpi4Html = '';
      if (hasRates && totalPortfolioCost > 0) {
        kpi4Html = `
          <div class="text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-slate-400">Planned Cost</div>
          <div class="text-xl md:text-2xl font-extrabold mt-1 tabular-nums ${overCostCount > 0 ? 'text-rose-600' : 'text-indigo-600'}">${formatCurrency(totalPortfolioCost, db)}</div>
          <div class="text-[11px] text-slate-500 mt-1 leading-snug">${costBudgetProjs.length > 0 ? (overCostCount > 0 ? `${overCostCount}/${costBudgetProjs.length} over cost budget` : `${costBudgetProjs.length} cost budgets OK`) : `${budgetedProjs.length > 0 ? `${budgetedProjs.length - overBudgetCount}/${budgetedProjs.length} day budgets OK` : `${db.snapshots.length} snapshots`}`}</div>`;
      } else if (budgetedProjs.length > 0) {
        kpi4Html = `
          <div class="text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-slate-400">Project Budgets</div>
          <div class="text-xl md:text-2xl font-extrabold mt-1 ${overBudgetCount > 0 ? 'text-rose-600' : 'text-emerald-600'}">${budgetedProjs.length - overBudgetCount} / ${budgetedProjs.length}</div>
          <div class="text-[11px] text-slate-500 mt-1 leading-snug">${overBudgetCount > 0 ? `${overBudgetCount} over budget` : 'All within budget'} &bull; ${db.snapshots.length} snaps</div>`;
      } else {
        kpi4Html = `
          <div class="text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-slate-400">Plan Evolution</div>
          <div class="text-xl md:text-2xl font-extrabold mt-1 text-indigo-600">${db.changeLog.length}</div>
          <div class="text-[11px] text-slate-500 mt-1 leading-snug">${db.snapshots.length} saved snapshots</div>`;
      }

      document.getElementById('healthKpis').innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-3.5 md:p-4 shadow-xs min-w-0 break-words">
          <div class="text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-slate-400 leading-tight">Avg Org Utilisation</div>
          <div class="text-xl md:text-2xl font-extrabold mt-1 ${avgPct > overT ? 'text-rose-600' : avgPct >= warnT ? 'text-amber-600' : 'text-emerald-600'}">${avgPct}%</div>
          <div class="text-[11px] text-slate-500 mt-1 leading-snug">Across ${periods.length} ${ui.timeUnit}${periods.length === 1 ? '' : 's'}${!ui.includeTentative ? ' (Comm. only)' : ''}</div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-3.5 md:p-4 shadow-xs min-w-0 break-words">
          <div class="text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-slate-400 leading-tight">Bottleneck Slots</div>
          <div class="text-xl md:text-2xl font-extrabold mt-1 ${overSlots > 0 ? 'text-rose-600' : 'text-slate-900'}">${overSlots}</div>
          <div class="text-[11px] text-slate-500 mt-1 leading-snug">${highSlots} high-load (&ge;${warnT}%)</div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-3.5 md:p-4 shadow-xs min-w-0 break-words">
          <div class="text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-slate-400 leading-tight">Milestones Health</div>
          <div class="text-xl md:text-2xl font-extrabold mt-1 ${slippedMs > 0 ? 'text-amber-600' : 'text-emerald-600'}">${db.milestones.length - slippedMs} / ${db.milestones.length}</div>
          <div class="text-[11px] text-slate-500 mt-1 leading-snug">${slippedMs} slipped vs. base</div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 p-3.5 md:p-4 shadow-xs min-w-0 break-words">
          ${kpi4Html}
        </div>`;

      // Interactive Touch-Tappable SVG Chart
      const chartBox = document.getElementById('healthSvgChart');
      const readoutEl = document.getElementById('healthChartReadout');
      if (stats.length === 0) {
        chartBox.innerHTML = '<p class="text-xs text-slate-400 py-8 text-center">No periods to chart.</p>';
        if (readoutEl) readoutEl.classList.add('hidden');
      } else {
        const width = Math.max(520, stats.length * 72);
        const height = 240;
        const pad = { top: 26, right: 20, bottom: 34, left: 48 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;

        const maxVal = Math.max(1, ...stats.map(s => Math.max(s.allocDisp, s.capDisp))) * 1.15;
        const yScale = v => pad.top + plotH - (v / maxVal) * plotH;
        const slotW = plotW / stats.length;
        const barW = Math.min(42, slotW * 0.56);

        const gridStroke = ui.darkMode ? '#334155' : '#e2e8f0';
        const axisText = ui.darkMode ? '#94a3b8' : '#64748b';
        const labelText = ui.darkMode ? '#cbd5e1' : '#475569';
        const pctTextNormal = ui.darkMode ? '#e2e8f0' : '#334155';
        const capStroke = ui.darkMode ? '#f8fafc' : '#0f172a';
        const capDotFill = ui.darkMode ? '#0f172a' : '#ffffff';

        let gridHtml = '';
        for (let i = 0; i <= 4; i++) {
          const val = (maxVal / 4) * i;
          const y = yScale(val);
          gridHtml += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="${gridStroke}" stroke-dasharray="${i === 0 ? '' : '3,3'}" />`;
          gridHtml += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="${axisText}">${formatValue(val, ui.manpowerUnit, false)}</text>`;
        }

        let barsHtml = '';
        const capPoints = [];

        stats.forEach((s, idx) => {
          const cx = pad.left + idx * slotW + slotW / 2;
          const x = cx - barW / 2;
          const yZero = yScale(0);
          const yComm = yScale(s.committedDisp);
          const hComm = Math.max(0, yZero - yComm);
          const yAlloc = yScale(s.allocDisp);
          const hTent = Math.max(0, yComm - yAlloc);
          const isOver = s.pct > overT;
          const commOver = s.capDisp > 0 && (s.committedDisp / s.capDisp) * 100 > overT;
          const fillComm = commOver ? '#f43f5e' : (isOver && hTent < 0.5 ? '#f43f5e' : '#6366f1');
          const fillTent = isOver ? '#fb7185' : '#a78bfa';

          capPoints.push(`${cx},${yScale(s.capDisp)}`);

          const titleTxt = s.tentativeDisp > 0.005
            ? `${escapeHtml(s.label)}: Committed ${formatValue(s.committedDisp)} + Pipeline ${formatValue(s.tentativeDisp)} = ${formatValue(s.allocDisp)} / Cap ${formatValue(s.capDisp)} (${s.pct}%)`
            : `${escapeHtml(s.label)}: Allocated ${formatValue(s.allocDisp)} / Capacity ${formatValue(s.capDisp)} (${s.pct}%)`;

          const yCap = yScale(s.capDisp);
          const pctLabelY = Math.max(12, Math.min(yAlloc, yCap) - 8);
          barsHtml += `
            <g role="button" tabindex="0" aria-label="${escapeHtml(s.label)}: ${formatValue(s.allocDisp)} of ${formatValue(s.capDisp)} (${s.pct}%)"
              onclick="selectHealthChartBar(${idx})"
              onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectHealthChartBar(${idx});}"
              class="cursor-pointer">
              <rect x="${pad.left + idx * slotW}" y="${pad.top}" width="${slotW}" height="${plotH + 22}" fill="transparent" />
              ${hComm > 0 ? `<rect x="${x}" y="${yComm}" width="${barW}" height="${hComm}" rx="${hTent > 0.5 ? 2 : 6}" fill="${fillComm}" opacity="0.92"><title>${titleTxt}</title></rect>` : ''}
              ${hTent > 0.5 ? `<rect x="${x}" y="${yAlloc}" width="${barW}" height="${hTent}" rx="4" fill="${fillTent}" stroke="${isOver ? '#e11d48' : '#7c3aed'}" stroke-width="1" stroke-dasharray="3,2" opacity="0.88"><title>${titleTxt}</title></rect>` : ''}
              <text x="${cx}" y="${pctLabelY}" text-anchor="middle" font-size="10" font-weight="700" fill="${isOver ? '#fb7185' : pctTextNormal}">${s.pct}%</text>
              <text x="${cx}" y="${height - 14}" text-anchor="middle" font-size="10" font-weight="600" fill="${labelText}">${escapeHtml(s.label)}</text>
            </g>`;
        });

        const capLineHtml = `
          <polyline fill="none" stroke="${capStroke}" stroke-width="2.5" stroke-dasharray="6,4" points="${capPoints.join(' ')}" pointer-events="none" />
          ${stats.map((s, idx) => {
            const cx = pad.left + idx * slotW + slotW / 2;
            const cy = yScale(s.capDisp);
            return `<circle cx="${cx}" cy="${cy}" r="4" fill="${capDotFill}" stroke="${capStroke}" stroke-width="2" pointer-events="none"></circle>`;
          }).join('')}`;

        const svgMinWCls = stats.length > 6 ? 'min-w-[480px]' : 'min-w-0';
        chartBox.innerHTML = `<svg role="img" aria-label="Organisation load versus variable capacity chart" viewBox="0 0 ${width} ${height}" class="w-full ${svgMinWCls} h-auto">${gridHtml}${barsHtml}${capLineHtml}</svg>`;

        if (ui.selectedChartPeriodIdx >= 0 && ui.selectedChartPeriodIdx < stats.length) {
          selectHealthChartBar(ui.selectedChartPeriodIdx);
        } else if (readoutEl) {
          readoutEl.classList.add('hidden');
        }
      }

      // Per-Department Health Bars
      const deptList = document.getElementById('deptHealthList');
      if (visibleDepts.length === 0) {
        deptList.innerHTML = '<p class="text-xs text-slate-400">No departments configured.</p>';
      } else {
        deptList.innerHTML = visibleDepts.map(d => {
          let sumA = 0, sumC = 0, peakPct = 0;
          periods.forEach(pk => {
            const a = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
            const c = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
            sumA += a; sumC += c;
            const p = c > 0 ? Math.round((a / c) * 100) : 0;
            if (p > peakPct) peakPct = p;
          });
          const avg = sumC > 0 ? Math.round((sumA / sumC) * 100) : 0;
          const barCls = peakPct > overT ? 'bg-rose-500' : avg >= warnT ? 'bg-amber-500' : 'bg-emerald-500';
          return `
            <div class="space-y-1">
              <div class="flex items-center justify-between gap-2 text-xs min-w-0">
                <span class="font-semibold text-slate-800 flex items-center gap-1.5 min-w-0 truncate">
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${d.color}" aria-hidden="true"></span>
                  <span class="truncate">${escapeHtml(d.name)}</span>
                </span>
                <span class="text-[11px] font-bold tabular-nums text-slate-600 shrink-0">Avg ${avg}% <span class="text-slate-400">|</span> Peak <span class="${peakPct > overT ? 'text-rose-600' : ''}">${peakPct}%</span></span>
              </div>
              <div class="w-full h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                <div class="h-full ${barCls} rounded-full" style="width:${Math.min(100, avg)}%"></div>
              </div>
            </div>`;
        }).join('');
      }

      // Render Department x Period Capacity Heatmap
      const heatmapEl = document.getElementById('healthCapacityHeatmap');
      if (heatmapEl) {
        if (visibleDepts.length === 0 || periods.length === 0) {
          heatmapEl.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">No departments or periods to display.</p>';
        } else {
          const thCells = periods.map(pk => {
            const h = formatPeriodHeader(pk, ui.timeUnit);
            return `<th scope="col" class="px-2 py-2 text-center font-bold text-[11px] text-slate-600 border-b border-slate-200 whitespace-nowrap">${escapeHtml(h.shortTitle)}</th>`;
          }).join('');
          const heatRows = visibleDepts.map(d => {
            const tds = periods.map(pk => {
              const a = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
              const cObj = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db);
              const c = cObj.avgFte;
              const pct = c > 0 ? Math.round((a / c) * 100) : (a > 0 ? 999 : 0);
              const aStr = formatValue(fteToDisplayValue(a, pk, ui.timeUnit));
              const cStr = formatValue(fteToDisplayValue(c, pk, ui.timeUnit));
              let cellCls = 'heatmap-empty';
              if (pct > overT) cellCls = 'heatmap-over font-extrabold';
              else if (pct >= warnT) cellCls = 'heatmap-warn font-bold';
              else if (pct > 0) cellCls = 'heatmap-ok font-bold';
              return `
                <td class="p-1 text-center border-b border-slate-100">
                  <button type="button" onclick="jumpToMatrixCell('${d.id}', '${pk}')"
                    title="${escapeHtml(d.name)} — ${escapeHtml(formatPeriodHeader(pk, ui.timeUnit).title)}: ${aStr} / ${cStr} (${pct > 990 ? '>100%' : pct + '%'}) • Click to open in Roadmap"
                    class="heatmap-cell w-full min-w-[56px] px-2 py-1.5 rounded-lg border text-[11px] tabular-nums cursor-pointer ${cellCls}">
                    ${pct > 990 ? '&infin;' : pct + '%'}
                  </button>
                </td>`;
            }).join('');
            return `
              <tr class="heatmap-row transition">
                <th scope="row" class="px-3 py-1.5 text-left text-xs font-bold text-slate-800 border-b border-slate-100 whitespace-nowrap">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${d.color}" aria-hidden="true"></span>
                    ${escapeHtml(d.name)}
                  </span>
                </th>
                ${tds}
              </tr>`;
          }).join('');
          heatmapEl.innerHTML = `
            <table class="w-full border-collapse text-xs">
              <caption class="sr-only">Department utilisation percentage heatmap by period</caption>
              <thead>
                <tr class="bg-slate-50">
                  <th scope="col" class="px-3 py-2 text-left font-bold text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-200">Department</th>
                  ${thCells}
                </tr>
              </thead>
              <tbody>${heatRows}</tbody>
            </table>`;
        }
      }

      const selA = document.getElementById('compareSnapshotSelect');
      const selB = document.getElementById('compareTargetSelect');
      if (selA) {
        selA.innerHTML = `<option value="">Select Baseline Snapshot...</option>` +
          db.snapshots.map(s => `<option value="${s.id}" ${ui.compareSnapshotId === s.id ? 'selected' : ''}>${s.pinned ? '📌 ' : ''}${escapeHtml(s.name)} (${new Date(s.createdAt).toLocaleDateString()})</option>`).join('');
      }
      if (selB) {
        selB.innerHTML = `<option value="__CURRENT__" ${ui.compareTargetId === '__CURRENT__' ? 'selected' : ''}>Current Active Plan</option>` +
          db.snapshots.map(s => `<option value="${s.id}" ${ui.compareTargetId === s.id ? 'selected' : ''}>${s.pinned ? '📌 ' : ''}${escapeHtml(s.name)} (${new Date(s.createdAt).toLocaleDateString()})</option>`).join('');
      }
      const chkChanged = document.getElementById('chkCompareChangedOnly');
      if (chkChanged) chkChanged.checked = Boolean(ui.compareChangedOnly);

      renderSnapshotComparison();
      renderChangeLog();
    }

    function resolveComparisonState(db, idOrCurrent) {
      if (!idOrCurrent || idOrCurrent === '__CURRENT__') {
        return {
          id: '__CURRENT__',
          label: 'Current Active Plan',
          allocations: db.allocations || {},
          capacityOverrides: db.capacityOverrides || {},
          milestones: db.milestones || [],
          comments: db.comments || {},
        };
      }
      const snap = (db.snapshots || []).find(s => s.id === idOrCurrent);
      if (!snap) return null;
      return {
        id: snap.id,
        label: snap.name,
        createdAt: snap.createdAt,
        allocations: (snap.data && snap.data.allocations) || {},
        capacityOverrides: (snap.data && snap.data.capacityOverrides) || {},
        milestones: (snap.data && snap.data.milestones) || [],
        comments: (snap.data && snap.data.comments) || {},
      };
    }

    function computeSnapshotDiff(db, stateA, stateB, periods, timeUnit, unit = ui.manpowerUnit) {
      const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
      const visibleProjs = getSortedProjects(db).filter(p => ui.filterProj === 'all' || p.id === ui.filterProj);
      const isRateUnit = unit === 'fte';
      const divisor = (isRateUnit && periods.length > 0) ? periods.length : 1;

      const byDeptPeriod = [];
      const capChanges = [];
      const cellChanges = [];
      const projMap = new Map();
      visibleProjs.forEach(p => projMap.set(p.id, { proj: p, sumA: 0, sumB: 0, deptDeltas: new Map() }));

      let totalLoadA = 0, totalLoadB = 0;
      let totalCapA = 0, totalCapB = 0;
      let addedCells = 0, incCells = 0, decCells = 0, remCells = 0;

      visibleDepts.forEach(d => {
        let dSumA = 0, dSumB = 0;
        let dCapSumA = 0, dCapSumB = 0;
        const cells = [];

        periods.forEach(pk => {
          let pLoadA = 0, pLoadB = 0;

          visibleProjs.forEach(p => {
            const fteA = getAllocationForPeriod(d.id, p.id, pk, timeUnit, stateA.allocations).avgFte;
            const fteB = getAllocationForPeriod(d.id, p.id, pk, timeUnit, stateB.allocations).avgFte;
            const valA = fteToDisplayValue(fteA, pk, timeUnit, unit);
            const valB = fteToDisplayValue(fteB, pk, timeUnit, unit);
            const delta = valB - valA;

            pLoadA += valA;
            pLoadB += valB;

            const pm = projMap.get(p.id);
            if (pm) {
              pm.sumA += valA;
              pm.sumB += valB;
              if (Math.abs(delta) > 0.005) {
                pm.deptDeltas.set(d.code, (pm.deptDeltas.get(d.code) || 0) + delta);
              }
            }

            if (Math.abs(delta) > 0.005) {
              let status = 'increased';
              if (valA <= 0.005 && valB > 0.005) { status = 'added'; addedCells++; }
              else if (valA > 0.005 && valB <= 0.005) { status = 'removed'; remCells++; }
              else if (delta > 0) { status = 'increased'; incCells++; }
              else { status = 'decreased'; decCells++; }
              cellChanges.push({ dept: d, proj: p, periodKey: pk, periodLabel: formatPeriodHeader(pk, timeUnit).title, valA, valB, delta, status });
            }
          });

          const capFteA = getDeptCapacityForPeriod(d.id, pk, timeUnit, db, stateA.capacityOverrides).avgFte;
          const capFteB = getDeptCapacityForPeriod(d.id, pk, timeUnit, db, stateB.capacityOverrides).avgFte;
          const capValA = fteToDisplayValue(capFteA, pk, timeUnit, unit);
          const capValB = fteToDisplayValue(capFteB, pk, timeUnit, unit);
          const capDelta = capValB - capValA;

          if (Math.abs(capDelta) > 0.005) {
            capChanges.push({ dept: d, periodKey: pk, periodLabel: formatPeriodHeader(pk, timeUnit).title, capA: capValA, capB: capValB, delta: capDelta });
          }

          dSumA += pLoadA; dSumB += pLoadB;
          dCapSumA += capValA; dCapSumB += capValB;
          cells.push({ periodKey: pk, loadA: pLoadA, loadB: pLoadB, loadDelta: pLoadB - pLoadA, capA: capValA, capB: capValB, capDelta });
        });

        totalLoadA += dSumA; totalLoadB += dSumB;
        totalCapA += dCapSumA; totalCapB += dCapSumB;

        const aggA = dSumA / divisor;
        const aggB = dSumB / divisor;
        byDeptPeriod.push({
          dept: d, cells, totalA: aggA, totalB: aggB, totalDelta: aggB - aggA,
          hasAnyChange: cells.some(c => Math.abs(c.loadDelta) > 0.005 || Math.abs(c.capDelta) > 0.005),
        });
      });

      const byProject = [...projMap.values()].map(pm => {
        const totalA = pm.sumA / divisor;
        const totalB = pm.sumB / divisor;
        const delta = totalB - totalA;
        const pct = totalA > 0.005 ? Math.round(((totalB - totalA) / totalA) * 100) : (totalB > 0.005 ? 100 : 0);
        const drivers = [...pm.deptDeltas.entries()]
          .map(([code, rawDelta]) => ({ code, delta: rawDelta / divisor }))
          .filter(x => Math.abs(x.delta) > 0.005)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
          .slice(0, 3);
        return { proj: pm.proj, totalA, totalB, delta, pct, drivers, hasChange: Math.abs(delta) > 0.005 || drivers.length > 0 };
      }).sort((a, b) => String(a.proj.code || '').localeCompare(String(b.proj.code || ''), undefined, { sensitivity: 'base', numeric: true }));

      cellChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      const msMapA = new Map((stateA.milestones || []).map(m => [m.id, m]));
      const msMapB = new Map((stateB.milestones || []).map(m => [m.id, m]));
      const allMsIds = new Set([...msMapA.keys(), ...msMapB.keys()]);
      const milestones = [];
      let msSlipped = 0, msEarly = 0, msAdded = 0, msRemoved = 0, totalSlipDays = 0;

      allMsIds.forEach(id => {
        const mA = msMapA.get(id);
        const mB = msMapB.get(id);
        const ref = mB || mA;
        if (ui.filterProj !== 'all' && ref.projectId !== ui.filterProj) return;
        if (ui.filterDept !== 'all' && ref.deptId && ref.deptId !== ui.filterDept) return;

        let lifecycle = 'unchanged';
        let driftDays = 0;
        const statusChanged = Boolean(mA && mB && mA.status !== mB.status);

        if (!mA && mB) { lifecycle = 'added'; msAdded++; }
        else if (mA && !mB) { lifecycle = 'removed'; msRemoved++; }
        else if (mA && mB && mA.date && mB.date) {
          driftDays = Math.round((parseISODate(mB.date) - parseISODate(mA.date)) / 86400000);
          if (driftDays > 0) { lifecycle = 'slipped'; msSlipped++; totalSlipDays += driftDays; }
          else if (driftDays < 0) { lifecycle = 'early'; msEarly++; }
        }

        milestones.push({
          id, title: ref.title, projectId: ref.projectId, deptId: ref.deptId,
          dateA: mA ? mA.date : null, dateB: mB ? mB.date : null,
          statusA: mA ? mA.status : null, statusB: mB ? mB.status : null,
          statusChanged, driftDays, lifecycle,
          hasChange: lifecycle !== 'unchanged' || statusChanged,
        });
      });

      const orderRank = { slipped: 0, removed: 1, added: 2, early: 3, unchanged: 4 };
      milestones.sort((a, b) => (orderRank[a.lifecycle] - orderRank[b.lifecycle]) || (b.driftDays - a.driftDays));

      const netLoadA = totalLoadA / divisor;
      const netLoadB = totalLoadB / divisor;
      const netLoadDelta = netLoadB - netLoadA;
      const netLoadPct = netLoadA > 0.005 ? Math.round(((netLoadB - netLoadA) / netLoadA) * 1000) / 10 : (netLoadB > 0.005 ? 100 : 0);
      const netCapDelta = (totalCapB - totalCapA) / divisor;

      return {
        labelA: stateA.label, labelB: stateB.label, unit, isRateUnit, periods,
        kpis: { netLoadA, netLoadB, netLoadDelta, netLoadPct, netCapDelta, addedCells, incCells, decCells, remCells, totalChangedCells: cellChanges.length, msSlipped, msEarly, msAdded, msRemoved, totalSlipDays },
        byDeptPeriod, byProject, cellChanges, milestones, capChanges,
      };
    }

    function renderSnapshotComparison() {
      const db = getActiveDB();
      const kpisBox = document.getElementById('snapshotCompareKpis');
      const tabsBox = document.getElementById('snapshotCompareTabs');
      const contentBox = document.getElementById('snapshotCompareContent');
      const exportBtn = document.getElementById('btnExportDiffCsv');
      if (!contentBox) return;

      const stateA = ui.compareSnapshotId ? resolveComparisonState(db, ui.compareSnapshotId) : null;
      const stateB = resolveComparisonState(db, ui.compareTargetId || '__CURRENT__');

      if (!stateA || !stateB) {
        if (kpisBox) kpisBox.classList.add('hidden');
        if (tabsBox) tabsBox.classList.add('hidden');
        if (exportBtn) exportBtn.disabled = true;
        contentBox.innerHTML = `<p class="text-xs text-slate-400">Select a <strong>Baseline (A)</strong> snapshot above (or save a new snapshot) to inspect period-by-period deltas, project scope shifts, capacity overrides, and milestone lifecycle drift.</p>`;
        return;
      }

      if (stateA.id === stateB.id) {
        if (kpisBox) kpisBox.classList.add('hidden');
        if (tabsBox) tabsBox.classList.add('hidden');
        if (exportBtn) exportBtn.disabled = true;
        contentBox.innerHTML = `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">Baseline (A) and Target (B) point to the same snapshot. Pick a different snapshot or choose <strong>Current Active Plan</strong>.</p>`;
        return;
      }

      if (exportBtn) exportBtn.disabled = false;
      const periods = getVisiblePeriods();
      const diff = computeSnapshotDiff(db, stateA, stateB, periods, ui.timeUnit, ui.manpowerUnit);
      const k = diff.kpis;
      const aggLabel = diff.isRateUnit ? `Avg ${unitShortLabel()}` : `Total ${unitShortLabel()}`;
      const changedOnly = Boolean(ui.compareChangedOnly);
      const mobileCards = isMobileViewport();

      if (kpisBox) {
        kpisBox.classList.remove('hidden');
        const loadCls = k.netLoadDelta > 0.01 ? 'text-rose-600' : k.netLoadDelta < -0.01 ? 'text-emerald-600' : 'text-slate-700';
        const loadGlyph = k.netLoadDelta > 0.01 ? '▲ ' : k.netLoadDelta < -0.01 ? '▼ ' : '';
        const capCls = k.netCapDelta > 0.01 ? 'text-emerald-600' : k.netCapDelta < -0.01 ? 'text-rose-600' : 'text-slate-700';
        const capGlyph = k.netCapDelta > 0.01 ? '▲ ' : k.netCapDelta < -0.01 ? '▼ ' : '';

        kpisBox.innerHTML = `
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 min-w-0 break-words">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Net Load Delta</div>
            <div class="text-base md:text-lg font-extrabold mt-0.5 tabular-nums ${loadCls}">${loadGlyph}${formatSignedValue(k.netLoadDelta)}</div>
            <div class="text-[11px] text-slate-500">${k.netLoadPct > 0 ? '+' : ''}${k.netLoadPct}% vs. base</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 min-w-0 break-words">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Net Cap Delta</div>
            <div class="text-base md:text-lg font-extrabold mt-0.5 tabular-nums ${capCls}">${capGlyph}${formatSignedValue(k.netCapDelta)}</div>
            <div class="text-[11px] text-slate-500">${diff.capChanges.length} override shift${diff.capChanges.length === 1 ? '' : 's'}</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 min-w-0 break-words">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cell Shifts</div>
            <div class="text-base md:text-lg font-extrabold mt-0.5 tabular-nums text-indigo-700">${k.totalChangedCells}</div>
            <div class="text-[11px] text-slate-500">+${k.addedCells} &uarr;${k.incCells} &darr;${k.decCells} &minus;${k.remCells}</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 min-w-0 break-words">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Milestones</div>
            <div class="text-base md:text-lg font-extrabold mt-0.5 tabular-nums ${k.msSlipped > 0 || k.msRemoved > 0 ? 'text-rose-600' : 'text-emerald-600'}">${k.msSlipped} Slip${k.totalSlipDays > 0 ? ` (+${k.totalSlipDays}d)` : ''}</div>
            <div class="text-[11px] text-slate-500">${k.msEarly} early &bull; ${k.msAdded} new &bull; ${k.msRemoved} rm</div>
          </div>`;
      }

      if (tabsBox) {
        tabsBox.classList.remove('hidden');
        const tabCounts = {
          deptPeriod: '',
          project: ` (${diff.byProject.filter(x => x.hasChange).length})`,
          cells: ` (${diff.cellChanges.length})`,
          milestones: ` (${diff.milestones.filter(x => x.hasChange).length})`,
          capacity: ` (${diff.capChanges.length})`,
        };
        const tabLabels = {
          deptPeriod: 'Period Diff',
          project: 'By Project',
          cells: 'Cells',
          milestones: 'Milestones',
          capacity: 'Capacity',
        };
        Object.keys(tabLabels).forEach(key => {
          const btn = document.getElementById(`snapTab-${key}`);
          if (!btn) return;
          const active = ui.compareSubTab === key;
          btn.setAttribute('aria-selected', String(active));
          btn.textContent = tabLabels[key] + tabCounts[key];
          btn.className = active
            ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-indigo-700 shadow-xs transition whitespace-nowrap'
            : 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition whitespace-nowrap';
        });
      }

      const sub = ui.compareSubTab || 'deptPeriod';

      if (sub === 'deptPeriod') {
        const rows = changedOnly ? diff.byDeptPeriod.filter(r => r.hasAnyChange) : diff.byDeptPeriod;
        if (rows.length === 0) {
          contentBox.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">No department workload or capacity differences across the visible ${periods.length} ${ui.timeUnit}s.</p>`;
          return;
        }
        contentBox.innerHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <caption class="sr-only">Department by period delta heat map comparing ${escapeHtml(diff.labelA)} and ${escapeHtml(diff.labelB)}</caption>
              <thead class="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th scope="col" class="px-3 py-2 font-bold">Department</th>
                  ${periods.map(pk => `<th scope="col" class="px-2.5 py-2 font-bold text-center whitespace-nowrap">${escapeHtml(formatPeriodHeader(pk, ui.timeUnit).shortTitle)}</th>`).join('')}
                  <th scope="col" class="px-3 py-2 font-bold text-right whitespace-nowrap">${aggLabel} &Delta;</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${rows.map(r => `
                  <tr class="hover:bg-slate-50/70">
                    <th scope="row" class="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                      <span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style="background:${r.dept.color}" aria-hidden="true"></span>${escapeHtml(r.dept.name)}
                    </th>
                    ${r.cells.map(c => {
                      const isInc = c.loadDelta > 0.005;
                      const isDec = c.loadDelta < -0.005;
                      const bgCls = isInc ? 'bg-rose-50/60 text-rose-700 font-bold' : isDec ? 'bg-emerald-50/60 text-emerald-700 font-bold' : 'text-slate-400';
                      const txt = isInc ? `▲ ${formatSignedValue(c.loadDelta)}` : isDec ? `▼ ${formatSignedValue(c.loadDelta)}` : '—';
                      const capBadge = Math.abs(c.capDelta) > 0.005
                        ? `<div class="text-[9px] font-semibold mt-0.5 ${c.capDelta > 0 ? 'text-sky-700' : 'text-amber-700'}">Cap ${formatSignedValue(c.capDelta)}</div>`
                        : '';
                      return `<td class="px-2.5 py-2 text-center tabular-nums border-l border-slate-100 ${bgCls}"><div>${txt}</div>${capBadge}</td>`;
                    }).join('')}
                    <td class="px-3 py-2 text-right font-extrabold tabular-nums border-l border-slate-200 ${r.totalDelta > 0.005 ? 'text-rose-600' : r.totalDelta < -0.005 ? 'text-emerald-600' : 'text-slate-400'}">
                      ${Math.abs(r.totalDelta) > 0.005 ? (r.totalDelta > 0 ? '▲ ' : '▼ ') + formatSignedValue(r.totalDelta) : '0'}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      } else if (sub === 'project') {
        const rows = changedOnly ? diff.byProject.filter(r => r.hasChange) : diff.byProject;
        if (rows.length === 0) {
          contentBox.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">No project scope changes detected across the visible horizon.</p>`;
          return;
        }
        if (mobileCards) {
          contentBox.innerHTML = `<div class="space-y-2.5">${rows.map(r => {
            const dCls = r.delta > 0.005 ? 'bg-rose-100 text-rose-700' : r.delta < -0.005 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500';
            const glyph = r.delta > 0.005 ? '▲ ' : r.delta < -0.005 ? '▼ ' : '';
            return `
              <div class="accent-card p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs" style="--accent-color:${r.proj.color}; --accent-w:4px; border-left:4px solid ${r.proj.color};">
                <div class="flex items-center justify-between gap-2">
                  <div class="font-bold text-slate-900 truncate"><span class="font-mono text-indigo-700 mr-1">[${escapeHtml(r.proj.code)}]</span>${escapeHtml(r.proj.name)}</div>
                  <span class="px-2 py-0.5 rounded-lg font-extrabold tabular-nums shrink-0 ${dCls}">${glyph}${formatSignedValue(r.delta)}</span>
                </div>
                <div class="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                  <span>${formatValue(r.totalA)} &rarr; <strong class="text-slate-800">${formatValue(r.totalB)}</strong></span>
                  <span>${r.pct > 0 ? '+' : ''}${r.pct}%</span>
                </div>
                ${r.drivers.length ? `<div class="flex flex-wrap gap-1 pt-0.5">${r.drivers.map(dr => `<span class="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-[10px]">${escapeHtml(dr.code)} ${formatSignedValue(dr.delta)}</span>`).join('')}</div>` : ''}
              </div>`;
          }).join('')}</div>`;
          return;
        }
        contentBox.innerHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <caption class="sr-only">Project level workload shifts</caption>
              <thead class="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th scope="col" class="px-3 py-2">Project</th>
                  <th scope="col" class="px-3 py-2 text-right">Baseline (A)</th>
                  <th scope="col" class="px-3 py-2 text-right">Target (B)</th>
                  <th scope="col" class="px-3 py-2 text-right">Delta (${aggLabel})</th>
                  <th scope="col" class="px-3 py-2 text-right">% Shift</th>
                  <th scope="col" class="px-3 py-2">Top Driving Departments</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${rows.map(r => {
                  const dCls = r.delta > 0.005 ? 'text-rose-600 font-bold' : r.delta < -0.005 ? 'text-emerald-600 font-bold' : 'text-slate-400';
                  const glyph = r.delta > 0.005 ? '▲ ' : r.delta < -0.005 ? '▼ ' : '';
                  const driversTxt = r.drivers.length
                    ? r.drivers.map(dr => `<span class="inline-block px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] mr-1">${escapeHtml(dr.code)} ${formatSignedValue(dr.delta)}</span>`).join('')
                    : '<span class="text-slate-400">—</span>';
                  return `
                    <tr class="hover:bg-slate-50/70">
                      <th scope="row" class="px-3 py-2 font-bold text-slate-900">
                        <span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style="background:${r.proj.color}" aria-hidden="true"></span>
                        <span class="font-mono text-indigo-700 mr-1">[${escapeHtml(r.proj.code)}]</span>${escapeHtml(r.proj.name)}
                      </th>
                      <td class="px-3 py-2 text-right tabular-nums text-slate-600">${formatValue(r.totalA)}</td>
                      <td class="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">${formatValue(r.totalB)}</td>
                      <td class="px-3 py-2 text-right tabular-nums ${dCls}">${glyph}${formatSignedValue(r.delta)}</td>
                      <td class="px-3 py-2 text-right tabular-nums ${dCls}">${r.pct > 0 ? '+' : ''}${r.pct}%</td>
                      <td class="px-3 py-2">${driversTxt}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
      } else if (sub === 'cells') {
        if (diff.cellChanges.length === 0) {
          contentBox.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">No individual cell allocation changes between ${escapeHtml(diff.labelA)} and ${escapeHtml(diff.labelB)}.</p>`;
          return;
        }
        const badgeStyles = { added: 'bg-indigo-100 text-indigo-700', increased: 'bg-rose-100 text-rose-700', decreased: 'bg-emerald-100 text-emerald-700', removed: 'bg-slate-200 text-slate-700' };
        const badgeLabels = { added: '● Added', increased: '▲ Inc', decreased: '▼ Dec', removed: '✕ Rm' };
        if (mobileCards) {
          contentBox.innerHTML = `<div class="space-y-2 max-h-96 overflow-y-auto">${diff.cellChanges.map(c => `
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div class="flex items-center justify-between gap-2">
                <span class="px-2 py-0.5 rounded-md font-bold text-[10px] ${badgeStyles[c.status]}">${badgeLabels[c.status]}</span>
                <span class="font-mono font-bold text-slate-600">${escapeHtml(c.periodLabel)}</span>
                <span class="font-extrabold tabular-nums ${c.delta > 0 ? 'text-rose-600' : 'text-emerald-600'}">${formatSignedValue(c.delta)}</span>
              </div>
              <div class="font-bold text-slate-900">${escapeHtml(c.dept.name)} &rarr; [${escapeHtml(c.proj.code)}] ${escapeHtml(c.proj.name)}</div>
              <div class="text-[11px] text-slate-500 tabular-nums">${formatValue(c.valA)} &rarr; <strong class="text-slate-800">${formatValue(c.valB)}</strong></div>
            </div>`).join('')}</div>`;
          return;
        }
        contentBox.innerHTML = `
          <div class="overflow-x-auto max-h-80 overflow-y-auto">
            <table class="w-full text-left text-xs">
              <caption class="sr-only">Granular cell-level allocation differences</caption>
              <thead class="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-200 sticky top-0">
                <tr>
                  <th scope="col" class="px-3 py-2">Status</th>
                  <th scope="col" class="px-3 py-2">Period</th>
                  <th scope="col" class="px-3 py-2">Department</th>
                  <th scope="col" class="px-3 py-2">Project</th>
                  <th scope="col" class="px-3 py-2 text-right">Baseline (A)</th>
                  <th scope="col" class="px-3 py-2 text-right">Target (B)</th>
                  <th scope="col" class="px-3 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${diff.cellChanges.map(c => `
                  <tr class="hover:bg-slate-50/70">
                    <td class="px-3 py-2"><span class="px-2 py-0.5 rounded-md font-bold text-[10px] ${badgeStyles[c.status]}">${badgeLabels[c.status]}</span></td>
                    <td class="px-3 py-2 font-mono font-semibold text-slate-700 whitespace-nowrap">${escapeHtml(c.periodLabel)}</td>
                    <th scope="row" class="px-3 py-2 font-semibold text-slate-900">${escapeHtml(c.dept.name)}</th>
                    <td class="px-3 py-2 text-slate-800"><span class="font-mono text-indigo-700 mr-1">[${escapeHtml(c.proj.code)}]</span>${escapeHtml(c.proj.name)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-slate-500">${formatValue(c.valA)}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">${formatValue(c.valB)}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-bold ${c.delta > 0 ? 'text-rose-600' : 'text-emerald-600'}">${formatSignedValue(c.delta)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      } else if (sub === 'milestones') {
        const rows = changedOnly ? diff.milestones.filter(m => m.hasChange) : diff.milestones;
        if (rows.length === 0) {
          contentBox.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">No milestone schedule or status differences detected.</p>`;
          return;
        }
        const getMsBadge = (m) => {
          if (m.lifecycle === 'slipped') return `<span class="px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 font-bold text-[10px]">▲ +${m.driftDays}d Slip</span>`;
          if (m.lifecycle === 'early') return `<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 font-bold text-[10px]">▼ ${m.driftDays}d Early</span>`;
          if (m.lifecycle === 'added') return `<span class="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 font-bold text-[10px]">● Added</span>`;
          if (m.lifecycle === 'removed') return `<span class="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold text-[10px]">✕ Removed</span>`;
          return '<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold text-[10px]">Unchanged</span>';
        };
        if (mobileCards) {
          contentBox.innerHTML = `<div class="space-y-2">${rows.map(m => {
            const p = db.projects.find(x => x.id === m.projectId);
            return `
              <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-bold text-slate-900 truncate"><span class="text-violet-600 mr-1">&#9670;</span>${escapeHtml(m.title)}</span>
                  ${getMsBadge(m)}
                </div>
                <div class="text-[11px] text-slate-600">${p ? `[${escapeHtml(p.code)}] ${escapeHtml(p.name)}` : '—'}</div>
                <div class="font-mono text-[11px] text-slate-500">${escapeHtml(m.dateA || '—')} &rarr; <strong class="text-slate-900">${escapeHtml(m.dateB || '—')}</strong></div>
              </div>`;
          }).join('')}</div>`;
          return;
        }
        contentBox.innerHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <caption class="sr-only">Milestone schedule drift and lifecycle changes</caption>
              <thead class="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th scope="col" class="px-3 py-2">Milestone</th>
                  <th scope="col" class="px-3 py-2">Project</th>
                  <th scope="col" class="px-3 py-2">Baseline (A)</th>
                  <th scope="col" class="px-3 py-2">Target (B)</th>
                  <th scope="col" class="px-3 py-2">Schedule / Lifecycle</th>
                  <th scope="col" class="px-3 py-2">Status Change</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${rows.map(m => {
                  const p = db.projects.find(x => x.id === m.projectId);
                  const stTxt = m.statusChanged
                    ? `<span class="text-slate-500">${escapeHtml(m.statusA)}</span> &rarr; <span class="font-bold text-indigo-700">${escapeHtml(m.statusB)}</span>`
                    : `<span class="text-slate-600">${escapeHtml(m.statusB || m.statusA || '—')}</span>`;
                  return `
                    <tr class="hover:bg-slate-50/70">
                      <th scope="row" class="px-3 py-2 font-bold text-slate-900"><span class="text-violet-600 mr-1" aria-hidden="true">◆</span>${escapeHtml(m.title)}</th>
                      <td class="px-3 py-2 text-slate-700">${p ? `[${escapeHtml(p.code)}] ${escapeHtml(p.name)}` : '—'}</td>
                      <td class="px-3 py-2 font-mono text-slate-500">${escapeHtml(m.dateA || '—')}</td>
                      <td class="px-3 py-2 font-mono font-semibold text-slate-900">${escapeHtml(m.dateB || '—')}</td>
                      <td class="px-3 py-2">${getMsBadge(m)}</td>
                      <td class="px-3 py-2">${stTxt}</td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
      } else if (sub === 'capacity') {
        if (diff.capChanges.length === 0) {
          contentBox.innerHTML = `<p class="text-xs text-slate-500 py-4 text-center">No variable capacity override changes between ${escapeHtml(diff.labelA)} and ${escapeHtml(diff.labelB)}.</p>`;
          return;
        }
        contentBox.innerHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <caption class="sr-only">Department capacity override differences</caption>
              <thead class="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th scope="col" class="px-3 py-2">Department</th>
                  <th scope="col" class="px-3 py-2">Period</th>
                  <th scope="col" class="px-3 py-2 text-right">Baseline Cap (A)</th>
                  <th scope="col" class="px-3 py-2 text-right">Target Cap (B)</th>
                  <th scope="col" class="px-3 py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${diff.capChanges.map(c => `
                  <tr class="hover:bg-slate-50/70">
                    <th scope="row" class="px-3 py-2 font-bold text-slate-900">
                      <span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style="background:${c.dept.color}" aria-hidden="true"></span>${escapeHtml(c.dept.name)}
                    </th>
                    <td class="px-3 py-2 font-mono font-semibold text-slate-700">${escapeHtml(c.periodLabel)}</td>
                    <td class="px-3 py-2 text-right tabular-nums text-slate-500">${formatValue(c.capA)}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">${formatValue(c.capB)}</td>
                    <td class="px-3 py-2 text-right tabular-nums font-bold ${c.delta > 0 ? 'text-emerald-600' : 'text-rose-600'}">${c.delta > 0 ? '▲ ' : '▼ '}${formatSignedValue(c.delta)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }
    }

    async function exportSnapshotDiffCSV() {
      const db = getActiveDB();
      const stateA = ui.compareSnapshotId ? resolveComparisonState(db, ui.compareSnapshotId) : null;
      const stateB = resolveComparisonState(db, ui.compareTargetId || '__CURRENT__');
      if (!stateA || !stateB || stateA.id === stateB.id) {
        showToast('Select two distinct states to export a diff CSV.', 'warning');
        return;
      }
      const periods = getVisiblePeriods();
      const diff = computeSnapshotDiff(db, stateA, stateB, periods, ui.timeUnit, ui.manpowerUnit);
      const uLbl = unitShortLabel();
      const rows = [
        ['Section', 'Status/Type', 'Period', 'Department', 'Project/Milestone', `Baseline (${stateA.label})`, `Target (${stateB.label})`, `Delta (${uLbl}/Days)`]
      ];
      diff.cellChanges.forEach(c => {
        rows.push(['Allocation', c.status, c.periodLabel, `${c.dept.name} [${c.dept.code}]`, `[${c.proj.code}] ${c.proj.name}`, formatValue(c.valA, ui.manpowerUnit, false), formatValue(c.valB, ui.manpowerUnit, false), formatSignedValue(c.delta, ui.manpowerUnit, false)]);
      });
      diff.capChanges.forEach(c => {
        rows.push(['Capacity', 'override', c.periodLabel, `${c.dept.name} [${c.dept.code}]`, '-', formatValue(c.capA, ui.manpowerUnit, false), formatValue(c.capB, ui.manpowerUnit, false), formatSignedValue(c.delta, ui.manpowerUnit, false)]);
      });
      diff.milestones.filter(m => m.hasChange).forEach(m => {
        rows.push(['Milestone', m.lifecycle, '-', '-', m.title, m.dateA || 'N/A', m.dateB || 'N/A', m.driftDays ? `${m.driftDays}d` : (m.statusChanged ? `${m.statusA}->${m.statusB}` : '0d')]);
      });

      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const fname = `pulseplan_snapshot_diff_${new Date().toISOString().slice(0, 10)}.csv`;
      const outcome = await shareOrDownloadFile(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), fname, 'text/csv', 'PulsePlan Snapshot Diff CSV');
      if (outcome !== 'cancelled') {
        recordDumpEvent('CSV', fname, csv.length, `Snapshot diff: ${stateA.label} vs ${stateB.label}`);
        showToast(outcome === 'shared' ? 'Snapshot Diff CSV shared' : 'Snapshot Diff CSV exported', 'success');
      }
    }

    function renderChangeLog() {
      const db = getActiveDB();
      const ret = getRetentionSettings(db);
      const countBadge = document.getElementById('changeLogCountBadge');
      if (countBadge) countBadge.textContent = `${(db.changeLog || []).length} / ${ret.maxChangeLog} max`;

      const q = (document.getElementById('changeLogSearch')?.value || '').trim().toLowerCase();
      const filtered = (db.changeLog || []).filter(item =>
        !q ||
        item.summary.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        item.user.toLowerCase().includes(q)
      );

      const container = document.getElementById('changeLogTable');
      if (filtered.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 py-4 text-center">No matching changes recorded yet.</p>';
        return;
      }

      container.innerHTML = `
        <table class="w-full text-left text-xs">
          <caption class="sr-only">Audit trail of roadmap changes</caption>
          <thead class="bg-slate-50 text-[10px] uppercase text-slate-500 border-b border-slate-200 sticky top-0">
            <tr>
              <th scope="col" class="px-3 py-2">When</th>
              <th scope="col" class="px-3 py-2">User</th>
              <th scope="col" class="px-3 py-2">Category</th>
              <th scope="col" class="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${filtered.slice(0, 150).map(l => `
              <tr class="hover:bg-slate-50">
                <td class="px-3 py-2 text-slate-500 whitespace-nowrap font-mono text-[11px]">${new Date(l.timestamp).toLocaleString()}</td>
                <td class="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap">${escapeHtml(l.user)}</td>
                <td class="px-3 py-2"><span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[10px]">${escapeHtml(l.type)}</span></td>
                <td class="px-3 py-2 text-slate-800">${escapeHtml(l.summary)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    }

