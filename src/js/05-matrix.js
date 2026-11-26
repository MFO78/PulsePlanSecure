    /* ============================================================================
     * 5A. PATTERN 1: MOBILE PERIOD-FOCUS CARD DECK & TOUCH ACTION SHEET
     * ============================================================================ */

    let _mobileSwipeStartX = 0;
    let _mobileSwipeStartY = 0;

    function selectMobilePeriod(pk) {
      if (!pk) return;
      ui.mobileSelectedPeriod = pk;
      persistUIPrefs();
      triggerHaptic(6);
      renderMobileMatrixCards();
      setTimeout(() => {
        const pill = document.querySelector(`[data-mobile-period-pill="${pk}"]`);
        if (pill && typeof pill.scrollIntoView === 'function') {
          pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
      }, 20);
    }

    function shiftMobileSelectedPeriod(delta) {
      const periods = getVisiblePeriods();
      const cur = getMobileSelectedPeriod();
      const idx = periods.indexOf(cur);
      if (idx === -1) return;
      const nextIdx = idx + delta;
      if (nextIdx >= 0 && nextIdx < periods.length) {
        selectMobilePeriod(periods[nextIdx]);
      } else {
        // Shift the underlying visible timeline smoothly if user steps past horizon edges
        shiftStartPeriod(delta);
        const newPeriods = getVisiblePeriods();
        ui.mobileSelectedPeriod = delta > 0 ? newPeriods[newPeriods.length - 1] : newPeriods[0];
        persistUIPrefs();
        renderAll();
      }
    }

    function getMobileVisibleRows(db = getActiveDB()) {
      const periods = getVisiblePeriods();
      const selectedPk = getMobileSelectedPeriod();
      const overT = db.settings.overThreshold || 100;
      const searchQ = (ui.matrixSearch || '').trim().toLowerCase();
      const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
      const visibleProjs = getSortedProjects(db).filter(p => {
        if (p.archived && ui.filterProj !== p.id) return false;
        if (!ui.includeTentative && p.tentative && ui.filterProj !== p.id) return false;
        if (ui.filterProj !== 'all' && p.id !== ui.filterProj) return false;
        if (ui.filterAtRiskOnly && p.status !== 'At Risk') return false;
        return true;
      });
      const rawRows = ui.axis === 'department' ? visibleDepts : visibleProjs;

      return rawRows.filter(row => {
        if (ui.hideEmptyRows) {
          if (ui.axis === 'department') {
            const hasActive = visibleProjs.some(p => {
              const a = getAllocationForPeriod(row.id, p.id, selectedPk, ui.timeUnit, db.allocations);
              const c = getCellProjectComments(row.id, p.id, selectedPk, ui.timeUnit, db);
              return a.hasData || c.hasAny;
            });
            if (!hasActive) return false;
          } else {
            const checkPks = ui.axis === 'timeline' ? periods : [selectedPk];
            const isAdminRow = isNonFteProject(row);
            const hasActive = checkPks.some(pk => visibleDepts.some(d => {
              const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
              const c = getCellProjectComments(d.id, row.id, pk, ui.timeUnit, db);
              return a.hasData || c.hasAny || (isAdminRow && Boolean(c.monthNote));
            }));
            if (!hasActive) return false;
          }
        }
        if (ui.filterOverOnly) {
          if (ui.axis === 'department') {
            const c = getDeptCapacityForPeriod(row.id, selectedPk, ui.timeUnit, db).avgFte;
            const a = getDeptTotalAllocatedFte(row.id, selectedPk, ui.timeUnit, db);
            const pct = c > 0 ? Math.round((a / c) * 100) : (a > 0 ? 999 : 0);
            if (pct <= overT) return false;
          } else {
            const checkPks = ui.axis === 'timeline' ? periods : [selectedPk];
            const hasBot = checkPks.some(pk => visibleDepts.some(d => {
              if (!getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations).hasData) return false;
              const dc = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
              const dt = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
              const dp = dc > 0 ? Math.round((dt / dc) * 100) : (dt > 0 ? 999 : 0);
              return dp > overT;
            }));
            if (!hasBot) return false;
          }
        }
        if (ui.filterHasNotesOnly) {
          const checkPks = ui.axis === 'timeline' ? periods : [selectedPk];
          const axisKind = ui.axis === 'department' ? 'department' : 'project';
          const hasNotes = checkPks.some(pk => getCellTotalCommentCount(row.id, pk, axisKind, ui.timeUnit, db) > 0);
          if (!hasNotes) return false;
        }
        if (searchQ) {
          if (ui.axis === 'department') {
            if ((`${row.name} ${row.code} ${row.manager || ''}`).toLowerCase().includes(searchQ)) return true;
            return visibleProjs.some(p => {
              const a = getAllocationForPeriod(row.id, p.id, selectedPk, ui.timeUnit, db.allocations);
              const c = getCellProjectComments(row.id, p.id, selectedPk, ui.timeUnit, db);
              if (!a.hasData && !c.hasAny) return false;
              return (`${p.name} ${p.code} ${p.owner || ''} ${p.techLead || ''} ${c.direct || ''}`).toLowerCase().includes(searchQ);
            });
          } else {
            if ((`${row.name} ${row.code} ${row.owner || ''} ${row.techLead || ''} ${row.status || ''}`).toLowerCase().includes(searchQ)) return true;
            const checkPks = ui.axis === 'timeline' ? periods : [selectedPk];
            return checkPks.some(pk => visibleDepts.some(d => {
              const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
              const c = getCellProjectComments(d.id, row.id, pk, ui.timeUnit, db);
              if (!a.hasData && !c.hasAny) return false;
              return (`${d.name} ${d.code} ${c.direct || ''}`).toLowerCase().includes(searchQ);
            }));
          }
        }
        return true;
      });
    }

    function updateMobileCollapseAllButton() {
      const btn = document.getElementById('mobileCollapseAllBtn');
      if (!btn) return;
      const rows = getMobileVisibleRows();
      const collapsedSet = new Set(Array.isArray(ui.mobileCollapsedIds) ? ui.mobileCollapsedIds : []);
      const allCollapsed = rows.length > 0 && rows.every(r => collapsedSet.has(r.id));
      btn.setAttribute('aria-pressed', String(allCollapsed));
      btn.innerHTML = allCollapsed
        ? `<svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 5.25l-7.5 7.5-7.5-7.5m15 6l-7.5 7.5-7.5-7.5" /></svg><span>Expand All</span>`
        : `<svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 18.75l7.5-7.5 7.5 7.5m-15-6l7.5-7.5 7.5 7.5" /></svg><span>Collapse All</span>`;
    }

    function toggleMobileCollapseAll() {
      const rows = getMobileVisibleRows();
      if (rows.length === 0) return;
      if (!Array.isArray(ui.mobileCollapsedIds)) ui.mobileCollapsedIds = [];
      const set = new Set(ui.mobileCollapsedIds);
      const allCollapsed = rows.every(r => set.has(r.id));
      if (allCollapsed) {
        rows.forEach(r => set.delete(r.id));
      } else {
        rows.forEach(r => set.add(r.id));
      }
      ui.mobileCollapsedIds = [...set];
      persistUIPrefs();
      triggerHaptic(8);
      renderMobileMatrixCards();
    }

    function onMobileAccordionToggle(rowId, isOpen) {
      if (!Array.isArray(ui.mobileCollapsedIds)) ui.mobileCollapsedIds = [];
      const set = new Set(ui.mobileCollapsedIds);
      if (isOpen) set.delete(rowId);
      else set.add(rowId);
      ui.mobileCollapsedIds = [...set];
      persistUIPrefs();
      updateMobileCollapseAllButton();
    }

    function handleMobileDeckTouchStart(event) {
      const t = event.touches && event.touches[0];
      if (!t) return;
      _mobileSwipeStartX = t.clientX;
      _mobileSwipeStartY = t.clientY;
    }

    function handleMobileDeckTouchEnd(event) {
      const t = event.changedTouches && event.changedTouches[0];
      if (!t || !_mobileSwipeStartX) return;
      const dx = t.clientX - _mobileSwipeStartX;
      const dy = t.clientY - _mobileSwipeStartY;
      _mobileSwipeStartX = 0;
      _mobileSwipeStartY = 0;
      // Require an intentional horizontal swipe (>68px and clearly horizontal)
      if (Math.abs(dx) > 68 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        shiftMobileSelectedPeriod(dx < 0 ? 1 : -1);
      }
    }

    function getVisibleMilestonesForDeptView(pk, db, visibleProjs) {
      const visibleProjIdSet = new Set((visibleProjs || []).map(p => p.id));
      const searchQ = (ui.matrixSearch || '').trim().toLowerCase();
      return getMilestonesInPeriod(pk, ui.timeUnit, db.milestones).filter(m => {
        if (ui.filterProj !== 'all' && m.projectId !== ui.filterProj) return false;
        if (m.projectId && !visibleProjIdSet.has(m.projectId)) return false;
        if (ui.filterDept !== 'all' && m.deptId && m.deptId !== ui.filterDept) return false;
        if (searchQ) {
          const p = db.projects.find(x => x.id === m.projectId);
          const d = db.departments.find(x => x.id === m.deptId);
          const hay = `${m.title || ''} ${m.notes || ''} ${m.status || ''} ${p?.name || ''} ${p?.code || ''} ${p?.owner || ''} ${p?.techLead || ''} ${d?.name || ''} ${d?.code || ''}`.toLowerCase();
          if (!hay.includes(searchQ)) return false;
        }
        return true;
      });
    }

    function renderMobileMatrixCards() {
      const db = getActiveDB();
      const deck = document.getElementById('mobileMatrixDeck');
      if (!deck) return;

      const periods = getVisiblePeriods();
      const selectedPk = getMobileSelectedPeriod();
      const warnT = db.settings.warnThreshold || 85;
      const overT = db.settings.overThreshold || 100;
      const colorMode = getActiveCellColorMode();
      const useColorFill = colorMode === 'fill' || colorMode === 'fte' || colorMode === 'fte3';
      const showComments = Boolean(ui.showCellComments);

      const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
      const visibleProjs = getSortedProjects(db).filter(p => {
        if (p.archived && ui.filterProj !== p.id) return false;
        if (!ui.includeTentative && p.tentative && ui.filterProj !== p.id) return false;
        if (ui.filterProj !== 'all' && p.id !== ui.filterProj) return false;
        if (ui.filterAtRiskOnly && p.status !== 'At Risk') return false;
        return true;
      });
      const rows = getMobileVisibleRows(db);
      const spotlightId = ui.spotlightProjId || '';
      const searchQ = (ui.matrixSearch || '').trim().toLowerCase();
      const showCost = hasAnyDayRates(db);

      // Always hide desktop status strip while Mobile Card Deck is active so stale banners (e.g. Spotlight Clear) never stick on mobile
      const desktopStatusStrip = document.getElementById('matrixStatusStrip');
      if (desktopStatusStrip) {
        desktopStatusStrip.classList.add('hidden');
        desktopStatusStrip.innerHTML = '';
      }

      const activeFilterTags = [];
      if (spotlightId) {
        const sp = db.projects.find(p => p.id === spotlightId);
        if (sp) activeFilterTags.push(`Spotlight: [${sp.code}]`);
      }
      if (ui.filterDept !== 'all') {
        const fd = db.departments.find(d => d.id === ui.filterDept);
        if (fd) activeFilterTags.push(`Dept: ${fd.code}`);
      }
      if (ui.filterProj !== 'all') {
        const fp = db.projects.find(p => p.id === ui.filterProj);
        if (fp) activeFilterTags.push(`Proj: ${fp.code}`);
      }
      if (!ui.includeTentative) activeFilterTags.push('Committed Only');
      if (searchQ) activeFilterTags.push(`"${ui.matrixSearch.trim()}"`);
      if (ui.filterOverOnly) activeFilterTags.push('Overallocated');
      if (ui.filterAtRiskOnly) activeFilterTags.push('At Risk');
      if (ui.filterHasNotesOnly) activeFilterTags.push('Has Notes');
      if (ui.hideEmptyRows) activeFilterTags.push('Active Only');

      const hasOtherMobileFilters = activeFilterTags.length > (spotlightId ? 1 : 0);
      const mobileFilterBannerHtml = activeFilterTags.length > 0
        ? `<div class="px-3 py-2 rounded-xl bg-indigo-50/80 border border-indigo-200 text-[11px] text-indigo-900 flex flex-wrap items-center justify-between gap-2">
             <span class="font-semibold break-words min-w-0">${escapeHtml(activeFilterTags.join(' • '))}</span>
             <div class="flex items-center gap-1.5 shrink-0">
               ${spotlightId ? '<button type="button" onclick="setSpotlightProject(\'\')" class="px-2 py-0.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 font-bold">Clear Spotlight</button>' : ''}
               ${(!spotlightId || hasOtherMobileFilters) ? '<button type="button" onclick="clearMatrixFilters()" class="px-2 py-0.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 font-bold">Reset</button>' : ''}
             </div>
           </div>`
        : '';

      if (db.departments.length === 0 || db.projects.length === 0) {
        deck.innerHTML = `
          <div class="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-3 shadow-xs">
            <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto" aria-hidden="true">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            </div>
            <h2 class="text-base font-bold text-slate-900">Your Mobile Roadmap is Ready</h2>
            <p class="text-xs text-slate-500">Add a Department and Project in Setup, import a shared JSON, or enable Demo Mode to explore sample data.</p>
            <div class="grid grid-cols-1 gap-2 pt-1">
              <button type="button" onclick="switchTab('data')" class="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold">Open Setup</button>
              <button type="button" onclick="toggleDemoMode()" class="w-full py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">Explore Demo Data</button>
            </div>
          </div>`;
        return;
      }

      // Mobile Executive Timeline / Gantt Deck when ui.axis === 'timeline'
      if (ui.axis === 'timeline') {
        const hdrStart = formatPeriodHeader(periods[0], ui.timeUnit).shortTitle;
        const hdrEnd = formatPeriodHeader(periods[periods.length - 1], ui.timeUnit).shortTitle;
        const totalCapByPeriod = new Map(periods.map(pk => [
          pk,
          visibleDepts.reduce((acc, d) => acc + getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte, 0),
        ]));
        const timelineCardsHtml = rows.map((p, pIdx) => {
          const spotCls = spotlightId ? (spotlightId === p.id ? 'spotlight-active' : 'spotlight-dimmed') : '';
          const isAdminP = isNonFteProject(p);
          const isFirstAdminDivider = isAdminP && pIdx > 0 && !isNonFteProject(rows[pIdx - 1]);
          const perVals = periods.map(pk => {
            const totFte = getProjTotalAllocatedFte(p.id, pk, ui.timeUnit, db);
            const activeDeptObjs = isAdminP
              ? []
              : visibleDepts.filter(d => getAllocationForPeriod(d.id, p.id, pk, ui.timeUnit, db.allocations).hasData);
            const noteDeptEntries = [];
            if (isAdminP) {
              visibleDepts.forEach(d => {
                const cObj = getCellProjectComments(d.id, p.id, pk, ui.timeUnit, db);
                if (cObj.hasAny || cObj.monthNote) {
                  noteDeptEntries.push({
                    dept: d,
                    text: (cObj.direct || cObj.weekEntries[0]?.text || cObj.monthNote || '').trim(),
                  });
                }
              });
            }
            const activeCapFte = activeDeptObjs.reduce((acc, d) => acc + getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte, 0) || totalCapByPeriod.get(pk) || 0;
            return { pk, fte: totFte, activeDepts: activeDeptObjs.map(d => d.code), noteDeptEntries, activeCapFte };
          });
          const maxFte = Math.max(0.1, ...perVals.map(v => v.fte));
          const totalHorizonDays = Math.round(perVals.reduce((acc, v) => acc + fteToDisplayValue(v.fte, v.pk, ui.timeUnit, 'days'), 0));
          const totalAdminNotes = isAdminP ? perVals.reduce((acc, v) => acc + v.noteDeptEntries.length, 0) : 0;
          const totalCost = (!isAdminP && showCost) ? getProjectTotalPlannedCost(p.id, db) : 0;
          const projMs = (db.milestones || []).filter(m => m.projectId === p.id);
          const statusCls = p.status === 'At Risk' ? 'bg-rose-100 text-rose-700' : p.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600';
          const barsHtml = perVals.map(v => {
            const h = formatPeriodHeader(v.pk, ui.timeUnit);
            const hasLoad = !isAdminP && v.fte > 0.001;
            const hasAdminNotes = isAdminP && v.noteDeptEntries.length > 0;
            const tentBarCls = p.tentative && hasLoad ? 'timeline-bar-tentative' : '';
            let barCls = 'border-slate-200 bg-slate-50';
            let cellStyle = '';
            let barInner = '';
            let tierTip = '';
            let barTitle = `${h.title}: ${hasLoad ? formatValue(fteToDisplayValue(v.fte, v.pk, ui.timeUnit)) : '0'}`;
            if (hasAdminNotes) {
              barCls = 'admin-hashed-bar';
              cellStyle = `--admin-accent:${p.color};`;
              barInner = `<span class="text-[10px] font-extrabold leading-none" aria-hidden="true">&#9998;</span>`;
              barTitle = `${h.title} (Admin · Non-FTE)\n${v.noteDeptEntries.map(n => `${n.dept.code}: ${n.text}`).join('\n')}`;
            } else if (hasLoad) {
              if (colorMode === 'accent') {
                barCls = `timeline-bar-accent ${tentBarCls}`;
                cellStyle = `--accent-color:${p.color};`;
              } else if (colorMode === 'fte3') {
                const t3 = getFte3DemandTier(v.fte, v.activeCapFte, db);
                const th = getFilledCardTheme(t3.color);
                barCls = `border-transparent ${tentBarCls}`;
                cellStyle = `background-color:${th.bg}; color:${th.text};`;
                barInner = `<span class="text-[9px] font-extrabold leading-none" aria-hidden="true">${t3.symbol}</span>`;
                tierTip = ` — ${t3.ariaLabel}`;
              } else if (colorMode === 'fte') {
                const fteHex = getFteCardColor(v.fte, v.activeCapFte);
                const th = getFilledCardTheme(fteHex);
                barCls = `border-transparent ${tentBarCls}`;
                cellStyle = `background-color:${th.bg}; color:${th.text};`;
                const pctOfCap = v.activeCapFte > 0 ? Math.round((v.fte / v.activeCapFte) * 100) : 999;
                tierTip = ` (${pctOfCap > 990 ? '>100%' : pctOfCap + '%'} cap)`;
              } else {
                const th = getFilledCardTheme(p.color);
                const opacity = (0.58 + 0.42 * (v.fte / maxFte)).toFixed(2);
                barCls = `border-transparent ${tentBarCls}`;
                cellStyle = `background-color:${th.bg}; opacity:${opacity};`;
              }
              barTitle += tierTip;
            }
            return `
              <button type="button" onclick="openCellDetailModal('${p.id}', '${v.pk}')" title="${escapeHtml(barTitle)}"
                class="flex-1 min-w-[28px] flex flex-col items-center gap-1 py-1 rounded-lg hover:bg-slate-100 transition">
                <span class="w-full h-5 rounded-md border flex items-center justify-center ${barCls}" style="${cellStyle}">${barInner}</span>
                <span class="text-[9px] font-bold text-slate-500 truncate max-w-full">${escapeHtml(h.shortTitle.split(' ')[0])}</span>
              </button>`;
          }).join('');
          const msStrip = projMs.length > 0
            ? `<div class="flex flex-wrap gap-1.5 pt-1">${projMs.slice(0, 4).map(m => {
                const drift = getMilestoneDriftDays(m);
                return `<button type="button" onclick="openMilestoneModal('${m.id}')" class="px-2 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-900 text-[11px] font-bold max-w-full truncate">&#9670; ${escapeHtml(m.title)} (${escapeHtml(m.date.slice(5))}${drift > 0 ? ` +${drift}d` : ''})</button>`;
              }).join('')}</div>`
            : '';
          const tentCardCls = p.tentative ? 'tentative-card border-dashed' : (isAdminP ? 'border-dashed' : '');
          const swatchHtml = isAdminP
            ? `<span class="w-2.5 h-8 rounded-full shrink-0 mt-0.5 admin-hashed-swatch" style="--admin-accent:${p.color}" aria-hidden="true"></span>`
            : `<span class="w-2.5 h-8 rounded-full shrink-0 mt-0.5" style="background:${p.color}" aria-hidden="true"></span>`;
          const metricHtml = isAdminP
            ? `<span class="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-bold">Admin &middot; Non-FTE</span>
               <span class="tabular-nums font-semibold">${totalAdminNotes} ${totalAdminNotes === 1 ? 'note' : 'notes'}</span>`
            : `${p.tentative ? '<span class="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">Pipeline</span>' : ''}
               <span class="tabular-nums font-semibold">${totalHorizonDays}d${totalCost > 0 ? ' • ' + formatCurrency(totalCost, db) : ''}</span>`;
          const dividerHtml = isFirstAdminDivider
            ? `<div class="pt-2 mt-1 border-t-2 border-dashed border-slate-300 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><span>Admin (Non-FTE &middot; Issues &amp; Meetings)</span></div>`
            : '';
          return `
            ${dividerHtml}
            <div class="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-2.5 ${spotCls} ${tentCardCls}">
              <div class="flex items-start justify-between gap-2 min-w-0">
                <div class="flex items-start gap-2 min-w-0 flex-1">
                  ${swatchHtml}
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-extrabold text-slate-900 break-words leading-snug">${escapeHtml(p.name)}</div>
                    <div class="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                      <span class="font-mono font-bold text-indigo-700">[${escapeHtml(p.code)}]</span>
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${statusCls}">${escapeHtml(p.status)}</span>
                      ${metricHtml}
                    </div>
                  </div>
                </div>
                <button type="button" onclick="openShiftProjectModal('${p.id}')" class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-[11px] font-bold shrink-0">&#8644; Shift</button>
              </div>
              <div class="flex items-stretch gap-1 overflow-x-auto no-scrollbar pt-0.5">${barsHtml}</div>
              ${msStrip}
            </div>`;
        }).join('');

        deck.innerHTML = `
          ${mobileFilterBannerHtml}
          <div class="bg-slate-900 text-white rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-xs">
            <div class="min-w-0">
              <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Executive Timeline</div>
              <div class="text-sm font-extrabold truncate">${escapeHtml(hdrStart)} &rarr; ${escapeHtml(hdrEnd)} (${periods.length} ${ui.timeUnit}${periods.length === 1 ? '' : 's'})</div>
            </div>
            <div class="inline-flex items-center rounded-xl bg-white/10 overflow-hidden shrink-0">
              <button type="button" aria-label="Jump back full interval" title="Jump back ${periods.length} ${ui.timeUnit}s" onclick="shiftStartByInterval(-1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-sm">&laquo;</button>
              <button type="button" aria-label="Earlier periods" onclick="shiftStartPeriod(-1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-base border-l border-white/10">&lsaquo;</button>
              <button type="button" aria-label="Later periods" onclick="shiftStartPeriod(1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-base border-l border-white/10">&rsaquo;</button>
              <button type="button" aria-label="Jump forward full interval" title="Jump forward ${periods.length} ${ui.timeUnit}s" onclick="shiftStartByInterval(1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-sm border-l border-white/10">&raquo;</button>
            </div>
          </div>
          <div class="space-y-3">
            ${timelineCardsHtml || '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">No projects match your active filters.</div>'}
          </div>`;
        return;
      }

      const curMonth = getCurrentMonthKey();
      const curWeek = getCurrentWeekKey();

      // 1. Swipeable Scroll-Snap Period Pill Strip with Org Health Dot
      const pillsHtml = periods.map(pk => {
        const h = formatPeriodHeader(pk, ui.timeUnit);
        const isSel = pk === selectedPk;
        const isNow = (ui.timeUnit === 'month' && pk === curMonth) || (ui.timeUnit === 'week' && pk === curWeek);

        let pAlloc = 0, pCap = 0, anyDeptOver = false, anyDeptWarn = false;
        visibleDepts.forEach(d => {
          const da = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
          const dc = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
          pAlloc += da; pCap += dc;
          const dp = dc > 0 ? Math.round((da / dc) * 100) : (da > 0 ? 999 : 0);
          if (dp > overT) anyDeptOver = true;
          else if (dp >= warnT) anyDeptWarn = true;
        });
        const orgPct = pCap > 0 ? Math.round((pAlloc / pCap) * 100) : 0;
        const dotColor = anyDeptOver || orgPct > overT ? 'bg-rose-500' : (anyDeptWarn || orgPct >= warnT ? 'bg-amber-400' : 'bg-emerald-400');
        const dotLabel = anyDeptOver || orgPct > overT ? 'Overallocated' : (anyDeptWarn || orgPct >= warnT ? 'High load' : 'Healthy');

        return `
          <button type="button" data-mobile-period-pill="${pk}"
            aria-current="${isSel ? 'date' : 'false'}"
            onclick="selectMobilePeriod('${pk}')"
            class="snap-center shrink-0 min-h-[44px] px-3 py-1.5 rounded-xl border text-left transition flex items-center gap-2 ${isSel ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-700'}">
            <div class="leading-tight">
              <div class="text-xs font-extrabold whitespace-nowrap">${escapeHtml(h.shortTitle)}${isNow ? ' •' : ''}</div>
              <div class="text-[10px] ${isSel ? 'text-indigo-100' : 'text-slate-400'} tabular-nums">${orgPct}%</div>
            </div>
            <span class="w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ${isSel ? 'ring-white/40' : 'ring-slate-100'} shrink-0" title="${dotLabel}" aria-label="${dotLabel}"></span>
          </button>`;
      }).join('');

      // 2. Active Period Company Summary Banner
      let selTotA = 0, selTotC = 0;
      visibleDepts.forEach(d => {
        selTotA += getDeptTotalAllocatedFte(d.id, selectedPk, ui.timeUnit, db);
        selTotC += getDeptCapacityForPeriod(d.id, selectedPk, ui.timeUnit, db).avgFte;
      });
      const selPct = selTotC > 0 ? Math.round((selTotA / selTotC) * 100) : 0;
      const selHdr = formatPeriodHeader(selectedPk, ui.timeUnit);
      const selPctCls = selPct > overT ? 'text-rose-300' : selPct >= warnT ? 'text-amber-300' : 'text-emerald-300';

      const summaryStripHtml = `
        <div class="bg-slate-900 text-white rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-xs">
          <div class="min-w-0">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${escapeHtml(selHdr.title)} (${escapeHtml(selHdr.sub)})</div>
            <div class="text-sm font-extrabold tabular-nums">
              ${formatValue(fteToDisplayValue(selTotA, selectedPk, ui.timeUnit))}
              <span class="text-xs font-medium text-slate-400">/ ${formatValue(fteToDisplayValue(selTotC, selectedPk, ui.timeUnit))}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-base font-extrabold tabular-nums ${selPctCls}">${selPct}%</span>
            <div class="inline-flex items-center rounded-xl bg-white/10 overflow-hidden">
              <button type="button" aria-label="Jump back full interval" title="Jump back ${periods.length} ${ui.timeUnit}s" onclick="shiftStartByInterval(-1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-sm">&laquo;</button>
              <button type="button" aria-label="Previous period" onclick="shiftMobileSelectedPeriod(-1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-base border-l border-white/10">&lsaquo;</button>
              <button type="button" aria-label="Next period" onclick="shiftMobileSelectedPeriod(1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-base border-l border-white/10">&rsaquo;</button>
              <button type="button" aria-label="Jump forward full interval" title="Jump forward ${periods.length} ${ui.timeUnit}s" onclick="shiftStartByInterval(1)" class="w-8 h-9 flex items-center justify-center hover:bg-white/15 font-bold text-sm border-l border-white/10">&raquo;</button>
            </div>
          </div>
        </div>`;

      const collapsedSet = new Set(Array.isArray(ui.mobileCollapsedIds) ? ui.mobileCollapsedIds : []);

      const resolveCardStyle = (fteVal, capFte, entityColor) => {
        if (colorMode === 'fte3') {
          const t3 = getFte3DemandTier(fteVal, capFte, db);
          return { fillHex: t3.color, tier3: t3, showIdentityDot: true };
        }
        if (colorMode === 'fte') {
          return { fillHex: getFteCardColor(fteVal, capFte), tier3: null, showIdentityDot: true };
        }
        return { fillHex: entityColor, tier3: null, showIdentityDot: false };
      };

      const renderMobileCommentBlock = (cmtObj, filledTheme) => {
        if (!showComments || !cmtObj.hasAny) return '';
        const fmt = (txt, cls) => (typeof ppFormatRoadmapNoteHtml === 'function')
          ? ppFormatRoadmapNoteHtml(txt, cls)
          : `<div class="${cls}">${escapeHtml(txt)}</div>`;
        const parts = [];
        if (cmtObj.direct) parts.push(fmt(cmtObj.direct, 'whitespace-pre-line break-words mobile-wrap-anywhere'));
        cmtObj.weekEntries.forEach(we => {
          const wkPrefix = filledTheme
            ? `<span class="font-mono font-bold underline">${escapeHtml(we.weekShort)}:</span>`
            : `<span class="font-mono font-bold text-indigo-600">${escapeHtml(we.weekShort)}:</span>`;
          parts.push(`<div class="space-y-0.5">${wkPrefix} ${fmt(we.text, 'whitespace-pre-line break-words mobile-wrap-anywhere inline')}</div>`);
        });
        if (filledTheme) {
          return `<div class="mt-2 px-2.5 py-1.5 rounded-lg text-xs leading-relaxed space-y-0.5 break-words" style="background-color:${filledTheme.commentBg}; border:1px solid ${filledTheme.commentBorder}; color:${filledTheme.commentText};">${parts.join('')}</div>`;
        }
        return `<div class="accent-card-comment mt-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-600 leading-relaxed space-y-0.5 break-words">${parts.join('')}</div>`;
      };

      // 3. Semantic <details> Accordion Cards (Departments or Projects)
      const accordionCardsHtml = rows.map((row, rowIdx) => {
        const isOpen = !collapsedSet.has(row.id);

        if (ui.axis === 'department') {
          const capObj = getDeptCapacityForPeriod(row.id, selectedPk, ui.timeUnit, db);
          const capFte = capObj.avgFte;
          const capDelta = Math.round((capFte - (Number(row.defaultCapacity) || 0)) * 100) / 100;
          const varBadgeLabel = capObj.hasOverride ? (capDelta > 0.005 ? 'Var ▲' : capDelta < -0.005 ? 'Var ▼' : 'Var') : '';
          const allocFte = getDeptTotalAllocatedFte(row.id, selectedPk, ui.timeUnit, db);
          const pct = capFte > 0 ? Math.round((allocFte / capFte) * 100) : (allocFte > 0 ? 999 : 0);
          const barColor = pct > overT ? 'bg-rose-500' : pct >= warnT ? 'bg-amber-500' : 'bg-emerald-500';
          const badgeCls = pct > overT ? 'bg-rose-100 text-rose-700' : pct >= warnT ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
          const borderHighlight = pct > overT ? 'border-rose-300' : pct >= warnT ? 'border-amber-300' : 'border-slate-200';
          const allocDisp = formatValue(fteToDisplayValue(allocFte, selectedPk, ui.timeUnit), ui.manpowerUnit, false);
          const capDisp = formatValue(fteToDisplayValue(capFte, selectedPk, ui.timeUnit), ui.manpowerUnit, true);

          const itemsHtml = visibleProjs.map(p => {
            const a = getAllocationForPeriod(row.id, p.id, selectedPk, ui.timeUnit, db.allocations);
            const cmtObj = getCellProjectComments(row.id, p.id, selectedPk, ui.timeUnit, db);
            if (!a.hasData && !cmtObj.hasAny) return '';
            if (searchQ && !(`${row.name} ${row.code} ${p.name} ${p.code} ${p.owner || ''} ${p.techLead || ''} ${cmtObj.direct || ''}`).toLowerCase().includes(searchQ)) return '';

            const spotCls = spotlightId ? (spotlightId === p.id ? 'spotlight-active' : 'spotlight-dimmed') : '';
            const tentCls = p.tentative ? (useColorFill ? 'tentative-card-filled' : 'tentative-card') : '';
            const isAdminProj = isNonFteProject(p);
            if (isAdminProj && !a.hasData && cmtObj.hasAny) {
              const adminCmtHtml = renderMobileCommentBlock(cmtObj, null);
              return `
                <div class="admin-hashed-card rounded-xl p-3 shadow-2xs space-y-2 min-w-0 ${spotCls}"
                  style="--admin-accent:${p.color}; --accent-w:5px;">
                  <button type="button" onclick="openAllocationModal('${row.id}', '${p.id}', '${selectedPk}')" class="w-full min-w-0 text-left block">
                    <div class="text-sm font-bold text-slate-900 break-words leading-snug">${escapeHtml(p.name)}</div>
                    <div class="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] font-mono font-bold text-slate-500">
                      <span>[${escapeHtml(p.code)}]</span>
                      <span class="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-[9px] font-extrabold uppercase shrink-0">Admin</span>
                    </div>
                  </button>
                  <div class="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-200">
                    <span class="px-2 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-bold">&#9998; Admin &middot; Non-FTE</span>
                    <button type="button" aria-label="More actions for ${escapeHtml(p.name)}" onclick="openMobileCardActionSheet('${row.id}', '${p.id}', '${selectedPk}')"
                      class="h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 font-extrabold text-xs flex items-center justify-center gap-1">Actions &#8943;</button>
                  </div>
                  ${adminCmtHtml}
                </div>`;
            }
            const resolvedStyle = resolveCardStyle(a.hasData ? a.avgFte : 0, capFte, p.color);
            const { fillHex, tier3, showIdentityDot } = resolvedStyle;
            const filledTheme = useColorFill ? getFilledCardTheme(fillHex) : null;
            const cmtHtml = renderMobileCommentBlock(cmtObj, filledTheme);
            const valStr = a.hasData ? formatValue(fteToDisplayValue(a.avgFte, selectedPk, ui.timeUnit)) : (isAdminProj ? 'Admin' : 'Note');
            const tierBadge = tier3
              ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};" aria-label="${escapeHtml(tier3.ariaLabel)}">${tier3.symbol}</span>`
              : '';
            const pipeTagFilled = isAdminProj
              ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">Admin</span>`
              : (p.tentative
                  ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">Pipeline</span>`
                  : '');
            const pipeTagAccent = isAdminProj
              ? '<span class="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-[9px] font-extrabold uppercase shrink-0">Admin</span>'
              : (p.tentative
                  ? '<span class="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[9px] font-extrabold uppercase shrink-0">Pipeline</span>'
                  : '');
            const noteOnlyLabel = isAdminProj ? 'Admin &middot; Non-FTE' : 'Note Only';

            if (useColorFill) {
              return `
                <div class="rounded-xl p-3 shadow-xs transition space-y-2 min-w-0 ${spotCls} ${tentCls}"
                  style="background-color:${filledTheme.bg}; color:${filledTheme.text}; border: ${a.hasData && !p.tentative ? '1px solid' : '1.5px dashed'} ${filledTheme.border};">
                  <button type="button" onclick="openAllocationModal('${row.id}', '${p.id}', '${selectedPk}')" class="w-full flex items-start gap-2 min-w-0 text-left">
                    ${showIdentityDot ? `<span class="w-2.5 h-2.5 rounded-full ring-1 ring-white/80 shrink-0 mt-1" style="background:${p.color}" aria-hidden="true"></span>` : ''}
                    ${tierBadge}
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-extrabold break-words leading-snug">${escapeHtml(p.name)}</div>
                      <div class="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] font-mono font-bold" style="color:${filledTheme.mutedText};">
                        <span>[${escapeHtml(p.code)}]</span>
                        ${pipeTagFilled}
                        ${a.isUneven ? '<span>• Uneven wks</span>' : ''}
                      </div>
                    </div>
                  </button>
                  <div class="flex items-center justify-between gap-1.5 pt-1.5 border-t border-white/15">
                    <div class="flex items-center gap-1.5">
                      ${a.hasData ? `
                        <button type="button" aria-label="Decrease ${escapeHtml(p.name)}" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${selectedPk}', -1)"
                          class="w-9 h-8 rounded-lg font-extrabold text-base flex items-center justify-center" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">&minus;</button>
                        <span class="min-w-[56px] text-center text-xs font-extrabold tabular-nums">${valStr}</span>
                        <button type="button" aria-label="Increase ${escapeHtml(p.name)}" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${selectedPk}', 1)"
                          class="w-9 h-8 rounded-lg font-extrabold text-base flex items-center justify-center" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">+</button>
                      ` : `<span class="px-2 py-1 rounded-lg text-[11px] font-bold" style="background-color:${filledTheme.chipBg};">${noteOnlyLabel}</span>`}
                    </div>
                    <button type="button" aria-label="More actions for ${escapeHtml(p.name)}" onclick="openMobileCardActionSheet('${row.id}', '${p.id}', '${selectedPk}')"
                      class="h-8 px-2.5 rounded-lg font-extrabold text-xs flex items-center justify-center gap-1" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">Actions &#8943;</button>
                  </div>
                  ${cmtHtml}
                </div>`;
            }

            return `
              <div class="accent-card rounded-xl p-3 bg-white border border-slate-200 shadow-2xs space-y-2 min-w-0 ${spotCls} ${tentCls}"
                style="--accent-color:${p.color}; --accent-w:5px; border-left: 5px solid ${p.color};">
                <button type="button" onclick="openAllocationModal('${row.id}', '${p.id}', '${selectedPk}')" class="w-full min-w-0 text-left block">
                  <div class="text-sm font-bold text-slate-900 break-words leading-snug">${escapeHtml(p.name)}</div>
                  <div class="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] font-mono font-bold text-slate-500">
                    <span>[${escapeHtml(p.code)}]</span>
                    ${pipeTagAccent}
                    ${a.isUneven ? '<span>• Uneven wks</span>' : ''}
                  </div>
                </button>
                <div class="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
                  <div class="flex items-center gap-1.5">
                    ${a.hasData ? `
                      <button type="button" aria-label="Decrease ${escapeHtml(p.name)}" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${selectedPk}', -1)"
                        class="w-9 h-8 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-800 font-extrabold text-base flex items-center justify-center">&minus;</button>
                      <span class="min-w-[56px] text-center text-xs font-extrabold text-slate-900 tabular-nums">${valStr}</span>
                      <button type="button" aria-label="Increase ${escapeHtml(p.name)}" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${selectedPk}', 1)"
                        class="w-9 h-8 rounded-lg bg-slate-100 hover:bg-emerald-100 text-slate-800 font-extrabold text-base flex items-center justify-center">+</button>
                    ` : `<span class="px-2 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-bold">${noteOnlyLabel}</span>`}
                  </div>
                  <button type="button" aria-label="More actions for ${escapeHtml(p.name)}" onclick="openMobileCardActionSheet('${row.id}', '${p.id}', '${selectedPk}')"
                    class="h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 font-extrabold text-xs flex items-center justify-center gap-1">Actions &#8943;</button>
                </div>
                ${cmtHtml}
              </div>`;
          }).join('');

          const mobileFixBtn = pct > overT
            ? `<button type="button" onclick="openBottleneckResolverModal('${row.id}', '${selectedPk}')"
                 class="w-full min-h-[38px] rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-extrabold flex items-center justify-center gap-1.5">&#9888; Resolve Overallocation (${pct}%)</button>`
            : '';

          return `
            <details ${isOpen ? 'open' : ''} ontoggle="onMobileAccordionToggle('${row.id}', this.open)"
              class="bg-white rounded-2xl border ${borderHighlight} shadow-xs overflow-hidden min-w-0">
              <summary class="no-marker cursor-pointer p-3.5 select-none space-y-2">
                <div class="flex items-center justify-between gap-2 min-w-0">
                  <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <span class="w-2 h-9 rounded-full shrink-0" style="background:${row.color}" aria-hidden="true"></span>
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-extrabold text-slate-900 truncate">${escapeHtml(row.name)}</div>
                      <div class="text-xs text-slate-500 flex flex-wrap items-center gap-1.5 tabular-nums">
                        <span class="whitespace-nowrap">${allocDisp} / ${capDisp}</span>
                        ${capObj.hasOverride ? `<span title="Override vs base ${row.defaultCapacity} FTE" class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">${varBadgeLabel}</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <span class="px-2 py-1 rounded-lg text-xs font-extrabold tabular-nums ${badgeCls}">${pct > 990 ? '&infin;' : pct + '%'}</span>
                    <svg class="accordion-chevron w-4 h-4 text-slate-400 transition-transform" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </div>
                <div class="w-full h-2 rounded-full bg-slate-200/80 overflow-hidden" aria-hidden="true">
                  <div class="h-full ${barColor} rounded-full transition-all" style="width:${Math.min(100, pct)}%"></div>
                </div>
              </summary>
              <div class="px-3.5 pb-3.5 pt-2 border-t border-slate-100 space-y-2.5">
                ${mobileFixBtn}
                ${itemsHtml || '<p class="text-xs text-slate-400 text-center py-2">No allocations in this period.</p>'}
                <div class="grid grid-cols-3 gap-1.5 pt-1">
                  <button type="button" onclick="openAllocationModal('${row.id}', '', '${selectedPk}')"
                    class="min-h-[40px] px-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-bold truncate">+ Allocate</button>
                  <button type="button" onclick="openCapacityModal('${row.id}', '${selectedPk}')"
                    class="min-h-[40px] px-1.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-bold truncate">Capacity</button>
                  <button type="button" onclick="openCellDetailModal('${row.id}', '${selectedPk}')"
                    class="min-h-[40px] px-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-[11px] font-bold truncate">Notes</button>
                </div>
              </div>
            </details>`;
        } else {
          // Mobile Project Accordion Card
          const isAdminRow = isNonFteProject(row);
          const isFirstAdminMobileDivider = isAdminRow && rowIdx > 0 && !isNonFteProject(rows[rowIdx - 1]);
          const totFte = getProjTotalAllocatedFte(row.id, selectedPk, ui.timeUnit, db);
          const periodAdminNotesCount = isAdminRow ? getCellTotalCommentCount(row.id, selectedPk, 'project', ui.timeUnit, db) : 0;
          const totStr = isAdminRow
            ? (periodAdminNotesCount > 0 ? `${periodAdminNotesCount} ${periodAdminNotesCount === 1 ? 'note' : 'notes'}` : 'Admin')
            : (totFte > 0 ? formatValue(fteToDisplayValue(totFte, selectedPk, ui.timeUnit)) : '0 ' + unitShortLabel());
          const statusCls = row.status === 'At Risk' ? 'bg-rose-100 text-rose-700' : row.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600';
          const rowSpotCls = spotlightId ? (spotlightId === row.id ? 'spotlight-active' : 'spotlight-dimmed') : '';
          const tentProjCls = row.tentative ? 'tentative-card border-dashed' : (isAdminRow ? 'border-dashed' : '');

          const itemsHtml = visibleDepts.map(d => {
            const a = getAllocationForPeriod(d.id, row.id, selectedPk, ui.timeUnit, db.allocations);
            const cmtObj = getCellProjectComments(d.id, row.id, selectedPk, ui.timeUnit, db);
            if (!a.hasData && !cmtObj.hasAny) return '';
            if (searchQ && !(`${d.name} ${d.code} ${row.name} ${row.code} ${cmtObj.direct || ''}`).toLowerCase().includes(searchQ)) return '';

            if (isAdminRow && !a.hasData && cmtObj.hasAny) {
              const adminCmtHtml = renderMobileCommentBlock(cmtObj, null);
              return `
                <div class="admin-hashed-card rounded-xl p-3 shadow-2xs space-y-2 min-w-0"
                  style="--admin-accent:${d.color}; --accent-w:5px;">
                  <button type="button" onclick="openAllocationModal('${d.id}', '${row.id}', '${selectedPk}')" class="w-full min-w-0 text-left block">
                    <div class="text-sm font-bold text-slate-900 break-words leading-snug">${escapeHtml(d.name)}</div>
                    <div class="text-[11px] font-mono font-bold text-slate-500">[${escapeHtml(d.code)}]</div>
                  </button>
                  <div class="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-200">
                    <span class="px-2 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-bold">&#9998; Admin &middot; Non-FTE</span>
                    <button type="button" aria-label="More actions for ${escapeHtml(d.name)}" onclick="openMobileCardActionSheet('${d.id}', '${row.id}', '${selectedPk}')"
                      class="h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 font-extrabold text-xs flex items-center justify-center gap-1">Actions &#8943;</button>
                  </div>
                  ${adminCmtHtml}
                </div>`;
            }

            const deptCap = getDeptCapacityForPeriod(d.id, selectedPk, ui.timeUnit, db).avgFte;
            const { fillHex, tier3, showIdentityDot } = resolveCardStyle(a.hasData ? a.avgFte : 0, deptCap, d.color);
            const filledTheme = useColorFill ? getFilledCardTheme(fillHex) : null;
            const cmtHtml = renderMobileCommentBlock(cmtObj, filledTheme);
            const valStr = a.hasData ? formatValue(fteToDisplayValue(a.avgFte, selectedPk, ui.timeUnit)) : (isAdminRow ? 'Admin' : 'Note');
            const noteOnlyLabel = isAdminRow ? 'Admin &middot; Non-FTE' : 'Note Only';
            const tierBadge = tier3
              ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-extrabold shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">${tier3.symbol}</span>`
              : '';

            if (useColorFill) {
              return `
                <div class="rounded-xl p-3 shadow-xs space-y-2 min-w-0"
                  style="background-color:${filledTheme.bg}; color:${filledTheme.text}; border: ${a.hasData ? '1px solid' : '1.5px dashed'} ${filledTheme.border};">
                  <button type="button" onclick="openAllocationModal('${d.id}', '${row.id}', '${selectedPk}')" class="w-full flex items-start gap-2 min-w-0 text-left">
                    ${showIdentityDot ? `<span class="w-2.5 h-2.5 rounded-full ring-1 ring-white/80 shrink-0 mt-1" style="background:${d.color}" aria-hidden="true"></span>` : ''}
                    ${tierBadge}
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-extrabold break-words leading-snug">${escapeHtml(d.name)}</div>
                      <div class="text-[11px] font-mono font-bold" style="color:${filledTheme.mutedText};">[${escapeHtml(d.code)}]</div>
                    </div>
                  </button>
                  <div class="flex items-center justify-between gap-1.5 pt-1.5 border-t border-white/15">
                    <div class="flex items-center gap-1.5">
                      ${a.hasData ? `
                        <button type="button" aria-label="Decrease ${escapeHtml(d.name)}" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${selectedPk}', -1)"
                          class="w-9 h-8 rounded-lg font-extrabold text-base flex items-center justify-center" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">&minus;</button>
                        <span class="min-w-[56px] text-center text-xs font-extrabold tabular-nums">${valStr}</span>
                        <button type="button" aria-label="Increase ${escapeHtml(d.name)}" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${selectedPk}', 1)"
                          class="w-9 h-8 rounded-lg font-extrabold text-base flex items-center justify-center" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">+</button>
                      ` : `<span class="px-2 py-1 rounded-lg text-[11px] font-bold" style="background-color:${filledTheme.chipBg};">${noteOnlyLabel}</span>`}
                    </div>
                    <button type="button" aria-label="More actions for ${escapeHtml(d.name)}" onclick="openMobileCardActionSheet('${d.id}', '${row.id}', '${selectedPk}')"
                      class="h-8 px-2.5 rounded-lg font-extrabold text-xs flex items-center justify-center gap-1" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">Actions &#8943;</button>
                  </div>
                  ${cmtHtml}
                </div>`;
            }

            return `
              <div class="accent-card rounded-xl p-3 bg-white border border-slate-200 shadow-2xs space-y-2 min-w-0"
                style="--accent-color:${d.color}; --accent-w:5px; border-left: 5px solid ${d.color};">
                <button type="button" onclick="openAllocationModal('${d.id}', '${row.id}', '${selectedPk}')" class="w-full min-w-0 text-left block">
                  <div class="text-sm font-bold text-slate-900 break-words leading-snug">${escapeHtml(d.name)}</div>
                  <div class="text-[11px] font-mono font-bold text-slate-500">[${escapeHtml(d.code)}]</div>
                </button>
                <div class="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100">
                  <div class="flex items-center gap-1.5">
                    ${a.hasData ? `
                      <button type="button" aria-label="Decrease ${escapeHtml(d.name)}" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${selectedPk}', -1)"
                        class="w-9 h-8 rounded-lg bg-slate-100 text-slate-800 font-extrabold text-base flex items-center justify-center">&minus;</button>
                      <span class="min-w-[56px] text-center text-xs font-extrabold text-slate-900 tabular-nums">${valStr}</span>
                      <button type="button" aria-label="Increase ${escapeHtml(d.name)}" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${selectedPk}', 1)"
                        class="w-9 h-8 rounded-lg bg-slate-100 text-slate-800 font-extrabold text-base flex items-center justify-center">+</button>
                    ` : `<span class="px-2 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-bold">${noteOnlyLabel}</span>`}
                  </div>
                  <button type="button" aria-label="More actions for ${escapeHtml(d.name)}" onclick="openMobileCardActionSheet('${d.id}', '${row.id}', '${selectedPk}')"
                    class="h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 font-extrabold text-xs flex items-center justify-center gap-1">Actions &#8943;</button>
                </div>
                ${cmtHtml}
              </div>`;
          }).join('');

          const msHtml = getMilestonesInPeriod(selectedPk, ui.timeUnit, db.milestones)
            .filter(m => m.projectId === row.id)
            .map(m => `
              <button type="button" onclick="openMilestoneModal('${m.id}')"
                class="w-full min-h-[40px] px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 text-violet-900 text-xs font-bold flex flex-wrap items-center justify-between gap-1.5 text-left">
                <span class="min-w-0 break-words"><span class="text-violet-600 mr-1.5" aria-hidden="true">&#9670;</span>${escapeHtml(m.title)}</span>
                <span class="font-mono text-[11px] text-violet-700 shrink-0">${escapeHtml(m.date)}</span>
              </button>`).join('');

          const mobileAdminDividerHtml = isFirstAdminMobileDivider
            ? `<div class="pt-2 mt-1 border-t-2 border-dashed border-slate-300 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><span>Admin (Non-FTE &middot; Issues &amp; Meetings)</span></div>`
            : '';
          const mobileProjSwatchHtml = isAdminRow
            ? `<span class="w-2.5 h-9 rounded-full shrink-0 admin-hashed-swatch" style="--admin-accent:${row.color}" aria-hidden="true"></span>`
            : `<span class="w-2 h-9 rounded-full shrink-0" style="background:${row.color}" aria-hidden="true"></span>`;

          return `
            ${mobileAdminDividerHtml}
            <details ${isOpen ? 'open' : ''} ontoggle="onMobileAccordionToggle('${row.id}', this.open)"
              class="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden min-w-0 ${rowSpotCls} ${tentProjCls}">
              <summary class="no-marker cursor-pointer p-3.5 select-none">
                <div class="flex items-center justify-between gap-2 min-w-0">
                  <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    ${mobileProjSwatchHtml}
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-extrabold text-slate-900 truncate">${escapeHtml(row.name)}</div>
                      <div class="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                        <span class="font-mono font-bold text-indigo-700">[${escapeHtml(row.code)}]</span>
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${statusCls}">${escapeHtml(row.status)}</span>
                        ${isAdminRow ? '<span class="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-bold">Admin &middot; Non-FTE</span>' : ''}
                        ${row.tentative ? '<span class="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">Pipeline</span>' : ''}
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-xs font-extrabold text-slate-900 tabular-nums">${totStr}</span>
                    <svg class="accordion-chevron w-4 h-4 text-slate-400 transition-transform" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </div>
              </summary>
              <div class="px-3.5 pb-3.5 pt-2 border-t border-slate-100 space-y-2.5">
                ${itemsHtml || '<p class="text-xs text-slate-400 text-center py-2">No departments assigned in this period.</p>'}
                ${msHtml}
                <div class="grid grid-cols-2 gap-1.5 pt-1">
                  <button type="button" onclick="openAllocationModal('', '${row.id}', '${selectedPk}')"
                    class="min-h-[40px] px-2 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold truncate">+ Assign Dept</button>
                  <button type="button" onclick="openCellDetailModal('${row.id}', '${selectedPk}')"
                    class="min-h-[40px] px-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold truncate">Notes</button>
                </div>
              </div>
            </details>`;
        }
      }).join('');

      const allCollapsed = rows.length > 0 && rows.every(r => collapsedSet.has(r.id));
      const rowNoun = ui.axis === 'department' ? (rows.length === 1 ? 'Department' : 'Departments') : (rows.length === 1 ? 'Project' : 'Projects');
      const collapseBarHtml = rows.length > 0
        ? `<div class="flex items-center justify-between gap-2 px-0.5">
             <span class="text-[11px] font-bold uppercase tracking-wider text-slate-500">${rows.length} ${rowNoun}</span>
             <button id="mobileCollapseAllBtn" type="button" aria-pressed="${allCollapsed}" onclick="toggleMobileCollapseAll()"
               class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold shadow-2xs transition cursor-pointer shrink-0">
               ${allCollapsed
                 ? `<svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 5.25l-7.5 7.5-7.5-7.5m15 6l-7.5 7.5-7.5-7.5" /></svg><span>Expand All</span>`
                 : `<svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 18.75l7.5-7.5 7.5 7.5m-15-6l7.5-7.5 7.5 7.5" /></svg><span>Collapse All</span>`}
             </button>
           </div>`
        : '';

      // Dedicated Milestones Card Section for Mobile By Department view
      let mobileMilestonesFieldHtml = '';
      if (ui.axis === 'department') {
        const periodMilestones = getVisibleMilestonesForDeptView(selectedPk, db, visibleProjs);
        const msCards = periodMilestones.map(m => {
          const p = db.projects.find(x => x.id === m.projectId);
          const d = db.departments.find(x => x.id === m.deptId);
          const drift = getMilestoneDriftDays(m);
          const msSpotCls = spotlightId ? (spotlightId === m.projectId ? 'spotlight-active' : 'spotlight-dimmed') : '';
          return `
            <button type="button" onclick="openMilestoneModal('${m.id}')"
              class="w-full min-h-[40px] px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 text-violet-900 text-xs font-bold flex flex-wrap items-center justify-between gap-1.5 text-left ${msSpotCls}">
              <span class="min-w-0 break-words inline-flex items-center gap-1.5">
                <span class="text-violet-600 shrink-0" aria-hidden="true">&#9670;</span>
                ${p ? `<span class="w-2 h-2 rounded-full shrink-0" style="background:${p.color}" aria-hidden="true"></span>` : ''}
                <span>${escapeHtml(m.title)}</span>
              </span>
              <span class="font-mono text-[11px] text-violet-700 shrink-0 flex items-center gap-1">
                ${p ? `<span>[${escapeHtml(p.code)}]</span>` : ''}
                ${d ? `<span class="px-1 rounded bg-white border border-violet-200 text-[10px]">${escapeHtml(d.code)}</span>` : ''}
                <span>${escapeHtml(m.date)}</span>
                ${drift > 0 ? `<span class="text-rose-600">+${drift}d</span>` : ''}
              </span>
            </button>`;
        }).join('');
        mobileMilestonesFieldHtml = `
          <div data-mobile-milestones-field="1" class="bg-white rounded-2xl border border-violet-200 p-3 shadow-xs space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-violet-600 font-bold" aria-hidden="true">&#9670;</span>
                <span class="text-xs font-extrabold text-violet-900 uppercase tracking-wider">Milestones</span>
                <span class="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold tabular-nums">${periodMilestones.length}</span>
              </div>
              <button type="button" onclick="openMilestoneModal('', '${ui.filterProj !== 'all' ? ui.filterProj : ''}', '${getPeriodMidDateISO(selectedPk, ui.timeUnit)}', '${ui.filterDept !== 'all' ? ui.filterDept : ''}')"
                class="px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-[11px] font-bold">+ Milestone</button>
            </div>
            ${msCards || '<p class="text-[11px] text-slate-400 text-center py-1">No milestones scheduled in this period.</p>'}
          </div>`;
      }

      deck.innerHTML = `
        ${mobileFilterBannerHtml}
        <nav aria-label="Select roadmap period" class="flex items-center gap-2 overflow-x-auto snap-x snap-mandatory no-scrollbar py-0.5">
          ${pillsHtml}
        </nav>
        ${summaryStripHtml}
        ${mobileMilestonesFieldHtml}
        ${collapseBarHtml}
        <div class="space-y-3" ontouchstart="handleMobileDeckTouchStart(event)" ontouchend="handleMobileDeckTouchEnd(event)">
          ${accordionCardsHtml || '<div class="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">No rows match the active filters. <button type="button" onclick="clearMatrixFilters()" class="ml-1 font-bold text-indigo-600 underline">Reset</button></div>'}
        </div>`;
    }

    /* ---------- Mobile Touch Card Action Sheet (Replaces Drag-and-Drop on Touch) ---------- */

    function openMobileCardActionSheet(deptId, projId, periodKey) {
      const db = getActiveDB();
      const dept = db.departments.find(d => d.id === deptId);
      const proj = db.projects.find(p => p.id === projId);
      const sheet = document.getElementById('mobileCardActionSheet');
      const body = document.getElementById('mobileCardActionBody');
      if (!sheet || !body || !dept || !proj) return;

      const alloc = getAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, db.allocations);
      const valStr = alloc.hasData ? formatValue(fteToDisplayValue(alloc.avgFte, periodKey, ui.timeUnit)) : 'Note Only';
      const hdr = formatPeriodHeader(periodKey, ui.timeUnit);
      const nextPk = ui.timeUnit === 'month' ? addMonthsToMonthKey(periodKey, 1) : addWeeksToWeekKey(periodKey, 1);
      const nextHdr = formatPeriodHeader(nextPk, ui.timeUnit);
      const targetOpts = buildPeriodSelectOptions(periodKey, ui.timeUnit, 4, 12);

      body.innerHTML = `
        <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto" aria-hidden="true"></div>
        <div class="flex items-start justify-between gap-2">
          <div>
            <h2 id="mobileCardActionTitle" class="text-base font-extrabold text-slate-900">[${escapeHtml(proj.code)}] ${escapeHtml(proj.name)}</h2>
            <p class="text-xs text-slate-500">${escapeHtml(dept.name)} &bull; ${escapeHtml(hdr.title)} &bull; <strong>${valStr}</strong></p>
          </div>
          <button type="button" onclick="document.getElementById('mobileCardActionSheet').close()" class="min-h-[36px] px-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">Close</button>
        </div>

        <div class="space-y-2">
          <button type="button" onclick="document.getElementById('mobileCardActionSheet').close(); openAllocationModal('${deptId}', '${projId}', '${periodKey}');"
            class="w-full min-h-[46px] px-4 rounded-xl bg-indigo-600 text-white font-bold text-sm flex items-center justify-between">
            <span>Edit Allocation &amp; Comment</span>
            <span>&#9998;</span>
          </button>

          ${alloc.hasData ? `
            <button type="button" onclick="mobileCopyAllocationToNext('${deptId}', '${projId}', '${periodKey}')"
              class="w-full min-h-[46px] px-4 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 font-bold text-sm flex items-center justify-between">
              <span>Extend to ${escapeHtml(nextHdr.title)}</span>
              <span>&rarr;</span>
            </button>

            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <label for="mMoveTargetPeriod" class="block text-[11px] font-bold uppercase tracking-wider text-slate-500">Move or Copy to Another Period</label>
              <select id="mMoveTargetPeriod" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800">
                ${targetOpts.map(o => `<option value="${o.key}" ${o.key === nextPk ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
              </select>
              <div class="grid grid-cols-2 gap-2">
                <button type="button" onclick="mobileMoveOrCopyAllocation('${deptId}', '${projId}', '${periodKey}', false)"
                  class="min-h-[42px] rounded-xl bg-slate-900 text-white font-bold text-xs">Move Here</button>
                <button type="button" onclick="mobileMoveOrCopyAllocation('${deptId}', '${projId}', '${periodKey}', true)"
                  class="min-h-[42px] rounded-xl bg-white border border-slate-300 text-slate-800 font-bold text-xs">Copy Here</button>
              </div>
            </div>

            <button type="button" onclick="mobileRemoveAllocation('${deptId}', '${projId}', '${periodKey}')"
              class="w-full min-h-[44px] px-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-bold text-sm">
              Remove Allocation
            </button>
          ` : ''}
        </div>`;

      if (typeof sheet.showModal === 'function') sheet.showModal();
      else sheet.setAttribute('open', 'open');
    }

    function mobileCopyAllocationToNext(deptId, projId, periodKey) {
      document.getElementById('mobileCardActionSheet')?.close();
      quickExtendAllocation({ stopPropagation() {} }, deptId, projId, periodKey);
    }

    function mobileMoveOrCopyAllocation(deptId, projId, srcPeriodKey, isCopy) {
      const targetPk = document.getElementById('mMoveTargetPeriod')?.value;
      document.getElementById('mobileCardActionSheet')?.close();
      if (!targetPk || targetPk === srcPeriodKey) return;

      const db = getActiveDB();
      const srcData = getAllocationForPeriod(deptId, projId, srcPeriodKey, ui.timeUnit, db.allocations);
      if (!srcData.hasData) return;

      pushUndoState(`${isCopy ? 'Copy' : 'Move'} allocation`);
      const existingDst = getAllocationForPeriod(deptId, projId, targetPk, ui.timeUnit, db.allocations).avgFte;
      setAllocationForPeriod(deptId, projId, targetPk, ui.timeUnit, existingDst + srcData.avgFte, db);
      if (!isCopy) setAllocationForPeriod(deptId, projId, srcPeriodKey, ui.timeUnit, 0, db);

      const srcCmt = (db.comments || {})[getCommentKey(deptId, projId, srcPeriodKey)];
      if (srcCmt) {
        const dstKey = getCommentKey(deptId, projId, targetPk);
        if (!db.comments[dstKey]) db.comments[dstKey] = srcCmt;
        if (!isCopy) delete db.comments[getCommentKey(deptId, projId, srcPeriodKey)];
      }

      const dCode = db.departments.find(d => d.id === deptId)?.code || deptId;
      const pCode = db.projects.find(p => p.id === projId)?.code || projId;
      recordChange('Allocation', `${isCopy ? 'Copied' : 'Moved'} [${dCode} -> ${pCode}] (${formatValue(srcData.avgFte, 'fte')}) from ${srcPeriodKey} to ${targetPk}`);
      triggerHaptic(12);
      renderAll();
      showToast(`${isCopy ? 'Copied' : 'Moved'} to ${formatPeriodHeader(targetPk, ui.timeUnit).title}`, 'success', { undoable: true });
    }

    function mobileRemoveAllocation(deptId, projId, periodKey) {
      document.getElementById('mobileCardActionSheet')?.close();
      const db = getActiveDB();
      const dCode = db.departments.find(d => d.id === deptId)?.code || deptId;
      const pCode = db.projects.find(p => p.id === projId)?.code || projId;
      openConfirmModal(
        'Remove Allocation',
        `Delete the [${dCode} → ${pCode}] allocation in ${periodKey}${ui.timeUnit === 'month' ? ' (all weeks in this month)' : ''}?`,
        'Remove Allocation',
        () => {
          pushUndoState('Remove allocation');
          setAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, 0, db);
          recordChange('Allocation', `Removed [${dCode} -> ${pCode}] allocation in ${periodKey}`);
          triggerHaptic(12);
          renderAll();
          showToast('Allocation removed', 'info', { undoable: true });
        }
      );
    }

    /* ============================================================================
     * 5B. DESKTOP / LANDSCAPE 2D ROADMAP MATRIX RENDERER & DRAG-AND-DROP
     * ============================================================================ */

    let _lastMatrixAxis = null;
    let _syncingMatrixScroll = false;

    function computeFullColumnGeometry(wrapperWidth, periodCount, compactRowLabels, isCompactGrid) {
      const count = Math.max(1, parseInt(periodCount, 10) || 1);
      const isOverview = count > 6 && !isCompactGrid;
      const stickyW = (compactRowLabels && !isCompactGrid) ? 62 : (isCompactGrid ? 124 : (isOverview ? 224 : 248));
      const safeWrapperW = Math.max(stickyW + 140, Math.floor(Number(wrapperWidth) || 0) || 1200);
      const availW = safeWrapperW - stickyW;
      if (!isCompactGrid && count <= 6) {
        // Standard View (1–6 periods): fit all selected periods equally inside desktop viewport when width allows
        if (count <= 4 || (availW / count) >= 150) {
          const colW = availW / count;
          return { stickyW, colW, visibleCols: count, totalTableW: stickyW + colW * count };
        }
      }
      if (isOverview) {
        // Simplified Overview (12 / 18 / 24 periods): compact column widths so full annual/2-year spans fit cleanly on desktop & 4K
        const minOverviewColW = count >= 24 ? 46 : count >= 18 ? 58 : 74;
        const maxFitCols = Math.max(1, Math.floor(availW / minOverviewColW));
        const visibleCols = Math.min(count, maxFitCols);
        const colW = availW / visibleCols;
        return { stickyW, colW, visibleCols, totalTableW: stickyW + colW * count };
      }
      const minColW = isCompactGrid ? 148 : 175;
      const maxFitCols = Math.max(1, Math.floor(availW / minColW));
      const visibleCols = Math.min(count, maxFitCols);
      const colW = availW / visibleCols; // Exact integer count of full columns fills 100% of availW
      return { stickyW, colW, visibleCols, totalTableW: stickyW + colW * count };
    }

    function applyMatrixFullColumnWidths() {
      const wrapper = document.getElementById('matrixWrapper');
      if (!wrapper) return;
      const table = wrapper.querySelector('table[data-period-count]');
      if (!table) return;
      const periodCount = parseInt(table.dataset.periodCount, 10) || 1;
      const isCompactGrid = isMobileViewport();
      const compactRowLabels = Boolean(ui.compactRowLabels) && !isCompactGrid;
      const wrapperW = wrapper.clientWidth || wrapper.getBoundingClientRect().width;
      if (!wrapperW || wrapperW < 100) return;

      const geo = computeFullColumnGeometry(wrapperW, periodCount, compactRowLabels, isCompactGrid);
      table.style.width = `${geo.totalTableW}px`;
      wrapper.style.scrollPaddingLeft = `${geo.stickyW}px`;

      const stickyCol = table.querySelector('colgroup col[data-sticky-col]');
      if (stickyCol) stickyCol.style.width = `${geo.stickyW}px`;
      table.querySelectorAll('colgroup col[data-period-col]').forEach(col => {
        col.style.width = `${geo.colW}px`;
      });
    }

    function syncMatrixFloatingHeaderMetrics() {
      applyMatrixFullColumnWidths();
      const wrapper = document.getElementById('matrixWrapper');
      const floating = document.getElementById('matrixFloatingHeader');
      const inner = document.getElementById('matrixFloatingHeaderInner');
      if (!wrapper || !floating || !inner) return;

      const realTable = wrapper.querySelector('table');
      const cloneTable = inner.querySelector('table');
      if (!realTable || !cloneTable) return;

      const wrapperRect = wrapper.getBoundingClientRect();
      const tableRect = realTable.getBoundingClientRect();
      floating.style.left = `${wrapperRect.left}px`;
      floating.style.width = `${wrapperRect.width}px`;
      cloneTable.style.width = `${tableRect.width}px`;

      const realThs = realTable.querySelectorAll('thead th');
      const cloneThs = cloneTable.querySelectorAll('thead th');
      for (let i = 0; i < realThs.length && i < cloneThs.length; i++) {
        const w = realThs[i].getBoundingClientRect().width;
        cloneThs[i].style.width = `${w}px`;
        cloneThs[i].style.minWidth = `${w}px`;
        cloneThs[i].style.maxWidth = `${w}px`;
      }
      inner.scrollLeft = wrapper.scrollLeft;
    }

    function updateMatrixFloatingHeaderVisibility() {
      const floating = document.getElementById('matrixFloatingHeader');
      const inner = document.getElementById('matrixFloatingHeaderInner');
      const desktopCard = document.getElementById('desktopMatrixCard');
      const wrapper = document.getElementById('matrixWrapper');
      if (!floating || !inner || !desktopCard || !wrapper) return;

      if (ui.activeTab !== 'matrix' || desktopCard.classList.contains('hidden')) {
        floating.classList.add('hidden');
        return;
      }

      const realTable = wrapper.querySelector('table');
      const realThead = realTable ? realTable.querySelector('thead') : null;
      if (!realTable || !realThead || !inner.querySelector('table')) {
        floating.classList.add('hidden');
        return;
      }

      const theadRect = realThead.getBoundingClientRect();
      const tableRect = realTable.getBoundingClientRect();
      const mainEl = document.getElementById('mainWorkspace');
      const topBound = isMobileViewport() && mainEl ? Math.max(0, mainEl.getBoundingClientRect().top) : 0;
      const shouldShow = theadRect.top < topBound && tableRect.bottom > (topBound + theadRect.height);

      if (shouldShow) {
        const wasHidden = floating.classList.contains('hidden');
        if (wasHidden) floating.classList.remove('hidden');
        const wrapperRect = wrapper.getBoundingClientRect();
        floating.style.top = `${topBound}px`;
        floating.style.left = `${wrapperRect.left}px`;
        floating.style.width = `${wrapperRect.width}px`;
        if (wasHidden) syncMatrixFloatingHeaderMetrics();
        inner.scrollLeft = wrapper.scrollLeft;
      } else {
        floating.classList.add('hidden');
      }
    }

    function syncMatrixFloatingHeader() {
      const wrapper = document.getElementById('matrixWrapper');
      const floating = document.getElementById('matrixFloatingHeader');
      const inner = document.getElementById('matrixFloatingHeaderInner');
      if (!wrapper || !floating || !inner) return;

      const realTable = wrapper.querySelector('table');
      const realThead = realTable ? realTable.querySelector('thead') : null;
      if (!realTable || !realThead) {
        inner.innerHTML = '';
        floating.classList.add('hidden');
        return;
      }

      const cloneTable = document.createElement('table');
      cloneTable.className = 'border-separate border-spacing-0 text-left';
      cloneTable.style.tableLayout = 'fixed';
      cloneTable.appendChild(realThead.cloneNode(true));
      inner.innerHTML = '';
      inner.appendChild(cloneTable);

      syncMatrixFloatingHeaderMetrics();
      updateMatrixFloatingHeaderVisibility();
    }

    function setupMatrixFloatingHeaderSync() {
      const wrapper = document.getElementById('matrixWrapper');
      const inner = document.getElementById('matrixFloatingHeaderInner');
      const mainEl = document.getElementById('mainWorkspace');

      window.addEventListener('scroll', updateMatrixFloatingHeaderVisibility, { passive: true });
      if (mainEl) {
        mainEl.addEventListener('scroll', updateMatrixFloatingHeaderVisibility, { passive: true });
      }
      window.addEventListener('resize', () => {
        syncMatrixFloatingHeaderMetrics();
        updateMatrixFloatingHeaderVisibility();
      }, { passive: true });

      if (wrapper && inner) {
        wrapper.addEventListener('scroll', () => {
          if (_syncingMatrixScroll) return;
          _syncingMatrixScroll = true;
          inner.scrollLeft = wrapper.scrollLeft;
          _syncingMatrixScroll = false;
        }, { passive: true });

        inner.addEventListener('scroll', () => {
          if (_syncingMatrixScroll) return;
          _syncingMatrixScroll = true;
          wrapper.scrollLeft = inner.scrollLeft;
          _syncingMatrixScroll = false;
        }, { passive: true });

        if (typeof ResizeObserver === 'function') {
          const ro = new ResizeObserver(() => {
            requestAnimationFrame(() => {
              syncMatrixFloatingHeaderMetrics();
              updateMatrixFloatingHeaderVisibility();
            });
          });
          ro.observe(wrapper);
        }
      }

      if (document.fonts && typeof document.fonts.ready?.then === 'function') {
        document.fonts.ready.then(() => {
          syncMatrixFloatingHeaderMetrics();
          updateMatrixFloatingHeaderVisibility();
        });
      }
    }

    function renderMatrix() {
      const db = getActiveDB();
      const wrapper = document.getElementById('matrixWrapper');
      if (!wrapper) return;
      const keepScroll = _lastMatrixAxis === ui.axis;
      const prevScrollLeft = keepScroll ? wrapper.scrollLeft : 0;
      _lastMatrixAxis = ui.axis;
      const periods = getVisiblePeriods();
      const warnT = db.settings.warnThreshold || 85;
      const overT = db.settings.overThreshold || 100;
      const isPresent = Boolean(ui.presentMode);
      const colorMode = getActiveCellColorMode();
      const useColorFill = colorMode === 'fill' || colorMode === 'fte' || colorMode === 'fte3';
      const showComments = Boolean(ui.showCellComments);

      const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
      const searchQ = (ui.matrixSearch || '').trim().toLowerCase();
      const visibleProjs = getSortedProjects(db).filter(p => {
        if (p.archived && ui.filterProj !== p.id) return false;
        if (!ui.includeTentative && p.tentative && ui.filterProj !== p.id) return false;
        if (ui.filterProj !== 'all' && p.id !== ui.filterProj) return false;
        if (ui.filterAtRiskOnly && p.status !== 'At Risk') return false;
        return true;
      });
      const spotlightId = ui.spotlightProjId || '';
      const showCost = hasAnyDayRates(db);

      const matchesSearchForPair = (dept, proj, pk) => {
        if (!searchQ) return true;
        if (dept && (`${dept.name} ${dept.code} ${dept.manager || ''}`).toLowerCase().includes(searchQ)) return true;
        if (proj && (`${proj.name} ${proj.code} ${proj.owner || ''} ${proj.techLead || ''} ${proj.status || ''}`).toLowerCase().includes(searchQ)) return true;
        if (dept && proj && pk) {
          const cmt = getCellProjectComments(dept.id, proj.id, pk, ui.timeUnit, db);
          if (cmt.direct && cmt.direct.toLowerCase().includes(searchQ)) return true;
          if (cmt.weekEntries.some(we => we.text.toLowerCase().includes(searchQ))) return true;
        }
        return false;
      };

      const isRowActiveInPeriods = (row) => {
        if (ui.axis === 'department') {
          return periods.some(pk => visibleProjs.some(p => {
            const a = getAllocationForPeriod(row.id, p.id, pk, ui.timeUnit, db.allocations);
            const c = getCellProjectComments(row.id, p.id, pk, ui.timeUnit, db);
            return a.hasData || c.hasAny;
          }));
        }
        const isAdminRowCheck = isNonFteProject(row);
        return periods.some(pk => {
          if (visibleDepts.some(d => {
            const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
            const c = getCellProjectComments(d.id, row.id, pk, ui.timeUnit, db);
            return a.hasData || c.hasAny || (isAdminRowCheck && Boolean(c.monthNote));
          })) return true;
          return getMilestonesInPeriod(pk, ui.timeUnit, db.milestones).some(m => m.projectId === row.id);
        });
      };

      const rawRows = ui.axis === 'department' ? visibleDepts : visibleProjs;
      let hiddenEmptyCount = 0;
      const rows = rawRows.filter(row => {
        if (ui.hideEmptyRows && !isRowActiveInPeriods(row)) {
          hiddenEmptyCount++;
          return false;
        }
        if (ui.filterOverOnly) {
          if (ui.axis === 'department') {
            const hasOver = periods.some(pk => {
              const c = getDeptCapacityForPeriod(row.id, pk, ui.timeUnit, db).avgFte;
              const a = getDeptTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
              const pct = c > 0 ? Math.round((a / c) * 100) : (a > 0 ? 999 : 0);
              return pct > overT;
            });
            if (!hasOver) return false;
          } else {
            const hasBottleneck = periods.some(pk => visibleDepts.some(d => {
              const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
              if (!a.hasData) return false;
              const dc = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
              const dt = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
              const dp = dc > 0 ? Math.round((dt / dc) * 100) : (dt > 0 ? 999 : 0);
              return dp > overT;
            }));
            if (!hasBottleneck) return false;
          }
        }
        if (ui.filterHasNotesOnly) {
          const axisKind = ui.axis === 'department' ? 'department' : 'project';
          const hasNotes = periods.some(pk => getCellTotalCommentCount(row.id, pk, axisKind, ui.timeUnit, db) > 0);
          if (!hasNotes) return false;
        }
        if (searchQ) {
          if (ui.axis === 'department') {
            if (matchesSearchForPair(row, null, null)) return true;
            return periods.some(pk => visibleProjs.some(p => {
              const a = getAllocationForPeriod(row.id, p.id, pk, ui.timeUnit, db.allocations);
              const c = getCellProjectComments(row.id, p.id, pk, ui.timeUnit, db);
              return (a.hasData || c.hasAny) && matchesSearchForPair(row, p, pk);
            }));
          } else {
            if (matchesSearchForPair(null, row, null)) return true;
            return periods.some(pk => visibleDepts.some(d => {
              const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
              const c = getCellProjectComments(d.id, row.id, pk, ui.timeUnit, db);
              return (a.hasData || c.hasAny) && matchesSearchForPair(d, row, pk);
            }));
          }
        }
        return true;
      });

      // Render active status strip (Overview Mode / Spotlight / Hidden Empty Rows / Active Filters)
      const isOverviewDesktop = periods.length > 6 && !isMobileViewport();
      const statusStrip = document.getElementById('matrixStatusStrip');
      if (statusStrip) {
        const statusParts = [];
        if (isOverviewDesktop) {
          const uPl = ui.timeUnit === 'month' ? 'months' : 'weeks';
          statusParts.push(`
            <span class="inline-flex items-center gap-1.5 font-bold text-indigo-800">
              Simplified Overview (${periods.length} ${uPl})
              <span class="font-normal text-indigo-700/80 hidden lg:inline">— click any cell for full details</span>
              <button type="button" onclick="setHorizon(6)" class="ml-1 px-2 py-0.5 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition">Standard (6)</button>
            </span>`);
        }
        if (spotlightId) {
          const spProj = db.projects.find(p => p.id === spotlightId);
          if (spProj) {
            statusParts.push(`
              <span class="inline-flex items-center gap-1.5 font-bold">
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${spProj.color}"></span>
                Spotlight: [${escapeHtml(spProj.code)}] ${escapeHtml(spProj.name)}
                <button type="button" onclick="setSpotlightProject('')" class="ml-1 px-2 py-0.5 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition">Clear<span class="hidden md:inline"> (Esc)</span></button>
              </span>`);
          }
        }
        if (hiddenEmptyCount > 0) {
          statusParts.push(`
            <span class="inline-flex items-center gap-1.5 font-semibold">
              Hiding ${hiddenEmptyCount} inactive ${ui.axis === 'department' ? 'department' : 'project'}${hiddenEmptyCount === 1 ? '' : 's'}
              <button type="button" onclick="toggleHideEmptyRows()" class="px-2 py-0.5 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition">Show All</button>
            </span>`);
        }
        if (!ui.includeTentative) {
          statusParts.push(`
            <span class="inline-flex items-center gap-1.5 font-semibold text-amber-800">
              Committed Only (Pipeline hidden)
              <button type="button" onclick="toggleIncludeTentative()" class="px-2 py-0.5 rounded-lg bg-white border border-amber-300 hover:bg-amber-50 text-amber-800 text-[11px] font-bold transition">Include Pipeline</button>
            </span>`);
        }
        if (searchQ || ui.filterOverOnly || ui.filterAtRiskOnly || ui.filterHasNotesOnly) {
          statusParts.push(`
            <span class="inline-flex items-center gap-1.5 font-semibold">
              Showing ${rows.length} of ${rawRows.length} rows
              <button type="button" onclick="clearMatrixFilters()" class="px-2 py-0.5 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition">Reset Filters</button>
            </span>`);
        }
        if (statusParts.length > 0) {
          statusStrip.innerHTML = statusParts.join('<span class="text-indigo-300 hidden sm:inline">|</span>');
          statusStrip.classList.remove('hidden');
        } else {
          statusStrip.classList.add('hidden');
          statusStrip.innerHTML = '';
        }
      }

      if (db.departments.length === 0 || db.projects.length === 0) {
        wrapper.innerHTML = `
          <div class="p-10 text-center space-y-3">
            <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto" aria-hidden="true">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            </div>
            <h2 class="text-base font-bold text-slate-900">Your Live Roadmap is Ready</h2>
            <p class="text-xs text-slate-500 max-w-md mx-auto">Add at least one <strong>Department</strong> and one <strong>Project</strong> in Data &amp; Setup, link an existing shared database file, or toggle <strong>Demo Mode</strong> in the Workspace menu to explore sample data.</p>
            <div class="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button type="button" onclick="switchTab('data')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition">Open Data &amp; Setup</button>
              <button type="button" onclick="openSharedDatabaseFile()" class="px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition">Link Shared Sync File</button>
              <button type="button" onclick="toggleDemoMode()" class="px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 text-xs font-semibold transition">Explore Demo Data</button>
            </div>
          </div>`;
        syncMatrixFloatingHeader();
        return;
      }

      const isCompactGrid = isMobileViewport();
      const isOverview = periods.length > 6 && !isCompactGrid;
      const isCompactRow = Boolean(ui.compactRowLabels) && !isCompactGrid;
      const wrapperW = wrapper.clientWidth || wrapper.getBoundingClientRect().width || 1200;
      const colGeo = computeFullColumnGeometry(wrapperW, periods.length, isCompactRow, isCompactGrid);
      const ovShowVals = !isOverview || colGeo.colW >= 74;
      const ovShowBarLabel = !isOverview || colGeo.colW >= 54;
      const isWideCols = periods.length <= 2 && !isCompactGrid;
      const isFocusedCols = periods.length <= 4 && !isCompactGrid;
      const noteSize = (ui.noteSize === 'sm' || ui.noteSize === 'lg') ? ui.noteSize : 'md';
      const s = {
        thCol: isOverview ? 'px-1.5 py-2' : (isWideCols ? 'px-4 py-3' : (isFocusedCols ? 'px-3 py-2.5' : (isCompactGrid ? 'px-2.5 py-2' : 'px-2.5 py-2.5'))),
        thTitle: isOverview ? 'text-[11px] font-extrabold' : (isWideCols ? 'text-base sm:text-lg font-extrabold' : (isFocusedCols ? 'text-sm font-extrabold' : 'text-xs font-bold')),
        thSub: isOverview ? 'text-[9px]' : (isFocusedCols ? 'text-[11px]' : 'text-[10px]'),
        thSticky: isCompactRow ? 'px-1.5 py-3 text-[10px] text-center' : (isCompactGrid ? 'px-2.5 py-2 text-[11px]' : 'px-3 py-2.5 text-xs'),
        tdSticky: isCompactRow ? (ui.axis === 'timeline' ? 'px-1.5 py-2' : 'px-1.5 py-3') : (isCompactGrid ? 'px-2.5 py-2.5' : 'px-3 py-2.5'),
        rowName: 'text-xs font-bold',
        rowMeta: 'text-[10px]',
        rowBadge: 'px-1.5 py-0.5 text-[10px] font-extrabold',
        cellPad: isOverview ? 'p-1' : (isWideCols ? 'p-3' : (isFocusedCols ? 'p-2.5' : 'p-2')),
        capText: isFocusedCols ? 'text-[11px] font-semibold' : 'text-[10px] font-semibold',
        pctText: isOverview ? 'text-[10px] font-extrabold' : (isWideCols ? 'text-xs font-extrabold' : 'text-[11px] font-extrabold'),
        barH: isOverview ? 'h-1 mb-1' : 'h-1.5 mb-2',
        pillBox: isOverview ? 'px-1 py-0.5 text-[10px]' : (isWideCols ? 'px-3 py-2 text-sm' : (isFocusedCols ? 'px-2.5 py-1.5 text-xs' : 'px-2 py-1 text-[11px]')),
        pillCode: isFocusedCols ? 'text-[11px]' : 'text-[10px]',
        pillVal: isWideCols ? 'text-sm font-extrabold' : (isFocusedCols ? 'text-xs font-extrabold' : 'text-[11px] font-bold'),
        pillSpace: isOverview ? 'space-y-0.5' : (isWideCols ? 'space-y-2' : (isFocusedCols ? 'space-y-1.5' : 'space-y-1')),
        pillBorderW: isOverview ? '3px' : (isFocusedCols ? '5px' : '4px'),
        commentBox: noteSize === 'lg'
          ? 'mt-2 px-3 py-2 text-base font-medium leading-relaxed break-words'
          : (noteSize === 'sm'
              ? 'mt-1 px-2 py-1 text-xs leading-snug break-words comment-clamp-3'
              : 'mt-1.5 px-2.5 py-1.5 text-sm leading-relaxed break-words'),
        msBox: isFocusedCols ? 'px-2.5 py-1.5 text-xs font-bold' : 'px-2 py-1 text-[10px] font-semibold',
        footCell: isOverview ? 'px-1.5 py-2 text-[10px]' : (isFocusedCols ? 'px-3.5 py-2.5 text-xs' : 'px-3 py-2 text-xs'),
        footSub: isOverview ? 'text-[9px]' : 'text-[10px]',
      };

      const renderInlineCommentHtml = (cmtObj, filledTheme = null) => {
        if (!showComments || !cmtObj.hasAny) return '';
        const fmt = (txt, cls) => (typeof ppFormatRoadmapNoteHtml === 'function')
          ? ppFormatRoadmapNoteHtml(txt, cls)
          : `<div class="${cls}">${escapeHtml(txt)}</div>`;
        const parts = [];
        if (cmtObj.direct) parts.push(fmt(cmtObj.direct, 'whitespace-pre-line'));
        cmtObj.weekEntries.forEach(we => {
          const wkPrefix = filledTheme
            ? `<span class="font-mono font-bold underline">${escapeHtml(we.weekShort)}:</span>`
            : `<span class="font-mono font-bold text-indigo-600">${escapeHtml(we.weekShort)}:</span>`;
          parts.push(`<div class="space-y-0.5">${wkPrefix} ${fmt(we.text, 'whitespace-pre-line inline')}</div>`);
        });
        if (filledTheme) {
          return `
            <div class="${s.commentBox} rounded-lg space-y-0.5" style="background-color:${filledTheme.commentBg}; border: 1px solid ${filledTheme.commentBorder}; color:${filledTheme.commentText};">
              ${parts.join('')}
            </div>`;
        }
        return `
          <div class="accent-card-comment ${s.commentBox} rounded-md bg-slate-50 border border-slate-200/80 text-slate-600 space-y-0.5">
            ${parts.join('')}
          </div>`;
      };

      const unitNoun = ui.timeUnit === 'month' ? 'month' : 'week';
      const curPeriodKey = ui.timeUnit === 'month' ? getCurrentMonthKey() : getCurrentWeekKey();
      const hasCurrentPeriodVisible = periods.includes(curPeriodKey);
      const colHeaders = periods.map((pk, idx) => {
        const h = formatPeriodHeader(pk, ui.timeUnit);
        const isCurrent = pk === curPeriodKey;
        if (isOverview) {
          const prevJump = idx === 0
            ? `<button type="button" onclick="shiftStartByInterval(-1)" title="Jump back ${periods.length} ${unitNoun}s (Shift + Left)" aria-label="Jump back ${periods.length} ${unitNoun}s"
                 class="meeting-nav-arrow w-5 h-5 rounded text-[11px] font-extrabold leading-none flex items-center justify-center transition shrink-0 cursor-pointer">&laquo;</button>`
            : '';
          const nextJump = idx === periods.length - 1
            ? `<button type="button" onclick="shiftStartByInterval(1)" title="Jump forward ${periods.length} ${unitNoun}s (Shift + Right)" aria-label="Jump forward ${periods.length} ${unitNoun}s"
                 class="meeting-nav-arrow w-5 h-5 rounded text-[11px] font-extrabold leading-none flex items-center justify-center transition shrink-0 cursor-pointer">&raquo;</button>`
            : '';
          const ovTitle = ui.timeUnit === 'month' ? h.shortTitle : h.title.split(' ')[0];
          const ovSub = ui.timeUnit === 'month' ? h.sub : h.sub;
          return `
            <th scope="col" title="${escapeHtml(h.title)} (${escapeHtml(h.dateRange)})"
              class="matrix-snap-col group/col ${s.thCol} text-center border-b border-l border-slate-200 ${isCurrent ? 'matrix-th-now' : 'bg-slate-50'}">
              <div class="flex items-center justify-between gap-0.5">
                ${prevJump || '<span></span>'}
                <div class="min-w-0 flex-1">
                  <div class="${s.thTitle} ${isCurrent ? 'text-indigo-700' : 'text-slate-800'} truncate leading-tight">${escapeHtml(ovTitle)}</div>
                  <div class="${s.thSub} text-slate-400 font-medium truncate leading-tight">${isCurrent ? '<span class="text-indigo-600 font-bold">Now</span>' : escapeHtml(ovSub)}</div>
                </div>
                ${nextJump || '<span></span>'}
              </div>
            </th>`;
        }
        const prevArrowHtml = !isCompactGrid && idx === 0
          ? `<div class="inline-flex items-center gap-0.5 shrink-0">
               <button type="button" onclick="shiftStartByInterval(-1)" title="Jump back ${periods.length} ${unitNoun}s (Shift + Left Arrow)" aria-label="Jump back ${periods.length} ${unitNoun}s"
                 class="meeting-nav-arrow w-6 h-7 rounded-lg font-extrabold text-xs leading-none flex items-center justify-center shadow-2xs transition shrink-0 cursor-pointer">&laquo;</button>
               <button type="button" onclick="shiftStartPeriod(-1)" title="Previous ${unitNoun} (Left Arrow)" aria-label="Previous ${unitNoun}"
                 class="meeting-nav-arrow w-6 h-7 rounded-lg font-extrabold text-base leading-none flex items-center justify-center shadow-2xs transition shrink-0 cursor-pointer">&lsaquo;</button>
             </div>`
          : '';
        const todayPillHtml = !isCompactGrid && idx === periods.length - 1 && !hasCurrentPeriodVisible
          ? `<button type="button" onclick="jumpToToday()" title="Jump to current ${unitNoun} (T)"
               class="meeting-nav-arrow px-2 h-7 rounded-lg text-[10px] font-bold leading-none flex items-center justify-center shadow-2xs transition shrink-0 cursor-pointer">Today</button>`
          : '';
        const nextArrowHtml = !isCompactGrid && idx === periods.length - 1
          ? `<div class="inline-flex items-center gap-0.5 shrink-0">
               <button type="button" onclick="shiftStartPeriod(1)" title="Next ${unitNoun} (Right Arrow)" aria-label="Next ${unitNoun}"
                 class="meeting-nav-arrow w-6 h-7 rounded-lg font-extrabold text-base leading-none flex items-center justify-center shadow-2xs transition shrink-0 cursor-pointer">&rsaquo;</button>
               <button type="button" onclick="shiftStartByInterval(1)" title="Jump forward ${periods.length} ${unitNoun}s (Shift + Right Arrow)" aria-label="Jump forward ${periods.length} ${unitNoun}s"
                 class="meeting-nav-arrow w-6 h-7 rounded-lg font-extrabold text-xs leading-none flex items-center justify-center shadow-2xs transition shrink-0 cursor-pointer">&raquo;</button>
             </div>`
          : '';
        const copyPeriodBtnHtml = !isPresent && !isCompactGrid
          ? `<div class="opacity-0 group-hover/col:opacity-100 inline-flex items-center gap-0.5 transition shrink-0">
               <button type="button" onclick="copyPeriodToNext('${pk}')" title="Copy all visible allocations from ${escapeHtml(h.title)} into the next ${unitNoun}"
                 class="px-1.5 py-0.5 rounded-md bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-700 text-slate-500 text-[10px] font-semibold transition cursor-pointer">Copy&rarr;</button>
               <button type="button" onclick="openPeriodCapacityModal('${pk}')" title="Set variable capacity or company holiday / shutdown for ${escapeHtml(h.title)}"
                 class="px-1 py-0.5 rounded-md bg-white border border-slate-200 hover:border-sky-300 hover:text-sky-700 text-slate-500 text-[10px] font-semibold transition cursor-pointer">Cap</button>
               <button type="button" onclick="clearPeriodAllocations('${pk}')" title="Clear all visible allocations in ${escapeHtml(h.title)}"
                 class="px-1 py-0.5 rounded-md bg-white border border-slate-200 hover:border-rose-300 hover:text-rose-600 text-slate-500 text-[10px] font-semibold transition cursor-pointer">&times;</button>
             </div>`
          : '';
        return `
          <th scope="col" class="matrix-snap-col group/col ${s.thCol} text-left border-b border-l border-slate-200 ${isCurrent ? 'matrix-th-now' : 'bg-slate-50'}">
            <div class="flex items-center justify-between gap-1.5">
              <div class="flex items-center gap-1.5 min-w-0">
                ${prevArrowHtml}
                <div class="min-w-0">
                  <div class="${s.thTitle} ${isCurrent ? 'text-indigo-700' : 'text-slate-800'} truncate leading-tight">${escapeHtml(h.title)}</div>
                  <div class="${s.thSub} text-slate-500 font-medium mt-0.5 truncate">${escapeHtml(h.dateRange)}</div>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                ${copyPeriodBtnHtml}
                ${isCurrent ? '<span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-600 text-white">Now</span>' : ''}
                ${todayPillHtml}
                ${nextArrowHtml}
              </div>
            </div>
          </th>`;
      }).join('');

      const resolveCardStyle = (fteVal, capFte, entityColor) => {
        if (colorMode === 'fte3') {
          const t3 = getFte3DemandTier(fteVal, capFte, db);
          return { fillHex: t3.color, tier3: t3, showIdentityDot: true };
        }
        if (colorMode === 'fte') {
          return { fillHex: getFteCardColor(fteVal, capFte), tier3: null, showIdentityDot: true };
        }
        return { fillHex: entityColor, tier3: null, showIdentityDot: false };
      };

      const todayIso = new Date().toISOString().slice(0, 10);
      const getNextProjectMilestone = (projId) => {
        const list = (db.milestones || [])
          .filter(m => m.projectId === projId && m.date)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return list.find(m => m.date >= todayIso) || list[list.length - 1] || null;
      };

      const buildProjectDetailedRowHeaderHtml = ({
        row, totalDays, bottleneckCount, activeDeptCount, reorderControlsHtml, statusCls, rowSpotCls, clickAttr,
      }) => {
        const isAdminRow = isNonFteProject(row);
        if (isCompactGrid) {
          const compactSwatch = isAdminRow
            ? `<span class="w-2 h-8 rounded-full shrink-0 admin-hashed-swatch" style="--admin-accent:${row.color}" aria-hidden="true"></span>`
            : `<span class="w-1.5 h-8 rounded-full shrink-0" style="background:${row.color}" aria-hidden="true"></span>`;
          return `<th scope="row" ${clickAttr} class="${rowSpotCls} sticky left-0 z-10 bg-white group-hover/row:bg-slate-50 ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-top font-normal text-left">
            <div class="flex items-center gap-1.5 min-w-0">
              ${compactSwatch}
              <div class="min-w-0">
                <div class="${s.rowName} text-slate-900 truncate">${escapeHtml(row.code)}</div>
                <div class="${s.rowMeta} text-slate-500 truncate mt-0.5">${escapeHtml(row.name)}</div>
              </div>
            </div>
          </th>`;
        }
        const budgetDays = isAdminRow ? 0 : (Number(row.budgetDays) || 0);
        const allTimeDays = budgetDays > 0 ? getProjectTotalPlannedDays(row.id, db) : 0;
        const budgetPct = budgetDays > 0 ? Math.round((allTimeDays / budgetDays) * 100) : 0;
        const budgetBarCls = budgetPct > 100 ? 'bg-rose-500' : budgetPct >= 85 ? 'bg-amber-500' : 'bg-indigo-500';
        const budgetTextCls = budgetPct > 100 ? 'text-rose-700 font-bold' : budgetPct >= 85 ? 'text-amber-700 font-bold' : 'text-slate-600 font-semibold';
        const plannedCost = (!isAdminRow && showCost) ? getProjectTotalPlannedCost(row.id, db) : 0;
        const budgetCost = isAdminRow ? 0 : (Number(row.budgetCost) || 0);
        const costPct = budgetCost > 0 ? Math.round((plannedCost / budgetCost) * 100) : 0;
        const prio = String(row.priority || '').trim();
        const prioCls = prio === 'Critical' ? 'bg-rose-100 text-rose-700' : prio === 'High' ? 'bg-amber-100 text-amber-800' : prio === 'Medium' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600';
        const prioBadgeHtml = prio
          ? `<span class="px-1 py-0.5 rounded text-[9px] font-bold shrink-0 ${prioCls}" title="Priority: ${escapeHtml(prio)}">${escapeHtml(prio)}</span>`
          : '';
        const adminTagHtml = isAdminRow ? '<span class="px-1 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-[9px] font-bold shrink-0">Admin &middot; Non-FTE</span>' : '';
        const tentTagHtml = row.tentative ? '<span class="px-1 py-0.5 rounded bg-violet-100 text-violet-800 text-[9px] font-bold shrink-0">Pipeline</span>' : '';
        const bottleneckBadgeHtml = (!isAdminRow && bottleneckCount > 0)
          ? `<span title="${bottleneckCount} overallocated slot(s) (&gt;${overT}%)" class="px-1 py-0.5 rounded bg-rose-100 text-rose-700 text-[9px] font-extrabold shrink-0">&#9888; ${bottleneckCount} Over</span>`
          : '';
        const costBadgeHtml = (!isAdminRow && showCost && (plannedCost > 0 || budgetCost > 0))
          ? `<span title="Est. cost ${formatCurrency(plannedCost, db)}${budgetCost > 0 ? ' vs ' + formatCurrency(budgetCost, db) + ' budget (' + costPct + '%)' : ''}" class="px-1 py-0.5 rounded text-[9px] font-bold shrink-0 ${budgetCost > 0 && costPct > 100 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'}">${formatCurrency(plannedCost, db)}${budgetCost > 0 ? '/' + formatCurrency(budgetCost, db) : ''}</span>`
          : '';
        const shiftBtnHtml = !isPresent
          ? `<button type="button" onclick="event.stopPropagation(); openShiftProjectModal('${row.id}')" title="Shift all allocations, comments &amp; milestones for [${escapeHtml(row.code)}] by ±N weeks/months"
               class="opacity-0 group-hover/row:opacity-100 px-1.5 py-0.5 rounded-md bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 text-[10px] font-bold transition shrink-0">&#8644; Shift</button>`
          : '';
        const nextMs = getNextProjectMilestone(row.id);
        const nextMsHtml = nextMs
          ? `<div class="mt-1 text-[10px] text-violet-700 font-semibold truncate" title="Milestone: ${escapeHtml(nextMs.title)} (${escapeHtml(nextMs.date)})"><span class="text-violet-500 mr-0.5">&#9670;</span>${escapeHtml(nextMs.title)} <span class="text-slate-400 font-mono">&middot; ${escapeHtml(String(nextMs.date).slice(5))}</span></div>`
          : '';
        const budgetBarHtml = budgetDays > 0
          ? `<div class="mt-1.5" title="Total planned across all weeks: ${allTimeDays}d vs ${budgetDays}d budget (${budgetPct}%)">
               <div class="flex items-center justify-between gap-1 text-[9px] leading-none mb-0.5">
                 <span class="text-slate-400 uppercase font-semibold">Budget</span>
                 <span class="tabular-nums ${budgetTextCls}">${Math.round(allTimeDays)}/${Math.round(budgetDays)}d (${budgetPct}%)</span>
               </div>
               <div class="w-full h-1 rounded-full bg-slate-200/80 overflow-hidden"><div class="h-full ${budgetBarCls} rounded-full" style="width:${Math.min(100, budgetPct)}%"></div></div>
             </div>`
          : '';
        const ownerLineHtml = (row.owner || row.techLead || adminTagHtml || tentTagHtml || bottleneckBadgeHtml || costBadgeHtml)
          ? `<div class="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
               ${row.owner ? `<span class="truncate max-w-[105px]" title="Owner: ${escapeHtml(row.owner)}">${escapeHtml(row.owner)}</span>` : ''}
               ${row.techLead ? `<span class="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-[9px] font-semibold truncate max-w-[115px]" title="Technical Lead: ${escapeHtml(row.techLead)}">TL: ${escapeHtml(row.techLead)}</span>` : ''}
               ${adminTagHtml}${tentTagHtml}${bottleneckBadgeHtml}${costBadgeHtml}
             </div>`
          : '';
        const effortMetaHtml = isAdminRow
          ? `<span class="text-sky-700 font-semibold">Issues &amp; Meetings</span>`
          : `<span class="tabular-nums">${Math.round(totalDays)}d</span><span>&bull;</span><span class="tabular-nums">${activeDeptCount} dept${activeDeptCount === 1 ? '' : 's'}</span>`;
        const detailSwatchHtml = isAdminRow
          ? `<span class="w-2 rounded-full shrink-0 admin-hashed-swatch" style="--admin-accent:${row.color}" aria-hidden="true"></span>`
          : `<span class="w-1.5 rounded-full shrink-0" style="background:${row.color}" aria-hidden="true"></span>`;
        return `
          <th scope="row" ${clickAttr} class="${rowSpotCls} sticky left-0 z-10 bg-white group-hover/row:bg-slate-50 ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-top font-normal text-left ${clickAttr ? 'cursor-pointer' : ''}">
            <div class="flex items-stretch gap-2 min-w-0">
              ${reorderControlsHtml || ''}
              ${detailSwatchHtml}
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-1.5">
                  <div class="${s.rowName} text-slate-900 truncate leading-snug" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
                  <span class="rounded-md shrink-0 ${s.rowBadge} ${statusCls}">${escapeHtml(row.status)}</span>
                </div>
                <div class="${s.rowMeta} text-slate-500 flex items-center justify-between gap-1 mt-0.5">
                  <div class="flex items-center gap-1 min-w-0 truncate">
                    <span class="font-mono font-bold text-slate-700">${escapeHtml(row.code)}</span>
                    <span>&bull;</span>
                    ${effortMetaHtml}
                    ${prioBadgeHtml}
                  </div>
                  ${shiftBtnHtml}
                </div>
                ${ownerLineHtml}
                ${budgetBarHtml}
                ${nextMsHtml}
              </div>
            </div>
          </th>`;
      };

      const bodyRows = rows.map((row, rowIdx) => {
        const isFirstRow = rowIdx === 0;
        const isLastRow = rowIdx === rows.length - 1;
        const reorderControlsHtml = ui.axis === 'department' && !isCompactRow && !isPresent && rows.length > 1 && !isCompactGrid
          ? `<div class="flex flex-col items-center justify-center shrink-0 -ml-1 mr-0.5 text-slate-400">
               <button type="button" draggable="false" aria-label="Move ${escapeHtml(row.name)} up" onclick="event.stopPropagation(); moveRowOrder('${ui.axis}', '${row.id}', -1)"
                 ${isFirstRow ? 'disabled' : ''} title="Move row up"
                 class="leading-none px-1 py-0.5 rounded hover:bg-slate-200/80 hover:text-indigo-700 disabled:opacity-25 disabled:pointer-events-none text-[9px] transition">&#9650;</button>
               <span draggable="true" data-drag-type="row" data-drag-row-id="${row.id}"
                 ondragstart="handleRowDragStart(event)" ondragend="handleRowDragEnd(event)"
                 title="Drag to reorder row"
                 class="touch-hide-drag-grip cursor-grab active:cursor-grabbing px-1 py-0.5 text-slate-400 hover:text-indigo-600 select-none leading-none text-[11px]">&#8942;&#8942;</span>
               <button type="button" draggable="false" aria-label="Move ${escapeHtml(row.name)} down" onclick="event.stopPropagation(); moveRowOrder('${ui.axis}', '${row.id}', 1)"
                 ${isLastRow ? 'disabled' : ''} title="Move row down"
                 class="leading-none px-1 py-0.5 rounded hover:bg-slate-200/80 hover:text-indigo-700 disabled:opacity-25 disabled:pointer-events-none text-[9px] transition">&#9660;</button>
             </div>`
          : '';

        if (ui.axis === 'department') {
          let sumA = 0, sumC = 0, peakPct = 0, overPeriods = 0, hasAnyOverride = false;
          const activeProjIds = new Set();
          periods.forEach(pk => {
            const pA = getDeptTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
            const capO = getDeptCapacityForPeriod(row.id, pk, ui.timeUnit, db);
            const pC = capO.avgFte;
            if (capO.hasOverride) hasAnyOverride = true;
            sumA += pA;
            sumC += pC;
            const pPct = pC > 0 ? Math.round((pA / pC) * 100) : (pA > 0 ? 999 : 0);
            if (pPct > peakPct) peakPct = pPct;
            if (pPct > overT) overPeriods++;
            visibleProjs.forEach(p => {
              if (getAllocationForPeriod(row.id, p.id, pk, ui.timeUnit, db.allocations).hasData) activeProjIds.add(p.id);
            });
          });
          const avgPct = sumC > 0 ? Math.round((sumA / sumC) * 100) : 0;
          const badgeCls = avgPct > overT ? 'bg-rose-100 text-rose-700' : avgPct >= warnT ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
          const avgBarColor = avgPct > overT ? 'bg-rose-500' : avgPct >= warnT ? 'bg-amber-500' : 'bg-emerald-500';
          const peakTextCls = peakPct > overT ? 'text-rose-600 font-bold' : peakPct >= warnT ? 'text-amber-700 font-bold' : 'text-slate-600 font-semibold';

          const cellsHtml = periods.map(pk => {
            const capObj = getDeptCapacityForPeriod(row.id, pk, ui.timeUnit, db);
            const capFte = capObj.avgFte;
            const allocFte = getDeptTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
            const pct = capFte > 0 ? Math.round((allocFte / capFte) * 100) : (allocFte > 0 ? 999 : 0);

            const cellToneCls = pct > overT ? 'matrix-cell-over' : pct >= warnT ? 'matrix-cell-warn' : 'matrix-cell-normal';
            const barColor = pct > overT ? 'bg-rose-500' : pct >= warnT ? 'bg-amber-500' : 'bg-emerald-500';
            const pctBadgeCls = pct > overT ? 'matrix-pct-over' : pct >= warnT ? 'matrix-pct-warn' : 'matrix-pct-ok';

            const allocDisp = formatValue(fteToDisplayValue(allocFte, pk, ui.timeUnit), ui.manpowerUnit, false);
            const capDisp = formatValue(fteToDisplayValue(capFte, pk, ui.timeUnit), ui.manpowerUnit, true);
            const cmtCount = getCellTotalCommentCount(row.id, pk, 'department', ui.timeUnit, db);

            if (isOverview) {
              const ovChips = visibleProjs.map(p => {
                const a = getAllocationForPeriod(row.id, p.id, pk, ui.timeUnit, db.allocations);
                const cmtObj = getCellProjectComments(row.id, p.id, pk, ui.timeUnit, db);
                const isAdminProj = isNonFteProject(p);
                if (!a.hasData && !(isAdminProj && cmtObj.hasAny)) return '';
                if (searchQ && !matchesSearchForPair(row, p, pk)) return '';
                const spotlightCls = spotlightId ? (spotlightId === p.id ? 'spotlight-active' : 'spotlight-dimmed') : '';
                if (!a.hasData && isAdminProj && cmtObj.hasAny) {
                  const notePreview = (cmtObj.direct || (cmtObj.weekEntries[0]?.text) || '').replace(/\s+/g, ' ');
                  const tipTxt = `[${p.code}] ${p.name} (Admin · Non-FTE)\n${notePreview}`;
                  return `<div onclick="event.stopPropagation(); openAllocationModal('${row.id}', '${p.id}', '${pk}')" title="${escapeHtml(tipTxt)}"
                    class="admin-hashed-chip ${spotlightCls} px-1 py-0.5 rounded text-[9px] font-bold flex items-center justify-between gap-0.5 leading-tight truncate cursor-pointer"
                    style="--admin-accent:${p.color};">
                    <span class="font-mono truncate">${escapeHtml(p.code)}</span>
                    <span class="shrink-0" aria-hidden="true">&#9998;</span>
                  </div>`;
                }
                const valNum = formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit), ui.manpowerUnit, false);
                const valFull = formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit));
                const { fillHex, tier3, showIdentityDot } = resolveCardStyle(a.avgFte, capFte, p.color);
                const tipTxt = `[${p.code}] ${p.name} — ${valFull}${tier3 ? ' • ' + tier3.ariaLabel : ''}`;
                if (useColorFill) {
                  const ft = getFilledCardTheme(fillHex);
                  return `<div onclick="event.stopPropagation(); openAllocationModal('${row.id}', '${p.id}', '${pk}')" title="${escapeHtml(tipTxt)}"
                    class="${spotlightCls} px-1 py-0.5 rounded text-[9px] font-bold flex items-center justify-between gap-0.5 leading-tight truncate cursor-pointer"
                    style="background-color:${ft.bg}; color:${ft.text}; border:${p.tentative ? '1px dashed' : '1px solid'} ${ft.border};">
                    <span class="inline-flex items-center gap-0.5 min-w-0 truncate">
                      ${showIdentityDot ? `<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${p.color}"></span>` : ''}
                      <span class="font-mono truncate">${escapeHtml(p.code)}</span>
                    </span>
                    ${ovShowVals ? `<span class="tabular-nums shrink-0">${valNum}</span>` : ''}
                  </div>`;
                }
                return `<div onclick="event.stopPropagation(); openAllocationModal('${row.id}', '${p.id}', '${pk}')" title="${escapeHtml(tipTxt)}"
                  class="accent-card ${spotlightCls} px-1 py-0.5 rounded bg-white border border-slate-200/90 text-[9px] font-bold text-slate-800 flex items-center justify-between gap-0.5 leading-tight truncate cursor-pointer"
                  style="--accent-color:${p.color}; --accent-w:3px; border-left:3px solid ${p.color};">
                  <span class="font-mono truncate">${escapeHtml(p.code)}</span>
                  ${ovShowVals ? `<span class="tabular-nums text-slate-600 shrink-0">${valNum}</span>` : ''}
                </div>`;
              }).join('');
              const hInfo = formatPeriodHeader(pk, ui.timeUnit);
              return `
                <td class="group/cell align-top ${s.cellPad} border-b border-l border-slate-200 ${cellToneCls} transition cursor-pointer"
                  title="${escapeHtml(row.name)} — ${escapeHtml(hInfo.title)}: ${allocDisp} / ${capDisp} (${pct > 990 ? '∞' : pct + '%'})${capObj.hasOverride ? ' [Variable cap]' : ''} • Click for full cell details"
                  onclick="openCellDetailModal('${row.id}', '${pk}')">
                  <div class="flex items-center justify-between gap-0.5 mb-0.5">
                    <span class="px-1 py-0.5 rounded text-[9px] font-extrabold tabular-nums leading-none ${pctBadgeCls}">${pct > 990 ? '&infin;' : pct + '%'}</span>
                    <span class="inline-flex items-center gap-0.5">
                      ${capObj.hasOverride ? '<span class="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" title="Variable capacity override"></span>' : ''}
                    </span>
                  </div>
                  <div class="w-full h-1 rounded-full bg-slate-200/80 overflow-hidden mb-1" aria-hidden="true">
                    <div class="h-full ${barColor} rounded-full" style="width: ${Math.min(100, pct)}%"></div>
                  </div>
                  <div class="space-y-0.5">${ovChips}</div>
                </td>`;
            }

            const pills = visibleProjs.map(p => {
              const a = getAllocationForPeriod(row.id, p.id, pk, ui.timeUnit, db.allocations);
              const cmtObj = getCellProjectComments(row.id, p.id, pk, ui.timeUnit, db);
              if (!a.hasData && !cmtObj.hasAny) return '';
              if (searchQ && !matchesSearchForPair(row, p, pk)) return '';

              const spotlightCls = spotlightId ? (spotlightId === p.id ? 'spotlight-active' : 'spotlight-dimmed') : '';
              const tentClsFilled = p.tentative ? 'tentative-card-filled' : '';
              const tentClsAccent = p.tentative ? 'tentative-card' : '';
              const isAdminProj = isNonFteProject(p);
              const { fillHex, tier3, showIdentityDot } = isAdminProj
                ? { fillHex: p.color, tier3: null, showIdentityDot: false }
                : resolveCardStyle(a.hasData ? a.avgFte : 0, capFte, p.color);
              const filledTheme = useColorFill ? getFilledCardTheme(fillHex) : null;
              const cmtHtml = renderInlineCommentHtml(cmtObj, filledTheme);
              const fullTooltipNote = cmtObj.direct ? `\nNote: ${cmtObj.direct}` : '';
              const pipeBadgeFilled = p.tentative
                ? `<span class="px-1 rounded text-[9px] font-extrabold uppercase shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};" title="Tentative / Pipeline project">Pipe</span>`
                : '';
              const pipeBadgeAccent = p.tentative
                ? '<span class="px-1 rounded bg-violet-100 text-violet-800 text-[9px] font-extrabold uppercase shrink-0" title="Tentative / Pipeline project">Pipe</span>'
                : '';

              const spotVisCls = spotlightId === p.id
                ? 'opacity-100'
                : 'desktop-hover-reveal opacity-0 group-hover/pill:opacity-100';
              const spotSizeCls = isWideCols ? 'w-5 h-5 text-xs' : 'w-4 h-4 text-[10px]';
              const spotlightBtn = useColorFill
                ? `<button type="button" onclick="event.stopPropagation(); toggleSpotlightProject('${p.id}')" title="${spotlightId === p.id ? 'Clear project spotlight' : 'Spotlight this project across all departments'}" aria-label="Spotlight ${escapeHtml(p.name)}"
                     class="${spotVisCls} ${spotSizeCls} rounded font-bold flex items-center justify-center transition shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">&#9678;</button>`
                : `<button type="button" onclick="event.stopPropagation(); toggleSpotlightProject('${p.id}')" title="${spotlightId === p.id ? 'Clear project spotlight' : 'Spotlight this project across all departments'}" aria-label="Spotlight ${escapeHtml(p.name)}"
                     class="${spotVisCls} ${spotlightId === p.id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700'} ${spotSizeCls} rounded font-bold flex items-center justify-center transition shrink-0">&#9678;</button>`;

              if (!a.hasData && cmtObj.hasAny) {
                const noteClickFn = isAdminProj ? `openAllocationModal('${row.id}', '${p.id}', '${pk}')` : `openCellDetailModal('${row.id}', '${pk}')`;
                const noteKindLbl = isAdminProj ? 'Admin' : 'Note';
                const noteTipKind = isAdminProj ? 'Admin (Non-FTE) — Issues & Meetings' : 'Comment Only';
                if (isAdminProj) {
                  const adminCmtHtml = renderInlineCommentHtml(cmtObj, null);
                  const adminSpotBtn = `<button type="button" onclick="event.stopPropagation(); toggleSpotlightProject('${p.id}')" title="${spotlightId === p.id ? 'Clear project spotlight' : 'Spotlight this project across all departments'}" aria-label="Spotlight ${escapeHtml(p.name)}"
                     class="${spotVisCls} ${spotlightId === p.id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700'} ${spotSizeCls} rounded font-bold flex items-center justify-center transition shrink-0">&#9678;</button>`;
                  return `
                    <div onclick="event.stopPropagation(); ${noteClickFn}"
                      title="[${escapeHtml(p.code)}] ${escapeHtml(p.name)} — ${noteTipKind}${escapeHtml(fullTooltipNote)}"
                      class="matrix-card admin-hashed-card group/pill ${spotlightCls} ${s.pillBox} rounded-lg cursor-pointer shadow-2xs"
                      style="--admin-accent:${p.color}; --accent-w:${s.pillBorderW};">
                      <div class="flex items-center justify-between gap-1.5">
                        <div class="flex items-center gap-1.5 min-w-0">
                          <span class="font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 ${s.pillCode} shrink-0">${escapeHtml(p.code)}</span>
                          <span class="truncate font-bold text-slate-800">${escapeHtml(p.name)}</span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                          ${adminSpotBtn}
                          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 shrink-0">&#9998; Admin</span>
                        </div>
                      </div>
                      ${adminCmtHtml}
                    </div>`;
                }
                if (useColorFill) {
                  return `
                    <div onclick="event.stopPropagation(); ${noteClickFn}"
                      title="[${escapeHtml(p.code)}] ${escapeHtml(p.name)} — ${noteTipKind}${escapeHtml(fullTooltipNote)}"
                      class="matrix-card group/pill ${spotlightCls} ${s.pillBox} rounded-xl cursor-pointer shadow-2xs"
                      style="background-color:${filledTheme.bg}; color:${filledTheme.text}; border: 1.5px dashed ${filledTheme.border};">
                      <div class="flex items-center justify-between gap-1.5">
                        <div class="flex items-center gap-1.5 min-w-0">
                          ${showIdentityDot ? `<span class="w-2 h-2 rounded-full ring-1 ring-white/70 shrink-0" style="background:${p.color}"></span>` : ''}
                          <span class="font-mono font-bold px-1.5 py-0.5 rounded ${s.pillCode} shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">${escapeHtml(p.code)}</span>
                          <span class="truncate font-bold">${escapeHtml(p.name)}</span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                          ${spotlightBtn}
                          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style="background-color:${filledTheme.chipBg};">${noteKindLbl}</span>
                        </div>
                      </div>
                      ${cmtHtml}
                    </div>`;
                }
                return `
                  <div onclick="event.stopPropagation(); ${noteClickFn}"
                    title="[${escapeHtml(p.code)}] ${escapeHtml(p.name)} — ${noteTipKind}${escapeHtml(fullTooltipNote)}"
                    class="matrix-card accent-card group/pill ${spotlightCls} ${s.pillBox} rounded-lg bg-white/90 border border-dashed border-slate-300 hover:border-indigo-400 cursor-pointer"
                    style="--accent-color:${p.color}; --accent-w:${s.pillBorderW}; border-left: ${s.pillBorderW} solid ${p.color};">
                    <div class="flex items-center justify-between gap-1.5">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span class="font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 ${s.pillCode} shrink-0">${escapeHtml(p.code)}</span>
                        <span class="truncate font-semibold text-slate-700">${escapeHtml(p.name)}</span>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        ${spotlightBtn}
                        <span class="text-[10px] font-bold ${isAdminProj ? 'px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700' : 'text-indigo-600'} shrink-0">${noteKindLbl}</span>
                      </div>
                    </div>
                    ${cmtHtml}
                  </div>`;
              }

              const valStr = formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit));
              const capSharePct = capFte > 0 ? Math.round((a.avgFte / capFte) * 100) : (a.avgFte > 0 ? 999 : 0);
              const capShareTxt = `${capSharePct > 990 ? '>100%' : capSharePct + '%'} of ${capDisp} cap`;
              const tierTooltip = tier3 ? ` — ${tier3.ariaLabel}` : '';
              const tierBadgeHtml = tier3
                ? `<span class="inline-flex items-center justify-center px-1 rounded text-[9px] font-extrabold shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};" title="${escapeHtml(tier3.ariaLabel)}" aria-hidden="true">${tier3.symbol}</span>`
                : '';

              if (useColorFill) {
                return `
                  <div draggable="${!isPresent}"
                    data-drag-type="alloc" data-drag-dept="${row.id}" data-drag-proj="${p.id}" data-drag-period="${pk}"
                    ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
                    onclick="event.stopPropagation(); openAllocationModal('${row.id}', '${p.id}', '${pk}')"
                    aria-label="${escapeHtml(p.name)}, ${valStr}, ${capShareTxt}${tierTooltip}"
                    title="[${escapeHtml(p.code)}] ${escapeHtml(p.name)}${p.tentative ? ' (Tentative Pipeline)' : ''} — ${valStr} (${capShareTxt})${tierTooltip} • Click value to inline-edit, card to open modal, drag to move/copy${escapeHtml(fullTooltipNote)}"
                    class="matrix-card group/pill ${spotlightCls} ${tentClsFilled} ${s.pillBox} rounded-xl shadow-xs cursor-grab active:cursor-grabbing"
                    style="background-color:${filledTheme.bg}; color:${filledTheme.text}; border: ${p.tentative ? '1.5px dashed' : '1px solid'} ${filledTheme.border};">
                    <div class="flex items-center justify-between gap-1.5">
                      <div class="flex items-center gap-1.5 min-w-0">
                        ${showIdentityDot ? `<span class="w-2 h-2 rounded-full ring-1 ring-white/75 shrink-0" style="background:${p.color}" title="${escapeHtml(p.name)} color"></span>` : ''}
                        ${tierBadgeHtml}
                        <span class="font-mono font-bold px-1.5 py-0.5 rounded ${s.pillCode} shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">${escapeHtml(p.code)}</span>
                        <span class="truncate font-bold">${escapeHtml(p.name)}</span>
                        ${pipeBadgeFilled}
                        ${!isPresent && a.isUneven ? `<span title="Uneven weekly split inside this month" class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color:${filledTheme.text}; opacity:0.8;"></span>` : ''}
                      </div>
                      <div class="flex items-center gap-0.5 shrink-0">
                        ${spotlightBtn}
                        ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${pk}', -1)" title="Decrease allocation" aria-label="Decrease ${escapeHtml(p.name)} allocation"
                          class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded font-bold flex items-center justify-center transition" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">&minus;</button>` : ''}
                        <span ${!isPresent ? `onclick="startInlineValueEdit(event, '${row.id}', '${p.id}', '${pk}')" title="Click to quick-edit value inline"` : ''} class="${s.pillVal} tabular-nums px-0.5 ${!isPresent ? 'cursor-text rounded hover:underline' : ''}">${valStr}</span>
                        ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${pk}', 1)" title="Increase allocation" aria-label="Increase ${escapeHtml(p.name)} allocation"
                          class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded font-bold flex items-center justify-center transition" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">+</button>` : ''}
                        ${!isPresent ? `<button type="button" onclick="quickExtendAllocation(event, '${row.id}', '${p.id}', '${pk}')" title="Copy into next period" aria-label="Extend ${escapeHtml(p.name)} into next period"
                          class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 px-1 rounded font-bold transition" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">&rarr;</button>` : ''}
                      </div>
                    </div>
                    ${cmtHtml}
                  </div>`;
              }

              return `
                <div draggable="${!isPresent}"
                  data-drag-type="alloc" data-drag-dept="${row.id}" data-drag-proj="${p.id}" data-drag-period="${pk}"
                  ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
                  onclick="event.stopPropagation(); openAllocationModal('${row.id}', '${p.id}', '${pk}')"
                  title="[${escapeHtml(p.code)}] ${escapeHtml(p.name)}${p.tentative ? ' (Tentative Pipeline)' : ''} — ${valStr} (${capShareTxt}) • Click value to inline-edit, card to open modal, drag to move/copy${escapeHtml(fullTooltipNote)}"
                  class="matrix-card accent-card group/pill ${spotlightCls} ${tentClsAccent} ${s.pillBox} rounded-lg bg-white border border-slate-200/90 hover:border-indigo-300 shadow-2xs cursor-grab active:cursor-grabbing"
                  style="--accent-color:${p.color}; --accent-w:${s.pillBorderW}; border-left: ${s.pillBorderW} solid ${p.color};">
                  <div class="flex items-center justify-between gap-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 ${s.pillCode} shrink-0">${escapeHtml(p.code)}</span>
                      <span class="truncate font-semibold text-slate-800">${escapeHtml(p.name)}</span>
                      ${pipeBadgeAccent}
                      ${!isPresent && a.isUneven ? '<span title="Uneven weekly split inside this month" class="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>' : ''}
                    </div>
                    <div class="flex items-center gap-0.5 shrink-0">
                      ${spotlightBtn}
                      ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${pk}', -1)" title="Decrease allocation" aria-label="Decrease ${escapeHtml(p.name)} allocation"
                        class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-700 font-bold flex items-center justify-center transition">&minus;</button>` : ''}
                      <span ${!isPresent ? `onclick="startInlineValueEdit(event, '${row.id}', '${p.id}', '${pk}')" title="Click to quick-edit value inline"` : ''} class="${s.pillVal} text-slate-900 tabular-nums px-0.5 ${!isPresent ? 'cursor-text rounded hover:underline' : ''}">${valStr}</span>
                      ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${row.id}', '${p.id}', '${pk}', 1)" title="Increase allocation" aria-label="Increase ${escapeHtml(p.name)} allocation"
                        class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-700 font-bold flex items-center justify-center transition">+</button>` : ''}
                      ${!isPresent ? `<button type="button" onclick="quickExtendAllocation(event, '${row.id}', '${p.id}', '${pk}')" title="Copy into next period" aria-label="Extend ${escapeHtml(p.name)} into next period"
                        class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 px-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold transition">&rarr;</button>` : ''}
                    </div>
                  </div>
                  ${cmtHtml}
                </div>`;
            }).join('');

            const capDelta = Math.round((capFte - (Number(row.defaultCapacity) || 0)) * 100) / 100;
            const varLabel = capDelta > 0.005 ? 'Var ▲' : capDelta < -0.005 ? 'Var ▼' : 'Var';
            const capTooltip = capObj.hasOverride
              ? `Variable capacity override: ${Math.round(capFte * 100) / 100} FTE vs base ${row.defaultCapacity} FTE (${capDelta >= 0 ? '+' : ''}${capDelta} FTE) — click to edit`
              : `Default capacity (${row.defaultCapacity} FTE) — click to set variable override`;
            const fixOverBtnHtml = pct > overT
              ? `<button type="button" onclick="event.stopPropagation(); openBottleneckResolverModal('${row.id}', '${pk}')"
                   title="Resolve >${overT}% overallocation with 1-click trim, shift, or capacity buffer"
                   class="px-1.5 py-0.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-extrabold transition shrink-0 cursor-pointer">Fix</button>`
              : '';
            const cellHeaderHtml = isPresent
              ? `<div class="flex items-center justify-end mb-2">
                   <span class="px-2 py-0.5 rounded-md ${s.pctText} tabular-nums ${pctBadgeCls}">
                     ${pct > 990 ? '&infin;' : pct + '%'}
                   </span>
                 </div>`
              : `<div class="flex items-center justify-between gap-1 mb-1.5">
                   <button type="button" onclick="event.stopPropagation(); openCapacityModal('${row.id}', '${pk}')"
                     title="${escapeHtml(capTooltip)}"
                     class="${s.capText} text-slate-600 hover:text-indigo-700 flex items-center gap-1 transition">
                     <span class="tabular-nums">${allocDisp} / ${capDisp}</span>
                     ${capObj.hasOverride ? `<span class="px-1 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[9px] font-bold">${varLabel}</span>` : ''}
                   </button>
                   <div class="flex items-center gap-1">
                     <button type="button" onclick="event.stopPropagation(); openCellDetailModal('${row.id}', '${pk}')"
                       title="${cmtCount ? cmtCount + ' project comment(s) — click to view/edit' : 'Click to add project comments for this cell'}"
                       aria-label="Comments for ${escapeHtml(row.name)} in ${escapeHtml(formatPeriodHeader(pk, ui.timeUnit).title)}"
                       class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition ${cmtCount > 0 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-[10px]' : 'opacity-0 group-hover/cell:opacity-100 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 text-[10px]'}">
                       <svg class="w-3 h-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                       ${cmtCount > 0 ? `<span>${cmtCount}</span>` : ''}
                     </button>
                     ${fixOverBtnHtml}
                     <span class="px-1.5 py-0.5 rounded-md ${s.pctText} tabular-nums ${pctBadgeCls}">
                       ${pct > 990 ? '&infin;' : pct + '%'}
                     </span>
                   </div>
                 </div>
                 <div class="w-full ${s.barH} rounded-full bg-slate-200/80 overflow-hidden" aria-hidden="true">
                   <div class="h-full ${barColor} rounded-full transition-all" style="width: ${Math.min(100, pct)}%"></div>
                 </div>`;

            const addBtnHtml = !isPresent
              ? `<button type="button" onclick="event.stopPropagation(); openAllocationModal('${row.id}', '', '${pk}')"
                   title="Allocate a project to ${escapeHtml(row.name)} in ${escapeHtml(formatPeriodHeader(pk, ui.timeUnit).title)}"
                   class="mt-1.5 w-full py-1 rounded-lg border border-dashed border-slate-300/90 hover:border-indigo-400 hover:bg-indigo-50/70 text-[10px] font-semibold text-slate-400 hover:text-indigo-700 opacity-70 sm:opacity-0 group-hover/cell:opacity-100 transition flex items-center justify-center gap-1">
                   <span>+ Add</span>
                 </button>`
              : '';

            return `
              <td class="group/cell align-top ${s.cellPad} border-b border-l border-slate-200 ${cellToneCls} transition cursor-pointer"
                ondragover="handleCellDragOver(event)" ondragleave="handleCellDragLeave(event)"
                ondrop="handleCellDrop(event, '${row.id}', '${pk}')"
                onclick="openCellDetailModal('${row.id}', '${pk}')">
                ${cellHeaderHtml}
                <div class="${s.pillSpace}">
                  ${pills}
                </div>
                ${addBtnHtml}
              </td>`;
          }).join('');

          const deptRateTxt = (showCost && Number(row.dayRate) > 0) ? `${db.settings.currency || '€'}${Math.round(Number(row.dayRate))}/d` : '';
          const deptMgrLine = (row.manager || deptRateTxt)
            ? `<div class="mt-1 flex items-center justify-between gap-1 text-[10px] text-slate-500">
                 <span class="truncate" title="${row.manager ? 'Manager: ' + escapeHtml(row.manager) : ''}">${escapeHtml(row.manager || '')}</span>
                 ${deptRateTxt ? `<span class="font-mono font-semibold text-emerald-700 shrink-0">${escapeHtml(deptRateTxt)}</span>` : ''}
               </div>`
            : '';
          const deptRowHeaderHtml = isCompactRow
            ? `<th scope="row" title="${escapeHtml(row.name)} (${avgPct}% avg • Peak ${peakPct > 990 ? '>100' : peakPct}%)"
                 class="meeting-row-accent sticky left-0 z-10 bg-white group-hover/row:bg-slate-50 w-[62px] min-w-[62px] max-w-[62px] ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-middle font-normal text-center"
                 style="--row-accent:${row.color};">
                 <div class="flex flex-col items-center justify-center gap-2">
                   <div class="meeting-vertical-text text-xs font-extrabold text-slate-900 tracking-wide">${escapeHtml(row.name)}</div>
                   <span class="rounded-md shrink-0 tabular-nums ${s.rowBadge} ${badgeCls}">${avgPct}%</span>
                 </div>
               </th>`
            : (isCompactGrid
                ? `<th scope="row" class="sticky left-0 z-10 bg-white group-hover/row:bg-slate-50 ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-top font-normal text-left">
                     <div class="flex items-start justify-between gap-1">
                       <div class="flex items-center gap-1.5 min-w-0">
                         <span class="w-1.5 h-8 rounded-full shrink-0" style="background:${row.color}" aria-hidden="true"></span>
                         <div class="min-w-0">
                           <div class="${s.rowName} text-slate-900 truncate">${escapeHtml(row.code)}</div>
                           <div class="${s.rowMeta} text-slate-500 truncate mt-0.5">${escapeHtml(row.name)}</div>
                         </div>
                       </div>
                       <span class="rounded-md shrink-0 tabular-nums ${s.rowBadge} ${badgeCls}">${avgPct}%</span>
                     </div>
                   </th>`
                : `<th scope="row" class="sticky left-0 z-10 bg-white group-hover/row:bg-slate-50 ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-top font-normal text-left">
                     <div class="flex items-stretch gap-2 min-w-0">
                       ${reorderControlsHtml}
                       <span class="w-1.5 rounded-full shrink-0" style="background:${row.color}" aria-hidden="true"></span>
                       <div class="min-w-0 flex-1">
                         <div class="flex items-start justify-between gap-1.5">
                           <div class="${s.rowName} text-slate-900 truncate leading-snug" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
                           <span class="rounded-md shrink-0 tabular-nums ${s.rowBadge} ${badgeCls}" title="Average utilisation across visible window">${avgPct}%</span>
                         </div>
                         <div class="${s.rowMeta} text-slate-500 flex flex-wrap items-center gap-1 mt-0.5">
                           <span class="font-mono font-bold text-slate-700">${escapeHtml(row.code)}</span>
                           <span>&bull;</span>
                           <span class="tabular-nums">Base ${row.defaultCapacity} FTE</span>
                           ${hasAnyOverride ? '<span class="px-1 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[9px] font-bold" title="Has variable capacity override in visible window">Var</span>' : ''}
                           ${overPeriods > 0 ? `<span class="px-1 rounded bg-rose-100 text-rose-700 text-[9px] font-extrabold" title="${overPeriods} period(s) exceed ${overT}%">&#9888; ${overPeriods}</span>` : ''}
                         </div>
                         <div class="mt-1.5">
                           <div class="flex items-center justify-between gap-1 text-[9px] leading-none mb-0.5">
                             <span class="${peakTextCls} tabular-nums">Peak ${peakPct > 990 ? '>100' : peakPct}%</span>
                             <span class="text-slate-500 tabular-nums">${activeProjIds.size} proj${activeProjIds.size === 1 ? '' : 's'}</span>
                           </div>
                           <div class="w-full h-1 rounded-full bg-slate-200/80 overflow-hidden" aria-hidden="true">
                             <div class="h-full ${avgBarColor} rounded-full" style="width:${Math.min(100, avgPct)}%"></div>
                           </div>
                         </div>
                         ${deptMgrLine}
                       </div>
                     </div>
                   </th>`);

          return `
            <tr class="group/row" data-row-id="${row.id}"
              ondragover="handleRowDragOver(event, '${row.id}')"
              ondragleave="handleRowDragLeave(event)"
              ondrop="handleRowDrop(event, '${row.id}')">
              ${deptRowHeaderHtml}
              ${cellsHtml}
            </tr>`;
        } else if (ui.axis === 'timeline') {
          // Executive Timeline / Gantt Row View (one project per row, continuous effort bars + milestones)
          const rowSpotCls = spotlightId ? (spotlightId === row.id ? 'spotlight-active' : 'spotlight-dimmed') : '';
          const isAdminTlRow = isNonFteProject(row);
          const activeDeptIds = new Set();
          const perData = periods.map(pk => {
            const totFte = getProjTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
            const activeDeptEntries = [];
            const noteDeptEntries = [];
            visibleDepts.forEach(d => {
              const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
              if (a.hasData && !isAdminTlRow) {
                activeDeptEntries.push({ dept: d, avgFte: a.avgFte });
                activeDeptIds.add(d.id);
              }
              if (isAdminTlRow) {
                const cObj = getCellProjectComments(d.id, row.id, pk, ui.timeUnit, db);
                if (cObj.hasAny || cObj.monthNote) {
                  noteDeptEntries.push({
                    dept: d,
                    text: (cObj.direct || cObj.weekEntries[0]?.text || cObj.monthNote || '').trim(),
                  });
                  activeDeptIds.add(d.id);
                }
              }
            });
            const activeDepts = activeDeptEntries.map(e => e.dept);
            const activeCapFte = activeDepts.reduce((acc, d) => acc + getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte, 0)
              || visibleDepts.reduce((acc, d) => acc + getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte, 0);
            const hasOverDept = !isAdminTlRow && activeDepts.some(d => {
              const dc = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
              const dt = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
              return dc > 0 ? Math.round((dt / dc) * 100) > overT : dt > 0;
            });
            const msInPeriod = getMilestonesInPeriod(pk, ui.timeUnit, db.milestones).filter(m => m.projectId === row.id);
            return { pk, fte: totFte, activeDepts, activeDeptEntries, noteDeptEntries, activeCapFte, hasOverDept, msInPeriod };
          });
          const peakFte = Math.max(0.1, ...perData.map(x => x.fte));
          let totalDays = 0;
          let bottleneckCount = 0;
          perData.forEach(x => {
            totalDays += fteToDisplayValue(x.fte, x.pk, ui.timeUnit, 'days');
            if (x.hasOverDept) bottleneckCount++;
          });
          const statusCls = row.status === 'At Risk' ? 'bg-rose-100 text-rose-700' : row.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600';

          const cellsHtml = perData.map((x, idx) => {
            const hasBar = !isAdminTlRow && x.fte > 0.001;
            const hasAdminBar = isAdminTlRow && x.noteDeptEntries.length > 0;
            const hasSlotAt = (i) => isAdminTlRow ? perData[i].noteDeptEntries.length > 0 : perData[i].fte > 0.001;
            const prevHas = idx > 0 && hasSlotAt(idx - 1);
            const nextHas = idx < perData.length - 1 && hasSlotAt(idx + 1);
            let barEdgeCls = 'timeline-bar-single';
            if (prevHas && nextHas) barEdgeCls = 'timeline-bar-mid';
            else if (!prevHas && nextHas) barEdgeCls = 'timeline-bar-start';
            else if (prevHas && !nextHas) barEdgeCls = 'timeline-bar-end';

            const valStr = hasBar ? formatValue(fteToDisplayValue(x.fte, x.pk, ui.timeUnit)) : '';
            const valCompact = hasBar ? formatValue(fteToDisplayValue(x.fte, x.pk, ui.timeUnit), ui.manpowerUnit, false) : '';
            const deptCodes = x.activeDepts.map(d => d.code).join(', ');
            const tentBarCls = row.tentative ? 'timeline-bar-tentative' : '';
            const botBarRing = x.hasOverDept ? 'bottleneck-pill-ring' : '';

            let barHtml = isOverview
              ? `<div class="min-h-[2.2rem] flex items-center justify-center text-[10px] text-slate-300 opacity-0 group-hover/cell:opacity-100 transition">+</div>`
              : `<div class="min-h-[3.35rem] flex items-center justify-center text-xs text-slate-300 opacity-0 group-hover/cell:opacity-100 transition">+</div>`;
            if (hasAdminBar) {
              const noteCodes = x.noteDeptEntries.map(n => n.dept.code).join(', ');
              const firstLine = (x.noteDeptEntries[0].text || '').split('\n')[0].slice(0, 70);
              const tipTxt = `[${row.code}] ${row.name} (Admin · Non-FTE)\n${x.noteDeptEntries.map(n => `${n.dept.code}: ${n.text}`).join('\n')}`;
              if (isOverview) {
                barHtml = `
                  <div class="timeline-bar timeline-bar-overview admin-hashed-bar ${barEdgeCls} ${rowSpotCls}"
                    title="${escapeHtml(tipTxt)}"
                    style="--admin-accent:${row.color};">
                    <span class="admin-hashed-bar-label truncate font-bold text-[10px] text-slate-800">&#9998; ${ovShowBarLabel ? escapeHtml(noteCodes) : x.noteDeptEntries.length}</span>
                  </div>`;
              } else {
                const deptPills = x.noteDeptEntries.map(n => `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-800 font-mono text-[11px] font-bold leading-none shrink-0" title="${escapeHtml(n.dept.name)}: ${escapeHtml(n.text)}"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${n.dept.color}"></span>${escapeHtml(n.dept.code)}</span>`).join('');
                barHtml = `
                  <div class="timeline-bar timeline-bar-std admin-hashed-bar ${barEdgeCls} ${rowSpotCls}"
                    title="${escapeHtml(tipTxt)}"
                    style="--admin-accent:${row.color};">
                    <div class="flex items-center justify-between gap-1.5 w-full">
                      <span class="admin-hashed-bar-label truncate text-xs font-bold text-slate-800">&#9998; ${escapeHtml(firstLine || 'Admin Notes')}</span>
                      <span class="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 text-[9px] font-extrabold uppercase shrink-0">Admin</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-1">${deptPills}</div>
                  </div>`;
              }
            } else if (hasBar) {
              const { fillHex, tier3, showIdentityDot } = resolveCardStyle(x.fte, x.activeCapFte, row.color);
              const capSharePct = x.activeCapFte > 0 ? Math.round((x.fte / x.activeCapFte) * 100) : 999;
              const tierTip = tier3 ? ` • ${tier3.ariaLabel}` : (colorMode === 'fte' ? ` • ${capSharePct > 990 ? '>100%' : capSharePct + '%'} cap` : '');
              const tipText = `[${row.code}] ${row.name} — ${valStr}${deptCodes ? ` (${deptCodes})` : ''}${tierTip}${x.hasOverDept ? ' • Overallocated dept' : ''}`;

              if (isOverview) {
                if (colorMode === 'accent') {
                  barHtml = `
                    <div class="timeline-bar timeline-bar-overview timeline-bar-accent ${barEdgeCls} ${tentBarCls} ${botBarRing} ${rowSpotCls}"
                      title="${escapeHtml(tipText)}"
                      style="--accent-color:${row.color};">
                      ${ovShowBarLabel ? `<span class="truncate font-extrabold tabular-nums text-[10px]">${valCompact}</span>` : '<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:' + row.color + '"></span>'}
                    </div>`;
                } else {
                  const segTheme = getFilledCardTheme(fillHex);
                  const intensity = colorMode === 'fill' ? (0.76 + 0.24 * (x.fte / peakFte)).toFixed(2) : '1';
                  const tierBadgeOv = tier3
                    ? `<span class="text-[9px] font-extrabold shrink-0" aria-hidden="true">${tier3.symbol}</span>`
                    : '';
                  barHtml = `
                    <div class="timeline-bar timeline-bar-overview ${barEdgeCls} ${tentBarCls} ${botBarRing} ${rowSpotCls}"
                      title="${escapeHtml(tipText)}"
                      style="background-color:${segTheme.bg}; color:${segTheme.text}; border: ${row.tentative ? '1.5px dashed' : '1px solid'} ${segTheme.border}; opacity:${intensity};">
                      <span class="inline-flex items-center justify-center gap-0.5 min-w-0 truncate">
                        ${showIdentityDot && ovShowVals ? `<span class="w-1.5 h-1.5 rounded-full ring-1 ring-white/70 shrink-0" style="background:${row.color}" aria-hidden="true"></span>` : ''}
                        ${tierBadgeOv}
                        ${ovShowBarLabel ? `<span class="truncate font-extrabold tabular-nums text-[10px]">${valCompact}</span>` : ''}
                      </span>
                    </div>`;
                }
              } else if (colorMode === 'accent') {
                const deptChipsAccent = x.activeDeptEntries.map(({ dept, avgFte }) => {
                  const dv = formatValue(fteToDisplayValue(avgFte, x.pk, ui.timeUnit), ui.manpowerUnit, false);
                  return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px] font-bold leading-none shrink-0" title="${escapeHtml(dept.name)}: ${escapeHtml(formatValue(fteToDisplayValue(avgFte, x.pk, ui.timeUnit)))}"><span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${dept.color}"></span>${escapeHtml(dept.code)} <span class="font-sans font-semibold text-slate-500 tabular-nums">${dv}</span></span>`;
                }).join('');
                barHtml = `
                  <div class="timeline-bar timeline-bar-std timeline-bar-accent ${barEdgeCls} ${tentBarCls} ${botBarRing} ${rowSpotCls}"
                    title="${escapeHtml(tipText)}"
                    style="--accent-color:${row.color};">
                    <div class="flex items-center justify-between gap-1.5 w-full">
                      <span class="truncate font-extrabold tabular-nums text-xs sm:text-sm text-slate-900">${valStr}</span>
                      ${x.hasOverDept ? '<span class="px-1 py-0.5 rounded bg-rose-100 text-rose-700 text-[9px] font-extrabold shrink-0" title="Overallocated department">&#9888; Over</span>' : ''}
                    </div>
                    ${deptChipsAccent ? `<div class="flex flex-wrap items-center gap-1">${deptChipsAccent}</div>` : ''}
                  </div>`;
              } else {
                const segTheme = getFilledCardTheme(fillHex);
                const intensity = colorMode === 'fill' ? (0.76 + 0.24 * (x.fte / peakFte)).toFixed(2) : '1';
                const idDotHtml = showIdentityDot
                  ? `<span class="w-2.5 h-2.5 rounded-full ring-1 ring-white/75 shrink-0" style="background:${row.color}" aria-hidden="true"></span>`
                  : '';
                const tierBadgeHtml = tier3
                  ? `<span class="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-extrabold shrink-0" style="background-color:${segTheme.chipBg}; color:${segTheme.text};" title="${escapeHtml(tier3.ariaLabel)}" aria-hidden="true">${tier3.symbol}</span>`
                  : '';
                const deptChipsFilled = x.activeDeptEntries.map(({ dept, avgFte }) => {
                  const dv = formatValue(fteToDisplayValue(avgFte, x.pk, ui.timeUnit), ui.manpowerUnit, false);
                  return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[11px] font-bold leading-none shrink-0" style="background-color:${segTheme.chipBg}; color:${segTheme.text};" title="${escapeHtml(dept.name)}: ${escapeHtml(formatValue(fteToDisplayValue(avgFte, x.pk, ui.timeUnit)))}">${escapeHtml(dept.code)} <span class="font-sans font-semibold tabular-nums opacity-90">${dv}</span></span>`;
                }).join('');
                barHtml = `
                  <div class="timeline-bar timeline-bar-std ${barEdgeCls} ${tentBarCls} ${botBarRing} ${rowSpotCls}"
                    title="${escapeHtml(tipText)}"
                    style="background-color:${segTheme.bg}; color:${segTheme.text}; border: ${row.tentative ? '1.5px dashed' : '1px solid'} ${segTheme.border}; opacity:${intensity};">
                    <div class="flex items-center justify-between gap-1.5 w-full">
                      <span class="inline-flex items-center gap-1.5 min-w-0">
                        ${idDotHtml}
                        ${tierBadgeHtml}
                        <span class="truncate font-extrabold tabular-nums text-xs sm:text-sm">${valStr}</span>
                      </span>
                      ${x.hasOverDept ? '<span class="px-1 py-0.5 rounded bg-rose-600 text-white text-[9px] font-extrabold shrink-0" title="Overallocated department">&#9888; Over</span>' : ''}
                    </div>
                    ${deptChipsFilled ? `<div class="flex flex-wrap items-center gap-1">${deptChipsFilled}</div>` : ''}
                  </div>`;
              }
            }

            const msHtml = x.msInPeriod.length > 0
              ? (isOverview
                  ? `<div class="px-0.5 pt-0.5 flex flex-wrap items-center justify-center gap-0.5">${x.msInPeriod.map(m => {
                      const drift = getMilestoneDriftDays(m);
                      return `<div onclick="event.stopPropagation(); openMilestoneModal('${m.id}')" title="${escapeHtml(m.title)} (${m.date}${drift > 0 ? ', +' + drift + 'd slip' : ''})"
                        class="px-1 py-0.5 rounded bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-900 text-[9px] font-bold truncate max-w-full cursor-pointer">
                        <span class="text-violet-600">&#9670;</span>${ovShowVals ? ' ' + escapeHtml(m.title) : ''}
                      </div>`;
                    }).join('')}</div>`
                  : `<div class="px-1 pt-1 space-y-0.5">${x.msInPeriod.map(m => {
                      const drift = getMilestoneDriftDays(m);
                      return `<div onclick="event.stopPropagation(); openMilestoneModal('${m.id}')" title="${escapeHtml(m.title)} (${m.date}${drift > 0 ? ', +' + drift + 'd slip' : ''})"
                        class="px-1.5 py-0.5 rounded bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-900 text-[10px] font-bold flex items-center justify-between gap-1 cursor-pointer">
                        <span class="truncate"><span class="text-violet-600 mr-0.5">&#9670;</span>${escapeHtml(m.title)}</span>
                        ${drift > 0 ? `<span class="text-rose-600 shrink-0">+${drift}d</span>` : ''}
                      </div>`;
                    }).join('')}</div>`)
              : '';

            return `
              <td class="group/cell timeline-cell border-b border-l border-slate-200 matrix-cell-normal transition cursor-pointer"
                onclick="openCellDetailModal('${row.id}', '${x.pk}')">
                ${barHtml}
                ${msHtml}
              </td>`;
          }).join('');

          const tlRowHeaderHtml = isCompactRow
            ? `<th scope="row" title="[${escapeHtml(row.code)}] ${escapeHtml(row.name)}${isAdminTlRow ? ' (Admin · Non-FTE)' : ''}" onclick="toggleSpotlightProject('${row.id}')"
                 class="meeting-row-accent ${rowSpotCls} sticky left-0 z-10 bg-white group-hover/row:bg-slate-50 w-[62px] min-w-[62px] max-w-[62px] ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-middle font-normal text-center cursor-pointer"
                 style="--row-accent:${row.color};">
                 <div class="flex flex-col items-center justify-center gap-1">
                   <div class="meeting-vertical-text timeline-vertical-text text-xs font-extrabold text-slate-900 tracking-wide">${escapeHtml(row.name)}</div>
                   <span class="font-mono text-[10px] font-bold ${isAdminTlRow ? 'text-sky-700' : (bottleneckCount > 0 ? 'text-rose-600' : 'text-slate-500')}">${isAdminTlRow ? '&#9998; ' : ''}${escapeHtml(row.code)}</span>
                 </div>
               </th>`
            : buildProjectDetailedRowHeaderHtml({
                row,
                totalDays,
                bottleneckCount,
                activeDeptCount: activeDeptIds.size,
                reorderControlsHtml: '',
                statusCls,
                rowSpotCls,
                clickAttr: `onclick="toggleSpotlightProject('${row.id}')"`,
              });

          const isFirstAdminTlRow = isAdminTlRow && rowIdx > 0 && !isNonFteProject(rows[rowIdx - 1]);
          return `<tr class="group/row ${isFirstAdminTlRow ? 'admin-row-divider' : ''}" data-row-id="${row.id}">${tlRowHeaderHtml}${cellsHtml}</tr>`;
        } else {
          // Project Row View
          let totalDays = 0;
          let bottleneckCount = 0;
          const activeDeptIds = new Set();
          periods.forEach(pk => {
            totalDays += fteToDisplayValue(getProjTotalAllocatedFte(row.id, pk, ui.timeUnit, db), pk, ui.timeUnit, 'days');
            visibleDepts.forEach(d => {
              if (!getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations).hasData) return;
              activeDeptIds.add(d.id);
              const dCap = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
              const dTot = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
              const dPct = dCap > 0 ? Math.round((dTot / dCap) * 100) : (dTot > 0 ? 999 : 0);
              if (dPct > overT) bottleneckCount++;
            });
          });
          const statusCls = row.status === 'At Risk' ? 'bg-rose-100 text-rose-700' : row.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600';
          const rowSpotCls = spotlightId ? (spotlightId === row.id ? 'spotlight-active' : 'spotlight-dimmed') : '';

          const cellsHtml = periods.map(pk => {
            const totFte = getProjTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
            const totStr = totFte > 0 ? formatValue(fteToDisplayValue(totFte, pk, ui.timeUnit)) : '—';
            const totCompact = totFte > 0 ? formatValue(fteToDisplayValue(totFte, pk, ui.timeUnit), ui.manpowerUnit, false) : '—';
            const cmtCount = getCellTotalCommentCount(row.id, pk, 'project', ui.timeUnit, db);
            const projMsList = getMilestonesInPeriod(pk, ui.timeUnit, db.milestones).filter(m => m.projectId === row.id);

            if (isOverview) {
              let hasPeriodOver = false;
              const isAdminProjRow = isNonFteProject(row);
              const ovDeptChips = visibleDepts.map(d => {
                const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
                const cmtObj = getCellProjectComments(d.id, row.id, pk, ui.timeUnit, db);
                if (!a.hasData && !(isAdminProjRow && cmtObj.hasAny)) return '';
                if (searchQ && !matchesSearchForPair(d, row, pk)) return '';
                if (!a.hasData && isAdminProjRow && cmtObj.hasAny) {
                  const notePreview = (cmtObj.direct || (cmtObj.weekEntries[0]?.text) || '').replace(/\s+/g, ' ');
                  return `<div onclick="event.stopPropagation(); openAllocationModal('${d.id}', '${row.id}', '${pk}')" title="${escapeHtml('[' + d.code + '] ' + d.name + ' (Admin)\n' + notePreview)}"
                    class="admin-hashed-chip ${rowSpotCls} px-1 py-0.5 rounded text-[9px] font-bold flex items-center justify-between gap-0.5 leading-tight truncate cursor-pointer"
                    style="--admin-accent:${d.color};">
                    <span class="font-mono truncate">${escapeHtml(d.code)}</span>
                    <span class="shrink-0" aria-hidden="true">&#9998;</span>
                  </div>`;
                }
                const deptCap = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
                const deptTot = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
                const deptPct = deptCap > 0 ? Math.round((deptTot / deptCap) * 100) : 0;
                const isDeptOver = deptPct > overT;
                if (isDeptOver) hasPeriodOver = true;
                const valNum = formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit), ui.manpowerUnit, false);
                const valFull = formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit));
                const { fillHex, tier3, showIdentityDot } = resolveCardStyle(a.avgFte, deptCap, d.color);
                const tipTxt = `[${d.code}] ${d.name}: ${valFull} (Dept total: ${deptPct}%)${tier3 ? ' • ' + tier3.ariaLabel : ''}`;
                const ringCls = isDeptOver ? 'bottleneck-pill-ring' : '';
                if (useColorFill) {
                  const ft = getFilledCardTheme(fillHex);
                  return `<div onclick="event.stopPropagation(); openAllocationModal('${d.id}', '${row.id}', '${pk}')" title="${escapeHtml(tipTxt)}"
                    class="${rowSpotCls} ${ringCls} px-1 py-0.5 rounded text-[9px] font-bold flex items-center justify-between gap-0.5 leading-tight truncate cursor-pointer"
                    style="background-color:${ft.bg}; color:${ft.text}; border:1px solid ${ft.border};">
                    <span class="inline-flex items-center gap-0.5 min-w-0 truncate">
                      ${showIdentityDot ? `<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${d.color}"></span>` : ''}
                      <span class="font-mono truncate">${escapeHtml(d.code)}</span>
                    </span>
                    ${ovShowVals ? `<span class="tabular-nums shrink-0">${valNum}</span>` : ''}
                  </div>`;
                }
                return `<div onclick="event.stopPropagation(); openAllocationModal('${d.id}', '${row.id}', '${pk}')" title="${escapeHtml(tipTxt)}"
                  class="accent-card ${rowSpotCls} ${ringCls} px-1 py-0.5 rounded bg-white border border-slate-200/90 text-[9px] font-bold text-slate-800 flex items-center justify-between gap-0.5 leading-tight truncate cursor-pointer"
                  style="--accent-color:${d.color}; --accent-w:3px; border-left:3px solid ${d.color};">
                  <span class="font-mono truncate">${escapeHtml(d.code)}</span>
                  ${ovShowVals ? `<span class="tabular-nums text-slate-600 shrink-0">${valNum}</span>` : ''}
                </div>`;
              }).join('');
              const ovMsBadge = projMsList.length > 0
                ? `<span title="${escapeHtml(projMsList.map(m => '◆ ' + m.title + ' (' + m.date + ')').join('\n'))}"
                    onclick="event.stopPropagation(); openMilestoneModal('${projMsList[0].id}')"
                    class="text-[9px] font-bold text-violet-700 shrink-0 cursor-pointer">&#9670;${projMsList.length > 1 ? projMsList.length : ''}</span>`
                : '';
              const hInfo = formatPeriodHeader(pk, ui.timeUnit);
              return `
                <td class="group/cell align-top ${s.cellPad} border-b border-l border-slate-200 matrix-cell-normal transition cursor-pointer"
                  title="[${escapeHtml(row.code)}] ${escapeHtml(row.name)} — ${escapeHtml(hInfo.title)}: ${isAdminProjRow ? (cmtCount + ' Admin note(s)') : totStr} • Click for full cell details"
                  onclick="openCellDetailModal('${row.id}', '${pk}')">
                  <div class="flex items-center justify-between gap-0.5 mb-1">
                    <span class="text-[10px] font-extrabold tabular-nums ${isAdminProjRow ? (cmtCount > 0 ? 'text-sky-700' : 'text-slate-300') : (totFte > 0 ? 'text-slate-800' : 'text-slate-300')}">${isAdminProjRow ? (cmtCount > 0 ? '&#9998; ' + cmtCount : '—') : totCompact}</span>
                    <span class="inline-flex items-center gap-0.5">
                      ${hasPeriodOver ? '<span class="text-[9px] font-extrabold text-rose-600" title="Overallocated department">&#9888;</span>' : ''}
                      ${ovMsBadge}
                    </span>
                  </div>
                  <div class="space-y-0.5">${ovDeptChips}</div>
                </td>`;
            }

            const isAdminProjRow = isNonFteProject(row);
            const pills = visibleDepts.map(d => {
              const a = getAllocationForPeriod(d.id, row.id, pk, ui.timeUnit, db.allocations);
              const cmtObj = getCellProjectComments(d.id, row.id, pk, ui.timeUnit, db);
              if (!a.hasData && !cmtObj.hasAny) return '';
              if (searchQ && !matchesSearchForPair(d, row, pk)) return '';

              const deptCap = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
              const { fillHex, tier3, showIdentityDot } = isAdminProjRow
                ? { fillHex: d.color, tier3: null, showIdentityDot: false }
                : resolveCardStyle(a.hasData ? a.avgFte : 0, deptCap, d.color);
              const filledTheme = useColorFill ? getFilledCardTheme(fillHex) : null;
              const cmtHtml = renderInlineCommentHtml(cmtObj, filledTheme);
              const fullTooltipNote = cmtObj.direct ? `\nNote: ${cmtObj.direct}` : '';

              if (!a.hasData && cmtObj.hasAny) {
                const noteClickFn = isAdminProjRow ? `openAllocationModal('${d.id}', '${row.id}', '${pk}')` : `openCellDetailModal('${row.id}', '${pk}')`;
                const noteKindLbl = isAdminProjRow ? 'Admin' : 'Note';
                if (isAdminProjRow) {
                  const adminCmtHtml = renderInlineCommentHtml(cmtObj, null);
                  return `
                    <div onclick="event.stopPropagation(); ${noteClickFn}"
                      title="[${escapeHtml(d.code)}] ${escapeHtml(d.name)} — Admin (Non-FTE)${escapeHtml(fullTooltipNote)}"
                      class="matrix-card admin-hashed-card ${rowSpotCls} ${s.pillBox} rounded-lg cursor-pointer shadow-2xs"
                      style="--admin-accent:${d.color}; --accent-w:${s.pillBorderW};">
                      <div class="flex items-center justify-between gap-1.5">
                        <span class="truncate font-bold text-slate-800">${escapeHtml(d.name)}</span>
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 shrink-0">&#9998; Admin</span>
                      </div>
                      ${adminCmtHtml}
                    </div>`;
                }
                if (useColorFill) {
                  return `
                    <div onclick="event.stopPropagation(); ${noteClickFn}"
                      class="matrix-card ${rowSpotCls} ${s.pillBox} rounded-xl cursor-pointer shadow-2xs"
                      style="background-color:${filledTheme.bg}; color:${filledTheme.text}; border: 1.5px dashed ${filledTheme.border};">
                      <div class="flex items-center justify-between gap-1.5">
                        <div class="flex items-center gap-1.5 min-w-0">
                          ${showIdentityDot ? `<span class="w-2 h-2 rounded-full ring-1 ring-white/70 shrink-0" style="background:${d.color}"></span>` : ''}
                          <span class="truncate font-bold">${escapeHtml(d.name)}</span>
                        </div>
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style="background-color:${filledTheme.chipBg};">${noteKindLbl}</span>
                      </div>
                      ${cmtHtml}
                    </div>`;
                }
                return `
                  <div onclick="event.stopPropagation(); ${noteClickFn}"
                    class="matrix-card accent-card ${rowSpotCls} ${s.pillBox} rounded-lg bg-white/90 border border-dashed border-slate-300 hover:border-indigo-400 cursor-pointer"
                    style="--accent-color:${d.color}; --accent-w:${s.pillBorderW}; border-left: ${s.pillBorderW} solid ${d.color};">
                    <div class="flex items-center justify-between gap-1.5">
                      <span class="truncate font-semibold text-slate-700">${escapeHtml(d.name)}</span>
                      <span class="text-[10px] font-bold ${isAdminProjRow ? 'px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700' : 'text-indigo-600'} shrink-0">${noteKindLbl}</span>
                    </div>
                    ${cmtHtml}
                  </div>`;
              }

              const deptTot = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
              const deptPct = deptCap > 0 ? Math.round((deptTot / deptCap) * 100) : 0;
              const isDeptOver = deptPct > overT;
              const loadDot = isDeptOver ? 'bg-rose-500' : deptPct >= warnT ? 'bg-amber-500' : 'bg-emerald-500';
              const bottleneckRingCls = isDeptOver ? 'bottleneck-pill-ring' : '';
              const bottleneckTagFilled = isDeptOver
                ? `<span class="px-1 py-0.5 rounded text-[9px] font-extrabold bg-rose-600 text-white shrink-0" title="${escapeHtml(d.name)} is overallocated at ${deptPct}% in this period">&#9888; ${deptPct}%</span>`
                : '';
              const bottleneckTagAccent = isDeptOver
                ? `<span class="px-1 py-0.5 rounded text-[9px] font-extrabold bg-rose-100 text-rose-700 shrink-0" title="${escapeHtml(d.name)} is overallocated at ${deptPct}% in this period">&#9888; ${deptPct}%</span>`
                : '';
              const valStr = formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit));
              const deptCapDisp = formatValue(fteToDisplayValue(deptCap, pk, ui.timeUnit));
              const capSharePct = deptCap > 0 ? Math.round((a.avgFte / deptCap) * 100) : (a.avgFte > 0 ? 999 : 0);
              const capShareTxt = `${capSharePct > 990 ? '>100%' : capSharePct + '%'} of ${deptCapDisp} cap`;
              const tierTooltip = tier3 ? ` — ${tier3.ariaLabel}` : '';
              const tierBadgeHtml = tier3
                ? `<span class="inline-flex items-center justify-center px-1 rounded text-[9px] font-extrabold shrink-0" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};" title="${escapeHtml(tier3.ariaLabel)}" aria-hidden="true">${tier3.symbol}</span>`
                : '';

              if (useColorFill) {
                return `
                  <div draggable="${!isPresent}"
                    data-drag-type="alloc" data-drag-dept="${d.id}" data-drag-proj="${row.id}" data-drag-period="${pk}"
                    ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
                    onclick="event.stopPropagation(); openAllocationModal('${d.id}', '${row.id}', '${pk}')"
                    title="[${escapeHtml(d.code)}] ${escapeHtml(d.name)}: ${valStr} (${capShareTxt} • Dept total: ${deptPct}%)${isDeptOver ? ' — BOTTLENECK: Dept Overallocated' : ''}${tierTooltip}${escapeHtml(fullTooltipNote)}"
                    class="matrix-card group/pill ${rowSpotCls} ${bottleneckRingCls} ${s.pillBox} rounded-xl shadow-xs cursor-grab active:cursor-grabbing"
                    style="background-color:${filledTheme.bg}; color:${filledTheme.text}; border: 1px solid ${filledTheme.border};">
                    <div class="flex items-center justify-between gap-1.5">
                      <div class="flex items-center gap-1.5 min-w-0">
                        ${showIdentityDot ? `<span class="w-2 h-2 rounded-full ring-1 ring-white/75 shrink-0" style="background:${d.color}"></span>` : ''}
                        ${tierBadgeHtml}
                        ${!isPresent && !showIdentityDot ? `<span class="w-2 h-2 rounded-full ${loadDot} ring-1 ring-white/70 shrink-0"></span>` : ''}
                        <span class="truncate font-bold">${escapeHtml(d.name)}</span>
                        ${bottleneckTagFilled}
                      </div>
                      <div class="flex items-center gap-0.5 shrink-0">
                        ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${pk}', -1)" title="Decrease allocation"
                          class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded font-bold flex items-center justify-center transition" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">&minus;</button>` : ''}
                        <span ${!isPresent ? `onclick="startInlineValueEdit(event, '${d.id}', '${row.id}', '${pk}')" title="Click to quick-edit value inline"` : ''} class="${s.pillVal} tabular-nums px-0.5 ${!isPresent ? 'cursor-text rounded hover:underline' : ''}">${valStr}</span>
                        ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${pk}', 1)" title="Increase allocation"
                          class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded font-bold flex items-center justify-center transition" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">+</button>` : ''}
                        ${!isPresent ? `<button type="button" onclick="quickExtendAllocation(event, '${d.id}', '${row.id}', '${pk}')" title="Copy into next period"
                          class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 px-1 rounded font-bold transition" style="background-color:${filledTheme.chipBg}; color:${filledTheme.text};">&rarr;</button>` : ''}
                      </div>
                    </div>
                    ${cmtHtml}
                  </div>`;
              }

              return `
                <div draggable="${!isPresent}"
                  data-drag-type="alloc" data-drag-dept="${d.id}" data-drag-proj="${row.id}" data-drag-period="${pk}"
                  ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
                  onclick="event.stopPropagation(); openAllocationModal('${d.id}', '${row.id}', '${pk}')"
                  title="[${escapeHtml(d.code)}] ${escapeHtml(d.name)}: ${valStr} (${capShareTxt} • Dept total: ${deptPct}%)${isDeptOver ? ' — BOTTLENECK: Dept Overallocated' : ''}${escapeHtml(fullTooltipNote)}"
                  class="matrix-card accent-card group/pill ${rowSpotCls} ${bottleneckRingCls} ${s.pillBox} rounded-lg bg-white border border-slate-200/90 hover:border-indigo-300 shadow-2xs cursor-grab active:cursor-grabbing"
                  style="--accent-color:${d.color}; --accent-w:${s.pillBorderW}; border-left: ${s.pillBorderW} solid ${d.color};">
                  <div class="flex items-center justify-between gap-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                      ${!isPresent ? `<span class="w-2 h-2 rounded-full ${loadDot} shrink-0"></span>` : ''}
                      <span class="truncate font-semibold text-slate-800">${escapeHtml(d.name)}</span>
                      ${bottleneckTagAccent}
                    </div>
                    <div class="flex items-center gap-0.5 shrink-0">
                      ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${pk}', -1)"
                        class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded bg-slate-100 hover:bg-rose-100 text-slate-700 font-bold flex items-center justify-center transition">&minus;</button>` : ''}
                      <span ${!isPresent ? `onclick="startInlineValueEdit(event, '${d.id}', '${row.id}', '${pk}')" title="Click to quick-edit value inline"` : ''} class="${s.pillVal} text-slate-900 tabular-nums px-0.5 ${!isPresent ? 'cursor-text rounded hover:underline' : ''}">${valStr}</span>
                      ${!isPresent ? `<button type="button" onclick="quickStepAllocation(event, '${d.id}', '${row.id}', '${pk}', 1)"
                        class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 w-4 h-4 rounded bg-slate-100 hover:bg-emerald-100 text-slate-700 font-bold flex items-center justify-center transition">+</button>` : ''}
                      ${!isPresent ? `<button type="button" onclick="quickExtendAllocation(event, '${d.id}', '${row.id}', '${pk}')"
                        class="desktop-hover-reveal opacity-0 group-hover/pill:opacity-100 px-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold transition">&rarr;</button>` : ''}
                    </div>
                  </div>
                  ${cmtHtml}
                </div>`;
            }).join('');

            const msHtml = projMsList
              .map(m => `
                <div draggable="${!isPresent}"
                  data-drag-type="milestone" data-drag-ms="${m.id}" data-drag-period="${pk}"
                  ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
                  onclick="event.stopPropagation(); openMilestoneModal('${m.id}')"
                  class="flex items-center justify-between gap-1 ${s.msBox} rounded-md bg-violet-50/90 hover:bg-violet-100/90 border border-violet-200/80 text-violet-900 cursor-grab transition">
                  <span class="truncate"><span class="text-violet-600 mr-1" aria-hidden="true">◆</span>${escapeHtml(m.title)}</span>
                </div>`).join('');

            const cellHeaderHtml = isPresent
              ? (isAdminProjRow ? '' : (totFte > 0 ? `<div class="flex items-center justify-end mb-2"><span class="${s.pctText} text-slate-700 tabular-nums">${totStr}</span></div>` : ''))
              : `<div class="flex items-center justify-between ${s.capText} text-slate-500 mb-1.5">
                   <span>${isAdminProjRow ? 'Admin Notes' : 'Effort'}</span>
                   <div class="flex items-center gap-1.5">
                     <button type="button" onclick="event.stopPropagation(); openCellDetailModal('${row.id}', '${pk}')"
                       class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md transition ${cmtCount > 0 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-[10px]' : 'opacity-0 group-hover/cell:opacity-100 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 text-[10px]'}">
                       <svg class="w-3 h-3" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
                       ${cmtCount > 0 ? `<span>${cmtCount}</span>` : ''}
                     </button>
                     ${isAdminProjRow
                       ? `<span class="text-sky-700 font-bold tabular-nums">${cmtCount > 0 ? `${cmtCount} note${cmtCount === 1 ? '' : 's'}` : '—'}</span>`
                       : `<span class="text-slate-800 font-bold tabular-nums">${totStr}</span>`}
                   </div>
                 </div>`;

            const addBtnHtml = !isPresent
              ? `<button type="button" onclick="event.stopPropagation(); openAllocationModal('', '${row.id}', '${pk}')"
                   class="mt-1.5 w-full py-1 rounded-lg border border-dashed border-slate-300/90 hover:border-indigo-400 hover:bg-indigo-50/70 text-[10px] font-semibold text-slate-400 hover:text-indigo-700 opacity-70 sm:opacity-0 group-hover/cell:opacity-100 transition flex items-center justify-center gap-1">
                   <span>${isAdminProjRow ? '+ Add Note' : '+ Add'}</span>
                 </button>`
              : '';

            return `
              <td class="group/cell align-top ${s.cellPad} border-b border-l border-slate-200 matrix-cell-normal transition cursor-pointer"
                ondragover="handleCellDragOver(event)" ondragleave="handleCellDragLeave(event)"
                ondrop="handleCellDrop(event, '${row.id}', '${pk}')"
                onclick="openCellDetailModal('${row.id}', '${pk}')">
                ${cellHeaderHtml}
                <div class="${s.pillSpace}">
                  ${pills}
                  ${msHtml}
                </div>
                ${addBtnHtml}
              </td>`;
          }).join('');

          const isAdminProjRowHdr = isNonFteProject(row);
          const projRowHeaderHtml = isCompactRow
            ? `<th scope="row" title="[${escapeHtml(row.code)}] ${escapeHtml(row.name)}${isAdminProjRowHdr ? ' (Admin · Non-FTE)' : ''}${bottleneckCount ? ' — ' + bottleneckCount + ' overallocated dept slot(s)' : ''}"
                 onclick="toggleSpotlightProject('${row.id}')"
                 class="meeting-row-accent ${rowSpotCls} sticky left-0 z-10 bg-white group-hover/row:bg-slate-50 w-[62px] min-w-[62px] max-w-[62px] ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-middle font-normal text-center cursor-pointer"
                 style="--row-accent:${row.color};">
                 <div class="flex flex-col items-center justify-center gap-1.5">
                   <div class="meeting-vertical-text text-xs font-extrabold text-slate-900 tracking-wide">${escapeHtml(row.name)}</div>
                   <span class="font-mono text-[10px] font-bold ${isAdminProjRowHdr ? 'text-sky-700' : (bottleneckCount > 0 ? 'text-rose-600' : 'text-slate-500')}">${isAdminProjRowHdr ? '&#9998; ' : (bottleneckCount > 0 ? '&#9888; ' : '')}${escapeHtml(row.code)}</span>
                 </div>
               </th>`
            : buildProjectDetailedRowHeaderHtml({
                row,
                totalDays,
                bottleneckCount,
                activeDeptCount: activeDeptIds.size,
                reorderControlsHtml,
                statusCls,
                rowSpotCls,
                clickAttr: '',
              });

          const isFirstAdminProjRow = isNonFteProject(row) && rowIdx > 0 && !isNonFteProject(rows[rowIdx - 1]);
          return `
            <tr class="group/row ${isFirstAdminProjRow ? 'admin-row-divider' : ''}" data-row-id="${row.id}"
              ondragover="handleRowDragOver(event, '${row.id}')"
              ondragleave="handleRowDragLeave(event)"
              ondrop="handleRowDrop(event, '${row.id}')">
              ${projRowHeaderHtml}
              ${cellsHtml}
            </tr>`;
        }
      }).join('');

      // Dedicated Milestones Swimlane Row for By Department view (shown cleanly at top instead of inside dept cells)
      let deptMilestonesRowHtml = '';
      if (ui.axis === 'department' && rows.length > 0) {
        let totalVisibleMs = 0;
        const msCellsHtml = periods.map(pk => {
          const pkMs = getVisibleMilestonesForDeptView(pk, db, visibleProjs);
          totalVisibleMs += pkMs.length;
          const chipsHtml = pkMs.map(m => {
            const p = db.projects.find(x => x.id === m.projectId);
            const d = db.departments.find(x => x.id === m.deptId);
            const drift = getMilestoneDriftDays(m);
            const msSpotCls = spotlightId ? (spotlightId === m.projectId ? 'spotlight-active' : 'spotlight-dimmed') : '';
            const tip = `${m.title}${p ? ' [' + p.code + ' ' + p.name + ']' : ''}${d ? ' • Dept: ' + d.code : ''} (${m.date}${drift > 0 ? ', +' + drift + 'd slip' : ''})`;
            if (isOverview) {
              return `
                <div draggable="${!isPresent}"
                  data-drag-type="milestone" data-drag-ms="${m.id}" data-drag-period="${pk}"
                  ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
                  onclick="event.stopPropagation(); openMilestoneModal('${m.id}')"
                  title="${escapeHtml(tip)}"
                  class="${msSpotCls} px-1 py-0.5 rounded bg-violet-50 hover:bg-violet-100 border border-violet-200 text-violet-900 text-[9px] font-bold flex items-center justify-between gap-0.5 leading-tight truncate cursor-pointer">
                  <span class="truncate"><span class="text-violet-600" aria-hidden="true">&#9670;</span> ${escapeHtml(ovShowVals ? m.title : (p ? p.code : m.title))}</span>
                </div>`;
            }
            return `
              <div draggable="${!isPresent}"
                data-drag-type="milestone" data-drag-ms="${m.id}" data-drag-period="${pk}"
                ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
                onclick="event.stopPropagation(); openMilestoneModal('${m.id}')"
                title="${escapeHtml(tip)}"
                class="flex items-center justify-between gap-1 ${msSpotCls} ${s.msBox} rounded-md bg-violet-50/90 hover:bg-violet-100/90 border border-violet-200/80 text-violet-900 cursor-grab transition">
                <span class="inline-flex items-center gap-1 min-w-0 truncate">
                  <span class="text-violet-600 shrink-0" aria-hidden="true">&#9670;</span>
                  ${p ? `<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${p.color}" aria-hidden="true"></span>` : ''}
                  <span class="truncate">${escapeHtml(m.title)}</span>
                </span>
                <span class="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-violet-700 shrink-0">
                  ${p ? `<span>${escapeHtml(p.code)}</span>` : ''}
                  ${drift > 0 ? `<span class="text-rose-600">+${drift}d</span>` : ''}
                </span>
              </div>`;
          }).join('');
          const addMsBtn = !isPresent
            ? `<button type="button" onclick="event.stopPropagation(); openMilestoneModal('', '${ui.filterProj !== 'all' ? ui.filterProj : ''}', '${getPeriodMidDateISO(pk, ui.timeUnit)}', '${ui.filterDept !== 'all' ? ui.filterDept : ''}')"
                 title="Add a milestone in ${escapeHtml(formatPeriodHeader(pk, ui.timeUnit).title)}"
                 class="${pkMs.length > 0 ? 'mt-1' : ''} w-full py-0.5 rounded-md border border-dashed border-violet-200 hover:border-violet-300 hover:bg-violet-50 text-[10px] font-semibold text-violet-700 opacity-0 group-hover/cell:opacity-100 transition">+ Milestone</button>`
            : '';
          return `
            <td class="group/cell align-top ${s.cellPad} border-b border-l border-slate-200 bg-violet-50/40 transition cursor-pointer"
              ondragover="handleCellDragOver(event)" ondragleave="handleCellDragLeave(event)"
              ondrop="handleCellDrop(event, '__MILESTONES__', '${pk}')"
              onclick="openMilestoneModal('', '${ui.filterProj !== 'all' ? ui.filterProj : ''}', '${getPeriodMidDateISO(pk, ui.timeUnit)}', '${ui.filterDept !== 'all' ? ui.filterDept : ''}')">
              <div class="${s.pillSpace}">
                ${chipsHtml || (isOverview ? '<div class="text-[9px] text-slate-300 text-center">&mdash;</div>' : '')}
              </div>
              ${addMsBtn}
            </td>`;
        }).join('');

        const msRowHeaderHtml = isCompactRow
          ? `<th scope="row" title="Roadmap Milestones (${totalVisibleMs} in visible window)"
               class="meeting-row-accent sticky left-0 z-10 bg-violet-50 w-[62px] min-w-[62px] max-w-[62px] ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-middle font-normal text-center"
               style="--row-accent:#7c3aed;">
               <div class="flex flex-col items-center justify-center gap-1">
                 <div class="meeting-vertical-text text-xs font-extrabold text-violet-900 tracking-wide">Milestones</div>
                 <span class="rounded-md bg-violet-100 text-violet-800 px-1 py-0.5 text-[10px] font-extrabold tabular-nums">&#9670; ${totalVisibleMs}</span>
               </div>
             </th>`
          : (isCompactGrid
              ? `<th scope="row" class="sticky left-0 z-10 bg-violet-50 ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-top font-normal text-left">
                   <div class="flex items-center justify-between gap-1">
                     <div class="flex items-center gap-1.5 min-w-0">
                       <span class="w-1.5 h-7 rounded-full bg-violet-500 shrink-0" aria-hidden="true"></span>
                       <div class="min-w-0">
                         <div class="${s.rowName} text-violet-900 truncate">&#9670; Milestones</div>
                       </div>
                     </div>
                     <span class="rounded-md bg-violet-100 text-violet-800 ${s.rowBadge} tabular-nums">${totalVisibleMs}</span>
                   </div>
                 </th>`
              : `<th scope="row" class="sticky left-0 z-10 bg-violet-50 ${s.tdSticky} border-b border-slate-200 sticky-col-shadow align-top font-normal text-left">
                   <div class="flex items-stretch gap-2 min-w-0">
                     <span class="w-1.5 rounded-full bg-violet-500 shrink-0" aria-hidden="true"></span>
                     <div class="min-w-0 flex-1">
                       <div class="flex items-center justify-between gap-1.5">
                         <div class="${s.rowName} text-violet-900 truncate">&#9670; Milestones</div>
                         <span class="rounded-md shrink-0 tabular-nums bg-violet-100 text-violet-800 ${s.rowBadge}">${totalVisibleMs}</span>
                       </div>
                       <div class="${s.rowMeta} text-violet-700 flex items-center justify-between gap-1 mt-0.5">
                         <span>Dedicated milestone lane</span>
                         ${!isPresent ? `<button type="button" onclick="openMilestoneModal('', '${ui.filterProj !== 'all' ? ui.filterProj : ''}', '${getPeriodMidDateISO(periods[0], ui.timeUnit)}', '${ui.filterDept !== 'all' ? ui.filterDept : ''}')" class="px-1.5 py-0.5 rounded bg-white border border-violet-200 hover:bg-violet-100 text-violet-700 text-[9px] font-bold transition shrink-0">+ Add</button>` : ''}
                       </div>
                     </div>
                   </div>
                 </th>`);

        deptMilestonesRowHtml = `<tr class="group/row" data-row-id="__MILESTONES__">${msRowHeaderHtml}${msCellsHtml}</tr>`;
      }

      const footerCells = periods.map(pk => {
        let totA = 0, totC = 0;
        visibleDepts.forEach(d => {
          totA += getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
          totC += getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
        });
        const pct = totC > 0 ? Math.round((totA / totC) * 100) : 0;
        const pctCls = pct > overT ? 'text-rose-400' : pct >= warnT ? 'text-amber-300' : 'text-emerald-300';
        if (isOverview) {
          return `
            <td class="${s.footCell} border-l border-slate-700/70 text-center" title="Total: ${formatValue(fteToDisplayValue(totA, pk, ui.timeUnit))} / Cap: ${formatValue(fteToDisplayValue(totC, pk, ui.timeUnit))} (${pct}%)">
              <div class="font-extrabold tabular-nums ${pctCls}">${pct}%</div>
              <div class="${s.footSub} text-slate-300 tabular-nums mt-0.5 truncate">${formatValue(fteToDisplayValue(totA, pk, ui.timeUnit), ui.manpowerUnit, false)}</div>
            </td>`;
        }
        return `
          <td class="${s.footCell} border-l border-slate-700/70">
            <div class="flex items-center justify-between font-bold">
              <span class="tabular-nums">${formatValue(fteToDisplayValue(totA, pk, ui.timeUnit))}</span>
              <span class="tabular-nums ${pctCls}">${pct}%</span>
            </div>
            <div class="${s.footSub} text-slate-400 mt-0.5">Cap: ${formatValue(fteToDisplayValue(totC, pk, ui.timeUnit))}</div>
          </td>`;
      }).join('');

      const footerHtml = isPresent
        ? ''
        : `<tfoot>
            <tr class="bg-slate-900 text-white">
              <th scope="row" class="sticky left-0 z-20 bg-slate-900 ${isCompactRow ? 'px-1.5 py-2.5 text-[10px] text-center' : s.footCell + ' text-left'} font-bold uppercase tracking-wider sticky-col-shadow">
                ${isCompactRow ? 'Total' : `Total (${unitShortLabel()})`}
              </th>
              ${footerCells}
            </tr>
          </tfoot>`;

      const captionText = `Roadmap matrix grouped by ${ui.axis}, showing ${periods.length} ${ui.timeUnit}s in ${unitShortLabel()}.`;
      const colGroupHtml = `<colgroup>
             <col data-sticky-col="1" style="width: ${colGeo.stickyW}px;" />
             ${periods.map(() => `<col data-period-col="1" style="width: ${colGeo.colW}px;" />`).join('')}
           </colgroup>`;
      const cornerLabel = isCompactRow
        ? (ui.axis === 'department' ? 'Dept' : ui.axis === 'timeline' ? 'Gantt' : 'Proj')
        : (ui.axis === 'department' ? 'Departments' : ui.axis === 'timeline' ? 'Project Timeline' : 'Projects');

      wrapper.style.scrollPaddingLeft = `${colGeo.stickyW}px`;
      wrapper.innerHTML = `
        <table data-period-count="${periods.length}" class="table-fixed border-separate border-spacing-0 text-left" style="width: ${colGeo.totalTableW}px;">
          <caption class="sr-only">${escapeHtml(captionText)}</caption>
          ${colGroupHtml}
          <thead>
            <tr>
              <th scope="col" class="sticky left-0 z-20 bg-slate-50 ${isCompactRow ? 'w-[62px] min-w-[62px] max-w-[62px]' : ''} ${s.thSticky} border-b border-slate-200 font-extrabold text-slate-700 uppercase tracking-wider sticky-col-shadow">
                ${cornerLabel}
              </th>
              ${colHeaders}
            </tr>
          </thead>
          <tbody>
            ${deptMilestonesRowHtml}${bodyRows || `<tr><td colspan="${periods.length + 1}" class="px-6 py-10 text-center text-xs text-slate-500">No rows match the active filters. <button type="button" onclick="clearMatrixFilters(); if (ui.hideEmptyRows) toggleHideEmptyRows();" class="ml-1 font-bold text-indigo-600 hover:underline">Reset filters</button></td></tr>`}
          </tbody>
          ${footerHtml}
        </table>`;

      wrapper.scrollLeft = keepScroll ? prevScrollLeft : 0;
      requestAnimationFrame(syncMatrixFloatingHeader);
    }

    /* ---------- Desktop Drag-and-Drop Handlers (Cells & Row Reordering) ---------- */

    function handleRowDragStart(event) {
      const rowId = event.currentTarget.dataset.dragRowId;
      activeDragPayload = { type: 'row', rowId, axis: ui.axis };
      const tr = event.currentTarget.closest('tr');
      if (tr) tr.classList.add('dragging-item');
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', JSON.stringify(activeDragPayload)); } catch (e) {}
    }

    function handleRowDragEnd(event) {
      const tr = event.currentTarget.closest('tr');
      if (tr) tr.classList.remove('dragging-item');
      document.querySelectorAll('.drag-over-row-top, .drag-over-row-bottom').forEach(el => {
        el.classList.remove('drag-over-row-top', 'drag-over-row-bottom');
      });
      activeDragPayload = null;
    }

    function handleRowDragOver(event, targetRowId) {
      if (!activeDragPayload || activeDragPayload.type !== 'row') return;
      if (activeDragPayload.rowId === targetRowId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const tr = event.currentTarget;
      const rect = tr.getBoundingClientRect();
      const placeBefore = (event.clientY - rect.top) < rect.height / 2;
      tr.classList.toggle('drag-over-row-top', placeBefore);
      tr.classList.toggle('drag-over-row-bottom', !placeBefore);
    }

    function handleRowDragLeave(event) {
      if (!activeDragPayload || activeDragPayload.type !== 'row') return;
      const tr = event.currentTarget;
      if (!tr.contains(event.relatedTarget)) {
        tr.classList.remove('drag-over-row-top', 'drag-over-row-bottom');
      }
    }

    function handleRowDrop(event, targetRowId) {
      if (!activeDragPayload || activeDragPayload.type !== 'row') return;
      event.preventDefault();
      const tr = event.currentTarget;
      const rect = tr.getBoundingClientRect();
      const placeBefore = (event.clientY - rect.top) < rect.height / 2;
      tr.classList.remove('drag-over-row-top', 'drag-over-row-bottom');

      const srcId = activeDragPayload.rowId;
      if (!srcId || srcId === targetRowId) return;

      const db = getActiveDB();
      const list = ui.axis === 'department' ? db.departments : db.projects;
      const fromIdx = list.findIndex(x => x.id === srcId);
      if (fromIdx === -1) return;

      pushUndoState(`Reorder "${list[fromIdx].name}"`);
      const [moved] = list.splice(fromIdx, 1);
      let toIdx = list.findIndex(x => x.id === targetRowId);
      if (toIdx === -1) list.push(moved);
      else {
        if (!placeBefore) toIdx += 1;
        list.splice(toIdx, 0, moved);
      }

      touchDBAndSave();
      renderAll();
      showToast(`Reordered "${moved.name}"`, 'success', { undoable: true });
    }

    function moveRowOrder(axis, rowId, direction) {
      const db = getActiveDB();
      const list = axis === 'department' ? db.departments : db.projects;
      const visibleIds = (axis === 'department'
        ? db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept)
        : db.projects.filter(p => ui.filterProj === 'all' || p.id === ui.filterProj)
      ).map(x => x.id);

      const visPos = visibleIds.indexOf(rowId);
      const targetVisPos = visPos + direction;
      if (visPos === -1 || targetVisPos < 0 || targetVisPos >= visibleIds.length) return;

      const targetId = visibleIds[targetVisPos];
      const idxA = list.findIndex(x => x.id === rowId);
      const idxB = list.findIndex(x => x.id === targetId);
      if (idxA === -1 || idxB === -1) return;

      pushUndoState(`Reorder "${list[idxA].name}"`);
      const temp = list[idxA];
      list[idxA] = list[idxB];
      list[idxB] = temp;

      touchDBAndSave();
      renderAll();
    }

    function handleDragStart(event) {
      const el = event.currentTarget;
      activeDragPayload = {
        type: el.dataset.dragType,
        deptId: el.dataset.dragDept || '',
        projId: el.dataset.dragProj || '',
        periodKey: el.dataset.dragPeriod || '',
        msId: el.dataset.dragMs || '',
      };
      el.classList.add('dragging-item');
      event.dataTransfer.effectAllowed = 'copyMove';
      try { event.dataTransfer.setData('text/plain', JSON.stringify(activeDragPayload)); } catch (e) {}
    }

    function handleDragEnd(event) {
      event.currentTarget.classList.remove('dragging-item');
      document.querySelectorAll('.drag-over-cell').forEach(c => c.classList.remove('drag-over-cell'));
      activeDragPayload = null;
    }

    function handleCellDragOver(event) {
      if (activeDragPayload && activeDragPayload.type === 'row') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = (ui.dragMode === 'copy' || event.altKey) ? 'copy' : 'move';
      event.currentTarget.classList.add('drag-over-cell');
    }

    function handleCellDragLeave(event) {
      event.currentTarget.classList.remove('drag-over-cell');
    }

    function handleCellDrop(event, targetRowId, targetPeriodKey) {
      if (activeDragPayload && activeDragPayload.type === 'row') return;
      event.preventDefault();
      event.currentTarget.classList.remove('drag-over-cell');
      if (!activeDragPayload) return;

      const db = getActiveDB();
      const isCopy = ui.dragMode === 'copy' || event.altKey;

      if (activeDragPayload.type === 'alloc') {
        const srcDept = activeDragPayload.deptId;
        const srcProj = activeDragPayload.projId;
        const srcPeriod = activeDragPayload.periodKey;
        const dstDept = ui.axis === 'department' ? targetRowId : srcDept;
        const dstProj = ui.axis === 'project' ? targetRowId : srcProj;
        if (srcDept === dstDept && srcProj === dstProj && srcPeriod === targetPeriodKey) return;

        const srcData = getAllocationForPeriod(srcDept, srcProj, srcPeriod, ui.timeUnit, db.allocations);
        if (!srcData.hasData) return;

        pushUndoState(`${isCopy ? 'Copy' : 'Move'} allocation`);
        const existingDst = getAllocationForPeriod(dstDept, dstProj, targetPeriodKey, ui.timeUnit, db.allocations).avgFte;
        setAllocationForPeriod(dstDept, dstProj, targetPeriodKey, ui.timeUnit, existingDst + srcData.avgFte, db);
        if (!isCopy) setAllocationForPeriod(srcDept, srcProj, srcPeriod, ui.timeUnit, 0, db);

        const srcComment = (db.comments || {})[getCommentKey(srcDept, srcProj, srcPeriod)];
        if (srcComment) {
          const dstKey = getCommentKey(dstDept, dstProj, targetPeriodKey);
          if (!db.comments[dstKey]) db.comments[dstKey] = srcComment;
          else if (!db.comments[dstKey].includes(srcComment)) db.comments[dstKey] = `${db.comments[dstKey]}\n${srcComment}`;
          if (!isCopy) delete db.comments[getCommentKey(srcDept, srcProj, srcPeriod)];
        }

        const dName = db.departments.find(d => d.id === dstDept)?.code || dstDept;
        const pName = db.projects.find(p => p.id === dstProj)?.code || dstProj;
        recordChange('Allocation', `${isCopy ? 'Copied' : 'Moved'} [${dName} -> ${pName}] (${formatValue(srcData.avgFte, 'fte')}) from ${srcPeriod} to ${targetPeriodKey}`);
        renderAll();
        showToast(`${isCopy ? 'Copied' : 'Moved'} allocation to ${targetPeriodKey}`, 'success', { undoable: true });
      } else if (activeDragPayload.type === 'milestone') {
        const ms = db.milestones.find(m => m.id === activeDragPayload.msId);
        if (!ms) return;
        pushUndoState(`Move milestone "${ms.title}"`);
        const oldDate = ms.date;
        ms.date = getPeriodMidDateISO(targetPeriodKey, ui.timeUnit);
        if (ui.axis === 'department' && targetRowId && targetRowId !== '__MILESTONES__') ms.deptId = targetRowId;
        if (ui.axis === 'project') ms.projectId = targetRowId;
        recordChange('Milestone', `Moved milestone "${ms.title}" from ${oldDate} to ${ms.date}`);
        renderAll();
        showToast(`Rescheduled "${ms.title}" to ${ms.date}`, 'success', { undoable: true });
      }
    }

    function quickExtendAllocation(event, deptId, projId, periodKey) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      const db = getActiveDB();
      const src = getAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, db.allocations);
      if (!src.hasData) return;
      const nextPeriod = ui.timeUnit === 'month' ? addMonthsToMonthKey(periodKey, 1) : addWeeksToWeekKey(periodKey, 1);
      const pCode = db.projects.find(p => p.id === projId)?.code || projId;
      pushUndoState(`Extend [${pCode}] into ${nextPeriod}`);
      setAllocationForPeriod(deptId, projId, nextPeriod, ui.timeUnit, src.avgFte, db);
      recordChange('Allocation', `Extended [${pCode}] (${formatValue(src.avgFte, 'fte')}) into ${nextPeriod}`);
      triggerHaptic(10);
      renderAll();
      showToast(`Extended into ${formatPeriodHeader(nextPeriod, ui.timeUnit).title}`, 'success', { undoable: true });
    }

    function quickStepAllocation(event, deptId, projId, periodKey, dir) {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      const db = getActiveDB();
      const cur = getAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, db.allocations);
      const { step, decimals } = getManpowerStep(ui.manpowerUnit);
      const curDisp = fteToDisplayValue(cur.avgFte, periodKey, ui.timeUnit, ui.manpowerUnit);
      const factor = Math.pow(10, decimals);
      const nextDisp = Math.max(0, Math.round((curDisp + dir * step) * factor) / factor);
      const nextFte = displayValueToFte(nextDisp, periodKey, ui.timeUnit, ui.manpowerUnit);

      const dCode = db.departments.find(d => d.id === deptId)?.code || deptId;
      const pCode = db.projects.find(p => p.id === projId)?.code || projId;
      const applyQuickStep = () => {
        pushUndoState(`Adjust [${dCode} -> ${pCode}]`);
        setAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, nextFte, db);
        recordChange('Allocation', nextDisp <= 0.0001
          ? `Removed [${dCode} -> ${pCode}] allocation in ${periodKey}`
          : `[${dCode} -> ${pCode}] adjusted to ${formatValue(nextDisp)} in ${periodKey}`);
        triggerHaptic(8);
        renderAll();
        if (nextDisp <= 0.0001) {
          showToast(`Removed [${dCode} → ${pCode}] allocation`, 'info', { undoable: true });
        }
      };

      if (cur.hasData && nextDisp <= 0.0001) {
        openConfirmModal(
          'Remove Allocation',
          `Stepping [${dCode} → ${pCode}] in ${periodKey} to 0 will remove this allocation${ui.timeUnit === 'month' ? ' (all weeks in this month)' : ''}. Continue?`,
          'Remove',
          applyQuickStep
        );
        return;
      }
      applyQuickStep();
    }

    function copyPeriodToNext(periodKey) {
      const db = getActiveDB();
      const nextPk = ui.timeUnit === 'month' ? addMonthsToMonthKey(periodKey, 1) : addWeeksToWeekKey(periodKey, 1);
      const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
      const visibleProjs = db.projects.filter(p => ui.filterProj === 'all' || p.id === ui.filterProj);

      const pairs = [];
      let targetExisting = 0;
      visibleDepts.forEach(d => {
        visibleProjs.forEach(p => {
          const src = getAllocationForPeriod(d.id, p.id, periodKey, ui.timeUnit, db.allocations);
          if (src.hasData) pairs.push({ deptId: d.id, projId: p.id, fte: src.avgFte });
          if (getAllocationForPeriod(d.id, p.id, nextPk, ui.timeUnit, db.allocations).hasData) targetExisting++;
        });
      });

      const srcTitle = formatPeriodHeader(periodKey, ui.timeUnit).title;
      const dstTitle = formatPeriodHeader(nextPk, ui.timeUnit).title;

      if (pairs.length === 0) {
        showToast(`No visible allocations in ${srcTitle} to copy.`, 'warning');
        return;
      }

      const executeCopy = () => {
        pushUndoState(`Copy ${srcTitle} → ${dstTitle}`);
        pairs.forEach(({ deptId, projId, fte }) => {
          setAllocationForPeriod(deptId, projId, nextPk, ui.timeUnit, fte, db);
        });
        recordChange('Allocation', `Copied ${pairs.length} allocation${pairs.length === 1 ? '' : 's'} from ${srcTitle} into ${dstTitle}`);
        triggerHaptic(12);
        renderAll();
        showToast(`Copied ${pairs.length} allocation${pairs.length === 1 ? '' : 's'} to ${dstTitle}`, 'success', { undoable: true });
      };

      if (targetExisting > 0) {
        openConfirmModal(
          `Copy ${srcTitle} → ${dstTitle}`,
          `${dstTitle} already has ${targetExisting} allocation${targetExisting === 1 ? '' : 's'}. Copying ${pairs.length} allocation${pairs.length === 1 ? '' : 's'} from ${srcTitle} will overwrite matching project cells in ${dstTitle}. Continue?`,
          'Copy Allocations',
          executeCopy,
          { tone: 'primary' }
        );
      } else {
        executeCopy();
      }
    }

    function startInlineValueEdit(event, deptId, projId, periodKey) {
      if (event) event.stopPropagation();
      const span = event?.currentTarget;
      if (!span || span.querySelector('input')) return;
      const db = getActiveDB();
      const cur = getAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, db.allocations);
      const curDisp = Math.round(fteToDisplayValue(cur.avgFte, periodKey, ui.timeUnit, ui.manpowerUnit) * 100) / 100;
      const { step } = getManpowerStep(ui.manpowerUnit);

      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(step);
      input.min = '0';
      input.value = String(curDisp);
      input.className = 'inline-val-input tabular-nums';
      input.setAttribute('aria-label', `Inline edit ${unitShortLabel()} value`);

      let finished = false;
      const finish = (commit) => {
        if (finished) return;
        finished = true;
        if (!commit) {
          renderMatrix();
          return;
        }
        const raw = parseFloat(input.value);
        if (isNaN(raw) || raw < 0) {
          renderMatrix();
          return;
        }
        if (Math.abs(raw - curDisp) < 0.001) {
          renderMatrix();
          return;
        }
        const nextFte = displayValueToFte(raw, periodKey, ui.timeUnit, ui.manpowerUnit);
        const dCode = db.departments.find(d => d.id === deptId)?.code || deptId;
        const pCode = db.projects.find(p => p.id === projId)?.code || projId;
        const applyInline = () => {
          pushUndoState(`Inline edit [${dCode} -> ${pCode}]`);
          setAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, nextFte, db);
          recordChange('Allocation', raw <= 0.0001
            ? `Cleared [${dCode} -> ${pCode}] allocation in ${periodKey}`
            : `Updated [${dCode} -> ${pCode}] to ${formatValue(raw)} in ${periodKey}`);
          renderAll();
          showToast(raw <= 0.0001 ? `Cleared [${dCode} → ${pCode}]` : `Set [${dCode} → ${pCode}] to ${formatValue(raw)}`, 'success', { undoable: true });
        };

        if (cur.hasData && raw <= 0.0001) {
          renderMatrix();
          openConfirmModal(
            'Remove Allocation',
            `Setting [${dCode} → ${pCode}] in ${periodKey} to 0 will remove this allocation${ui.timeUnit === 'month' ? ' (all weeks in this month)' : ''}. Continue?`,
            'Remove',
            applyInline
          );
          return;
        }
        applyInline();
      };

      input.onclick = (e) => e.stopPropagation();
      input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      };
      input.onblur = () => finish(true);

      span.textContent = '';
      span.appendChild(input);
      input.focus();
      input.select();
    }

