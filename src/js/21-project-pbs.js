/* Isolated per-project Product Breakdown Structure (PBS) with AES-256-GCM encrypted separate-file sync & PDF export. */
(function ppProjectPbsModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  const PBS_SCHEMA = 'pulseplan-pbs-v1';
  const CACHE_KEY = 'pulseplan_pbs_cache_v1';
  const IDB_NAME = 'pulseplan_pbs_handles_v1';
  const IDB_STORE = 'handles';
  const IDB_DIR_KEY = 'pbs_dir_handle';
  const MATURITY_OPTIONS = ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];
  const POLL_MS = 15000;

  let dirHandle = null;
  let rememberedDirHandle = null;
  let activeProjectId = '';
  let activeDoc = null;
  let activeFileModified = 0;
  let activeWasEncrypted = false;
  let editingItemId = '';
  let addingParentId = null;
  let isEditingFormOpen = false;
  let saveTimer = null;
  let pollTimer = null;
  let isSaving = false;
  let conflictRemoteText = null;
  let conflictRemoteModified = 0;
  let pbsCache = loadCache();

  function supportsDirSync() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
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
    return { departments: [], projects: [], milestones: [] };
  }

  function getProject(projectId) {
    const db = getDb();
    return (db.projects || []).find(p => p.id === projectId) || null;
  }

  function getUserName() {
    return (typeof ui !== 'undefined' && ui && ui.userName) ? ui.userName : 'Project Mgr';
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function sanitizeFilenamePart(raw) {
    const clean = String(raw || 'project').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return (clean || 'project').slice(0, 40);
  }

  function getPbsFilename(project) {
    const code = sanitizeFilenamePart(project ? (project.code || project.id) : activeProjectId);
    return `pbs_${code}.json`;
  }

  function loadCache() {
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(CACHE_KEY) : localStorage.getItem(CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function saveCache() {
    try {
      const raw = JSON.stringify(pbsCache);
      if (typeof safeSetStorage === 'function') safeSetStorage(CACHE_KEY, raw);
      else localStorage.setItem(CACHE_KEY, raw);
    } catch (_e) {}
  }

  function createEmptyPbs(project) {
    return {
      schema: PBS_SCHEMA,
      projectId: project ? project.id : activeProjectId,
      projectCode: project ? (project.code || '') : '',
      projectName: project ? (project.name || 'Project') : 'Project',
      meta: {
        revision: 1,
        lastModifiedAt: new Date().toISOString(),
        lastModifiedBy: getUserName(),
        lastWriteId: '',
      },
      items: [],
    };
  }

  function normalizePbsDoc(raw, project) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.schema !== PBS_SCHEMA && !Array.isArray(raw.items)) return null;
    const base = createEmptyPbs(project);
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    const items = Array.isArray(raw.items) ? raw.items.filter(Boolean).map((it, idx) => ({
      id: String(it.id || makeId('pbs')),
      parentId: it.parentId ? String(it.parentId) : null,
      code: String(it.code || String(idx + 1)).trim(),
      name: String(it.name || 'Untitled Item').trim(),
      deptId: String(it.deptId || ''),
      owner: String(it.owner || '').trim(),
      maturity: MATURITY_OPTIONS.includes(it.maturity) ? it.maturity : 'Draft',
      milestoneId: String(it.milestoneId || ''),
      notes: String(it.notes || '').trim(),
    })) : [];
    const validIds = new Set(items.map(i => i.id));
    items.forEach(i => { if (i.parentId && (!validIds.has(i.parentId) || i.parentId === i.id)) i.parentId = null; });
    return {
      schema: PBS_SCHEMA,
      projectId: project ? project.id : String(raw.projectId || base.projectId),
      projectCode: project ? (project.code || '') : String(raw.projectCode || ''),
      projectName: project ? (project.name || '') : String(raw.projectName || 'Project'),
      meta: {
        revision: Number(meta.revision) || 1,
        lastModifiedAt: meta.lastModifiedAt || new Date().toISOString(),
        lastModifiedBy: meta.lastModifiedBy || getUserName(),
        lastWriteId: String(meta.lastWriteId || ''),
      },
      items,
    };
  }

  /* ---------- IndexedDB for Folder Handle (Chrome/Edge only, isolated DB) ---------- */
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
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_DIR_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_e) {
      return null;
    }
  }

  /* ---------- Passphrase & AES-256-GCM Integration (Single Session Password) ---------- */
  function getSessionPassphrase() {
    return (typeof ppSyncPassphrase === 'string' && ppSyncPassphrase) ? ppSyncPassphrase : '';
  }

  function getEncFormat() {
    return (typeof PP_ENC_FORMAT === 'string' && PP_ENC_FORMAT) ? PP_ENC_FORMAT : 'pulseplan-encrypted-v1';
  }

  function touchPassphraseActivity() {
    if (typeof resetPassphraseAutoLock === 'function' && getSessionPassphrase()) {
      resetPassphraseAutoLock();
    }
  }

  async function encodePbsForDisk(doc, requireEncryption) {
    const pass = getSessionPassphrase();
    if (pass && typeof encryptPulsePlanData === 'function') {
      touchPassphraseActivity();
      const envelope = await encryptPulsePlanData(doc, pass);
      activeWasEncrypted = true;
      return { text: JSON.stringify(envelope, null, 2), encrypted: true };
    }
    if (requireEncryption || activeWasEncrypted) {
      const err = new Error('Encryption passphrase is locked. Unlock your session passphrase before saving this encrypted PBS.');
      err.code = 'PASSPHRASE_LOCKED';
      throw err;
    }
    return { text: JSON.stringify(doc, null, 2), encrypted: false };
  }

  async function decodePbsFromText(rawText, project) {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_e) {
      throw new Error('Selected file is not valid JSON.');
    }
    let wasEncrypted = false;
    if (parsed && parsed.format === getEncFormat()) {
      wasEncrypted = true;
      if (typeof decryptPulsePlanData !== 'function') {
        throw new Error('Encryption engine unavailable in this environment.');
      }
      let pass = getSessionPassphrase();
      if (!pass && typeof promptForDecryptionPassphrase === 'function') {
        pass = await promptForDecryptionPassphrase();
      }
      if (!pass) {
        throw new Error('Decryption cancelled: passphrase required.');
      }
      const plain = await decryptPulsePlanData(parsed, pass);
      if (typeof ppSyncPassphrase !== 'undefined') {
        ppSyncPassphrase = pass;
      }
      touchPassphraseActivity();
      if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
      parsed = JSON.parse(plain);
    }
    const doc = normalizePbsDoc(parsed, project);
    if (!doc) {
      throw new Error('This JSON file does not contain a valid PulsePlan PBS structure.');
    }
    return { doc, wasEncrypted };
  }

  /* ---------- Folder Auto-Sync (Chrome/Edge) & Conflict Guard ---------- */
  async function ensureDirPermission(handle, promptUser) {
    if (!handle || typeof handle.queryPermission !== 'function') return false;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (promptUser && typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission(opts)) === 'granted';
    }
    return false;
  }

  async function linkPbsFolder() {
    if (!supportsDirSync()) {
      toast('Direct folder auto-sync requires desktop Chrome or Edge. Use Load / Save PBS (.json) in Firefox.', 'info');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ id: 'pulseplan-pbs-folder', mode: 'readwrite' });
      const granted = await ensureDirPermission(handle, true);
      if (!granted) {
        toast('Folder permission was not granted.', 'warning');
        return;
      }
      dirHandle = handle;
      rememberedDirHandle = handle;
      await saveRememberedDirHandle(handle);
      toast(`Linked PBS folder: ${handle.name}`, 'success');
      if (activeProjectId) {
        const loaded = await syncActiveProjectFromFolder({ silentMissing: true });
        if (!loaded && activeDoc && activeDoc.items.length > 0) {
          await writeActiveProjectToFolder(false);
        }
        renderPbsDialog();
        startPolling();
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast(err?.message || 'Could not link PBS folder.', 'error');
    }
  }

  async function reconnectRememberedFolder() {
    if (!rememberedDirHandle) return linkPbsFolder();
    try {
      const ok = await ensureDirPermission(rememberedDirHandle, true);
      if (!ok) {
        toast('Folder permission not granted.', 'warning');
        return;
      }
      dirHandle = rememberedDirHandle;
      toast(`Reconnected PBS folder: ${dirHandle.name}`, 'success');
      if (activeProjectId) {
        const loaded = await syncActiveProjectFromFolder({ silentMissing: true });
        if (!loaded && activeDoc && activeDoc.items.length > 0) {
          await writeActiveProjectToFolder(false);
        }
        renderPbsDialog();
        startPolling();
      }
    } catch (_e) {
      await linkPbsFolder();
    }
  }

  async function getProjectFileHandle(create) {
    if (!dirHandle || !activeProjectId) return null;
    const project = getProject(activeProjectId);
    const filename = getPbsFilename(project);
    try {
      return await dirHandle.getFileHandle(filename, { create: Boolean(create) });
    } catch (err) {
      if (!create && err && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  async function syncActiveProjectFromFolder(opts = {}) {
    if (!dirHandle || !activeProjectId) return false;
    const project = getProject(activeProjectId);
    try {
      const fh = await getProjectFileHandle(false);
      if (!fh) {
        activeFileModified = 0;
        if (!opts.silentMissing) toast(`No existing ${getPbsFilename(project)} in folder yet. First edit will create it.`, 'info');
        return false;
      }
      const file = await fh.getFile();
      const rawText = await file.text();
      const { doc, wasEncrypted } = await decodePbsFromText(rawText, project);
      activeDoc = doc;
      activeFileModified = file.lastModified || 0;
      activeWasEncrypted = wasEncrypted || Boolean(getSessionPassphrase());
      pbsCache[activeProjectId] = activeDoc;
      saveCache();
      conflictRemoteText = null;
      conflictRemoteModified = 0;
      setSyncStatus(`Synced (${getPbsFilename(project)})`, 'ok');
      refreshProjectsTableBadges();
      return true;
    } catch (err) {
      setSyncStatus(err?.message || 'Sync read failed', 'error');
      if (!opts.silentErrors) toast(err?.message || 'Could not read PBS file from folder.', 'error');
      return false;
    }
  }

  async function writeActiveProjectToFolder(forceOverwrite) {
    if (!dirHandle || !activeProjectId || !activeDoc || isSaving) return;
    isSaving = true;
    const project = getProject(activeProjectId);
    const filename = getPbsFilename(project);
    try {
      const fh = await getProjectFileHandle(true);
      if (!forceOverwrite && activeFileModified > 0) {
        const existingFile = await fh.getFile();
        if (existingFile.lastModified && existingFile.lastModified > activeFileModified) {
          const remoteText = await existingFile.text();
          let sameWrite = false;
          try {
            const parsed = JSON.parse(remoteText);
            if (parsed && parsed.meta && parsed.meta.lastWriteId && parsed.meta.lastWriteId === activeDoc.meta.lastWriteId) {
              sameWrite = true;
            }
          } catch (_e) {}
          if (!sameWrite) {
            conflictRemoteText = remoteText;
            conflictRemoteModified = existingFile.lastModified;
            setSyncStatus('Conflict detected — auto-save paused', 'warn');
            renderPbsDialog();
            return;
          }
        }
      }
      activeDoc.meta.revision = (Number(activeDoc.meta.revision) || 0) + 1;
      activeDoc.meta.lastModifiedAt = new Date().toISOString();
      activeDoc.meta.lastModifiedBy = getUserName();
      activeDoc.meta.lastWriteId = makeId('w');
      const { text, encrypted } = await encodePbsForDisk(activeDoc, activeWasEncrypted);
      const writable = await fh.createWritable();
      await writable.write(text);
      await writable.close();
      const updated = await fh.getFile();
      activeFileModified = updated.lastModified || Date.now();
      conflictRemoteText = null;
      conflictRemoteModified = 0;
      pbsCache[activeProjectId] = activeDoc;
      saveCache();
      setSyncStatus(`${encrypted ? 'Encrypted & synced' : 'Synced'} (${filename})`, 'ok');
    } catch (err) {
      if (err && err.code === 'PASSPHRASE_LOCKED') {
        setSyncStatus('Passphrase locked — unlock to save encrypted PBS', 'warn');
        toast(err.message, 'warning');
        if (typeof openSyncEncryptionDialog === 'function') {
          openSyncEncryptionDialog('Unlock your session passphrase to resume encrypted PBS auto-save.');
        }
      } else {
        setSyncStatus(err?.message || 'Auto-save failed', 'error');
        toast(err?.message || 'Failed to save PBS file.', 'error');
      }
    } finally {
      isSaving = false;
    }
  }

  function scheduleSave() {
    if (!activeProjectId || !activeDoc) return;
    pbsCache[activeProjectId] = activeDoc;
    saveCache();
    refreshProjectsTableBadges();
    if (!dirHandle) {
      setSyncStatus('Saved locally in browser', 'idle');
      return;
    }
    setSyncStatus('Saving...', 'idle');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeActiveProjectToFolder(false);
    }, 650);
  }

  async function pollActivePbsFile() {
    const dlg = document.getElementById('ppPbsDialog');
    if (!dlg || !dlg.open || !dirHandle || !activeProjectId || isSaving || conflictRemoteText) return;
    try {
      const fh = await getProjectFileHandle(false);
      if (!fh) return;
      const file = await fh.getFile();
      if (file.lastModified && activeFileModified && file.lastModified > activeFileModified) {
        const ok = await syncActiveProjectFromFolder({ silentMissing: true, silentErrors: true });
        if (ok) {
          toast('PBS updated from shared folder.', 'info');
          renderPbsDialog();
        }
      }
    } catch (_e) {}
  }

  function startPolling() {
    stopPolling();
    if (!dirHandle) return;
    pollTimer = setInterval(pollActivePbsFile, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /* ---------- Portable Encrypted Export & Import (Firefox, Safari, Mobile, Chrome) ---------- */
  async function exportActivePbsFile() {
    if (!activeProjectId || !activeDoc) return;
    const project = getProject(activeProjectId);
    const filename = getPbsFilename(project);
    try {
      const { text, encrypted } = await encodePbsForDisk(activeDoc, activeWasEncrypted);
      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
        try {
          const shareFile = new File([text], filename, { type: 'application/json' });
          if (navigator.canShare({ files: [shareFile] })) {
            await navigator.share({ files: [shareFile], title: `${project ? project.name : 'Project'} PBS` });
            toast(encrypted ? 'Encrypted PBS shared (AES-256-GCM).' : 'PBS JSON shared.', 'success');
            return;
          }
        } catch (_e) {}
      }
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(encrypted ? `Saved encrypted ${filename} (AES-256-GCM).` : `Saved ${filename}.`, 'success');
    } catch (err) {
      if (err && err.code === 'PASSPHRASE_LOCKED') {
        toast(err.message, 'warning');
        if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog(err.message);
      } else {
        toast(err?.message || 'Could not export PBS file.', 'error');
      }
    }
  }

  async function importPbsFromFile(file) {
    if (!file || !activeProjectId) return;
    const project = getProject(activeProjectId);
    try {
      const rawText = await file.text();
      const { doc, wasEncrypted } = await decodePbsFromText(rawText, project);
      activeDoc = doc;
      activeWasEncrypted = wasEncrypted || Boolean(getSessionPassphrase());
      pbsCache[activeProjectId] = activeDoc;
      saveCache();
      conflictRemoteText = null;
      renderPbsDialog();
      refreshProjectsTableBadges();
      if (dirHandle) scheduleSave();
      toast(`Loaded PBS (${doc.items.length} item${doc.items.length === 1 ? '' : 's'}).`, 'success');
    } catch (err) {
      toast(err?.message || 'Could not load PBS file.', 'error');
    }
  }

  /* ---------- Tree Helpers & Department-Coloured Vector PDF Export ---------- */
  function getChildren(parentId) {
    if (!activeDoc) return [];
    return activeDoc.items.filter(item => (item.parentId || null) === (parentId || null));
  }

  function flattenTreeRows(parentId, depth, out) {
    const list = out || [];
    getChildren(parentId).forEach(item => {
      list.push({ item, depth });
      flattenTreeRows(item.id, depth + 1, list);
    });
    return list;
  }

  function hexToRgb(hex, fallback) {
    const clean = String(hex || '').replace('#', '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
    }
    return fallback || [79, 70, 229];
  }

  function tintRgb(rgb, ratio) {
    return rgb.map(c => Math.round(255 - (255 - c) * ratio));
  }

  function pdfSafe(str) {
    return String(str ?? '')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\u2026/g, '...')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  }

  function exportActivePbsPdf() {
    if (!activeProjectId || !activeDoc) return;
    const project = getProject(activeProjectId);
    const db = getDb();
    const deptMap = new Map((db.departments || []).map(d => [d.id, d]));
    const msMap = new Map((db.milestones || []).map(m => [m.id, m]));
    const rows = flattenTreeRows(null, 0, []);
    const dateStr = new Date().toISOString().slice(0, 10);
    const projRgb = hexToRgb(project && project.color, [79, 70, 229]);
    const title = pdfSafe(`Product Breakdown Structure - [${project ? project.code : ''}] ${project ? project.name : 'Project'}`);
    const subtitle = pdfSafe(`Revision ${activeDoc.meta.revision}  |  ${rows.length} item${rows.length === 1 ? '' : 's'}  |  Exported ${dateStr} by ${getUserName()}`);

    const jsPdfLib = typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF ? window.jspdf.jsPDF : null;
    if (jsPdfLib) {
      try {
        const pdf = new jsPdfLib({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageW, 64, 'F');
        pdf.setFillColor(projRgb[0], projRgb[1], projRgb[2]);
        pdf.rect(0, 60, pageW, 4, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.text(title, 36, 28);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9.5);
        pdf.setTextColor(203, 213, 225);
        pdf.text(subtitle, 36, 46);

        const rowMeta = rows.map(({ item, depth }) => {
          const dept = item.deptId ? deptMap.get(item.deptId) : null;
          return {
            depth,
            deptRgb: dept && dept.color ? hexToRgb(dept.color) : null,
            maturity: item.maturity,
          };
        });

        const body = rows.map(({ item }) => {
          const dept = item.deptId ? deptMap.get(item.deptId) : null;
          const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
          return [
            pdfSafe(item.code),
            pdfSafe(item.name),
            pdfSafe(item.maturity),
            dept ? pdfSafe(`[${dept.code}] ${dept.name}`) : '-',
            item.owner ? pdfSafe(item.owner) : '-',
            ms ? pdfSafe(`${ms.title}${ms.date ? ` (${ms.date})` : ''}`) : '-',
            pdfSafe(item.notes || ''),
          ];
        });

        if (typeof pdf.autoTable === 'function') {
          pdf.autoTable({
            startY: 78,
            head: [['Code', 'Deliverable / Subsystem', 'Maturity', 'Department', 'Owner', 'Milestone', 'Notes']],
            body: body.length ? body : [['-', 'No PBS items recorded', '-', '-', '-', '-', '']],
            styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 6, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.5 },
            headStyles: { fillColor: projRgb, textColor: [255, 255, 255], fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
              0: { cellWidth: 54, fontStyle: 'bold' },
              1: { cellWidth: 195 },
              2: { cellWidth: 66, fontStyle: 'bold' },
              3: { cellWidth: 115 },
              4: { cellWidth: 85 },
              5: { cellWidth: 120 },
              6: { cellWidth: 'auto' },
            },
            didParseCell(data) {
              if (data.section !== 'body') return;
              const meta = rowMeta[data.row.index];
              if (!meta) return;
              if (meta.deptRgb) {
                data.cell.styles.fillColor = tintRgb(meta.deptRgb, 0.11);
                if (data.column.index === 3) {
                  data.cell.styles.textColor = meta.deptRgb;
                  data.cell.styles.fontStyle = 'bold';
                }
              }
              if (data.column.index === 1) {
                if (meta.depth === 0) data.cell.styles.fontStyle = 'bold';
                data.cell.styles.cellPadding = { top: 6, right: 6, bottom: 6, left: 8 + meta.depth * 14 };
              }
              if (data.column.index === 2) {
                if (meta.maturity === 'Qualified' || meta.maturity === 'Delivered') {
                  data.cell.styles.textColor = [4, 120, 87];
                } else if (meta.maturity === 'CDR') {
                  data.cell.styles.textColor = [67, 56, 202];
                } else if (meta.maturity === 'PDR') {
                  data.cell.styles.textColor = [180, 83, 9];
                } else {
                  data.cell.styles.textColor = [100, 116, 139];
                }
              }
            },
            didDrawCell(data) {
              if (data.section !== 'body' || data.column.index !== 0) return;
              const meta = rowMeta[data.row.index];
              if (meta && meta.deptRgb) {
                pdf.setFillColor(meta.deptRgb[0], meta.deptRgb[1], meta.deptRgb[2]);
                pdf.rect(data.cell.x, data.cell.y, 4, data.cell.height, 'F');
              }
            },
            margin: { left: 36, right: 36, bottom: 36 },
          });
        }
        const pdfName = `pbs_${sanitizeFilenamePart(project ? (project.code || project.id) : activeProjectId)}_${dateStr}.pdf`;
        pdf.save(pdfName);
        toast(`Exported ${pdfName}`, 'success');
        return;
      } catch (err) {
        toast(err?.message || 'Vector PDF failed; opening print view.', 'warning');
      }
    }

    // Offline fallback: clean light-mode print window with department colors
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      const win = window.open('', '_blank');
      if (!win) {
        toast('Popup blocked — allow popups or connect online for direct PDF export.', 'warning');
        return;
      }
      const tableRows = rows.map(({ item, depth }) => {
        const dept = item.deptId ? deptMap.get(item.deptId) : null;
        const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
        const accent = dept && dept.color ? dept.color : '#cbd5e1';
        return `<tr>
          <td style="font-family:monospace;font-weight:700;border-left:4px solid ${esc(accent)}">${esc(item.code)}</td>
          <td style="padding-left:${8 + depth * 16}px;font-weight:${depth === 0 ? 700 : 500}">${esc(item.name)}</td>
          <td>${esc(item.maturity)}</td>
          <td style="color:${dept && dept.color ? esc(dept.color) : '#475569'};font-weight:600">${dept ? esc(`[${dept.code}] ${dept.name}`) : '-'}</td>
          <td>${esc(item.owner || '-')}</td>
          <td>${ms ? esc(ms.title) : '-'}</td>
          <td>${esc(item.notes || '')}</td>
        </tr>`;
      }).join('');
      win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title>
        <style>body{font-family:Inter,system-ui,sans-serif;color:#0f172a;margin:24px;font-size:12px}h1{font-size:18px;margin:0 0 4px}p{color:#475569;margin:0 0 16px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}th{background:#4f46e5;color:#fff;font-size:11px}</style>
        </head><body><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>
        <table><thead><tr><th>Code</th><th>Deliverable / Subsystem</th><th>Maturity</th><th>Department</th><th>Owner</th><th>Milestone</th><th>Notes</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="7">No PBS items recorded.</td></tr>'}</tbody></table></body></html>`);
      win.document.close();
      win.focus();
      win.print();
    }
  }

  function suggestNextCode(parentId) {
    const siblings = getChildren(parentId);
    const nextNum = siblings.length + 1;
    if (!parentId) return String(nextNum);
    const parent = activeDoc.items.find(i => i.id === parentId);
    return parent && parent.code ? `${parent.code}.${nextNum}` : String(nextNum);
  }

  function collectSubtreeIds(rootId) {
    const ids = new Set([rootId]);
    let added = true;
    while (added) {
      added = false;
      activeDoc.items.forEach(it => {
        if (it.parentId && ids.has(it.parentId) && !ids.has(it.id)) {
          ids.add(it.id);
          added = true;
        }
      });
    }
    return ids;
  }

  function moveItemOrder(itemId, direction) {
    if (!activeDoc) return;
    const item = activeDoc.items.find(i => i.id === itemId);
    if (!item) return;
    const siblings = getChildren(item.parentId);
    const sIdx = siblings.findIndex(s => s.id === itemId);
    const swapIdx = sIdx + direction;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const aIdx = activeDoc.items.indexOf(siblings[sIdx]);
    const bIdx = activeDoc.items.indexOf(siblings[swapIdx]);
    const tmp = activeDoc.items[aIdx];
    activeDoc.items[aIdx] = activeDoc.items[bIdx];
    activeDoc.items[bIdx] = tmp;
    scheduleSave();
    renderPbsDialog();
  }

  function deleteItem(itemId) {
    if (!activeDoc) return;
    const ids = collectSubtreeIds(itemId);
    if (ids.size > 1 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(`Delete this PBS item and its ${ids.size - 1} child item(s)?`)) return;
    }
    activeDoc.items = activeDoc.items.filter(i => !ids.has(i.id));
    if (ids.has(editingItemId)) {
      editingItemId = '';
      isEditingFormOpen = false;
    }
    scheduleSave();
    renderPbsDialog();
  }

  /* ---------- Styles Matched to PulsePlanSecure Design Tokens ---------- */
  function injectStyles() {
    if (document.getElementById('ppPbsStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppPbsStyles';
    style.textContent = `
      dialog#ppPbsDialog { width: min(95vw, 56rem); max-height: 88dvh; padding: 0; border: 1px solid var(--border-subtle, #cbd5e1); border-radius: 1.25rem; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); box-shadow: 0 25px 50px -12px rgba(15,23,42,.35); overflow: hidden; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
      dialog#ppPbsDialog::backdrop { background: rgba(15,23,42,.55); backdrop-filter: blur(3px); }
      .pp-pbs-shell { display: flex; flex-direction: column; max-height: 88dvh; font-size: 12px; }
      .pp-pbs-header { display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-card, #ffffff); }
      .pp-pbs-title-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
      .pp-pbs-swatch { width: 10px; height: 10px; border-radius: 9999px; flex: 0 0 auto; }
      .pp-pbs-title { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -0.015em; color: var(--text-heading, #0f172a); }
      .pp-pbs-sub { margin: .25rem 0 0; font-size: 11px; color: var(--text-muted, #64748b); }
      .pp-pbs-sub code { padding: .1rem .35rem; border-radius: .375rem; background: var(--surface-subtle, #f1f5f9); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }
      .pp-pbs-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .65rem 1.25rem; background: var(--surface-subtle, #f8fafc); border-bottom: 1px solid var(--border-subtle, #e2e8f0); }
      .pp-pbs-group { display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; }
      .pp-pbs-btn { display: inline-flex; align-items: center; gap: .3rem; padding: .4rem .7rem; border-radius: .75rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-secondary, #334155); font-size: 11.5px; font-weight: 600; cursor: pointer; line-height: 1.2; transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease; }
      .pp-pbs-btn:hover { background: var(--surface-hover, #f1f5f9); border-color: var(--border-strong, #94a3b8); }
      .pp-pbs-btn:disabled { opacity: .35; cursor: not-allowed; }
      .pp-pbs-btn-primary { background: #4f46e5; border-color: #4f46e5; color: #ffffff; font-weight: 700; }
      .pp-pbs-btn-primary:hover { background: #4338ca; border-color: #4338ca; color: #ffffff; }
      .pp-pbs-btn-emerald { background: #059669; border-color: #059669; color: #ffffff; font-weight: 700; }
      .pp-pbs-btn-emerald:hover { background: #047857; border-color: #047857; color: #ffffff; }
      .pp-pbs-btn-danger { color: #be123c; border-color: #fecdd3; background: #fff1f2; }
      .pp-pbs-btn-danger:hover { background: #ffe4e6; border-color: #fda4af; }
      .pp-pbs-btn-sm { padding: .22rem .48rem; border-radius: .5rem; font-size: 10.5px; }
      .pp-pbs-close { width: 2rem; height: 2rem; justify-content: center; padding: 0; font-size: 16px; border-radius: .75rem; }
      .pp-pbs-badge { display: inline-flex; align-items: center; padding: .18rem .5rem; border-radius: .45rem; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; border: 1px solid transparent; }
      .pp-pbs-badge-ok { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
      .pp-pbs-badge-warn { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
      .pp-pbs-badge-idle { background: var(--surface-muted, #e2e8f0); color: var(--text-secondary, #334155); border-color: var(--border-subtle, #cbd5e1); }
      .pp-pbs-badge-error { background: #ffe4e6; color: #be123c; border-color: #fda4af; }
      .pp-pbs-body { flex: 1 1 auto; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: .75rem; background: var(--surface-page, #f1f5f9); }
      .pp-pbs-conflict { padding: .75rem .9rem; border-radius: .85rem; border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; }
      .pp-pbs-form { padding: .9rem; border-radius: 1rem; border: 1px solid #c7d2fe; background: var(--surface-card, #ffffff); display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .6rem; box-shadow: 0 4px 12px -4px rgba(79,70,229,.15); }
      .pp-pbs-field { display: flex; flex-direction: column; gap: .25rem; }
      .pp-pbs-field-full { grid-column: 1 / -1; }
      .pp-pbs-field label { font-size: 10.5px; font-weight: 700; color: var(--text-muted, #475569); text-transform: uppercase; letter-spacing: .03em; }
      .pp-pbs-field input, .pp-pbs-field select, .pp-pbs-field textarea { padding: .42rem .6rem; border-radius: .6rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 12px; }
      .pp-pbs-tree { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .45rem; }
      .pp-pbs-tree .pp-pbs-tree { margin-top: .45rem; padding-left: 1.05rem; border-left: 2px solid var(--border-subtle, #cbd5e1); }
      .pp-pbs-node { border: 1px solid var(--border-subtle, #e2e8f0); border-radius: .85rem; background: var(--surface-card, #ffffff); box-shadow: 0 1px 2px rgba(15,23,42,.05); }
      .pp-pbs-node > summary { list-style: none; cursor: pointer; padding: .6rem .8rem; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; }
      .pp-pbs-node > summary::-webkit-details-marker { display: none; }
      .pp-pbs-node-main { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; min-width: 0; flex: 1 1 220px; }
      .pp-pbs-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 800; color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; padding: .12rem .42rem; border-radius: .45rem; font-size: 11px; }
      .pp-pbs-name { font-weight: 700; color: var(--text-heading, #0f172a); overflow-wrap: anywhere; font-size: 12.5px; }
      .pp-pbs-meta { font-size: 11px; color: var(--text-muted, #64748b); }
      .pp-pbs-notes { padding: 0 .8rem .65rem; font-size: 11.5px; color: var(--text-secondary, #334155); white-space: pre-wrap; }
      .pp-pbs-children { padding: 0 .8rem .7rem; }
      .pp-pbs-empty { text-align: center; padding: 2.25rem 1.25rem; color: var(--text-muted, #64748b); border: 1.5px dashed var(--border-strong, #cbd5e1); border-radius: 1rem; background: var(--surface-card, #ffffff); }
      .pp-pbs-trigger { padding: .25rem .55rem; border-radius: .5rem; border: 1px solid #c7d2fe; background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 700; cursor: pointer; transition: background-color 140ms ease; }
      .pp-pbs-trigger:hover { background: #e0e7ff; }
      html.dark .pp-pbs-badge-ok, body.dark .pp-pbs-badge-ok { background: rgba(16,185,129,.16); color: #34d399; border-color: rgba(16,185,129,.35); }
      html.dark .pp-pbs-badge-warn, body.dark .pp-pbs-badge-warn { background: rgba(245,158,11,.18); color: #fbbf24; border-color: rgba(245,158,11,.42); }
      html.dark .pp-pbs-badge-error, body.dark .pp-pbs-badge-error { background: rgba(244,63,94,.22); color: #fda4af; border-color: rgba(244,63,94,.48); }
      html.dark .pp-pbs-code, body.dark .pp-pbs-code { background: rgba(99,102,241,.22); border-color: rgba(129,140,248,.4); color: #c7d2fe; }
      html.dark .pp-pbs-form, body.dark .pp-pbs-form { border-color: #4f46e5; }
      html.dark .pp-pbs-btn-danger, body.dark .pp-pbs-btn-danger { background: rgba(244,63,94,.16); border-color: rgba(244,63,94,.4); color: #fda4af; }
      html.dark .pp-pbs-trigger, body.dark .pp-pbs-trigger { background: rgba(99,102,241,.2); border-color: rgba(129,140,248,.4); color: #c7d2fe; }
    `;
    document.head.appendChild(style);
  }

  let lastStatusText = 'Saved locally in browser';
  let lastStatusTone = 'idle';

  function setSyncStatus(text, tone) {
    lastStatusText = text;
    lastStatusTone = tone || 'idle';
    const badge = document.getElementById('ppPbsStatusBadge');
    if (badge) {
      badge.textContent = text;
      badge.className = `pp-pbs-badge pp-pbs-badge-${lastStatusTone}`;
    }
  }

  function ensureDialog() {
    let dlg = document.getElementById('ppPbsDialog');
    if (dlg) return dlg;
    injectStyles();
    dlg = document.createElement('dialog');
    dlg.id = 'ppPbsDialog';
    dlg.setAttribute('aria-labelledby', 'ppPbsTitle');
    dlg.addEventListener('close', () => {
      stopPolling();
    });
    document.body.appendChild(dlg);
    return dlg;
  }

  function renderTreeHtml(parentId) {
    const children = getChildren(parentId);
    if (!children.length) return '';
    const db = getDb();
    const deptMap = new Map((db.departments || []).map(d => [d.id, d]));
    const msMap = new Map((db.milestones || []).map(m => [m.id, m]));
    return `<ul class="pp-pbs-tree">${children.map((item, idx) => {
      const subHtml = renderTreeHtml(item.id);
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      const tone = item.maturity === 'Qualified' || item.maturity === 'Delivered'
        ? 'ok'
        : (item.maturity === 'CDR' || item.maturity === 'PDR' ? 'warn' : 'idle');
      const borderStyle = dept && dept.color ? ` style="border-left:4px solid ${esc(dept.color)}"` : '';
      return `
        <li>
          <details class="pp-pbs-node" open${borderStyle}>
            <summary>
              <div class="pp-pbs-node-main">
                <span class="pp-pbs-code">${esc(item.code)}</span>
                <span class="pp-pbs-name">${esc(item.name)}</span>
                <span class="pp-pbs-badge pp-pbs-badge-${tone}">${esc(item.maturity)}</span>
                ${dept ? `<span class="pp-pbs-meta" style="color:${esc(dept.color || '')};font-weight:700">[${esc(dept.code)}] ${esc(dept.name)}</span>` : ''}
                ${item.owner ? `<span class="pp-pbs-meta">Owner: ${esc(item.owner)}</span>` : ''}
                ${ms ? `<span class="pp-pbs-meta">◆ ${esc(ms.title)}</span>` : ''}
              </div>
              <div class="pp-pbs-group">
                <button type="button" class="pp-pbs-btn pp-pbs-btn-sm" data-pbs-action="add-child" data-pbs-id="${esc(item.id)}" aria-label="Add child under ${esc(item.name)}">+ Child</button>
                <button type="button" class="pp-pbs-btn pp-pbs-btn-sm" data-pbs-action="edit" data-pbs-id="${esc(item.id)}" aria-label="Edit ${esc(item.name)}">Edit</button>
                <button type="button" class="pp-pbs-btn pp-pbs-btn-sm" data-pbs-action="up" data-pbs-id="${esc(item.id)}" ${idx === 0 ? 'disabled' : ''} aria-label="Move ${esc(item.name)} up">▲</button>
                <button type="button" class="pp-pbs-btn pp-pbs-btn-sm" data-pbs-action="down" data-pbs-id="${esc(item.id)}" ${idx === children.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(item.name)} down">▼</button>
                <button type="button" class="pp-pbs-btn pp-pbs-btn-sm pp-pbs-btn-danger" data-pbs-action="delete" data-pbs-id="${esc(item.id)}" aria-label="Delete ${esc(item.name)}">×</button>
              </div>
            </summary>
            ${item.notes ? `<div class="pp-pbs-notes">${esc(item.notes)}</div>` : ''}
            ${subHtml ? `<div class="pp-pbs-children">${subHtml}</div>` : ''}
          </details>
        </li>`;
    }).join('')}</ul>`;
  }

  function renderEditorFormHtml() {
    if (!isEditingFormOpen || !activeDoc) return '';
    const db = getDb();
    const item = editingItemId ? activeDoc.items.find(i => i.id === editingItemId) : null;
    const projectMilestones = (db.milestones || []).filter(m => m.projectId === activeProjectId);
    const codeVal = item ? item.code : suggestNextCode(addingParentId);
    const nameVal = item ? item.name : '';
    const deptVal = item ? item.deptId : '';
    const ownerVal = item ? item.owner : '';
    const matVal = item ? item.maturity : 'Draft';
    const msVal = item ? item.milestoneId : '';
    const notesVal = item ? item.notes : '';
    return `
      <form id="ppPbsItemForm" class="pp-pbs-form">
        <div class="pp-pbs-field">
          <label for="ppPbsCode">PBS Code</label>
          <input id="ppPbsCode" name="code" type="text" required value="${esc(codeVal)}" placeholder="1.1" />
        </div>
        <div class="pp-pbs-field">
          <label for="ppPbsName">Deliverable / Subsystem</label>
          <input id="ppPbsName" name="name" type="text" required value="${esc(nameVal)}" placeholder="e.g. Optomechanical Assembly" />
        </div>
        <div class="pp-pbs-field">
          <label for="ppPbsDept">Responsible Department</label>
          <select id="ppPbsDept" name="deptId">
            <option value="">— Unassigned —</option>
            ${(db.departments || []).map(d => `<option value="${esc(d.id)}" ${deptVal === d.id ? 'selected' : ''}>[${esc(d.code)}] ${esc(d.name)}</option>`).join('')}
          </select>
        </div>
        <div class="pp-pbs-field">
          <label for="ppPbsOwner">Owner</label>
          <input id="ppPbsOwner" name="owner" type="text" value="${esc(ownerVal)}" placeholder="Lead engineer" />
        </div>
        <div class="pp-pbs-field">
          <label for="ppPbsMaturity">Maturity Gate</label>
          <select id="ppPbsMaturity" name="maturity">
            ${MATURITY_OPTIONS.map(m => `<option value="${esc(m)}" ${matVal === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
        </div>
        <div class="pp-pbs-field">
          <label for="ppPbsMilestone">Linked Milestone</label>
          <select id="ppPbsMilestone" name="milestoneId">
            <option value="">— None —</option>
            ${projectMilestones.map(m => `<option value="${esc(m.id)}" ${msVal === m.id ? 'selected' : ''}>${esc(m.title)} (${esc(m.date || '')})</option>`).join('')}
          </select>
        </div>
        <div class="pp-pbs-field pp-pbs-field-full">
          <label for="ppPbsNotes">Notes / Acceptance Criteria</label>
          <textarea id="ppPbsNotes" name="notes" rows="2" placeholder="Optional technical or verification notes...">${esc(notesVal)}</textarea>
        </div>
        <div class="pp-pbs-field-full pp-pbs-group">
          <button type="submit" class="pp-pbs-btn pp-pbs-btn-primary">${item ? 'Update Item' : 'Add Item'}</button>
          <button type="button" id="ppPbsCancelFormBtn" class="pp-pbs-btn">Cancel</button>
        </div>
      </form>`;
  }

  function renderPbsDialog() {
    const dlg = ensureDialog();
    const project = getProject(activeProjectId);
    if (!project || !activeDoc) return;
    const encrypted = Boolean(getSessionPassphrase());
    const canDir = supportsDirSync();
    const folderLabel = dirHandle
      ? `Folder: ${dirHandle.name}`
      : (rememberedDirHandle ? `Reconnect: ${rememberedDirHandle.name}` : 'Link PBS Folder');
    const conflictHtml = conflictRemoteText ? `
      <div class="pp-pbs-conflict" role="alert">
        <span><strong>Sync conflict:</strong> ${esc(getPbsFilename(project))} was modified on disk since your last sync.</span>
        <div class="pp-pbs-group">
          <button type="button" id="ppPbsConflictReload" class="pp-pbs-btn pp-pbs-btn-primary">Reload Theirs</button>
          <button type="button" id="ppPbsConflictKeep" class="pp-pbs-btn">Keep Mine</button>
          <button type="button" id="ppPbsConflictBackup" class="pp-pbs-btn">Download Backup</button>
        </div>
      </div>` : '';
    const treeHtml = activeDoc.items.length
      ? renderTreeHtml(null)
      : `<div class="pp-pbs-empty">No PBS items yet for <strong>${esc(project.name)}</strong>. Click <strong>+ Add Root Item</strong> or <strong>Load PBS (.json)</strong>.</div>`;

    dlg.innerHTML = `
      <div class="pp-pbs-shell">
        <header class="pp-pbs-header">
          <div>
            <div class="pp-pbs-title-row">
              <span class="pp-pbs-swatch" style="background:${esc(project.color || '#4f46e5')}" aria-hidden="true"></span>
              <h2 id="ppPbsTitle" class="pp-pbs-title">PBS — [${esc(project.code)}] ${esc(project.name)}</h2>
            </div>
            <p class="pp-pbs-sub">Separate file: <code>${esc(getPbsFilename(project))}</code> &middot; ${activeDoc.items.length} item${activeDoc.items.length === 1 ? '' : 's'} &middot; Rev ${activeDoc.meta.revision}</p>
          </div>
          <div class="pp-pbs-group">
            <span id="ppPbsEncBadge" class="pp-pbs-badge ${encrypted ? 'pp-pbs-badge-ok' : 'pp-pbs-badge-idle'}">${encrypted ? 'AES-256-GCM' : 'Plaintext'}</span>
            <span id="ppPbsStatusBadge" class="pp-pbs-badge pp-pbs-badge-${lastStatusTone}">${esc(lastStatusText)}</span>
            <button type="button" id="ppPbsCloseBtn" class="pp-pbs-btn pp-pbs-close" aria-label="Close PBS dialog">&times;</button>
          </div>
        </header>

        <div class="pp-pbs-toolbar">
          <div class="pp-pbs-group">
            <button type="button" id="ppPbsAddRootBtn" class="pp-pbs-btn pp-pbs-btn-primary">+ Add Root Item</button>
            <button type="button" id="ppPbsExpandAllBtn" class="pp-pbs-btn">Expand All</button>
            <button type="button" id="ppPbsCollapseAllBtn" class="pp-pbs-btn">Collapse All</button>
          </div>
          <div class="pp-pbs-group">
            ${canDir ? `<button type="button" id="ppPbsFolderBtn" class="pp-pbs-btn">${esc(folderLabel)}</button>` : ''}
            <button type="button" id="ppPbsLoadBtn" class="pp-pbs-btn">Load (.json)</button>
            <button type="button" id="ppPbsSaveBtn" class="pp-pbs-btn">Save (.json)</button>
            <button type="button" id="ppPbsPdfBtn" class="pp-pbs-btn pp-pbs-btn-emerald">Export PDF</button>
            <button type="button" id="ppPbsPassBtn" class="pp-pbs-btn">${encrypted ? 'Passphrase Active' : 'Set Passphrase'}</button>
            <input type="file" id="ppPbsFileInput" accept=".json,application/json" hidden />
          </div>
        </div>

        <section class="pp-pbs-body" aria-label="Product Breakdown Structure tree">
          ${conflictHtml}
          ${renderEditorFormHtml()}
          ${treeHtml}
        </section>
      </div>`;

    wireDialogEvents(dlg);
  }

  function wireDialogEvents(dlg) {
    dlg.querySelector('#ppPbsCloseBtn')?.addEventListener('click', () => dlg.close());
    dlg.querySelector('#ppPbsAddRootBtn')?.addEventListener('click', () => {
      editingItemId = '';
      addingParentId = null;
      isEditingFormOpen = true;
      renderPbsDialog();
      dlg.querySelector('#ppPbsName')?.focus();
    });
    dlg.querySelector('#ppPbsExpandAllBtn')?.addEventListener('click', () => {
      dlg.querySelectorAll('details.pp-pbs-node').forEach(d => { d.open = true; });
    });
    dlg.querySelector('#ppPbsCollapseAllBtn')?.addEventListener('click', () => {
      dlg.querySelectorAll('details.pp-pbs-node').forEach(d => { d.open = false; });
    });
    dlg.querySelector('#ppPbsFolderBtn')?.addEventListener('click', () => {
      if (!dirHandle && rememberedDirHandle) reconnectRememberedFolder();
      else linkPbsFolder();
    });
    dlg.querySelector('#ppPbsLoadBtn')?.addEventListener('click', () => {
      dlg.querySelector('#ppPbsFileInput')?.click();
    });
    dlg.querySelector('#ppPbsFileInput')?.addEventListener('change', (ev) => {
      const f = ev.target && ev.target.files && ev.target.files[0];
      if (f) importPbsFromFile(f);
    });
    dlg.querySelector('#ppPbsSaveBtn')?.addEventListener('click', () => exportActivePbsFile());
    dlg.querySelector('#ppPbsPdfBtn')?.addEventListener('click', () => exportActivePbsPdf());
    dlg.querySelector('#ppPbsPassBtn')?.addEventListener('click', () => {
      if (typeof openSyncEncryptionDialog === 'function') {
        openSyncEncryptionDialog('Set or unlock the single session passphrase shared by your roadmap and all PBS files.');
      }
    });
    dlg.querySelector('#ppPbsCancelFormBtn')?.addEventListener('click', () => {
      isEditingFormOpen = false;
      editingItemId = '';
      renderPbsDialog();
    });
    dlg.querySelector('#ppPbsItemForm')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const code = (form.code.value || '').trim();
      const name = (form.name.value || '').trim();
      if (!code || !name) return;
      const payload = {
        code,
        name,
        deptId: form.deptId.value || '',
        owner: (form.owner.value || '').trim(),
        maturity: MATURITY_OPTIONS.includes(form.maturity.value) ? form.maturity.value : 'Draft',
        milestoneId: form.milestoneId.value || '',
        notes: (form.notes.value || '').trim(),
      };
      if (editingItemId) {
        const target = activeDoc.items.find(i => i.id === editingItemId);
        if (target) Object.assign(target, payload);
      } else {
        activeDoc.items.push({ id: makeId('pbs'), parentId: addingParentId || null, ...payload });
      }
      isEditingFormOpen = false;
      editingItemId = '';
      addingParentId = null;
      scheduleSave();
      renderPbsDialog();
    });

    dlg.querySelector('#ppPbsConflictReload')?.addEventListener('click', async () => {
      const project = getProject(activeProjectId);
      try {
        const { doc, wasEncrypted } = await decodePbsFromText(conflictRemoteText, project);
        activeDoc = doc;
        activeFileModified = conflictRemoteModified;
        activeWasEncrypted = wasEncrypted || Boolean(getSessionPassphrase());
        conflictRemoteText = null;
        conflictRemoteModified = 0;
        pbsCache[activeProjectId] = activeDoc;
        saveCache();
        setSyncStatus(`Reloaded (${getPbsFilename(project)})`, 'ok');
        renderPbsDialog();
      } catch (err) {
        toast(err?.message || 'Could not reload remote PBS.', 'error');
      }
    });
    dlg.querySelector('#ppPbsConflictKeep')?.addEventListener('click', () => {
      conflictRemoteText = null;
      writeActiveProjectToFolder(true).then(() => renderPbsDialog());
    });
    dlg.querySelector('#ppPbsConflictBackup')?.addEventListener('click', () => exportActivePbsFile());

    dlg.querySelectorAll('[data-pbs-action]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const action = btn.getAttribute('data-pbs-action');
        const id = btn.getAttribute('data-pbs-id');
        if (action === 'add-child') {
          editingItemId = '';
          addingParentId = id;
          isEditingFormOpen = true;
          renderPbsDialog();
          dlg.querySelector('#ppPbsName')?.focus();
        } else if (action === 'edit') {
          editingItemId = id;
          addingParentId = null;
          isEditingFormOpen = true;
          renderPbsDialog();
          dlg.querySelector('#ppPbsName')?.focus();
        } else if (action === 'up') {
          moveItemOrder(id, -1);
        } else if (action === 'down') {
          moveItemOrder(id, 1);
        } else if (action === 'delete') {
          deleteItem(id);
        }
      });
    });
  }

  async function openProjectPbsModal(projectId) {
    const project = getProject(projectId);
    if (!project) return;
    activeProjectId = projectId;
    editingItemId = '';
    addingParentId = null;
    isEditingFormOpen = false;
    conflictRemoteText = null;
    activeWasEncrypted = Boolean(getSessionPassphrase());
    activeDoc = normalizePbsDoc(pbsCache[projectId], project) || createEmptyPbs(project);
    setSyncStatus(dirHandle ? `Linked (${dirHandle.name})` : (supportsDirSync() ? 'Local browser cache' : 'Firefox portable mode'), 'idle');

    const dlg = ensureDialog();
    renderPbsDialog();
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', 'open');
    }

    if (supportsDirSync() && !dirHandle && !rememberedDirHandle) {
      rememberedDirHandle = await loadRememberedDirHandle();
      if (rememberedDirHandle && (await ensureDirPermission(rememberedDirHandle, false))) {
        dirHandle = rememberedDirHandle;
      }
      renderPbsDialog();
    }
    if (dirHandle) {
      await syncActiveProjectFromFolder({ silentMissing: true });
      renderPbsDialog();
      startPolling();
    }
  }

  /* ---------- Non-Destructive Injection into Setup & Data -> Projects ---------- */
  function refreshProjectsTableBadges() {
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
      const cached = pbsCache[projId];
      const count = cached && Array.isArray(cached.items) ? cached.items.length : 0;
      const label = count > 0 ? `PBS (${count})` : 'PBS';
      let btn = cell.querySelector(`button[data-pp-pbs-btn="${projId}"]`);
      if (!btn) {
        injectStyles();
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pp-pbs-trigger';
        btn.setAttribute('data-pp-pbs-btn', projId);
        btn.title = 'Open separate encrypted Product Breakdown Structure (PBS)';
        btn.addEventListener('click', () => openProjectPbsModal(projId));
        cell.insertBefore(btn, cell.firstChild);
      }
      btn.textContent = label;
    });
  }

  if (typeof renderDataTab === 'function') {
    const nativeRenderDataTab = renderDataTab;
    renderDataTab = function (...args) {
      const res = nativeRenderDataTab.apply(this, args);
      refreshProjectsTableBadges();
      return res;
    };
  }

  if (typeof updateSyncEncryptionBadges === 'function') {
    const nativeUpdateEncBadges = updateSyncEncryptionBadges;
    updateSyncEncryptionBadges = function (...args) {
      const res = nativeUpdateEncBadges.apply(this, args);
      const dlg = document.getElementById('ppPbsDialog');
      if (dlg && dlg.open && activeProjectId) renderPbsDialog();
      return res;
    };
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => { pollActivePbsFile(); }, { passive: true });
  }

  if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
    const wn = MANUAL_SECTIONS.find(s => s && s.id === 'whatsnew');
    if (wn && typeof wn.bodyHtml === 'string' && !wn.bodyHtml.includes('Product Breakdown Structure (PBS)')) {
      wn.keywords = `${wn.keywords || ''} pbs product breakdown structure pdf folder sync`;
      wn.bodyHtml = wn.bodyHtml.replace(
        '</ul>',
        `<li>&bull; <strong>Per-Project Product Breakdown Structure (PBS):</strong> Open <strong>PBS</strong> on any project row in <strong>Setup &amp; Data &rarr; Projects</strong> to build a hierarchical deliverable tree saved in separate <code class="px-1 rounded bg-white font-mono">pbs_&lt;CODE&gt;.json</code> files, reusing your single AES-256-GCM session passphrase, with Chrome/Edge folder auto-sync, Firefox portable Load/Save, and department-coloured <strong>Export PDF</strong>.</li></ul>`
      );
    }
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.openProjectPbsModal = openProjectPbsModal;
    globalThis.__ppPbsTestApi = {
      normalizePbsDoc,
      encodePbsForDisk,
      decodePbsFromText,
      getPbsFilename,
      supportsDirSync,
      exportActivePbsPdf,
    };
  }
})();
