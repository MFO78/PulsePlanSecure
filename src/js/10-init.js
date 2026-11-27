    /* ============================================================================
     * 11. MOBILE SHEETS, UI ACTIONS, THEME, MEETING VIEW & TOAST NOTIFICATIONS
     * ============================================================================ */

    function openMobileFiltersSheet() {
      syncMobileControlsUI(getActiveDB());
      const dlg = document.getElementById('mobileFiltersSheet');
      if (!dlg) return;
      if (typeof dlg.showModal === 'function') {
        if (!dlg.open) dlg.showModal();
      } else {
        dlg.setAttribute('open', 'open');
      }
    }

    function openMobileQuickAddSheet() {
      updatePwaInstallUI();
      const dlg = document.getElementById('mobileQuickAddSheet');
      if (!dlg) return;
      if (typeof dlg.showModal === 'function') {
        if (!dlg.open) dlg.showModal();
      } else {
        dlg.setAttribute('open', 'open');
      }
    }

    function isPwaInstalled() {
      try {
        if (typeof window !== 'undefined' && window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches)) {
          return true;
        }
        if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
      } catch (e) {}
      return false;
    }

    function updatePwaInstallUI() {
      const installed = isPwaInstalled();
      const canNative = Boolean(deferredPwaPrompt) && !installed;

      const hdrBtn = document.getElementById('pwaInstallHeaderBtn');
      if (hdrBtn) {
        hdrBtn.classList.toggle('hidden', !canNative);
        hdrBtn.classList.toggle('inline-flex', canNative);
      }

      const menuBtn = document.getElementById('pwaInstallMenuBtn');
      const menuLbl = document.getElementById('pwaInstallMenuLabel');
      const menuChip = document.getElementById('pwaInstallMenuChip');
      if (menuBtn && menuLbl && menuChip) {
        if (installed) {
          menuLbl.textContent = 'App Installed';
          menuChip.textContent = 'Active';
          menuChip.className = 'text-[10px] font-bold text-emerald-600';
        } else if (canNative) {
          menuLbl.textContent = 'Install App';
          menuChip.textContent = 'Ready';
          menuChip.className = 'text-[10px] font-bold text-indigo-600';
        } else {
          menuLbl.textContent = 'Install App';
          menuChip.textContent = 'Guide';
          menuChip.className = 'text-[10px] font-bold text-slate-400';
        }
      }

      const mBtn = document.getElementById('mPwaInstallBtn');
      const mChip = document.getElementById('mPwaInstallChip');
      if (mBtn && mChip) {
        mBtn.classList.toggle('hidden', installed);
        mChip.textContent = canNative ? '1-Tap Install' : 'How to Install';
      }
    }

    async function promptPwaInstall() {
      if (isPwaInstalled()) {
        showToast('PulsePlan is already installed as an app on this device.', 'success');
        updatePwaInstallUI();
        return;
      }
      if (deferredPwaPrompt) {
        const promptEvt = deferredPwaPrompt;
        deferredPwaPrompt = null;
        try {
          ppDebug('INFO', 'Triggering native PWA beforeinstallprompt dialog');
          await promptEvt.prompt();
          const choice = await promptEvt.userChoice;
          ppDebug('INFO', 'PWA install prompt userChoice', { outcome: choice?.outcome });
          if (choice && choice.outcome === 'accepted') {
            showToast('Installing PulsePlan app…', 'success');
          } else {
            showToast('Install dismissed — you can install anytime from the Workspace Menu.', 'info');
          }
        } catch (err) {
          ppDebug('WARN', 'PWA install prompt error', { message: err?.message });
          openPwaInstallHelpModal();
        }
        updatePwaInstallUI();
        return;
      }
      openPwaInstallHelpModal();
    }

    function toggleMobileLayoutMode() {
      ui.mobileLayoutMode = ui.mobileLayoutMode === 'grid' ? 'cards' : 'grid';
      persistUIPrefs();
      triggerHaptic(8);
      renderAll();
      showToast(ui.mobileLayoutMode === 'grid' ? 'Compact 2D Matrix Grid active' : 'Period-Focus Card Deck active', 'info');
    }

    function switchTab(tab) {
      if (typeof ppCanAccessTab === 'function' && !ppCanAccessTab(tab)) {
        const fallback = typeof ppGetFirstAllowedTab === 'function' ? ppGetFirstAllowedTab() : 'matrix';
        if (ui.activeTab !== fallback) {
          ui.activeTab = fallback;
          persistUIPrefs();
          renderAll();
        }
        showToast('Access to this section is restricted by your Administrator.', 'warning');
        return;
      }
      ui.activeTab = tab;
      persistUIPrefs();
      renderAll();
      if (isMobileViewport()) {
        try {
          const mainEl = document.getElementById('mainWorkspace');
          if (mainEl && typeof mainEl.scrollTo === 'function') mainEl.scrollTo({ top: 0, behavior: 'smooth' });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {}
      }
    }

    function applyDarkMode() {
      const isDark = Boolean(ui.darkMode);
      document.documentElement.classList.toggle('dark', isDark);
      const btn = document.getElementById('darkModeToggleBtn');
      if (btn) btn.setAttribute('aria-pressed', String(isDark));
      const chip = document.getElementById('darkModeStateChip');
      if (chip) {
        chip.textContent = isDark ? 'ON' : 'OFF';
        chip.className = isDark
          ? 'text-[10px] font-bold text-indigo-400'
          : 'text-[10px] font-bold text-slate-400';
      }
      const moon = document.getElementById('darkModeIconMoon');
      const sun = document.getElementById('darkModeIconSun');
      if (moon && sun) {
        moon.classList.toggle('hidden', isDark);
        sun.classList.toggle('hidden', !isDark);
      }
    }

    function toggleHeaderWorkspaceMenu(event) {
      if (event) event.stopPropagation();
      closeRoadmapActionsMenu();
      const pop = document.getElementById('headerWorkspacePopover');
      const btn = document.getElementById('headerMenuBtn');
      const chev = document.getElementById('headerMenuChevron');
      if (!pop || !btn) return;
      const willOpen = pop.classList.contains('hidden');
      pop.classList.toggle('hidden', !willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));
      if (chev) chev.textContent = willOpen ? '▴' : '▾';
    }

    function closeHeaderWorkspaceMenu() {
      const pop = document.getElementById('headerWorkspacePopover');
      const btn = document.getElementById('headerMenuBtn');
      const chev = document.getElementById('headerMenuChevron');
      if (pop) pop.classList.add('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (chev) chev.textContent = '▾';
    }

    function toggleRoadmapActionsMenu(event) {
      if (event) event.stopPropagation();
      closeHeaderWorkspaceMenu();
      const pop = document.getElementById('roadmapActionsPopover');
      const btn = document.getElementById('roadmapActionsBtn');
      const chev = document.getElementById('roadmapActionsChevron');
      if (!pop || !btn) return;
      const willOpen = pop.classList.contains('hidden');
      pop.classList.toggle('hidden', !willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));
      if (chev) chev.textContent = willOpen ? '▴' : '▾';
    }

    function closeRoadmapActionsMenu() {
      const pop = document.getElementById('roadmapActionsPopover');
      const btn = document.getElementById('roadmapActionsBtn');
      const chev = document.getElementById('roadmapActionsChevron');
      if (pop) pop.classList.add('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (chev) chev.textContent = '▾';
    }

    function setNoteSize(size) {
      ui.noteSize = (size === 'sm' || size === 'lg') ? size : 'md';
      persistUIPrefs();
      renderAll();
    }

    function setCompactRowLabels(isCompact) {
      ui.compactRowLabels = Boolean(isCompact);
      persistUIPrefs();
      renderAll();
    }

    function toggleDarkMode() {
      ui.darkMode = !ui.darkMode;
      persistUIPrefs();
      applyDarkMode();
      if (ui.activeTab === 'health') renderHealthDashboard();
      showToast(ui.darkMode ? 'Dark Mode enabled' : 'Light Mode enabled', 'info');
    }

    function applyPresentMode() {
      const active = Boolean(ui.presentMode);
      document.documentElement.classList.toggle('present-mode', active);
      const btn = document.getElementById('presentModeToggleBtn');
      const lbl = document.getElementById('presentModeLabel');
      if (btn && lbl) {
        btn.setAttribute('aria-pressed', String(active));
        if (active) {
          btn.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-indigo-400 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition cursor-pointer';
          lbl.textContent = 'Exit Present';
        } else {
          btn.className = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer';
          lbl.textContent = 'Present';
        }
      }
    }

    function togglePresentMode() {
      ui.presentMode = !ui.presentMode;
      closeRoadmapActionsMenu();
      closeHeaderWorkspaceMenu();
      if (ui.presentMode) {
        ui.matrixSettingsOpen = false;
        try {
          if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        } catch (e) {}
      } else {
        try {
          if (document.fullscreenElement) document.exitFullscreen?.();
        } catch (e) {}
      }
      renderAll();
      showToast(
        ui.presentMode
          ? (isMobileViewport()
              ? 'Present Mode ON — tap Exit Present to return'
              : 'Present Mode ON — clean fullscreen view (press Esc or F to exit)')
          : 'Present Mode OFF',
        'info'
      );
    }

    function setCellColorMode(mode) {
      const valid = (mode === 'fill' || mode === 'fte' || mode === 'fte3') ? mode : 'accent';
      ui.cellColorMode = valid;
      persistUIPrefs();
      renderAll();
      const labels = {
        accent: 'Accent Border',
        fill: 'Full Color Fill',
        fte: '6-Tier FTE Heat Scale',
        fte3: '3-Level Demand (Green / Yellow / Red)',
      };
      showToast(`Cell cards switched to ${labels[valid]}`, 'info');
    }

    function toggleShowCellComments() {
      ui.showCellComments = !ui.showCellComments;
      persistUIPrefs();
      renderAll();
    }

    function toggleDemoMode() {
      if (typeof ppIsStandardUser === 'function' && ppIsStandardUser()) {
        showToast('Demo Sandbox is restricted to Administrators.', 'warning');
        return;
      }
      if (ui.whatIfMode) {
        ui.whatIfMode = false;
        whatIfDB = null;
      }
      ui.demoMode = !ui.demoMode;
      ui.filterDept = 'all';
      ui.filterProj = 'all';
      ui.spotlightProjId = '';
      ui.compareSnapshotId = '';
      ui.compareTargetId = '__CURRENT__';
      ui.mobileSelectedPeriod = '';
      clearUndoHistory();
      if (!ui.demoMode && supportsFileSystemAccess() && !linkedFileHandle && !syncWarningState.type) {
        syncWarningState = rememberedFileHandle
          ? { type: 'permission', fileName: rememberedFileHandle.name, dismissed: false }
          : { type: 'unlinked', fileName: '', dismissed: false };
      }
      persistUIPrefs();
      renderAll();
      showToast(
        ui.demoMode
          ? 'Demo Mode enabled — explore freely without touching your Live DB'
          : 'Switched to Live Company Database',
        'info'
      );
    }

    function setAxis(axis) { ui.axis = axis; persistUIPrefs(); renderAll(); }
    function setTimeUnit(unit) {
      if (ui.timeUnit !== unit) {
        if (unit === 'week') {
          const wks = getWeeksInMonth(ui.startMonth);
          if (wks.length) ui.startWeek = wks[0];
        } else {
          ui.startMonth = getWeekOwningMonth(ui.startWeek);
        }
        ui.timeUnit = unit;
        ui.mobileSelectedPeriod = '';
        persistUIPrefs();
        renderAll();
      }
    }
    function setManpowerUnit(unit) { ui.manpowerUnit = unit; persistUIPrefs(); renderAll(); }
    function setHorizon(val) {
      const raw = Math.max(1, Math.min(24, parseInt(val, 10) || 4));
      ui.horizon = VALID_HORIZONS.includes(raw) ? raw : (raw <= 6 ? 6 : raw <= 15 ? 12 : raw <= 21 ? 18 : 24);
      persistUIPrefs();
      renderAll();
    }
    function stepHorizon(delta) {
      const options = VALID_HORIZONS;
      const cur = getActiveHorizon();
      let idx = options.indexOf(cur);
      if (idx === -1) {
        idx = options.findIndex(v => v >= cur);
        if (idx === -1) idx = options.length - 1;
      }
      const nextIdx = Math.max(0, Math.min(options.length - 1, idx + delta));
      if (options[nextIdx] !== cur) setHorizon(options[nextIdx]);
    }
    function shiftStartPeriod(delta) {
      if (ui.timeUnit === 'month') ui.startMonth = addMonthsToMonthKey(ui.startMonth, delta);
      else ui.startWeek = addWeeksToWeekKey(ui.startWeek, delta);
      ui.mobileSelectedPeriod = ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;
      persistUIPrefs();
      renderAll();
    }
    function shiftStartByInterval(direction) {
      const step = (Number(direction) >= 0 ? 1 : -1) * getActiveHorizon();
      triggerHaptic(8);
      shiftStartPeriod(step);
    }
    function jumpToToday() {
      ui.startMonth = getCurrentMonthKey();
      ui.startWeek = getCurrentWeekKey();
      const targetPk = ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;
      ui.mobileSelectedPeriod = targetPk;
      persistUIPrefs();
      triggerHaptic(6);
      renderAll();
      if (isMobileViewport()) {
        setTimeout(() => {
          const pill = document.querySelector(`[data-mobile-period-pill="${targetPk}"]`);
          if (pill && typeof pill.scrollIntoView === 'function') {
            pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }
        }, 25);
      }
    }
    function setStartPeriodDirect(val) {
      if (!val) return;
      if (ui.timeUnit === 'month') ui.startMonth = val;
      else ui.startWeek = val;
      ui.mobileSelectedPeriod = val;
      persistUIPrefs();
      renderAll();
    }
    function setFilterDept(val) { ui.filterDept = val; renderAll(); }
    function setFilterProj(val) { ui.filterProj = val; renderAll(); }
    function toggleDragMode() {
      ui.dragMode = ui.dragMode === 'move' ? 'copy' : 'move';
      persistUIPrefs();
      renderAll();
    }
    function toggleHideEmptyRows() {
      ui.hideEmptyRows = !ui.hideEmptyRows;
      persistUIPrefs();
      renderAll();
    }
    function toggleIncludeTentative() {
      ui.includeTentative = !ui.includeTentative;
      persistUIPrefs();
      renderAll();
      showToast(ui.includeTentative ? 'Showing Committed + Tentative Pipeline projects' : 'Committed Only — Tentative Pipeline excluded from totals', 'info');
    }
    function toggleMatrixSettingsDrawer() {
      ui.matrixSettingsOpen = !ui.matrixSettingsOpen;
      persistUIPrefs();
      renderAll();
    }
    function setSpotlightProject(projId) {
      ui.spotlightProjId = projId || '';
      renderAll();
    }
    function toggleSpotlightProject(projId) {
      ui.spotlightProjId = ui.spotlightProjId === projId ? '' : (projId || '');
      renderAll();
    }
    function setMatrixSearch(val) {
      ui.matrixSearch = String(val || '');
      if (ui.activeTab === 'matrix') {
        if (shouldRenderMobileCards()) renderMobileMatrixCards();
        else renderMatrix();
        const hasAnyFilter = Boolean(ui.matrixSearch.trim() || ui.filterOverOnly || ui.filterAtRiskOnly || ui.filterHasNotesOnly || ui.filterDept !== 'all' || ui.filterProj !== 'all' || ui.spotlightProjId);
        const clearBtn = document.getElementById('btnClearMatrixFilters');
        if (clearBtn) clearBtn.classList.toggle('hidden', !hasAnyFilter);
        const mClearBtn = document.getElementById('mClearFiltersBtn');
        if (mClearBtn) mClearBtn.classList.toggle('hidden', !(hasAnyFilter || ui.hideEmptyRows || !ui.includeTentative));
        if (typeof syncMobileControlsUI === 'function') syncMobileControlsUI(getActiveDB());
      }
    }
    function toggleQuickFilter(kind) {
      if (kind === 'over') ui.filterOverOnly = !ui.filterOverOnly;
      else if (kind === 'atRisk') ui.filterAtRiskOnly = !ui.filterAtRiskOnly;
      else if (kind === 'notes') ui.filterHasNotesOnly = !ui.filterHasNotesOnly;
      renderAll();
    }
    function clearMatrixFilters() {
      ui.matrixSearch = '';
      ui.filterOverOnly = false;
      ui.filterAtRiskOnly = false;
      ui.filterHasNotesOnly = false;
      ui.filterDept = 'all';
      ui.filterProj = 'all';
      ui.spotlightProjId = '';
      ui.hideEmptyRows = false;
      ui.includeTentative = true;
      renderAll();
    }
    function toggleFullscreenPresentation() {
      try {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      } catch (e) {}
    }

    // Mod 2 Snapshot Comparison Controls
    function setCompareSnapshot(id) {
      ui.compareSnapshotId = id;
      persistUIPrefs();
      renderSnapshotComparison();
    }
    function setCompareTarget(id) {
      ui.compareTargetId = id || '__CURRENT__';
      persistUIPrefs();
      renderSnapshotComparison();
    }
    function swapCompareSnapshots() {
      if (!ui.compareSnapshotId || ui.compareTargetId === '__CURRENT__') {
        showToast('Select two saved snapshots to swap Baseline (A) and Target (B).', 'info');
        return;
      }
      const tmp = ui.compareSnapshotId;
      ui.compareSnapshotId = ui.compareTargetId;
      ui.compareTargetId = tmp;
      persistUIPrefs();
      renderHealthDashboard();
    }
    function toggleCompareChangedOnly(checked) {
      ui.compareChangedOnly = Boolean(checked);
      persistUIPrefs();
      renderSnapshotComparison();
    }
    function setSnapshotCompareTab(sub) {
      ui.compareSubTab = sub;
      persistUIPrefs();
      renderSnapshotComparison();
    }

    function showToast(msg, type = 'info', opts = {}) {
      const container = document.getElementById('toastContainer');
      if (!container) return;
      const styles = {
        success: 'bg-emerald-600 text-white',
        error: 'bg-rose-600 text-white',
        warning: 'bg-amber-500 text-white',
        info: 'bg-slate-900 text-white',
      };
      const toast = document.createElement('div');
      toast.className = `pointer-events-auto px-3.5 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center justify-between gap-2.5 transition-all ${styles[type] || styles.info}`;
      const msgSpan = document.createElement('span');
      msgSpan.textContent = msg;
      toast.appendChild(msgSpan);

      if (opts && opts.undoable && _undoStack.length > 0) {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'px-2 py-0.5 rounded-md bg-white/15 hover:bg-white/25 text-white text-[11px] font-extrabold underline shrink-0 transition';
        undoBtn.textContent = 'Undo';
        undoBtn.onclick = () => {
          toast.remove();
          undoLastChange();
        };
        toast.appendChild(undoBtn);
      } else if (opts && opts.actionLabel && typeof opts.onAction === 'function') {
        const actBtn = document.createElement('button');
        actBtn.type = 'button';
        actBtn.className = 'px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 text-white text-[11px] font-extrabold shrink-0 transition';
        actBtn.textContent = opts.actionLabel;
        actBtn.onclick = () => {
          toast.remove();
          opts.onAction();
        };
        toast.appendChild(actBtn);
      }

      toast.title = 'Click to dismiss';
      toast.onclick = (ev) => {
        if (ev.target && ev.target.tagName === 'BUTTON') return;
        toast.remove();
      };
      container.appendChild(toast);
      const durationMs = opts && opts.durationMs
        ? opts.durationMs
        : opts && opts.undoable
          ? 4400
          : (type === 'error' ? 8000 : type === 'warning' ? 6500 : (opts && opts.actionLabel ? 7000 : 3500));
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(6px)';
        setTimeout(() => toast.remove(), 250);
      }, durationMs);
    }

    /* ============================================================================
     * 12. INITIALIZATION, VIEWPORT ADAPTATION & ACCESSIBLE KEYBOARD NAV
     * ============================================================================ */

    let _lastWasMobileViewport = null;

    function setupResponsiveViewportWatcher() {
      _lastWasMobileViewport = isMobileViewport();
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const nowMobile = isMobileViewport();
          if (nowMobile !== _lastWasMobileViewport) {
            _lastWasMobileViewport = nowMobile;
            renderAll();
          } else {
            syncMatrixFloatingHeaderMetrics();
            updateMatrixFloatingHeaderVisibility();
          }
        }, 120);
      });
    }

    function setupAccessibleTablistKeyboardNav() {
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && ui.presentMode) {
          ui.presentMode = false;
          renderAll();
          return;
        }
        requestAnimationFrame(() => {
          applyMatrixFullColumnWidths();
          syncMatrixFloatingHeaderMetrics();
          updateMatrixFloatingHeaderVisibility();
        });
      });

      document.addEventListener('keydown', (e) => {
        if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) {
          return;
        }
        if (e.key === 'Escape' && isModalOpen()) {
          if (document.querySelector('dialog[open]')) return;
          const forcedPwForm = document.querySelector('#ppChangeMyPwForm[data-forced="1"]');
          if (forcedPwForm) return;
          closeModal();
          return;
        }

        // Keep Tab focus trapped cleanly inside open modal dialog (WCAG 2.4.3)
        if (e.key === 'Tab' && isModalOpen() && !document.querySelector('dialog[open]')) {
          const card = document.getElementById('modalCard');
          if (!card) return;
          const focusables = [...card.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter(el => el.offsetParent !== null);
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
          return;
        }

        const active = document.activeElement;
        const isTyping = active && (
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable
        );
        const anyDialogOpen = isModalOpen() || Boolean(document.querySelector('dialog[open]'));

        // Global Undo / Redo shortcuts (Ctrl+Z / Cmd+Z / Ctrl+Y / Cmd+Shift+Z)
        if (!isTyping && !anyDialogOpen && (e.ctrlKey || e.metaKey) && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoLastChange();
            return;
          }
          if (k === 'y' || (k === 'z' && e.shiftKey)) {
            e.preventDefault();
            redoLastChange();
            return;
          }
        }

        // ArrowLeft / ArrowRight navigation for WAI-ARIA role="tablist"
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && active && active.getAttribute('role') === 'tab') {
          const tablist = active.closest('[role="tablist"]');
          if (tablist) {
            const tabs = [...tablist.querySelectorAll('[role="tab"]:not([disabled])')];
            const idx = tabs.indexOf(active);
            if (idx !== -1) {
              e.preventDefault();
              const nextIdx = e.key === 'ArrowRight'
                ? (idx + 1) % tabs.length
                : (idx - 1 + tabs.length) % tabs.length;
              tabs[nextIdx].focus();
              tabs[nextIdx].click();
              return;
            }
          }
        }

        // Open Built-In User Manual with '?' from any tab
        if (!isTyping && !anyDialogOpen && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
          e.preventDefault();
          openManualModal();
          return;
        }

        // Roadmap & Presenter Keyboard Shortcuts
        if (isTyping || anyDialogOpen || e.ctrlKey || e.metaKey || e.altKey) return;

        if (e.key === 'Escape') {
          const actionsPop = document.getElementById('roadmapActionsPopover');
          if (actionsPop && !actionsPop.classList.contains('hidden')) {
            closeRoadmapActionsMenu();
            return;
          }
          const pop = document.getElementById('headerWorkspacePopover');
          if (pop && !pop.classList.contains('hidden')) {
            closeHeaderWorkspaceMenu();
            return;
          }
          if (ui.activeTab === 'matrix') {
            if (ui.spotlightProjId) {
              setSpotlightProject('');
            } else if (ui.presentMode) {
              togglePresentMode();
            }
          }
          return;
        }
        if (ui.activeTab !== 'matrix') return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (e.shiftKey) shiftStartByInterval(-1);
          else shiftStartPeriod(-1);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (e.shiftKey) shiftStartByInterval(1);
          else shiftStartPeriod(1);
          return;
        }
        if (['1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          setHorizon(Number(e.key));
          return;
        }
        const lower = e.key.toLowerCase();
        if (lower === 't') {
          e.preventDefault();
          jumpToToday();
        } else if (lower === 'f') {
          e.preventDefault();
          togglePresentMode();
        } else if (e.key === '/') {
          e.preventDefault();
          if (!ui.matrixSettingsOpen) {
            ui.matrixSettingsOpen = true;
            persistUIPrefs();
            renderAll();
          }
          setTimeout(() => {
            const inp = document.getElementById('matrixSearchInput');
            if (inp) { inp.focus(); inp.select(); }
          }, 20);
        } else if (lower === 'a') {
          e.preventDefault();
          openAllocationModal();
        }
      });

      document.addEventListener('click', (e) => {
        const wrap = document.getElementById('headerMenuWrap');
        if (wrap && !wrap.contains(e.target)) closeHeaderWorkspaceMenu();
        const actionsWrap = document.getElementById('roadmapActionsWrap');
        if (actionsWrap && !actionsWrap.contains(e.target)) closeRoadmapActionsMenu();
      });
    }

    async function initApp() {
      // 1. Load saved UI preferences (preserving defaults & migrating legacy Meeting View prefs)
      let hasSavedUIPrefs = false;
      let parsedWelcomeSeen;
      try {
        const savedUI = safeGetStorage(STORAGE_KEYS.UI_PREFS);
        if (savedUI) {
          hasSavedUIPrefs = true;
          const parsedUI = JSON.parse(savedUI);
          parsedWelcomeSeen = parsedUI.welcomeSeen;
          const mergedPdfOpts = {
            colorMode: 'match',
            periodCount: 'match',
            colsPerPage: 6,
            ...ui.pdfOptions,
            ...(parsedUI.pdfOptions || {}),
          };
          ui = { ...ui, ...parsedUI, pdfOptions: mergedPdfOpts };
          if (parsedUI.autoReloadFromFile === undefined) ui.autoReloadFromFile = true;
          if (parsedUI.noteSize === undefined) ui.noteSize = parsedUI.meetingNoteSize || 'md';
          if (parsedUI.compactRowLabels === undefined) ui.compactRowLabels = true;
          if (parsedUI.cellColorMode === undefined) ui.cellColorMode = 'fill';
          if (parsedUI.horizon === undefined) ui.horizon = 4;
          else ui.horizon = getActiveHorizon();
          ui.presentMode = false;
          if (parsedUI.mobileLayoutMode === undefined) ui.mobileLayoutMode = 'cards';
          if (!Array.isArray(ui.mobileCollapsedIds)) ui.mobileCollapsedIds = [];
          if (parsedUI.compareTargetId === undefined) ui.compareTargetId = '__CURRENT__';
          if (parsedUI.compareChangedOnly === undefined) ui.compareChangedOnly = true;
          if (parsedUI.compareSubTab === undefined) ui.compareSubTab = 'deptPeriod';
          if (parsedUI.hideEmptyRows === undefined) ui.hideEmptyRows = false;
          if (parsedUI.includeTentative === undefined) ui.includeTentative = true;
          ui.spotlightProjId = '';
          ui.matrixSearch = '';
          ui.filterOverOnly = false;
          ui.filterAtRiskOnly = false;
          ui.filterHasNotesOnly = false;
          if (!Array.isArray(ui.recentUsers)) ui.recentUsers = [];
          if (!Array.isArray(ui.removedUsers)) ui.removedUsers = [];
          if (!Array.isArray(ui.expandedOverrideGroups)) ui.expandedOverrideGroups = [];
          if (!ui.linkedFilePaths || typeof ui.linkedFilePaths !== 'object' || Array.isArray(ui.linkedFilePaths)) ui.linkedFilePaths = {};
        } else {
          ui.pdfOptions = { colorMode: 'match', periodCount: 'match', colsPerPage: 6, ...ui.pdfOptions };
        }
      } catch (e) {}

      // 2. Load or initialize Live DB — NEVER hydrate plaintext localStorage if last session was encrypted/protected
      const secureFlag = typeof ppReadSecureSessionFlag === 'function' ? ppReadSecureSessionFlag() : null;
      const startProtectedLocked = Boolean(secureFlag && secureFlag.protected);
      if (startProtectedLocked) {
        liveDB = createEmptyDB();
        if (typeof ppClearPlaintextLocalCaches === 'function') {
          ppClearPlaintextLocalCaches();
        } else {
          try { localStorage.removeItem(STORAGE_KEYS.LIVE_DB); } catch (_e) {}
        }
        if (typeof window !== 'undefined' && typeof window.ppResetPeopleDirectoryMemory === 'function') {
          window.ppResetPeopleDirectoryMemory();
        }
        if (typeof window !== 'undefined' && typeof window.ppClearPbsMemoryAndStopSync === 'function') {
          window.ppClearPbsMemoryAndStopSync();
        }
        if (typeof window !== 'undefined' && typeof window.ppClearMspMemoryAndStopSync === 'function') {
          window.ppClearMspMemoryAndStopSync();
        }
        ui.demoMode = false;
        ui.whatIfMode = false;
        whatIfDB = null;
      } else {
        try {
          const savedLive = safeGetStorage(STORAGE_KEYS.LIVE_DB);
          liveDB = savedLive ? (normalizeAndMigrateDB(JSON.parse(savedLive)) || createEmptyDB()) : createEmptyDB();
        } catch (e) {
          liveDB = createEmptyDB();
        }
      }

      // Determine first-use Welcome Splash state (show automatically on first visit or unconfigured empty Live DB)
      if (parsedWelcomeSeen === undefined) {
        const hasExistingLiveData = Boolean(liveDB && ((liveDB.departments || []).length > 0 || (liveDB.projects || []).length > 0));
        ui.welcomeSeen = startProtectedLocked || (hasSavedUIPrefs && hasExistingLiveData);
      } else {
        ui.welcomeSeen = startProtectedLocked || Boolean(parsedWelcomeSeen);
      }

      // 3. Load or initialize isolated Demo DB
      try {
        const savedDemo = safeGetStorage(STORAGE_KEYS.DEMO_DB);
        demoDB = savedDemo ? (normalizeAndMigrateDB(JSON.parse(savedDemo)) || createSampleDemoDB()) : createSampleDemoDB();
      } catch (e) {
        demoDB = createSampleDemoDB();
      }

      // 4. Global error & unhandled-rejection diagnostics listeners
      try {
        window.addEventListener('error', (ev) => {
          ppDebug('ERROR', 'Uncaught window error', { message: ev?.message, line: ev?.lineno, col: ev?.colno });
        });
        window.addEventListener('unhandledrejection', (ev) => {
          const r = ev?.reason;
          ppDebug('ERROR', 'Unhandled promise rejection', { name: r?.name, message: r?.message || String(r || '') });
        });
      } catch (e) {}

      // 5. Accessible keyboard nav, modal focus trap, floating column headers & responsive watcher
      setupAccessibleTablistKeyboardNav();
      setupResponsiveViewportWatcher();
      setupMatrixFloatingHeaderSync();

      // 6. Auto-check inactivity timeout + linked file + Finance Vault + PBS folder whenever the window/tab regains focus
      const handleAppResume = () => {
        if (typeof ppCheckWallClockInactivityLock === 'function' && ppCheckWallClockInactivityLock()) return;
        if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
        if (linkedFileHandle && !ui.demoMode) checkExternalFileUpdates();
        if (typeof window !== 'undefined' && typeof window.ppPollFinanceVaultNow === 'function' && !ui.demoMode) {
          window.ppPollFinanceVaultNow().catch(() => {});
        }
        if (typeof window !== 'undefined' && typeof window.ppPollPbsFolderNow === 'function' && !ui.demoMode) {
          window.ppPollPbsFolderNow({ force: false, minIntervalMs: 2500 }).catch(() => {});
        }
      };
      window.addEventListener('focus', handleAppResume);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) handleAppResume();
      });
      window.addEventListener('pagehide', () => {
        if (typeof ppShouldSuppressPlaintextStorage === 'function' && ppShouldSuppressPlaintextStorage()) {
          if (typeof ppClearPlaintextLocalCaches === 'function') ppClearPlaintextLocalCaches();
        }
      });

      // 7. Apply theme & render UI (or lock screen immediately if previous session was encrypted/protected)
      ppDebug('INFO', 'PulsePlan initApp starting', getDebugEnvironmentSummary());
      applyDarkMode();
      applyPresentMode();
      updatePwaInstallUI();
      if (startProtectedLocked && typeof ppEnterInitialLockedGate === 'function') {
        ppEnterInitialLockedGate(secureFlag?.fileName || '', 'reconnect_required');
      }
      try {
        renderAll();
      } catch (e) {
        ppDebug('ERROR', 'Initial renderAll error', { name: e?.name, message: e?.message });
      }

      // Show first-use Welcome & Guided Setup Splash Screen on initial visit (never over lock gate)
      if (!startProtectedLocked && !ui.welcomeSeen && typeof openWelcomeModal === 'function') {
        setTimeout(() => {
          const isLocked = typeof ppIsSessionLocked === 'function' && ppIsSessionLocked();
          if (!isLocked && !ui.welcomeSeen && !isModalOpen()) openWelcomeModal(true);
        }, 160);
      }

      // 8. Retrieve previously linked shared file handle (timeout-guarded IDB) & auto-reconnect on desktop
      rememberedFileHandle = await loadRememberedHandle();
      if (startProtectedLocked && typeof ppRefreshLockedScreenUI === 'function') {
        ppRefreshLockedScreenUI();
      }
      await autoReconnectSyncFile();
      if (ui.activeTab === 'sync' && !(typeof ppIsSessionLocked === 'function' && ppIsSessionLocked())) renderSyncTab();

      // 9. Register offline PWA Service Worker when served over HTTPS or localhost and trigger immediate update check
      try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof location !== 'undefined' && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
          navigator.serviceWorker.register('./sw.js').then((reg) => {
            ppDebug('INFO', 'Service Worker registered', { scope: reg?.scope });
            try { if (reg && typeof reg.update === 'function') reg.update(); } catch (e) {}
          }).catch((swErr) => {
            ppDebug('WARN', 'Service Worker registration skipped/failed', { message: swErr?.message });
          });
        }
      } catch (e) {}
    }

    // Capture genuine PWA install prompt early (can fire before DOMContentLoaded)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
        ppDebug('INFO', 'PWA beforeinstallprompt captured — native 1-tap install ready');
        updatePwaInstallUI();
      });
      window.addEventListener('appinstalled', () => {
        deferredPwaPrompt = null;
        ppDebug('INFO', 'PWA appinstalled event received');
        updatePwaInstallUI();
        showToast('PulsePlan installed as an offline app!', 'success');
      });
    }

    window.addEventListener('DOMContentLoaded', initApp);
