/* PBS v2 - part 5c/7: dialog controller (events, edits, import/export, conflict resolution).
 * Inert: only registers window.__ppPbsV2.ui; nothing is created or listened to until ui.open(projectId) is called. */
(function ppPbsV2UiPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const ui = {
    dialog: null, wired: false, filter: { search: '', deptId: '', maturity: '', milestoneId: '' },
    collapsedIds: new Set(), edit: null, editSeq: 0, draft: null, notices: [], badgeRefresh: null,
  };
  const C = () => P.core;
  const V = () => P.view;
  const T = () => P.tree;
  const D = () => P.data;
  const IO = () => P.io;
  const R = () => P.report;
  const MAX_FILE_BYTES = 2000000;
  const MAX_IMPORT_ITEMS = 2000;
  const FORM_FIELDS = ['ppPbsFCode', 'ppPbsFName', 'ppPbsFParent', 'ppPbsFMaturity', 'ppPbsFDept', 'ppPbsFOwner', 'ppPbsFMilestone', 'ppPbsFNotes'];

  const isOpen = () => Boolean(ui.dialog && ui.dialog.open);
  const q = (sel) => (ui.dialog ? ui.dialog.querySelector(sel) : null);
  const attr = (name, val) => `[${name}="${CSS.escape(String(val))}"]`;
  const askOk = (msg) => (typeof globalThis.confirm === 'function' ? globalThis.confirm(msg) : true);
  const safe = (fn) => (...args) => Promise.resolve().then(() => fn(...args)).catch(err => C().toast((err && err.message) || 'Action failed.', 'error'));
  const doc = () => C().state.activeDoc;
  const project = () => C().getProject(C().state.activeProjectId);

  function todayIso() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function projectMilestones(db, pid) {
    const all = db.milestones || [];
    const inProject = (m) => m.projectId === pid || (Array.isArray(m.projectIds) && m.projectIds.includes(pid));
    const hasLinkInfo = all.some(m => m.projectId || (Array.isArray(m.projectIds) && m.projectIds.length));
    return hasLinkInfo ? all.filter(inProject) : all;
  }

  /* ---------- Rendering ---------- */
  function buildEdit() {
    const d = doc();
    const item = ui.edit.itemId ? d.items.find(i => i.id === ui.edit.itemId) : null;
    if (ui.edit.itemId && !item) return null;
    const parentId = item ? (item.parentId || null) : (ui.edit.parentId || null);
    const parentCandidates = T().flattenTreeRows(d, null, 0, []).map(r => r.item)
      .filter(i => !item || (i.id !== item.id && !T().isDescendant(d, i.id, item.id)));
    return { open: true, item, parentId, suggestedCode: T().suggestNextCode(d, parentId), parentCandidates };
  }

  function buildCtx() {
    const core = C();
    const S = core.state;
    const db = core.getDb();
    const d = S.activeDoc;
    const edit = ui.edit ? buildEdit() : null;
    if (ui.edit && !edit) ui.edit = null;
    return {
      doc: d, db, project: core.getProject(S.activeProjectId),
      summary: T().computeMaturitySummary(d, db.milestones || [], todayIso()),
      rows: T().getFilteredTreeRows(d, ui.filter, ui.collapsedIds),
      collapsedIds: ui.collapsedIds, filter: ui.filter, edit,
      conflict: S.conflictRemoteText ? { diff: S.conflictRemoteDoc ? D().computeConflictDiff(d, S.conflictRemoteDoc) : null } : null,
      notices: ui.notices, owners: core.getOwnerSuggestions(), projectMilestones: projectMilestones(db, S.activeProjectId),
      cloneSources: core.listCloneSources().map(p => ({ id: p.id, code: p.code || p.id, name: p.name || '', count: core.getItemCount(p.id) })),
      canDirSync: core.supportsDirSync(), dirName: S.dirHandle ? S.dirHandle.name : '', hasRemembered: Boolean(S.rememberedDirHandle) && !S.dirHandle,
      status: { text: S.syncStatusText, tone: S.syncStatusTone },
    };
  }

  function captureFocus() {
    const el = document.activeElement;
    if (!el || !ui.dialog.contains(el)) return null;
    let sel = null;
    if (el.id) sel = `#${CSS.escape(el.id)}`;
    else if (el.hasAttribute('data-pbs-move')) sel = `${attr('data-pbs-move', el.getAttribute('data-pbs-move'))}${attr('data-pbs-id', el.getAttribute('data-pbs-id'))}`;
    else {
      const name = ['data-pbs-toggle', 'data-pbs-edit', 'data-pbs-del', 'data-pbs-add-child', 'data-pbs-row'].find(a => el.hasAttribute(a));
      if (name) sel = attr(name, el.getAttribute(name));
    }
    const row = el.closest('[data-pbs-row]');
    let start = null; let end = null;
    try { start = el.selectionStart; end = el.selectionEnd; } catch (_e) {}
    return { sel, rowSel: row ? attr('data-pbs-row', row.getAttribute('data-pbs-row')) : null, start, end };
  }

  function restoreFocus(f) {
    if (!f) return;
    const target = (f.sel && q(f.sel)) || (f.rowSel && q(f.rowSel));
    if (!target) return;
    target.focus({ preventScroll: true });
    if (typeof f.start === 'number' && typeof target.setSelectionRange === 'function') {
      try { target.setSelectionRange(f.start, f.end); } catch (_e) {}
    }
  }

  function readDraft() {
    if (!q('#ppPbsItemForm') || !ui.edit) return null;
    const values = {};
    FORM_FIELDS.forEach(id => { const el = q(`#${id}`); if (el) values[id] = el.value; });
    return { seq: ui.edit.seq, values };
  }

  /* focusSel overrides focus restoration (used when opening forms or after deletes). */
  function render(focusSel) {
    if (!isOpen()) return;
    const focus = captureFocus();
    const draft = readDraft();
    const body = q('.pp-pbs-body');
    const scrollTop = body ? body.scrollTop : 0;
    ui.dialog.innerHTML = V().buildDialogHtml(buildCtx());
    const newBody = q('.pp-pbs-body');
    if (newBody) newBody.scrollTop = scrollTop;
    if (draft && ui.edit && draft.seq === ui.edit.seq && q('#ppPbsItemForm')) {
      Object.keys(draft.values).forEach(id => { const el = q(`#${id}`); if (el) el.value = draft.values[id]; });
    }
    if (focusSel && q(focusSel)) q(focusSel).focus({ preventScroll: false });
    else restoreFocus(focus);
  }

  function updateStatusPill(text, tone) {
    const el = q('#ppPbsSyncStatus');
    if (!el) return;
    const safeTone = ['ok', 'warn', 'error', 'idle'].includes(tone) ? tone : 'idle';
    el.textContent = text;
    el.className = `pp-pbs-pill pp-pbs-status-${safeTone}`;
  }

  function commit(summary, focusSel) {
    C().scheduleSave();
    if (summary) C().logChange(summary);
    render(focusSel);
  }

  /* ---------- Tree actions ---------- */
  function openForm(itemId, parentId) {
    ui.edit = { itemId: itemId || null, parentId: parentId || null, seq: ++ui.editSeq };
    if (parentId) ui.collapsedIds.delete(parentId);
    render('#ppPbsFName');
  }
  function closeForm(rowId) {
    ui.edit = null;
    render(rowId ? attr('data-pbs-row', rowId) : '#ppPbsAddRootBtn');
  }

  function submitForm() {
    const d = doc();
    const val = (id) => { const el = q(`#${id}`); return el ? el.value : ''; };
    const code = val('ppPbsFCode').trim().slice(0, 40);
    const name = val('ppPbsFName').trim().slice(0, 200);
    if (!code || !name) { C().toast('Code and name are required.', 'warning'); return; }
    const editingId = ui.edit ? ui.edit.itemId : null;
    const item = editingId ? d.items.find(i => i.id === editingId) : null;
    if (editingId && !item) { closeForm(); C().toast('That item no longer exists.', 'warning'); return; }
    const parentId = val('ppPbsFParent') || null;
    if (parentId) {
      const parent = d.items.find(i => i.id === parentId);
      if (!parent || (item && (parent.id === item.id || T().isDescendant(d, parentId, item.id)))) { C().toast('Invalid parent selection.', 'warning'); return; }
    }
    if (T().getChildren(d, parentId).some(s => s.id !== editingId && s.code === code)) {
      C().toast(`Code "${code}" is already used at this level.`, 'warning');
      q('#ppPbsFCode').focus();
      return;
    }
    const db = C().getDb();
    const maturity = P.MATURITY_OPTIONS.includes(val('ppPbsFMaturity')) ? val('ppPbsFMaturity') : 'Draft';
    const deptId = (db.departments || []).some(x => x.id === val('ppPbsFDept')) ? val('ppPbsFDept') : '';
    const milestoneId = (db.milestones || []).some(x => x.id === val('ppPbsFMilestone')) ? val('ppPbsFMilestone') : '';
    const fields = { code, name, deptId, owner: val('ppPbsFOwner').trim().slice(0, 120), maturity, milestoneId, notes: val('ppPbsFNotes').trim().slice(0, 1000) };
    let id; let summary;
    if (item) {
      const prev = item.maturity;
      Object.assign(item, fields, { parentId });
      id = item.id;
      summary = `Updated PBS item ${code} ${name}${prev !== maturity ? ` (${prev} \u2192 ${maturity})` : ''}`;
    } else {
      id = D().makeId('pbs');
      d.items.push({ id, parentId, ...fields });
      if (parentId) ui.collapsedIds.delete(parentId);
      summary = `Added PBS item ${code} ${name}`;
    }
    ui.edit = null;
    commit(summary, attr('data-pbs-row', id));
  }

  function deleteItem(id) {
    const d = doc();
    const item = d.items.find(i => i.id === id);
    if (!item) return;
    const ids = new Set([id]);
    (function walk(pid) { T().getChildren(d, pid).forEach(c => { ids.add(c.id); walk(c.id); }); })(id);
    const n = ids.size - 1;
    if (!askOk(`Delete "${item.name}"${n ? ` and its ${n} sub-item${n === 1 ? '' : 's'}` : ''}?`)) return;
    d.items = d.items.filter(i => !ids.has(i.id));
    ids.forEach(x => ui.collapsedIds.delete(x));
    if (ui.edit && ids.has(ui.edit.itemId)) ui.edit = null;
    commit(`Deleted PBS item ${item.code} ${item.name}${n ? ` (+${n} sub-items)` : ''}`, '#ppPbsAddRootBtn');
  }

  function moveItem(id, action) {
    const d = doc();
    const item = d.items.find(i => i.id === id);
    if (!item) return;
    const res = T().reorderItem(d, id, action);
    if (!res.ok) { C().toast('That item cannot be moved further in this direction.', 'info'); return; }
    if (action === 'indent' && res.newParentId) ui.collapsedIds.delete(res.newParentId);
    const label = { up: 'Moved up', down: 'Moved down', indent: 'Indented', outdent: 'Outdented' }[action] || 'Moved';
    commit(`${label} PBS item ${item.code} ${item.name}`);
  }

  function toggleItem(id) {
    if (ui.collapsedIds.has(id)) ui.collapsedIds.delete(id); else ui.collapsedIds.add(id);
    render();
  }
  function setAllCollapsed(collapse) {
    ui.collapsedIds.clear();
    if (collapse) doc().items.forEach(i => { if (T().getChildren(doc(), i.id).length) ui.collapsedIds.add(i.id); });
    render();
  }

  /* ---------- Files, exports, clone ---------- */
  async function readFileText(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error('File is too large (limit 2 MB).');
    return file.text();
  }

  async function saveJson() {
    try {
      const { text } = await D().encodePbsForDisk(doc(), C().state.activeWasEncrypted);
      C().downloadText(C().fileNameFor(), text, 'application/json');
      C().toast('PBS JSON saved.', 'success');
    } catch (err) {
      C().toast(err.message || 'Could not save JSON.', err.code === 'PASSPHRASE_LOCKED' ? 'warning' : 'error');
    }
  }

  async function loadJson(file) {
    const d = doc();
    const { doc: loaded, wasEncrypted } = await D().decodePbsFromText(await readFileText(file), project(), undefined, C().getUserName());
    if (d.items.length && !askOk(`Replace the ${d.items.length} existing items with ${loaded.items.length} items from "${file.name}"?`)) return;
    loaded.meta.revision = Math.max(Number(loaded.meta.revision) || 1, Number(d.meta.revision) || 1);
    C().replaceDoc(loaded, wasEncrypted);
    ui.collapsedIds.clear(); ui.edit = null;
    commit(`Loaded PBS from JSON file (${loaded.items.length} items)`);
  }

  function exportCsv() {
    C().downloadText(IO().csvFilename(project(), C().state.activeProjectId), IO().buildPbsCsv(doc(), C().getDb()), 'text/csv;charset=utf-8');
    C().toast('PBS CSV exported.', 'success');
  }

  async function importCsv(file) {
    const d = doc();
    const { items, warnings } = IO().parsePbsCsv(await readFileText(file), C().getDb());
    if (!items.length) { C().toast('No PBS rows found in that CSV file.', 'warning'); return; }
    if (items.length > MAX_IMPORT_ITEMS) { C().toast(`CSV has too many rows (limit ${MAX_IMPORT_ITEMS}).`, 'warning'); return; }
    if (d.items.length && !askOk(`Append ${items.length} imported items to the ${d.items.length} existing items?`)) return;
    d.items.push(...items);
    ui.notices = [`Imported ${items.length} item${items.length === 1 ? '' : 's'} from ${file.name}.`, ...warnings];
    commit(`Imported ${items.length} items from CSV`);
  }

  function exportSvg() {
    const p = project();
    C().downloadText(R().svgFilename(p, C().state.activeProjectId), R().buildSvg(doc(), p, C().getDb(), todayIso()), 'image/svg+xml;charset=utf-8');
    C().toast('SVG diagram exported.', 'success');
  }

  function openPrintFallback(model) {
    const url = URL.createObjectURL(new Blob([R().buildPrintHtml(model)], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (!w) { C().toast('Pop-up blocked. Allow pop-ups to open the print view.', 'warning'); return; }
    w.addEventListener('load', () => { w.focus(); w.print(); });
    C().toast('PDF library unavailable. Opened a print view: choose "Save as PDF".', 'info');
  }

  function exportPdf() {
    const p = project();
    const date = todayIso();
    const model = R().buildReportModel(doc(), p, C().getDb(), C().getUserName(), date);
    const JsPdf = window.jspdf && window.jspdf.jsPDF;
    if (JsPdf) {
      try {
        R().renderPdf(JsPdf, model).save(R().pdfFilename(p, C().state.activeProjectId, date));
        C().toast('PBS PDF report exported.', 'success');
        return;
      } catch (_e) { /* fall back to print view */ }
    }
    openPrintFallback(model);
  }

  function cloneFrom(srcId) {
    const d = doc();
    const src = C().getCache()[srcId];
    const sp = C().getProject(srcId);
    if (!src || !Array.isArray(src.items) || !src.items.length) { C().toast('That project has no PBS items to clone.', 'warning'); render(); return; }
    const items = IO().cloneItems(src).map(it => ({ ...it, maturity: 'Draft' }));
    const label = sp ? `[${sp.code || sp.id}] ${sp.name}` : srcId;
    if (d.items.length && !askOk(`Add ${items.length} items cloned from ${label} to the ${d.items.length} existing items? Maturity resets to Draft; milestone links are not copied.`)) { render(); return; }
    d.items.push(...items);
    commit(`Cloned ${items.length} items from ${label}`);
  }

  /* ---------- Conflict resolution ---------- */
  async function conflictMerge() {
    const S = C().state;
    if (!S.conflictRemoteDoc) return;
    const remoteModified = S.conflictRemoteModified;
    const added = D().computeConflictDiff(S.activeDoc, S.conflictRemoteDoc).addedRemote.length;
    C().replaceDoc(D().mergeConflictDocs(S.activeDoc, S.conflictRemoteDoc), S.activeWasEncrypted);
    S.activeFileModified = remoteModified;
    await C().writeToFolder(false);
    C().logChange(`Merged ${added} remote item${added === 1 ? '' : 's'} after sync conflict (local wins on edits to the same item)`);
    render();
  }
  async function conflictLoad() {
    if (!askOk('Discard your unsaved local changes and load the shared folder version?')) return;
    await C().syncFromFolder({});
    render();
  }
  async function conflictOverwrite() {
    if (!askOk('Overwrite the shared folder file with your local version? Remote changes will be lost.')) return;
    await C().writeToFolder(true);
    C().logChange('Overwrote shared folder PBS with local version after sync conflict');
    render();
  }

  /* ---------- Event delegation ---------- */
  const BUTTONS = {
    ppPbsCloseBtn: () => closeDialog(),
    ppPbsAddRootBtn: () => openForm(null, null),
    ppPbsExpandAllBtn: () => setAllCollapsed(false),
    ppPbsCollapseAllBtn: () => setAllCollapsed(true),
    ppPbsLinkFolderBtn: safe(async () => { await C().linkFolder(); render(); }),
    ppPbsRelinkBtn: safe(async () => { await C().linkFolder(); render(); }),
    ppPbsReconnectBtn: safe(async () => { await C().reconnectFolder(); render(); }),
    ppPbsSaveJsonBtn: safe(saveJson),
    ppPbsLoadJsonBtn: () => { const el = q('#ppPbsJsonFileInput'); if (el) el.click(); },
    ppPbsExportCsvBtn: safe(exportCsv),
    ppPbsImportCsvBtn: () => { const el = q('#ppPbsCsvFileInput'); if (el) el.click(); },
    ppPbsExportSvgBtn: safe(exportSvg),
    ppPbsExportPdfBtn: safe(exportPdf),
    ppPbsClearFiltersBtn: () => { ui.filter = { search: '', deptId: '', maturity: '', milestoneId: '' }; render('#ppPbsFilterSearch'); },
    ppPbsFormCancel: () => closeForm(ui.edit ? ui.edit.itemId : null),
    ppPbsConflictMerge: safe(conflictMerge),
    ppPbsConflictLoad: safe(conflictLoad),
    ppPbsConflictOverwrite: safe(conflictOverwrite),
  };

  function onClick(e) {
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t || !ui.dialog.contains(t)) return;
    const d = t.dataset;
    if (d.pbsToggle) return toggleItem(d.pbsToggle);
    if (d.pbsMove) return moveItem(d.pbsId, d.pbsMove);
    if (d.pbsAddChild) return openForm(null, d.pbsAddChild);
    if (d.pbsEdit) return openForm(d.pbsEdit, null);
    if (d.pbsDel) return deleteItem(d.pbsDel);
    const fn = BUTTONS[t.id];
    if (fn) fn();
  }

  function onChange(e) {
    const t = e.target;
    const files = t.files;
    if (t.id === 'ppPbsJsonFileInput' || t.id === 'ppPbsCsvFileInput') {
      const file = files && files[0];
      const isJson = t.id === 'ppPbsJsonFileInput';
      t.value = '';
      if (file) safe(isJson ? loadJson : importCsv)(file);
    } else if (t.id === 'ppPbsFilterDept') { ui.filter.deptId = t.value; render();
    } else if (t.id === 'ppPbsFilterMaturity') { ui.filter.maturity = t.value; render();
    } else if (t.id === 'ppPbsFilterMs') { ui.filter.milestoneId = t.value; render();
    } else if (t.id === 'ppPbsCloneSelect' && t.value) { cloneFrom(t.value); }
  }

  function onInput(e) {
    if (e.target.id === 'ppPbsFilterSearch') { ui.filter.search = e.target.value; render(); }
  }

  function onKeydown(e) {
    const row = e.target.closest ? e.target.closest('[data-pbs-row]') : null;
    if (!row || e.target !== row) return;
    const id = row.getAttribute('data-pbs-row');
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const action = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'indent', ArrowLeft: 'outdent' }[e.key];
      if (action) { e.preventDefault(); moveItem(id, action); }
      return;
    }
    const toggle = row.querySelector('[data-pbs-toggle]');
    if (e.key === 'Enter') { e.preventDefault(); openForm(id, null); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (next && next.hasAttribute('data-pbs-row')) next.focus();
    } else if (e.key === 'ArrowRight' && toggle && toggle.getAttribute('aria-expanded') === 'false') { e.preventDefault(); toggleItem(id); }
    else if (e.key === 'ArrowLeft' && toggle && toggle.getAttribute('aria-expanded') === 'true') { e.preventDefault(); toggleItem(id); }
  }

  /* ---------- Lifecycle ---------- */
  function ensureDialog() {
    if (ui.dialog && document.body.contains(ui.dialog)) return;
    const el = document.createElement('dialog');
    el.id = 'ppPbsDialog';
    el.setAttribute('aria-labelledby', 'ppPbsDialogTitle');
    document.body.appendChild(el);
    ui.dialog = el;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('submit', (e) => { if (e.target.id === 'ppPbsItemForm') { e.preventDefault(); submitForm(); } });
    el.addEventListener('cancel', (e) => { if (ui.edit) { e.preventDefault(); closeForm(ui.edit.itemId); } });
    el.addEventListener('close', () => { safe(onClosed)(); });
  }

  async function onClosed() {
    const core = C();
    const S = core.state;
    core.stopPolling();
    for (let i = 0; i < 20 && S.isSaving; i++) await new Promise(r => setTimeout(r, 100));
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    if (S.dirHandle && S.syncStatusText === 'Saving...' && !S.conflictRemoteText) await core.writeToFolder(false);
    ui.edit = null; ui.draft = null;
    if (typeof ui.badgeRefresh === 'function') ui.badgeRefresh();
  }

  function closeDialog() { if (ui.dialog && ui.dialog.open) ui.dialog.close(); }

  async function open(projectId) {
    const core = C();
    if (!core.openSession(projectId)) { core.toast('Project not found.', 'error'); return; }
    ensureDialog();
    V().injectStyles();
    ui.filter = { search: '', deptId: '', maturity: '', milestoneId: '' };
    ui.collapsedIds = new Set(); ui.edit = null; ui.notices = [];
    const hooks = core.state.hooks;
    hooks.rerender = () => render();
    hooks.onStatus = updateStatusPill;
    hooks.isDialogOpen = isOpen;
    hooks.onBadges = () => { if (typeof ui.badgeRefresh === 'function') ui.badgeRefresh(); };
    if (!ui.dialog.open) ui.dialog.showModal();
    render();
    await core.initFolder();
    render();
  }

  P.ui = { open, close: closeDialog, isOpen, render, setBadgeRefresh(fn) { ui.badgeRefresh = fn; } };
})();
