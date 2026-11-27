/* PBS v2 - part 5c/7: dialog controller (events, edits, import/export, conflict resolution).
 * Inert: only registers window.__ppPbsV2.ui; nothing is created or listened to until ui.open(projectId) is called. */
(function ppPbsV2UiPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const COL_PREFS_KEY = 'pulseplan_pbs_colprefs_v1';
  const EXPAND_PREF_KEY = 'pulseplan_pbs_expanded_v1';
  const PDF_FIELDS_PREF_KEY = 'pulseplan_pbs_pdf_fields_v1';
  const MAX_UNDO = 40;
  const emptyFilter = () => ({ search: '', deptId: '', maturity: '', milestoneId: '', heritage: '', procStatus: '', flag: '' });
  const ui = {
    dialog: null, wired: false, filter: emptyFilter(),
    colGroups: { docs: false, proc: false, swp: false }, userLockedCols: false,
    expanded: false, pdfPanelOpen: false, pdfSelectedFields: null, pdfApplyFilters: true,
    collapsedIds: new Set(), edit: null, editSeq: 0, draft: null, pasteOpen: false,
    undoStack: [], redoStack: [], notices: [], badgeRefresh: null,
  };
  const C = () => P.core;
  const V = () => P.view;
  const T = () => P.tree;
  const D = () => P.data;
  const IO = () => P.io;
  const R = () => P.report;
  const MAX_FILE_BYTES = 2000000;
  const MAX_IMPORT_ITEMS = 2000;
  const FORM_FIELDS = [
    'ppPbsFCode', 'ppPbsFAcronym', 'ppPbsFName', 'ppPbsFHeritage', 'ppPbsFParent',
    'ppPbsFMaturity', 'ppPbsFDept', 'ppPbsFOwner', 'ppPbsFMilestone', 'ppPbsFDescription', 'ppPbsFNotes',
    'ppPbsFMechDrawing', 'ppPbsFElecDrawing', 'ppPbsFRefDoc',
    'ppPbsFManufacturer', 'ppPbsFPartNumber', 'ppPbsFProcStatus', 'ppPbsFLeadTime', 'ppPbsFUnitCost', 'ppPbsFComponentAlt',
    'ppPbsFQty', 'ppPbsFMass', 'ppPbsFPowerCons', 'ppPbsFPowerDiss', 'ppPbsFMtbf', 'ppPbsFLru', 'ppPbsFSpareAvail', 'ppPbsFSpareDeliv',
  ];

  const isOpen = () => Boolean(ui.dialog && ui.dialog.open);
  const q = (sel) => (ui.dialog ? ui.dialog.querySelector(sel) : null);
  const attr = (name, val) => `[${name}="${CSS.escape(String(val))}"]`;
  const askConfirm = async ({ title = 'Confirm Action', message = '', confirmLabel = 'Confirm', tone = 'danger' } = {}) => {
    if (typeof ppConfirmAction === 'function') {
      return ppConfirmAction({ title, message, confirmLabel, tone });
    }
    return typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : true;
  };
  const safe = (fn) => (...args) => Promise.resolve().then(() => fn(...args)).catch(err => C().toast((err && err.message) || 'Action failed.', 'error'));
  const doc = () => C().state.activeDoc;
  const project = () => C().getProject(C().state.activeProjectId);
  const hasActiveFilter = () => {
    const f = ui.filter;
    return Boolean(f.search || f.deptId || f.maturity || f.milestoneId || f.heritage || f.procStatus || f.flag);
  };

  function todayIso() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function loadColPrefs() {
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(COL_PREFS_KEY) : localStorage.getItem(COL_PREFS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return { docs: Boolean(p.docs), proc: Boolean(p.proc), swp: Boolean(p.swp) };
    } catch (_e) {}
    return null;
  }

  function saveColPrefs(g) {
    ui.userLockedCols = true;
    try {
      const raw = JSON.stringify({ docs: Boolean(g.docs), proc: Boolean(g.proc), swp: Boolean(g.swp) });
      if (typeof safeSetStorage === 'function') safeSetStorage(COL_PREFS_KEY, raw);
      else localStorage.setItem(COL_PREFS_KEY, raw);
    } catch (_e) {}
  }

  function loadExpandPref() {
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(EXPAND_PREF_KEY) : localStorage.getItem(EXPAND_PREF_KEY);
      return raw === '1' || raw === 'true';
    } catch (_e) { return false; }
  }

  function saveExpandPref(expanded) {
    try {
      const raw = expanded ? '1' : '0';
      if (typeof safeSetStorage === 'function') safeSetStorage(EXPAND_PREF_KEY, raw);
      else localStorage.setItem(EXPAND_PREF_KEY, raw);
    } catch (_e) {}
  }

  function applyExpandedClass() {
    if (!ui.dialog) return;
    ui.dialog.classList.toggle('pp-pbs-expanded', Boolean(ui.expanded));
    ui.dialog.scrollTop = 0;
    ui.dialog.scrollLeft = 0;
  }

  function toggleExpandWindow() {
    ui.expanded = !ui.expanded;
    saveExpandPref(ui.expanded);
    applyExpandedClass();
    render('#ppPbsExpandWinBtn');
  }

  function getAllReportCols() {
    return (R() && Array.isArray(R().REPORT_COLS)) ? R().REPORT_COLS : [];
  }

  function getPopulatedFieldKeys(d) {
    const items = (d && Array.isArray(d.items)) ? d.items : [];
    const pop = new Set();
    getAllReportCols().forEach(c => {
      if (typeof c.has === 'function' && items.some(it => c.has(it))) pop.add(c.key);
    });
    return pop;
  }

  function computePdfPresetFields(preset, d) {
    const cols = getAllReportCols();
    const coreKeys = cols.filter(c => c.always).map(c => c.key);
    if (preset === 'minimal') return new Set(['code', 'name']);
    if (preset === 'core') return new Set(coreKeys);
    if (preset === 'all') return new Set(cols.map(c => c.key));
    if (preset === 'docs' || preset === 'proc' || preset === 'swp') {
      return new Set([...coreKeys, ...cols.filter(c => c.group === preset).map(c => c.key)]);
    }
    if (preset === 'currentView') {
      const visOpt = V().resolveVisibleOptionalCols ? V().resolveVisibleOptionalCols(d, ui.colGroups).map(c => c.key) : [];
      return new Set([...coreKeys, ...visOpt]);
    }
    // Default / 'populated': all core fields + any optional field containing data
    const items = (d && Array.isArray(d.items)) ? d.items : [];
    const out = new Set(coreKeys);
    cols.forEach(c => {
      if (!c.always && typeof c.has === 'function' && items.some(it => c.has(it))) out.add(c.key);
    });
    return out;
  }

  function loadPdfFieldPrefs() {
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(PDF_FIELDS_PREF_KEY) : localStorage.getItem(PDF_FIELDS_PREF_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return null;
      const valid = new Set(getAllReportCols().map(c => c.key));
      const clean = arr.filter(k => valid.has(k));
      return clean.length ? new Set(clean) : null;
    } catch (_e) { return null; }
  }

  function savePdfFieldPrefs(selSet) {
    try {
      const raw = JSON.stringify(Array.from(selSet || []));
      if (typeof safeSetStorage === 'function') safeSetStorage(PDF_FIELDS_PREF_KEY, raw);
      else localStorage.setItem(PDF_FIELDS_PREF_KEY, raw);
    } catch (_e) {}
  }

  function ensurePdfSelectedFields() {
    if (!ui.pdfSelectedFields) {
      ui.pdfSelectedFields = loadPdfFieldPrefs() || computePdfPresetFields('populated', doc());
    }
    return ui.pdfSelectedFields;
  }

  function pushUndo(label) {
    const d = doc();
    if (!d || !Array.isArray(d.items)) return;
    ui.undoStack.push({ label: label || 'Edit', itemsJson: JSON.stringify(d.items) });
    if (ui.undoStack.length > MAX_UNDO) ui.undoStack.shift();
    ui.redoStack = [];
  }

  function undo() {
    const d = doc();
    if (!d || !ui.undoStack.length) return;
    const entry = ui.undoStack.pop();
    ui.redoStack.push({ label: entry.label, itemsJson: JSON.stringify(d.items) });
    try { d.items = JSON.parse(entry.itemsJson); } catch (_e) { return; }
    ui.edit = null; ui.pasteOpen = false; ui.pdfPanelOpen = false; ui.notices = [];
    commit(`Undo: ${entry.label}`);
    C().toast(`Undid: ${entry.label}`, 'info');
  }

  function redo() {
    const d = doc();
    if (!d || !ui.redoStack.length) return;
    const entry = ui.redoStack.pop();
    ui.undoStack.push({ label: entry.label, itemsJson: JSON.stringify(d.items) });
    try { d.items = JSON.parse(entry.itemsJson); } catch (_e) { return; }
    ui.edit = null; ui.pasteOpen = false; ui.pdfPanelOpen = false; ui.notices = [];
    commit(`Redo: ${entry.label}`);
    C().toast(`Redid: ${entry.label}`, 'info');
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
    const counts = item ? D().countOptionalFields(item) : { docs: 0, proc: 0, eng: 0 };
    const openSections = ui.edit.openSections || { docs: counts.docs > 0, proc: counts.proc > 0, eng: counts.eng > 0 };
    return { open: true, item, parentId, suggestedCode: T().suggestNextCode(d, parentId), parentCandidates, openSections };
  }

  function buildCtx() {
    const core = C();
    const S = core.state;
    const db = core.getDb();
    const d = S.activeDoc;
    const edit = ui.edit ? buildEdit() : null;
    if (ui.edit && !edit) ui.edit = null;
    const summary = T().computeMaturitySummary(d, db.milestones || [], todayIso());
    const rollups = T().computeSwpRollups(d);
    const rows = T().getFilteredTreeRows(d, ui.filter, ui.collapsedIds, { summary, rollups });
    const isFiltered = hasActiveFilter();
    const matchedIds = isFiltered ? new Set(rows.filter(r => !r.isContextOnly).map(r => r.item.id)) : null;
    const filteredRollups = isFiltered ? T().computeFilteredRollups(d, matchedIds) : null;
    const lastUndo = ui.undoStack.length ? ui.undoStack[ui.undoStack.length - 1] : null;
    const lastRedo = ui.redoStack.length ? ui.redoStack[ui.redoStack.length - 1] : null;
    const pdfExport = ui.pdfPanelOpen
      ? { open: true, selectedFields: ensurePdfSelectedFields(), populatedFields: getPopulatedFieldKeys(d), applyFilters: Boolean(ui.pdfApplyFilters) }
      : { open: false };
    return {
      doc: d, db, project: core.getProject(S.activeProjectId),
      summary, rollups, filteredRollups, isFiltered, matchedCount: matchedIds ? matchedIds.size : d.items.length,
      rows, collapsedIds: ui.collapsedIds, colGroups: ui.colGroups,
      filter: ui.filter, edit, pasteOpen: ui.pasteOpen,
      isExpanded: ui.expanded, pdfExport,
      canUndo: Boolean(lastUndo), canRedo: Boolean(lastRedo),
      undoLabel: lastUndo ? `Undo: ${lastUndo.label} (Ctrl+Z)` : 'Nothing to undo',
      redoLabel: lastRedo ? `Redo: ${lastRedo.label} (Ctrl+Y)` : 'Nothing to redo',
      conflict: S.conflictRemoteText ? { diff: S.conflictRemoteDoc ? D().computeConflictDiff(d, S.conflictRemoteDoc, db) : null } : null,
      notices: ui.notices,
      owners: core.getOwnerSuggestions(),
      manufacturers: core.getManufacturerSuggestions(),
      procStatuses: core.getProcStatusSuggestions(),
      projectMilestones: projectMilestones(db, S.activeProjectId),
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
      const name = ['data-pbs-toggle', 'data-pbs-col-group', 'data-pbs-flag-pill', 'data-pbs-pdf-field', 'data-pbs-pdf-preset', 'data-pbs-pdf-group-toggle', 'data-pbs-edit', 'data-pbs-del', 'data-pbs-add-child', 'data-pbs-row'].find(a => el.hasAttribute(a));
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
    const sections = {};
    ['docs', 'proc', 'eng'].forEach(k => {
      const det = q(`details[data-pbs-section="${k}"]`);
      if (det) sections[k] = Boolean(det.open);
    });
    return { seq: ui.edit.seq, values, sections };
  }

  /* focusSel overrides focus restoration (used when opening forms or after deletes). */
  function render(focusSel) {
    if (!isOpen()) return;
    const focus = captureFocus();
    const draft = readDraft();
    const pasteEl = q('#ppPbsPasteInput');
    const pasteDraft = pasteEl ? pasteEl.value : null;
    if (draft && ui.edit && draft.seq === ui.edit.seq) ui.edit.openSections = draft.sections;
    const body = q('.pp-pbs-body');
    const scrollTop = body ? body.scrollTop : 0;
    const tblWrap = q('.pp-pbs-table-wrap');
    const scrollLeft = tblWrap ? tblWrap.scrollLeft : 0;
    ui.dialog.innerHTML = V().buildDialogHtml(buildCtx());
    const newBody = q('.pp-pbs-body');
    if (newBody) newBody.scrollTop = scrollTop;
    const newTblWrap = q('.pp-pbs-table-wrap');
    if (newTblWrap) newTblWrap.scrollLeft = scrollLeft;
    if (draft && ui.edit && draft.seq === ui.edit.seq && q('#ppPbsItemForm')) {
      Object.keys(draft.values).forEach(id => { const el = q(`#${id}`); if (el) el.value = draft.values[id]; });
    }
    if (pasteDraft !== null && ui.pasteOpen && q('#ppPbsPasteInput')) {
      q('#ppPbsPasteInput').value = pasteDraft;
    }
    if (focusSel) {
      const target = q(focusSel);
      if (target) {
        if (target.matches('[data-pbs-row]')) {
          target.focus({ preventScroll: true });
          if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          if (newTblWrap) newTblWrap.scrollLeft = scrollLeft;
        } else {
          target.focus({ preventScroll: false });
        }
      }
    } else restoreFocus(focus);
    ui.dialog.scrollTop = 0;
    ui.dialog.scrollLeft = 0;
  }

  function updateStatusPill(text, tone) {
    const el = q('#ppPbsSyncStatus');
    if (!el) return;
    const safeTone = ['ok', 'warn', 'error', 'idle'].includes(tone) ? tone : 'idle';
    el.textContent = text;
    el.title = text;
    el.className = `pp-pbs-pill pp-pbs-status-${safeTone}`;
  }

  function commit(summary, focusSel) {
    C().scheduleSave();
    if (summary) C().logChange(summary);
    render(focusSel);
  }

  /* ---------- Tree actions ---------- */
  function openForm(itemId, parentId) {
    ui.pasteOpen = false;
    ui.pdfPanelOpen = false;
    ui.edit = { itemId: itemId || null, parentId: parentId || null, seq: ++ui.editSeq, openSections: null };
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

    const readNum = (fieldId, label, secKey) => {
      const raw = val(fieldId).trim();
      if (!raw) return { ok: true, value: null };
      const parsed = D().parseOptionalNumber(raw);
      if (parsed === null) {
        const det = secKey ? q(`details[data-pbs-section="${secKey}"]`) : null;
        if (det) det.open = true;
        C().toast(`${label} must be a non-negative number.`, 'warning');
        const el = q(`#${fieldId}`);
        if (el) el.focus();
        return { ok: false, value: null };
      }
      return { ok: true, value: parsed };
    };

    const rawQty = val('ppPbsFQty').trim();
    let qtyVal = null;
    if (rawQty) {
      qtyVal = D().parseOptionalQty(rawQty);
      if (qtyVal === null) {
        const det = q('details[data-pbs-section="eng"]');
        if (det) det.open = true;
        C().toast('Quantity must be a whole number >= 1.', 'warning');
        const el = q('#ppPbsFQty');
        if (el) el.focus();
        return;
      }
    }
    const mass = readNum('ppPbsFMass', 'Mass (kg)', 'eng'); if (!mass.ok) return;
    const powerConsumption = readNum('ppPbsFPowerCons', 'Power Consumption (W)', 'eng'); if (!powerConsumption.ok) return;
    const powerDissipation = readNum('ppPbsFPowerDiss', 'Power Dissipation (W)', 'eng'); if (!powerDissipation.ok) return;
    const mtbf = readNum('ppPbsFMtbf', 'MTBF (h)', 'eng'); if (!mtbf.ok) return;
    const leadTime = readNum('ppPbsFLeadTime', 'Lead Time (wks)', 'proc'); if (!leadTime.ok) return;
    const hasUnitCostInput = Boolean(q('#ppPbsFUnitCost'));
    const unitCost = hasUnitCostInput
      ? readNum('ppPbsFUnitCost', 'Unit Cost', 'proc')
      : { ok: true, value: item ? (item.unitCost ?? null) : null };
    if (!unitCost.ok) return;

    const db = C().getDb();
    const maturity = P.MATURITY_OPTIONS.includes(val('ppPbsFMaturity')) ? val('ppPbsFMaturity') : 'Draft';
    const deptId = (db.departments || []).some(x => x.id === val('ppPbsFDept')) ? val('ppPbsFDept') : '';
    const milestoneId = (db.milestones || []).some(x => x.id === val('ppPbsFMilestone')) ? val('ppPbsFMilestone') : '';
    const fields = {
      code, name, deptId, owner: val('ppPbsFOwner').trim().slice(0, 120), maturity, milestoneId,
      notes: val('ppPbsFNotes').trim().slice(0, 1000),
      acronym: val('ppPbsFAcronym').trim().slice(0, 24),
      description: val('ppPbsFDescription').trim().slice(0, 1000),
      heritage: D().normalizeHeritage(val('ppPbsFHeritage')),
      mechDrawing: val('ppPbsFMechDrawing').trim().slice(0, 160),
      elecDrawing: val('ppPbsFElecDrawing').trim().slice(0, 160),
      refDoc: val('ppPbsFRefDoc').trim().slice(0, 200),
      manufacturer: val('ppPbsFManufacturer').trim().slice(0, 140),
      partNumber: val('ppPbsFPartNumber').trim().slice(0, 120),
      procurementStatus: val('ppPbsFProcStatus').trim().slice(0, 80),
      qty: qtyVal,
      mass: mass.value,
      powerConsumption: powerConsumption.value,
      powerDissipation: powerDissipation.value,
      mtbf: mtbf.value,
      lru: D().normalizeYesNo(val('ppPbsFLru')),
      spareAvailable: D().normalizeYesNo(val('ppPbsFSpareAvail')),
      spareToDeliver: D().normalizeYesNo(val('ppPbsFSpareDeliv')),
      leadTime: leadTime.value,
      unitCost: unitCost.value,
      componentAlt: val('ppPbsFComponentAlt').trim().slice(0, 200),
    };
    let id; let summary;
    pushUndo(item ? `Update ${code} ${name}` : `Add ${code} ${name}`);
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
    syncPopulatedColGroups(false);
    commit(summary, attr('data-pbs-row', id));
    if (typeof globalThis !== 'undefined' && globalThis.ppHooks && typeof globalThis.ppHooks.emit === 'function') {
      globalThis.ppHooks.emit('afterPbsCommit', d);
    }
  }

  async function deleteItem(id) {
    const d = doc();
    const item = d.items.find(i => i.id === id);
    if (!item) return;
    const ids = new Set([id]);
    (function walk(pid) { T().getChildren(d, pid).forEach(c => { ids.add(c.id); walk(c.id); }); })(id);
    const n = ids.size - 1;
    const ok = await askConfirm({
      title: 'Delete PBS Deliverable?',
      message: `Delete "${item.name}"${n ? ` and its ${n} sub-item${n === 1 ? '' : 's'}` : ''}? You can undo this with Ctrl+Z.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    pushUndo(`Delete ${item.code} ${item.name}`);
    d.items = d.items.filter(i => !ids.has(i.id));
    ids.forEach(x => ui.collapsedIds.delete(x));
    if (ui.edit && ids.has(ui.edit.itemId)) ui.edit = null;
    commit(`Deleted PBS item ${item.code} ${item.name}${n ? ` (+${n} sub-items)` : ''}`, '#ppPbsAddRootBtn');
  }

  function moveItem(id, action) {
    const d = doc();
    const item = d.items.find(i => i.id === id);
    if (!item) return;
    const snap = JSON.stringify(d.items);
    const res = T().reorderItem(d, id, action);
    if (!res.ok) { C().toast('That item cannot be moved further in this direction.', 'info'); return; }
    const label = { up: 'Moved up', down: 'Moved down', indent: 'Indented', outdent: 'Outdented' }[action] || 'Moved';
    ui.undoStack.push({ label: `${label} ${item.code} ${item.name}`, itemsJson: snap });
    if (ui.undoStack.length > MAX_UNDO) ui.undoStack.shift();
    ui.redoStack = [];
    if (action === 'indent' && res.newParentId) ui.collapsedIds.delete(res.newParentId);
    commit(`${label} PBS item ${item.code} ${item.name}`);
  }

  async function renumberItems() {
    const d = doc();
    if (!d || d.items.length < 2) return;
    const ok = await askConfirm({
      title: 'Renumber PBS Hierarchy?',
      message: 'Re-sequence all PBS item codes (1, 1.1, 1.2...) to match the current tree hierarchy? You can undo this with Ctrl+Z.',
      confirmLabel: 'Renumber Codes',
      tone: 'warning',
    });
    if (!ok) return;
    const snap = JSON.stringify(d.items);
    const { changed } = T().renumberTree(d);
    if (!changed) { C().toast('All PBS codes are already in sequential order.', 'info'); return; }
    ui.undoStack.push({ label: `Renumber ${changed} codes`, itemsJson: snap });
    if (ui.undoStack.length > MAX_UNDO) ui.undoStack.shift();
    ui.redoStack = [];
    commit(`Renumbered ${changed} PBS code${changed === 1 ? '' : 's'}`);
    C().toast(`Renumbered ${changed} PBS item${changed === 1 ? '' : 's'}.`, 'success');
  }

  function openPastePanel() {
    ui.edit = null;
    ui.pdfPanelOpen = false;
    ui.pasteOpen = true;
    render('#ppPbsPasteInput');
  }
  function closePastePanel() {
    ui.pasteOpen = false;
    render('#ppPbsPasteBtn');
  }
  function submitPaste() {
    const el = q('#ppPbsPasteInput');
    const raw = el ? el.value : '';
    if (!raw.trim()) { C().toast('Paste spreadsheet or CSV rows first.', 'warning'); if (el) el.focus(); return; }
    const d = doc();
    const { items, warnings } = IO().parsePbsCsv(raw, C().getDb());
    if (!items.length) { C().toast('No PBS rows found in the pasted text.', 'warning'); return; }
    if (items.length > MAX_IMPORT_ITEMS) { C().toast(`Too many pasted rows (limit ${MAX_IMPORT_ITEMS}).`, 'warning'); return; }
    pushUndo(`Paste ${items.length} items`);
    d.items.push(...items);
    ui.pasteOpen = false;
    ui.notices = [`Pasted ${items.length} item${items.length === 1 ? '' : 's'} from clipboard.`, ...warnings];
    syncPopulatedColGroups(false);
    commit(`Pasted ${items.length} PBS items`);
    C().toast(`Imported ${items.length} pasted item${items.length === 1 ? '' : 's'}.`, 'success');
  }

  function openPdfPanel() {
    ui.edit = null;
    ui.pasteOpen = false;
    ui.pdfPanelOpen = true;
    ensurePdfSelectedFields();
    ui.pdfApplyFilters = hasActiveFilter();
    const b = q('.pp-pbs-body');
    if (b) b.scrollTop = 0;
    render('#ppPbsPdfRunBtn');
  }
  function closePdfPanel() {
    ui.pdfPanelOpen = false;
    render('#ppPbsExportPdfBtn');
  }
  function applyPdfPreset(preset) {
    ui.pdfSelectedFields = computePdfPresetFields(preset, doc());
    savePdfFieldPrefs(ui.pdfSelectedFields);
    render();
  }
  function togglePdfGroup(groupKey) {
    const sel = ensurePdfSelectedFields();
    const gCols = getAllReportCols().filter(c => (c.group || 'core') === groupKey);
    if (!gCols.length) return;
    const allSelected = gCols.every(c => sel.has(c.key));
    gCols.forEach(c => {
      if (allSelected) sel.delete(c.key);
      else sel.add(c.key);
    });
    savePdfFieldPrefs(sel);
    render();
  }
  function togglePdfField(fieldKey, checked) {
    const sel = ensurePdfSelectedFields();
    if (checked) sel.add(fieldKey);
    else sel.delete(fieldKey);
    savePdfFieldPrefs(sel);
    render();
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

  function syncPopulatedColGroups(reset) {
    const pop = V().getPopulatedGroupFlags ? V().getPopulatedGroupFlags(doc()) : { docs: false, proc: false, swp: false };
    if (reset) {
      const saved = loadColPrefs();
      if (saved) {
        ui.colGroups = saved;
        ui.userLockedCols = true;
      } else {
        ui.colGroups = { docs: pop.docs, proc: pop.proc, swp: pop.swp };
        ui.userLockedCols = false;
      }
    } else if (!ui.userLockedCols) {
      if (pop.docs) ui.colGroups.docs = true;
      if (pop.proc) ui.colGroups.proc = true;
      if (pop.swp) ui.colGroups.swp = true;
    }
  }
  function toggleColGroup(groupKey) {
    if (!['docs', 'proc', 'swp'].includes(groupKey)) return;
    ui.colGroups[groupKey] = !ui.colGroups[groupKey];
    saveColPrefs(ui.colGroups);
    render();
  }
  function setMainOnlyCols() {
    ui.colGroups = { docs: false, proc: false, swp: false };
    saveColPrefs(ui.colGroups);
    render();
  }
  function showAllUsedCols() {
    const pop = V().getPopulatedGroupFlags ? V().getPopulatedGroupFlags(doc()) : { docs: false, proc: false, swp: false };
    ui.colGroups = { docs: pop.docs, proc: pop.proc, swp: pop.swp };
    saveColPrefs(ui.colGroups);
    render();
  }

  /* ---------- Files, exports, clone ---------- */
  async function readFileText(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error('File is too large (limit 2 MB).');
    if (typeof ppReadRawFileText === 'function') return ppReadRawFileText(file);
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
    if (d.items.length) {
      const ok = await askConfirm({
        title: 'Replace Existing PBS Items?',
        message: `Replace the ${d.items.length} existing items with ${loaded.items.length} items from "${file.name}"?`,
        confirmLabel: 'Replace PBS',
        tone: 'danger',
      });
      if (!ok) return;
    }
    pushUndo(`Load ${file.name}`);
    loaded.meta.revision = Math.max(Number(loaded.meta.revision) || 1, Number(d.meta.revision) || 1);
    C().replaceDoc(loaded, wasEncrypted);
    ui.collapsedIds.clear(); ui.edit = null; ui.pasteOpen = false; ui.pdfPanelOpen = false;
    syncPopulatedColGroups(true);
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
    if (d.items.length) {
      const ok = await askConfirm({
        title: 'Append Imported CSV Items?',
        message: `Append ${items.length} imported items to the ${d.items.length} existing items?`,
        confirmLabel: 'Append Items',
        tone: 'primary',
      });
      if (!ok) return;
    }
    pushUndo(`Import ${items.length} CSV items`);
    d.items.push(...items);
    ui.notices = [`Imported ${items.length} item${items.length === 1 ? '' : 's'} from ${file.name}.`, ...warnings];
    syncPopulatedColGroups(false);
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

  function buildPdfOptions(currentViewOnly, selectedFieldKeys, applyActiveFilters) {
    const date = todayIso();
    const d = doc();
    const db = C().getDb();
    let opts = { todayIso: date };
    const useFilters = selectedFieldKeys ? Boolean(applyActiveFilters) : Boolean(currentViewOnly);
    if (selectedFieldKeys) {
      opts.selectedFieldKeys = Array.from(selectedFieldKeys);
    } else if (currentViewOnly) {
      opts.visibleOptKeys = V().resolveVisibleOptionalCols(d, ui.colGroups).map(c => c.key);
    } else {
      return opts;
    }
    if (useFilters && hasActiveFilter()) {
      const summary = T().computeMaturitySummary(d, db.milestones || [], date);
      const rollups = T().computeSwpRollups(d);
      const rows = T().getFilteredTreeRows(d, ui.filter, new Set(), { summary, rollups });
      opts.rowIds = rows.map(r => r.item.id);
      opts.matchedIds = rows.filter(r => !r.isContextOnly).map(r => r.item.id);
    }
    return opts;
  }

  function exportPdf(currentViewOnly, selectedFieldKeys, applyActiveFilters) {
    const p = project();
    const date = todayIso();
    const model = R().buildReportModel(doc(), p, C().getDb(), C().getUserName(), date, buildPdfOptions(Boolean(currentViewOnly), selectedFieldKeys, applyActiveFilters));
    const JsPdf = window.jspdf && window.jspdf.jsPDF;
    if (JsPdf) {
      try {
        R().renderPdf(JsPdf, model).save(R().pdfFilename(p, C().state.activeProjectId, date));
        const msg = selectedFieldKeys
          ? `PBS PDF exported (${model.cols.length} field${model.cols.length === 1 ? '' : 's'}).`
          : (currentViewOnly ? 'PBS current-view PDF exported.' : 'PBS PDF report exported.');
        C().toast(msg, 'success');
        return;
      } catch (_e) { /* fall back to print view */ }
    }
    openPrintFallback(model);
  }

  function exportPdfCustom() {
    const sel = ensurePdfSelectedFields();
    if (!sel.size) {
      C().toast('Select at least one field to include in the PDF.', 'warning');
      return;
    }
    exportPdf(false, sel, Boolean(ui.pdfApplyFilters));
    closePdfPanel();
  }

  async function cloneFrom(srcId) {
    const d = doc();
    const src = C().getCache()[srcId];
    const sp = C().getProject(srcId);
    if (!src || !Array.isArray(src.items) || !src.items.length) { C().toast('That project has no PBS items to clone.', 'warning'); render(); return; }
    const items = IO().cloneItems(src).map(it => ({ ...it, maturity: 'Draft' }));
    const label = sp ? `[${sp.code || sp.id}] ${sp.name}` : srcId;
    if (d.items.length) {
      const ok = await askConfirm({
        title: 'Clone PBS Items?',
        message: `Add ${items.length} items cloned from ${label} to the ${d.items.length} existing items? Maturity resets to Draft; milestone links, procurement status and spare availability are not copied.`,
        confirmLabel: 'Clone Items',
        tone: 'primary',
      });
      if (!ok) { render(); return; }
    }
    pushUndo(`Clone from ${label}`);
    d.items.push(...items);
    syncPopulatedColGroups(false);
    commit(`Cloned ${items.length} items from ${label}`);
  }

  /* ---------- Conflict resolution ---------- */
  async function conflictMerge() {
    const S = C().state;
    if (!S.conflictRemoteDoc) return;
    const diff = D().computeConflictDiff(S.activeDoc, S.conflictRemoteDoc);
    const ok = await askConfirm({
      title: 'Merge Remote PBS Changes?',
      message: `Keep all local items (local wins on ${diff.modifiedBoth.length} item${diff.modifiedBoth.length === 1 ? '' : 's'} modified on both sides) and append ${diff.addedRemote.length} new remote item${diff.addedRemote.length === 1 ? '' : 's'}?`,
      confirmLabel: 'Merge & Save',
      tone: 'warning',
    });
    if (!ok) return;
    pushUndo('Merge sync conflict');
    const remoteModified = S.conflictRemoteModified;
    const added = diff.addedRemote.length;
    C().replaceDoc(D().mergeConflictDocs(S.activeDoc, S.conflictRemoteDoc), S.activeWasEncrypted);
    S.activeFileModified = remoteModified;
    const saved = await C().writeToFolder(true);
    if (saved) {
      C().logChange(`Merged ${added} remote item${added === 1 ? '' : 's'} after sync conflict (local wins on edits to the same item)`);
    }
    syncPopulatedColGroups(false);
    render();
  }
  async function conflictLoad() {
    const ok = await askConfirm({
      title: 'Discard Local PBS Changes?',
      message: 'Discard your unsaved local changes and load the shared folder version?',
      confirmLabel: 'Discard & Load Shared',
      tone: 'danger',
    });
    if (!ok) return;
    pushUndo('Load shared folder');
    await C().syncFromFolder({});
    syncPopulatedColGroups(true);
    render();
  }
  async function conflictOverwrite() {
    const ok = await askConfirm({
      title: 'Overwrite Shared PBS File?',
      message: 'Overwrite the shared folder file with your local version? Remote changes from teammates will be lost.',
      confirmLabel: 'Overwrite Shared File',
      tone: 'danger',
    });
    if (!ok) return;
    const saved = await C().writeToFolder(true);
    if (saved) {
      C().logChange('Overwrote shared folder PBS with local version after sync conflict');
    }
    render();
  }

  /* ---------- Event delegation ---------- */
  const BUTTONS = {
    ppPbsExpandWinBtn: () => toggleExpandWindow(),
    ppPbsCloseBtn: () => closeDialog(),
    ppPbsAddRootBtn: () => openForm(null, null),
    ppPbsUndoBtn: () => undo(),
    ppPbsRedoBtn: () => redo(),
    ppPbsExpandAllBtn: () => setAllCollapsed(false),
    ppPbsCollapseAllBtn: () => setAllCollapsed(true),
    ppPbsRenumberBtn: safe(renumberItems),
    ppPbsColsMainBtn: () => setMainOnlyCols(),
    ppPbsColsAllBtn: () => showAllUsedCols(),
    ppPbsLinkFolderBtn: safe(async () => { await C().linkFolder(); render(); }),
    ppPbsRelinkBtn: safe(async () => { await C().linkFolder(); render(); }),
    ppPbsReconnectBtn: safe(async () => { await C().reconnectFolder(); render(); }),
    ppPbsSaveJsonBtn: safe(saveJson),
    ppPbsLoadJsonBtn: () => { const el = q('#ppPbsJsonFileInput'); if (el) el.click(); },
    ppPbsExportCsvBtn: safe(exportCsv),
    ppPbsImportCsvBtn: () => { const el = q('#ppPbsCsvFileInput'); if (el) el.click(); },
    ppPbsPasteBtn: () => (ui.pasteOpen ? closePastePanel() : openPastePanel()),
    ppPbsPasteCancel: () => closePastePanel(),
    ppPbsPasteSubmit: safe(submitPaste),
    ppPbsExportSvgBtn: safe(exportSvg),
    ppPbsExportPdfBtn: () => (ui.pdfPanelOpen ? closePdfPanel() : openPdfPanel()),
    ppPbsPdfCancelBtn: () => closePdfPanel(),
    ppPbsPdfRunBtn: safe(exportPdfCustom),
    ppPbsExportPdfViewBtn: safe(() => exportPdf(true)),
    ppPbsClearFiltersBtn: () => { ui.filter = emptyFilter(); render('#ppPbsFilterSearch'); },
    ppPbsFormCancel: () => closeForm(ui.edit ? ui.edit.itemId : null),
    ppPbsConflictMerge: safe(conflictMerge),
    ppPbsConflictLoad: safe(conflictLoad),
    ppPbsConflictOverwrite: safe(conflictOverwrite),
  };

  function onClick(e) {
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t || !ui.dialog.contains(t)) return;
    const d = t.dataset;
    if (d.pbsFlagPill) {
      ui.filter.flag = ui.filter.flag === d.pbsFlagPill ? '' : d.pbsFlagPill;
      render();
      return;
    }
    if (d.pbsPdfPreset) return applyPdfPreset(d.pbsPdfPreset);
    if (d.pbsPdfGroupToggle) return togglePdfGroup(d.pbsPdfGroupToggle);
    if (d.pbsColGroup) return toggleColGroup(d.pbsColGroup);
    if (d.pbsToggle) return toggleItem(d.pbsToggle);
    if (d.pbsMove) return moveItem(d.pbsId, d.pbsMove);
    if (d.pbsAddChild) return openForm(null, d.pbsAddChild);
    if (d.pbsEdit) return openForm(d.pbsEdit, null);
    if (d.pbsDel) return safe(deleteItem)(d.pbsDel);
    const fn = BUTTONS[t.id];
    if (fn) fn();
  }

  function onDblClick(e) {
    if (e.target.closest && e.target.closest('button, a, input, select, textarea, form')) return;
    const row = e.target.closest ? e.target.closest('[data-pbs-row]') : null;
    if (!row || !ui.dialog.contains(row)) return;
    const id = row.getAttribute('data-pbs-row');
    if (id) openForm(id, null);
  }

  function onChange(e) {
    const t = e.target;
    const files = t.files;
    if (t.hasAttribute && t.hasAttribute('data-pbs-pdf-field')) {
      togglePdfField(t.getAttribute('data-pbs-pdf-field'), Boolean(t.checked));
    } else if (t.id === 'ppPbsPdfApplyFilters') {
      ui.pdfApplyFilters = Boolean(t.checked);
      render();
    } else if (t.id === 'ppPbsJsonFileInput' || t.id === 'ppPbsCsvFileInput') {
      const file = files && files[0];
      const isJson = t.id === 'ppPbsJsonFileInput';
      t.value = '';
      if (file) safe(isJson ? loadJson : importCsv)(file);
    } else if (t.id === 'ppPbsFilterDept') { ui.filter.deptId = t.value; render();
    } else if (t.id === 'ppPbsFilterMaturity') { ui.filter.maturity = t.value; render();
    } else if (t.id === 'ppPbsFilterMs') { ui.filter.milestoneId = t.value; render();
    } else if (t.id === 'ppPbsFilterHeritage') { ui.filter.heritage = t.value; render();
    } else if (t.id === 'ppPbsFilterProc') { ui.filter.procStatus = t.value; render();
    } else if (t.id === 'ppPbsFilterFlag') { ui.filter.flag = t.value; render();
    } else if (t.id === 'ppPbsCloneSelect' && t.value) { safe(cloneFrom)(t.value); }
  }

  function onInput(e) {
    if (e.target.id === 'ppPbsFilterSearch') { ui.filter.search = e.target.value; render(); }
  }

  function onKeydown(e) {
    const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
    const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (!inEditable && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    }
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
      let next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      while (next && !next.hasAttribute('data-pbs-row')) {
        next = e.key === 'ArrowDown' ? next.nextElementSibling : next.previousElementSibling;
      }
      if (next && next.hasAttribute('data-pbs-row')) {
        const tblWrap = q('.pp-pbs-table-wrap');
        const sl = tblWrap ? tblWrap.scrollLeft : 0;
        next.focus({ preventScroll: true });
        if (typeof next.scrollIntoView === 'function') next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (tblWrap) tblWrap.scrollLeft = sl;
      }
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
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('submit', (e) => { if (e.target.id === 'ppPbsItemForm') { e.preventDefault(); submitForm(); } });
    el.addEventListener('cancel', (e) => {
      if (ui.edit) { e.preventDefault(); closeForm(ui.edit.itemId); }
      else if (ui.pasteOpen) { e.preventDefault(); closePastePanel(); }
      else if (ui.pdfPanelOpen) { e.preventDefault(); closePdfPanel(); }
    });
    el.addEventListener('close', () => { safe(onClosed)(); });
  }

  async function onClosed() {
    const core = C();
    const S = core.state;
    const lockedOrSigningOut = (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked())
      || (typeof ppIsSigningOut === 'function' && ppIsSigningOut());
    if (lockedOrSigningOut) {
      core.stopPolling();
      if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
      ui.edit = null; ui.draft = null; ui.pasteOpen = false; ui.pdfPanelOpen = false; ui.undoStack = []; ui.redoStack = [];
      return;
    }
    for (let i = 0; i < 20 && S.isSaving; i++) await new Promise(r => setTimeout(r, 100));
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    if (S.dirHandle && (S.syncStatusText === 'Saving...' || S.saveQueued || S.dirtyProjectIds.has(S.activeProjectId)) && !S.conflictRemoteText) {
      S.saveQueued = false;
      await core.writeToFolder(false);
    }
    ui.edit = null; ui.draft = null; ui.pasteOpen = false; ui.pdfPanelOpen = false; ui.undoStack = []; ui.redoStack = [];
    if (S.dirHandle) core.startPolling();
    if (typeof ui.badgeRefresh === 'function') ui.badgeRefresh();
  }

  function closeDialog() { if (ui.dialog && ui.dialog.open) ui.dialog.close(); }

  async function open(projectId) {
    if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
    const core = C();
    if (!core.openSession(projectId)) { core.toast('Project not found.', 'error'); return; }
    ensureDialog();
    V().injectStyles();
    ui.filter = emptyFilter();
    ui.collapsedIds = new Set(); ui.edit = null; ui.pasteOpen = false; ui.pdfPanelOpen = false; ui.pdfSelectedFields = null;
    ui.expanded = loadExpandPref();
    applyExpandedClass();
    ui.undoStack = []; ui.redoStack = []; ui.notices = [];
    syncPopulatedColGroups(true);
    const hooks = core.state.hooks;
    hooks.rerender = () => render();
    hooks.onStatus = updateStatusPill;
    hooks.isDialogOpen = isOpen;
    hooks.onBadges = () => { if (typeof ui.badgeRefresh === 'function') ui.badgeRefresh(); };
    if (!ui.dialog.open) ui.dialog.showModal();
    render();
    await core.initFolder({ allowPrompt: true });
    syncPopulatedColGroups(true);
    render();
  }

  P.ui = {
    open, close: closeDialog, isOpen, render,
    setBadgeRefresh(fn) {
      ui.badgeRefresh = fn;
      if (C() && C().state && C().state.hooks) {
        C().state.hooks.onBadges = () => { if (typeof ui.badgeRefresh === 'function') ui.badgeRefresh(); };
      }
    },
  };
})();
