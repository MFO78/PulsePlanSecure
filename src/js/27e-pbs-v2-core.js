/* PBS v2 - part 5a/7: app core (session state, shared-folder sync with conflict guard & write queue, cache, ChangeLog, owner suggestions).
 * Inert: only registers window.__ppPbsV2.core; no DOM access, timers or storage reads happen until the UI calls into it. */
(function ppPbsV2CorePart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const IDB_NAME = 'pulseplan_pbs_handles_v1';
  const IDB_STORE = 'handles';
  const IDB_DIR_KEY = 'pbs_dir_handle';
  const PEOPLE_KEY = 'pulseplan_people_dir_v1';
  const POLL_MS = 15000;
  const SAVE_DEBOUNCE_MS = 650;
  const IO_TIMEOUT_MS = 10000;

  const S = {
    dirHandle: null, rememberedDirHandle: null,
    activeProjectId: '', activeDoc: null, activeFileModified: 0, activeWasEncrypted: false,
    lastWrittenId: '', saveTimer: null, pollTimer: null, isSaving: false, saveQueued: false,
    isFlushingForLock: false, dirtyProjectIds: new Set(),
    conflictRemoteText: null, conflictRemoteDoc: null, conflictRemoteModified: 0,
    cache: null, syncStatusText: 'Saved locally in browser', syncStatusTone: 'idle',
    hooks: { rerender() {}, onBadges() {}, onStatus() {}, isDialogOpen() { return false; } },
  };

  const D = () => P.data;
  const supportsDirSync = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  const getSessionPassphrase = () => ((typeof ppSyncPassphrase === 'string' && ppSyncPassphrase) ? ppSyncPassphrase : '');
  const isSessionLocked = () => (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked());
  const encFormat = () => ((typeof PP_ENC_FORMAT === 'string' && PP_ENC_FORMAT) ? PP_ENC_FORMAT : 'pulseplan-encrypted-v1');

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { departments: [], projects: [], milestones: [], changeLog: [] };
  }
  function getLiveDbRef() {
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return getDb();
  }
  const getUserName = () => ((typeof ui !== 'undefined' && ui && ui.userName) ? ui.userName : 'Project Mgr');
  const toast = (msg, type) => { if (typeof showToast === 'function') showToast(msg, type || 'info'); };
  const getProject = (id) => (getDb().projects || []).find(p => p.id === id) || null;
  const getCache = () => (S.cache || (S.cache = D().loadCache()));
  const persistCache = () => D().saveCache(getCache());
  const fileNameFor = (projectId = S.activeProjectId) => D().getPbsFilename(getProject(projectId), projectId);

  function withPbsTimeout(promise, ms = IO_TIMEOUT_MS, label = 'PBS folder operation timed out') {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(label);
          e.name = 'TimeoutError';
          reject(e);
        }, ms);
      }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
  }

  function isPbsConnectionError(err) {
    if (!err) return false;
    if (typeof isConnectionLostError === 'function' && isConnectionLostError(err)) return true;
    const name = String(err.name || '');
    const msg = String(err.message || '').toLowerCase();
    return ['NotFoundError', 'NotReadableError', 'NotAllowedError', 'SecurityError', 'InvalidStateError', 'NoModificationAllowedError', 'TimeoutError'].includes(name)
      || msg.includes('permission') || msg.includes('timed out') || msg.includes('disconnected');
  }

  async function readRawFileText(file) {
    if (typeof ppReadRawFileText === 'function') return ppReadRawFileText(file);
    return file.text();
  }

  function extractWriteId(rawText) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object') {
        if (parsed.writeId) return String(parsed.writeId);
        if (parsed.meta && parsed.meta.lastWriteId) return String(parsed.meta.lastWriteId);
      }
    } catch (_e) {}
    return '';
  }

  function setSyncStatus(text, tone) {
    S.syncStatusText = text;
    S.syncStatusTone = tone || 'idle';
    S.hooks.onStatus(S.syncStatusText, S.syncStatusTone);
  }

  function syncPbsMetaToMainDb(dirHandle) {
    const db = getLiveDbRef();
    if (!db || typeof db !== 'object' || !dirHandle) return;
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    db.settings.pbsFolder = {
      enabled: true,
      folderName: String(dirHandle.name || '').trim(),
      folderPath: String(dirHandle.name || '').trim(),
      linkedAt: new Date().toISOString(),
    };
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
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
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
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
    let db = null;
    try {
      db = await withPbsTimeout(openHandleDb(), 5000, 'PBS IDB open timed out');
      if (!db) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, IDB_DIR_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_e) {
    } finally {
      try { if (db) db.close(); } catch (_e) {}
    }
  }
  async function loadRememberedDirHandle() {
    let db = null;
    try {
      db = await withPbsTimeout(openHandleDb(), 5000, 'PBS IDB open timed out');
      if (!db) return null;
      return await new Promise((resolve) => {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_DIR_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_e) {
      return null;
    } finally {
      try { if (db) db.close(); } catch (_e) {}
    }
  }
  async function ensureDirPermission(handle, promptUser) {
    if (!handle || typeof handle.queryPermission !== 'function') return Boolean(handle);
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (promptUser && typeof handle.requestPermission === 'function') {
      try {
        return (await handle.requestPermission(opts)) === 'granted';
      } catch (err) {
        if (err && err.name === 'SecurityError') return false;
        throw err;
      }
    }
    return false;
  }

  /* ---------- Session ---------- */
  function openSession(projectId) {
    const project = getProject(projectId);
    if (!project) return null;
    S.activeProjectId = projectId;
    S.activeFileModified = 0;
    S.lastWrittenId = '';
    S.saveQueued = false;
    S.activeWasEncrypted = Boolean(getSessionPassphrase());
    S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
    const cached = getCache()[projectId];
    S.activeDoc = (cached && D().normalizePbsDoc(cached, project, getUserName())) || D().createEmptyPbs(project, getUserName(), projectId);
    setSyncStatus(S.dirHandle ? `Synced (${fileNameFor()})` : 'Saved locally in browser', S.dirHandle ? 'ok' : 'idle');
    return S.activeDoc;
  }

  /* Restores a previously linked folder (optionally prompting inside a user gesture) and loads the active project's file from it. */
  async function initFolder(opts = {}) {
    const allowPrompt = Boolean(opts && opts.allowPrompt);
    if (!S.dirHandle && supportsDirSync()) {
      if (!S.rememberedDirHandle) {
        S.rememberedDirHandle = await loadRememberedDirHandle();
      }
      if (S.rememberedDirHandle && await ensureDirPermission(S.rememberedDirHandle, allowPrompt)) {
        S.dirHandle = S.rememberedDirHandle;
      }
    }
    if (S.dirHandle) {
      await syncFromFolder({ silentMissing: true, silentErrors: true });
      scanFolderForBadges();
      startPolling();
    }
  }

  async function tryAutoReconnectFolder(opts = {}) {
    if (isSessionLocked()) return false;
    const allowPrompt = Boolean(opts && opts.allowPrompt);
    if (!S.dirHandle && supportsDirSync()) {
      if (!S.rememberedDirHandle) S.rememberedDirHandle = await loadRememberedDirHandle();
      if (S.rememberedDirHandle && await ensureDirPermission(S.rememberedDirHandle, allowPrompt)) {
        S.dirHandle = S.rememberedDirHandle;
      }
    }
    if (S.dirHandle) {
      await scanFolderForBadges();
      return true;
    }
    return false;
  }

  async function scanFolderForBadges() {
    if (!S.dirHandle || isSessionLocked()) return 0;
    const projects = getDb().projects || [];
    const cache = getCache();
    let updated = 0;
    for (const p of projects) {
      if (!p || !p.id || isSessionLocked()) break;
      if (p.id === S.activeProjectId && S.dirtyProjectIds.has(p.id)) continue;
      try {
        const fname = D().getPbsFilename(p, p.id);
        const fh = await S.dirHandle.getFileHandle(fname, { create: false });
        const file = await withPbsTimeout(fh.getFile(), IO_TIMEOUT_MS);
        const raw = await readRawFileText(file);
        const { doc } = await D().decodePbsFromText(raw, p, undefined, getUserName(), { silentPrompt: true });
        if (!isSessionLocked()) {
          cache[p.id] = doc;
          updated++;
        }
      } catch (_e) {
        // Missing file or undecryptable without key — skip silently
      }
    }
    if (updated > 0 && !isSessionLocked()) {
      persistCache();
      S.hooks.onBadges();
    }
    return updated;
  }

  function replaceDoc(doc, wasEncrypted) {
    S.activeDoc = doc;
    S.activeWasEncrypted = Boolean(wasEncrypted) || Boolean(getSessionPassphrase());
    S.conflictRemoteText = null; S.conflictRemoteDoc = null;
    getCache()[S.activeProjectId] = doc;
    persistCache();
    S.hooks.onBadges();
  }

  function handlePbsFolderDisconnected(err) {
    stopPolling();
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    S.saveQueued = false;
    const lostHandle = S.dirHandle;
    S.dirHandle = null;
    const isPerm = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    if (isPerm && lostHandle) S.rememberedDirHandle = lostHandle;
    setSyncStatus('PBS folder disconnected \u2014 reconnect to sync', 'error');
    toast('PBS shared folder connection lost. Reconnect the PBS folder to resume syncing.', 'warning');
    S.hooks.rerender();
  }

  /* ---------- Folder link / read / write ---------- */
  async function afterFolderConnected() {
    toast(`Linked PBS folder: ${S.dirHandle.name}`, 'success');
    syncPbsMetaToMainDb(S.dirHandle);
    if (S.activeProjectId) {
      const localItems = (S.activeDoc && Array.isArray(S.activeDoc.items)) ? S.activeDoc.items : [];
      const hadLocalDirty = S.dirtyProjectIds.has(S.activeProjectId) || localItems.length > 0;
      const existingFh = await getFileHandle(false).catch(() => null);
      if (existingFh && hadLocalDirty && localItems.length > 0) {
        // Inspect disk first so linking a folder NEVER silently wipes unsaved local items!
        try {
          const file = await withPbsTimeout(existingFh.getFile(), IO_TIMEOUT_MS);
          const remoteText = await readRawFileText(file);
          const { doc: remoteDoc } = await D().decodePbsFromText(remoteText, getProject(S.activeProjectId), undefined, getUserName(), { silentPrompt: true });
          const diff = D().computeConflictDiff(S.activeDoc, remoteDoc, getDb());
          const differs = diff.addedRemote.length > 0 || diff.modifiedBoth.length > 0 || diff.onlyLocal.length > 0;
          if (differs) {
            S.conflictRemoteText = remoteText;
            S.conflictRemoteDoc = remoteDoc;
            S.conflictRemoteModified = file.lastModified || Date.now();
            setSyncStatus('Folder file differs from local items \u2014 choose merge, load, or overwrite', 'warn');
            S.hooks.rerender();
            startPolling();
            scanFolderForBadges();
            return;
          }
        } catch (_e) {
          // Fall through to normal syncFromFolder
        }
      }
      const loaded = await syncFromFolder({ silentMissing: true });
      if (!loaded && S.activeDoc && S.activeDoc.items.length > 0) await writeToFolder(false);
      S.hooks.rerender();
      startPolling();
    }
    scanFolderForBadges();
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

  async function getFileHandleForName(fname, create) {
    if (!S.dirHandle || !fname) return null;
    try {
      return await withPbsTimeout(S.dirHandle.getFileHandle(fname, { create: Boolean(create) }), IO_TIMEOUT_MS);
    } catch (err) {
      if (!create && err && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  async function getFileHandle(create) {
    if (!S.dirHandle || !S.activeProjectId) return null;
    return getFileHandleForName(fileNameFor(), create);
  }

  async function syncFromFolder(opts = {}) {
    if (!S.dirHandle || !S.activeProjectId || isSessionLocked()) return false;
    const targetProjectId = S.activeProjectId;
    const targetFileName = fileNameFor(targetProjectId);
    const project = getProject(targetProjectId);
    try {
      const fh = await getFileHandleForName(targetFileName, false);
      if (!fh) {
        if (S.activeProjectId === targetProjectId) S.activeFileModified = 0;
        if (!opts.silentMissing) toast(`No existing ${targetFileName} in folder yet. First edit will create it.`, 'info');
        return false;
      }
      const file = await withPbsTimeout(fh.getFile(), IO_TIMEOUT_MS);
      const rawText = await readRawFileText(file);
      const { doc, wasEncrypted } = await D().decodePbsFromText(rawText, project, undefined, getUserName(), {
        silentPrompt: Boolean(opts.silentErrors),
      });
      if (isSessionLocked() || S.activeProjectId !== targetProjectId) return false;
      S.activeDoc = doc;
      S.activeFileModified = Number(file.lastModified || 0);
      S.lastWrittenId = extractWriteId(rawText) || (doc.meta && doc.meta.lastWriteId) || '';
      S.activeWasEncrypted = wasEncrypted || Boolean(getSessionPassphrase());
      S.dirtyProjectIds.delete(targetProjectId);
      getCache()[targetProjectId] = doc;
      persistCache();
      S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
      setSyncStatus(`${S.activeWasEncrypted ? 'Encrypted & synced' : 'Synced'} (${targetFileName})`, 'ok');
      S.hooks.onBadges();
      return true;
    } catch (err) {
      if (isPbsConnectionError(err) && err.name !== 'NotFoundError') {
        handlePbsFolderDisconnected(err);
      } else {
        setSyncStatus((err && err.message) || 'Sync read failed', 'error');
        if (!opts.silentErrors) toast((err && err.message) || 'Could not read PBS file from folder.', 'error');
      }
      return false;
    }
  }

  async function writeToFolder(forceOverwrite) {
    if (isSessionLocked() && !S.isFlushingForLock) return false;
    if (!S.dirHandle || !S.activeProjectId || !S.activeDoc) return false;
    if (S.isSaving) {
      S.saveQueued = true;
      return false;
    }
    S.isSaving = true;
    S.saveQueued = false;

    const targetProjectId = S.activeProjectId;
    const targetFileName = fileNameFor(targetProjectId);
    const project = getProject(targetProjectId);
    const docClone = JSON.parse(JSON.stringify(S.activeDoc));
    const requireEnc = S.activeWasEncrypted || Boolean(getSessionPassphrase());
    const knownModified = S.activeFileModified;
    const knownWriteId = S.lastWrittenId || (docClone.meta && docClone.meta.lastWriteId) || '';

    try {
      if (!forceOverwrite) {
        const existingFh = await getFileHandleForName(targetFileName, false);
        if (existingFh) {
          const existing = await withPbsTimeout(existingFh.getFile(), IO_TIMEOUT_MS);
          const existingMod = Number(existing.lastModified || 0);
          const remoteChanged = (knownModified > 0 && existingMod > knownModified + 500);
          const newlyCreatedRemote = (knownModified === 0);
          if (remoteChanged || newlyCreatedRemote) {
            const remoteText = await readRawFileText(existing);
            if (remoteText && remoteText.trim().length > 2) {
              const diskWriteId = extractWriteId(remoteText);
              const sameWrite = Boolean(diskWriteId && knownWriteId && diskWriteId === knownWriteId);
              if (!sameWrite) {
                if (S.activeProjectId === targetProjectId) {
                  S.conflictRemoteText = remoteText;
                  S.conflictRemoteModified = existingMod || Date.now();
                  S.conflictRemoteDoc = null;
                  try {
                    S.conflictRemoteDoc = (await D().decodePbsFromText(remoteText, project, undefined, getUserName(), { silentPrompt: true })).doc;
                  } catch (_e) {}
                  setSyncStatus('Conflict detected \u2014 auto-save paused', 'warn');
                  S.hooks.rerender();
                }
                return false;
              }
            }
          }
        }
      }

      const fh = await getFileHandleForName(targetFileName, true);
      if (!fh) return false;

      docClone.meta = docClone.meta || {};
      docClone.meta.revision = (Number(docClone.meta.revision) || 0) + 1;
      docClone.meta.lastModifiedAt = new Date().toISOString();
      docClone.meta.lastModifiedBy = getUserName();
      const writeId = D().makeId('w');
      docClone.meta.lastWriteId = writeId;

      const { text, encrypted } = await D().encodePbsForDisk(docClone, requireEnc);
      const writable = await withPbsTimeout(fh.createWritable(), IO_TIMEOUT_MS);
      await writable.write(text);
      await writable.close();

      let postModified = Date.now();
      try {
        const postFile = await fh.getFile();
        if (postFile && postFile.lastModified) postModified = Number(postFile.lastModified);
      } catch (_e) {}

      getCache()[targetProjectId] = docClone;
      persistCache();
      S.dirtyProjectIds.delete(targetProjectId);

      if (S.activeProjectId === targetProjectId) {
        if (S.activeDoc) S.activeDoc.meta = { ...docClone.meta };
        S.activeFileModified = postModified;
        S.lastWrittenId = writeId;
        if (encrypted) S.activeWasEncrypted = true;
        S.conflictRemoteText = null; S.conflictRemoteDoc = null; S.conflictRemoteModified = 0;
        setSyncStatus(`${encrypted ? 'Encrypted & synced' : 'Synced'} (${targetFileName})`, 'ok');
      }
      S.hooks.onBadges();
      return true;
    } catch (err) {
      if (err && err.code === 'PASSPHRASE_LOCKED') {
        setSyncStatus('Passphrase locked \u2014 unlock to save encrypted PBS', 'warn');
        toast(err.message, 'warning');
        if (!isSessionLocked() && typeof openSyncEncryptionDialog === 'function') {
          openSyncEncryptionDialog('Unlock your session passphrase to resume encrypted PBS auto-save.');
        }
      } else if (isPbsConnectionError(err)) {
        handlePbsFolderDisconnected(err);
      } else {
        setSyncStatus((err && err.message) || 'Auto-save failed', 'error');
        toast((err && err.message) || 'Failed to save PBS file.', 'error');
      }
      return false;
    } finally {
      S.isSaving = false;
      if (S.saveQueued && S.dirHandle && S.activeProjectId && (!isSessionLocked() || S.isFlushingForLock)) {
        S.saveQueued = false;
        setTimeout(() => { writeToFolder(false); }, 150);
      }
    }
  }

  /* Call after every local edit: caches immediately, debounces the folder write. */
  function scheduleSave() {
    if (!S.activeProjectId || !S.activeDoc || isSessionLocked()) return;
    S.dirtyProjectIds.add(S.activeProjectId);
    getCache()[S.activeProjectId] = S.activeDoc;
    persistCache();
    S.hooks.onBadges();
    if (!S.dirHandle) { setSyncStatus('Saved locally in browser', 'idle'); return; }
    setSyncStatus('Saving...', 'idle');
    if (S.saveTimer) clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => {
      S.saveTimer = null;
      writeToFolder(false);
    }, SAVE_DEBOUNCE_MS);
  }

  async function pollOnce() {
    if (!S.hooks.isDialogOpen() || !S.dirHandle || !S.activeProjectId || isSessionLocked()) return;
    if (S.isSaving || S.saveTimer || S.saveQueued || S.conflictRemoteText) return;
    try {
      const fh = await getFileHandle(false);
      if (!fh) return;
      const file = await withPbsTimeout(fh.getFile(), IO_TIMEOUT_MS);
      const fileMod = Number(file.lastModified || 0);
      const changed = (S.activeFileModified > 0 && fileMod > S.activeFileModified + 500)
        || (S.activeFileModified === 0 && fileMod > 0);
      if (!changed) return;

      const rawText = await readRawFileText(file);
      const diskWriteId = extractWriteId(rawText);
      if (diskWriteId && S.lastWrittenId && diskWriteId === S.lastWrittenId) {
        S.activeFileModified = Math.max(S.activeFileModified, fileMod);
        return;
      }

      if (S.dirtyProjectIds.has(S.activeProjectId)) {
        // Local unsaved edits exist -> surface conflict rather than overwriting local edits!
        S.conflictRemoteText = rawText;
        S.conflictRemoteModified = fileMod;
        S.conflictRemoteDoc = null;
        try {
          S.conflictRemoteDoc = (await D().decodePbsFromText(rawText, getProject(S.activeProjectId), undefined, getUserName(), { silentPrompt: true })).doc;
        } catch (_e) {}
        setSyncStatus('Conflict detected \u2014 auto-save paused', 'warn');
        S.hooks.rerender();
        return;
      }

      if (await syncFromFolder({ silentMissing: true, silentErrors: true })) {
        toast('PBS updated from shared folder.', 'info');
        S.hooks.rerender();
      }
    } catch (err) {
      if (isPbsConnectionError(err) && err.name !== 'NotFoundError') {
        handlePbsFolderDisconnected(err);
      }
    }
  }
  function startPolling() { stopPolling(); if (S.dirHandle && !isSessionLocked()) S.pollTimer = setInterval(pollOnce, POLL_MS); }
  function stopPolling() { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }

  /* ---------- Lock, Logout, Password Rotation & Project Rename Lifecycle ---------- */
  async function flushBeforeLock() {
    const waitStart = Date.now();
    while (S.isSaving && Date.now() - waitStart < 4500) {
      await new Promise(r => setTimeout(r, 60));
    }
    if (S.saveTimer) {
      clearTimeout(S.saveTimer);
      S.saveTimer = null;
      if (S.dirHandle && S.activeProjectId && S.activeDoc && !S.conflictRemoteText) {
        S.isFlushingForLock = true;
        try { await writeToFolder(false); } finally { S.isFlushingForLock = false; }
      }
    } else if ((S.saveQueued || S.syncStatusText === 'Saving...') && S.dirHandle && S.activeProjectId && S.activeDoc && !S.conflictRemoteText) {
      S.saveQueued = false;
      S.isFlushingForLock = true;
      try { await writeToFolder(false); } finally { S.isFlushingForLock = false; }
    }
  }

  function clearMemoryAndStopSync() {
    stopPolling();
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    S.saveQueued = false;
    S.isFlushingForLock = false;
    S.dirHandle = null;
    S.activeProjectId = '';
    S.activeDoc = null;
    S.activeFileModified = 0;
    S.lastWrittenId = '';
    S.conflictRemoteText = null;
    S.conflictRemoteDoc = null;
    S.conflictRemoteModified = 0;
    S.cache = {};
    S.dirtyProjectIds.clear();
    try {
      const k = D().CACHE_KEY;
      if (typeof safeRemoveStorage === 'function') safeRemoveStorage(k);
      else if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
    } catch (_e) {}
  }

  async function reencryptAllPbsFilesInFolder(oldPass, newPass) {
    const mainMeta = getLiveDbRef()?.settings?.pbsFolder || {};
    if (!oldPass || !newPass || typeof decryptPulsePlanData !== 'function' || typeof encryptPulsePlanData !== 'function') {
      return { attempted: false, rotatedCount: 0, failedFiles: [], needsAttention: Boolean(mainMeta.enabled) };
    }
    let dir = S.dirHandle;
    if (!dir && supportsDirSync()) {
      const rem = S.rememberedDirHandle || await loadRememberedDirHandle();
      if (rem && await ensureDirPermission(rem, false)) {
        dir = rem;
        S.dirHandle = rem;
      }
    }
    if (!dir || typeof dir.values !== 'function') {
      return { attempted: false, rotatedCount: 0, failedFiles: [], needsAttention: Boolean(mainMeta.enabled) };
    }
    let rotatedCount = 0;
    const failedFiles = [];
    const fmt = encFormat();
    try {
      for await (const entry of dir.values()) {
        if (!entry || entry.kind !== 'file' || !/^pbs_.*\.json$/i.test(entry.name)) continue;
        try {
          const file = await withPbsTimeout(entry.getFile(), IO_TIMEOUT_MS);
          const rawText = await readRawFileText(file);
          let parsed = null;
          try { parsed = JSON.parse(rawText); } catch (_e) { continue; }
          if (!parsed || parsed.format !== fmt) continue;
          const plain = await decryptPulsePlanData(parsed, oldPass);
          const plainObj = typeof plain === 'string' ? JSON.parse(plain) : plain;
          const newEnv = await encryptPulsePlanData(plainObj, newPass);
          const outEnv = { ...newEnv, type: 'pulseplan-pbs' };
          if (parsed.writeId) outEnv.writeId = parsed.writeId;
          const writable = await withPbsTimeout(entry.createWritable(), IO_TIMEOUT_MS);
          await writable.write(JSON.stringify(outEnv, null, 2));
          await writable.close();
          rotatedCount++;
        } catch (_fileErr) {
          failedFiles.push(entry.name);
        }
      }
    } catch (_iterErr) {
      return { attempted: true, rotatedCount, failedFiles: [...failedFiles, '(folder read error)'], needsAttention: true };
    }
    return { attempted: true, rotatedCount, failedFiles, needsAttention: failedFiles.length > 0 };
  }

  async function onProjectCodeRenamed(projectId, prevCode, nextCode) {
    if (!projectId || !prevCode || !nextCode || prevCode === nextCode) return;
    const cache = getCache();
    const prevName = D().getPbsFilename({ id: projectId, code: prevCode }, projectId);
    const nextName = D().getPbsFilename({ id: projectId, code: nextCode }, projectId);
    if (prevName === nextName) return;

    let docToCarry = cache[projectId] || null;
    if (S.dirHandle) {
      try {
        const oldFh = await getFileHandleForName(prevName, false);
        const newFhCheck = await getFileHandleForName(nextName, false);
        if (oldFh && !newFhCheck) {
          const file = await withPbsTimeout(oldFh.getFile(), IO_TIMEOUT_MS);
          const rawText = await readRawFileText(file);
          const proj = getProject(projectId);
          const { doc, wasEncrypted } = await D().decodePbsFromText(rawText, proj, undefined, getUserName(), { silentPrompt: true });
          doc.projectCode = nextCode;
          docToCarry = doc;
          const newFh = await getFileHandleForName(nextName, true);
          const { text } = await D().encodePbsForDisk(doc, wasEncrypted || Boolean(getSessionPassphrase()));
          const w = await newFh.createWritable();
          await w.write(text);
          await w.close();
        }
      } catch (_e) {}
    }
    if (docToCarry) {
      docToCarry.projectCode = nextCode;
      cache[projectId] = docToCarry;
      persistCache();
      S.hooks.onBadges();
    }
  }

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
    openSession, initFolder, tryAutoReconnectFolder, scanFolderForBadges, replaceDoc,
    linkFolder, reconnectFolder, syncFromFolder, writeToFolder, scheduleSave, pollOnce, startPolling, stopPolling,
    flushBeforeLock, clearMemoryAndStopSync, reencryptAllPbsFilesInFolder, onProjectCodeRenamed,
    getItemCount, listCloneSources, downloadText, fileNameFor,
  };
})();
