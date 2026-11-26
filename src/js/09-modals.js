    /* ============================================================================
     * 10. TOUCH-OPTIMIZED MODALS & FOCUS MANAGEMENT (WCAG 2.2 / MOBILE ERGONOMICS)
     * ============================================================================ */

    let _pendingConfirmCallback = null;

    function showModal(innerHtml, maxWidthClass = 'max-w-lg') {
      const overlay = document.getElementById('modalOverlay');
      const card = document.getElementById('modalCard');
      if (!overlay || !card) return;
      if (overlay.classList.contains('hidden')) {
        lastFocusedBeforeModal = document.activeElement;
      }
      card.className = `bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl w-full ${maxWidthClass} max-h-[90dvh] overflow-y-auto overscroll-contain mobile-sheet-body sm:pb-0`;
      card.innerHTML = innerHtml;
      overlay.classList.remove('hidden');

      // Focus first interactive element inside modal (skip auto-focusing text inputs on coarse touch to avoid sudden keyboard jump)
      setTimeout(() => {
        const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const selector = isCoarse
          ? 'button[aria-label="Close dialog"], button:not([disabled])'
          : 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';
        const focusable = card.querySelector(selector);
        if (focusable && typeof focusable.focus === 'function') focusable.focus();
      }, 25);
    }

    function closeModal() {
      const overlay = document.getElementById('modalOverlay');
      if (overlay) overlay.classList.add('hidden');
      _pendingConfirmCallback = null;

      if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
        try { lastFocusedBeforeModal.focus(); } catch (e) {}
      }
      lastFocusedBeforeModal = null;

      if (pendingAutoReload && ui.autoReloadFromFile && linkedFileHandle && !isSavingToFile) {
        pendingAutoReload = false;
        setTimeout(() => checkExternalFileUpdates(), 120);
      }
    }

    function openConfirmModal(title, message, confirmLabel = 'Confirm', onConfirm = null) {
      _pendingConfirmCallback = typeof onConfirm === 'function' ? onConfirm : null;
      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">${escapeHtml(title)}</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          <p class="text-slate-600 leading-relaxed text-sm sm:text-xs">${escapeHtml(message)}</p>
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold transition">Cancel</button>
            <button type="button" onclick="executePendingConfirm()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold transition">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>`);
    }

    function executePendingConfirm() {
      const cb = _pendingConfirmCallback;
      closeModal();
      if (typeof cb === 'function') cb();
    }

    function openSyncConflictModal(extMeta, diskLastModified, diskDB = null) {
      const who = escapeHtml(extMeta?.lastModifiedBy || 'a teammate');
      const rev = escapeHtml(String(extMeta?.revision || '?'));
      const when = diskLastModified ? new Date(diskLastModified).toLocaleTimeString() : 'just now';
      const fname = escapeHtml(linkedFileHandle?.name || 'shared database');

      let diffPreviewHtml = '';
      if (diskDB && liveDB && typeof computeSnapshotDiff === 'function') {
        try {
          const deptMap = new Map();
          [...(diskDB.departments || []), ...(liveDB.departments || [])].forEach(d => deptMap.set(d.id, d));
          const projMap = new Map();
          [...(diskDB.projects || []), ...(liveDB.projects || [])].forEach(p => projMap.set(p.id, p));
          const mergedDB = { ...liveDB, departments: [...deptMap.values()], projects: [...projMap.values()] };
          const allWkKeys = new Set();
          [diskDB.allocations, liveDB.allocations].forEach(m => {
            Object.keys(m || {}).forEach(k => {
              const wk = k.split('::')[2];
              if (wk && /^\d{4}-W\d{2}$/.test(wk)) allWkKeys.add(wk);
            });
          });
          [diskDB.capacityOverrides, liveDB.capacityOverrides].forEach(m => {
            Object.keys(m || {}).forEach(k => {
              const wk = k.split('::')[1];
              if (wk && /^\d{4}-W\d{2}$/.test(wk)) allWkKeys.add(wk);
            });
          });
          const diffPeriods = allWkKeys.size > 0
            ? [...allWkKeys].sort().slice(0, 52)
            : getVisiblePeriods();
          const diffTimeUnit = allWkKeys.size > 0 ? 'week' : ui.timeUnit;
          const stateDisk = { label: `Disk (Rev ${rev})`, allocations: diskDB.allocations || {}, capacityOverrides: diskDB.capacityOverrides || {}, milestones: diskDB.milestones || [], comments: diskDB.comments || {} };
          const stateMine = { label: 'Your Local Plan', allocations: liveDB.allocations || {}, capacityOverrides: liveDB.capacityOverrides || {}, milestones: liveDB.milestones || [], comments: liveDB.comments || {} };
          const diff = computeSnapshotDiff(mergedDB, stateDisk, stateMine, diffPeriods, diffTimeUnit, ui.manpowerUnit);
          const changedMs = diff.milestones.filter(m => m.hasChange);
          const topCells = diff.cellChanges.slice(0, 6);
          const totalDiffItems = diff.cellChanges.length + diff.capChanges.length + changedMs.length;

          diffPreviewHtml = `
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="font-bold text-slate-800">Visual Diff (Disk Rev ${rev} &rarr; Your Local Edits)</div>
                <div class="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                  <span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">${diff.cellChanges.length} cell${diff.cellChanges.length === 1 ? '' : 's'}</span>
                  <span class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">${diff.capChanges.length} cap</span>
                  <span class="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">${changedMs.length} milestone${changedMs.length === 1 ? '' : 's'}</span>
                </div>
              </div>
              ${totalDiffItems === 0
                ? '<div class="text-[11px] text-slate-500">Metadata or settings differ; no allocation, capacity, or milestone deltas detected.</div>'
                : `<div class="space-y-1 max-h-36 overflow-y-auto text-[11px]">
                     ${topCells.map(c => `
                       <div class="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-white border border-slate-200/80">
                         <span class="truncate font-semibold text-slate-800">${escapeHtml(c.dept.code)} &rarr; [${escapeHtml(c.proj.code)}] <span class="font-mono text-slate-500">${escapeHtml(c.periodKey)}</span></span>
                         <span class="font-mono font-bold shrink-0 tabular-nums">${formatValue(c.valA, diff.unit, false)} &rarr; <span class="${c.delta > 0 ? 'text-rose-600' : 'text-emerald-600'}">${formatValue(c.valB, diff.unit)}</span></span>
                       </div>`).join('')}
                     ${diff.cellChanges.length > 6 ? `<div class="text-[10px] text-slate-400 pl-1">+ ${diff.cellChanges.length - 6} more allocation difference(s)</div>` : ''}
                     ${diff.capChanges.slice(0, 3).map(cp => `
                       <div class="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-sky-50/70 border border-sky-200 text-sky-900">
                         <span class="truncate font-semibold">Cap: ${escapeHtml(cp.dept.code)} (${escapeHtml(cp.periodKey)})</span>
                         <span class="font-mono font-bold shrink-0 tabular-nums">${formatValue(cp.capA, diff.unit, false)} &rarr; ${formatValue(cp.capB, diff.unit)}</span>
                       </div>`).join('')}
                     ${changedMs.slice(0, 3).map(m => `
                       <div class="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-violet-50/70 border border-violet-200 text-violet-900">
                         <span class="truncate font-semibold">&#9670; ${escapeHtml(m.title)}</span>
                         <span class="font-mono font-bold shrink-0">${escapeHtml(m.dateA || '—')} &rarr; ${escapeHtml(m.dateB || 'removed')}</span>
                       </div>`).join('')}
                   </div>`}
            </div>`;
        } catch (diffErr) {}
      }

      const isSameUserOtherTab = Boolean(extMeta && extMeta.lastModifiedBy && ui.userName && String(extMeta.lastModifiedBy).trim().toLowerCase() === String(ui.userName).trim().toLowerCase());
      const sourceSubtitle = isSameUserOtherTab
        ? 'Another tab or device signed in with your name modified the same cell(s).'
        : 'Auto-save was paused because the same cell(s) were edited elsewhere.';
      const reloadLabel = isSameUserOtherTab
        ? 'Reload Disk Version (Recommended)'
        : 'Reload Teammate&rsquo;s Version (Recommended)';

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-rose-700">Sync Conflict Detected</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">${sourceSubtitle}</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          <div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 leading-relaxed space-y-1">
            <div><strong>${who}</strong> updated <code class="px-1 rounded bg-white/70 font-mono break-all">${fname}</code> at <strong>${escapeHtml(when)}</strong> (Rev ${rev}) while you had conflicting local changes on the same cell(s).</div>
            <div class="text-[11px]">Non-overlapping edits are auto-merged automatically. Review the remaining collision below:</div>
          </div>

          ${diffPreviewHtml}

          <div class="grid grid-cols-1 gap-2">
            <button type="button" onclick="closeModal(); reloadFromLinkedFile();"
              class="w-full px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs text-left flex items-center justify-between gap-2 transition">
              <span>${reloadLabel}</span>
              <span class="text-[10px] opacity-80 shrink-0">Discard my unsaved edit</span>
            </button>
            <button type="button" onclick="forceOverwriteLinkedFile()"
              class="w-full px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-xs text-left flex items-center justify-between gap-2 transition">
              <span>Keep Mine &amp; Overwrite Shared File</span>
              <span class="text-[10px] shrink-0">Replace Rev ${rev}</span>
            </button>
            <button type="button" onclick="downloadJsonBackup()"
              class="w-full px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs text-left flex items-center justify-between gap-2 transition">
              <span>Download Backup of My Local Plan (.json)</span>
              <span class="text-[10px] text-slate-400 shrink-0">Safe copy first</span>
            </button>
          </div>
        </div>`, 'max-w-xl');
    }

    /* ---------- Mod 4: Quick 3-Level FTE Threshold Tuner Modal ---------- */

    function openFte3TuneModal() {
      const cfg = getFte3Settings(getActiveDB());
      const isAbs = cfg.basis === 'absoluteFte';
      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Tune 3-Level Demand Thresholds</h3>
              <p class="text-[11px] text-slate-500">Highlight the most demanding projects with Green / Yellow / Red tiers.</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          <div>
            <label for="mFte3Basis" class="block font-semibold text-slate-700 mb-1">Evaluation Basis</label>
            <select id="mFte3Basis" onchange="document.getElementById('mFte3PctRow').classList.toggle('hidden', this.value==='absoluteFte'); document.getElementById('mFte3AbsRow').classList.toggle('hidden', this.value!=='absoluteFte');"
              class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold">
              <option value="capacityPct" ${!isAbs ? 'selected' : ''}>% of Department Available Capacity</option>
              <option value="absoluteFte" ${isAbs ? 'selected' : ''}>Absolute Headcount FTE</option>
            </select>
          </div>

          <div id="mFte3PctRow" class="${isAbs ? 'hidden' : ''} grid grid-cols-2 gap-3">
            <div>
              <label for="mFte3YellowPct" class="block font-semibold text-slate-700 mb-1">&#9650; Yellow Cutoff (% Cap)</label>
              <div class="flex items-center gap-1">
                <button type="button" aria-label="Decrease yellow cutoff" onclick="stepNumericInput('mFte3YellowPct', -5, 5, 95, 0)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">&minus;</button>
                <input id="mFte3YellowPct" type="number" inputmode="numeric" min="5" max="95" step="5" value="${cfg.yellowPct}" class="w-full px-2 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
                <button type="button" aria-label="Increase yellow cutoff" onclick="stepNumericInput('mFte3YellowPct', 5, 5, 95, 0)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">+</button>
              </div>
            </div>
            <div>
              <label for="mFte3RedPct" class="block font-semibold text-slate-700 mb-1">&#8252; Red Cutoff (% Cap)</label>
              <div class="flex items-center gap-1">
                <button type="button" aria-label="Decrease red cutoff" onclick="stepNumericInput('mFte3RedPct', -5, 10, 150, 0)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">&minus;</button>
                <input id="mFte3RedPct" type="number" inputmode="numeric" min="10" max="150" step="5" value="${cfg.redPct}" class="w-full px-2 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
                <button type="button" aria-label="Increase red cutoff" onclick="stepNumericInput('mFte3RedPct', 5, 10, 150, 0)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">+</button>
              </div>
            </div>
          </div>

          <div id="mFte3AbsRow" class="${isAbs ? '' : 'hidden'} grid grid-cols-2 gap-3">
            <div>
              <label for="mFte3YellowFte" class="block font-semibold text-slate-700 mb-1">&#9650; Yellow Cutoff (FTE)</label>
              <div class="flex items-center gap-1">
                <button type="button" aria-label="Decrease yellow FTE" onclick="stepNumericInput('mFte3YellowFte', -0.25, 0.25, 50, 2)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">&minus;</button>
                <input id="mFte3YellowFte" type="number" inputmode="decimal" min="0.25" max="50" step="0.25" value="${cfg.yellowFte}" class="w-full px-2 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
                <button type="button" aria-label="Increase yellow FTE" onclick="stepNumericInput('mFte3YellowFte', 0.25, 0.25, 50, 2)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">+</button>
              </div>
            </div>
            <div>
              <label for="mFte3RedFte" class="block font-semibold text-slate-700 mb-1">&#8252; Red Cutoff (FTE)</label>
              <div class="flex items-center gap-1">
                <button type="button" aria-label="Decrease red FTE" onclick="stepNumericInput('mFte3RedFte', -0.25, 0.5, 100, 2)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">&minus;</button>
                <input id="mFte3RedFte" type="number" inputmode="decimal" min="0.5" max="100" step="0.25" value="${cfg.redFte}" class="w-full px-2 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
                <button type="button" aria-label="Increase red FTE" onclick="stepNumericInput('mFte3RedFte', 0.25, 0.5, 100, 2)" class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 font-bold shrink-0">+</button>
              </div>
            </div>
          </div>

          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-3 text-[11px] font-semibold">
            <span class="inline-flex items-center gap-1"><span class="px-1.5 py-0.5 rounded text-white" style="background:#15803d">&#9679; Green</span> Low</span>
            <span class="inline-flex items-center gap-1"><span class="px-1.5 py-0.5 rounded text-slate-900" style="background:#facc15">&#9650; Yellow</span> Moderate</span>
            <span class="inline-flex items-center gap-1"><span class="px-1.5 py-0.5 rounded text-white" style="background:#dc2626">&#8252; Red</span> High Demand</span>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button type="button" onclick="saveFte3TuneModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Apply Thresholds</button>
          </div>
        </div>`, 'max-w-md');
    }

    function saveFte3TuneModal() {
      const db = getActiveDB();
      const basis = document.getElementById('mFte3Basis').value === 'absoluteFte' ? 'absoluteFte' : 'capacityPct';
      const yellowPct = Math.max(5, Math.min(95, parseInt(document.getElementById('mFte3YellowPct').value, 10) || 25));
      const redPct = Math.max(yellowPct + 5, Math.min(150, parseInt(document.getElementById('mFte3RedPct').value, 10) || 50));
      const yellowFte = Math.max(0.25, Math.min(50, parseFloat(document.getElementById('mFte3YellowFte').value) || 1.0));
      const redFte = Math.max(yellowFte + 0.25, Math.min(100, parseFloat(document.getElementById('mFte3RedFte').value) || 2.5));
      db.settings.fte3Scheme = { basis, yellowPct, redPct, yellowFte, redFte };
      recordChange('Settings', `Updated 3-Level FTE demand thresholds (${basis === 'absoluteFte' ? `${yellowFte}/${redFte} FTE` : `${yellowPct}%/${redPct}%`})`);
      closeModal();
      renderAll();
      showToast('3-Level demand thresholds updated', 'success');
    }

    /* ---------- Active User Display & Switcher Modal ---------- */

    function getSuggestedTeamUsers() {
      const db = getActiveDB();
      const hidden = new Set((ui.removedUsers || []).map(u => String(u || '').trim().toLowerCase()).filter(Boolean));
      const seen = new Map();
      const addName = (n, allowHidden = false) => {
        const clean = String(n || '').trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        if (!allowHidden && hidden.has(key)) return;
        if (!seen.has(key)) seen.set(key, clean);
      };
      addName(ui.userName, true);
      (ui.recentUsers || []).forEach(u => addName(u));
      (db.departments || []).forEach(d => addName(d.manager));
      (db.projects || []).forEach(p => { addName(p.owner); addName(p.techLead); });
      (db.changeLog || []).slice(0, 30).forEach(l => addName(l.user));
      (db.snapshots || []).forEach(s => addName(s.createdBy));
      return [...seen.values()];
    }

    function setActiveUserName(newName, shouldRender = true) {
      const clean = String(newName || '').trim() || 'Project Mgr';
      const key = clean.toLowerCase();
      ui.userName = clean;
      if (Array.isArray(ui.removedUsers)) {
        ui.removedUsers = ui.removedUsers.filter(u => String(u || '').trim().toLowerCase() !== key);
      }
      const list = Array.isArray(ui.recentUsers) ? ui.recentUsers.filter(u => u.toLowerCase() !== key) : [];
      list.unshift(clean);
      ui.recentUsers = list.slice(0, 10);
      persistUIPrefs();
      if (shouldRender) renderAll();
    }

    function removeQuickUser(name) {
      const clean = String(name || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();

      if (!Array.isArray(ui.removedUsers)) ui.removedUsers = [];
      if (!ui.removedUsers.some(u => String(u || '').trim().toLowerCase() === key)) {
        ui.removedUsers.push(clean);
      }
      ui.recentUsers = (Array.isArray(ui.recentUsers) ? ui.recentUsers : []).filter(
        u => String(u || '').trim().toLowerCase() !== key
      );

      // If removing the currently active user, fall back to the next remaining suggested user (or Project Mgr)
      if ((ui.userName || '').trim().toLowerCase() === key) {
        const prevName = ui.userName;
        ui.userName = '';
        const remaining = getSuggestedTeamUsers();
        ui.userName = remaining[0] || (key === 'project mgr' ? prevName : 'Project Mgr');
      }

      persistUIPrefs();
      renderAll();
      openUserSwitcherModal();
      showToast(`Removed "${clean}" from users`, 'info');
    }

    function restoreRemovedUsers() {
      ui.removedUsers = [];
      persistUIPrefs();
      openUserSwitcherModal();
      showToast('Restored removed users', 'info');
    }

    function openUserSwitcherModal() {
      const current = (ui.userName || 'Project Mgr').trim();
      const suggestions = getSuggestedTeamUsers();
      const removedCount = Array.isArray(ui.removedUsers) ? ui.removedUsers.length : 0;

      const chipsHtml = suggestions.map(name => {
        const isCur = name.toLowerCase() === current.toLowerCase();
        const canRemove = suggestions.length > 1 || name.toLowerCase() !== 'project mgr';
        return `
          <div class="inline-flex items-center rounded-xl border text-xs font-semibold transition overflow-hidden ${isCur ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700'}">
            <button type="button" data-user-name="${escapeHtml(name)}" onclick="selectQuickUser(this.dataset.userName)"
              class="inline-flex items-center gap-1.5 pl-2.5 ${canRemove ? 'pr-1.5' : 'pr-3'} py-1.5 hover:bg-slate-100 transition cursor-pointer">
              <span class="w-5 h-5 rounded-md ${isCur ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'} text-[9px] font-extrabold flex items-center justify-center shrink-0">${escapeHtml(getUserInitials(name))}</span>
              <span>${escapeHtml(name)}</span>
            </button>
            ${canRemove ? `<button type="button" data-user-name="${escapeHtml(name)}" onclick="removeQuickUser(this.dataset.userName)"
              title="Remove ${escapeHtml(name)}" aria-label="Remove user ${escapeHtml(name)}"
              class="px-2 py-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 font-bold leading-none transition cursor-pointer">&times;</button>` : ''}
          </div>`;
      }).join('');

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 font-extrabold text-xs flex items-center justify-center">${escapeHtml(getUserInitials(current))}</span>
              <div>
                <h3 id="modalTitle" class="text-base font-bold text-slate-900">Active User</h3>
                <p class="text-[11px] text-slate-500">Shown in Change Log, Snapshots &amp; Sync metadata</p>
              </div>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          <form onsubmit="event.preventDefault(); saveUserSwitcherModal();" class="space-y-3">
            <div>
              <label for="mUserNameInput" class="block font-semibold text-slate-700 mb-1">Switch or Enter User Name / Role</label>
              <input id="mUserNameInput" type="text" value="${escapeHtml(current)}" placeholder="e.g., Alex (PM)"
                class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
            </div>

            ${suggestions.length > 0 || removedCount > 0 ? `
              <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Quick Switch</div>
                  ${removedCount > 0 ? `<button type="button" onclick="restoreRemovedUsers()" class="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer">Restore ${removedCount} removed</button>` : ''}
                </div>
                <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">${chipsHtml}</div>
              </div>` : ''}

            <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold transition">Cancel</button>
              <button type="submit" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">Switch User</button>
            </div>
          </form>
        </div>`, 'max-w-md');
    }

    function selectQuickUser(name) {
      setActiveUserName(name, true);
      closeModal();
      showToast(`Switched user to ${ui.userName}`, 'success');
    }

    function saveUserSwitcherModal() {
      const val = (document.getElementById('mUserNameInput')?.value || '').trim();
      if (!val) { showToast('Please enter a user name.', 'warning'); return; }
      setActiveUserName(val, true);
      closeModal();
      showToast(`Switched user to ${ui.userName}`, 'success');
    }

    /* ---------- Cell Detail & Project Comments Modal ---------- */

    function openCellDetailModal(rowId, periodKey) {
      const db = getActiveDB();
      const isDeptAxis = ui.axis === 'department';
      const primaryRow = isDeptAxis
        ? db.departments.find(d => d.id === rowId)
        : db.projects.find(p => p.id === rowId);
      if (!primaryRow) return;

      const hdr = formatPeriodHeader(periodKey, ui.timeUnit);
      const secondaryList = isDeptAxis ? getSortedProjects(db) : getSortedDepartments(db);
      const warnT = db.settings.warnThreshold || 85;
      const overT = db.settings.overThreshold || 100;

      let summaryBadgeHtml = '';
      let isOverallocatedSlot = false;
      if (isDeptAxis) {
        const cap = getDeptCapacityForPeriod(rowId, periodKey, ui.timeUnit, db).avgFte;
        const alloc = getDeptTotalAllocatedFte(rowId, periodKey, ui.timeUnit, db);
        const pct = cap > 0 ? Math.round((alloc / cap) * 100) : (alloc > 0 ? 999 : 0);
        isOverallocatedSlot = pct > overT;
        const badgeCls = pct > overT ? 'bg-rose-100 text-rose-700' : pct >= warnT ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
        summaryBadgeHtml = `<span class="px-2 py-0.5 rounded-lg text-[11px] font-bold ${badgeCls}">${formatValue(fteToDisplayValue(alloc, periodKey, ui.timeUnit))} / ${formatValue(fteToDisplayValue(cap, periodKey, ui.timeUnit))} (${pct > 990 ? '&infin;' : pct + '%'})</span>`;
      } else if (isNonFteProject(primaryRow)) {
        summaryBadgeHtml = `<span class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">Admin &middot; Non-FTE (Issues &amp; Meetings)</span>`;
      } else {
        const tot = getProjTotalAllocatedFte(rowId, periodKey, ui.timeUnit, db);
        summaryBadgeHtml = `<span class="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700">Total Effort: ${formatValue(fteToDisplayValue(tot, periodKey, ui.timeUnit))}</span>`;
      }

      const activeItems = [];
      const unusedItems = [];
      secondaryList.forEach(item => {
        const deptId = isDeptAxis ? rowId : item.id;
        const projId = isDeptAxis ? item.id : rowId;
        const pairProj = isDeptAxis ? item : primaryRow;
        const alloc = getAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, db.allocations);
        const cmt = getCellProjectComments(deptId, projId, periodKey, ui.timeUnit, db);
        if (alloc.hasData || cmt.hasAny || (isNonFteProject(pairProj) && Boolean(cmt.monthNote))) activeItems.push({ item, deptId, projId, alloc, cmt });
        else unusedItems.push(item);
      });

      const buildCommentCardHtml = (item, deptId, projId, alloc, cmt) => {
        const pairProj = isDeptAxis ? item : primaryRow;
        const isAdminPair = isNonFteProject(pairProj);
        const valStr = alloc && alloc.hasData
          ? formatValue(fteToDisplayValue(alloc.avgFte, periodKey, ui.timeUnit))
          : '0 ' + unitShortLabel();
        const fmtNote = (txt) => (typeof ppFormatRoadmapNoteHtml === 'function')
          ? ppFormatRoadmapNoteHtml(txt, 'inline')
          : escapeHtml(txt);
        const weekNotesHtml = (cmt && cmt.weekEntries && cmt.weekEntries.length > 0)
          ? `<div class="mt-1.5 p-2 rounded-lg bg-indigo-50/70 border border-indigo-200 text-[11px] text-indigo-900 space-y-1">
               <div class="font-bold text-[10px] uppercase tracking-wider text-indigo-700">Weekly Notes inside ${escapeHtml(hdr.title)}:</div>
               ${cmt.weekEntries.map(we => `<div><span class="font-mono font-bold">${escapeHtml(we.weekShort)}:</span> ${fmtNote(we.text)}</div>`).join('')}
             </div>`
          : '';
        const monthNoteRefHtml = (cmt && cmt.monthNote)
          ? `<div class="mt-1 text-[11px] text-slate-500 italic">Month note (${escapeHtml(getWeekOwningMonth(periodKey))}): ${fmtNote(cmt.monthNote)}</div>`
          : '';
        const rightControlsHtml = isAdminPair
          ? `<div class="flex items-center gap-1.5 shrink-0">
               <span class="px-2 py-0.5 rounded-md bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-bold uppercase">Admin &middot; Non-FTE</span>
               <button type="button" onclick="openAllocationModal('${deptId}', '${projId}', '${periodKey}')"
                 class="px-2.5 py-1.5 sm:px-2 sm:py-0.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-indigo-700 text-[11px] font-semibold transition">Edit</button>
             </div>`
          : `<div class="flex items-center gap-1.5 shrink-0">
               <div class="inline-flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden">
                 <button type="button" aria-label="Decrease ${escapeHtml(item.name)} allocation" onclick="stepAllocationInCellModal('${rowId}', '${deptId}', '${projId}', '${periodKey}', -1)" title="Decrease allocation"
                   class="px-2.5 py-1.5 sm:px-2 sm:py-0.5 hover:bg-rose-50 hover:text-rose-700 text-slate-700 font-bold transition">&minus;</button>
                 <span class="text-xs font-bold text-slate-800 tabular-nums px-2 border-x border-slate-200">${valStr}</span>
                 <button type="button" aria-label="Increase ${escapeHtml(item.name)} allocation" onclick="stepAllocationInCellModal('${rowId}', '${deptId}', '${projId}', '${periodKey}', 1)" title="Increase allocation"
                   class="px-2.5 py-1.5 sm:px-2 sm:py-0.5 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 font-bold transition">+</button>
               </div>
               <button type="button" onclick="openAllocationModal('${deptId}', '${projId}', '${periodKey}')"
                 class="px-2.5 py-1.5 sm:px-2 sm:py-0.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-indigo-700 text-[11px] font-semibold transition">Edit</button>
             </div>`;
        const placeholderTxt = isAdminPair
          ? `Log expected departmental issues or meetings for ${escapeHtml(hdr.title)}... (start a line with "- " for bullets)`
          : `Add comments for [${escapeHtml(item.code)}] in ${escapeHtml(hdr.title)}... (start a line with "- " for bullets)`;

        return `
          <div class="${isAdminPair ? 'admin-hashed-card' : 'accent-card border border-slate-200 bg-slate-50/70'} p-3 rounded-xl space-y-2" style="${isAdminPair ? `--admin-accent:${item.color}; --accent-w:4px;` : `--accent-color:${item.color}; --accent-w:4px; border-left: 4px solid ${item.color};`}">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 shrink-0">${escapeHtml(item.code)}</span>
                <span class="font-bold text-xs text-slate-900 truncate">${escapeHtml(item.name)}</span>
              </div>
              ${rightControlsHtml}
            </div>
            <textarea rows="3"
              data-bullet-notes="true"
              aria-label="Comments for ${escapeHtml(item.name)} in ${escapeHtml(hdr.title)}"
              data-comment-dept="${deptId}" data-comment-proj="${projId}"
              placeholder="${placeholderTxt}"
              class="cell-comment-input w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/30">${escapeHtml(cmt ? cmt.direct : '')}</textarea>
            ${weekNotesHtml}
            ${monthNoteRefHtml}
          </div>`;
      };

      const cardsHtml = activeItems.length > 0
        ? activeItems.map(x => buildCommentCardHtml(x.item, x.deptId, x.projId, x.alloc, x.cmt)).join('')
        : `<div id="cellCommentsEmptyState" class="p-4 rounded-xl border border-dashed border-slate-300 text-center text-slate-500 text-xs">
             No projects allocated in this cell yet. Click <strong>+ Allocate</strong> below or pick a ${isDeptAxis ? 'project' : 'department'} to add comments.
           </div>`;

      const addMoreDropdownHtml = unusedItems.length > 0
        ? `<div class="flex items-center gap-2 pt-1">
             <label for="cellAddCommentItemSelect" class="sr-only">Choose item to add comment box</label>
             <select id="cellAddCommentItemSelect" class="flex-1 px-3 py-2 sm:py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium">
               <option value="">+ Add comments for another ${isDeptAxis ? 'project' : 'department'}...</option>
               ${unusedItems.map(it => `<option value="${it.id}">${escapeHtml(isDeptAxis ? formatProjectOptionLabel(it) : `${it.name} [${it.code}]`)}</option>`).join('')}
             </select>
             <button type="button" onclick="addProjectCommentRowInModal('${rowId}', '${periodKey}')"
               class="px-3 py-2 sm:py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition shrink-0">Add Box</button>
           </div>`
        : '';

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:${primaryRow.color}" aria-hidden="true"></span>
                <h3 id="modalTitle" class="text-base font-bold text-slate-900">[${escapeHtml(primaryRow.code)}] ${escapeHtml(primaryRow.name)} &times; ${escapeHtml(hdr.title)}</h3>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[11px] text-slate-500">${ui.timeUnit === 'week' ? 'ISO Week' : 'Month'} (${escapeHtml(hdr.sub)})</span>
                ${summaryBadgeHtml}
              </div>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none shrink-0">&times;</button>
          </div>

          <div class="flex flex-wrap items-center gap-2 pb-2 border-b border-slate-100">
            <button type="button" onclick="openAllocationModal('${isDeptAxis ? rowId : ''}', '${isDeptAxis ? '' : rowId}', '${periodKey}')"
              class="px-3 py-2 sm:py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold transition">${!isDeptAxis && isNonFteProject(primaryRow) ? '+ Add Issue / Meeting Note' : '+ Allocate Manpower'}</button>
            ${isDeptAxis ? `<button type="button" onclick="openCapacityModal('${rowId}', '${periodKey}')" class="px-3 py-2 sm:py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-semibold transition">Variable Capacity</button>` : ''}
            ${isOverallocatedSlot ? `<button type="button" onclick="openBottleneckResolverModal('${rowId}', '${periodKey}')" class="px-3 py-2 sm:py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition">&#9888; Fix Overallocation</button>` : ''}
            <button type="button" onclick="openMilestoneModal('', '${isDeptAxis ? '' : rowId}', '${getPeriodMidDateISO(periodKey, ui.timeUnit)}', '${isDeptAxis ? rowId : ''}')"
              class="px-3 py-2 sm:py-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-semibold transition">&#9670; Add Milestone</button>
          </div>

          <div class="space-y-2">
            <div class="font-bold text-slate-700">Project Comments for ${escapeHtml(hdr.title)}</div>
            <div id="cellCommentsCardsContainer" class="space-y-2.5 max-h-[42dvh] overflow-y-auto pr-1">
              ${cardsHtml}
            </div>
            ${addMoreDropdownHtml}
          </div>

          <input type="hidden" id="cellDetailRowId" value="${rowId}" />
          <input type="hidden" id="cellDetailPeriodKey" value="${periodKey}" />

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold transition">Close</button>
            <button type="button" onclick="saveCellCommentsModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">Save Comments</button>
          </div>
        </div>`);
    }

    function addProjectCommentRowInModal(rowId, periodKey) {
      const sel = document.getElementById('cellAddCommentItemSelect');
      if (!sel || !sel.value) return;
      const itemId = sel.value;
      const db = getActiveDB();
      const isDeptAxis = ui.axis === 'department';
      const item = isDeptAxis
        ? db.projects.find(p => p.id === itemId)
        : db.departments.find(d => d.id === itemId);
      if (!item) return;

      const deptId = isDeptAxis ? rowId : item.id;
      const projId = isDeptAxis ? item.id : rowId;
      const hdr = formatPeriodHeader(periodKey, ui.timeUnit);

      const empty = document.getElementById('cellCommentsEmptyState');
      if (empty) empty.remove();

      const container = document.getElementById('cellCommentsCardsContainer');
      const div = document.createElement('div');
      div.className = 'accent-card p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2';
      div.style.setProperty('--accent-color', item.color);
      div.style.setProperty('--accent-w', '4px');
      div.style.borderLeft = `4px solid ${item.color}`;
      div.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 shrink-0">${escapeHtml(item.code)}</span>
            <span class="font-bold text-xs text-slate-900 truncate">${escapeHtml(item.name)}</span>
          </div>
          <span class="text-[11px] text-slate-500 font-semibold">0 ${unitShortLabel()}</span>
        </div>
        <textarea rows="3"
          data-bullet-notes="true"
          aria-label="Comments for ${escapeHtml(item.name)} in ${escapeHtml(hdr.title)}"
          data-comment-dept="${deptId}" data-comment-proj="${projId}"
          placeholder="Add comments for [${escapeHtml(item.code)}] in ${escapeHtml(hdr.title)}... (start a line with &quot;- &quot; for bullets)"
          class="cell-comment-input w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/30"></textarea>`;
      container.appendChild(div);
      div.querySelector('textarea')?.focus();
      sel.querySelector(`option[value="${itemId}"]`)?.remove();
      sel.value = '';
    }

    function saveCellCommentsModal() {
      const db = getActiveDB();
      const periodKey = document.getElementById('cellDetailPeriodKey')?.value;
      if (!periodKey) return;

      const textareas = document.querySelectorAll('.cell-comment-input');
      let updatedCount = 0;
      const pendingUpdates = [];
      textareas.forEach(ta => {
        const deptId = ta.dataset.commentDept;
        const projId = ta.dataset.commentProj;
        const key = getCommentKey(deptId, projId, periodKey);
        const prev = (db.comments && db.comments[key]) || '';
        const next = ta.value.trim();
        if (prev !== next) {
          pendingUpdates.push({ deptId, projId, next });
          updatedCount++;
        }
      });

      if (updatedCount > 0) {
        const hdr = formatPeriodHeader(periodKey, ui.timeUnit).title;
        pushUndoState(`Update comments in ${hdr}`);
        pendingUpdates.forEach(u => setCellProjectComment(u.deptId, u.projId, periodKey, u.next, db));
        recordChange('Comment', `Updated ${updatedCount} project comment${updatedCount === 1 ? '' : 's'} in ${hdr}`);
        ui.showCellComments = true;
        persistUIPrefs();
        showToast(`Saved ${updatedCount} project comment${updatedCount === 1 ? '' : 's'}`, 'success', { undoable: true });
      } else {
        showToast('No comment changes to save', 'info');
      }

      closeModal();
      renderAll();
    }

    function stepAllocationInCellModal(rowId, deptId, projId, periodKey, dir) {
      const db = getActiveDB();
      const dCode = db.departments.find(d => d.id === deptId)?.code || deptId;
      const pCode = db.projects.find(p => p.id === projId)?.code || projId;
      pushUndoState(`Adjust [${dCode} -> ${pCode}]`);
      document.querySelectorAll('.cell-comment-input').forEach(ta => {
        const dId = ta.dataset.commentDept;
        const pId = ta.dataset.commentProj;
        if (dId && pId) setCellProjectComment(dId, pId, periodKey, ta.value, db);
      });

      const cur = getAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, db.allocations);
      const { step, decimals } = getManpowerStep(ui.manpowerUnit);
      const curDisp = fteToDisplayValue(cur.avgFte, periodKey, ui.timeUnit, ui.manpowerUnit);
      const factor = Math.pow(10, decimals);
      const nextDisp = Math.max(0, Math.round((curDisp + dir * step) * factor) / factor);
      const nextFte = displayValueToFte(nextDisp, periodKey, ui.timeUnit, ui.manpowerUnit);

      setAllocationForPeriod(deptId, projId, periodKey, ui.timeUnit, nextFte, db);
      recordChange('Allocation', `[${dCode} -> ${pCode}] adjusted to ${formatValue(nextDisp)} in ${periodKey}`);
      triggerHaptic(8);
      renderAll();
      openCellDetailModal(rowId, periodKey);
    }

    /* ---------- Allocation Modal (Touch-Ready Numeric Keypad & Steppers) ---------- */

    function openAllocationModal(preDept = '', preProj = '', prePeriod = '') {
      const db = getActiveDB();
      if (db.departments.length === 0 || db.projects.length === 0) {
        showToast('Please add at least one Department and one Project in Setup first.', 'warning');
        switchTab('data');
        return;
      }

      const sortedDepts = getSortedDepartments(db);
      const sortedProjs = getSortedProjects(db).filter(p => !p.archived || p.id === preProj);
      if (sortedProjs.length === 0) {
        showToast('All projects are archived. Restore or add a project in Setup first.', 'warning');
        switchTab('data');
        return;
      }
      const periods = getVisiblePeriods();
      const selDept = preDept || sortedDepts[0].id;
      const selProj = preProj || sortedProjs[0].id;
      const selPeriod = prePeriod || (shouldRenderMobileCards() ? getMobileSelectedPeriod() : periods[0]);
      const modalPeriods = periods.includes(selPeriod) ? periods : [selPeriod, ...periods];

      const existing = getAllocationForPeriod(selDept, selProj, selPeriod, ui.timeUnit, db.allocations);
      const dispVal = existing.hasData
        ? Math.round(fteToDisplayValue(existing.avgFte, selPeriod, ui.timeUnit) * 100) / 100
        : '';
      const existingComment = (db.comments && db.comments[getCommentKey(selDept, selProj, selPeriod)]) || '';
      const selProjObj = db.projects.find(p => p.id === selProj);
      const initIsAdmin = isNonFteProject(selProjObj);

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">${initIsAdmin ? 'Admin — Issues &amp; Meetings' : 'Allocate Manpower'}</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mAllocDept" class="block font-semibold text-slate-700 mb-1">Department</label>
              <select id="mAllocDept" onchange="onAllocModalContextChange()" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${sortedDepts.map(d => `<option value="${d.id}" ${d.id === selDept ? 'selected' : ''}>${escapeHtml(d.name)} [${escapeHtml(d.code)}]</option>`).join('')}
              </select>
            </div>
            <div>
              <div class="flex items-center justify-between mb-1">
                <label for="mAllocProj" class="block font-semibold text-slate-700">Project</label>
                <span id="mAllocProjCodeBadge" class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"></span>
              </div>
              <select id="mAllocProj" onchange="onAllocModalContextChange()" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${sortedProjs.map(p => `<option value="${p.id}" ${p.id === selProj ? 'selected' : ''}>${escapeHtml(formatProjectOptionLabel(p))}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mAllocPeriod" class="block font-semibold text-slate-700 mb-1">${ui.timeUnit === 'month' ? 'Month' : 'ISO Week'}</label>
              <select id="mAllocPeriod" onchange="onAllocModalContextChange()" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${modalPeriods.map(pk => `<option value="${pk}" ${pk === selPeriod ? 'selected' : ''}>${escapeHtml(formatPeriodHeader(pk, ui.timeUnit).title)} (${escapeHtml(formatPeriodHeader(pk, ui.timeUnit).dateRange || formatPeriodHeader(pk, ui.timeUnit).sub)})</option>`).join('')}
              </select>
            </div>
            <div id="mAllocFteFieldWrap" class="${initIsAdmin ? 'hidden' : ''}">
              <label for="mAllocValue" class="block font-semibold text-slate-700 mb-1">Allocation (${unitShortLabel()})</label>
              <div class="flex items-center gap-1.5">
                <button type="button" aria-label="Decrease allocation" onclick="stepAllocModalValue(-1)" title="Decrease allocation"
                  class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">&minus;</button>
                <input id="mAllocValue" type="number" inputmode="decimal" step="0.1" min="0" value="${dispVal}" placeholder="e.g. 1.5" oninput="refreshAllocModalPreview()"
                  class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-slate-900 text-center" />
                <button type="button" aria-label="Increase allocation" onclick="stepAllocModalValue(1)" title="Increase allocation"
                  class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">+</button>
              </div>
            </div>
            <div id="mAllocAdminBadgeWrap" class="${initIsAdmin ? 'flex' : 'hidden'} flex-col justify-end">
              <div class="px-3 py-2.5 sm:py-2 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 font-semibold text-[11px] leading-snug">
                <span class="font-extrabold text-sky-700 uppercase text-[10px]">Admin &middot; Non-FTE</span>
                <div class="mt-0.5">No FTE required &mdash; zero impact on utilisation or cost.</div>
              </div>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between gap-2 mb-1">
              <label id="mAllocCommentLabel" for="mAllocComment" class="block font-semibold text-slate-700">${initIsAdmin ? 'Expected Departmental Issues &amp; Requested Meetings (shown inside cell)' : 'Cell Comments / Notes (optional, shown inside cell)'}</label>
              <span class="text-[10px] text-slate-400 font-medium hidden sm:inline">Start a line with <code class="px-1 rounded bg-slate-100 font-mono">- </code> for bullets</span>
            </div>
            <textarea id="mAllocComment" data-bullet-notes="true" rows="${initIsAdmin ? '3' : '2'}" placeholder="${initIsAdmin ? 'List expected departmental issues, risks, or requested meetings... (start with "- " for bullets)' : 'Add context, blockers, or deliverables... (start with "- " for bullets)'}"
              class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs leading-relaxed">${escapeHtml(existingComment)}</textarea>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mAllocRepeat" class="block font-semibold text-slate-700 mb-1">Repeat across ${ui.timeUnit}s</label>
              <div class="inline-flex items-center gap-1.5">
                <button type="button" aria-label="Decrease repeat count" onclick="stepNumericInput('mAllocRepeat', -1, 1, 24, 0, syncAllocEndPeriodFromRepeat)"
                  class="w-10 h-10 sm:w-8 sm:h-8 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition">&minus;</button>
                <input id="mAllocRepeat" type="number" inputmode="numeric" min="1" max="24" value="1" oninput="syncAllocEndPeriodFromRepeat()" class="w-16 px-2 py-2 sm:py-1.5 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-center" />
                <button type="button" aria-label="Increase repeat count" onclick="stepNumericInput('mAllocRepeat', 1, 1, 24, 0, syncAllocEndPeriodFromRepeat)"
                  class="w-10 h-10 sm:w-8 sm:h-8 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition">+</button>
              </div>
            </div>
            <div>
              <label for="mAllocEndPeriod" class="block font-semibold text-slate-700 mb-1">Through ${ui.timeUnit === 'month' ? 'End Month' : 'End Week'}</label>
              <select id="mAllocEndPeriod" onchange="syncAllocRepeatFromEndPeriod()" class="w-full px-3 py-2.5 sm:py-1.5 rounded-xl border border-slate-200 bg-slate-50 font-medium"></select>
            </div>
          </div>

          <div id="mAllocConversionPreview" class="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-indigo-950 space-y-1"></div>

          <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <button id="mAllocDeleteBtn" type="button" onclick="deleteAllocationFromModal()" class="px-3 py-2.5 sm:py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold transition">${initIsAdmin ? 'Remove Note' : 'Remove'}</button>
            <div class="flex items-center gap-2">
              <button type="button" onclick="closeModal()" class="px-3.5 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold transition">Cancel</button>
              <button id="mAllocSaveBtn" type="button" onclick="saveAllocationModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">${initIsAdmin ? 'Save Admin Note' : 'Save'}</button>
            </div>
          </div>
        </div>`);

      rebuildAllocEndPeriodOptions();
      refreshAllocModalPreview();
    }

    function rebuildAllocEndPeriodOptions() {
      const startPk = document.getElementById('mAllocPeriod')?.value;
      const endSel = document.getElementById('mAllocEndPeriod');
      const repInput = document.getElementById('mAllocRepeat');
      if (!startPk || !endSel) return;
      const curRep = Math.max(1, Math.min(24, parseInt(repInput?.value, 10) || 1));
      const opts = [];
      let pk = startPk;
      for (let i = 1; i <= 24; i++) {
        const h = formatPeriodHeader(pk, ui.timeUnit);
        opts.push(`<option value="${i}" ${i === curRep ? 'selected' : ''}>${escapeHtml(h.title)}${i === 1 ? ' (single)' : ` (${i} ${ui.timeUnit}s)`}</option>`);
        pk = ui.timeUnit === 'month' ? addMonthsToMonthKey(pk, 1) : addWeeksToWeekKey(pk, 1);
      }
      endSel.innerHTML = opts.join('');
    }

    function syncAllocEndPeriodFromRepeat() {
      const repInput = document.getElementById('mAllocRepeat');
      const endSel = document.getElementById('mAllocEndPeriod');
      if (!repInput || !endSel) return;
      const n = Math.max(1, Math.min(24, parseInt(repInput.value, 10) || 1));
      endSel.value = String(n);
    }

    function syncAllocRepeatFromEndPeriod() {
      const repInput = document.getElementById('mAllocRepeat');
      const endSel = document.getElementById('mAllocEndPeriod');
      if (!repInput || !endSel) return;
      const n = Math.max(1, Math.min(24, parseInt(endSel.value, 10) || 1));
      repInput.value = String(n);
    }

    function stepAllocModalValue(dir) {
      const { step, decimals } = getManpowerStep(ui.manpowerUnit);
      stepNumericInput('mAllocValue', dir * step, 0, 10000, decimals, refreshAllocModalPreview);
    }

    function onAllocModalContextChange() {
      const db = getActiveDB();
      const deptId = document.getElementById('mAllocDept')?.value;
      const projId = document.getElementById('mAllocProj')?.value;
      const pk = document.getElementById('mAllocPeriod')?.value;
      const valInput = document.getElementById('mAllocValue');
      const cmtInput = document.getElementById('mAllocComment');

      if (deptId && projId && pk) {
        const existing = getAllocationForPeriod(deptId, projId, pk, ui.timeUnit, db.allocations);
        if (valInput) {
          valInput.value = existing.hasData
            ? Math.round(fteToDisplayValue(existing.avgFte, pk, ui.timeUnit) * 100) / 100
            : '';
        }
        if (cmtInput) {
          cmtInput.value = (db.comments && db.comments[getCommentKey(deptId, projId, pk)]) || '';
        }
      }
      rebuildAllocEndPeriodOptions();
      refreshAllocModalPreview();
    }

    function refreshAllocModalPreview() {
      const db = getActiveDB();
      const projId = document.getElementById('mAllocProj')?.value;
      const pk = document.getElementById('mAllocPeriod')?.value;
      const rawVal = parseFloat(document.getElementById('mAllocValue')?.value);
      const box = document.getElementById('mAllocConversionPreview');
      const codeBadge = document.getElementById('mAllocProjCodeBadge');

      const proj = db.projects.find(p => p.id === projId);
      const isAdminProj = isNonFteProject(proj);

      const titleEl = document.getElementById('modalTitle');
      const fteWrap = document.getElementById('mAllocFteFieldWrap');
      const adminWrap = document.getElementById('mAllocAdminBadgeWrap');
      const cmtLbl = document.getElementById('mAllocCommentLabel');
      const cmtEl = document.getElementById('mAllocComment');
      const delBtn = document.getElementById('mAllocDeleteBtn');
      const saveBtn = document.getElementById('mAllocSaveBtn');
      if (titleEl) titleEl.textContent = isAdminProj ? 'Admin — Issues & Meetings' : 'Allocate Manpower';
      if (fteWrap) fteWrap.classList.toggle('hidden', isAdminProj);
      if (adminWrap) {
        adminWrap.classList.toggle('hidden', !isAdminProj);
        adminWrap.classList.toggle('flex', isAdminProj);
      }
      if (cmtLbl) cmtLbl.textContent = isAdminProj ? 'Expected Departmental Issues & Requested Meetings (shown inside cell)' : 'Cell Comments / Notes (optional, shown inside cell)';
      if (cmtEl) cmtEl.placeholder = isAdminProj ? 'List expected departmental issues, risks, or requested meetings for this period...' : 'Add context, blockers, or key deliverables for this period...';
      if (delBtn) delBtn.textContent = isAdminProj ? 'Remove Note' : 'Remove';
      if (saveBtn) saveBtn.textContent = isAdminProj ? 'Save Admin Note' : 'Save';

      if (codeBadge && proj) {
        codeBadge.textContent = isAdminProj ? `Admin: ${proj.code}` : `Code: ${proj.code}`;
        codeBadge.classList.add('accent-card');
        codeBadge.style.setProperty('--accent-color', proj.color);
        codeBadge.style.setProperty('--accent-w', '3px');
        codeBadge.style.borderLeft = `3px solid ${proj.color}`;
      }
      if (!box || !pk) return;

      if (isAdminProj) {
        box.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2 font-semibold">
            <span>Admin (Non-FTE) Entry${proj ? ` (${escapeHtml(proj.code)})` : ''}:</span>
            <span class="font-mono text-sky-700">0 FTE &bull; Notes Only</span>
          </div>
          <div class="text-[11px] text-indigo-800/80">Appears directly in this department&rsquo;s cell(s) without affecting FTE utilisation %, bottlenecks, or project cost burn.</div>`;
        return;
      }

      const fte = isNaN(rawVal) ? 0 : displayValueToFte(rawVal, pk, ui.timeUnit, ui.manpowerUnit);
      const days = fteToDisplayValue(fte, pk, ui.timeUnit, 'days');
      const hours = fteToDisplayValue(fte, pk, ui.timeUnit, 'hours');
      const weeks = ui.timeUnit === 'month' ? getWeeksInMonth(pk) : [pk];
      const perWkDays = fteToDisplayValue(fte, weeks[0], 'week', 'days');

      box.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 font-semibold">
          <span>Auto-Conversion${proj ? ` (${escapeHtml(proj.code)})` : ''}:</span>
          <span class="font-mono text-indigo-700">${formatValue(fte, 'fte')} = ${formatValue(days, 'days')} = ${formatValue(hours, 'hours')}</span>
        </div>
        ${ui.timeUnit === 'month' ? `<div class="text-[11px] text-indigo-800/80">Pro-rata across <strong>${weeks.length} ISO weeks</strong> (${weeks.map(w => w.split('-')[1]).join(', ')}): <strong>${formatValue(fte, 'fte')}</strong> (${formatValue(perWkDays, 'days')}) per week.</div>` : ''}`;
    }

    function saveAllocationModal() {
      const db = getActiveDB();
      const deptId = document.getElementById('mAllocDept').value;
      const projId = document.getElementById('mAllocProj').value;
      const startPk = document.getElementById('mAllocPeriod').value;
      const rawVal = parseFloat(document.getElementById('mAllocValue').value);
      const commentTxt = document.getElementById('mAllocComment')?.value || '';
      const repeat = Math.max(1, Math.min(24, parseInt(document.getElementById('mAllocRepeat').value, 10) || 1));

      const proj = db.projects.find(p => p.id === projId);
      const dCode = db.departments.find(d => d.id === deptId)?.code || deptId;
      const pCode = proj?.code || projId;

      if (isNonFteProject(proj)) {
        const cleanNote = commentTxt.trim();
        if (!cleanNote) {
          showToast('Enter departmental issues or requested meetings, or click Remove Note.', 'warning');
          return;
        }
        pushUndoState(`Update Admin note [${dCode} -> ${pCode}]`);
        let curPk = startPk;
        for (let i = 0; i < repeat; i++) {
          setAllocationForPeriod(deptId, projId, curPk, ui.timeUnit, 0, db);
          setCellProjectComment(deptId, projId, curPk, cleanNote, db);
          curPk = ui.timeUnit === 'month' ? addMonthsToMonthKey(curPk, 1) : addWeeksToWeekKey(curPk, 1);
        }
        recordChange('Comment', `Updated Admin (Non-FTE) note [${dCode} -> ${pCode}] in ${startPk}${repeat > 1 ? ` (+${repeat - 1} more)` : ''}`);
        triggerHaptic(10);
        closeModal();
        renderAll();
        showToast('Admin note saved', 'success', { undoable: true });
        return;
      }

      if (isNaN(rawVal) || rawVal < 0) {
        showToast('Enter a valid non-negative allocation number.', 'warning');
        return;
      }

      pushUndoState(`Set [${dCode} -> ${pCode}]`);

      let curPk = startPk;
      for (let i = 0; i < repeat; i++) {
        const fte = displayValueToFte(rawVal, curPk, ui.timeUnit, ui.manpowerUnit);
        setAllocationForPeriod(deptId, projId, curPk, ui.timeUnit, fte, db);
        curPk = ui.timeUnit === 'month' ? addMonthsToMonthKey(curPk, 1) : addWeeksToWeekKey(curPk, 1);
      }

      setCellProjectComment(deptId, projId, startPk, commentTxt, db);

      recordChange('Allocation', `[${dCode} -> ${pCode}] set to ${formatValue(rawVal)} in ${startPk}${repeat > 1 ? ` (+${repeat - 1} more)` : ''}`);
      triggerHaptic(10);
      closeModal();
      renderAll();
      showToast('Allocation updated', 'success', { undoable: true });
    }

    function deleteAllocationFromModal() {
      const db = getActiveDB();
      const deptId = document.getElementById('mAllocDept').value;
      const projId = document.getElementById('mAllocProj').value;
      const pk = document.getElementById('mAllocPeriod').value;
      const proj = db.projects.find(p => p.id === projId);
      const dCode = db.departments.find(d => d.id === deptId)?.code || deptId;
      const pCode = proj?.code || projId;
      pushUndoState(`Remove [${dCode} -> ${pCode}]`);
      setAllocationForPeriod(deptId, projId, pk, ui.timeUnit, 0, db);
      if (isNonFteProject(proj)) {
        setCellProjectComment(deptId, projId, pk, '', db);
        recordChange('Comment', `Removed Admin (Non-FTE) note [${dCode} -> ${pCode}] in ${pk}`);
        triggerHaptic(10);
        closeModal();
        renderAll();
        showToast('Admin note removed', 'info', { undoable: true });
        return;
      }
      recordChange('Allocation', `Removed [${dCode} -> ${pCode}] allocation in ${pk}`);
      triggerHaptic(10);
      closeModal();
      renderAll();
      showToast('Allocation removed', 'info', { undoable: true });
    }

    /* ---------- Variable Capacity Modal (Single or Date Range with Start & End) ---------- */

    function collectPeriodKeysInRange(startPk, endPk, unit) {
      const keys = [];
      if (!startPk) return keys;
      const safeEnd = (!endPk || endPk < startPk) ? startPk : endPk;
      let cur = startPk;
      let guard = 0;
      while (cur <= safeEnd && guard < 60) {
        keys.push(cur);
        if (cur === safeEnd) break;
        cur = unit === 'month' ? addMonthsToMonthKey(cur, 1) : addWeeksToWeekKey(cur, 1);
        guard++;
      }
      return keys;
    }

    function buildPeriodEndSelectOptionsHtml(startPk, unit, selectedEndPk = startPk, maxSpan = 26) {
      const opts = [];
      let cur = startPk;
      const limit = Math.max(maxSpan, collectPeriodKeysInRange(startPk, selectedEndPk, unit).length);
      let matched = false;
      for (let i = 1; i <= Math.min(52, limit); i++) {
        const h = formatPeriodHeader(cur, unit);
        const isSel = cur === selectedEndPk;
        if (isSel) matched = true;
        const unitLbl = unit === 'month' ? (i === 1 ? '1 mo' : `${i} mos`) : (i === 1 ? '1 wk' : `${i} wks`);
        opts.push(`<option value="${cur}" ${isSel ? 'selected' : ''}>${escapeHtml(h.title)} (${escapeHtml(h.dateRange)}) &bull; ${unitLbl}</option>`);
        cur = unit === 'month' ? addMonthsToMonthKey(cur, 1) : addWeeksToWeekKey(cur, 1);
      }
      if (!matched && opts.length > 0) {
        opts[0] = opts[0].replace('<option ', '<option selected ');
      }
      return opts.join('');
    }

    function formatPeriodRangeSummaryText(startPk, endPk, unit) {
      const pks = collectPeriodKeysInRange(startPk, endPk, unit);
      if (pks.length === 0) return '';
      const allWks = [];
      pks.forEach(pk => {
        const wks = unit === 'month' ? getWeeksInMonth(pk) : [pk];
        wks.forEach(w => { if (!allWks.includes(w)) allWks.push(w); });
      });
      allWks.sort((a, b) => a.localeCompare(b));
      const firstWk = allWks[0];
      const lastWk = allWks[allWks.length - 1];
      const dateSpan = (firstWk && lastWk) ? formatWeekSpanDateRange(firstWk, lastWk) : '';
      const spanLbl = pks.length === 1 ? pks[0] : `${pks[0]} → ${pks[pks.length - 1]}`;
      return `${spanLbl} (${allWks.length} wk${allWks.length === 1 ? '' : 's'}${dateSpan ? ' · ' + dateSpan : ''})`;
    }

    function syncCapacityModalEndOptions(preferredEndPk = '') {
      const startEl = document.getElementById('mCapStart');
      const endEl = document.getElementById('mCapEnd');
      const unitEl = document.getElementById('mCapUnit');
      const sumEl = document.getElementById('mCapRangeSummary');
      if (!startEl || !endEl || !unitEl) return;
      const unit = unitEl.value === 'month' ? 'month' : 'week';
      const startPk = startEl.value;
      let targetEnd = preferredEndPk || endEl.value || startPk;
      if (targetEnd < startPk) targetEnd = startPk;
      endEl.innerHTML = buildPeriodEndSelectOptionsHtml(startPk, unit, targetEnd, 26);
      if (sumEl) {
        sumEl.textContent = formatPeriodRangeSummaryText(startPk, endEl.value, unit);
      }
    }

    function updateCapacityModalSummary() {
      const startEl = document.getElementById('mCapStart');
      const endEl = document.getElementById('mCapEnd');
      const unitEl = document.getElementById('mCapUnit');
      const sumEl = document.getElementById('mCapRangeSummary');
      if (!startEl || !endEl || !unitEl || !sumEl) return;
      const unit = unitEl.value === 'month' ? 'month' : 'week';
      sumEl.textContent = formatPeriodRangeSummaryText(startEl.value, endEl.value, unit);
    }

    function setCapacityModalUnit(nextUnit) {
      const deptId = document.getElementById('mCapDept')?.value;
      const curStart = document.getElementById('mCapStart')?.value || '';
      const curUnit = document.getElementById('mCapUnit')?.value === 'month' ? 'month' : 'week';
      if (!deptId || nextUnit === curUnit) return;
      let nextStart = curStart;
      if (nextUnit === 'week' && /^\d{4}-\d{2}$/.test(curStart)) {
        nextStart = getWeeksInMonth(curStart)[0] || ui.startWeek;
      } else if (nextUnit === 'month' && /^\d{4}-W\d{2}$/.test(curStart)) {
        nextStart = getWeekOwningMonth(curStart);
      }
      openCapacityModal(deptId, nextStart, { timeUnit: nextUnit });
    }

    function openCapacityModal(deptId, periodKey, opts = {}) {
      const db = getActiveDB();
      const dept = db.departments.find(d => d.id === deptId);
      if (!dept) return;

      let effectiveUnit = opts && opts.forceWeeks ? 'week' : ((opts && (opts.timeUnit === 'week' || opts.timeUnit === 'month')) ? opts.timeUnit : ui.timeUnit);
      let startPk = periodKey || (effectiveUnit === 'month' ? ui.startMonth : ui.startWeek);
      if (effectiveUnit === 'week' && /^\d{4}-\d{2}$/.test(startPk)) {
        startPk = getWeeksInMonth(startPk)[0] || ui.startWeek;
      } else if (effectiveUnit === 'month' && /^\d{4}-W\d{2}$/.test(startPk)) {
        effectiveUnit = 'week';
      }
      let endPk = opts && opts.endPeriod ? opts.endPeriod : startPk;
      if (endPk < startPk) endPk = startPk;

      const capObj = getDeptCapacityForPeriod(deptId, startPk, effectiveUnit, db);
      const startOpts = buildPeriodSelectOptions(startPk, effectiveUnit, 12, 36);
      const endOptsHtml = buildPeriodEndSelectOptionsHtml(startPk, effectiveUnit, endPk, 26);
      const summaryTxt = formatPeriodRangeSummaryText(startPk, endPk, effectiveUnit);

      const deptSpans = getGroupedCapacityOverrides(db, deptId);
      const existingOverridesHtml = deptSpans.length > 0
        ? `<div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
             <div class="flex items-center justify-between">
               <span class="font-bold text-slate-700">Active Overrides for ${escapeHtml(dept.name)} (${deptSpans.length})</span>
               <span class="text-[10px] text-slate-500">Base: ${dept.defaultCapacity} FTE</span>
             </div>
             <div class="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
               ${deptSpans.map(sp => {
                 const spanLbl = sp.startWk === sp.endWk ? sp.startWk : `${sp.startWk} → ${sp.endWk}`;
                 const dateSpan = formatWeekSpanDateRange(sp.startWk, sp.endWk);
                 const dSign = sp.deltaFte > 0 ? `+${sp.deltaFte}` : String(sp.deltaFte);
                 return `
                   <div class="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/80 text-[11px]">
                     <div class="min-w-0">
                       <span class="font-mono font-bold text-slate-800">${escapeHtml(spanLbl)}</span>
                       <span class="text-slate-400 ml-1">(${sp.weekKeys.length}w)</span>
                       <div class="text-[10px] text-slate-500">${escapeHtml(dateSpan)}</div>
                     </div>
                     <div class="flex items-center gap-1.5 shrink-0">
                       <span class="font-extrabold text-sky-700 tabular-nums">${sp.fte} FTE <span class="text-[10px] font-semibold text-slate-500">(${dSign})</span></span>
                       <button type="button" onclick="openCapacityModal('${deptId}', '${sp.startWk}', { forceWeeks: true, endPeriod: '${sp.endWk}' })"
                         class="px-1.5 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold text-[10px] transition">Edit</button>
                       <button type="button" onclick="resetCapacityOverrideSpan('${deptId}', '${sp.startWk}', '${sp.endWk}'); openCapacityModal('${deptId}', '${startPk}', { timeUnit: '${effectiveUnit}' });"
                         class="px-1.5 py-0.5 rounded bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-bold text-[10px] transition">Reset</button>
                     </div>
                   </div>`;
               }).join('')}
             </div>
           </div>`
        : '';

      const unitBtnCls = (active) => active
        ? 'px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-bold shadow-xs text-[11px] transition cursor-pointer'
        : 'px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 font-semibold text-[11px] transition cursor-pointer';

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Variable Capacity — ${escapeHtml(dept.name)}</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">Base capacity: <strong>${dept.defaultCapacity} FTE</strong>. Define exact start &amp; end range for hiring ramps, PTO dips, or contractors.</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none shrink-0">&times;</button>
          </div>

          <input type="hidden" id="mCapDept" value="${deptId}" />
          <input type="hidden" id="mCapUnit" value="${effectiveUnit}" />

          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-semibold text-slate-700">Override Granularity</span>
            <div class="inline-flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200" role="group" aria-label="Capacity override granularity">
              <button type="button" onclick="setCapacityModalUnit('week')" class="${unitBtnCls(effectiveUnit === 'week')}">ISO Weeks</button>
              <button type="button" onclick="setCapacityModalUnit('month')" class="${unitBtnCls(effectiveUnit === 'month')}">Months</button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mCapStart" class="block font-semibold text-slate-700 mb-1">Start ${effectiveUnit === 'month' ? 'Month' : 'ISO Week'}</label>
              <select id="mCapStart" onchange="syncCapacityModalEndOptions()" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${startOpts.map(o => `<option value="${o.key}" ${o.key === startPk ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="mCapEnd" class="block font-semibold text-slate-700 mb-1">End ${effectiveUnit === 'month' ? 'Month' : 'ISO Week'}</label>
              <select id="mCapEnd" onchange="updateCapacityModalSummary()" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${endOptsHtml}
              </select>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-[11px]">
            <span class="text-slate-500 font-semibold">Selected Span</span>
            <span id="mCapRangeSummary" class="font-mono font-bold text-slate-800">${escapeHtml(summaryTxt)}</span>
          </div>

          <div>
            <label for="mCapValue" class="block font-semibold text-slate-700 mb-1">Overridden Capacity (FTE Rate)</label>
            <div class="flex items-center gap-1.5">
              <button type="button" aria-label="Decrease capacity" onclick="stepNumericInput('mCapValue', -0.25, 0, 1000, 2)"
                class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">&minus;</button>
              <input id="mCapValue" type="number" inputmode="decimal" step="0.25" min="0" value="${Math.round(capObj.avgFte * 100) / 100}"
                class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
              <button type="button" aria-label="Increase capacity" onclick="stepNumericInput('mCapValue', 0.25, 0, 1000, 2)"
                class="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">+</button>
            </div>
          </div>

          ${existingOverridesHtml}

          <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-[11px]">
            <span>Need a company-wide holiday or shutdown dip across teams?</span>
            <button type="button" onclick="openPeriodCapacityModal(document.getElementById('mCapStart')?.value || '${startPk}', { timeUnit: document.getElementById('mCapUnit')?.value || '${effectiveUnit}', initialMode: 'holiday' })"
              class="px-2.5 py-1 rounded-lg bg-white border border-sky-200 hover:bg-sky-100 text-sky-700 font-bold transition shrink-0">Holiday % Tool</button>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="resetCapacityOverrideFromModal()" class="px-3 py-2.5 sm:py-2 rounded-xl text-amber-700 hover:bg-amber-50 font-semibold transition">Reset Range (${dept.defaultCapacity} FTE)</button>
            <div class="flex items-center gap-2">
              <button type="button" onclick="closeModal()" class="px-3.5 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
              <button type="button" onclick="saveCapacityModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Save Capacity</button>
            </div>
          </div>
        </div>`, 'max-w-xl');
    }

    function saveCapacityModal() {
      const db = getActiveDB();
      const deptId = document.getElementById('mCapDept').value;
      const unit = document.getElementById('mCapUnit')?.value === 'month' ? 'month' : 'week';
      const startPk = document.getElementById('mCapStart').value;
      const endPk = document.getElementById('mCapEnd').value || startPk;
      const val = parseFloat(document.getElementById('mCapValue').value);

      if (isNaN(val) || val < 0) { showToast('Enter a valid FTE capacity.', 'warning'); return; }

      const pks = collectPeriodKeysInRange(startPk, endPk, unit);
      if (pks.length === 0) { showToast('Select a valid start and end period.', 'warning'); return; }

      const dept = db.departments.find(d => d.id === deptId);
      pushUndoState(`Update ${dept?.name || deptId} capacity`);
      pks.forEach(pk => {
        const wks = unit === 'month' ? getWeeksInMonth(pk) : [pk];
        wks.forEach(wk => { db.capacityOverrides[`${deptId}::${wk}`] = val; });
      });

      const spanTxt = pks.length > 1 ? `${pks[0]} → ${pks[pks.length - 1]}` : pks[0];
      recordChange('Capacity', `${dept?.name || deptId} capacity set to ${val} FTE (${spanTxt})`);
      closeModal();
      renderAll();
      showToast(`Variable capacity updated (${pks.length} ${unit}${pks.length === 1 ? '' : 's'})`, 'success', { undoable: true });
    }

    function resetCapacityOverrideFromModal() {
      const db = getActiveDB();
      const deptId = document.getElementById('mCapDept').value;
      const unit = document.getElementById('mCapUnit')?.value === 'month' ? 'month' : 'week';
      const startPk = document.getElementById('mCapStart').value;
      const endPk = document.getElementById('mCapEnd').value || startPk;
      const pks = collectPeriodKeysInRange(startPk, endPk, unit);
      if (pks.length === 0) return;

      const dept = db.departments.find(d => d.id === deptId);
      pushUndoState(`Reset ${dept?.name || deptId} capacity`);
      pks.forEach(pk => {
        const wks = unit === 'month' ? getWeeksInMonth(pk) : [pk];
        wks.forEach(wk => { delete db.capacityOverrides[`${deptId}::${wk}`]; });
      });
      const spanTxt = pks.length > 1 ? `${pks[0]} → ${pks[pks.length - 1]}` : pks[0];
      recordChange('Capacity', `Reset ${dept?.name || deptId} capacity override (${spanTxt}) back to default`);
      closeModal();
      renderAll();
      showToast('Capacity reset to default', 'info', { undoable: true });
    }

    /* ---------- Department Modal & Cleanup ---------- */

    function openDeptModal(deptId = '') {
      const db = getActiveDB();
      const d = db.departments.find(x => x.id === deptId);
      const color = d ? d.color : PALETTE[db.departments.length % PALETTE.length];

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">${d ? 'Edit Department' : 'New Department'}</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          <input type="hidden" id="mDeptId" value="${d ? d.id : ''}" />
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">
              <label for="mDeptName" class="block font-semibold text-slate-700 mb-1">Department Name</label>
              <input id="mDeptName" type="text" value="${escapeHtml(d?.name || '')}" placeholder="e.g. Engineering" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
            </div>
            <div>
              <label for="mDeptCode" class="block font-semibold text-slate-700 mb-1">Short Code</label>
              <input id="mDeptCode" type="text" maxlength="6" value="${escapeHtml(d?.code || '')}" placeholder="ENG" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono uppercase font-bold" />
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label for="mDeptCap" class="block font-semibold text-slate-700 mb-1">Default Capacity (FTE)</label>
              <div class="flex items-center gap-1">
                <button type="button" aria-label="Decrease default capacity" onclick="stepNumericInput('mDeptCap', -0.5, 0, 1000, 2)"
                  class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">&minus;</button>
                <input id="mDeptCap" type="number" inputmode="decimal" step="0.5" min="0" value="${d ? d.defaultCapacity : 5}" class="w-full px-2 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-center" />
                <button type="button" aria-label="Increase default capacity" onclick="stepNumericInput('mDeptCap', 0.5, 0, 1000, 2)"
                  class="w-9 h-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-base transition shrink-0">+</button>
              </div>
            </div>
            <div>
              <label for="mDeptMgr" class="block font-semibold text-slate-700 mb-1">Manager / Lead</label>
              <input id="mDeptMgr" type="text" value="${escapeHtml(d?.manager || '')}" placeholder="Optional" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50" />
            </div>
            <div>
              <label for="mDeptColor" class="block font-semibold text-slate-700 mb-1">Accent Color</label>
              <input id="mDeptColor" type="color" value="${color}" class="w-full h-10 rounded-xl border border-slate-200 cursor-pointer" />
            </div>
          </div>
          ${typeof ppCanAccessFinance === 'function' && !ppCanAccessFinance() ? '' : `
          <div>
            <label for="mDeptDayRate" class="block font-semibold text-slate-700 mb-1">Blended Day Rate (${escapeHtml(getCurrencySymbol(db))}/day, optional)</label>
            <input id="mDeptDayRate" type="number" inputmode="decimal" min="0" step="25" value="${Number(d?.dayRate) > 0 ? d.dayRate : ''}" placeholder="Leave blank if cost tracking is not needed" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
          </div>`}
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button type="button" onclick="saveDeptModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Save Department</button>
          </div>
        </div>`);
    }

    function saveDeptModal() {
      const db = getActiveDB();
      const id = document.getElementById('mDeptId').value;
      const name = document.getElementById('mDeptName').value.trim();
      const code = (document.getElementById('mDeptCode').value.trim() || name.slice(0, 3)).toUpperCase();
      const defaultCapacity = Math.max(0, parseFloat(document.getElementById('mDeptCap').value) || 0);
      const manager = document.getElementById('mDeptMgr').value.trim();
      const color = document.getElementById('mDeptColor').value || '#4f46e5';
      const canFin = typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance();
      const existingDept = id ? db.departments.find(x => x.id === id) : null;
      const dayRate = canFin
        ? Math.max(0, parseFloat(document.getElementById('mDeptDayRate')?.value) || 0)
        : (Number(existingDept?.dayRate) || 0);

      if (!name) { showToast('Department name is required.', 'warning'); return; }

      pushUndoState(`${id ? 'Update' : 'Add'} department [${code}]`);
      if (id) {
        const d = db.departments.find(x => x.id === id);
        if (d) Object.assign(d, { name, code, defaultCapacity, manager, color, dayRate });
        recordChange('Department', `Updated department [${code}] ${name} (${defaultCapacity} FTE${canFin && dayRate > 0 ? `, ${getCurrencySymbol(db)}${dayRate}/d` : ''})`);
      } else {
        db.departments.push({ id: uid('d'), name, code, defaultCapacity, manager, color, dayRate });
        recordChange('Department', `Added department [${code}] ${name} (${defaultCapacity} FTE${canFin && dayRate > 0 ? `, ${getCurrencySymbol(db)}${dayRate}/d` : ''})`);
      }
      closeModal();
      renderAll();
      showToast('Department saved', 'success', { undoable: true });
    }

    function deleteDept(id) {
      const db = getActiveDB();
      const d = db.departments.find(x => x.id === id);
      if (!d) return;
      openConfirmModal('Delete Department', `Delete "${d.name}" and remove all its allocations, comments, and capacity overrides?`, 'Delete', () => {
        pushUndoState(`Delete department [${d.code}]`);
        db.departments = db.departments.filter(x => x.id !== id);
        Object.keys(db.allocations || {}).forEach(k => { if (k.startsWith(`${id}::`)) delete db.allocations[k]; });
        Object.keys(db.capacityOverrides || {}).forEach(k => { if (k.startsWith(`${id}::`)) delete db.capacityOverrides[k]; });
        Object.keys(db.comments || {}).forEach(k => { if (k.startsWith(`${id}::`)) delete db.comments[k]; });
        if (ui.filterDept === id) ui.filterDept = 'all';
        recordChange('Department', `Deleted department [${d.code}] ${d.name}`);
        renderAll();
        showToast('Department deleted', 'info', { undoable: true });
      });
    }

    /* ---------- Project Modal & Cleanup ---------- */

    function syncProjectModalCategory() {
      const cat = document.getElementById('mProjCategory')?.value || 'standard';
      const isAdmin = cat === 'admin';
      const budRow = document.getElementById('mProjBudgetRow');
      const admInfo = document.getElementById('mProjAdminInfo');
      if (budRow) budRow.classList.toggle('hidden', isAdmin);
      if (admInfo) admInfo.classList.toggle('hidden', !isAdmin);
    }

    function openProjectModal(projId = '') {
      const db = getActiveDB();
      const p = db.projects.find(x => x.id === projId);
      const color = p ? p.color : PALETTE[(db.projects.length + 2) % PALETTE.length];
      const curCategory = isNonFteProject(p) ? 'admin' : (p?.tentative ? 'tentative' : 'standard');
      const isAdmin = curCategory === 'admin';
      const canFin = typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance();

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">${p ? 'Edit Project' : 'New Project'}</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          <input type="hidden" id="mProjId" value="${p ? p.id : ''}" />
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="sm:col-span-2">
              <label for="mProjName" class="block font-semibold text-slate-700 mb-1">Project Name</label>
              <input id="mProjName" type="text" value="${escapeHtml(p?.name || '')}" placeholder="e.g. Project Nova or Dept Admin / Meetings" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
            </div>
            <div>
              <label for="mProjCode" class="block font-semibold text-slate-700 mb-1">Project Code</label>
              <input id="mProjCode" type="text" maxlength="8" value="${escapeHtml(p?.code || '')}" placeholder="NVA" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono uppercase font-bold" />
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label for="mProjCategory" class="block font-semibold text-slate-700 mb-1">Category</label>
              <select id="mProjCategory" onchange="syncProjectModalCategory()" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold">
                <option value="standard" ${curCategory === 'standard' ? 'selected' : ''}>Committed (FTE)</option>
                <option value="tentative" ${curCategory === 'tentative' ? 'selected' : ''}>Pipeline / Tentative</option>
                <option value="admin" ${curCategory === 'admin' ? 'selected' : ''}>Admin (Non-FTE)</option>
              </select>
            </div>
            <div>
              <label for="mProjStatus" class="block font-semibold text-slate-700 mb-1">Status</label>
              <select id="mProjStatus" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${['Active', 'Planned', 'At Risk', 'On Hold', 'Completed'].map(s => `<option ${p?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="mProjPriority" class="block font-semibold text-slate-700 mb-1">Priority</label>
              <select id="mProjPriority" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${['Critical', 'High', 'Medium', 'Low'].map(pr => `<option ${(p?.priority || 'Medium') === pr ? 'selected' : ''}>${pr}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="mProjAdminInfo" class="${isAdmin ? '' : 'hidden'} p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-[11px] leading-relaxed">
            <strong>Admin (Non-FTE) Category:</strong> Requires no FTE input and never affects department utilisation %, bottlenecks, or cost burn. Ideal for logging expected departmental issues, risks, and requested meetings inside each period.
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div class="sm:col-span-2">
              <label for="mProjOwner" class="block font-semibold text-slate-700 mb-1">Project Owner</label>
              <input id="mProjOwner" type="text" value="${escapeHtml(p?.owner || '')}" placeholder="Optional" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50" />
            </div>
            <div class="sm:col-span-2">
              <label for="mProjTechLead" class="block font-semibold text-slate-700 mb-1">Technical Lead</label>
              <input id="mProjTechLead" type="text" value="${escapeHtml(p?.techLead || '')}" placeholder="Optional" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50" />
            </div>
            <div>
              <label for="mProjColor" class="block font-semibold text-slate-700 mb-1">Color Tag</label>
              <input id="mProjColor" type="color" value="${color}" class="w-full h-10 rounded-xl border border-slate-200 cursor-pointer" />
            </div>
          </div>
          <div id="mProjBudgetRow" class="${isAdmin ? 'hidden' : ''} grid grid-cols-1 ${canFin ? 'sm:grid-cols-2' : ''} gap-3">
            <div>
              <label for="mProjBudget" class="block font-semibold text-slate-700 mb-1">Effort Budget (Person-Days, optional)</label>
              <input id="mProjBudget" type="number" inputmode="decimal" min="0" step="5" value="${Number(p?.budgetDays) > 0 ? p.budgetDays : ''}" placeholder="e.g. 120" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
            </div>
            ${canFin ? `
            <div>
              <label for="mProjBudgetCost" class="block font-semibold text-slate-700 mb-1">Cost Budget (${escapeHtml(getCurrencySymbol(db))}, optional)</label>
              <input id="mProjBudgetCost" type="number" inputmode="decimal" min="0" step="1000" value="${Number(p?.budgetCost) > 0 ? p.budgetCost : ''}" placeholder="e.g. 150000" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
            </div>` : ''}
          </div>
          <label class="inline-flex items-center gap-2 px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer select-none w-full">
            <input id="mProjArchived" type="checkbox" ${p?.archived ? 'checked' : ''} class="rounded text-indigo-600" />
            <span class="font-semibold text-slate-700">Archive (hide from active Roadmap)</span>
          </label>
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button type="button" onclick="saveProjectModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Save Project</button>
          </div>
        </div>`);
    }

    function saveProjectModal() {
      const db = getActiveDB();
      const id = document.getElementById('mProjId').value;
      const name = document.getElementById('mProjName').value.trim();
      const code = (document.getElementById('mProjCode').value.trim() || name.slice(0, 3)).toUpperCase();
      const categoryVal = document.getElementById('mProjCategory')?.value || 'standard';
      const nonFte = categoryVal === 'admin';
      const tentative = categoryVal === 'tentative';
      const category = nonFte ? 'admin' : (tentative ? 'tentative' : 'standard');
      const status = document.getElementById('mProjStatus').value;
      const priority = document.getElementById('mProjPriority').value;
      const owner = document.getElementById('mProjOwner').value.trim();
      const techLead = (document.getElementById('mProjTechLead')?.value || '').trim();
      const color = document.getElementById('mProjColor').value || '#4f46e5';
      const budgetDays = nonFte ? 0 : Math.max(0, parseFloat(document.getElementById('mProjBudget')?.value) || 0);
      const canFin = typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance();
      const existingProj = id ? db.projects.find(x => x.id === id) : null;
      const budgetCost = nonFte ? 0 : (canFin ? Math.max(0, parseFloat(document.getElementById('mProjBudgetCost')?.value) || 0) : (Number(existingProj?.budgetCost) || 0));
      const archived = Boolean(document.getElementById('mProjArchived')?.checked);

      if (!name) { showToast('Project name is required.', 'warning'); return; }

      pushUndoState(`${id ? 'Update' : 'Add'} project [${code}]`);
      if (id) {
        const p = db.projects.find(x => x.id === id);
        if (p) Object.assign(p, { name, code, status, priority, owner, techLead, color, budgetDays, budgetCost, tentative, nonFte, category, archived });
        if (nonFte) {
          Object.keys(db.allocations || {}).forEach(k => { if (k.split('::')[1] === id) delete db.allocations[k]; });
        }
        db.projects = getSortedProjects(db);
        if (archived && ui.filterProj === id) ui.filterProj = 'all';
        if (archived && ui.spotlightProjId === id) ui.spotlightProjId = '';
        recordChange('Project', `Updated project [${code}] ${name} (${status}${nonFte ? ', Admin Non-FTE' : tentative ? ', pipeline' : ''}${techLead ? `, TL: ${techLead}` : ''}${budgetDays > 0 ? `, budget ${budgetDays}d` : ''}${archived ? ', archived' : ''})`);
      } else {
        db.projects.push({ id: uid('p'), name, code, status, priority, owner, techLead, color, budgetDays, budgetCost, tentative, nonFte, category, archived });
        db.projects = getSortedProjects(db);
        recordChange('Project', `Added project [${code}] ${name}${nonFte ? ' (Admin Non-FTE)' : tentative ? ' (pipeline)' : ''}${techLead ? ` (TL: ${techLead})` : ''}${budgetDays > 0 ? ` (budget ${budgetDays}d)` : ''}`);
      }
      closeModal();
      renderAll();
      showToast('Project saved', 'success', { undoable: true });
    }

    function deleteProject(id) {
      const db = getActiveDB();
      const p = db.projects.find(x => x.id === id);
      if (!p) return;
      openConfirmModal('Delete Project', `Delete "[${p.code}] ${p.name}" along with its allocations, comments, and milestones?`, 'Delete', () => {
        pushUndoState(`Delete project [${p.code}]`);
        db.projects = db.projects.filter(x => x.id !== id);
        db.milestones = db.milestones.filter(m => m.projectId !== id);
        Object.keys(db.allocations || {}).forEach(k => { if (k.split('::')[1] === id) delete db.allocations[k]; });
        Object.keys(db.comments || {}).forEach(k => { if (k.split('::')[1] === id) delete db.comments[k]; });
        if (ui.filterProj === id) ui.filterProj = 'all';
        if (ui.spotlightProjId === id) ui.spotlightProjId = '';
        recordChange('Project', `Deleted project [${p.code}] ${p.name}`);
        renderAll();
        showToast('Project deleted', 'info', { undoable: true });
      });
    }

    /* ---------- Milestone Modal ---------- */

    function openMilestoneModal(msId = '', preProjId = '', preDate = '', preDeptId = '') {
      const db = getActiveDB();
      if (db.projects.length === 0) {
        showToast('Please add a Project first before creating milestones.', 'warning');
        return;
      }
      const sortedProjs = getSortedProjects(db);
      const sortedDepts = getSortedDepartments(db);
      const ms = db.milestones.find(x => x.id === msId);
      const todayISO = new Date().toISOString().slice(0, 10);
      const selProj = ms ? ms.projectId : (preProjId || sortedProjs[0].id);
      const selDept = ms ? (ms.deptId || '') : preDeptId;
      const targetDate = ms ? ms.date : (preDate || todayISO);
      const baseDate = ms ? (ms.baselineDate || ms.date) : targetDate;

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">${ms ? 'Edit Milestone' : 'New Milestone'}</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          <input type="hidden" id="mMsId" value="${ms ? ms.id : ''}" />
          <div>
            <label for="mMsTitle" class="block font-semibold text-slate-700 mb-1">Milestone Title</label>
            <input id="mMsTitle" type="text" value="${escapeHtml(ms?.title || '')}" placeholder="e.g. Beta Launch" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mMsProj" class="block font-semibold text-slate-700 mb-1">Project</label>
              <select id="mMsProj" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${sortedProjs.map(p => `<option value="${p.id}" ${p.id === selProj ? 'selected' : ''}>${escapeHtml(formatProjectOptionLabel(p))}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="mMsDept" class="block font-semibold text-slate-700 mb-1">Owning Department (Optional)</label>
              <select id="mMsDept" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                <option value="">Auto (Active Depts)</option>
                ${sortedDepts.map(d => `<option value="${d.id}" ${d.id === selDept ? 'selected' : ''}>${escapeHtml(d.name)} [${escapeHtml(d.code)}]</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div class="flex items-center justify-between mb-1">
                <label for="mMsDate" class="block font-semibold text-slate-700">Target Date</label>
                <div class="inline-flex items-center gap-1 text-[10px]">
                  <button type="button" onclick="stepDateInput('mMsDate', -7)" title="Move earlier by 1 week" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition">&minus;1w</button>
                  <button type="button" onclick="stepDateInput('mMsDate', 7)" title="Move later by 1 week" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition">+1w</button>
                </div>
              </div>
              <input id="mMsDate" type="date" value="${targetDate}" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono" />
            </div>
            <div>
              <label for="mMsBase" class="block font-semibold text-slate-700 mb-1">Baseline Date</label>
              <input id="mMsBase" type="date" value="${baseDate}" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-mono" />
            </div>
            <div>
              <label for="mMsStatus" class="block font-semibold text-slate-700 mb-1">Status</label>
              <select id="mMsStatus" class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${['Pending', 'In Progress', 'At Risk', 'Completed'].map(st => `<option ${(ms?.status || 'Pending') === st ? 'selected' : ''}>${st}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label for="mMsNotes" class="block font-semibold text-slate-700 mb-1">Notes</label>
            <input id="mMsNotes" type="text" value="${escapeHtml(ms?.notes || '')}" placeholder="Dependencies or drift reason..." class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50" />
          </div>
          <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
            ${ms ? `<button type="button" onclick="deleteMilestoneFromModal('${ms.id}')" class="px-3 py-2.5 sm:py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold">Delete</button>` : '<span></span>'}
            <div class="flex items-center gap-2">
              <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
              <button type="button" onclick="saveMilestoneModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Save Milestone</button>
            </div>
          </div>
        </div>`);
    }

    function saveMilestoneModal() {
      const db = getActiveDB();
      const id = document.getElementById('mMsId').value;
      const title = document.getElementById('mMsTitle').value.trim();
      const projectId = document.getElementById('mMsProj').value;
      const deptId = document.getElementById('mMsDept').value;
      const date = document.getElementById('mMsDate').value;
      const baselineDate = document.getElementById('mMsBase').value || date;
      const status = document.getElementById('mMsStatus').value;
      const notes = document.getElementById('mMsNotes').value.trim();

      if (!title || !date) { showToast('Title and target date are required.', 'warning'); return; }

      pushUndoState(`${id ? 'Update' : 'Add'} milestone "${title}"`);
      if (id) {
        const ms = db.milestones.find(x => x.id === id);
        if (ms) Object.assign(ms, { title, projectId, deptId, date, baselineDate, status, notes });
        recordChange('Milestone', `Updated milestone "${title}" (${date}, ${status})`);
      } else {
        db.milestones.push({ id: uid('ms'), title, projectId, deptId, date, baselineDate, status, notes });
        recordChange('Milestone', `Added milestone "${title}" (${date})`);
      }
      closeModal();
      renderAll();
      showToast('Milestone saved', 'success', { undoable: true });
    }

    function deleteMilestoneFromModal(id) {
      const db = getActiveDB();
      const ms = db.milestones.find(x => x.id === id);
      if (!ms) return;
      pushUndoState(`Delete milestone "${ms.title}"`);
      db.milestones = db.milestones.filter(x => x.id !== id);
      recordChange('Milestone', `Deleted milestone "${ms.title}"`);
      closeModal();
      renderAll();
      showToast('Milestone deleted', 'info', { undoable: true });
    }

    /* ---------- Snapshot Modal & Actions ---------- */

    function openSnapshotModal() {
      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">Save Baseline Snapshot</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          <div>
            <label for="mSnapName" class="block font-semibold text-slate-700 mb-1">Snapshot Name</label>
            <input id="mSnapName" type="text" placeholder="e.g. Q4 Steering Committee Plan" value="Plan Snapshot (${new Date().toISOString().slice(0, 10)})"
              class="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
          </div>
          <div>
            <label for="mSnapNotes" class="block font-semibold text-slate-700 mb-1">Notes (Optional)</label>
            <textarea id="mSnapNotes" rows="2" placeholder="Key assumptions or context..." class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"></textarea>
          </div>
          <label class="inline-flex items-center gap-2 cursor-pointer py-1">
            <input id="mSnapPinned" type="checkbox" class="rounded text-amber-600" />
            <span class="font-semibold text-slate-700">📌 Pin as protected baseline (exempt from rolling max-snapshots eviction)</span>
          </label>
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold">Cancel</button>
            <button type="button" onclick="saveSnapshotModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Save Snapshot</button>
          </div>
        </div>`);
    }

    function saveSnapshotModal() {
      const db = getActiveDB();
      const name = document.getElementById('mSnapName').value.trim();
      const notes = document.getElementById('mSnapNotes').value.trim();
      const pinned = Boolean(document.getElementById('mSnapPinned')?.checked);
      if (!name) { showToast('Snapshot name is required.', 'warning'); return; }

      const snap = {
        id: uid('snap'),
        name,
        notes,
        pinned,
        createdAt: new Date().toISOString(),
        createdBy: ui.userName || 'Project Mgr',
        data: {
          allocations: JSON.parse(JSON.stringify(db.allocations)),
          capacityOverrides: JSON.parse(JSON.stringify(db.capacityOverrides)),
          comments: JSON.parse(JSON.stringify(db.comments || {})),
          milestones: JSON.parse(JSON.stringify(db.milestones)),
        }
      };
      db.snapshots.unshift(snap);
      ui.compareSnapshotId = snap.id;
      ui.compareTargetId = '__CURRENT__';
      recordChange('Snapshot', `Saved ${pinned ? 'pinned ' : ''}snapshot "${name}"`);
      closeModal();
      renderAll();
      showToast(`Snapshot "${name}" saved`, 'success');
    }

    function restoreSnapshot(id) {
      const db = getActiveDB();
      const snap = db.snapshots.find(s => s.id === id);
      if (!snap) return;
      openConfirmModal('Restore Snapshot', `Restore allocations, variable capacities, comments, and milestones from "${snap.name}"? Current unsaved changes will be replaced.`, 'Restore', () => {
        pushUndoState(`Restore snapshot "${snap.name}"`);
        db.allocations = JSON.parse(JSON.stringify(snap.data.allocations || {}));
        db.capacityOverrides = JSON.parse(JSON.stringify(snap.data.capacityOverrides || {}));
        db.comments = JSON.parse(JSON.stringify(snap.data.comments || {}));
        db.milestones = JSON.parse(JSON.stringify(snap.data.milestones || []));
        recordChange('Snapshot', `Restored roadmap state from snapshot "${snap.name}"`);
        renderAll();
        showToast(`Restored "${snap.name}"`, 'success', { undoable: true });
      });
    }

    function deleteSnapshot(id) {
      const db = getActiveDB();
      const snap = db.snapshots.find(s => s.id === id);
      if (!snap) return;
      db.snapshots = db.snapshots.filter(s => s.id !== id);
      if (ui.compareSnapshotId === id) ui.compareSnapshotId = '';
      if (ui.compareTargetId === id) ui.compareTargetId = '__CURRENT__';
      touchDBAndSave();
      renderAll();
      showToast('Snapshot deleted', 'info');
    }

    function confirmClearCurrentData() {
      const modeName = ui.demoMode ? 'Demo Sandbox' : 'Live Company Database';
      openConfirmModal(`Clear ${modeName}`, `This will erase all departments, projects, allocations, milestones, and snapshots in the ${modeName}.`, 'Clear Database', () => {
        clearUndoHistory();
        if (ui.demoMode) demoDB = createEmptyDB();
        else liveDB = createEmptyDB();
        touchDBAndSave();
        renderAll();
        showToast(`${modeName} cleared`, 'info');
      });
    }

    function resetDemoData() {
      clearUndoHistory();
      demoDB = createSampleDemoDB();
      safeSetStorage(STORAGE_KEYS.DEMO_DB, JSON.stringify(demoDB));
      renderAll();
      showToast('Demo sample data reset', 'success');
    }

    /* ---------- First-Use Welcome & Setup Splash Screen + PWA Install Guide ---------- */

    function openWelcomeModal(isAutoFirstRun = false) {
      const hasLiveData = Boolean(liveDB && ((liveDB.departments || []).length > 0 || (liveDB.projects || []).length > 0));
      const liveSummary = hasLiveData
        ? `${liveDB.departments.length} dept${liveDB.departments.length === 1 ? '' : 's'} &bull; ${liveDB.projects.length} proj${liveDB.projects.length === 1 ? '' : 's'} ready`
        : 'Start adding teams &amp; projects';
      const installed = typeof isPwaInstalled === 'function' ? isPwaInstalled() : false;
      const canNativeInstall = Boolean(deferredPwaPrompt) && !installed;
      const checkedAttr = (isAutoFirstRun || ui.welcomeSeen) ? 'checked' : '';
      const hasFs = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

      showModal(`
        <div class="p-5 sm:p-6 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>

          <!-- Greeting Hero Header -->
          <div class="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-md shrink-0" aria-hidden="true">
                <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 13h3l2.5-7 4 14 3-9 2 2H21" />
                </svg>
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 id="modalTitle" class="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">Welcome to PulsePlan</h3>
                  <span class="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">100% Offline &amp; Private</span>
                </div>
                <p class="text-[11px] sm:text-xs text-slate-500 mt-0.5">Company Roadmap, Capacity &amp; Utilisation Planner — all data stays on your device or your shared JSON file.</p>
              </div>
            </div>
            <button type="button" aria-label="Close welcome dialog" onclick="dismissWelcomeModal()"
              class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none shrink-0">&times;</button>
          </div>

          <!-- Step 1: Identify Yourself -->
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div class="min-w-0">
              <label for="welcomeUserNameInput" class="block font-bold text-slate-800">1. Your Display Name</label>
              <p class="text-[11px] text-slate-500">Used to stamp snapshots, backups, and the team change log.</p>
            </div>
            <input id="welcomeUserNameInput" type="text" maxlength="40" value="${escapeHtml(ui.userName || 'Project Mgr')}" placeholder="e.g. Marco Rossi"
              class="w-full sm:w-52 px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-slate-800 shrink-0" />
          </div>

          <!-- Step 2: Quick-Start Paths -->
          <div class="space-y-2">
            <div class="font-bold text-slate-800">2. Choose How You Want to Start</div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button type="button" onclick="welcomeQuickAction('setup')"
                class="text-left p-3 rounded-xl border border-slate-200 bg-white hover:border-indigo-400 hover:bg-indigo-50/50 transition space-y-1.5 cursor-pointer">
                <div class="flex items-center justify-between gap-1">
                  <span class="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 font-extrabold flex items-center justify-center text-sm" aria-hidden="true">+</span>
                  <span class="text-[10px] font-bold text-indigo-600">Setup &rarr;</span>
                </div>
                <div class="font-bold text-slate-900">Build Your Roadmap</div>
                <p class="text-[11px] text-slate-500 leading-snug">Add departments, FTE capacities, and projects in Setup &amp; Data.</p>
                <div class="text-[10px] font-semibold text-slate-400 pt-0.5">${liveSummary}</div>
              </button>

              <button type="button" onclick="welcomeQuickAction('demo')"
                class="text-left p-3 rounded-xl border border-amber-200 bg-amber-50/50 hover:border-amber-400 hover:bg-amber-50 transition space-y-1.5 cursor-pointer">
                <div class="flex items-center justify-between gap-1">
                  <span class="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 font-extrabold flex items-center justify-center text-sm" aria-hidden="true">&#9733;</span>
                  <span class="text-[10px] font-bold text-amber-700">${ui.demoMode ? 'Active' : 'Try Demo'} &rarr;</span>
                </div>
                <div class="font-bold text-slate-900">Explore Demo Sandbox</div>
                <p class="text-[11px] text-slate-600 leading-snug">Test allocations, Timeline Gantt, and bottlenecks with isolated sample data.</p>
                <div class="text-[10px] font-semibold text-amber-700 pt-0.5">Never touches Live DB</div>
              </button>

              <div class="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-1.5 flex flex-col justify-between">
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between gap-1">
                    <span class="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 font-extrabold flex items-center justify-center text-sm" aria-hidden="true">&#8644;</span>
                    <span class="text-[10px] font-bold text-emerald-700">Team Sync</span>
                  </div>
                  <div class="font-bold text-slate-900">Load Shared Database</div>
                  <p class="text-[11px] text-slate-600 leading-snug">Open a <code class="font-mono">.json</code> file from OneDrive, Google Drive, or SharePoint.</p>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 pt-1">
                  ${hasFs
                    ? `<button type="button" onclick="welcomeQuickAction('openFile')" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition cursor-pointer">Open &amp; Link</button>`
                    : ''}
                  <button type="button" onclick="welcomeQuickAction('importJson')" class="px-2.5 py-1 rounded-lg bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-800 text-[10px] font-bold transition cursor-pointer">Import JSON</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Step 3: Key Capabilities & Tips -->
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div class="font-bold text-slate-800">3. Quick Tips to Get the Most Out of PulsePlan</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600">
              <div class="flex items-start gap-2">
                <span class="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-mono font-bold text-[10px] shrink-0">1-24</span>
                <span><strong>Standard (1&ndash;6) &amp; Overview (12/18/24):</strong> Edit full cards up to 6 periods, or zoom out to 12&ndash;24 for multi-quarter scans. Use <strong>&laquo; / &raquo;</strong> (<code class="font-mono">Shift+&larr;/&rarr;</code>) to jump by interval.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-mono font-bold text-[10px] shrink-0">VIEW</span>
                <span><strong>3 Views + Row Labels:</strong> Switch between <strong>By Dept</strong>, <strong>By Project</strong>, and <strong>Timeline / Gantt</strong>, and toggle <strong>Vertical</strong> (compact) vs <strong>Detailed</strong> (rich metrics) row labels.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-mono font-bold text-[10px] shrink-0">SIM</span>
                <span><strong>What-If &amp; Snapshots:</strong> Clone Live DB into a safe What-If sandbox before committing, or save baseline snapshots to track scope drift in Health &amp; Evolution.</span>
              </div>
              <div class="flex items-start gap-2">
                <span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-mono font-bold text-[10px] shrink-0">APP</span>
                <span><strong>Install Offline App:</strong> Click your <strong>user name / initials (top-right) &rarr; Appearance &amp; Help &rarr; Install App</strong> (or the top-bar <strong>Install</strong> button when shown). You can also reopen this guide there anytime.</span>
              </div>
            </div>
          </div>

          <!-- Footer Controls -->
          <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <label class="inline-flex items-center gap-2 cursor-pointer text-[11px] text-slate-600 font-medium">
              <input id="welcomeDontShowAgain" type="checkbox" ${checkedAttr} class="rounded text-indigo-600" />
              <span>Don&rsquo;t show automatically on startup</span>
            </label>
            <div class="flex flex-wrap items-center gap-2 ml-auto">
              ${!installed ? `<button type="button" onclick="welcomeQuickAction('install')"
                class="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold transition cursor-pointer">${canNativeInstall ? 'Install App' : 'Install Guide'}</button>` : ''}
              <button type="button" onclick="welcomeQuickAction('manual')"
                class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer">User Manual</button>
              <button type="button" onclick="dismissWelcomeModal()"
                class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs transition cursor-pointer">Get Started</button>
            </div>
          </div>
        </div>`, 'max-w-2xl');
    }

    function dismissWelcomeModal() {
      const nameInp = document.getElementById('welcomeUserNameInput');
      if (nameInp) {
        const nextName = nameInp.value.trim();
        if (nextName && nextName !== ui.userName) {
          setActiveUserName(nextName, false);
        }
      }
      const chk = document.getElementById('welcomeDontShowAgain');
      ui.welcomeSeen = chk ? Boolean(chk.checked) : true;
      persistUIPrefs();
      closeModal();
      renderAll();
    }

    function welcomeQuickAction(action) {
      const nameInp = document.getElementById('welcomeUserNameInput');
      if (nameInp) {
        const nextName = nameInp.value.trim();
        if (nextName && nextName !== ui.userName) {
          setActiveUserName(nextName, false);
        }
      }
      const chk = document.getElementById('welcomeDontShowAgain');
      ui.welcomeSeen = chk ? Boolean(chk.checked) : true;
      persistUIPrefs();
      closeModal();

      if (action === 'setup') {
        if (ui.demoMode) ui.demoMode = false;
        switchTab('data');
      } else if (action === 'demo') {
        if (!ui.demoMode) toggleDemoMode();
        else switchTab('matrix');
      } else if (action === 'openFile') {
        if (ui.demoMode) ui.demoMode = false;
        switchTab('sync');
        setTimeout(() => openSharedDatabaseFile(), 80);
      } else if (action === 'importJson') {
        if (ui.demoMode) ui.demoMode = false;
        switchTab('sync');
        setTimeout(() => triggerJsonImportPicker(), 80);
      } else if (action === 'manual') {
        renderAll();
        setTimeout(() => openManualModal(), 40);
      } else if (action === 'install') {
        renderAll();
        setTimeout(() => promptPwaInstall(), 40);
      } else {
        renderAll();
      }
    }

    function openPwaInstallHelpModal() {
      const installed = typeof isPwaInstalled === 'function' ? isPwaInstalled() : false;
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
      const isIOS = /iPad|iPhone|iPod/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isAndroid = /Android/i.test(ua);
      const isLocalFile = typeof location !== 'undefined' && location.protocol === 'file:';

      let bodyHtml = '';
      if (installed) {
        bodyHtml = `
          <div class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1">
            <div class="font-bold">PulsePlan is already installed on this device!</div>
            <p class="text-[11px] leading-relaxed">You are running PulsePlan in standalone app mode with offline support enabled.</p>
          </div>`;
      } else if (isLocalFile) {
        bodyHtml = `
          <div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5">
            <div class="font-bold">Open over HTTPS to install as an app</div>
            <p class="text-[11px] leading-relaxed">You are opening a local <code class="font-mono">file://</code> copy. Browsers only allow Progressive Web App installation when loaded over <strong>HTTPS</strong> (e.g. your GitHub Pages URL).</p>
          </div>`;
      } else if (isIOS) {
        bodyHtml = `
          <div class="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 space-y-2">
            <div class="font-bold">Install on iPhone / iPad (Safari)</div>
            <ol class="list-decimal pl-4 space-y-1 text-[11px] leading-relaxed">
              <li>Tap the <strong>Share</strong> icon in Safari&rsquo;s toolbar (square with upward arrow).</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> in the top-right corner to launch PulsePlan full-screen offline.</li>
            </ol>
          </div>`;
      } else if (isAndroid) {
        bodyHtml = `
          <div class="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 space-y-2">
            <div class="font-bold">Install on Android (Chrome / Edge)</div>
            <p class="text-[11px] leading-relaxed">For 1-tap install whenever Chrome/Edge enables it, click your <strong>user name / initials (top-right) &rarr; Appearance &amp; Help &rarr; Install App</strong> (or tap <strong>Install</strong> in the header).</p>
            <div class="text-[11px] font-bold pt-0.5">If the 1-tap prompt isn&rsquo;t ready yet (e.g. first load or previously dismissed):</div>
            <ol class="list-decimal pl-4 space-y-1 text-[11px] leading-relaxed">
              <li>Tap the browser menu <strong>(&#8942;)</strong> in the top-right corner.</li>
              <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen &rarr; Install</strong>).</li>
              <li>Confirm <strong>Install</strong> &mdash; PulsePlan will appear in your app drawer as a genuine standalone app.</li>
            </ol>
          </div>`;
      } else {
        bodyHtml = `
          <div class="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 space-y-2">
            <div class="font-bold">Install on Desktop (Chrome / Edge)</div>
            <p class="text-[11px] leading-relaxed">Whenever Chrome/Edge enables 1-click install, click your <strong>user name / initials (top-right) &rarr; Appearance &amp; Help &rarr; Install App</strong> (or the <strong>Install</strong> button in the header).</p>
            <div class="text-[11px] font-bold pt-0.5">If the 1-click prompt isn&rsquo;t available right now (first visit before reload, already installed, or dismissed):</div>
            <ol class="list-decimal pl-4 space-y-1 text-[11px] leading-relaxed">
              <li>Look for the <strong>Install PulsePlan</strong> icon on the right side of the browser address bar, or open the browser menu <strong>(&#8942;) &rarr; Cast, save, and share &rarr; Install page as app</strong>.</li>
              <li>Click <strong>Install</strong> to pin PulsePlan to your taskbar/dock with full offline support.</li>
            </ol>
            <p class="text-[10px] text-indigo-800/80">Note: Firefox and Safari on desktop do not expose the native 1-click install prompt; use Chrome or Edge for full PWA + Shared File Sync support.</p>
          </div>`;
      }

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between gap-2">
            <h3 id="modalTitle" class="text-base font-bold text-slate-900">Install PulsePlan App (PWA)</h3>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none">&times;</button>
          </div>
          ${bodyHtml}
          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold">Got It</button>
          </div>
        </div>`, 'max-w-md');
    }


