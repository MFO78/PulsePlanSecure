/* Isolated per-project Microsoft Project XML (.xml) milestone importer & file monitor. */
(function ppMspImportModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  const META_KEY = 'pulseplan_msp_meta_v1';
  const IDB_NAME = 'pulseplan_msp_handles_v1';
  const IDB_STORE = 'handles';
  const POLL_MS = 30000;

  let mspMeta = loadMeta();
  const activeHandles = new Map();
  const rememberedHandles = new Map();
  const pendingDiffs = new Map();
  let activeProjectId = '';
  let activePreviewDiff = null;
  let activePreviewFileName = '';
  let activePreviewLastMod = 0;
  let showIgnoredInPreview = false;
  let pollTimer = null;

  function supportsFilePicker() {
    return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
  }

  function esc(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(str ?? ''));
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { projects: [], milestones: [] };
  }

  function getProject(projectId) {
    const db = getDb();
    return (db.projects || []).find(p => p.id === projectId) || null;
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function loadMeta() {
    if (typeof ppShouldSuppressPlaintextStorage === 'function' && ppShouldSuppressPlaintextStorage()) {
      return {};
    }
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(META_KEY) : localStorage.getItem(META_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function saveMeta() {
    try {
      if (typeof ppShouldSuppressPlaintextStorage === 'function' && ppShouldSuppressPlaintextStorage()) {
        try { localStorage.removeItem(META_KEY); } catch (_e) {}
        return;
      }
      const raw = JSON.stringify(mspMeta);
      if (typeof safeSetStorage === 'function') safeSetStorage(META_KEY, raw);
      else localStorage.setItem(META_KEY, raw);
    } catch (_e) {}
  }

  function getProjectMeta(projectId) {
    if (!mspMeta[projectId] || typeof mspMeta[projectId] !== 'object') {
      mspMeta[projectId] = { fileName: '', lastModified: 0, lastSyncedAt: '', autoApply: false, uidMap: {}, ignoredUids: [] };
    }
    if (!mspMeta[projectId].uidMap || typeof mspMeta[projectId].uidMap !== 'object') mspMeta[projectId].uidMap = {};
    if (!Array.isArray(mspMeta[projectId].ignoredUids)) mspMeta[projectId].ignoredUids = [];
    return mspMeta[projectId];
  }

  /* ---------- IndexedDB for Per-Project XML File Handles (Chrome/Edge) ---------- */
  function openHandleDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveHandle(projectId, handle) {
    try {
      const db = await openHandleDb();
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, projectId);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_e) {}
  }

  async function loadAllHandles() {
    try {
      const db = await openHandleDb();
      if (!db) return;
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            rememberedHandles.set(String(cursor.key), cursor.value);
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      });
    } catch (_e) {}
  }

  async function ensureReadPermission(handle, promptUser) {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    const opts = { mode: 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (promptUser && typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission(opts)) === 'granted';
    }
    return false;
  }

  /* ---------- MS Project XML (MSPDI) Parser ---------- */
  function childText(el, tagName) {
    if (!el || !el.childNodes) return '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const node = el.childNodes[i];
      if (node.nodeType === 1) {
        const local = (node.localName || node.nodeName || '').replace(/^.*:/, '');
        if (local === tagName) return String(node.textContent || '').trim();
      }
    }
    return '';
  }

  function normalizeDate(raw) {
    const m = String(raw || '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function parseMspXml(xmlText) {
    if (typeof DOMParser === 'undefined') {
      throw new Error('XML parser is unavailable in this environment.');
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(xmlText || ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Selected file is not valid MS Project XML.');
    }
    const tasks = Array.from(doc.getElementsByTagNameNS ? doc.getElementsByTagNameNS('*', 'Task') : doc.getElementsByTagName('Task'));
    const milestones = [];
    tasks.forEach(task => {
      const uid = childText(task, 'UID');
      if (!uid || uid === '0') return;
      if (childText(task, 'IsNull') === '1') return;
      if (childText(task, 'Milestone') !== '1') return;
      const title = childText(task, 'Name');
      if (!title) return;
      const date = normalizeDate(childText(task, 'Finish')) || normalizeDate(childText(task, 'Start'));
      if (!date) return;
      const pct = Number(childText(task, 'PercentComplete') || '0');
      const status = pct >= 100 ? 'Completed' : 'Pending';
      const wbs = childText(task, 'WBS');
      const notesRaw = childText(task, 'Notes');
      const notes = notesRaw || (wbs ? `MS Project WBS ${wbs}` : '');
      milestones.push({
        uid,
        externalUid: `msp:${uid}`,
        title,
        date,
        status,
        notes,
      });
    });
    return milestones;
  }

  /* ---------- Diff & Safe Apply Engine (Duplicate-Proof + Strict Selection) ---------- */
  function computeMspDiff(projectId, parsedList, existingAll) {
    const meta = getProjectMeta(projectId);
    const uidMap = meta.uidMap || {};
    const ignoredSet = new Set(meta.ignoredUids || []);
    const existing = (existingAll || []).filter(m => m && m.projectId === projectId);
    const byId = new Map(existing.map(m => [String(m.id), m]));
    const byExtUid = new Map();
    const byTitle = new Map();

    existing.forEach(m => {
      if (m.externalUid) byExtUid.set(String(m.externalUid), m);
      const normTitle = String(m.title || '').trim().toLowerCase();
      if (normTitle && !byTitle.has(normTitle)) byTitle.set(normTitle, m);
    });

    const added = [];
    const ignored = [];
    const updated = [];
    let unchanged = 0;
    const matchedIds = new Set();

    parsedList.forEach(pm => {
      let match = byExtUid.get(pm.externalUid) || null;
      if (!match && uidMap[pm.externalUid]) {
        match = byId.get(String(uidMap[pm.externalUid])) || null;
      }
      if (!match) {
        const byNameMatch = byTitle.get(pm.title.trim().toLowerCase()) || null;
        if (byNameMatch && !matchedIds.has(byNameMatch.id)) {
          match = byNameMatch;
        }
      }

      if (!match) {
        if (ignoredSet.has(pm.externalUid)) {
          ignored.push(pm);
        } else {
          added.push(pm);
        }
      } else {
        matchedIds.add(match.id);
        uidMap[pm.externalUid] = match.id;
        const changes = [];
        if (String(match.title || '').trim() !== pm.title) changes.push(`Title: "${match.title}" -> "${pm.title}"`);
        if (String(match.date || '').trim() !== pm.date) changes.push(`Date: ${match.date || 'none'} -> ${pm.date}`);
        if (String(match.status || 'Pending') !== pm.status) changes.push(`Status: ${match.status || 'Pending'} -> ${pm.status}`);
        if (changes.length > 0) {
          updated.push({ existingId: match.id, existing: match, incoming: pm, changes });
        } else {
          unchanged++;
        }
      }
    });

    const trackedIds = new Set(Object.values(uidMap).map(String));
    const removed = existing.filter(m => {
      const isMsp = (m.externalUid && String(m.externalUid).startsWith('msp:')) || trackedIds.has(String(m.id));
      return isMsp && !matchedIds.has(m.id);
    });

    return { added, ignored, updated, removed, unchanged, totalParsed: parsedList.length };
  }

  function persistAppChanges() {
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
    if (typeof renderAll === 'function') renderAll();
  }

  function applyMspDiff(projectId, diff, opts = {}) {
    const db = getDb();
    const meta = getProjectMeta(projectId);
    if (!Array.isArray(db.milestones)) db.milestones = [];
    if (typeof pushUndoState === 'function') pushUndoState('Apply MS Project milestone sync');

    const hasExplicitAddList = Array.isArray(opts.addUids);
    const addSet = hasExplicitAddList ? new Set(opts.addUids.map(String)) : null;
    const hasExplicitUpdList = Array.isArray(opts.updateIds);
    const updSet = hasExplicitUpdList ? new Set(opts.updateIds.map(String)) : null;
    const remSet = Array.isArray(opts.removeIds) ? new Set(opts.removeIds.map(String)) : new Set();

    let addedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    const ignoredSet = new Set(meta.ignoredUids || []);

    const candidatesToAdd = [...(diff.added || []), ...(opts.includeIgnored ? (diff.ignored || []) : [])];
    candidatesToAdd.forEach(pm => {
      const shouldAdd = hasExplicitAddList ? addSet.has(pm.externalUid) : !ignoredSet.has(pm.externalUid);
      if (!shouldAdd) {
        if (hasExplicitAddList) ignoredSet.add(pm.externalUid);
        return;
      }
      ignoredSet.delete(pm.externalUid);
      const newId = makeId('ms');
      db.milestones.push({
        id: newId,
        projectId,
        title: pm.title,
        date: pm.date,
        status: pm.status,
        notes: pm.notes,
        externalUid: pm.externalUid,
        externalSource: 'msproject',
      });
      meta.uidMap[pm.externalUid] = newId;
      addedCount++;
    });

    (diff.updated || []).forEach(u => {
      if (hasExplicitUpdList && !updSet.has(String(u.existingId))) return;
      const target = db.milestones.find(m => m.id === u.existingId);
      if (target) {
        target.title = u.incoming.title;
        target.date = u.incoming.date;
        target.status = u.incoming.status;
        target.externalUid = u.incoming.externalUid;
        if (u.incoming.notes && !target.notes) target.notes = u.incoming.notes;
        meta.uidMap[u.incoming.externalUid] = target.id;
        updatedCount++;
      }
    });

    if (remSet.size > 0) {
      const before = db.milestones.length;
      db.milestones = db.milestones.filter(m => !(m.projectId === projectId && remSet.has(String(m.id))));
      removedCount = before - db.milestones.length;
      Object.keys(meta.uidMap).forEach(k => {
        if (remSet.has(String(meta.uidMap[k]))) delete meta.uidMap[k];
      });
    }

    meta.ignoredUids = Array.from(ignoredSet);
    saveMeta();

    if (addedCount + updatedCount + removedCount > 0) {
      persistAppChanges();
    }
    return { addedCount, updatedCount, removedCount };
  }

  /* ---------- File Reading & Background Monitoring ---------- */
  async function readAndProcessFile(projectId, file, isBackgroundCheck) {
    const project = getProject(projectId);
    const meta = getProjectMeta(projectId);
    const xmlText = await file.text();
    const parsed = parseMspXml(xmlText);
    const db = getDb();
    const diff = computeMspDiff(projectId, parsed, db.milestones || []);
    const hasActionable = diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;

    if (isBackgroundCheck && meta.autoApply && (diff.added.length > 0 || diff.updated.length > 0)) {
      const res = applyMspDiff(projectId, diff, { removeIds: [] });
      meta.fileName = file.name || meta.fileName;
      meta.lastModified = file.lastModified || Date.now();
      meta.lastSyncedAt = new Date().toISOString();
      saveMeta();
      pendingDiffs.delete(projectId);
      refreshProjectsTableButtons();
      toast(`Auto-applied MS Project updates for [${project ? project.code : projectId}]: +${res.addedCount} new, ${res.updatedCount} updated.`, 'success');
      return { autoApplied: true, diff };
    }

    if (isBackgroundCheck) {
      if (hasActionable) {
        pendingDiffs.set(projectId, { diff, fileName: file.name || meta.fileName, lastModified: file.lastModified || Date.now() });
        refreshProjectsTableButtons();
        toast(`MS Project update detected for [${project ? project.code : projectId}] (${diff.added.length} new, ${diff.updated.length} changed).`, 'info');
      } else {
        meta.lastModified = file.lastModified || meta.lastModified;
        meta.lastSyncedAt = new Date().toISOString();
        saveMeta();
        pendingDiffs.delete(projectId);
        refreshProjectsTableButtons();
      }
      return { autoApplied: false, diff };
    }

    activePreviewDiff = diff;
    activePreviewFileName = file.name || meta.fileName;
    activePreviewLastMod = file.lastModified || Date.now();
    return { autoApplied: false, diff };
  }

  async function linkXmlFileForProject(projectId) {
    if (!supportsFilePicker()) {
      toast('Direct file monitoring requires desktop Chrome or Edge. Use Import XML (.xml) instead.', 'info');
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        id: 'pulseplan-msp-xml',
        multiple: false,
        types: [{ description: 'Microsoft Project XML', accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] } }],
      });
      if (!handle) return;
      const ok = await ensureReadPermission(handle, true);
      if (!ok) {
        toast('Read permission was not granted.', 'warning');
        return;
      }
      activeHandles.set(projectId, handle);
      rememberedHandles.set(projectId, handle);
      await saveHandle(projectId, handle);
      const file = await handle.getFile();
      const meta = getProjectMeta(projectId);
      meta.fileName = file.name;
      saveMeta();
      await readAndProcessFile(projectId, file, false);
      renderMspDialog();
      refreshProjectsTableButtons();
      startMonitoring();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast(err?.message || 'Could not link MS Project XML file.', 'error');
    }
  }

  async function reconnectXmlFileForProject(projectId) {
    const handle = rememberedHandles.get(projectId);
    if (!handle) return linkXmlFileForProject(projectId);
    try {
      const ok = await ensureReadPermission(handle, true);
      if (!ok) {
        toast('Read permission not granted.', 'warning');
        return;
      }
      activeHandles.set(projectId, handle);
      const file = await handle.getFile();
      await readAndProcessFile(projectId, file, false);
      renderMspDialog();
      refreshProjectsTableButtons();
      startMonitoring();
    } catch (_e) {
      await linkXmlFileForProject(projectId);
    }
  }

  async function checkAllLinkedFiles() {
    if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return;
    for (const [projectId, handle] of activeHandles.entries()) {
      try {
        const ok = await ensureReadPermission(handle, false);
        if (!ok) continue;
        const file = await handle.getFile();
        const meta = getProjectMeta(projectId);
        if (file.lastModified && file.lastModified > (meta.lastModified || 0)) {
          await readAndProcessFile(projectId, file, true);
        }
      } catch (_e) {}
    }
  }

  function startMonitoring() {
    if (pollTimer) clearInterval(pollTimer);
    if (activeHandles.size === 0) return;
    pollTimer = setInterval(checkAllLinkedFiles, POLL_MS);
  }

  function clearMspMemoryAndStopSync() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    mspMeta = {};
    activeHandles.clear();
    pendingDiffs.clear();
    activeProjectId = '';
    activePreviewDiff = null;
    activePreviewFileName = '';
    activePreviewLastMod = 0;
    try { localStorage.removeItem(META_KEY); } catch (_e) {}
    const dlg = document.getElementById('ppMspDialog');
    if (dlg) {
      try { if (dlg.open && typeof dlg.close === 'function') dlg.close(); } catch (_e) {}
      dlg.innerHTML = '';
    }
  }

  /* ---------- Styles & Dialog UI ---------- */
  function injectStyles() {
    if (document.getElementById('ppMspStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppMspStyles';
    style.textContent = `
      dialog#ppMspDialog { width: min(95vw, 52rem); max-height: 88dvh; padding: 0; border: 1px solid var(--border-subtle, #cbd5e1); border-radius: 1.25rem; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); box-shadow: 0 25px 50px -12px rgba(15,23,42,.35); overflow: hidden; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
      dialog#ppMspDialog::backdrop { background: rgba(15,23,42,.55); backdrop-filter: blur(3px); }
      .pp-msp-shell { display: flex; flex-direction: column; max-height: 88dvh; font-size: 12px; }
      .pp-msp-header { display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-card, #ffffff); }
      .pp-msp-title { margin: 0; font-size: 15px; font-weight: 800; color: var(--text-heading, #0f172a); }
      .pp-msp-sub { margin: .25rem 0 0; font-size: 11px; color: var(--text-muted, #64748b); }
      .pp-msp-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .65rem 1.25rem; background: var(--surface-subtle, #f8fafc); border-bottom: 1px solid var(--border-subtle, #e2e8f0); }
      .pp-msp-group { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
      .pp-msp-btn { display: inline-flex; align-items: center; gap: .3rem; padding: .4rem .72rem; border-radius: .75rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-secondary, #334155); font-size: 11.5px; font-weight: 600; cursor: pointer; }
      .pp-msp-btn:hover { background: var(--surface-hover, #f1f5f9); }
      .pp-msp-btn-sm { padding: .2rem .5rem; border-radius: .5rem; font-size: 10.5px; }
      .pp-msp-btn-primary { background: #4f46e5; border-color: #4f46e5; color: #ffffff; font-weight: 700; }
      .pp-msp-btn-primary:hover { background: #4338ca; border-color: #4338ca; }
      .pp-msp-btn-emerald { background: #059669; border-color: #059669; color: #ffffff; font-weight: 700; }
      .pp-msp-btn-emerald:hover { background: #047857; border-color: #047857; }
      .pp-msp-toggle { display: inline-flex; align-items: center; gap: .4rem; font-size: 11.5px; font-weight: 600; color: var(--text-secondary, #334155); cursor: pointer; }
      .pp-msp-body { flex: 1 1 auto; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: .75rem; background: var(--surface-page, #f1f5f9); }
      .pp-msp-card { border: 1px solid var(--border-subtle, #e2e8f0); border-radius: .85rem; background: var(--surface-card, #ffffff); padding: .75rem .9rem; }
      .pp-msp-card-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
      .pp-msp-card h3 { margin: 0; font-size: 12px; font-weight: 800; color: var(--text-heading, #0f172a); }
      .pp-msp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
      .pp-msp-row { display: flex; align-items: flex-start; gap: .5rem; padding: .35rem .5rem; border-radius: .5rem; background: var(--surface-subtle, #f8fafc); }
      .pp-msp-trigger { padding: .25rem .5rem; border-radius: .5rem; border: 1px solid #bae6fd; background: #f0f9ff; color: #0369a1; font-size: 11px; font-weight: 700; cursor: pointer; margin-right: .25rem; }
      .pp-msp-trigger:hover { background: #e0f2fe; }
      .pp-msp-trigger-warn { border-color: #fcd34d; background: #fef3c7; color: #92400e; }
      html.dark .pp-msp-trigger, body.dark .pp-msp-trigger { background: rgba(14,165,233,.18); border-color: rgba(56,189,248,.4); color: #7dd3fc; }
      html.dark .pp-msp-trigger-warn, body.dark .pp-msp-trigger-warn { background: rgba(245,158,11,.22); border-color: rgba(251,191,36,.45); color: #fde68a; }
    `;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    let dlg = document.getElementById('ppMspDialog');
    if (dlg) return dlg;
    injectStyles();
    dlg = document.createElement('dialog');
    dlg.id = 'ppMspDialog';
    dlg.setAttribute('aria-labelledby', 'ppMspTitle');
    document.body.appendChild(dlg);
    return dlg;
  }

  function renderDiffHtml() {
    if (!activePreviewDiff) {
      return `<div class="pp-msp-card" style="text-align:center;color:var(--text-muted,#64748b);padding:1.75rem">
        Save your schedule in MS Project via <strong>File &rarr; Save As &rarr; XML Format (.xml)</strong>, then click <strong>Link XML File</strong> (Chrome/Edge) or <strong>Import XML</strong> (Firefox/Safari).
      </div>`;
    }
    const d = activePreviewDiff;
    const totalChanges = d.added.length + d.updated.length + d.removed.length + (showIgnoredInPreview ? d.ignored.length : 0);
    if (totalChanges === 0) {
      return `<div class="pp-msp-card" style="text-align:center;color:#047857;font-weight:700;padding:1.5rem">
        Up to date — ${d.unchanged} tracked milestone${d.unchanged === 1 ? '' : 's'} match <code>${esc(activePreviewFileName)}</code>.
        ${d.ignored.length ? `<div style="margin-top:.6rem"><button type="button" id="ppMspToggleIgnoredBtn" class="pp-msp-btn pp-msp-btn-sm">Show ${d.ignored.length} skipped milestone${d.ignored.length === 1 ? '' : 's'}</button></div>` : ''}
      </div>`;
    }
    return `
      <form id="ppMspApplyForm" style="display:flex;flex-direction:column;gap:.75rem">
        ${d.added.length ? `
          <div class="pp-msp-card">
            <div class="pp-msp-card-head">
              <h3>New Milestones (${d.added.length})</h3>
              <div class="pp-msp-group">
                <button type="button" class="pp-msp-btn pp-msp-btn-sm" data-msp-sel="add-all">Select All</button>
                <button type="button" class="pp-msp-btn pp-msp-btn-sm" data-msp-sel="add-none">Select None</button>
              </div>
            </div>
            <ul class="pp-msp-list">
              ${d.added.map(m => `<li class="pp-msp-row"><input type="checkbox" name="addUid" value="${esc(m.externalUid)}" checked /><span><strong>${esc(m.title)}</strong> &middot; ${esc(m.date)} &middot; ${esc(m.status)}</span></li>`).join('')}
            </ul>
          </div>` : ''}
        ${d.updated.length ? `
          <div class="pp-msp-card">
            <div class="pp-msp-card-head"><h3>Changed Milestones (${d.updated.length})</h3></div>
            <ul class="pp-msp-list">
              ${d.updated.map(u => `<li class="pp-msp-row"><input type="checkbox" name="updId" value="${esc(u.existingId)}" checked /><span><strong>${esc(u.incoming.title)}</strong> &mdash; ${esc(u.changes.join(' | '))}</span></li>`).join('')}
            </ul>
          </div>` : ''}
        ${d.removed.length ? `
          <div class="pp-msp-card">
            <div class="pp-msp-card-head"><h3>Missing from MS Project (${d.removed.length} — unchecked by default)</h3></div>
            <ul class="pp-msp-list">
              ${d.removed.map(m => `<li class="pp-msp-row"><input type="checkbox" name="remId" value="${esc(m.id)}" /><span>${esc(m.title)} (${esc(m.date || 'no date')})</span></li>`).join('')}
            </ul>
          </div>` : ''}
        ${showIgnoredInPreview && d.ignored.length ? `
          <div class="pp-msp-card">
            <div class="pp-msp-card-head"><h3>Previously Skipped Milestones (${d.ignored.length})</h3></div>
            <ul class="pp-msp-list">
              ${d.ignored.map(m => `<li class="pp-msp-row"><input type="checkbox" name="addUid" value="${esc(m.externalUid)}" /><span><strong>${esc(m.title)}</strong> &middot; ${esc(m.date)} &middot; ${esc(m.status)}</span></li>`).join('')}
            </ul>
          </div>` : ''}
        <div class="pp-msp-group">
          <button type="submit" class="pp-msp-btn pp-msp-btn-emerald">Apply Selected Changes</button>
          ${d.ignored.length && !showIgnoredInPreview ? `<button type="button" id="ppMspToggleIgnoredBtn" class="pp-msp-btn pp-msp-btn-sm">Show ${d.ignored.length} skipped</button>` : ''}
          <span style="font-size:11px;color:var(--text-muted,#64748b)">${d.unchanged} unchanged &middot; Unchecked new milestones will be remembered as skipped.</span>
        </div>
      </form>`;
  }

  function renderMspDialog() {
    const dlg = ensureDialog();
    const project = getProject(activeProjectId);
    if (!project) return;
    const meta = getProjectMeta(activeProjectId);
    const hasActive = activeHandles.has(activeProjectId);
    const hasRemembered = rememberedHandles.has(activeProjectId);
    const canPick = supportsFilePicker();
    const linkLabel = hasActive ? `Linked: ${meta.fileName || 'XML'}` : (hasRemembered ? `Reconnect: ${meta.fileName || 'XML'}` : 'Link XML File');

    dlg.innerHTML = `
      <div class="pp-msp-shell">
        <header class="pp-msp-header">
          <div>
            <h2 id="ppMspTitle" class="pp-msp-title">MS Project Milestones — [${esc(project.code)}] ${esc(project.name)}</h2>
            <p class="pp-msp-sub">${meta.fileName ? `Source: <code>${esc(meta.fileName)}</code>` : 'No XML file linked yet'}${meta.lastSyncedAt ? ` &middot; Last synced ${esc(meta.lastSyncedAt.slice(0, 16).replace('T', ' '))}` : ''}</p>
          </div>
          <button type="button" id="ppMspCloseBtn" class="pp-msp-btn" aria-label="Close MS Project dialog">&times;</button>
        </header>

        <div class="pp-msp-bar">
          <div class="pp-msp-group">
            ${canPick ? `<button type="button" id="ppMspLinkBtn" class="pp-msp-btn pp-msp-btn-primary">${esc(linkLabel)}</button>` : ''}
            ${hasActive ? `<button type="button" id="ppMspCheckBtn" class="pp-msp-btn">Check Now</button>` : ''}
            <button type="button" id="ppMspImportBtn" class="pp-msp-btn">Import XML (.xml)</button>
            <input type="file" id="ppMspFileInput" accept=".xml,application/xml,text/xml" hidden />
          </div>
          ${canPick ? `
            <label class="pp-msp-toggle" title="Automatically apply updates to tracked milestones when the linked XML file changes. Never deletes or alters manual milestones.">
              <input type="checkbox" id="ppMspAutoApply" ${meta.autoApply ? 'checked' : ''} />
              Auto-apply updates
            </label>` : ''}
        </div>

        <section class="pp-msp-body" aria-label="MS Project milestone diff preview">
          ${renderDiffHtml()}
        </section>
      </div>`;

    dlg.querySelector('#ppMspCloseBtn')?.addEventListener('click', () => dlg.close());
    dlg.querySelector('#ppMspLinkBtn')?.addEventListener('click', () => {
      if (!hasActive && hasRemembered) reconnectXmlFileForProject(activeProjectId);
      else linkXmlFileForProject(activeProjectId);
    });
    dlg.querySelector('#ppMspCheckBtn')?.addEventListener('click', async () => {
      const h = activeHandles.get(activeProjectId);
      if (!h) return;
      try {
        const f = await h.getFile();
        await readAndProcessFile(activeProjectId, f, false);
        renderMspDialog();
      } catch (err) {
        toast(err?.message || 'Could not read linked XML file.', 'error');
      }
    });
    dlg.querySelector('#ppMspImportBtn')?.addEventListener('click', () => {
      dlg.querySelector('#ppMspFileInput')?.click();
    });
    dlg.querySelector('#ppMspFileInput')?.addEventListener('change', async (ev) => {
      const f = ev.target && ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        await readAndProcessFile(activeProjectId, f, false);
        renderMspDialog();
      } catch (err) {
        toast(err?.message || 'Could not parse MS Project XML.', 'error');
      }
    });
    dlg.querySelector('#ppMspAutoApply')?.addEventListener('change', (ev) => {
      const m = getProjectMeta(activeProjectId);
      m.autoApply = Boolean(ev.target.checked);
      saveMeta();
      toast(m.autoApply ? 'Auto-apply enabled for this project (skipped milestones stay skipped; deletions stay manual).' : 'Auto-apply disabled (Safe Preview mode).', 'info');
    });
    dlg.querySelector('#ppMspToggleIgnoredBtn')?.addEventListener('click', () => {
      showIgnoredInPreview = !showIgnoredInPreview;
      renderMspDialog();
    });
    dlg.querySelector('[data-msp-sel="add-all"]')?.addEventListener('click', () => {
      dlg.querySelectorAll('input[name="addUid"]').forEach(cb => { cb.checked = true; });
    });
    dlg.querySelector('[data-msp-sel="add-none"]')?.addEventListener('click', () => {
      dlg.querySelectorAll('input[name="addUid"]').forEach(cb => { cb.checked = false; });
    });
    dlg.querySelector('#ppMspApplyForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!activePreviewDiff) return;
      const form = ev.target;
      const checkedAdds = Array.from(form.querySelectorAll('input[name="addUid"]:checked')).map(el => el.value);
      const checkedUpds = Array.from(form.querySelectorAll('input[name="updId"]:checked')).map(el => el.value);
      const checkedRems = Array.from(form.querySelectorAll('input[name="remId"]:checked')).map(el => el.value);
      if (checkedRems.length > 0 && typeof ppConfirmAction === 'function') {
        const ok = await ppConfirmAction({
          title: `Delete ${checkedRems.length} Milestone${checkedRems.length === 1 ? '' : 's'}?`,
          message: `Applying this MS Project sync will delete ${checkedRems.length} milestone${checkedRems.length === 1 ? '' : 's'} missing from the XML file. Continue?`,
          confirmLabel: 'Apply & Delete',
        });
        if (!ok) return;
      }
      const res = applyMspDiff(activeProjectId, activePreviewDiff, {
        addUids: checkedAdds,
        updateIds: checkedUpds,
        removeIds: checkedRems,
        includeIgnored: showIgnoredInPreview,
      });
      const m = getProjectMeta(activeProjectId);
      m.fileName = activePreviewFileName || m.fileName;
      m.lastModified = activePreviewLastMod || m.lastModified;
      m.lastSyncedAt = new Date().toISOString();
      saveMeta();
      pendingDiffs.delete(activeProjectId);
      activePreviewDiff = null;
      showIgnoredInPreview = false;
      refreshProjectsTableButtons();
      renderMspDialog();
      toast(`Applied MS Project milestones: +${res.addedCount} new, ${res.updatedCount} updated, ${res.removedCount} removed.`, 'success', { undoable: true });
    });
  }

  async function openProjectMspModal(projectId) {
    const project = getProject(projectId);
    if (!project) return;
    activeProjectId = projectId;
    showIgnoredInPreview = false;
    const pending = pendingDiffs.get(projectId);
    if (pending) {
      activePreviewDiff = pending.diff;
      activePreviewFileName = pending.fileName;
      activePreviewLastMod = pending.lastModified;
    } else {
      activePreviewDiff = null;
      activePreviewFileName = '';
      activePreviewLastMod = 0;
    }
    const dlg = ensureDialog();
    renderMspDialog();
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', 'open');
    }
  }

  /* ---------- Non-Destructive Injection into Setup & Data -> Projects ---------- */
  function refreshProjectsTableButtons() {
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
      const hasPending = pendingDiffs.has(projId);
      const isLinked = activeHandles.has(projId) || Boolean((mspMeta[projId] && mspMeta[projId].fileName));
      let btn = cell.querySelector(`button[data-pp-msp-btn="${projId}"]`);
      if (!btn) {
        injectStyles();
        btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-pp-msp-btn', projId);
        btn.title = 'Import or monitor milestones from Microsoft Project XML (.xml)';
        btn.addEventListener('click', () => openProjectMspModal(projId));
        const pbsBtn = cell.querySelector(`button[data-pp-pbs-btn="${projId}"]`);
        if (pbsBtn && pbsBtn.nextSibling) cell.insertBefore(btn, pbsBtn.nextSibling);
        else cell.insertBefore(btn, cell.firstChild);
      }
      btn.className = hasPending ? 'pp-msp-trigger pp-msp-trigger-warn' : 'pp-msp-trigger';
      btn.textContent = hasPending ? 'MSP • Update' : (isLinked ? 'MSP ✓' : 'MSP');
    });
  }

  if (typeof renderDataTab === 'function') {
    const nativeRenderDataTab = renderDataTab;
    renderDataTab = function (...args) {
      const res = nativeRenderDataTab.apply(this, args);
      refreshProjectsTableButtons();
      return res;
    };
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => { checkAllLinkedFiles(); }, { passive: true });
  }

  if (supportsFilePicker()) {
    loadAllHandles().then(async () => {
      for (const [projectId, handle] of rememberedHandles.entries()) {
        if (await ensureReadPermission(handle, false)) {
          activeHandles.set(projectId, handle);
        }
      }
      if (activeHandles.size > 0) {
        startMonitoring();
        checkAllLinkedFiles();
      }
      refreshProjectsTableButtons();
    });
  }

  if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
    const wn = MANUAL_SECTIONS.find(s => s && s.id === 'whatsnew');
    if (wn && typeof wn.bodyHtml === 'string' && !wn.bodyHtml.includes('MS Project XML Milestone Import')) {
      wn.keywords = `${wn.keywords || ''} ms project xml milestone import monitor auto-apply`;
      wn.bodyHtml = wn.bodyHtml.replace(
        '</ul>',
        `<li>&bull; <strong>MS Project XML Milestone Import &amp; Monitor:</strong> Click <strong>MSP</strong> on any project row in <strong>Setup &amp; Data &rarr; Projects</strong> to link or import a Microsoft Project <code class="px-1 rounded bg-white font-mono">.xml</code> file, select specific milestones to track, or enable the optional per-project <strong>Auto-apply updates</strong> toggle in Chrome/Edge.</li></ul>`
      );
    }
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.openProjectMspModal = openProjectMspModal;
    globalThis.ppClearMspMemoryAndStopSync = clearMspMemoryAndStopSync;
    globalThis.__ppMspTestApi = {
      parseMspXml,
      computeMspDiff,
      applyMspDiff,
      getProjectMeta,
      clearMspMemoryAndStopSync,
    };
  }
  if (typeof window !== 'undefined') {
    window.ppClearMspMemoryAndStopSync = clearMspMemoryAndStopSync;
  }
})();
