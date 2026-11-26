/* PBS v2 - part 5a/7: app core (session state, shared-folder sync with conflict guard, cache, ChangeLog, owner suggestions).
 * Inert: only registers window.__ppPbsV2.core; no DOM access, timers or storage reads happen until the UI calls into it. */
(function ppPbsV2CorePart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const IDB_NAME = 'pulseplan_pbs_handles_v1';
  const IDB_STORE = 'handles';
  const IDB_DIR_KEY = 'pbs_dir_handle';
  const PEOPLE_KEY = 'pulseplan_people_dir_v1';
  const POLL_MS = 15000;
  const SAVE_DEBOUNCE_MS = 650;

  const S = {
    dirHandle: null, rememberedDirHandle: null,
    activeProjectId: '', activeDoc: null, activeFileModified: 0, activeWasEncrypted: false,
    saveTimer: null, pollTimer: null, isSaving: false,
    conflictRemoteText: null, conflictRemoteDoc: null, conflictRemoteModified: 0,
    cache: null, syncStatusText: 'Saved locally in browser', syncStatusTone: 'idle',
    hooks: { rerender() {}, onBadges() {}, onStatus() {}, isDialogOpen() { return false; } },
  };

  const D = () => P.data;
  const supportsDirSync = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  const getSessionPassphrase = () => ((typeof ppSyncPassphrase === 'string' && ppSyncPassphrase) ? ppSyncPassphrase : '');

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { departments: [], projects: [], milestones: [], changeLog: [] };
  }
  const getUserName = () => ((typeof ui !== 'undefined' && ui && ui.userName) ? ui.userName : 'Project Mgr');
  const toast = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type || 'info'); };
  const getProject = (id) => (getDb().projects || []).find(p => p.id === id) || null;
  const getCache = () => (S.cache || (S.cache = D().loadCache()));
  const persistCache = () => D().saveCache(getCache());
  const fileNameFor = () => D().getPbsFilename(getProject(S.activeProjectId), S.activeProjectId);

  function setSyncStatus(text, tone) {
    S.syncStatusText = text;
    S.syncStatusTone = tone || 'idle';
    S.hooks.onStatus(S.syncStatusText, S.syncStatusTone);
  }

  /* ---------- ChangeLog & owner suggestions ---------- */
  function logChange(summary) {
    const db = getDb();
    if (!db || !Array.isArray(db.changeLog)) return;
    const proj = getProject(S.activeProjectId);
    const label = proj ? `[${proj.code || proj.id}] ${proj.name}` : S.activeProjectId;
    db.changeLog.unshift({
      id: typeof uid === 'function' ? uid('log') : D().makeId('log'),
      timestamp: new Date().toISOString(), user: getUserName(), type: 'PBS', summary: `${label}: ${summary}`,
    });
    if (db.changeLog.length > 300) db.changeLog.length = 300;
    if (typeof saveLocalState === 'function') saveLocalState();
  }

  function getOwnerSuggestions() {
    const names = new Set();
    const add = (v) => { const t = String(v || '').trim(); if (t) names.add(t); };
    const db = getDb();
    (db.peopleDirectory || []).forEach(p => p && add(p.name));
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(PEOPLE_KEY) : localStorage.getItem(PEOPLE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) parsed.forEach(p => p && add(p.name));
    } catch (_e) {}
    (db.projects || []).forEach(p => { if (p) { add(p.owner); add(p.techLead); } });
    (db.departments || []).forEach(d => d && add(d.manager));
    if (S.activeDoc) S.activeDoc.items.forEach(it => add(it.owner));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function getManufacturerSuggestions() {
    const names = new Set();
    const add = (v) => { const t = String(v || '').trim(); if (t) names.add(t); };
    const cache = getCache();
    Object.keys(cache).forEach(pid => {
      const d = cache[pid];
      if (d && Array.isArray(d.items)) d.items.forEach(it => it && add(it.manufacturer));
    });
    if (S.activeDoc && Array.isArray(S.activeDoc.items)) S.activeDoc.items.forEach(it => it && add(it.manufacturer));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function getProcStatusSuggestions() {
    const presets = (P.PROC_STATUS_PRESETS || ['Not Started', 'RFQ', 'Ordered', 'In Manufacture', 'In Transit', 'Received', 'In Stock', 'Delivered']);
    const seen = new Set(presets.map(s => s.toLowerCase()));
    const extras = [];
    const add = (v) => {
      const t = String(v || '').trim();
      if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); extras.push(t); }
    };
    const cache = getCache();
    Object.keys(cache).forEach(pid => {
      const d = cache[pid];
      if (d && Array.isArray(d.items)) d.items.forEach(it => it && add(it.procurementStatus));
    });
    if (S.activeDoc && Array.isArray(S.activeDoc.items)) S.activeDoc.items.forEach(it => it && add(it.procurementStatus));
    return [...presets, ...extras.sort((a, b) => a.localeCompare(b))];
  }

  /* ---------- Remembered folder handle (IndexedDB, Chrome/Edge) ---------- */
  function openHandleDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function saveRememberedDirHandle(handle) {
    try {
      const db = await openHandleDb();
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, IDB_DIR_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_e) {}
  }
  async function loadRememberedDirHandle() {
    try {
      const db = await openHandleDb();
      if (!db) return null;
      return await new Promise((resolve) => {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_DIR_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_e) { return null; }
  }
  async function ensureDirPermission(handle, promptUser) {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (promptUser && typeof handle.requestPermission === 'function') return (await handle.requestPermission(opts)) === 'granted';
    return false;
  }

  /* ---------- Session ---------- */
  function openSession(projectId) {
    const project = getProject(projectId);
    if (!project) return null;
    S.activeProjectId = projectId;
    S.activeWasEncrypted = Boolean(getSessionPassphrase());
    S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
    const cached = getCache()[projectId];
    S.activeDoc = (cached && D().normalizePbsDoc(cached, project, getUserName())) || D().createEmptyPbs(project, getUserName(), projectId);
    setSyncStatus(S.dirHandle ? `Synced (${fileNameFor()})` : 'Saved locally in browser', S.dirHandle ? 'ok' : 'idle');
    return S.activeDoc;
  }

  /* Restores a previously linked folder (no prompt) and loads the active project's file from it. */
  async function initFolder() {
    if (!S.dirHandle && !S.rememberedDirHandle && supportsDirSync()) {
      S.rememberedDirHandle = await loadRememberedDirHandle();
      if (S.rememberedDirHandle && await ensureDirPermission(S.rememberedDirHandle, false)) S.dirHandle = S.rememberedDirHandle;
    }
    if (S.dirHandle) {
      await syncFromFolder({ silentMissing: true, silentErrors: true });
      startPolling();
    }
  }

  function replaceDoc(doc, wasEncrypted) {
    S.activeDoc = doc;
    S.activeWasEncrypted = Boolean(wasEncrypted) || Boolean(getSessionPassphrase());
    S.conflictRemoteText = null; S.conflictRemoteDoc = null;
    getCache()[S.activeProjectId] = doc;
    persistCache();
    S.hooks.onBadges();
  }

  /* ---------- Folder link / read / write ---------- */
  async function afterFolderConnected() {
    toast(`Linked PBS folder: ${S.dirHandle.name}`, 'success');
    if (S.activeProjectId) {
      const loaded = await syncFromFolder({ silentMissing: true });
      if (!loaded && S.activeDoc && S.activeDoc.items.length > 0) await writeToFolder(false);
      S.hooks.rerender();
      startPolling();
    }
  }

  async function linkFolder() {
    if (!supportsDirSync()) { toast('Direct folder auto-sync requires desktop Chrome or Edge. Use Save / Load JSON in other browsers.', 'info'); return; }
    try {
      const handle = await window.showDirectoryPicker({ id: 'pulseplan-pbs-folder', mode: 'readwrite' });
      if (!(await ensureDirPermission(handle, true))) { toast('Folder permission was not granted.', 'warning'); return; }
      S.dirHandle = handle; S.rememberedDirHandle = handle;
      await saveRememberedDirHandle(handle);
      await afterFolderConnected();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast((err && err.message) || 'Could not link PBS folder.', 'error');
    }
  }

  async function reconnectFolder() {
    if (!S.rememberedDirHandle) return linkFolder();
    try {
      if (!(await ensureDirPermission(S.rememberedDirHandle, true))) { toast('Folder permission not granted.', 'warning'); return; }
      S.dirHandle = S.rememberedDirHandle;
      await afterFolderConnected();
    } catch (_e) { await linkFolder(); }
  }

  async function getFileHandle(create) {
    if (!S.dirHandle || !S.activeProjectId) return null;
    try {
      return await S.dirHandle.getFileHandle(fileNameFor(), { create: Boolean(create) });
    } catch (err) {
      if (!create && err && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  async function syncFromFolder(opts = {}) {
    if (!S.dirHandle || !S.activeProjectId) return false;
    const project = getProject(S.activeProjectId);
    try {
      const fh = await getFileHandle(false);
      if (!fh) {
        S.activeFileModified = 0;
        if (!opts.silentMissing) toast(`No existing ${fileNameFor()} in folder yet. First edit will create it.`, 'info');
        return false;
      }
      const file = await fh.getFile();
      const { doc, wasEncrypted } = await D().decodePbsFromText(await file.text(), project, undefined, getUserName());
      S.activeDoc = doc;
      S.activeFileModified = file.lastModified || 0;
      S.activeWasEncrypted = wasEncrypted || Boolean(getSessionPassphrase());
      getCache()[S.activeProjectId] = doc;
      persistCache();
      S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
      setSyncStatus(`Synced (${fileNameFor()})`, 'ok');
      S.hooks.onBadges();
      return true;
    } catch (err) {
      setSyncStatus((err && err.message) || 'Sync read failed', 'error');
      if (!opts.silentErrors) toast((err && err.message) || 'Could not read PBS file from folder.', 'error');
      return false;
    }
  }

  async function writeToFolder(forceOverwrite) {
    if (!S.dirHandle || !S.activeProjectId || !S.activeDoc || S.isSaving) return;
    S.isSaving = true;
    const project = getProject(S.activeProjectId);
    try {
      const fh = await getFileHandle(true);
      if (!forceOverwrite && S.activeFileModified > 0) {
        const existing = await fh.getFile();
        if (existing.lastModified && existing.lastModified > S.activeFileModified) {
          const remoteText = await existing.text();
          let sameWrite = false;
          try {
            const parsed = JSON.parse(remoteText);
            sameWrite = Boolean(parsed && parsed.meta && parsed.meta.lastWriteId && parsed.meta.lastWriteId === S.activeDoc.meta.lastWriteId);
          } catch (_e) {}
          if (!sameWrite) {
            S.conflictRemoteText = remoteText;
            S.conflictRemoteModified = existing.lastModified;
            S.conflictRemoteDoc = null;
            try { S.conflictRemoteDoc = (await D().decodePbsFromText(remoteText, project, undefined, getUserName())).doc; } catch (_e) {}
            setSyncStatus('Conflict detected \u2014 auto-save paused', 'warn');
            S.hooks.rerender();
            return;
          }
        }
      }
      const doc = S.activeDoc;
      doc.meta.revision = (Number(doc.meta.revision) || 0) + 1;
      doc.meta.lastModifiedAt = new Date().toISOString();
      doc.meta.lastModifiedBy = getUserName();
      doc.meta.lastWriteId = D().makeId('w');
      const { text, encrypted } = await D().encodePbsForDisk(doc, S.activeWasEncrypted);
      if (encrypted) S.activeWasEncrypted = true;
      const writable = await fh.createWritable();
      await writable.write(text);
      await writable.close();
      S.activeFileModified = (await fh.getFile()).lastModified || Date.now();
      S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
      getCache()[S.activeProjectId] = doc;
      persistCache();
      setSyncStatus(`${encrypted ? 'Encrypted & synced' : 'Synced'} (${fileNameFor()})`, 'ok');
    } catch (err) {
      if (err && err.code === 'PASSPHRASE_LOCKED') {
        setSyncStatus('Passphrase locked \u2014 unlock to save encrypted PBS', 'warn');
        toast(err.message, 'warning');
        if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog('Unlock your session passphrase to resume encrypted PBS auto-save.');
      } else {
        setSyncStatus((err && err.message) || 'Auto-save failed', 'error');
        toast((err && err.message) || 'Failed to save PBS file.', 'error');
      }
    } finally {
      S.isSaving = false;
    }
  }

  /* Call after every local edit: caches immediately, debounces the folder write. */
  function scheduleSave() {
    if (!S.activeProjectId || !S.activeDoc) return;
    getCache()[S.activeProjectId] = S.activeDoc;
    persistCache();
    S.hooks.onBadges();
    if (!S.dirHandle) { setSyncStatus('Saved locally in browser', 'idle'); return; }
    setSyncStatus('Saving...', 'idle');
    if (S.saveTimer) clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => { writeToFolder(false); }, SAVE_DEBOUNCE_MS);
  }

  async function pollOnce() {
    if (!S.hooks.isDialogOpen() || !S.dirHandle || !S.activeProjectId || S.isSaving || S.conflictRemoteText) return;
    try {
      const fh = await getFileHandle(false);
      if (!fh) return;
      const file = await fh.getFile();
      if (file.lastModified && S.activeFileModified && file.lastModified > S.activeFileModified) {
        if (await syncFromFolder({ silentMissing: true, silentErrors: true })) {
          toast('PBS updated from shared folder.', 'info');
          S.hooks.rerender();
        }
      }
    } catch (_e) {}
  }
  function startPolling() { stopPolling(); if (S.dirHandle) S.pollTimer = setInterval(pollOnce, POLL_MS); }
  function stopPolling() { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }

  /* ---------- Misc helpers for the UI ---------- */
  function getItemCount(projectId) {
    const doc = getCache()[projectId];
    return doc && Array.isArray(doc.items) ? doc.items.length : 0;
  }
  function listCloneSources() {
    const cache = getCache();
    return (getDb().projects || []).filter(p => p.id !== S.activeProjectId && cache[p.id] && Array.isArray(cache[p.id].items) && cache[p.id].items.length > 0);
  }
  function downloadText(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  P.core = {
    state: S, getDb, getProject, getUserName, toast, getCache, supportsDirSync, getSessionPassphrase,
    setSyncStatus, logChange, getOwnerSuggestions, getManufacturerSuggestions, getProcStatusSuggestions,
    openSession, initFolder, replaceDoc,
    linkFolder, reconnectFolder, syncFromFolder, writeToFolder, scheduleSave, pollOnce, startPolling, stopPolling,
    getItemCount, listCloneSources, downloadText, fileNameFor,
  };
})();
