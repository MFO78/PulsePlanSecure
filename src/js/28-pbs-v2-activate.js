/* PBS v2 - part 6/7: activation layer (project-table buttons, host hooks, compatibility API).
 * Dormant while the legacy module (21-project-pbs.js) is present or the DOM is not a real browser DOM (test.mjs stub);
 * it activates automatically once 21-project-pbs.js is replaced by the stub. Registers nothing else at load. */
(function ppPbsV2Activate() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;
  const P = globalThis.__ppPbsV2;
  if (!P) return;
  if (!P.core || !P.ui || !P.view || !P.data || !P.tree || !P.io || !P.report) {
    if (typeof console !== 'undefined') console.warn('PBS v2: modules incomplete, PBS is disabled.');
    return;
  }
  if (typeof globalThis.openProjectPbsModal === 'function' || globalThis.__ppPbsTestApi) return; // legacy module still active

  const C = P.core;
  const D = P.data;
  const R = P.report;
  const PASS_MSG = 'Set or unlock the single session passphrase shared by your roadmap and all PBS files.';
  const cssEsc = (v) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(v)) : String(v));
  const encFormat = () => ((typeof PP_ENC_FORMAT === 'string' && PP_ENC_FORMAT) ? PP_ENC_FORMAT : 'pulseplan-encrypted-v1');

  /* ---------- Project-table PBS sync status bar & row buttons (Setup & Data -> Projects) ---------- */
  function refreshProjectsSyncBar() {
    const panel = document.getElementById('subtab-projects');
    if (!panel || typeof C.getFolderSyncSummary !== 'function') return;
    const info = C.getFolderSyncSummary();
    let bar = document.getElementById('ppPbsProjectsSyncBar');
    if (!info.supported) {
      if (bar) bar.remove();
      return;
    }
    P.view.injectStyles();
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ppPbsProjectsSyncBar';
      bar.className = 'pp-pbs-syncbar';
      panel.insertBefore(bar, panel.firstChild);
    }
    const esc = P.view.esc;
    let dotColor = '#94a3b8';
    let textHtml = '<strong>PBS Folder Sync:</strong> Local browser cache';
    let actionsHtml = '<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-bar-act="link">Link PBS Folder</button>';
    if (info.connected) {
      dotColor = '#10b981';
      textHtml = `<strong>PBS Auto-Sync:</strong> <span>${esc(info.folderName || 'Shared Folder')}</span> <span style="opacity:.72">(syncing automatically)</span>`;
      actionsHtml = '<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-bar-act="sync">Sync Now</button> <button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-bar-act="link">Change Folder</button>';
    } else if (info.rememberedName) {
      dotColor = '#f59e0b';
      textHtml = `<strong>PBS Folder remembered:</strong> <span>${esc(info.rememberedName)}</span> <span style="opacity:.78">&mdash; click to resume automatic sync</span>`;
      actionsHtml = '<button type="button" class="pp-pbs-btn pp-pbs-btn-xs pp-pbs-btn-primary" data-pbs-bar-act="reconnect">Reconnect PBS Folder</button>';
    } else if (info.dbFolderName) {
      dotColor = '#6366f1';
      textHtml = `<strong>Team PBS Folder:</strong> <span>${esc(info.dbFolderName)}</span> <span style="opacity:.78">&mdash; link folder on this device to auto-sync</span>`;
      actionsHtml = '<button type="button" class="pp-pbs-btn pp-pbs-btn-xs pp-pbs-btn-primary" data-pbs-bar-act="link">Link PBS Folder</button>';
    }
    bar.innerHTML = `<div style="display:flex;align-items:center;gap:.45rem;min-width:0;flex-wrap:wrap"><span class="pp-pbs-syncbar-dot" style="background:${dotColor}" aria-hidden="true"></span><span>${textHtml}</span></div><div style="display:flex;align-items:center;gap:.35rem;flex-shrink:0">${actionsHtml}</div>`;
    if (!bar.__ppWired) {
      bar.__ppWired = true;
      bar.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button[data-pbs-bar-act]') : null;
        if (!btn) return;
        const act = btn.getAttribute('data-pbs-bar-act');
        if (act === 'reconnect') C.reconnectFolder().catch(() => {});
        else if (act === 'link') C.linkFolder().catch(() => {});
        else if (act === 'sync') C.pollFolderBackground({ force: true, notify: true }).catch(() => {});
      });
    }
  }

  function refreshProjectsTableBadges() {
    refreshProjectsSyncBar();
    const tbody = document.getElementById('dataProjectsBody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(tr => {
      const editBtn = tr.querySelector('button[onclick*="openProjectModal("]');
      if (!editBtn) return;
      const m = (editBtn.getAttribute('onclick') || '').match(/openProjectModal\(\s*['"]([^'"]+)['"]\s*\)/);
      if (!m) return;
      const projId = m[1];
      const cell = editBtn.closest('td');
      if (!cell) return;
      const count = C.getItemCount(projId);
      const label = count > 0 ? `PBS (${count})` : 'PBS';
      const project = C.getProject(projId);
      let btn = cell.querySelector(`button[data-pp-pbs-btn="${cssEsc(projId)}"]`);
      if (!btn) {
        P.view.injectStyles();
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pp-pbs-trigger pp-pbs-proj-btn';
        btn.setAttribute('data-pp-pbs-btn', projId);
        btn.title = 'Open separate encrypted Product Breakdown Structure (PBS)';
        btn.addEventListener('click', () => openProjectPbsModal(projId));
        cell.insertBefore(btn, cell.firstChild);
      }
      btn.setAttribute('aria-label', `Product Breakdown Structure for ${project ? project.name : projId}${count > 0 ? `, ${count} item${count === 1 ? '' : 's'}` : ''}`);
      if (btn.textContent !== label) btn.textContent = label;
    });
  }

  /* ---------- Dialog extras: passphrase button (decorates the pure view, wired once per dialog) ---------- */
  const baseBuildDialogHtml = P.view.buildDialogHtml;
  P.view.buildDialogHtml = function buildDialogHtmlWithPassphrase(ctx) {
    const html = baseBuildDialogHtml.call(this, ctx);
    if (typeof openSyncEncryptionDialog !== 'function') return html;
    const marker = '<input type="file" id="ppPbsJsonFileInput"';
    if (!html.includes(marker)) return html;
    const label = C.getSessionPassphrase() ? 'Encryption: on' : 'Set Passphrase';
    const btn = `<button type="button" class="pp-pbs-btn" id="ppPbsPassBtn" title="${PASS_MSG}">${label}</button>\n      `;
    return html.replace(marker, () => btn + marker);
  };

  function wireDialogExtras() {
    const dlg = document.getElementById('ppPbsDialog');
    if (!dlg || dlg.__ppPbsV2Extras) return;
    dlg.__ppPbsV2Extras = true;
    dlg.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('#ppPbsPassBtn') : null;
      if (t && typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog(PASS_MSG);
    });
  }

  async function openProjectPbsModal(projectId) {
    try {
      const pending = P.ui.open(projectId);
      wireDialogExtras();
      await pending;
    } catch (err) {
      if (typeof console !== 'undefined') console.error(err);
      C.toast((err && err.message) || 'Could not open the PBS dialog.', 'error');
    }
  }

  /* ---------- PDF (kept as a standalone entry point for compatibility) ---------- */
  function openPrintView(model) {
    if (typeof window === 'undefined' || typeof window.open !== 'function') return;
    const url = URL.createObjectURL(new Blob([R.buildPrintHtml(model)], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (!w) { C.toast('Popup blocked \u2014 allow popups or connect online for direct PDF export.', 'warning'); return; }
    w.addEventListener('load', () => { w.focus(); w.print(); });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function exportActivePbsPdf() {
    const S = C.state;
    if (!S.activeProjectId || !S.activeDoc) return;
    const project = C.getProject(S.activeProjectId);
    const date = new Date().toISOString().slice(0, 10);
    const model = R.buildReportModel(S.activeDoc, project, C.getDb(), C.getUserName(), date);
    const JsPdf = typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF ? window.jspdf.jsPDF : null;
    if (JsPdf) {
      try {
        const name = R.pdfFilename(project, S.activeProjectId, date);
        R.renderPdf(JsPdf, model).save(name);
        C.toast(`Exported ${name}`, 'success');
        return;
      } catch (err) {
        C.toast((err && err.message) || 'Vector PDF failed; opening print view.', 'warning');
      }
    }
    openPrintView(model);
  }

  /* ---------- Host hooks ---------- */
  if (typeof renderDataTab === 'function') {
    const nativeRenderDataTab = renderDataTab;
    renderDataTab = function (...args) {
      const res = nativeRenderDataTab.apply(this, args);
      refreshProjectsTableBadges();
      const locked = typeof ppIsSessionLocked === 'function' && ppIsSessionLocked();
      const inDemo = typeof ui !== 'undefined' && ui && ui.demoMode;
      if (!locked && !inDemo && typeof C.pollFolderBackground === 'function') {
        C.pollFolderBackground({ force: false, minIntervalMs: 3000 }).catch(() => {});
      }
      return res;
    };
  }

  if (typeof updateSyncEncryptionBadges === 'function') {
    const nativeUpdateEncBadges = updateSyncEncryptionBadges;
    updateSyncEncryptionBadges = function (...args) {
      const res = nativeUpdateEncBadges.apply(this, args);
      P.ui.render();
      refreshProjectsSyncBar();
      return res;
    };
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => {
      if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
      if (typeof ui !== 'undefined' && ui && ui.demoMode) return;
      C.pollFolderBackground({ force: false, minIntervalMs: 2500 }).catch(() => {});
    }, { passive: true });
  }

  if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
    const wn = MANUAL_SECTIONS.find(s => s && s.id === 'whatsnew');
    if (wn && typeof wn.bodyHtml === 'string' && !wn.bodyHtml.includes('Product Breakdown Structure (PBS)')) {
      wn.keywords = `${wn.keywords || ''} pbs product breakdown structure expand fullscreen pdf field selector svg csv folder sync maturity acronym mass power mtbf lru spare manufacturer part number drawings procurement qty quantity renumber undo paste lead time risk`;
      wn.bodyHtml = wn.bodyHtml.replace(
        '</ul>',
        `<li>&bull; <strong>Per-Project Product Breakdown Structure (PBS):</strong> Open <strong>PBS</strong> on any project row in <strong>Setup &amp; Data &rarr; Projects</strong> to build a hierarchical deliverable tree with fullscreen <strong>Expand / Restore</strong> mode, maturity gates, optional engineering/procurement/documentation fields, persisted column-group toggles, automatic non-double-counting SWaP roll-ups, lead-time slip &amp; spares-gap risk alerts, Undo/Redo, auto-renumbering, and Excel paste. Files stay separate (<code class="px-1 rounded bg-white font-mono">pbs_&lt;CODE&gt;.json</code>) and reuse your single AES-256-GCM session passphrase, with Chrome/Edge folder auto-sync, rename migration, password-rotation re-encryption, and per-field conflict merge. Export <strong>CSV</strong>, an <strong>SVG diagram</strong>, or a customizable <strong>PDF</strong> with a per-field selector and quick presets.</li></ul>`
      );
    }
  }

  /* ---------- Public API (same global names as the legacy module) + Lifecycle Hooks ---------- */
  P.ui.setBadgeRefresh(refreshProjectsTableBadges);
  if (C.state && C.state.hooks) C.state.hooks.onBadges = refreshProjectsTableBadges;
  globalThis.openProjectPbsModal = openProjectPbsModal;
  if (typeof window !== 'undefined') {
    window.ppFlushPbsBeforeLock = () => C.flushBeforeLock();
    window.ppClearPbsMemoryAndStopSync = () => {
      P.ui.close();
      C.clearMemoryAndStopSync();
      refreshProjectsTableBadges();
    };
    window.ppReencryptAllPbsFilesInFolder = (oldPass, newPass) => C.reencryptAllPbsFilesInFolder(oldPass, newPass);
    window.ppTryAutoReconnectPbsFolder = (opts) => C.tryAutoReconnectFolder(opts);
    window.ppPollPbsFolderNow = (opts) => C.pollFolderBackground(opts);
    window.ppOnProjectCodeRenamedForPbs = (pid, prevCode, nextCode) => C.onProjectCodeRenamed(pid, prevCode, nextCode);
  }
  globalThis.__ppPbsTestApi = {
    normalizePbsDoc: (raw, project) => D.normalizePbsDoc(raw, project, C.getUserName()),
    encodePbsForDisk: async (doc, requireEncryption) => {
      const res = await D.encodePbsForDisk(doc, Boolean(requireEncryption) || C.state.activeWasEncrypted);
      if (res.encrypted) C.state.activeWasEncrypted = true;
      return res;
    },
    decodePbsFromText: async (rawText, project) => {
      let pre = null;
      try { pre = JSON.parse(rawText); } catch (_e) { /* decode reports invalid JSON */ }
      if (pre && typeof pre === 'object' && pre.format === encFormat() && typeof decryptPulsePlanData !== 'function') {
        throw new Error('Encryption engine unavailable in this environment.');
      }
      return D.decodePbsFromText(rawText, project, undefined, C.getUserName());
    },
    getPbsFilename: (project) => D.getPbsFilename(project, C.state.activeProjectId),
    supportsDirSync: () => C.supportsDirSync(),
    exportActivePbsPdf,
    core: C,
  };
  P.activated = true;
  refreshProjectsTableBadges();
  if (!(typeof ppIsSessionLocked === 'function' && ppIsSessionLocked())) {
    C.tryAutoReconnectFolder({ allowPrompt: false }).catch(() => {});
  }
})();
