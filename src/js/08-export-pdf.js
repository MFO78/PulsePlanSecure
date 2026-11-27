    /* ============================================================================
     * 9. UNIVERSAL EXPORT / IMPORT (WEB SHARE API + COLORFUL ZERO-OVERFLOW PDF)
     * ============================================================================ */

    async function downloadJsonBackup() {
      const db = getActiveDB();
      if (getRetentionSettings(db).autoPruneOnSave) {
        enforceRollingHistory(db);
      }
      const includeSnaps = document.getElementById('chkExportIncludeSnapshots')?.checked ?? true;
      const exportPayload = includeSnaps ? db : { ...db, snapshots: [] };

      const hasEncKey = !ui.demoMode && typeof ppSyncPassphrase === 'string' && ppSyncPassphrase.length >= 8 && typeof encryptPulsePlanData === 'function';
      let jsonStr = '';
      let fname = `pulseplan_${ui.demoMode ? 'demo' : 'live'}_${new Date().toISOString().slice(0, 10)}.json`;
      if (hasEncKey) {
        if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
        const envelope = await encryptPulsePlanData(JSON.parse(JSON.stringify(exportPayload)), ppSyncPassphrase);
        jsonStr = JSON.stringify(envelope, null, 2);
        fname = `pulseplan_encrypted_${new Date().toISOString().slice(0, 10)}.json`;
      } else {
        jsonStr = JSON.stringify(exportPayload, null, 2);
      }

      const outcome = await shareOrDownloadFile(new Blob([jsonStr], { type: 'application/json' }), fname, 'application/json', hasEncKey ? 'PulsePlan Encrypted Roadmap Database' : 'PulsePlan Roadmap Database');
      if (outcome === 'cancelled') return;

      recordDumpEvent(
        'JSON',
        fname,
        jsonStr.length,
        `${hasEncKey ? 'AES-256-GCM · ' : ''}${db.departments.length} depts, ${db.projects.length} projs${includeSnaps ? `, ${db.snapshots.length} snaps` : ' (no snaps)'}`
      );
      showToast(`${outcome === 'shared' ? 'JSON shared' : 'JSON saved'}${hasEncKey ? ' (AES-256-GCM)' : ''} (${formatBytes(jsonStr.length)})`, 'success');
    }

    function triggerJsonImportPicker() {
      const inp = document.getElementById('importJsonFileInput');
      ppDebug('INFO', 'triggerJsonImportPicker clicked', { inputFound: Boolean(inp), activeTab: ui.activeTab });
      if (!inp) {
        showToast('Import JSON input control was not found. Reload the page and retry.', 'error');
        return;
      }
      try {
        inp.value = '';
        inp.click();
      } catch (e) {
        ppDebug('ERROR', 'triggerJsonImportPicker click failed', { name: e?.name, message: e?.message });
        showToast(`Could not open file chooser (${e?.message || 'Error'}).`, 'error');
      }
    }

    function importJsonFile(event) {
      const file = event && event.target && event.target.files ? event.target.files[0] : null;
      ppDebug('INFO', 'importJsonFile change event fired', {
        hasFile: Boolean(file),
        name: file?.name || null,
        size: file?.size ?? null,
        type: file?.type || null,
      });
      if (!file) return;
      const wasLocked = typeof ppIsSessionLocked === 'function' && ppIsSessionLocked();
      if (!wasLocked && !ui.demoMode && linkedFileHandle && typeof ppHasAdminAccess === 'function' && !ppHasAdminAccess()) {
        showToast('Only an Administrator can overwrite a connected shared database via Import JSON.', 'warning');
        return;
      }
      const t0 = Date.now();
      const reader = new FileReader();
      reader.onabort = () => {
        ppDebug('WARN', 'JSON FileReader aborted', { name: file.name, elapsedMs: Date.now() - t0 });
        showToast(`Reading "${file.name}" was cancelled/aborted.`, 'warning');
      };
      reader.onerror = () => {
        ppDebug('ERROR', 'JSON FileReader error', { name: file.name, errName: reader.error?.name, message: reader.error?.message });
        showToast(`Could not read "${file.name}" (${reader.error?.message || 'file read error'}).`, 'error');
      };
      reader.onload = async () => {
        let migrated = null;
        let isEncryptedImport = false;
        try {
          let rawText = String(reader.result || '').replace(/^\uFEFF/, '');
          ppDebug('INFO', 'JSON FileReader onload', { name: file.name, chars: rawText.length, elapsedMs: Date.now() - t0 });
          if (!rawText.trim()) {
            throw new Error('File is empty (0 bytes — if on OneDrive/Google Drive, ensure it is downloaded offline)');
          }
          if (typeof PP_ENC_FORMAT === 'string' && rawText.includes(PP_ENC_FORMAT)) {
            isEncryptedImport = true;
          }
          if (isEncryptedImport && ui.demoMode) {
            showToast('Exit Demo Mode first before importing an encrypted database.', 'warning');
            return;
          }
          if (typeof ppResolveEncryptedJsonText === 'function') {
            rawText = await ppResolveEncryptedJsonText(rawText, { fileName: file.name, isSilentAutoReload: false });
          }
          const parsed = JSON.parse(rawText);
          migrated = normalizeAndMigrateDB(parsed);
          if (!migrated) {
            ppDebug('ERROR', 'JSON import invalid structure (missing departments/projects)', { name: file.name });
            showToast('Invalid PulsePlan JSON structure — missing departments/projects.', 'error');
            return;
          }
          ppDebug('INFO', 'JSON import migrated', {
            depts: migrated.departments.length,
            projs: migrated.projects.length,
            allocs: Object.keys(migrated.allocations || {}).length,
          });
        } catch (e) {
          ppDebug('ERROR', 'JSON import parse error', { name: file.name, errName: e?.name, message: e?.message });
          showToast(`Could not open "${file.name}": ${e?.message || 'invalid JSON'}.`, 'error');
          return;
        }

        // Ask confirmation before replacing an existing non-empty workspace (skip when unlocking from lock screen or empty DB)
        const targetDb = ui.demoMode ? demoDB : liveDB;
        const hasExisting = !wasLocked && Boolean(targetDb && ((targetDb.departments || []).length > 0 || (targetDb.projects || []).length > 0));
        if (hasExisting && typeof ppConfirmAction === 'function') {
          const linkedWarn = (!ui.demoMode && linkedFileHandle)
            ? `\n\nThis will also overwrite your connected shared file "${linkedFileHandle.name}".`
            : '';
          const ok = await ppConfirmAction({
            title: 'Replace Current Database?',
            message: `Import "${file.name}" (${migrated.departments.length} depts, ${migrated.projects.length} projects) and replace your current ${ui.demoMode ? 'Demo' : 'Live'} database?${linkedWarn}`,
            confirmLabel: 'Replace & Import',
            tone: 'danger',
          });
          if (!ok) return;
        }

        try {
          if (!ui.demoMode && typeof window !== 'undefined' && typeof window.ppResetFinanceVaultForDbSwitch === 'function') {
            window.ppResetFinanceVaultForDbSwitch();
          }
          ui.whatIfMode = false;
          whatIfDB = null;
          if (ui.demoMode) demoDB = migrated;
          else liveDB = migrated;
          clearUndoHistory();
          if (typeof ppSyncAuthAfterDbLoad === 'function') {
            const authRes = ppSyncAuthAfterDbLoad(migrated);
            if (authRes && authRes.revoked) return;
          }
          let shifted = false;
          try {
            shifted = syncHorizonAfterDBLoad(migrated);
          } catch (hErr) {
            ppDebug('WARN', 'Horizon alignment error after import', { name: hErr?.name, message: hErr?.message });
          }
          if (isEncryptedImport && typeof ppMarkSecureSessionFlag === 'function') {
            ppMarkSecureSessionFlag(file.name, true);
          }
          touchDBAndSave();
          renderAll();
          if (typeof ppCheckForcedPasswordChange === 'function') {
            setTimeout(() => ppCheckForcedPasswordChange(), 120);
          }
          if (!ui.demoMode && typeof window !== 'undefined' && typeof window.ppTryAutoOpenFinanceVault === 'function') {
            window.ppTryAutoOpenFinanceVault({ allowPermissionPrompt: false, silent: false }).catch(() => {});
          }
          const allocCount = Object.keys(migrated.allocations).length;
          ppDebug('INFO', 'JSON import completed & rendered', { name: file.name, shifted, elapsedMs: Date.now() - t0 });
          showToast(
            `Imported "${file.name}" (${migrated.departments.length} depts, ${migrated.projects.length} projects, ${allocCount} wk allocs${shifted ? ' — timeline aligned' : ''})`,
            'success'
          );
        } catch (renderErr) {
          ppDebug('ERROR', 'Post-import render error', { name: renderErr?.name, message: renderErr?.message });
          showToast(`Imported "${file.name}", but a display error occurred (${renderErr?.message || 'Error'}).`, 'warning');
        }
      };
      reader.readAsText(file);
    }

    function downloadCSV(csvContent, filename) {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    async function exportMatrixCSV() {
      const db = getActiveDB();
      const periods = getVisiblePeriods();
      const includeCost = hasAnyDayRates(db);
      const header = [
        'RowType', 'Department', 'Dept Code', 'Project', 'Project Code', 'Commitment',
        ...periods.map(pk => `${formatPeriodHeader(pk, ui.timeUnit).title} (${unitShortLabel()})`),
        ...(includeCost ? [`Est. Cost (${getCurrencySymbol(db)})`] : []),
        'Notes',
      ];
      const rows = [header.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')];

      const sortedProjs = getSortedProjects(db);
      db.departments.forEach(d => {
        // Capacity reference row for each department (enables full spreadsheet round-trip!)
        const capVals = [];
        const varNotes = [];
        periods.forEach(pk => {
          const cObj = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db);
          capVals.push(formatValue(fteToDisplayValue(cObj.avgFte, pk, ui.timeUnit), ui.manpowerUnit, false));
          if (cObj.hasOverride) varNotes.push(`${formatPeriodHeader(pk, ui.timeUnit).shortTitle}: Var ${Math.round(cObj.avgFte * 100) / 100} FTE`);
        });
        rows.push([
          'Capacity', d.name, d.code, 'Available Capacity', 'CAP', '—',
          ...capVals,
          ...(includeCost ? [''] : []),
          varNotes.join(' | '),
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        // Project allocation rows
        sortedProjs.forEach(p => {
          if (!isProjectIncludedInPlan(p)) return;
          const vals = [];
          const notes = [];
          let rowCost = 0;
          const dpw = Number(db.settings.daysPerWeek) || 5;
          const rate = Number(d.dayRate) || 0;
          periods.forEach(pk => {
            const a = getAllocationForPeriod(d.id, p.id, pk, ui.timeUnit, db.allocations);
            vals.push(a.hasData ? formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit), ui.manpowerUnit, false) : '0');
            if (includeCost && a.hasData && rate > 0) {
              const wks = ui.timeUnit === 'month' ? getWeeksInMonth(pk).length : 1;
              rowCost += a.avgFte * dpw * wks * rate;
            }
            const cmt = getCellProjectComments(d.id, p.id, pk, ui.timeUnit, db);
            if (cmt.direct) notes.push(`${formatPeriodHeader(pk, ui.timeUnit).shortTitle}: ${cmt.direct.replace(/\s+/g, ' ')}`);
          });
          if (vals.some(v => Number(v) > 0) || notes.length > 0) {
            rows.push([
              'Allocation', d.name, d.code, p.name, p.code, p.tentative ? 'Pipeline' : 'Committed',
              ...vals,
              ...(includeCost ? [String(Math.round(rowCost))] : []),
              notes.join(' | '),
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
          }
        });
      });

      const csv = rows.join('\n');
      const fname = `pulseplan_matrix_${ui.timeUnit}_${new Date().toISOString().slice(0, 10)}.csv`;
      const outcome = await shareOrDownloadFile(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), fname, 'text/csv', 'PulsePlan Matrix CSV');
      if (outcome !== 'cancelled') {
        recordDumpEvent('CSV', fname, csv.length, `Matrix CSV w/ Capacity & Notes (${periods.length} ${ui.timeUnit}s, ${unitShortLabel()})`);
        showToast(outcome === 'shared' ? 'Matrix CSV shared' : 'Matrix CSV exported (with Capacity & Notes)', 'success');
      }
    }

    async function exportChangeLogCSV() {
      const db = getActiveDB();
      const rows = ['"Timestamp","User","Category","Details"'];
      (db.changeLog || []).forEach(l => {
        rows.push([l.timestamp, l.user, l.type, l.summary].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      });
      const csv = rows.join('\n');
      const fname = `pulseplan_changelog_${new Date().toISOString().slice(0, 10)}.csv`;
      const outcome = await shareOrDownloadFile(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), fname, 'text/csv', 'PulsePlan Change Log CSV');
      if (outcome !== 'cancelled') {
        recordDumpEvent('CSV', fname, csv.length, `Change log (${(db.changeLog || []).length} entries)`);
        showToast(outcome === 'shared' ? 'Change Log CSV shared' : 'Change Log CSV exported', 'success');
      }
    }

    /* ---------- Mod 1 Upgraded: Colorful Vector Card PDF & Zero-Overflow Engine ---------- */

    function exportRoadmapPDF() {
      openExportPdfModal();
    }

    function getPdfExportPeriods(opts = {}) {
      const raw = opts && opts.periodCount !== undefined ? opts.periodCount : (ui.pdfOptions ? ui.pdfOptions.periodCount : 'match');
      if (!raw || raw === 'match') return getVisiblePeriods();
      const count = Math.max(1, Math.min(24, parseInt(raw, 10) || getActiveHorizon()));
      const out = [];
      for (let i = 0; i < count; i++) {
        if (ui.timeUnit === 'month') out.push(addMonthsToMonthKey(ui.startMonth, i));
        else out.push(addWeeksToWeekKey(ui.startWeek, i));
      }
      return out;
    }

    function syncPdfHorizonSummary() {
      const outEl = document.getElementById('mPdfHorizonSummary');
      if (!outEl) return;
      const rawCount = document.getElementById('mPdfPeriodCount')?.value || 'match';
      const cols = Math.max(3, Math.min(6, parseInt(document.getElementById('mPdfColsPerPage')?.value, 10) || 6));
      const periods = getPdfExportPeriods({ periodCount: rawCount });
      const unitPlural = ui.timeUnit === 'month' ? (periods.length === 1 ? 'month' : 'months') : (periods.length === 1 ? 'week' : 'weeks');
      const pages = Math.max(1, Math.ceil(periods.length / cols));
      const firstLbl = periods.length ? formatPeriodHeader(periods[0], ui.timeUnit).shortTitle : '';
      const lastLbl = periods.length ? formatPeriodHeader(periods[periods.length - 1], ui.timeUnit).shortTitle : '';
      const rangeStr = periods.length > 1 ? `${firstLbl} → ${lastLbl}` : firstLbl;
      outEl.textContent = `${periods.length} ${unitPlural} (${rangeStr}) • ${pages} matrix ${pages === 1 ? 'page' : 'pages'} (${Math.min(cols, periods.length)} cols/page)`;
    }

    function syncPdfDeliveryButtonLabel() {
      const sel = document.getElementById('mPdfDelivery');
      const btn = document.getElementById('btnGeneratePdfSubmit');
      if (!sel || !btn) return;
      const v = sel.value;
      if (v === 'disk') btn.textContent = 'Save PDF to Disk…';
      else if (v === 'download') btn.textContent = 'Download PDF to Disk';
      else if (v === 'share') btn.textContent = 'Share PDF Report';
      else btn.textContent = 'Generate PDF Report';
    }

    function openExportPdfModal() {
      const db = getActiveDB();
      const canSavePicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function' && (typeof location === 'undefined' || location.protocol !== 'file:');
      const canWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
      const isMobileNow = isMobileViewport();
      const defaultDelivery = isMobileNow ? (canWebShare ? 'share' : 'download') : (canSavePicker ? 'disk' : 'download');
      const opts = { colorMode: 'match', periodCount: 'match', colsPerPage: 6, delivery: defaultDelivery, ...(ui.pdfOptions || {}) };
      if (opts.delivery === 'disk' && !canSavePicker) opts.delivery = 'download';
      const defaultSnapId = ui.compareSnapshotId || (db.snapshots[0] ? db.snapshots[0].id : '');
      const activeModeLabelMap = {
        accent: 'Accent Border',
        fill: 'Full Color Fill',
        fte: '6-Tier FTE Heat',
        fte3: '3-Level Green/Yellow/Red',
      };
      const curModeLabel = activeModeLabelMap[getActiveCellColorMode()] || 'Accent Border';
      const curHorizon = getActiveHorizon();
      const unitPlural = ui.timeUnit === 'month' ? 'months' : 'weeks';
      const periodCountChoices = [2, 3, 4, 5, 6, 8, 12, 18, 24];
      const selPeriodCount = String(opts.periodCount || 'match');
      const selCols = Math.max(3, Math.min(6, Number(opts.colsPerPage) || 6));
      const initPeriods = getPdfExportPeriods({ periodCount: selPeriodCount });
      const initPages = Math.max(1, Math.ceil(initPeriods.length / selCols));
      const initRange = initPeriods.length > 1
        ? `${formatPeriodHeader(initPeriods[0], ui.timeUnit).shortTitle} → ${formatPeriodHeader(initPeriods[initPeriods.length - 1], ui.timeUnit).shortTitle}`
        : (initPeriods[0] ? formatPeriodHeader(initPeriods[0], ui.timeUnit).shortTitle : '');
      const initSummaryTxt = `${initPeriods.length} ${initPeriods.length === 1 ? (ui.timeUnit === 'month' ? 'month' : 'week') : unitPlural} (${initRange}) • ${initPages} matrix ${initPages === 1 ? 'page' : 'pages'} (${Math.min(selCols, initPeriods.length)} cols/page)`;
      const submitBtnLabel = opts.delivery === 'disk'
        ? 'Save PDF to Disk…'
        : (opts.delivery === 'download' ? 'Download PDF to Disk' : (opts.delivery === 'share' ? 'Share PDF Report' : 'Generate PDF Report'));

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="flex items-center justify-between">
            <div>
              <h3 id="modalTitle" class="text-base font-bold text-slate-900">Export Comprehensive PDF Report</h3>
              <p class="text-[11px] text-slate-500">Vector-drawn colorful cards with automatic zero-overflow layout.</p>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="text-slate-400 hover:text-slate-700 text-lg font-bold leading-none">&times;</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="mPdfTitle" class="block font-semibold text-slate-700 mb-1">Report Title</label>
              <input id="mPdfTitle" type="text" value="${escapeHtml(opts.title || 'PulsePlan - Company Roadmap & Utilisation Report')}"
                class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold" />
            </div>
            <div>
              <label for="mPdfDelivery" class="block font-semibold text-slate-700 mb-1">Export Destination</label>
              <select id="mPdfDelivery" onchange="syncPdfDeliveryButtonLabel()" class="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-800">
                ${canSavePicker ? `<option value="disk" ${opts.delivery === 'disk' ? 'selected' : ''}>Save to Disk (Choose Folder&hellip;)</option>` : ''}
                <option value="download" ${opts.delivery === 'download' ? 'selected' : ''}>Download Directly to Disk</option>
                ${canWebShare ? `<option value="share" ${opts.delivery === 'share' ? 'selected' : ''}>Share via System Sheet</option>` : ''}
              </select>
            </div>
          </div>

          <fieldset class="p-3 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-2.5">
            <legend class="sr-only">Matrix PDF period range, visual style, and column density</legend>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label for="mPdfPeriodCount" class="block font-semibold text-indigo-950 mb-1">Periods in Report</label>
                <select id="mPdfPeriodCount" onchange="syncPdfHorizonSummary()" class="w-full px-2.5 py-2 rounded-xl border border-indigo-200 bg-white font-semibold text-slate-800">
                  <option value="match" ${selPeriodCount === 'match' ? 'selected' : ''}>Match Active View (${curHorizon} ${unitPlural})</option>
                  ${periodCountChoices.map(n => `<option value="${n}" ${selPeriodCount === String(n) ? 'selected' : ''}>${n} ${unitPlural}</option>`).join('')}
                </select>
              </div>
              <div>
                <label for="mPdfColsPerPage" class="block font-semibold text-indigo-950 mb-1">Columns per Page</label>
                <select id="mPdfColsPerPage" onchange="syncPdfHorizonSummary()" class="w-full px-2.5 py-2 rounded-xl border border-indigo-200 bg-white font-semibold text-slate-800">
                  <option value="6" ${selCols === 6 ? 'selected' : ''}>6 cols / page (38 mm)</option>
                  <option value="5" ${selCols === 5 ? 'selected' : ''}>5 cols / page (46 mm)</option>
                  <option value="4" ${selCols === 4 ? 'selected' : ''}>4 cols / page (57 mm)</option>
                  <option value="3" ${selCols === 3 ? 'selected' : ''}>3 cols / page (76 mm)</option>
                </select>
              </div>
              <div>
                <label for="mPdfColorMode" class="block font-semibold text-indigo-950 mb-1">Card Colour Style</label>
                <select id="mPdfColorMode" class="w-full px-2.5 py-2 rounded-xl border border-indigo-200 bg-white font-semibold text-slate-800">
                  <option value="match" ${opts.colorMode === 'match' ? 'selected' : ''}>Match Active (${escapeHtml(curModeLabel)})</option>
                  <option value="fill" ${opts.colorMode === 'fill' ? 'selected' : ''}>Full Color Fill</option>
                  <option value="fte3" ${opts.colorMode === 'fte3' ? 'selected' : ''}>3-Level (Green/Yel/Red)</option>
                  <option value="fte" ${opts.colorMode === 'fte' ? 'selected' : ''}>6-Tier FTE Heat Scale</option>
                  <option value="accent" ${opts.colorMode === 'accent' ? 'selected' : ''}>Accent Left-Stripe</option>
                </select>
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-indigo-200 text-[11px]">
              <span class="font-bold text-indigo-700 shrink-0">PDF Preview</span>
              <span id="mPdfHorizonSummary" class="font-mono font-semibold text-slate-700 truncate">${escapeHtml(initSummaryTxt)}</span>
            </div>
          </fieldset>

          <fieldset class="space-y-2">
            <legend class="font-bold text-slate-700 mb-1">Report Sections</legend>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncChart" type="checkbox" ${opts.includeChart ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">KPIs &amp; Vector Load Chart</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncMatrix" type="checkbox" ${opts.includeMatrix ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Colorful Vector Roadmap Matrix</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncDeptHealth" type="checkbox" ${opts.includeDeptHealth ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Dept Health &amp; Overrides</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncPortfolio" type="checkbox" ${opts.includeProjectPortfolio ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Project Portfolio &amp; Effort</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncMilestones" type="checkbox" ${opts.includeMilestones ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Milestones &amp; Drift Table</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncComments" type="checkbox" ${opts.includeCommentsAppendix ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Full Comments Appendix</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncTasks" type="checkbox" ${opts.includeTasksAppendix !== false ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Weekly Tasks &amp; Rollover Log</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncSnapDiff" type="checkbox" ${opts.includeSnapshotDiff && db.snapshots.length > 0 ? 'checked' : ''} ${db.snapshots.length === 0 ? 'disabled' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Snapshot Comparison Diff</span>
              </label>
              <label class="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input id="pdfIncChangeLog" type="checkbox" ${opts.includeChangeLog ? 'checked' : ''} class="rounded text-indigo-600" />
                <span class="font-semibold text-slate-800">Recent Change Log</span>
              </label>
            </div>
          </fieldset>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label for="mPdfSnapSelect" class="block font-semibold text-slate-700 mb-1">Snapshot for Diff Section</label>
              <select id="mPdfSnapSelect" ${db.snapshots.length === 0 ? 'disabled' : ''} class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-medium">
                ${db.snapshots.length === 0
                  ? '<option value="">No snapshots saved yet</option>'
                  : db.snapshots.map(s => `<option value="${s.id}" ${s.id === defaultSnapId ? 'selected' : ''}>${escapeHtml(s.name)} (${new Date(s.createdAt).toLocaleDateString()})</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="mPdfLogLimit" class="block font-semibold text-slate-700 mb-1">Recent Change Log Rows</label>
              <input id="mPdfLogLimit" type="number" inputmode="numeric" min="5" max="100" step="5" value="${opts.changeLogLimit || 15}"
                class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-center" />
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onclick="closeModal()" class="px-3.5 py-2.5 sm:py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold transition">Cancel</button>
            <button id="btnGeneratePdfSubmit" type="button" onclick="runPdfExportFromModal()" class="px-4 py-2.5 sm:py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-xs transition">${submitBtnLabel}</button>
          </div>
        </div>`, 'max-w-xl');
    }

    async function runPdfExportFromModal() {
      const delivery = document.getElementById('mPdfDelivery')?.value || (isMobileViewport() ? 'auto' : 'download');
      const rawPeriodCount = document.getElementById('mPdfPeriodCount')?.value || 'match';
      const periodCount = rawPeriodCount === 'match' ? 'match' : Math.max(1, Math.min(24, parseInt(rawPeriodCount, 10) || getActiveHorizon()));
      ui.pdfOptions = {
        title: (document.getElementById('mPdfTitle')?.value || 'PulsePlan - Company Roadmap & Utilisation Report').trim(),
        colorMode: document.getElementById('mPdfColorMode')?.value || 'match',
        periodCount,
        colsPerPage: Math.max(3, Math.min(6, parseInt(document.getElementById('mPdfColsPerPage')?.value, 10) || 6)),
        delivery,
        includeChart: Boolean(document.getElementById('pdfIncChart')?.checked),
        includeMatrix: Boolean(document.getElementById('pdfIncMatrix')?.checked),
        includeDeptHealth: Boolean(document.getElementById('pdfIncDeptHealth')?.checked),
        includeProjectPortfolio: Boolean(document.getElementById('pdfIncPortfolio')?.checked),
        includeMilestones: Boolean(document.getElementById('pdfIncMilestones')?.checked),
        includeCommentsAppendix: Boolean(document.getElementById('pdfIncComments')?.checked),
        includeTasksAppendix: Boolean(document.getElementById('pdfIncTasks')?.checked),
        includeSnapshotDiff: Boolean(document.getElementById('pdfIncSnapDiff')?.checked),
        includeChangeLog: Boolean(document.getElementById('pdfIncChangeLog')?.checked),
        changeLogLimit: Math.max(5, Math.min(100, parseInt(document.getElementById('mPdfLogLimit')?.value, 10) || 15)),
      };
      const snapId = document.getElementById('mPdfSnapSelect')?.value || '';
      persistUIPrefs();

      // Acquire disk Save-As handle immediately inside the click gesture so Chrome never expires user activation
      let preFileHandle = null;
      const suggestedFname = `pulseplan_roadmap_${ui.timeUnit}_${new Date().toISOString().slice(0, 10)}.pdf`;
      if (delivery === 'disk' && window.jspdf && window.jspdf.jsPDF && typeof window.showSaveFilePicker === 'function' && (typeof location === 'undefined' || location.protocol !== 'file:')) {
        try {
          preFileHandle = await window.showSaveFilePicker({
            suggestedName: suggestedFname,
            types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
          });
        } catch (err) {
          if (err && err.name === 'AbortError') return; // User cancelled Save dialog
          preFileHandle = null; // Fall back cleanly to direct browser download
        }
      }

      closeModal();
      generateRoadmapPDF({ ...ui.pdfOptions, snapshotId: snapId, fileHandle: preFileHandle });
    }

    function pdfSafeText(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u2014\u2013\u2212]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/\u221E/g, 'INF')
        .replace(/\u2192/g, '->')
        .replace(/\u2190/g, '<-')
        .replace(/\u2265/g, '>=')
        .replace(/\u2264/g, '<=')
        .replace(/\u00D7/g, 'x')
        .replace(/[\u2022\u25CF]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\uD83D\uDCCC/g, '[PIN]')
        .replace(/[\u25C6\u25B2\u25BC\u203C\u270E]/g, '')
        .replace(/[^\n\x20-\xFF]/g, '');
    }

    function pdfHexToRgb(hexColor, fallback = [79, 70, 229]) {
      let hex = String(hexColor || '').trim();
      if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
        hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
      return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
    }

    function pdfMixRgb(rgbA, rgbB, weightB = 0.5) {
      const w = Math.max(0, Math.min(1, weightB));
      return [
        Math.round(rgbA[0] * (1 - w) + rgbB[0] * w),
        Math.round(rgbA[1] * (1 - w) + rgbB[1] * w),
        Math.round(rgbA[2] * (1 - w) + rgbB[2] * w),
      ];
    }

    function pdfGetFilledCardRgbTheme(hexColor) {
      const bgRgb = pdfHexToRgb(hexColor, [79, 70, 229]);
      const luminance = (0.299 * bgRgb[0] + 0.587 * bgRgb[1] + 0.114 * bgRgb[2]) / 255;
      const isLight = luminance > 0.62;
      return {
        isLight,
        bgRgb,
        textRgb: isLight ? [15, 23, 42] : [255, 255, 255],
        mutedRgb: isLight ? [51, 65, 85] : [241, 245, 249],
        borderRgb: isLight ? pdfMixRgb(bgRgb, [15, 23, 42], 0.28) : pdfMixRgb(bgRgb, [15, 23, 42], 0.22),
        pillBgRgb: isLight ? pdfMixRgb(bgRgb, [15, 23, 42], 0.14) : pdfMixRgb(bgRgb, [15, 23, 42], 0.26),
        pillTextRgb: isLight ? [15, 23, 42] : [255, 255, 255],
        commentBgRgb: isLight ? pdfMixRgb(bgRgb, [255, 255, 255], 0.65) : pdfMixRgb(bgRgb, [15, 23, 42], 0.34),
        commentBorderRgb: isLight ? pdfMixRgb(bgRgb, [15, 23, 42], 0.22) : pdfMixRgb(bgRgb, [255, 255, 255], 0.25),
        commentTextRgb: isLight ? [15, 23, 42] : [248, 250, 252],
      };
    }

    function pdfFitText(doc, text, maxW) {
      const clean = pdfSafeText(text).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!clean || maxW <= 1.2) return '';
      if (doc.getTextWidth(clean) <= maxW) return clean;
      const ell = '...';
      const ellW = doc.getTextWidth(ell);
      if (ellW >= maxW) return '';
      let lo = 0;
      let hi = clean.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (doc.getTextWidth(clean.slice(0, mid)) + ellW <= maxW) lo = mid;
        else hi = mid - 1;
      }
      return lo > 0 ? clean.slice(0, lo).trimEnd() + ell : '';
    }

    function pdfFitFontText(doc, text, x, y, maxW, maxPt, minPt, style = 'bold', opts = {}) {
      const clean = pdfSafeText(text).replace(/\n+/g, ' ').trim();
      let pt = maxPt;
      doc.setFont('helvetica', style);
      while (pt > minPt) {
        doc.setFontSize(pt);
        if (doc.getTextWidth(clean) <= maxW) break;
        pt = Math.round((pt - 0.5) * 10) / 10;
      }
      doc.setFontSize(pt);
      const fitted = pdfFitText(doc, clean, maxW);
      if (fitted) doc.text(fitted, x, y, opts);
      return pt;
    }

    function pdfWrapLines(doc, text, maxW, maxLines = 4) {
      const safe = pdfSafeText(text).trim();
      if (!safe || maxW <= 2) return [];
      const paragraphs = safe.split('\n').map(p => p.trim()).filter(Boolean);
      const out = [];
      for (const para of paragraphs) {
        const split = doc.splitTextToSize(para, maxW);
        for (const line of split) out.push(String(line));
      }
      if (out.length <= maxLines) return out;
      const sliced = out.slice(0, maxLines);
      sliced[maxLines - 1] = pdfFitText(doc, sliced[maxLines - 1].replace(/\.*$/, '') + '...', maxW);
      return sliced;
    }

    function drawPdfVectorDiamond(doc, cx, cy, r, fillRgb, strokeRgb) {
      doc.setFillColor(...fillRgb);
      doc.setDrawColor(...strokeRgb);
      doc.setLineWidth(0.22);
      doc.lines([[r, -r], [r, r], [-r, r], [-r, -r]], cx - r, cy, [1, 1], 'FD', true);
    }

    function drawPdfVectorTierIcon(doc, tier, cx, cy, size, fgRgb) {
      doc.setFillColor(...fgRgb);
      doc.setDrawColor(...fgRgb);
      if (tier === 'low') {
        doc.circle(cx, cy, size * 0.36, 'F');
      } else if (tier === 'med') {
        const h = size * 0.42;
        const w = size * 0.46;
        doc.triangle(cx, cy - h, cx - w, cy + h * 0.85, cx + w, cy + h * 0.85, 'F');
      } else if (tier === 'high') {
        const barW = size * 0.16;
        const barH = size * 0.48;
        const dx = size * 0.18;
        doc.rect(cx - dx - barW / 2, cy - size * 0.42, barW, barH, 'F');
        doc.rect(cx + dx - barW / 2, cy - size * 0.42, barW, barH, 'F');
        doc.circle(cx - dx, cy + size * 0.28, barW * 0.58, 'F');
        doc.circle(cx + dx, cy + size * 0.28, barW * 0.58, 'F');
      }
    }

    function drawPdfLoadVsCapacityChart(doc, stats, startY, pageW, overT, warnT) {
      const marginX = 12;
      const boxW = pageW - marginX * 2;
      const boxH = 54;

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.roundedRect(marginX, startY, boxW, boxH, 2.2, 2.2, 'FD');

      const titleStr = pdfSafeText(`Organisation Load vs. Variable Capacity (${unitShortLabel()})`);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      const titleMaxW = boxW - 8;
      const titleW = Math.min(titleMaxW, doc.getTextWidth(titleStr));
      doc.text(pdfFitText(doc, titleStr, titleMaxW), marginX + 4, startY + 5.4);

      const legendItems = [
        { type: 'rect', rgb: [99, 102, 241], label: 'Healthy' },
        { type: 'rect', rgb: [245, 158, 11], label: `High (>=${warnT}%)` },
        { type: 'rect', rgb: [244, 63, 94], label: `Over (>${overT}%)` },
        { type: 'line', rgb: [15, 23, 42], label: 'Capacity' },
      ];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      const itemGap = 4.2;
      const swatchW = 3.2;
      let totalLegendW = 0;
      legendItems.forEach((it, idx) => {
        it.w = swatchW + 1.4 + doc.getTextWidth(it.label);
        totalLegendW += it.w + (idx > 0 ? itemGap : 0);
      });

      const titleRightX = marginX + 4 + titleW;
      const legendNeedsSecondRow = (marginX + boxW - 4 - totalLegendW) < (titleRightX + 6);
      const legY = legendNeedsSecondRow ? startY + 9.4 : startY + 5.2;
      let cursorX = legendNeedsSecondRow ? (marginX + 4) : (marginX + boxW - 4 - totalLegendW);

      legendItems.forEach(it => {
        if (it.type === 'rect') {
          doc.setFillColor(...it.rgb);
          doc.roundedRect(cursorX, legY - 2.1, 2.8, 2.4, 0.5, 0.5, 'F');
        } else {
          doc.setDrawColor(...it.rgb);
          doc.setLineWidth(0.6);
          doc.line(cursorX, legY - 0.9, cursorX + 3.0, legY - 0.9);
          doc.setFillColor(255, 255, 255);
          doc.circle(cursorX + 1.5, legY - 0.9, 0.7, 'FD');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(71, 85, 105);
        doc.text(it.label, cursorX + swatchW + 1.1, legY);
        cursorX += it.w + itemGap;
      });

      if (!stats || stats.length === 0) return startY + boxH + 5;

      const plotL = marginX + 16;
      const plotR = marginX + boxW - 5;
      const plotT = legendNeedsSecondRow ? startY + 13.5 : startY + 10.5;
      const plotB = startY + boxH - 8.5;
      const plotW = plotR - plotL;
      const headroom = 5.8;
      const usablePlotH = Math.max(12, (plotB - plotT) - headroom);

      const maxVal = Math.max(1, ...stats.map(s => Math.max(s.allocDisp, s.capDisp))) * 1.14;
      const yPos = v => plotB - (v / maxVal) * usablePlotH;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.3);
      doc.setTextColor(100, 116, 139);
      for (let i = 0; i <= 3; i++) {
        const val = (maxVal / 3) * i;
        const y = yPos(val);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.line(plotL, y, plotR, y);
        const tickLbl = pdfFitText(doc, formatValue(val, ui.manpowerUnit, false), 12.5);
        doc.text(tickLbl, plotL - 2, y + 1, { align: 'right' });
      }

      const slotW = plotW / stats.length;
      const barW = Math.min(18, Math.max(2.6, slotW * 0.54));
      const capPts = [];
      const barTopYs = [];

      const showEveryNth = stats.length > 16 ? 2 : 1;
      stats.forEach((s, idx) => {
        const cx = plotL + idx * slotW + slotW / 2;
        const bx = cx - barW / 2;
        const by = yPos(s.allocDisp);
        const bh = Math.max(0.4, plotB - by);
        barTopYs.push(by);

        if (s.pct > overT) doc.setFillColor(244, 63, 94);
        else if (s.pct >= warnT) doc.setFillColor(245, 158, 11);
        else doc.setFillColor(99, 102, 241);

        doc.roundedRect(bx, by, barW, bh, 0.8, 0.8, 'F');

        if (idx % showEveryNth === 0 || idx === stats.length - 1) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(stats.length > 12 ? 5.3 : 6.2);
          doc.setTextColor(71, 85, 105);
          const xLbl = pdfFitText(doc, s.label, Math.max(5, slotW * showEveryNth - 1.2));
          doc.text(xLbl, cx, plotB + 4.4, { align: 'center' });
        }

        capPts.push({ x: cx, y: yPos(s.capDisp) });
      });

      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.55);
      if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([2, 1.4], 0);
      for (let i = 1; i < capPts.length; i++) {
        doc.line(capPts[i - 1].x, capPts[i - 1].y, capPts[i].x, capPts[i].y);
      }
      if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
      capPts.forEach(pt => {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.42);
        doc.circle(pt.x, pt.y, 1.05, 'FD');
      });

      const pctFontPt = stats.length > 14 ? 5.2 : 6.1;
      stats.forEach((s, idx) => {
        if (stats.length > 18 && idx % 2 !== 0 && idx !== stats.length - 1) return;
        const cx = capPts[idx].x;
        const highestY = Math.min(barTopYs[idx], capPts[idx].y);
        const labelY = Math.max(plotT + 2.5, highestY - 2.1);
        const pctStr = `${s.pct}%`;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(pctFontPt);
        const w = Math.min(slotW - 0.6, doc.getTextWidth(pctStr) + 1.6);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(cx - w / 2, labelY - 2.3, w, 2.9, 0.5, 0.5, 'F');

        if (s.pct > overT) doc.setTextColor(225, 29, 72);
        else if (s.pct >= warnT) doc.setTextColor(180, 83, 9);
        else doc.setTextColor(51, 65, 85);
        doc.text(pdfFitText(doc, pctStr, slotW - 0.8), cx, labelY, { align: 'center' });
      });

      return startY + boxH + 5;
    }

    function drawPdfColorLegendStrip(doc, startY, pageW, colorMode, db, warnT, overT) {
      const marginX = 12;
      const boxW = pageW - marginX * 2;
      const items = [
        { kind: 'swatch', rgb: [255, 241, 242], border: [244, 63, 94], label: `Cell >${overT}%` },
        { kind: 'swatch', rgb: [255, 251, 235], border: [245, 158, 11], label: `Cell >=${warnT}%` },
        { kind: 'pill', rgb: [224, 242, 254], textRgb: [3, 105, 161], pillTxt: 'Var', label: 'Capacity Override' },
        { kind: 'diamond', rgb: [139, 92, 246], label: 'Milestone' },
      ];

      if (colorMode === 'fte3') {
        const cfg = getFte3Settings(db);
        const u = cfg.basis === 'absoluteFte' ? ' FTE' : '%';
        const yVal = cfg.basis === 'absoluteFte' ? cfg.yellowFte : cfg.yellowPct;
        const rVal = cfg.basis === 'absoluteFte' ? cfg.redFte : cfg.redPct;
        items.push(
          { kind: 'tier', tier: 'low', rgb: [21, 128, 61], fg: [255, 255, 255], label: `Low (<${yVal}${u})` },
          { kind: 'tier', tier: 'med', rgb: [250, 204, 21], fg: [15, 23, 42], label: `Med (${yVal}-${rVal}${u})` },
          { kind: 'tier', tier: 'high', rgb: [220, 38, 38], fg: [255, 255, 255], label: `High (>=${rVal}${u})` }
        );
      } else if (colorMode === 'fte') {
        items.push(
          { kind: 'swatch', rgb: [2, 132, 199], border: [2, 132, 199], label: '<=20%' },
          { kind: 'swatch', rgb: [5, 150, 105], border: [5, 150, 105], label: '20-40%' },
          { kind: 'swatch', rgb: [79, 70, 229], border: [79, 70, 229], label: '40-65%' },
          { kind: 'swatch', rgb: [217, 119, 6], border: [217, 119, 6], label: '65-100%' },
          { kind: 'swatch', rgb: [225, 29, 72], border: [225, 29, 72], label: '>100%' }
        );
      } else if (colorMode === 'fill') {
        items.push({ kind: 'swatch', rgb: [79, 70, 229], border: [67, 56, 202], label: 'Cards: Project / Dept Fill Colour' });
      } else {
        items.push({ kind: 'swatch', rgb: [255, 255, 255], border: [79, 70, 229], label: 'Cards: Project / Dept Accent Stripe' });
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.3);
      const maxRowW = boxW - 6;
      const rowsArr = [[]];
      let curW = 0;
      items.forEach(it => {
        const iconW = it.kind === 'pill' ? 6.2 : 3.6;
        it.totalW = iconW + 1.3 + doc.getTextWidth(it.label) + 3.8;
        if (curW > 0 && curW + it.totalW > maxRowW) {
          rowsArr.push([it]);
          curW = it.totalW;
        } else {
          rowsArr[rowsArr.length - 1].push(it);
          curW += it.totalW;
        }
      });

      const rowH = 4.6;
      const stripH = 2.4 + rowsArr.length * rowH;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(marginX, startY, boxW, stripH, 1.5, 1.5, 'FD');

      rowsArr.forEach((rowItems, rIdx) => {
        let x = marginX + 3.2;
        const cy = startY + 1.2 + rIdx * rowH + rowH / 2;
        rowItems.forEach(it => {
          if (it.kind === 'swatch') {
            doc.setFillColor(...it.rgb);
            doc.setDrawColor(...it.border);
            doc.setLineWidth(0.3);
            doc.roundedRect(x, cy - 1.3, 2.8, 2.6, 0.5, 0.5, 'FD');
            x += 4.1;
          } else if (it.kind === 'pill') {
            doc.setFillColor(...it.rgb);
            doc.roundedRect(x, cy - 1.4, 5.4, 2.8, 0.6, 0.6, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(5.4);
            doc.setTextColor(...it.textRgb);
            doc.text(it.pillTxt, x + 2.7, cy + 0.7, { align: 'center' });
            x += 6.7;
          } else if (it.kind === 'diamond') {
            drawPdfVectorDiamond(doc, x + 1.4, cy, 1.2, it.rgb, [109, 40, 217]);
            x += 4.1;
          } else if (it.kind === 'tier') {
            doc.setFillColor(...it.rgb);
            doc.roundedRect(x, cy - 1.4, 3.0, 2.8, 0.5, 0.5, 'F');
            drawPdfVectorTierIcon(doc, it.tier, x + 1.5, cy, 2.2, it.fg);
            x += 4.3;
          }
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.3);
          doc.setTextColor(51, 65, 85);
          doc.text(it.label, x, cy + 0.85);
          x += doc.getTextWidth(it.label) + 3.8;
        });
      });

      return startY + stripH + 2.5;
    }

    function measurePdfRowHeader(doc, row, axis, chunk, colW, db, warnT, overT) {
      const padX = 2.0;
      const stripeW = 2.0;
      const innerW = Math.max(12, colW - stripeW - padX * 2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.1);
      const nameLines = pdfWrapLines(doc, row.name, innerW, 2);

      let badgeText = '';
      let badgeBgRgb = [226, 232, 240];
      let badgeTextRgb = [51, 65, 85];
      const metaLines = [];

      if (row.id === '__MILESTONES__') {
        badgeText = `${Number(row.totalCount) || 0} Total`;
        badgeBgRgb = [237, 233, 254];
        badgeTextRgb = [109, 40, 217];
        metaLines.push('Dedicated milestone lane');
      } else if (axis === 'department') {
        let rA = 0, rC = 0;
        chunk.forEach(pk => {
          rA += getDeptTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
          rC += getDeptCapacityForPeriod(row.id, pk, ui.timeUnit, db).avgFte;
        });
        const rPct = rC > 0 ? Math.round((rA / rC) * 100) : 0;
        badgeText = `${rPct}% Avg`;
        if (rPct > overT) { badgeBgRgb = [254, 226, 226]; badgeTextRgb = [185, 28, 28]; }
        else if (rPct >= warnT) { badgeBgRgb = [254, 243, 199]; badgeTextRgb = [146, 64, 14]; }
        else { badgeBgRgb = [209, 250, 229]; badgeTextRgb = [6, 95, 70]; }

        metaLines.push(`Base: ${row.defaultCapacity} FTE`);
        if (row.manager) metaLines.push(`Lead: ${row.manager}`);
      } else {
        let totalDays = 0;
        chunk.forEach(pk => {
          totalDays += fteToDisplayValue(getProjTotalAllocatedFte(row.id, pk, ui.timeUnit, db), pk, ui.timeUnit, 'days');
        });
        badgeText = pdfSafeText(row.status || 'Active');
        if (row.status === 'At Risk') { badgeBgRgb = [254, 226, 226]; badgeTextRgb = [185, 28, 28]; }
        else if (row.status === 'Active') { badgeBgRgb = [209, 250, 229]; badgeTextRgb = [6, 95, 70]; }
        else { badgeBgRgb = [226, 232, 240]; badgeTextRgb = [71, 85, 105]; }

        metaLines.push(`${row.priority || 'Medium'} | ${Math.round(totalDays)}d`);
        if (row.owner) metaLines.push(`Owner: ${row.owner}`);
        if (row.techLead) metaLines.push(`Tech Lead: ${row.techLead}`);
      }

      const h = 2.0 + (nameLines.length * 3.0) + 1.2 + 3.8 + 1.2 + (metaLines.length * 2.7) + 2.0;
      return {
        height: Math.max(15, h),
        stripeRgb: pdfHexToRgb(row.color, [79, 70, 229]),
        nameLines,
        codeText: pdfSafeText(row.code || ''),
        badgeText,
        badgeBgRgb,
        badgeTextRgb,
        metaLines: metaLines.map(m => pdfSafeText(m)),
      };
    }

    function drawPdfRowHeader(doc, cell, layout) {
      const { x, y, width, height } = cell;
      const stripeW = 2.0;
      const padX = 2.0;
      const contentX = x + stripeW + padX;
      const innerW = Math.max(10, width - stripeW - padX * 2);

      doc.setFillColor(...layout.stripeRgb);
      doc.rect(x + 0.15, y + 0.15, stripeW, Math.max(0, height - 0.3), 'F');

      let cy = y + 3.8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.1);
      doc.setTextColor(15, 23, 42);
      layout.nameLines.forEach(line => {
        doc.text(pdfFitText(doc, line, innerW), contentX, cy);
        cy += 3.0;
      });

      cy += 0.4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.7);
      const codeStr = layout.codeText;
      const codeW = Math.min(innerW * 0.44, doc.getTextWidth(codeStr) + 2.6);
      doc.setFillColor(226, 232, 240);
      doc.roundedRect(contentX, cy - 2.3, codeW, 3.2, 0.7, 0.7, 'F');
      doc.setTextColor(51, 65, 85);
      doc.text(pdfFitText(doc, codeStr, codeW - 1.2), contentX + codeW / 2, cy - 0.1, { align: 'center' });

      const badgeMaxW = Math.max(8, innerW - codeW - 1.4);
      const badgeW = Math.min(badgeMaxW, doc.getTextWidth(layout.badgeText) + 2.8);
      const badgeX = contentX + codeW + 1.4;
      doc.setFillColor(...layout.badgeBgRgb);
      doc.roundedRect(badgeX, cy - 2.3, badgeW, 3.2, 0.7, 0.7, 'F');
      doc.setTextColor(...layout.badgeTextRgb);
      doc.text(pdfFitText(doc, layout.badgeText, badgeW - 1.2), badgeX + badgeW / 2, cy - 0.1, { align: 'center' });

      cy += 3.1;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.0);
      doc.setTextColor(100, 116, 139);
      layout.metaLines.forEach(line => {
        doc.text(pdfFitText(doc, line, innerW), contentX, cy);
        cy += 2.7;
      });
    }

    function measurePdfMatrixCell(doc, row, pk, axis, colW, db, visibleDepts, visibleProjs, colorMode, warnT, overT, showComments, compactMode = false) {
      const padX = 1.6;
      const padY = 1.6;
      const innerW = Math.max(14, colW - padX * 2);
      const maxCellH = 126;

      let header = null;
      let cellBgRgb = [255, 255, 255];
      let cursorH = padY;

      if (row.id === '__MILESTONES__') {
        const msRaw = getVisibleMilestonesForDeptView(pk, db, visibleProjs);
        const msTextMaxW = Math.max(8, innerW - 5.4);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        const msItems = msRaw.map(m => {
          const p = db.projects.find(x => x.id === m.projectId);
          const lbl = `${m.title}${p ? ` [${p.code}]` : ''} (${m.date || ''})`;
          const lines = pdfWrapLines(doc, lbl, msTextMaxW, compactMode ? 1 : 2);
          return { lines, textMaxW: msTextMaxW, height: 1.0 + lines.length * 2.3 + 1.0 };
        });
        const cardGap = 1.2;
        let totalH = padY + 0.5;
        msItems.forEach(m => { totalH += m.height + cardGap; });
        totalH += padY;
        return {
          height: Math.max(12, totalH),
          padX, padY, innerW, cardGap,
          cellBgRgb: [248, 245, 255],
          header: { kind: 'milestones' },
          cards: [],
          milestones: msItems,
          overflowCount: 0,
        };
      }

      if (axis === 'department') {
        const capObj = getDeptCapacityForPeriod(row.id, pk, ui.timeUnit, db);
        const capFte = capObj.avgFte;
        const allocFte = getDeptTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
        const pct = capFte > 0 ? Math.round((allocFte / capFte) * 100) : (allocFte > 0 ? 999 : 0);

        if (pct > overT) cellBgRgb = [255, 241, 242];
        else if (pct >= warnT) cellBgRgb = [255, 251, 235];

        const allocTxt = formatValue(fteToDisplayValue(allocFte, pk, ui.timeUnit), ui.manpowerUnit, false);
        const capTxt = formatValue(fteToDisplayValue(capFte, pk, ui.timeUnit), ui.manpowerUnit, true);
        const pctLabel = pct > 990 ? 'INF' : `${pct}%`;
        const barRgb = pct > overT ? [244, 63, 94] : pct >= warnT ? [245, 158, 11] : [16, 185, 129];
        const pctBgRgb = pct > overT ? [254, 205, 211] : pct >= warnT ? [253, 230, 138] : [209, 250, 229];
        const pctTextRgb = pct > overT ? [190, 18, 60] : pct >= warnT ? [146, 64, 14] : [6, 95, 70];

        header = {
          kind: 'dept',
          leftText: pdfSafeText(`${allocTxt} / ${capTxt}`),
          hasOverride: capObj.hasOverride,
          pct, pctLabel, barRgb, pctBgRgb, pctTextRgb,
        };
        cursorH += 6.6;
      } else {
        const totFte = getProjTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
        header = {
          kind: 'proj',
          totalText: totFte > 0 ? pdfSafeText(`Total: ${formatValue(fteToDisplayValue(totFte, pk, ui.timeUnit))}`) : 'No allocation',
          hasTotal: totFte > 0,
        };
        cursorH += 4.6;
      }

      const cards = [];
      const deptCapForDeptAxis = axis === 'department'
        ? getDeptCapacityForPeriod(row.id, pk, ui.timeUnit, db).avgFte
        : 0;

      const secondaryItems = axis === 'department' ? visibleProjs : visibleDepts;
      secondaryItems.forEach(item => {
        const deptId = axis === 'department' ? row.id : item.id;
        const projId = axis === 'department' ? item.id : row.id;
        const a = getAllocationForPeriod(deptId, projId, pk, ui.timeUnit, db.allocations);
        const cmt = getCellProjectComments(deptId, projId, pk, ui.timeUnit, db);
        const cellTasks = typeof ppGetCellTasks === 'function' ? ppGetCellTasks(deptId, projId, pk, ui.timeUnit, db) : [];
        if (!a.hasData && !cmt.hasAny && !cellTasks.length) return;

        const capFte = axis === 'department'
          ? deptCapForDeptAxis
          : getDeptCapacityForPeriod(deptId, pk, ui.timeUnit, db).avgFte;

        let fillHex = item.color;
        let tier3 = null;
        let showIdentityDot = false;
        if (colorMode === 'fte3') {
          tier3 = getFte3DemandTier(a.hasData ? a.avgFte : 0, capFte, db);
          fillHex = tier3.color;
          showIdentityDot = true;
        } else if (colorMode === 'fte') {
          fillHex = getFteCardColor(a.hasData ? a.avgFte : 0, capFte);
          showIdentityDot = true;
        }

        const isFilled = colorMode !== 'accent';
        const theme = isFilled ? pdfGetFilledCardRgbTheme(fillHex) : null;
        const valText = a.hasData ? pdfSafeText(formatValue(fteToDisplayValue(a.avgFte, pk, ui.timeUnit))) : (cellTasks.length && !cmt.hasAny ? 'Tasks' : 'Note');
        const titleRaw = `[${item.code}] ${item.name}`;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.8);
        const valPillW = Math.min(innerW * 0.42, Math.max(7.5, doc.getTextWidth(valText) + 2.4));

        const leftGutter = !isFilled
          ? 2.8
          : colorMode === 'fte3'
            ? (tier3 && tier3.tier !== 'note' ? 6.6 : 4.2)
            : showIdentityDot ? 4.2 : 1.5;

        const titleMaxW = Math.max(8, innerW - leftGutter - valPillW - 2.4);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.9);
        const titleLines = pdfWrapLines(doc, titleRaw, titleMaxW, compactMode ? 1 : 2);

        let commentLines = [];
        const hasNoteBox = (showComments && cmt.hasAny) || cellTasks.length > 0;
        if (hasNoteBox) {
          const noteParts = [];
          const hasBullets = /^\s*(?:•|-\s+)/m.test(String(cmt.direct || '')) || cellTasks.length > 0;
          if (showComments && cmt.direct) {
            noteParts.push(hasBullets ? cmt.direct.trim() : cmt.direct.replace(/\n+/g, ' / '));
          }
          if (showComments && cmt.weekEntries.length > 0) {
            cmt.weekEntries.slice(0, compactMode ? 1 : 2).forEach(we => {
              noteParts.push(`${we.weekShort}: ${we.text.replace(/\n+/g, ' / ')}`);
            });
          }
          if (cellTasks.length > 0) {
            const shownTasks = cellTasks.slice(0, compactMode ? 2 : 4);
            shownTasks.forEach(t => {
              const mark = t.dropped ? '[-]' : (t.done ? '[x]' : '[ ]');
              const rollTag = t.rollCount > 0 ? ` (R${t.rollCount})` : '';
              noteParts.push(`${mark} ${t.text}${rollTag}`);
            });
            if (cellTasks.length > shownTasks.length) {
              noteParts.push(`+${cellTasks.length - shownTasks.length} more task(s)`);
            }
          }
          const combinedNote = noteParts.join(hasBullets ? '\n' : ' | ');
          const commentInnerW = Math.max(8, innerW - (isFilled ? 3.2 : 4.4) - 1.8);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5.2);
          commentLines = pdfWrapLines(doc, combinedNote, commentInnerW, compactMode ? (hasBullets ? 3 : 1) : (hasBullets ? 6 : 2));
        }

        const topRowH = Math.max(3.4, titleLines.length * 2.45);
        const commentBoxH = commentLines.length > 0 ? (1.2 + commentLines.length * 2.15 + 0.9) : 0;
        const cardH = 1.2 + topRowH + (commentBoxH > 0 ? 0.9 + commentBoxH : 0) + 1.1;

        cards.push({
          isFilled, isNoteOnly: !a.hasData, identityRgb: pdfHexToRgb(item.color, [79, 70, 229]),
          showIdentityDot, tier3, theme, valText, valPillW, leftGutter, titleMaxW, titleLines,
          commentLines, commentBoxH, height: cardH,
        });
      });

      const msRawList = axis === 'department'
        ? []
        : getMilestonesInPeriod(pk, ui.timeUnit, db.milestones).filter(m => m.projectId === row.id);

      const milestones = msRawList.map(m => {
        const msTextMaxW = Math.max(8, innerW - 5.4);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        const lines = pdfWrapLines(doc, `${m.title} (${m.date || ''})`, msTextMaxW, compactMode ? 1 : 2);
        return { lines, textMaxW: msTextMaxW, height: 1.0 + lines.length * 2.3 + 1.0 };
      });

      const cardGap = 1.2;
      let totalH = cursorH;
      cards.forEach(c => { totalH += c.height + cardGap; });
      milestones.forEach(m => { totalH += m.height + cardGap; });
      totalH += padY;

      if (totalH > maxCellH && !compactMode) {
        return measurePdfMatrixCell(doc, row, pk, axis, colW, db, visibleDepts, visibleProjs, colorMode, warnT, overT, showComments, true);
      }

      let finalCards = cards;
      let finalMilestones = milestones;
      let overflowCount = 0;

      if (totalH > maxCellH) {
        const budgetH = maxCellH - padY - 5.2;
        let usedH = cursorH;
        finalCards = [];
        for (const c of cards) {
          if (usedH + c.height + cardGap <= budgetH) { finalCards.push(c); usedH += c.height + cardGap; }
          else overflowCount++;
        }
        finalMilestones = [];
        for (const m of milestones) {
          if (usedH + m.height + cardGap <= budgetH) { finalMilestones.push(m); usedH += m.height + cardGap; }
          else overflowCount++;
        }
        totalH = usedH + (overflowCount > 0 ? 4.4 : 0) + padY;
      }

      return {
        height: Math.max(15, totalH), padX, padY, innerW, cardGap, cellBgRgb, header,
        cards: finalCards, milestones: finalMilestones, overflowCount,
      };
    }

    function drawPdfMatrixCell(doc, cell, layout) {
      const x0 = cell.x + layout.padX;
      const innerW = Math.max(10, cell.width - layout.padX * 2);
      let cy = cell.y + layout.padY;

      if (layout.header.kind === 'milestones') {
        cy += 0.5;
      } else if (layout.header.kind === 'dept') {
        const h = layout.header;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.7);
        const pctPillW = Math.min(innerW * 0.34, Math.max(7.2, doc.getTextWidth(h.pctLabel) + 2.4));
        const pctPillX = x0 + innerW - pctPillW;

        doc.setFillColor(...h.pctBgRgb);
        doc.roundedRect(pctPillX, cy, pctPillW, 3.2, 0.7, 0.7, 'F');
        doc.setTextColor(...h.pctTextRgb);
        doc.text(pdfFitText(doc, h.pctLabel, pctPillW - 1.0), pctPillX + pctPillW / 2, cy + 2.25, { align: 'center' });

        const varW = h.hasOverride ? 5.6 : 0;
        const leftMaxW = Math.max(6, innerW - pctPillW - varW - (h.hasOverride ? 2.0 : 1.2));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.7);
        doc.setTextColor(71, 85, 105);
        const leftFitted = pdfFitText(doc, h.leftText, leftMaxW);
        doc.text(leftFitted, x0, cy + 2.25);

        if (h.hasOverride) {
          const varX = Math.min(pctPillX - varW - 0.8, x0 + doc.getTextWidth(leftFitted) + 1.0);
          if (varX > x0 + 2) {
            doc.setFillColor(224, 242, 254);
            doc.setDrawColor(125, 211, 252);
            doc.setLineWidth(0.18);
            doc.roundedRect(varX, cy + 0.1, 5.2, 2.9, 0.6, 0.6, 'FD');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(4.9);
            doc.setTextColor(3, 105, 161);
            doc.text('Var', varX + 2.6, cy + 2.15, { align: 'center' });
          }
        }

        const barY = cy + 3.9;
        doc.setFillColor(226, 232, 240);
        doc.roundedRect(x0, barY, innerW, 1.5, 0.7, 0.7, 'F');
        const fillW = Math.min(innerW, Math.max(0, (Math.min(100, h.pct) / 100) * innerW));
        if (fillW > 0.3) {
          doc.setFillColor(...h.barRgb);
          doc.roundedRect(x0, barY, Math.max(1.2, fillW), 1.5, 0.7, 0.7, 'F');
        }
        cy += 6.6;
      } else {
        const h = layout.header;
        doc.setFont('helvetica', h.hasTotal ? 'bold' : 'normal');
        doc.setFontSize(5.8);
        doc.setTextColor(h.hasTotal ? 30 : 148, h.hasTotal ? 41 : 163, h.hasTotal ? 59 : 184);
        doc.text(pdfFitText(doc, h.totalText, innerW), x0, cy + 2.5);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.line(x0, cy + 3.6, x0 + innerW, cy + 3.6);
        cy += 4.6;
      }

      layout.cards.forEach(c => {
        const cardH = c.height;
        if (c.isFilled) {
          doc.setFillColor(...c.theme.bgRgb);
          doc.setDrawColor(...c.theme.borderRgb);
          doc.setLineWidth(0.25);
          if (c.isNoteOnly && typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([1.2, 1.0], 0);
          doc.roundedRect(x0, cy, innerW, cardH, 1.2, 1.2, 'FD');
          if (c.isNoteOnly && typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
        } else {
          doc.setFillColor(255, 255, 255);
          doc.setDrawColor(203, 213, 225);
          doc.setLineWidth(0.22);
          doc.roundedRect(x0, cy, innerW, cardH, 1.0, 1.0, 'FD');
          doc.setFillColor(...c.identityRgb);
          doc.roundedRect(x0 + 0.1, cy + 0.1, 1.5, Math.max(0.5, cardH - 0.2), 0.6, 0.6, 'F');
        }

        let tx = x0 + c.leftGutter;
        if (c.isFilled && c.showIdentityDot) {
          doc.setFillColor(...c.identityRgb);
          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.28);
          doc.circle(x0 + 2.3, cy + 2.5, 0.85, 'FD');
        }
        if (c.isFilled && c.tier3 && c.tier3.tier !== 'note') {
          drawPdfVectorTierIcon(doc, c.tier3.tier, x0 + 4.9, cy + 2.5, 2.0, c.theme.textRgb);
        }

        const vpX = x0 + innerW - c.valPillW - 1.1;
        const vpY = cy + 1.0;
        if (c.isFilled) {
          doc.setFillColor(...c.theme.pillBgRgb);
          doc.roundedRect(vpX, vpY, c.valPillW, 3.0, 0.6, 0.6, 'F');
          doc.setTextColor(...c.theme.pillTextRgb);
        } else {
          doc.setFillColor(241, 245, 249);
          doc.roundedRect(vpX, vpY, c.valPillW, 3.0, 0.6, 0.6, 'F');
          doc.setTextColor(15, 23, 42);
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.7);
        doc.text(pdfFitText(doc, c.valText, c.valPillW - 1.0), vpX + c.valPillW / 2, vpY + 2.15, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.9);
        if (c.isFilled) doc.setTextColor(...c.theme.textRgb);
        else doc.setTextColor(30, 41, 59);
        let ly = cy + 3.0;
        c.titleLines.forEach(line => {
          doc.text(pdfFitText(doc, line, c.titleMaxW), tx, ly);
          ly += 2.45;
        });

        if (c.commentLines.length > 0) {
          const cBoxX = x0 + (c.isFilled ? 1.3 : 2.3);
          const cBoxW = Math.max(8, innerW - (c.isFilled ? 2.6 : 3.4));
          const cBoxY = cy + 1.2 + Math.max(3.4, c.titleLines.length * 2.45) + 0.6;
          if (c.isFilled) {
            doc.setFillColor(...c.theme.commentBgRgb);
            doc.setDrawColor(...c.theme.commentBorderRgb);
          } else {
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(226, 232, 240);
          }
          doc.setLineWidth(0.18);
          doc.roundedRect(cBoxX, cBoxY, cBoxW, c.commentBoxH, 0.7, 0.7, 'FD');

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(5.2);
          if (c.isFilled) doc.setTextColor(...c.theme.commentTextRgb);
          else doc.setTextColor(71, 85, 105);
          let cly = cBoxY + 2.1;
          c.commentLines.forEach(line => {
            doc.text(pdfFitText(doc, line, cBoxW - 1.6), cBoxX + 0.9, cly);
            cly += 2.15;
          });
        }

        cy += cardH + layout.cardGap;
      });

      layout.milestones.forEach(m => {
        doc.setFillColor(245, 243, 255);
        doc.setDrawColor(196, 181, 253);
        doc.setLineWidth(0.22);
        doc.roundedRect(x0, cy, innerW, m.height, 0.9, 0.9, 'FD');
        drawPdfVectorDiamond(doc, x0 + 2.3, cy + 2.1, 0.95, [139, 92, 246], [109, 40, 217]);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(76, 29, 149);
        let mly = cy + 2.65;
        m.lines.forEach(line => {
          doc.text(pdfFitText(doc, line, m.textMaxW), x0 + 4.3, mly);
          mly += 2.3;
        });
        cy += m.height + layout.cardGap;
      });

      if (layout.overflowCount > 0) {
        doc.setFillColor(241, 245, 249);
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.2);
        doc.roundedRect(x0, cy, innerW, 3.6, 0.7, 0.7, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.4);
        doc.setTextColor(71, 85, 105);
        doc.text(
          pdfFitText(doc, `+${layout.overflowCount} more item(s) - see Portfolio/Appendix`, innerW - 2),
          x0 + innerW / 2,
          cy + 2.45,
          { align: 'center' }
        );
      }
    }

    async function generateRoadmapPDF(opts = {}) {
      const db = getActiveDB();
      const periods = getPdfExportPeriods(opts);

      if (!window.jspdf || !window.jspdf.jsPDF) {
        showToast('Offline PDF fallback: opening print dialog (select "Save as PDF")...', 'info');
        const wasDark = ui.darkMode;
        if (wasDark) document.documentElement.classList.remove('dark');
        setTimeout(() => {
          window.print();
          if (wasDark) document.documentElement.classList.add('dark');
        }, 120);
        return;
      }

      try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const marginX = 12;
        const tableW = pageW - marginX * 2;
        const safeMargin = { top: 14, right: marginX, bottom: 14, left: marginX };

        const warnT = db.settings.warnThreshold || 85;
        const overT = db.settings.overThreshold || 100;
        const dpw = db.settings.daysPerWeek || 5;
        const hpd = db.settings.hoursPerDay || 8;
        const colorMode = (!opts.colorMode || opts.colorMode === 'match')
          ? getActiveCellColorMode()
          : opts.colorMode;
        const colsPerPage = Math.max(3, Math.min(6, parseInt(opts.colsPerPage, 10) || 6));

        const visibleDepts = db.departments.filter(d => ui.filterDept === 'all' || d.id === ui.filterDept);
        const visibleProjs = getSortedProjects(db).filter(p => (!p.archived || ui.filterProj === p.id) && (ui.filterProj === 'all' || p.id === ui.filterProj));
        const rows = ui.axis === 'department' ? visibleDepts : visibleProjs;

        const ensureSpace = (neededMm, curY) => {
          if (curY + neededMm > pageH - 14) {
            doc.addPage();
            return 14;
          }
          return curY;
        };

        const drawSectionHeading = (title, subtitle, curY) => {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.3);
          const subLines = subtitle ? pdfWrapLines(doc, subtitle, tableW, 2) : [];
          const needed = 10 + subLines.length * 3.2;
          const y = ensureSpace(needed + 10, curY);

          doc.setFillColor(79, 70, 229);
          doc.roundedRect(marginX, y - 3.0, 1.5, 4.0, 0.5, 0.5, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.8);
          doc.setTextColor(15, 23, 42);
          doc.text(pdfFitText(doc, title, tableW - 4), marginX + 3.2, y);

          let nextY = y + 3.2;
          if (subLines.length > 0) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.2);
            doc.setTextColor(100, 116, 139);
            subLines.forEach(line => {
              doc.text(line, marginX + 3.2, nextY + 0.8);
              nextY += 3.2;
            });
          }
          return nextY + 1.5;
        };

        const axisLbl = ui.axis === 'department' ? 'By Department' : 'By Project';
        const modeLbl = ui.demoMode ? 'DEMO SANDBOX' : 'LIVE DATABASE';
        const periodRange = periods.length
          ? `${formatPeriodHeader(periods[0], ui.timeUnit).title} to ${formatPeriodHeader(periods[periods.length - 1], ui.timeUnit).title}`
          : '';
        const deptFilterLbl = ui.filterDept === 'all' ? 'All Depts' : (db.departments.find(d => d.id === ui.filterDept)?.name || ui.filterDept);
        const projFilterLbl = ui.filterProj === 'all' ? 'All Projects' : (db.projects.find(p => p.id === ui.filterProj)?.code || ui.filterProj);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        const titleLines = pdfWrapLines(doc, opts.title || 'PulsePlan - Company Roadmap & Utilisation Report', tableW, 2);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.4);
        const meta1 = `${modeLbl} (Rev ${db.meta?.revision || 1})  |  View: ${axisLbl}  |  Horizon: ${periodRange} (${periods.length} ${ui.timeUnit}s)  |  Unit: ${unitShortLabel()}  |  Filters: ${deptFilterLbl}, ${projFilterLbl}`;
        const meta2 = `Basis: 1.0 FTE = ${dpw}d/wk (${dpw * hpd}h/wk)  |  Thresholds: Warn >=${warnT}%, Over >${overT}%  |  Author: ${ui.userName || 'PM'}  |  Generated: ${new Date().toLocaleString()}`;
        const metaLines = [
          ...pdfWrapLines(doc, meta1, tableW, 2),
          ...pdfWrapLines(doc, meta2, tableW, 2),
        ];

        const bannerH = 5.5 + titleLines.length * 5.0 + metaLines.length * 3.4 + 3.0;
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageW, bannerH, 'F');
        doc.setFillColor(99, 102, 241);
        doc.rect(0, 0, pageW, 1.4, 'F');

        let by = 7.4;
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        titleLines.forEach(line => { doc.text(line, marginX, by); by += 5.0; });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.4);
        doc.setTextColor(203, 213, 225);
        metaLines.forEach(line => { doc.text(line, marginX, by); by += 3.4; });

        let sumAllocFte = 0, sumCapFte = 0, sumAllocDisp = 0, sumCapDisp = 0, overSlots = 0, highSlots = 0;
        const periodStats = periods.map(pk => {
          let a = 0, c = 0;
          visibleDepts.forEach(d => {
            const da = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
            const dc = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
            a += da; c += dc;
            const dpct = dc > 0 ? Math.round((da / dc) * 100) : (da > 0 ? 999 : 0);
            if (dpct > overT) overSlots++;
            else if (dpct >= warnT) highSlots++;
          });
          const aDisp = fteToDisplayValue(a, pk, ui.timeUnit);
          const cDisp = fteToDisplayValue(c, pk, ui.timeUnit);
          sumAllocFte += a; sumCapFte += c;
          sumAllocDisp += aDisp; sumCapDisp += cDisp;
          const pct = c > 0 ? Math.round((a / c) * 100) : 0;
          return { pk, label: formatPeriodHeader(pk, ui.timeUnit).title, allocDisp: aDisp, capDisp: cDisp, pct };
        });

        const avgOrgPct = sumCapFte > 0 ? Math.round((sumAllocFte / sumCapFte) * 100) : 0;
        const slippedMs = db.milestones.filter(m => getMilestoneDriftDays(m) > 0 && m.status !== 'Completed').length;
        const totalAllocLabel = ui.manpowerUnit === 'fte'
          ? `${formatValue(periods.length ? sumAllocFte / periods.length : 0, 'fte')} avg`
          : formatValue(sumAllocDisp);
        const totalCapLabel = ui.manpowerUnit === 'fte'
          ? `${formatValue(periods.length ? sumCapFte / periods.length : 0, 'fte')} avg`
          : formatValue(sumCapDisp);

        let currentY = bannerH + 4;
        const kpiGap = 4;
        const kpiW = (tableW - kpiGap * 3) / 4;
        const kpiCards = [
          {
            label: 'AVG ORG UTILISATION', value: `${avgOrgPct}%`,
            sub: `Across ${periods.length} ${ui.timeUnit}${periods.length === 1 ? '' : 's'}`,
            accent: avgOrgPct > overT ? [225, 29, 72] : avgOrgPct >= warnT ? [217, 119, 6] : [5, 150, 105],
          },
          {
            label: 'BOTTLENECK & HIGH SLOTS', value: `${overSlots} Over`,
            sub: `${highSlots} high-load (>=${warnT}%) slots`,
            accent: overSlots > 0 ? [225, 29, 72] : [30, 41, 59],
          },
          {
            label: `LOAD VS. CAPACITY (${unitShortLabel().toUpperCase()})`, value: totalAllocLabel,
            sub: `Available cap: ${totalCapLabel}`,
            accent: [79, 70, 229],
          },
          {
            label: 'MILESTONES HEALTH', value: `${db.milestones.length - slippedMs} / ${db.milestones.length}`,
            sub: `${slippedMs} slipped vs. baseline`,
            accent: slippedMs > 0 ? [217, 119, 6] : [5, 150, 105],
          },
        ];

        kpiCards.forEach((card, idx) => {
          const x = marginX + idx * (kpiW + kpiGap);
          const textMaxW = kpiW - 6.5;
          doc.setFillColor(248, 250, 252);
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.25);
          doc.roundedRect(x, currentY, kpiW, 16, 2, 2, 'FD');
          doc.setFillColor(...card.accent);
          doc.roundedRect(x, currentY, 2.0, 16, 0.8, 0.8, 'F');

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.2);
          doc.setTextColor(100, 116, 139);
          doc.text(pdfFitText(doc, card.label, textMaxW), x + 4.2, currentY + 4.4);

          doc.setTextColor(...card.accent);
          pdfFitFontText(doc, card.value, x + 4.2, currentY + 10.4, textMaxW, 11, 7.5, 'bold');

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          doc.setTextColor(100, 116, 139);
          doc.text(pdfFitText(doc, card.sub, textMaxW), x + 4.2, currentY + 14.3);
        });
        currentY += 20;

        if (opts.includeChart) {
          currentY = drawPdfLoadVsCapacityChart(doc, periodStats, currentY, pageW, overT, warnT);
        }

        if (opts.includeMatrix && rows.length > 0) {
          const modeTitleMap = {
            accent: 'Accent Stripe Cards',
            fill: 'Full Color Fill Cards',
            fte: '6-Tier FTE Heat Cards',
            fte3: '3-Level Demand (Green / Yellow / Red) Cards',
          };
          currentY = drawSectionHeading(
            `Roadmap Matrix (${axisLbl})`,
            `Style: ${modeTitleMap[colorMode] || 'Colorful Cards'}  |  ${colsPerPage} periods per page  |  Unit: ${unitShortLabel()}`,
            currentY
          );
          currentY = drawPdfColorLegendStrip(doc, currentY, pageW, colorMode, db, warnT, overT);

          const rowColW = 44;
          const curMonthKey = getCurrentMonthKey();
          const curWeekKey = getCurrentWeekKey();

          for (let startIdx = 0; startIdx < periods.length; startIdx += colsPerPage) {
            const chunk = periods.slice(startIdx, startIdx + colsPerPage);
            const periodColW = (tableW - rowColW) / chunk.length;

            if (startIdx > 0) {
              doc.addPage();
              currentY = 14;
              currentY = drawSectionHeading(
                `Roadmap Matrix (${axisLbl}) - Continued`,
                `${formatPeriodHeader(chunk[0], ui.timeUnit).title} to ${formatPeriodHeader(chunk[chunk.length - 1], ui.timeUnit).title}`,
                currentY
              );
            }

            const pdfMatrixRows = ui.axis === 'department'
              ? [{
                  id: '__MILESTONES__',
                  name: 'Milestones',
                  code: 'MS',
                  color: '#7c3aed',
                  totalCount: chunk.reduce((acc, pk) => acc + getVisibleMilestonesForDeptView(pk, db, visibleProjs).length, 0),
                }, ...rows]
              : rows;

            const rowHeaderLayouts = [];
            const cellLayouts = [];
            const rowHeights = [];

            pdfMatrixRows.forEach((row) => {
              const hdrLayout = measurePdfRowHeader(doc, row, ui.axis, chunk, rowColW, db, warnT, overT);
              rowHeaderLayouts.push(hdrLayout);
              const rCells = chunk.map(pk =>
                measurePdfMatrixCell(doc, row, pk, ui.axis, periodColW, db, visibleDepts, visibleProjs, colorMode, warnT, overT, Boolean(ui.showCellComments), false)
              );
              cellLayouts.push(rCells);
              rowHeights.push(Math.max(hdrLayout.height, ...rCells.map(c => c.height)));
            });

            const headRow = [
              ui.axis === 'department' ? 'Department' : 'Project',
              ...chunk.map(pk => {
                const h = formatPeriodHeader(pk, ui.timeUnit);
                const isNow = (ui.timeUnit === 'month' && pk === curMonthKey) || (ui.timeUnit === 'week' && pk === curWeekKey);
                return pdfSafeText(`${h.title}${isNow ? ' [NOW]' : ''}\n(${h.sub})`);
              })
            ];

            const blankBodyRows = pdfMatrixRows.map(() => ['', ...chunk.map(() => '')]);

            const footPcts = [null];
            const footRow = [
              pdfSafeText(`Company Total (${unitShortLabel()})`),
              ...chunk.map(pk => {
                let totA = 0, totC = 0;
                visibleDepts.forEach(d => {
                  totA += getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
                  totC += getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db).avgFte;
                });
                const pct = totC > 0 ? Math.round((totA / totC) * 100) : 0;
                footPcts.push(pct);
                return pdfSafeText(`${formatValue(fteToDisplayValue(totA, pk, ui.timeUnit))} (${pct}%)\nCap: ${formatValue(fteToDisplayValue(totC, pk, ui.timeUnit))}`);
              })
            ];

            const colStyles = { 0: { cellWidth: rowColW } };
            chunk.forEach((_, idx) => { colStyles[idx + 1] = { cellWidth: periodColW }; });

            doc.autoTable({
              startY: currentY,
              head: [headRow],
              body: blankBodyRows,
              foot: [footRow],
              margin: safeMargin,
              tableWidth: tableW,
              rowPageBreak: 'avoid',
              theme: 'grid',
              styles: { fontSize: 6.5, cellPadding: 0, valign: 'top', lineColor: [203, 213, 225], lineWidth: 0.25, textColor: [30, 41, 59] },
              headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.2, cellPadding: 2.2 },
              footStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.6, cellPadding: 2.0 },
              columnStyles: colStyles,
              didParseCell: (data) => {
                if (data.section === 'head' && data.column.index > 0) {
                  const pk = chunk[data.column.index - 1];
                  const isNow = (ui.timeUnit === 'month' && pk === curMonthKey) || (ui.timeUnit === 'week' && pk === curWeekKey);
                  if (isNow) data.cell.styles.fillColor = [67, 56, 202];
                } else if (data.section === 'body') {
                  data.cell.styles.minCellHeight = rowHeights[data.row.index];
                  if (data.column.index === 0) data.cell.styles.fillColor = [248, 250, 252];
                  else {
                    const layout = cellLayouts[data.row.index]?.[data.column.index - 1];
                    if (layout) data.cell.styles.fillColor = layout.cellBgRgb;
                  }
                } else if (data.section === 'foot' && data.column.index > 0) {
                  const pct = footPcts[data.column.index];
                  if (typeof pct === 'number') {
                    if (pct > overT) data.cell.styles.textColor = [253, 164, 175];
                    else if (pct >= warnT) data.cell.styles.textColor = [252, 211, 77];
                    else data.cell.styles.textColor = [110, 231, 183];
                  }
                }
              },
              didDrawCell: (data) => {
                if (data.section !== 'body') return;
                if (data.column.index === 0) {
                  const hdrLayout = rowHeaderLayouts[data.row.index];
                  if (hdrLayout) drawPdfRowHeader(doc, data.cell, hdrLayout);
                } else {
                  const cLayout = cellLayouts[data.row.index]?.[data.column.index - 1];
                  if (cLayout) drawPdfMatrixCell(doc, data.cell, cLayout);
                }
              },
            });

            currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 45;
          }
        }

        if (opts.includeDeptHealth && visibleDepts.length > 0) {
          currentY = drawSectionHeading('Department Health & Variable Capacity Overrides', 'Utilisation averages, peak load, overload counts, and non-default capacity overrides across the visible horizon.', currentY);
          const deptRows = visibleDepts.map(d => {
            let sA = 0, sC = 0, peak = 0, overCnt = 0;
            const overrides = [];
            periods.forEach(pk => {
              const a = getDeptTotalAllocatedFte(d.id, pk, ui.timeUnit, db);
              const capObj = getDeptCapacityForPeriod(d.id, pk, ui.timeUnit, db);
              sA += a; sC += capObj.avgFte;
              const pct = capObj.avgFte > 0 ? Math.round((a / capObj.avgFte) * 100) : (a > 0 ? 999 : 0);
              if (pct > peak) peak = pct;
              if (pct > overT) overCnt++;
              if (capObj.hasOverride) overrides.push(`${formatPeriodHeader(pk, ui.timeUnit).title}: ${Math.round(capObj.avgFte * 100) / 100} FTE`);
            });
            const avg = sC > 0 ? Math.round((sA / sC) * 100) : 0;
            return [pdfSafeText(`[${d.code}] ${d.name}`), pdfSafeText(d.manager || '-'), `${d.defaultCapacity} FTE`, `${avg}%`, peak > 990 ? '>100%' : `${peak}%`, String(overCnt), pdfSafeText(overrides.length ? overrides.join(', ') : 'None (default)')];
          });

          doc.autoTable({
            startY: currentY,
            head: [['Department', 'Manager / Lead', 'Base Cap', 'Avg Util.', 'Peak Util.', 'Over Slots', 'Variable Capacity Overrides']],
            body: deptRows,
            margin: safeMargin,
            tableWidth: tableW,
            theme: 'striped',
            styles: { fontSize: 7.1, cellPadding: 2, overflow: 'linebreak', textColor: [30, 41, 59] },
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold' }, 1: { cellWidth: 34 }, 2: { cellWidth: 22 }, 3: { cellWidth: 20, halign: 'right' }, 4: { cellWidth: 20, halign: 'right' }, 5: { cellWidth: 20, halign: 'center' }, 6: { cellWidth: 111 } },
            didParseCell: (data) => {
              if (data.section === 'body' && data.column.index === 4) {
                const raw = parseInt(String(data.cell.raw || '0').replace(/[^0-9]/g, ''), 10);
                if (raw > overT || String(data.cell.raw).startsWith('>')) { data.cell.styles.textColor = [225, 29, 72]; data.cell.styles.fontStyle = 'bold'; }
                else if (raw >= warnT) { data.cell.styles.textColor = [217, 119, 6]; data.cell.styles.fontStyle = 'bold'; }
              }
            }
          });
          currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 35;
        }

        if (opts.includeProjectPortfolio && visibleProjs.length > 0) {
          currentY = drawSectionHeading('Project Portfolio & Effort Summary', `Full directory of project codes, owners, statuses, and total allocated effort across the visible horizon (${unitShortLabel()}).`, currentY);
          const projTotals = visibleProjs.map(p => {
            let pDays = 0, pDispSum = 0, pFteSum = 0;
            const deptsSet = new Set();
            periods.forEach(pk => {
              let pkFte = 0;
              visibleDepts.forEach(d => {
                const a = getAllocationForPeriod(d.id, p.id, pk, ui.timeUnit, db.allocations);
                if (a.hasData) { pkFte += a.avgFte; deptsSet.add(d.code); }
              });
              pFteSum += pkFte;
              pDays += fteToDisplayValue(pkFte, pk, ui.timeUnit, 'days');
              pDispSum += fteToDisplayValue(pkFte, pk, ui.timeUnit, ui.manpowerUnit);
            });
            return { p, pDays, pDispSum, pFteAvg: periods.length ? pFteSum / periods.length : 0, depts: [...deptsSet] };
          });
          const grandDays = projTotals.reduce((acc, x) => acc + x.pDays, 0);

          const projRows = projTotals.map(x => {
            const sharePct = grandDays > 0 ? Math.round((x.pDays / grandDays) * 100) : 0;
            const effortStr = ui.manpowerUnit === 'fte' ? `${formatValue(x.pFteAvg, 'fte')} avg (${Math.round(x.pDays)}d)` : formatValue(x.pDispSum);
            return [pdfSafeText(x.p.code), pdfSafeText(x.p.name), pdfSafeText(x.p.status), pdfSafeText(x.p.priority || 'Medium'), pdfSafeText(x.p.owner || '-'), pdfSafeText(x.p.techLead || '-'), pdfSafeText(effortStr), `${sharePct}%`, pdfSafeText(x.depts.length ? x.depts.join(', ') : '-')];
          });

          doc.autoTable({
            startY: currentY,
            head: [['Code', 'Project Name', 'Status', 'Priority', 'Owner', 'Tech Lead', `Horizon Effort (${unitShortLabel()})`, 'Share', 'Assigned Depts']],
            body: projRows,
            margin: safeMargin,
            tableWidth: tableW,
            theme: 'striped',
            styles: { fontSize: 7.0, cellPadding: 2, overflow: 'linebreak', textColor: [30, 41, 59] },
            headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 15, fontStyle: 'bold' }, 1: { cellWidth: 52 }, 2: { cellWidth: 20 }, 3: { cellWidth: 18 }, 4: { cellWidth: 26 }, 5: { cellWidth: 26 }, 6: { cellWidth: 40 }, 7: { cellWidth: 15, halign: 'right' }, 8: { cellWidth: 61 } },
          });
          currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 35;
        }

        if (opts.includeMilestones && db.milestones.length > 0) {
          currentY = drawSectionHeading('Milestones & Schedule Drift Summary', 'Comparison of current target dates against original baselines.', currentY);
          const msBody = db.milestones.map(m => {
            const p = db.projects.find(x => x.id === m.projectId);
            const d = db.departments.find(x => x.id === m.deptId);
            const drift = getMilestoneDriftDays(m);
            const driftLabel = drift === 0 ? 'On Plan' : (drift > 0 ? `+${drift}d Slip` : `${drift}d Early`);
            return [pdfSafeText(m.title), pdfSafeText(p ? `[${p.code}] ${p.name}` : '-'), pdfSafeText(d ? d.name : 'Auto'), pdfSafeText(m.baselineDate || '-'), pdfSafeText(m.date || '-'), driftLabel, pdfSafeText(m.status || 'Pending'), pdfSafeText(m.notes || '-')];
          });

          doc.autoTable({
            startY: currentY,
            head: [['Milestone', 'Project', 'Department', 'Baseline', 'Target', 'Drift', 'Status', 'Notes']],
            body: msBody,
            margin: safeMargin,
            tableWidth: tableW,
            theme: 'striped',
            styles: { fontSize: 7.0, cellPadding: 2, overflow: 'linebreak', textColor: [30, 41, 59] },
            headStyles: { fillColor: [109, 40, 217], textColor: [255, 255, 255], fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold' }, 1: { cellWidth: 46 }, 2: { cellWidth: 28 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 }, 5: { cellWidth: 22 }, 6: { cellWidth: 22 }, 7: { cellWidth: 65 } },
            didParseCell: (data) => {
              if (data.section === 'body' && data.column.index === 5) {
                const txt = String(data.cell.raw || '');
                if (txt.includes('Slip')) { data.cell.styles.textColor = [225, 29, 72]; data.cell.styles.fontStyle = 'bold'; }
                else if (txt.includes('Early') || txt === 'On Plan') { data.cell.styles.textColor = [5, 150, 105]; data.cell.styles.fontStyle = 'bold'; }
              }
            }
          });
          currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 35;
        }

        if (opts.includeCommentsAppendix) {
          const commentRows = [];
          periods.forEach(pk => {
            const pTitle = formatPeriodHeader(pk, ui.timeUnit).title;
            visibleDepts.forEach(d => {
              visibleProjs.forEach(p => {
                const cmt = getCellProjectComments(d.id, p.id, pk, ui.timeUnit, db);
                if (cmt.direct) commentRows.push([pdfSafeText(pTitle), pdfSafeText(`[${d.code}] ${d.name}`), pdfSafeText(`[${p.code}] ${p.name}`), pdfSafeText(cmt.direct)]);
                cmt.weekEntries.forEach(we => commentRows.push([pdfSafeText(`${pTitle} (${we.weekShort})`), pdfSafeText(`[${d.code}] ${d.name}`), pdfSafeText(`[${p.code}] ${p.name}`), pdfSafeText(we.text)]));
              });
            });
          });
          if (commentRows.length > 0) {
            currentY = drawSectionHeading('Cell Comments & Notes Appendix (Full Text)', 'Complete untruncated monthly and nested weekly notes for the visible horizon.', currentY);
            doc.autoTable({
              startY: currentY,
              head: [['Period', 'Department', 'Project', 'Comment / Note']],
              body: commentRows,
              margin: safeMargin,
              tableWidth: tableW,
              theme: 'striped',
              styles: { fontSize: 7.1, cellPadding: 2, overflow: 'linebreak', textColor: [30, 41, 59] },
              headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
              columnStyles: { 0: { cellWidth: 30, fontStyle: 'bold' }, 1: { cellWidth: 44 }, 2: { cellWidth: 52 }, 3: { cellWidth: 147 } },
            });
            currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 35;
          }
        }

        if (opts.includeTasksAppendix !== false && typeof ppComputeWeeklyTaskStats === 'function') {
          const tStats = ppComputeWeeklyTaskStats(db, periods, ui.timeUnit, visibleDepts.map(d => d.id), visibleProjs.map(p => p.id));
          if (tStats.total > 0) {
            const deptMap = new Map(visibleDepts.map(d => [d.id, d]));
            const projMap = new Map(visibleProjs.map(p => [p.id, p]));
            const taskRows = tStats.allVisibleTasks
              .slice()
              .sort((a, b) => String(a.currentWeek).localeCompare(String(b.currentWeek)) || (b.rollCount - a.rollCount) || String(a.text).localeCompare(String(b.text)))
              .map(t => {
                const d = deptMap.get(t.deptId);
                const p = projMap.get(t.projectId);
                const status = t.dropped ? 'Dropped' : (t.done ? 'Done' : 'Open');
                return [
                  pdfSafeText(t.currentWeek),
                  pdfSafeText(d ? `[${d.code}] ${d.name}` : t.deptId),
                  pdfSafeText(p ? `[${p.code}] ${p.name}` : t.projectId),
                  pdfSafeText(t.text),
                  status,
                  pdfSafeText(t.originWeek),
                  t.rollCount > 0 ? `${t.rollCount}x` : '0',
                ];
              });

            currentY = drawSectionHeading(
              'Weekly Allocation Tasks & Carry-Over Log',
              `Say-Do Completion: ${tStats.done}/${tStats.activeTotal} (${tStats.sayDoPct}%)  |  Open: ${tStats.open}  |  Rolled Over: ${tStats.rolledOpen}  |  Aging (>=2x): ${tStats.agingOpen}`,
              currentY
            );
            doc.autoTable({
              startY: currentY,
              head: [['Week', 'Department', 'Project', 'Weekly Task', 'Status', 'Origin', 'Rolls']],
              body: taskRows,
              margin: safeMargin,
              tableWidth: tableW,
              theme: 'striped',
              styles: { fontSize: 7.0, cellPadding: 2, overflow: 'linebreak', textColor: [30, 41, 59] },
              headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' },
              columnStyles: {
                0: { cellWidth: 22, fontStyle: 'bold' },
                1: { cellWidth: 40 },
                2: { cellWidth: 46 },
                3: { cellWidth: 111 },
                4: { cellWidth: 18, halign: 'center', fontStyle: 'bold' },
                5: { cellWidth: 22, halign: 'center' },
                6: { cellWidth: 14, halign: 'right', fontStyle: 'bold' },
              },
              didParseCell: (data) => {
                if (data.section !== 'body') return;
                if (data.column.index === 4) {
                  const st = String(data.cell.raw || '');
                  if (st === 'Done') data.cell.styles.textColor = [5, 150, 105];
                  else if (st === 'Dropped') data.cell.styles.textColor = [100, 116, 139];
                  else data.cell.styles.textColor = [79, 70, 229];
                }
                if (data.column.index === 6) {
                  const n = parseInt(String(data.cell.raw || '0'), 10) || 0;
                  if (n >= 2) data.cell.styles.textColor = [225, 29, 72];
                  else if (n === 1) data.cell.styles.textColor = [180, 83, 9];
                }
              },
            });
            currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 35;
          }
        }

        if (opts.includeSnapshotDiff && opts.snapshotId) {
          const stateA = resolveComparisonState(db, opts.snapshotId);
          const stateB = resolveComparisonState(db, '__CURRENT__');
          if (stateA && stateB) {
            const diff = computeSnapshotDiff(db, stateA, stateB, periods, ui.timeUnit, ui.manpowerUnit);
            const k = diff.kpis;
            currentY = drawSectionHeading(
              `Snapshot Comparison: "${stateA.label}" vs. Current Plan`,
              `Net Load Delta: ${formatSignedValue(k.netLoadDelta)} (${k.netLoadPct > 0 ? '+' : ''}${k.netLoadPct}%)  |  Net Cap Delta: ${formatSignedValue(k.netCapDelta)}  |  Cell Changes: ${k.totalChangedCells}  |  Milestones: ${k.msSlipped} slipped, ${k.msEarly} early, ${k.msAdded} added, ${k.msRemoved} removed`,
              currentY
            );

            const projDiffBody = diff.byProject.filter(r => r.hasChange).map(r => [
              pdfSafeText(`[${r.proj.code}] ${r.proj.name}`), pdfSafeText(formatValue(r.totalA)), pdfSafeText(formatValue(r.totalB)),
              pdfSafeText(formatSignedValue(r.delta)), `${r.pct > 0 ? '+' : ''}${r.pct}%`,
              pdfSafeText(r.drivers.map(dr => `${dr.code} ${formatSignedValue(dr.delta)}`).join(', ') || '-'),
            ]);

            if (projDiffBody.length > 0) {
              doc.autoTable({
                startY: currentY,
                head: [['Project Scope Shift', pdfSafeText(`Baseline (${stateA.label})`), 'Current Plan', `Delta (${unitShortLabel()})`, '% Shift', 'Driving Depts']],
                body: projDiffBody,
                margin: safeMargin,
                tableWidth: tableW,
                theme: 'striped',
                styles: { fontSize: 7.0, cellPadding: 2, overflow: 'linebreak', textColor: [30, 41, 59] },
                headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
                columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold' }, 1: { cellWidth: 32, halign: 'right' }, 2: { cellWidth: 32, halign: 'right' }, 3: { cellWidth: 32, halign: 'right' }, 4: { cellWidth: 20, halign: 'right' }, 5: { cellWidth: 95 } },
                didParseCell: (data) => {
                  if (data.section === 'body' && (data.column.index === 3 || data.column.index === 4)) {
                    const txt = String(data.cell.raw || '');
                    if (txt.startsWith('+')) { data.cell.styles.textColor = [225, 29, 72]; data.cell.styles.fontStyle = 'bold'; }
                    else if (txt.startsWith('-')) { data.cell.styles.textColor = [5, 150, 105]; data.cell.styles.fontStyle = 'bold'; }
                  }
                }
              });
              currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 7 : currentY + 30;
            }
          }
        }

        if (opts.includeChangeLog && (db.changeLog || []).length > 0) {
          const limit = opts.changeLogLimit || 15;
          const logs = db.changeLog.slice(0, limit);
          currentY = drawSectionHeading(`Recent Change Log (Latest ${logs.length} of ${db.changeLog.length})`, 'Audit trail of recent allocation, capacity, and milestone updates.', currentY);
          doc.autoTable({
            startY: currentY,
            head: [['Timestamp', 'User', 'Category', 'Change Details']],
            body: logs.map(l => [pdfSafeText(new Date(l.timestamp).toLocaleString()), pdfSafeText(l.user), pdfSafeText(l.type), pdfSafeText(l.summary)]),
            margin: safeMargin,
            tableWidth: tableW,
            theme: 'striped',
            styles: { fontSize: 6.9, cellPadding: 1.8, overflow: 'linebreak', textColor: [30, 41, 59] },
            headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 32, fontStyle: 'bold' }, 2: { cellWidth: 24 }, 3: { cellWidth: 179 } },
          });
        }

        const pageCount = doc.internal.getNumberOfPages();
        const genStamp = pdfSafeText(new Date().toLocaleString());
        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.22);
          doc.line(marginX, pageH - 10, pageW - marginX, pageH - 10);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.1);
          doc.setTextColor(148, 163, 184);
          doc.text(`PulsePlan Roadmap Report  |  Rev ${db.meta?.revision || 1}  |  Generated ${genStamp}`, marginX, pageH - 5.8);
          doc.text(`Page ${i} of ${pageCount}`, pageW - marginX, pageH - 5.8, { align: 'right' });
        }

        const fname = `pulseplan_roadmap_${ui.timeUnit}_${new Date().toISOString().slice(0, 10)}.pdf`;
        const pdfBlob = doc.output('blob');
        const deliveryMode = opts.delivery || (isMobileViewport() ? 'auto' : 'download');
        const outcome = await shareOrDownloadFile(pdfBlob, fname, 'application/pdf', opts.title || 'PulsePlan Roadmap PDF', {
          mode: deliveryMode,
          fileHandle: opts.fileHandle || null,
        });
        if (outcome !== 'cancelled') {
          recordDumpEvent('PDF', fname, pdfBlob ? pdfBlob.size : 0, `${pageCount}p colorful vector report (${periods.length} ${ui.timeUnit}s)`);
          const verb = outcome === 'saved' ? 'PDF saved to disk' : (outcome === 'shared' ? 'PDF shared' : 'PDF downloaded to disk');
          showToast(`${verb} (${pageCount} page${pageCount === 1 ? '' : 's'})`, 'success');
        }
      } catch (err) {
        console.error('PDF export failed:', err);
        showToast('PDF export encountered an error. Try Print to PDF instead.', 'error');
      }
    }

