    /* ============================================================================
     * 4. UNIFIED DESKTOP + MOBILE MASTER RENDER PIPELINE
     * ============================================================================ */

    function syncMobileControlsUI(db) {
      const activeColorMode = getActiveCellColorMode();
      const setMobileSeg = (id, active, base = 'py-2 rounded-lg text-xs transition') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('aria-pressed', String(active));
        el.className = active
          ? `${base} font-bold bg-white text-indigo-700 shadow-xs`
          : `${base} font-semibold text-slate-600`;
      };

      setMobileSeg('m-axis-department', ui.axis === 'department', 'px-2 h-8 rounded-lg text-[11px] transition');
      setMobileSeg('m-axis-project', ui.axis === 'project', 'px-2 h-8 rounded-lg text-[11px] transition');
      setMobileSeg('m-axis-timeline', ui.axis === 'timeline', 'px-2 h-8 rounded-lg text-[11px] transition');
      setMobileSeg('m-time-month', ui.timeUnit === 'month');
      setMobileSeg('m-time-week', ui.timeUnit === 'week');
      setMobileSeg('m-unit-fte', ui.manpowerUnit === 'fte');
      setMobileSeg('m-unit-days', ui.manpowerUnit === 'days');
      setMobileSeg('m-unit-hours', ui.manpowerUnit === 'hours');
      setMobileSeg('m-color-accent', activeColorMode === 'accent');
      setMobileSeg('m-color-fill', activeColorMode === 'fill');
      setMobileSeg('m-color-fte', activeColorMode === 'fte');
      setMobileSeg('m-color-fte3', activeColorMode === 'fte3');

      // Mobile header Demo/What-If/Live chip & Cards/Grid toggle
      const mChip = document.getElementById('mobileHeaderModeChip');
      if (mChip) {
        if (ui.whatIfMode && whatIfDB) {
          mChip.textContent = 'What-If';
          mChip.className = 'md:hidden text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-800 border border-violet-300';
        } else if (ui.demoMode) {
          mChip.textContent = 'Demo';
          mChip.className = 'md:hidden text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300';
        } else {
          mChip.textContent = 'Live';
          mChip.className = 'md:hidden text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200';
        }
      }

      const layoutBtn = document.getElementById('mobileLayoutToggleBtn');
      const layoutLbl = document.getElementById('mobileLayoutToggleLabel');
      if (layoutBtn && layoutLbl) {
        layoutBtn.classList.toggle('hidden', ui.activeTab !== 'matrix');
        const showingCards = ui.mobileLayoutMode !== 'grid';
        layoutLbl.textContent = showingCards ? 'Grid' : 'Cards';
        layoutBtn.setAttribute('aria-pressed', String(!showingCards));
      }

      // Active filter count badge on Mobile "View" trigger button
      let badgeCount = 0;
      if (ui.filterDept !== 'all') badgeCount++;
      if (ui.filterProj !== 'all') badgeCount++;
      if ((ui.matrixSearch || '').trim()) badgeCount++;
      if (ui.spotlightProjId) badgeCount++;
      if (ui.filterOverOnly) badgeCount++;
      if (ui.filterAtRiskOnly) badgeCount++;
      if (ui.filterHasNotesOnly) badgeCount++;
      if (ui.hideEmptyRows) badgeCount++;
      if (!ui.includeTentative) badgeCount++;
      if (ui.timeUnit === 'week') badgeCount++;
      if (ui.manpowerUnit !== 'fte') badgeCount++;
      if (activeColorMode === 'fte3' || activeColorMode === 'fte') badgeCount++;
      const badgeEl = document.getElementById('mobileActiveFiltersBadge');
      if (badgeEl) {
        badgeEl.classList.toggle('hidden', badgeCount === 0);
        badgeEl.textContent = String(badgeCount);
      }

      // Sync Mobile Sheet Selects (Start Period, Horizon, Filters)
      const anchor = ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;
      const mStartSel = document.getElementById('mStartPeriodSelect');
      if (mStartSel) {
        const opts = buildPeriodSelectOptions(anchor, ui.timeUnit, 6, 18);
        mStartSel.innerHTML = opts.map(o => `<option value="${o.key}" ${o.key === anchor ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
      }
      const mHorSel = document.getElementById('mHorizonSelect');
      if (mHorSel) {
        const uS = ui.timeUnit === 'month' ? 'Mo' : 'Wk';
        const uP = ui.timeUnit === 'month' ? 'Mos' : 'Wks';
        const activeHor = getActiveHorizon();
        mHorSel.innerHTML = VALID_HORIZONS
          .map(n => `<option value="${n}" ${n === activeHor ? 'selected' : ''}>${n} ${n === 1 ? uS : uP}${n > 6 ? ' (Overview)' : ''}</option>`)
          .join('');
        mHorSel.value = String(activeHor);
      }

      const mDeptSel = document.getElementById('mFilterDeptSelect');
      const mProjSel = document.getElementById('mFilterProjSelect');
      if (mDeptSel) {
        mDeptSel.innerHTML = `<option value="all">All Departments (${db.departments.length})</option>` +
          getSortedDepartments(db).map(d => `<option value="${d.id}" ${ui.filterDept === d.id ? 'selected' : ''}>${escapeHtml(d.name)} [${escapeHtml(d.code)}]</option>`).join('');
      }
      if (mProjSel) {
        const activeProjs = getSortedProjects(db).filter(p => !p.archived || ui.filterProj === p.id);
        mProjSel.innerHTML = `<option value="all">All Projects (${activeProjs.length})</option>` +
          activeProjs.map(p => `<option value="${p.id}" ${ui.filterProj === p.id ? 'selected' : ''}>${escapeHtml(formatProjectOptionLabel(p))}</option>`).join('');
      }

      // Sync Mobile Search, Spotlight & Quick Filter Chips
      const mSearchEl = document.getElementById('mMatrixSearchInput');
      if (mSearchEl && document.activeElement !== mSearchEl) {
        mSearchEl.value = ui.matrixSearch || '';
      }
      const mSpotSel = document.getElementById('mSpotlightSelect');
      if (mSpotSel) {
        const spotProjs = getSortedProjects(db).filter(p => !p.archived || ui.spotlightProjId === p.id);
        mSpotSel.innerHTML = `<option value="">Spotlight: All</option>` +
          spotProjs.map(p => `<option value="${p.id}" ${ui.spotlightProjId === p.id ? 'selected' : ''}>Spotlight: ${escapeHtml(formatProjectOptionLabel(p))}</option>`).join('');
      }
      const syncMobileChip = (id, active, activeCls) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('aria-pressed', String(Boolean(active)));
        el.className = active
          ? `px-2.5 py-2 rounded-xl border text-xs font-bold transition ${activeCls}`
          : 'px-2.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-bold transition';
      };
      syncMobileChip('mChipFilterOver', ui.filterOverOnly, 'border-rose-300 bg-rose-50 text-rose-700');
      syncMobileChip('mChipFilterAtRisk', ui.filterAtRiskOnly, 'border-amber-300 bg-amber-50 text-amber-800');
      syncMobileChip('mChipFilterNotes', ui.filterHasNotesOnly, 'border-indigo-300 bg-indigo-50 text-indigo-700');
      const mHideEl = document.getElementById('mHideEmptyBtn');
      if (mHideEl) {
        mHideEl.textContent = ui.hideEmptyRows ? 'Active Only: ON' : 'Hide Empty';
        syncMobileChip('mHideEmptyBtn', ui.hideEmptyRows, 'border-indigo-300 bg-indigo-50 text-indigo-700');
      }
      const mTentEl = document.getElementById('mTentativeToggleBtn');
      if (mTentEl) {
        mTentEl.textContent = ui.includeTentative ? 'Pipeline: ON' : 'Pipeline: OFF';
        syncMobileChip('mTentativeToggleBtn', ui.includeTentative, 'border-indigo-300 bg-indigo-50 text-indigo-700');
      }
      const mClearBtn = document.getElementById('mClearFiltersBtn');
      if (mClearBtn) {
        const hasAny = Boolean((ui.matrixSearch || '').trim() || ui.filterOverOnly || ui.filterAtRiskOnly || ui.filterHasNotesOnly || ui.filterDept !== 'all' || ui.filterProj !== 'all' || ui.spotlightProjId || ui.hideEmptyRows || !ui.includeTentative);
        mClearBtn.classList.toggle('hidden', !hasAny);
      }

      // Mobile Sheet Comments & Demo buttons
      const mCmtBtn = document.getElementById('mCommentsToggleBtn');
      if (mCmtBtn) {
        mCmtBtn.textContent = ui.showCellComments ? 'Comments: ON' : 'Comments: OFF';
        mCmtBtn.className = ui.showCellComments
          ? 'py-2.5 px-2 rounded-xl border border-indigo-300 bg-indigo-50 text-indigo-700 text-xs font-bold transition'
          : 'py-2.5 px-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-xs font-bold transition';
      }
      const mDemoBtn = document.getElementById('mDemoToggleBtn');
      if (mDemoBtn) {
        mDemoBtn.textContent = ui.demoMode ? 'Demo: ON' : 'Demo: OFF';
        mDemoBtn.className = ui.demoMode
          ? 'py-2.5 px-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold transition'
          : 'py-2.5 px-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-bold transition';
      }
    }

    function renderAll() {
      const db = getActiveDB();

      // Update Desktop Tab Bar & Mobile Fixed Bottom Nav ARIA states
      ['matrix', 'health', 'data', 'sync'].forEach(t => {
        const btn = document.getElementById(`nav-${t}`);
        const mBtn = document.getElementById(`mnav-${t}`);
        const sec = document.getElementById(`tab-${t}`);
        const active = ui.activeTab === t;
        if (btn) {
          btn.setAttribute('aria-selected', String(active));
          btn.className = active
            ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-indigo-700 shadow-xs transition whitespace-nowrap'
            : 'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition whitespace-nowrap';
        }
        if (mBtn) {
          mBtn.setAttribute('aria-selected', String(active));
          mBtn.className = active
            ? 'flex flex-col items-center justify-center gap-0.5 py-1 min-h-[44px] rounded-xl text-[11px] font-extrabold text-indigo-600 bg-indigo-50/80 transition relative'
            : 'flex flex-col items-center justify-center gap-0.5 py-1 min-h-[44px] rounded-xl text-[11px] font-semibold text-slate-500 hover:text-slate-800 transition relative';
        }
        if (sec) sec.classList.toggle('hidden', !active);
      });

      applyDarkMode();
      applyPresentMode();

      const userName = (ui.userName || 'Project Mgr').trim();
      const avatarEl = document.getElementById('headerUserAvatar');
      const nameEl = document.getElementById('headerUserName');
      const menuUserLbl = document.getElementById('headerMenuUserLabel');
      if (avatarEl) avatarEl.textContent = getUserInitials(userName);
      if (nameEl) nameEl.textContent = userName;
      if (menuUserLbl) menuUserLbl.textContent = userName;

      // Demo Mode UI & Banner
      const demoBtn = document.getElementById('demoToggleBtn');
      const demoDot = document.getElementById('demoToggleDot');
      const demoLbl = document.getElementById('demoToggleLabel');
      const demoBanner = document.getElementById('demoBanner');
      if (demoBtn) {
        demoBtn.setAttribute('aria-pressed', String(Boolean(ui.demoMode)));
        if (ui.demoMode) {
          demoBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold transition cursor-pointer';
          if (demoDot) demoDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0';
          if (demoLbl) demoLbl.textContent = 'Demo: ON';
        } else {
          demoBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-300 text-slate-700 text-xs font-semibold transition cursor-pointer';
          if (demoDot) demoDot.className = 'w-2 h-2 rounded-full bg-slate-300 shrink-0';
          if (demoLbl) demoLbl.textContent = 'Demo: OFF';
        }
      }
      if (demoBanner) demoBanner.classList.toggle('hidden', !ui.demoMode);

      // What-If Scenario Sandbox UI & Banner
      const isWhatIf = Boolean(ui.whatIfMode && whatIfDB);
      const wiBtn = document.getElementById('whatIfToggleBtn');
      const wiDot = document.getElementById('whatIfToggleDot');
      const wiLbl = document.getElementById('whatIfToggleLabel');
      const wiBanner = document.getElementById('whatIfBanner');
      if (wiBtn) {
        wiBtn.setAttribute('aria-pressed', String(isWhatIf));
        if (isWhatIf) {
          wiBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-violet-300 bg-violet-50 text-violet-800 text-xs font-bold transition cursor-pointer';
          if (wiDot) wiDot.className = 'w-2 h-2 rounded-full bg-violet-500 animate-pulse shrink-0';
          if (wiLbl) wiLbl.textContent = 'What-If: ON';
        } else {
          wiBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-violet-50 hover:border-violet-300 text-slate-700 hover:text-violet-700 text-xs font-semibold transition cursor-pointer';
          if (wiDot) wiDot.className = 'w-2 h-2 rounded-full bg-slate-300 shrink-0';
          if (wiLbl) wiLbl.textContent = 'What-If Sandbox';
        }
      }
      if (wiBanner) {
        wiBanner.classList.toggle('hidden', !isWhatIf);
        if (isWhatIf) {
          const summaryEl = document.getElementById('whatIfDeltaSummary');
          if (summaryEl && typeof computeWhatIfDeltaSummary === 'function') {
            summaryEl.textContent = computeWhatIfDeltaSummary();
          }
        }
      }

      // Live Mode Indicator Dot on Header Menu Pill when Demo or What-If is active
      const modeDot = document.getElementById('headerMenuModeDot');
      if (modeDot) {
        if (isWhatIf) {
          modeDot.className = 'w-2 h-2 rounded-full bg-violet-500 animate-pulse shrink-0';
        } else if (ui.demoMode) {
          modeDot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0';
        } else {
          modeDot.className = 'hidden w-2 h-2 rounded-full shrink-0';
        }
      }

      const setToggleBtn = (id, active) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('aria-pressed', String(active));
        el.className = active
          ? 'px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-indigo-700 shadow-xs transition'
          : 'px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 transition';
      };

      setToggleBtn('axis-department', ui.axis === 'department');
      setToggleBtn('axis-project', ui.axis === 'project');
      setToggleBtn('axis-timeline', ui.axis === 'timeline');
      setToggleBtn('time-month', ui.timeUnit === 'month');
      setToggleBtn('time-week', ui.timeUnit === 'week');
      setToggleBtn('unit-fte', ui.manpowerUnit === 'fte');
      setToggleBtn('unit-days', ui.manpowerUnit === 'days');
      setToggleBtn('unit-hours', ui.manpowerUnit === 'hours');

      const activeHorizon = getActiveHorizon();

      // Start Period Input with Safari <input type="week"> fallback
      const startInput = document.getElementById('startPeriodInput');
      const weekFallbackSel = document.getElementById('startWeekFallbackSelect');
      if (startInput && weekFallbackSel) {
        if (ui.timeUnit === 'month') {
          startInput.classList.remove('hidden');
          weekFallbackSel.classList.add('hidden');
          startInput.type = 'month';
          startInput.value = ui.startMonth;
        } else if (supportsNativeWeekInput()) {
          startInput.classList.remove('hidden');
          weekFallbackSel.classList.add('hidden');
          startInput.type = 'week';
          startInput.value = ui.startWeek;
        } else {
          startInput.classList.add('hidden');
          weekFallbackSel.classList.remove('hidden');
          const wkOpts = buildPeriodSelectOptions(ui.startWeek, 'week', 8, 24);
          weekFallbackSel.innerHTML = wkOpts.map(o => `<option value="${o.key}" ${o.key === ui.startWeek ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
        }
      }
      const horSel = document.getElementById('horizonSelect');
      if (horSel) {
        const uS = ui.timeUnit === 'month' ? 'Mo' : 'Wk';
        const uP = ui.timeUnit === 'month' ? 'Mos' : 'Wks';
        horSel.innerHTML = VALID_HORIZONS
          .map(n => `<option value="${n}" ${n === activeHorizon ? 'selected' : ''}>${n} ${n === 1 ? uS : uP}${n > 6 ? ' (Overview)' : ''}</option>`)
          .join('');
        horSel.value = String(activeHorizon);
      }
      const stepBackBtn = document.getElementById('btnStepIntervalBack');
      const stepFwdBtn = document.getElementById('btnStepIntervalFwd');
      const unitWord = ui.timeUnit === 'month' ? (activeHorizon === 1 ? 'month' : 'months') : (activeHorizon === 1 ? 'week' : 'weeks');
      if (stepBackBtn) {
        stepBackBtn.title = `Jump back ${activeHorizon} ${unitWord} (Shift + Left Arrow)`;
        stepBackBtn.setAttribute('aria-label', `Jump back ${activeHorizon} ${unitWord}`);
      }
      if (stepFwdBtn) {
        stepFwdBtn.title = `Jump forward ${activeHorizon} ${unitWord} (Shift + Right Arrow)`;
        stepFwdBtn.setAttribute('aria-label', `Jump forward ${activeHorizon} ${unitWord}`);
      }

      // Cell Card Color Mode Selector (Accent / Fill / By FTE / 3-Level)
      const activeColorMode = getActiveCellColorMode();
      const setSegBtn = (id, active, padCls = 'px-2 py-0.5') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('aria-pressed', String(active));
        el.className = active
          ? `${padCls} rounded-md text-[11px] font-bold bg-white text-indigo-700 shadow-xs transition`
          : `${padCls} rounded-md text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition`;
      };
      setSegBtn('card-color-accent', activeColorMode === 'accent', 'px-2 py-1');
      setSegBtn('card-color-fill', activeColorMode === 'fill', 'px-2 py-1');
      setSegBtn('card-color-fte', activeColorMode === 'fte', 'px-2 py-1');
      setSegBtn('card-color-fte3', activeColorMode === 'fte3', 'px-2 py-1');

      // Row Labels (Vertical 62px spine vs Detailed 216px) & Note Size (Norm / Large / XL)
      setSegBtn('row-label-vertical', Boolean(ui.compactRowLabels), 'px-1.5 py-0.5');
      setSegBtn('row-label-detailed', !ui.compactRowLabels, 'px-1.5 py-0.5');
      const curNoteSize = (ui.noteSize === 'sm' || ui.noteSize === 'lg') ? ui.noteSize : 'md';
      setSegBtn('note-size-sm', curNoteSize === 'sm', 'px-1 py-0.5');
      setSegBtn('note-size-md', curNoteSize === 'md', 'px-1 py-0.5');
      setSegBtn('note-size-lg', curNoteSize === 'lg', 'px-1 py-0.5');

      const fteLegendEl = document.getElementById('fteColorLegend');
      if (fteLegendEl) fteLegendEl.classList.toggle('hidden', activeColorMode !== 'fte');
      const fte3LegendEl = document.getElementById('fte3ColorLegend');
      if (fte3LegendEl) {
        fte3LegendEl.classList.toggle('hidden', activeColorMode !== 'fte3');
        if (activeColorMode === 'fte3') renderFte3Legend(db);
      }

      const dragBtn = document.getElementById('dragModeBtn');
      if (dragBtn) {
        dragBtn.setAttribute('aria-pressed', String(ui.dragMode === 'copy'));
        if (ui.dragMode === 'copy') {
          dragBtn.className = 'px-2.5 py-1 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-[11px] font-bold transition';
          dragBtn.textContent = 'Drag: Copy';
        } else {
          dragBtn.className = 'px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 transition';
          dragBtn.textContent = 'Drag: Move';
        }
      }

      const cmtBtn = document.getElementById('commentsToggleBtn');
      if (cmtBtn) {
        cmtBtn.setAttribute('aria-pressed', String(Boolean(ui.showCellComments)));
        if (ui.showCellComments) {
          cmtBtn.className = 'px-2.5 py-1 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-[11px] font-bold transition';
          cmtBtn.textContent = 'Comments: ON';
        } else {
          cmtBtn.className = 'px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-600 transition';
          cmtBtn.textContent = 'Comments: OFF';
        }
      }

      const tentBtn = document.getElementById('tentativeToggleBtn');
      if (tentBtn) {
        const inc = Boolean(ui.includeTentative);
        tentBtn.setAttribute('aria-pressed', String(inc));
        tentBtn.className = inc
          ? 'px-2.5 py-1 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-[11px] font-bold transition'
          : 'px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-bold transition';
        tentBtn.textContent = inc ? 'Pipeline: ON' : 'Committed Only';
      }

      const hideEmptyBtn = document.getElementById('hideEmptyRowsBtn');
      if (hideEmptyBtn) {
        const active = Boolean(ui.hideEmptyRows);
        hideEmptyBtn.setAttribute('aria-pressed', String(active));
        hideEmptyBtn.className = active
          ? 'px-2.5 py-1 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 text-[11px] font-bold transition'
          : 'px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 transition';
        hideEmptyBtn.textContent = active ? 'Active Only: ON' : 'Hide Empty';
      }

      // Spotlight Project Selector & Saved Views
      const spotlightSel = document.getElementById('spotlightSelect');
      if (spotlightSel) {
        if (ui.spotlightProjId && !db.projects.some(p => p.id === ui.spotlightProjId)) {
          ui.spotlightProjId = '';
        }
        const spotProjs = getSortedProjects(db).filter(p => !p.archived || ui.spotlightProjId === p.id);
        spotlightSel.innerHTML = `<option value="">Spotlight: All</option>` +
          spotProjs.map(p => `<option value="${p.id}" ${ui.spotlightProjId === p.id ? 'selected' : ''}>Spotlight: ${escapeHtml(formatProjectOptionLabel(p))}</option>`).join('');
      }
      const viewsBtn = document.getElementById('savedViewsBtn');
      if (viewsBtn && typeof getSavedViews === 'function') {
        const cnt = getSavedViews().length;
        viewsBtn.textContent = cnt > 0 ? `Views (${cnt})` : 'Views';
      }

      // Quick Search & Smart Health/Status Filter Chips
      const searchEl = document.getElementById('matrixSearchInput');
      if (searchEl && document.activeElement !== searchEl) {
        searchEl.value = ui.matrixSearch || '';
      }
      const syncChip = (id, active, activeCls) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('aria-pressed', String(Boolean(active)));
        el.className = active
          ? `px-2 py-1 rounded-lg border text-[11px] font-bold transition ${activeCls}`
          : 'px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold transition';
      };
      syncChip('chipFilterOver', ui.filterOverOnly, 'border-rose-300 bg-rose-50 text-rose-700');
      syncChip('chipFilterAtRisk', ui.filterAtRiskOnly, 'border-amber-300 bg-amber-50 text-amber-800');
      syncChip('chipFilterNotes', ui.filterHasNotesOnly, 'border-indigo-300 bg-indigo-50 text-indigo-700');
      const clearBtn = document.getElementById('btnClearMatrixFilters');
      if (clearBtn) {
        const hasAnyFilter = Boolean((ui.matrixSearch || '').trim() || ui.filterOverOnly || ui.filterAtRiskOnly || ui.filterHasNotesOnly || ui.filterDept !== 'all' || ui.filterProj !== 'all' || ui.spotlightProjId);
        clearBtn.classList.toggle('hidden', !hasAnyFilter);
      }

      // Sync Collapsible "Filters & Display" Drawer & Active Count Badge
      const drawerEl = document.getElementById('matrixSettingsDrawer');
      const drawerBtn = document.getElementById('matrixSettingsToggleBtn');
      const drawerBadge = document.getElementById('matrixSettingsBadge');
      const drawerChev = document.getElementById('matrixSettingsChevron');
      const drawerOpen = Boolean(ui.matrixSettingsOpen);
      let activeSettingsCount = 0;
      if (ui.filterDept !== 'all') activeSettingsCount++;
      if (ui.filterProj !== 'all') activeSettingsCount++;
      if (ui.spotlightProjId) activeSettingsCount++;
      if ((ui.matrixSearch || '').trim()) activeSettingsCount++;
      if (ui.filterOverOnly) activeSettingsCount++;
      if (ui.filterAtRiskOnly) activeSettingsCount++;
      if (ui.filterHasNotesOnly) activeSettingsCount++;
      if (ui.hideEmptyRows) activeSettingsCount++;
      if (!ui.includeTentative) activeSettingsCount++;
      if (ui.manpowerUnit !== 'fte') activeSettingsCount++;
      if (drawerEl) drawerEl.classList.toggle('hidden', !drawerOpen);
      if (drawerBtn) {
        drawerBtn.setAttribute('aria-expanded', String(drawerOpen));
        drawerBtn.className = (drawerOpen || activeSettingsCount > 0)
          ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-indigo-300 bg-indigo-50 text-indigo-700 text-xs font-bold transition'
          : 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 text-xs font-semibold transition';
      }
      if (drawerBadge) {
        drawerBadge.classList.toggle('hidden', activeSettingsCount === 0);
        drawerBadge.textContent = String(activeSettingsCount);
      }
      if (drawerChev) {
        drawerChev.textContent = drawerOpen ? '▴' : '▾';
      }

      updateUndoRedoButtons();

      const dpw = db.settings.daysPerWeek || 5;
      const hpd = db.settings.hoursPerDay || 8;
      const proRataEl = document.getElementById('proRataHint');
      if (proRataEl) proRataEl.textContent = `1.0 FTE = ${dpw}d/wk (${dpw * hpd}h/wk) • Monthly edits auto pro-rate across ISO weeks`;
      const setupFormulaEl = document.getElementById('setupFteFormulaText');
      if (setupFormulaEl) {
        setupFormulaEl.textContent = `1.0 FTE = ${dpw}d/wk = ${dpw * hpd}h/wk; a 4-week month = ${dpw * 4}d / ${dpw * hpd * 4}h, a 5-week month = ${dpw * 5}d / ${dpw * hpd * 5}h`;
      }

      const fDept = document.getElementById('filterDeptSelect');
      const fProj = document.getElementById('filterProjSelect');
      if (fDept) {
        fDept.innerHTML = `<option value="all">All Departments (${db.departments.length})</option>` +
          getSortedDepartments(db).map(d => `<option value="${d.id}" ${ui.filterDept === d.id ? 'selected' : ''}>${escapeHtml(d.name)} [${escapeHtml(d.code)}]</option>`).join('');
      }
      if (fProj) {
        const activeProjs = getSortedProjects(db).filter(p => !p.archived || ui.filterProj === p.id);
        fProj.innerHTML = `<option value="all">All Projects (${activeProjs.length})</option>` +
          activeProjs.map(p => `<option value="${p.id}" ${ui.filterProj === p.id ? 'selected' : ''}>${escapeHtml(formatProjectOptionLabel(p))}</option>`).join('');
      }

      syncMobileControlsUI(db);

      if (ui.activeTab === 'matrix') {
        const useMobileDeck = shouldRenderMobileCards();
        const mobileDeckEl = document.getElementById('mobileMatrixDeck');
        const desktopCardEl = document.getElementById('desktopMatrixCard');
        if (mobileDeckEl && desktopCardEl) {
          mobileDeckEl.classList.toggle('hidden', !useMobileDeck);
          desktopCardEl.classList.toggle('hidden', useMobileDeck);
        }
        if (useMobileDeck) renderMobileMatrixCards();
        else renderMatrix();
      }
      if (ui.activeTab === 'health') renderHealthDashboard();
      if (ui.activeTab === 'data') renderDataTab();
      if (ui.activeTab === 'sync') renderSyncTab();

      updateSyncStatusUI();
      renderSyncWarningBanner();
      requestAnimationFrame(updateMatrixFloatingHeaderVisibility);
    }

