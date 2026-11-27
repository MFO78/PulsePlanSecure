/* Isolated Dual-File Finance Vault: Separate AES-256-GCM encrypted file for Day Rates & Project Costs,
 * encrypted using the unified session Administrator key (unlocked internally by authorized user login) — no second password needed.
 * Persists Finance DB path in the main DB (db.settings.financeVault), polls & 3-way merges teammate updates, and remembers file/folder handles in IndexedDB. */
(function ppFinanceVaultModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  const VAULT_VERSION = 3;
  const PBKDF2_ITERS = 250000;
  const SPLIT_FLAG_KEY = 'pulseplan_finance_split_enabled_v1';
  const FIN_HANDLE_KEY = 'finance_vault_handle';
  const FIN_DIR_KEY = 'finance_dir_handle';
  const FIN_POLL_MS = 15000;
  const FIN_IO_TIMEOUT_MS = 10000;
  const FIN_LOG_RE = /(€|\$|£|day\s*rate|dayrate|budget\s*cost|budgetcost|cost\s*budget|\brate\b|\bcost\b|\bbudget\b)/i;

  const state = {
    unlocked: false,
    splitMode: loadSplitFlag(),
    fileHandle: null,
    dirHandle: null,
    pendingReconnectHandle: null,
    fileName: 'pulseplan-finance.enc.json',
    filePath: '',
    lastPayload: null,
    lastSavedJson: '',
    lastKnownModified: 0,
    lastWriteId: '',
    explicitEmptyAllowed: false,
    autoSaveTimer: null,
    pollTimer: null,
    isSaving: false,
    saveQueued: false,
    isPolling: false,
    lastError: '',
    legacyPendingRaw: null,
  };

  function loadSplitFlag() {
    try {
      return localStorage.getItem(SPLIT_FLAG_KEY) === '1';
    } catch (_e) {
      return false;
    }
  }

  function saveSplitFlag(val) {
    state.splitMode = !!val;
    try {
      localStorage.setItem(SPLIT_FLAG_KEY, state.splitMode ? '1' : '0');
    } catch (_e) {}
  }

  function getLiveDbRef() {
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    if (typeof getActiveDB === 'function') return getActiveDB();
    return { departments: [], projects: [], settings: {} };
  }

  function isNonLiveMode() {
    return Boolean(typeof ui !== 'undefined' && (ui.demoMode || ui.whatIfMode));
  }

  function isSessionLocked() {
    return typeof ppIsSessionLocked === 'function' && ppIsSessionLocked();
  }

  function isSigningOut() {
    return typeof ppIsSigningOut === 'function' && ppIsSigningOut();
  }

  function getSessionMasterKey() {
    return (typeof ppSyncPassphrase === 'string' && ppSyncPassphrase.length >= 8) ? ppSyncPassphrase : '';
  }

  function canAccessFinance() {
    if (typeof ppCanAccessFinance === 'function') return ppCanAccessFinance();
    return true;
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
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

  function withFinTimeout(promise, ms = FIN_IO_TIMEOUT_MS, label = 'Finance Vault file operation timed out') {
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

  function isFinConnectionError(err) {
    if (!err) return false;
    if (typeof isConnectionLostError === 'function' && isConnectionLostError(err)) return true;
    const name = String(err.name || '');
    const msg = String(err.message || '').toLowerCase();
    return ['NotFoundError', 'NotReadableError', 'NotAllowedError', 'SecurityError', 'InvalidStateError', 'NoModificationAllowedError', 'TimeoutError'].includes(name)
      || msg.includes('permission') || msg.includes('not found') || msg.includes('timed out') || msg.includes('disconnected');
  }

  function generateFinWriteId() {
    return `fin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ---------- Main DB Finance Path Metadata ---------- */
  function getMainDbFinanceMeta(db = getLiveDbRef()) {
    const raw = db && db.settings && db.settings.financeVault && typeof db.settings.financeVault === 'object'
      ? db.settings.financeVault
      : {};
    return {
      enabled: Boolean(raw.enabled),
      fileName: String(raw.fileName || '').trim(),
      filePath: String(raw.filePath || '').trim(),
      linkedAt: String(raw.linkedAt || ''),
    };
  }

  function deriveSiblingFinancePath(fileName, explicitPath = '') {
    const cleanExplicit = String(explicitPath || '').trim().replace(/^["']|["']$/g, '');
    if (cleanExplicit) return cleanExplicit;
    const cleanName = String(fileName || state.fileName || 'pulseplan-finance.enc.json').trim();
    try {
      const mainName = (typeof linkedFileHandle !== 'undefined' && linkedFileHandle?.name)
        || (typeof rememberedFileHandle !== 'undefined' && rememberedFileHandle?.name)
        || '';
      const savedMainPath = (typeof ui !== 'undefined' && ui?.linkedFilePaths && mainName)
        ? String(ui.linkedFilePaths[mainName] || '').trim()
        : '';
      if (savedMainPath) {
        const sep = savedMainPath.includes('\\') ? '\\' : '/';
        const idx = Math.max(savedMainPath.lastIndexOf('/'), savedMainPath.lastIndexOf('\\'));
        if (idx >= 0) {
          const dirPart = savedMainPath.slice(0, idx);
          if (dirPart) return `${dirPart}${sep}${cleanName}`;
        }
      }
    } catch (_e) {}
    return cleanName;
  }

  function syncFinanceMetaToMainDb(fileName, explicitPath = '') {
    const db = getLiveDbRef();
    if (!db || typeof db !== 'object') return;
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    const cleanName = String(fileName || state.fileName || 'pulseplan-finance.enc.json').trim();
    const existing = getMainDbFinanceMeta(db);
    const resolvedPath = deriveSiblingFinancePath(
      cleanName,
      explicitPath || (existing.fileName === cleanName ? existing.filePath : '')
    );
    db.settings.financeVault = {
      enabled: true,
      fileName: cleanName,
      filePath: resolvedPath,
      linkedAt: new Date().toISOString(),
    };
    state.fileName = cleanName;
    state.filePath = resolvedPath;
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
  }

  /* ---------- IndexedDB Handle Persistence (File + Optional Shared Folder) ---------- */
  async function openVaultHandleIDB() {
    if (typeof openHandleIDB === 'function') return openHandleIDB();
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('pulseplan_handles_db', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('file_handles')) {
          req.result.createObjectStore('file_handles');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
    });
  }

  async function saveHandleInIDB(key, handle) {
    if (!handle) return;
    let db = null;
    try {
      db = await withFinTimeout(openVaultHandleIDB(), 5000, 'IDB open timed out');
      await new Promise((resolve, reject) => {
        const tx = db.transaction('file_handles', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IDB write error'));
        tx.onabort = () => reject(tx.error || new Error('IDB write aborted'));
        tx.objectStore('file_handles').put(handle, key);
      });
    } catch (_e) {
      // Non-fatal in private/sandboxed environments
    } finally {
      try { if (db) db.close(); } catch (_e) {}
    }
  }

  async function deleteHandleFromIDB(key) {
    let db = null;
    try {
      db = await withFinTimeout(openVaultHandleIDB(), 5000, 'IDB open timed out');
      await new Promise((resolve) => {
        const tx = db.transaction('file_handles', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        tx.objectStore('file_handles').delete(key);
      });
    } catch (_e) {
      // Non-fatal
    } finally {
      try { if (db) db.close(); } catch (_e) {}
    }
  }

  async function loadHandleFromIDB(key) {
    let db = null;
    try {
      db = await withFinTimeout(openVaultHandleIDB(), 5000, 'IDB open timed out');
      return await new Promise((resolve) => {
        const tx = db.transaction('file_handles', 'readonly');
        const req = tx.objectStore('file_handles').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_e) {
      return null;
    } finally {
      try { if (db) db.close(); } catch (_e) {}
    }
  }

  /* ---------- Web Crypto (PBKDF2-SHA256 + AES-256-GCM) ---------- */
  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function fromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveAesKey(password, saltBytes, iterations = PBKDF2_ITERS) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: Number(iterations) || PBKDF2_ITERS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptFinancePayload(payload, password, writeId = '') {
    if (!password || password.length < 6) {
      throw new Error('Active encryption key is required to encrypt the Finance Vault.');
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(password, salt, PBKDF2_ITERS);
    const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
    const envelope = {
      type: 'pulseplan-finance-vault',
      version: VAULT_VERSION,
      unifiedMasterKey: true,
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERS,
      cipher: 'AES-256-GCM',
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(cipherBuf)),
      updatedAt: new Date().toISOString(),
    };
    if (writeId) envelope.writeId = writeId;
    return JSON.stringify(envelope, null, 2);
  }

  async function decryptFinancePayload(rawJson, password) {
    const env = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    if (!env || env.type !== 'pulseplan-finance-vault' || !env.salt || !env.iv || !env.data) {
      throw new Error('Not a valid PulsePlan Finance Vault file.');
    }
    const salt = fromBase64(env.salt);
    const iv = fromBase64(env.iv);
    const cipherBytes = fromBase64(env.data);
    const key = await deriveAesKey(password, salt, env.iterations || PBKDF2_ITERS);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  function extractWriteIdFromRaw(rawJson) {
    try {
      const env = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      return String(env?.writeId || '');
    } catch (_e) {
      return '';
    }
  }

  /* ---------- Exact Financial Schema (dayRate, budgetCost & externalCosts), 3-Way Merge + ChangeLog Redaction ---------- */
  function normalizeExtCostsList(rawList) {
    if (!Array.isArray(rawList)) return [];
    const seen = new Set();
    return rawList
      .filter(c => c && typeof c === 'object' && c.projectId && String(c.label || '').trim() && Number.isFinite(Number(c.amount)) && Number(c.amount) > 0)
      .map(c => {
        const id = String(c.id || '').trim() || `ext_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        return {
          id,
          projectId: String(c.projectId),
          label: String(c.label).trim().slice(0, 120),
          amount: Math.round(Number(c.amount) * 100) / 100,
          period: String(c.period || '').trim(),
        };
      })
      .filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
  }

  function extractFinancialsFromDb(db) {
    const deptRates = {};
    (db?.departments || []).forEach(d => {
      if (d && d.id && Number(d.dayRate) > 0) {
        deptRates[d.id] = { dayRate: Number(d.dayRate) };
      }
    });

    const projectCosts = {};
    (db?.projects || []).forEach(p => {
      if (p && p.id && Number(p.budgetCost) > 0) {
        projectCosts[p.id] = { budgetCost: Number(p.budgetCost) };
      }
    });

    const rawExt = (Array.isArray(db?.externalCosts) && db.externalCosts.length > 0)
      ? db.externalCosts
      : (Array.isArray(db?.settings?.externalCosts) ? db.settings.externalCosts : []);
    const externalCosts = normalizeExtCostsList(rawExt);

    return { deptRates, projectCosts, externalCosts, exportedAt: new Date().toISOString() };
  }

  function canonicalFinanceJson(payload) {
    const deptRates = {};
    const projectCosts = {};
    Object.keys(payload?.deptRates || {}).sort().forEach(k => {
      const v = Number(payload.deptRates[k]?.dayRate || 0);
      if (v > 0) deptRates[k] = v;
    });
    Object.keys(payload?.projectCosts || {}).sort().forEach(k => {
      const v = Number(payload.projectCosts[k]?.budgetCost || 0);
      if (v > 0) projectCosts[k] = v;
    });
    const externalCosts = normalizeExtCostsList(payload?.externalCosts).sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify({ deptRates, projectCosts, externalCosts });
  }

  function hasNonEmptyFinancials(payload) {
    return Object.keys(payload?.deptRates || {}).some(k => Number(payload.deptRates[k]?.dayRate || 0) > 0)
      || Object.keys(payload?.projectCosts || {}).some(k => Number(payload.projectCosts[k]?.budgetCost || 0) > 0)
      || normalizeExtCostsList(payload?.externalCosts).length > 0;
  }

  function cloneFinancePayload(payload) {
    const deptRates = {};
    const projectCosts = {};
    Object.entries(payload?.deptRates || {}).forEach(([k, v]) => {
      const n = Number(v?.dayRate || 0);
      if (n > 0) deptRates[k] = { dayRate: n };
    });
    Object.entries(payload?.projectCosts || {}).forEach(([k, v]) => {
      const n = Number(v?.budgetCost || 0);
      if (n > 0) projectCosts[k] = { budgetCost: n };
    });
    const externalCosts = normalizeExtCostsList(payload?.externalCosts);
    return { deptRates, projectCosts, externalCosts, exportedAt: payload?.exportedAt || new Date().toISOString() };
  }

  function mergeFinancialsIntoDb(db, payload) {
    if (!db || !payload || typeof payload !== 'object') return;
    const deptRates = payload.deptRates || {};
    const projectCosts = payload.projectCosts || {};
    (db.departments || []).forEach(d => {
      if (!d || !d.id) return;
      d.dayRate = deptRates[d.id] !== undefined ? (Number(deptRates[d.id].dayRate) || 0) : 0;
    });
    (db.projects || []).forEach(p => {
      if (!p || !p.id) return;
      p.budgetCost = projectCosts[p.id] !== undefined ? (Number(projectCosts[p.id].budgetCost) || 0) : 0;
    });
    if (Array.isArray(payload.externalCosts)) {
      db.externalCosts = normalizeExtCostsList(payload.externalCosts);
      if (db.settings && 'externalCosts' in db.settings) delete db.settings.externalCosts;
    }
  }

  function mergeFinancePayloadsThreeWay(basePayload, localPayload, diskPayload) {
    const base = basePayload || { deptRates: {}, projectCosts: {}, externalCosts: [] };
    const local = localPayload || { deptRates: {}, projectCosts: {}, externalCosts: [] };
    const disk = diskPayload || { deptRates: {}, projectCosts: {}, externalCosts: [] };
    const merged = { deptRates: {}, projectCosts: {}, externalCosts: [], exportedAt: new Date().toISOString() };
    const conflicts = [];

    const deptIds = new Set([
      ...Object.keys(base.deptRates || {}),
      ...Object.keys(local.deptRates || {}),
      ...Object.keys(disk.deptRates || {}),
    ]);
    deptIds.forEach(id => {
      const bVal = Number(base.deptRates?.[id]?.dayRate || 0);
      const lVal = Number(local.deptRates?.[id]?.dayRate || 0);
      const dVal = Number(disk.deptRates?.[id]?.dayRate || 0);
      let chosen = lVal;
      if (lVal === dVal) chosen = lVal;
      else if (lVal === bVal) chosen = dVal;
      else if (dVal === bVal) chosen = lVal;
      else {
        chosen = lVal;
        conflicts.push(`dept:${id}`);
      }
      if (chosen > 0) merged.deptRates[id] = { dayRate: chosen };
    });

    const projIds = new Set([
      ...Object.keys(base.projectCosts || {}),
      ...Object.keys(local.projectCosts || {}),
      ...Object.keys(disk.projectCosts || {}),
    ]);
    projIds.forEach(id => {
      const bVal = Number(base.projectCosts?.[id]?.budgetCost || 0);
      const lVal = Number(local.projectCosts?.[id]?.budgetCost || 0);
      const dVal = Number(disk.projectCosts?.[id]?.budgetCost || 0);
      let chosen = lVal;
      if (lVal === dVal) chosen = lVal;
      else if (lVal === bVal) chosen = dVal;
      else if (dVal === bVal) chosen = lVal;
      else {
        chosen = lVal;
        conflicts.push(`project:${id}`);
      }
      if (chosen > 0) merged.projectCosts[id] = { budgetCost: chosen };
    });

    const baseExtMap = new Map(normalizeExtCostsList(base.externalCosts).map(c => [c.id, c]));
    const localExtMap = new Map(normalizeExtCostsList(local.externalCosts).map(c => [c.id, c]));
    const diskExtMap = new Map(normalizeExtCostsList(disk.externalCosts).map(c => [c.id, c]));
    const extIds = new Set([...baseExtMap.keys(), ...localExtMap.keys(), ...diskExtMap.keys()]);
    extIds.forEach(id => {
      const bStr = baseExtMap.has(id) ? JSON.stringify(baseExtMap.get(id)) : '';
      const lStr = localExtMap.has(id) ? JSON.stringify(localExtMap.get(id)) : '';
      const dStr = diskExtMap.has(id) ? JSON.stringify(diskExtMap.get(id)) : '';
      let chosen = localExtMap.get(id) || null;
      if (lStr === dStr) chosen = localExtMap.get(id) || null;
      else if (lStr === bStr) chosen = diskExtMap.get(id) || null;
      else if (dStr === bStr) chosen = localExtMap.get(id) || null;
      else {
        chosen = localExtMap.get(id) || null;
        conflicts.push(`ext:${id}`);
      }
      if (chosen) merged.externalCosts.push({ ...chosen });
    });

    const mergedJson = canonicalFinanceJson(merged);
    return {
      merged,
      conflicts,
      changedLocal: mergedJson !== canonicalFinanceJson(local),
      changedDisk: mergedJson !== canonicalFinanceJson(disk),
    };
  }

  function stripFinancialsFromDb(db) {
    if (!db || typeof db !== 'object') return;
    (db.departments || []).forEach(d => {
      if (d) d.dayRate = 0;
    });
    (db.projects || []).forEach(p => {
      if (p) p.budgetCost = 0;
    });
    if (Array.isArray(db.externalCosts)) db.externalCosts = [];
    if (db.settings && 'externalCosts' in db.settings) delete db.settings.externalCosts;
    if (Array.isArray(db.changeLog)) {
      db.changeLog.forEach(entry => {
        if (!entry) return;
        const txt = `${entry.type || ''} ${entry.summary || ''}`;
        if (FIN_LOG_RE.test(txt)) {
          entry.summary = '[Financial change redacted — Finance Vault]';
        }
      });
    }
  }

  function isMainDbObject(obj) {
    return Boolean(obj && typeof obj === 'object' && (Array.isArray(obj.departments) || Array.isArray(obj.projects)));
  }

  function getStrippedCloneForMainSync(db) {
    if (!isMainDbObject(db)) return db;
    const dbFinMeta = getMainDbFinanceMeta(db);
    if (state.splitMode || dbFinMeta.enabled) {
      const cleanClone = JSON.parse(JSON.stringify(db));
      stripFinancialsFromDb(cleanClone);
      return cleanClone;
    }
    return db;
  }

  /* ---------- Hard Cryptographic Gate: Strip Financials ONLY Before Main DB Encryption ---------- */
  if (typeof encryptPulsePlanData === 'function') {
    const nativeEncryptMain = encryptPulsePlanData;
    encryptPulsePlanData = async function (dbObj, passphrase) {
      if (isMainDbObject(dbObj)) {
        const dbFinMeta = getMainDbFinanceMeta(dbObj);
        if (state.splitMode || dbFinMeta.enabled) {
          const cleanClone = JSON.parse(JSON.stringify(dbObj));
          stripFinancialsFromDb(cleanClone);
          return nativeEncryptMain.call(this, cleanClone, passphrase);
        }
      }
      return nativeEncryptMain.call(this, dbObj, passphrase);
    };
  }

  async function writeStrippedMainFileNow() {
    const db = getLiveDbRef();
    stripFinancialsFromDb(db);
    if (typeof whatIfDB !== 'undefined' && whatIfDB) stripFinancialsFromDb(whatIfDB);
    if (typeof touchDBAndSave === 'function') touchDBAndSave();
    if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof writeDBToLinkedFile === 'function') {
      await writeDBToLinkedFile({ forceOverwrite: true });
    }
  }

  /* ---------- File I/O, Serialized Auto-Sync, Polling & Disconnect Safety ---------- */
  async function readRawFileInfoFromHandle(handle) {
    const file = await withFinTimeout(handle.getFile(), FIN_IO_TIMEOUT_MS, 'Finance Vault read timed out');
    const text = typeof ppReadRawFileText === 'function' ? await ppReadRawFileText(file) : await file.text();
    return { text, lastModified: Number(file?.lastModified || 0), name: file?.name || handle?.name || '' };
  }

  async function saveEncryptedFinanceFile(encryptedText, pickNewFile) {
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      if (pickNewFile || !state.fileHandle) {
        const meta = getMainDbFinanceMeta();
        state.fileHandle = await window.showSaveFilePicker({
          suggestedName: meta.fileName || state.fileName || 'pulseplan-finance.enc.json',
          types: [{ description: 'PulsePlan Encrypted Finance Vault', accept: { 'application/json': ['.json'] } }],
        });
        state.fileName = state.fileHandle.name || state.fileName;
        state.pendingReconnectHandle = null;
        await saveHandleInIDB(FIN_HANDLE_KEY, state.fileHandle);
      }
      const writable = await withFinTimeout(state.fileHandle.createWritable(), FIN_IO_TIMEOUT_MS, 'Finance Vault write timed out');
      await writable.write(encryptedText);
      await writable.close();
      try {
        const f = await state.fileHandle.getFile();
        state.lastKnownModified = Number(f?.lastModified || Date.now());
      } catch (_e) {
        state.lastKnownModified = Date.now();
      }
      return state.fileName;
    }
    const blob = new Blob([encryptedText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileName || 'pulseplan-finance.enc.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return a.download;
  }

  function handleFinanceConnectionLost(reason, err) {
    const lostHandle = state.fileHandle;
    const isPermErr = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    stopFinancePolling();
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = null;
    state.fileHandle = null;
    state.pendingReconnectHandle = isPermErr ? (lostHandle || state.pendingReconnectHandle) : null;
    state.lastError = err?.message || String(reason || 'connection_lost');
    lockFinanceVaultSilently(true);
    if (typeof clearUndoHistory === 'function') clearUndoHistory();
    if (typeof renderAll === 'function') renderAll();
    if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
    const detailMsg = reason === 'key_changed'
      ? 'Finance Vault encryption key changed on disk — financials cleared until re-unlocked.'
      : 'Finance Vault connection lost — financial figures cleared from memory until reconnected.';
    toast(detailMsg, 'warning');
  }

  function stopFinancePolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startFinancePolling() {
    stopFinancePolling();
    if (!state.unlocked || !state.fileHandle || !canAccessFinance()) return;
    if (typeof setInterval !== 'function') return;
    state.pollTimer = setInterval(() => {
      pollFinanceVaultNow({ silent: true });
    }, FIN_POLL_MS);
  }

  async function autoSyncFinanceFile({ immediate = false, allowWhileSigningOut = false } = {}) {
    const masterKey = getSessionMasterKey();
    if (!state.unlocked || !masterKey || !state.fileHandle || !canAccessFinance()) {
      return { ok: false, skipped: true };
    }
    if (!allowWhileSigningOut && (isSessionLocked() || isSigningOut() || isNonLiveMode())) {
      return { ok: false, skipped: true };
    }
    if (state.isSaving) {
      state.saveQueued = true;
      return { ok: false, queued: true };
    }

    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = null;
    state.isSaving = true;
    state.saveQueued = false;

    try {
      const db = getLiveDbRef();
      let payloadToWrite = extractFinancialsFromDb(db);
      const localJson = canonicalFinanceJson(payloadToWrite);

      // Guard: never accidentally wipe a non-empty Finance Vault on disk with empty values
      // unless the user explicitly cleared rates down to 0 during this session.
      if (!hasNonEmptyFinancials(payloadToWrite) && hasNonEmptyFinancials(state.lastPayload) && !state.explicitEmptyAllowed) {
        mergeFinancialsIntoDb(db, state.lastPayload);
        return { ok: false, preventedWipe: true };
      }

      if (!immediate && localJson === state.lastSavedJson) {
        return { ok: true, unchanged: true };
      }

      // Pre-write disk check & 3-way merge to avoid overwriting teammate updates
      let mergedRemoteIntoLocal = false;
      if (typeof state.fileHandle.getFile === 'function') {
        const diskInfo = await readRawFileInfoFromHandle(state.fileHandle);
        if (diskInfo.lastModified > 0 && state.lastKnownModified > 0 && diskInfo.lastModified > state.lastKnownModified + 500) {
          const diskWriteId = extractWriteIdFromRaw(diskInfo.text);
          if (diskWriteId && diskWriteId === state.lastWriteId) {
            state.lastKnownModified = diskInfo.lastModified;
          } else {
            let diskPayload;
            try {
              diskPayload = await decryptFinancePayload(diskInfo.text, masterKey);
            } catch (decErr) {
              handleFinanceConnectionLost('key_changed', decErr);
              return { ok: false, error: decErr };
            }
            const mergeRes = mergeFinancePayloadsThreeWay(state.lastPayload || {}, payloadToWrite, diskPayload);
            payloadToWrite = mergeRes.merged;
            if (mergeRes.changedLocal) {
              mergeFinancialsIntoDb(db, payloadToWrite);
              mergedRemoteIntoLocal = true;
            }
          }
        }
      }

      if (!allowWhileSigningOut && (isSessionLocked() || !state.unlocked)) {
        return { ok: false, aborted: true };
      }

      const writeId = generateFinWriteId();
      const encText = await encryptFinancePayload(payloadToWrite, masterKey, writeId);
      const writable = await withFinTimeout(state.fileHandle.createWritable(), FIN_IO_TIMEOUT_MS, 'Finance Vault write timed out');
      await writable.write(encText);
      await writable.close();

      state.lastWriteId = writeId;
      state.lastPayload = cloneFinancePayload(payloadToWrite);
      state.lastSavedJson = canonicalFinanceJson(payloadToWrite);
      state.explicitEmptyAllowed = false;
      state.lastError = '';

      if (typeof state.fileHandle.getFile === 'function') {
        try {
          const postFile = await state.fileHandle.getFile();
          state.lastKnownModified = Number(postFile?.lastModified || Date.now());
        } catch (_e) {
          state.lastKnownModified = Date.now();
        }
      } else {
        state.lastKnownModified = Date.now();
      }

      if (mergedRemoteIntoLocal && typeof renderAll === 'function') {
        renderAll();
        toast('Finance Vault merged external updates before saving.', 'info');
      }
      return { ok: true, mergedRemoteIntoLocal };
    } catch (err) {
      state.lastError = err?.message || String(err);
      if (isFinConnectionError(err)) {
        handleFinanceConnectionLost('write_error', err);
      } else {
        toast(`Finance Vault sync failed: ${state.lastError}`, 'error');
      }
      return { ok: false, error: err };
    } finally {
      state.isSaving = false;
      if (state.saveQueued && state.unlocked && !isSessionLocked() && !isSigningOut()) {
        state.saveQueued = false;
        scheduleFinanceAutoSync(250);
      }
    }
  }

  function scheduleFinanceAutoSync(delayMs = 700) {
    if (!state.unlocked || !state.fileHandle || !canAccessFinance() || isSessionLocked() || isNonLiveMode()) return;
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => {
      state.autoSaveTimer = null;
      autoSyncFinanceFile();
    }, delayMs);
  }

  async function pollFinanceVaultNow({ forceRead = false, silent = true } = {}) {
    const masterKey = getSessionMasterKey();
    if (!state.unlocked || !masterKey || !state.fileHandle || !canAccessFinance()) return { updated: false };
    if (isSessionLocked() || isSigningOut() || isNonLiveMode()) return { updated: false };
    if (state.isPolling || state.isSaving || state.saveQueued || (!forceRead && state.autoSaveTimer)) {
      return { updated: false };
    }
    if (typeof state.fileHandle.getFile !== 'function') return { updated: false };

    state.isPolling = true;
    try {
      const diskInfo = await readRawFileInfoFromHandle(state.fileHandle);
      if (!forceRead && state.lastKnownModified > 0 && diskInfo.lastModified <= state.lastKnownModified + 500) {
        return { updated: false };
      }

      const diskWriteId = extractWriteIdFromRaw(diskInfo.text);
      if (!forceRead && diskWriteId && diskWriteId === state.lastWriteId) {
        state.lastKnownModified = Math.max(state.lastKnownModified, diskInfo.lastModified);
        return { updated: false };
      }

      let diskPayload;
      try {
        diskPayload = await decryptFinancePayload(diskInfo.text, masterKey);
      } catch (decErr) {
        handleFinanceConnectionLost('key_changed', decErr);
        return { updated: false, error: decErr };
      }

      // Re-check auth & lock state after async decryption
      if (isSessionLocked() || !state.unlocked || !canAccessFinance() || getSessionMasterKey() !== masterKey) {
        return { updated: false };
      }

      const db = getLiveDbRef();
      const localPayload = extractFinancialsFromDb(db);
      const mergeRes = mergeFinancePayloadsThreeWay(state.lastPayload || {}, localPayload, diskPayload);

      mergeFinancialsIntoDb(db, mergeRes.merged);
      state.lastPayload = cloneFinancePayload(mergeRes.merged);
      state.lastKnownModified = Number(diskInfo.lastModified || Date.now());
      state.lastError = '';

      if (mergeRes.changedDisk) {
        // Local had unsaved edits merged with external disk edits -> flush merged result back
        state.lastSavedJson = canonicalFinanceJson(diskPayload);
        scheduleFinanceAutoSync(200);
      } else {
        state.lastSavedJson = canonicalFinanceJson(mergeRes.merged);
      }

      if (mergeRes.changedLocal) {
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
        if (!silent) toast(`Finance Vault updated from ${state.fileName}.`, 'info');
      }
      return { updated: mergeRes.changedLocal, merged: mergeRes.merged };
    } catch (err) {
      state.lastError = err?.message || String(err);
      if (isFinConnectionError(err)) {
        handleFinanceConnectionLost('poll_error', err);
      }
      return { updated: false, error: err };
    } finally {
      state.isPolling = false;
    }
  }

  /* ---------- Lifecycle Hooks Called by 02-state.js, 07-data-sync.js, 29b-user-auth-rbac.js ---------- */
  function onMainDbSavedForFinance(db) {
    if (!state.unlocked || !state.fileHandle || !canAccessFinance()) return;
    if (isSessionLocked() || isSigningOut() || isNonLiveMode()) return;
    const targetDb = db || getLiveDbRef();
    const current = extractFinancialsFromDb(targetDb);
    const currentJson = canonicalFinanceJson(current);
    if (currentJson !== state.lastSavedJson) {
      if (!hasNonEmptyFinancials(current) && hasNonEmptyFinancials(state.lastPayload)) {
        // User actively edited liveDB to zero out rates/budgets
        state.explicitEmptyAllowed = true;
      }
      scheduleFinanceAutoSync(700);
    }
  }

  function reapplyFinanceOverlayAfterMainReload(db) {
    if (!state.unlocked || !canAccessFinance() || isSessionLocked()) return;
    const targetDb = db || getLiveDbRef();
    if (state.lastPayload && targetDb) {
      mergeFinancialsIntoDb(targetDb, state.lastPayload);
    }
  }

  async function onMainDbReloadedForFinance(db) {
    const targetDb = db || getLiveDbRef();
    if (!canAccessFinance() || isSessionLocked()) {
      stripFinancialsFromDb(targetDb);
      return { reloaded: false };
    }
    const meta = getMainDbFinanceMeta(targetDb);
    if (meta.fileName) state.fileName = meta.fileName;
    if (meta.filePath) state.filePath = meta.filePath;
    if (meta.enabled) saveSplitFlag(true);

    if (state.unlocked) {
      // Immediately restore cached financial overlay so liveDB is NEVER transiently zeroed
      if (state.lastPayload) {
        mergeFinancialsIntoDb(targetDb, state.lastPayload);
      }
      if (state.fileHandle) {
        await pollFinanceVaultNow({ forceRead: true, silent: true });
      }
      return { reloaded: true };
    }
    if (meta.enabled) {
      return tryAutoOpenFinanceVault({ allowPermissionPrompt: false, silent: true });
    }
    return { reloaded: false };
  }

  async function flushFinanceVaultIfDirty() {
    // Wait briefly if a Finance save is already in progress
    const waitStart = Date.now();
    while (state.isSaving && Date.now() - waitStart < 4500) {
      await new Promise(r => setTimeout(r, 60));
    }
    if (!state.unlocked || !state.fileHandle || !canAccessFinance() || isNonLiveMode()) {
      return { flushed: false };
    }
    const current = extractFinancialsFromDb(getLiveDbRef());
    const currentJson = canonicalFinanceJson(current);
    if (state.autoSaveTimer || state.saveQueued || currentJson !== state.lastSavedJson) {
      clearTimeout(state.autoSaveTimer);
      state.autoSaveTimer = null;
      const res = await autoSyncFinanceFile({ immediate: true, allowWhileSigningOut: true });
      return { flushed: Boolean(res?.ok), res };
    }
    return { flushed: false, clean: true };
  }

  function resetFinanceVaultForDbSwitch() {
    stopFinancePolling();
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = null;
    state.unlocked = false;
    state.fileHandle = null;
    state.pendingReconnectHandle = null;
    state.lastPayload = null;
    state.lastSavedJson = '';
    state.lastKnownModified = 0;
    state.lastWriteId = '';
    state.explicitEmptyAllowed = false;
    state.isSaving = false;
    state.saveQueued = false;
    state.isPolling = false;
    state.lastError = '';
    state.legacyPendingRaw = null;
    const meta = getMainDbFinanceMeta(getLiveDbRef());
    state.fileName = meta.fileName || 'pulseplan-finance.enc.json';
    state.filePath = meta.filePath || '';
    saveSplitFlag(Boolean(meta.enabled));
    closeFinanceVaultModal();
    updateHeaderPill();
  }

  /* ---------- Pick, Auto-Open & Unlock ---------- */
  async function pickAndReadFinanceFile() {
    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'PulsePlan Encrypted Finance Vault', accept: { 'application/json': ['.json'] } }],
      });
      const info = await readRawFileInfoFromHandle(handle);
      return { handle, raw: info.text, lastModified: info.lastModified, fileName: handle.name || info.name || state.fileName };
    }
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return reject(new Error('No file selected.'));
        const txt = typeof ppReadRawFileText === 'function' ? await ppReadRawFileText(f) : await f.text();
        resolve({ handle: null, raw: txt, lastModified: Number(f.lastModified || 0), fileName: f.name });
      };
      inp.click();
    });
  }

  async function unlockFromResolvedHandle(handle, key, { silent = true } = {}) {
    const info = await readRawFileInfoFromHandle(handle);
    const payload = await decryptFinancePayload(info.text, key);
    // Re-check auth/lock after async crypto so a mid-decrypt sign-out cannot re-populate liveDB!
    if (isSessionLocked() || !canAccessFinance()) {
      return { opened: false, aborted: true };
    }
    const curDb = getLiveDbRef();
    mergeFinancialsIntoDb(curDb, payload);
    saveSplitFlag(true);
    state.fileHandle = handle;
    state.pendingReconnectHandle = null;
    state.fileName = handle.name || info.name || state.fileName;
    state.unlocked = true;
    state.lastPayload = cloneFinancePayload(payload);
    state.lastSavedJson = canonicalFinanceJson(payload);
    state.lastKnownModified = info.lastModified;
    state.lastWriteId = extractWriteIdFromRaw(info.text);
    state.explicitEmptyAllowed = false;
    state.lastError = '';
    state.legacyPendingRaw = null;
    await saveHandleInIDB(FIN_HANDLE_KEY, handle);
    startFinancePolling();
    if (typeof renderAll === 'function') renderAll();
    updateHeaderPill();
    if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
    if (!silent) {
      toast(`Finance Vault auto-opened (${state.fileName}).`, 'success');
    }
    return { opened: true, fileName: state.fileName };
  }

  async function ensureHandlePermission(handle, allowPrompt) {
    if (!handle) return 'denied';
    if (typeof handle.queryPermission === 'function') {
      const q = await handle.queryPermission({ mode: 'readwrite' });
      if (q === 'granted') return 'granted';
      if (allowPrompt && typeof handle.requestPermission === 'function') {
        try {
          return await handle.requestPermission({ mode: 'readwrite' });
        } catch (err) {
          // SecurityError when called outside user gesture -> treat as prompt needed
          if (err && err.name === 'SecurityError') return 'prompt';
          throw err;
        }
      }
      return q;
    }
    return 'granted';
  }

  async function tryAutoOpenFinanceVault({ allowPermissionPrompt = false, silent = true, explicitKey = '' } = {}) {
    const key = (typeof explicitKey === 'string' && explicitKey.length >= 8) ? explicitKey : getSessionMasterKey();
    if (!key || !canAccessFinance() || isSessionLocked()) {
      return { opened: false, needsPermission: false };
    }
    if (state.unlocked) {
      return { opened: true, needsPermission: false, fileName: state.fileName };
    }
    const db = getLiveDbRef();
    const meta = getMainDbFinanceMeta(db);
    if (meta.fileName) state.fileName = meta.fileName;
    if (meta.filePath) state.filePath = meta.filePath;
    if (meta.enabled) saveSplitFlag(true);

    if (!meta.enabled && !state.splitMode && !state.fileHandle) {
      return { opened: false, needsPermission: false };
    }

    // 1. Try in-memory handle or remembered file handle in IndexedDB
    let candidate = state.fileHandle || await loadHandleFromIDB(FIN_HANDLE_KEY);
    if (candidate && meta.fileName && candidate.name && candidate.name !== meta.fileName) {
      candidate = null;
    }

    if (candidate) {
      try {
        const perm = await ensureHandlePermission(candidate, allowPermissionPrompt);
        if (perm === 'granted') {
          return await unlockFromResolvedHandle(candidate, key, { silent });
        }
        state.pendingReconnectHandle = candidate;
        updateHeaderPill();
        if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
        return { opened: false, needsPermission: true, fileName: candidate.name };
      } catch (_e) {
        // Fall through to shared folder lookup
      }
    }

    // 2. Try remembered Shared Folder handle + exact filename stored in main DB
    const expectedName = meta.fileName || state.fileName;
    if (expectedName) {
      const dirHandle = state.dirHandle || await loadHandleFromIDB(FIN_DIR_KEY);
      if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
        state.dirHandle = dirHandle;
        try {
          const dPerm = await ensureHandlePermission(dirHandle, allowPermissionPrompt);
          if (dPerm === 'granted') {
            const resolvedFileHandle = await dirHandle.getFileHandle(expectedName);
            return await unlockFromResolvedHandle(resolvedFileHandle, key, { silent });
          }
          state.pendingReconnectHandle = dirHandle;
          updateHeaderPill();
          if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
          return { opened: false, needsPermission: true, fileName: expectedName };
        } catch (_e) {
          // File not in folder or inaccessible
        }
      }
    }

    updateHeaderPill();
    if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
    return { opened: false, needsPermission: false };
  }

  async function reconnectFinanceVault() {
    const res = await tryAutoOpenFinanceVault({ allowPermissionPrompt: true, silent: false });
    if (!res.opened) {
      openFinanceVaultModal();
    }
    return res;
  }

  function lockFinanceVaultSilently(stripInMemory = true) {
    stopFinancePolling();
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = null;
    const wasUnlocked = state.unlocked;
    state.unlocked = false;
    state.lastPayload = null;
    state.lastSavedJson = '';
    state.explicitEmptyAllowed = false;
    state.legacyPendingRaw = null;
    const db = getLiveDbRef();
    if (stripInMemory && db && (wasUnlocked || state.splitMode || getMainDbFinanceMeta(db).enabled)) {
      stripFinancialsFromDb(db);
      if (typeof whatIfDB !== 'undefined' && whatIfDB) stripFinancialsFromDb(whatIfDB);
    }
    closeFinanceVaultModal();
    updateHeaderPill();
  }

  /* ---------- UI: Header Pill (Compact on Mobile, Full on Desktop) + Modern Unified Finance Vault Modal ---------- */
  function injectStyles() {
    if (document.getElementById('ppFinVaultStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppFinVaultStyles';
    style.textContent = `
      .pp-fin-pill { display: inline-flex; align-items: center; gap: .3rem; padding: .32rem .68rem; border-radius: 999px; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; flex-shrink: 0; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-secondary, #334155); transition: background 140ms ease, border-color 140ms ease; }
      .pp-fin-pill:hover { background: var(--surface-hover, #e2e9f4); }
      .pp-fin-pill.pp-fin-unlocked { border-color: #6ee7b7; background: #ecfdf5; color: #047857; }
      .pp-fin-pill.pp-fin-reconnect { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
      html.dark .pp-fin-pill.pp-fin-unlocked { border-color: rgba(52, 211, 153, .45); background: rgba(16, 185, 129, .14); color: #6ee7b7; }
      html.dark .pp-fin-pill.pp-fin-reconnect { border-color: rgba(251, 191, 36, .45); background: rgba(245, 158, 11, .16); color: #fde68a; }
      .pp-fin-lbl-short { display: none; }
      @media (max-width: 767px) {
        .pp-fin-pill { padding: .24rem .46rem; font-size: 10px; height: 2rem; border-radius: .65rem; }
        .pp-fin-lbl-full { display: none; }
        .pp-fin-lbl-short { display: inline; }
      }
      .pp-fin-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,.58); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem; }
      .pp-fin-modal { width: 100%; max-width: 520px; max-height: 90dvh; overflow-y: auto; border-radius: 1.15rem; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); border: 1px solid var(--border-subtle, #e2e8f0); padding: 1.3rem; box-shadow: 0 24px 56px rgba(15,23,42,.28); }
      .pp-fin-modal h3 { margin: 0; font-size: 15.5px; font-weight: 800; color: var(--text-heading, #0f172a); }
      .pp-fin-banner { margin-top: .8rem; padding: .7rem .85rem; border-radius: .75rem; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11.5px; line-height: 1.5; color: var(--text-secondary, #334155); }
      .pp-fin-banner.pp-fin-ok { border-color: #a7f3d0; background: #ecfdf5; color: #065f46; }
      html.dark .pp-fin-banner.pp-fin-ok { border-color: rgba(52, 211, 153, .35); background: rgba(16, 185, 129, .12); color: #a7f3d0; }
      .pp-fin-banner.pp-fin-warn { border-color: #fde68a; background: #fffbeb; color: #92400e; }
      html.dark .pp-fin-banner.pp-fin-warn { border-color: rgba(251, 191, 36, .35); background: rgba(245, 158, 11, .14); color: #fde68a; }
      .pp-fin-pw-wrap { display: flex; gap: .4rem; align-items: center; margin-top: .35rem; }
      .pp-fin-field { flex: 1; min-width: 0; padding: .48rem .7rem; border-radius: .65rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 12px; }
      .pp-fin-row { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; padding-top: .85rem; border-top: 1px solid var(--border-subtle, #e2e8f0); }
      .pp-fin-btn { padding: .5rem .82rem; border-radius: .7rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-secondary, #334155); font-size: 12px; font-weight: 700; cursor: pointer; transition: opacity 140ms ease, background 140ms ease; }
      .pp-fin-btn:hover { background: var(--surface-hover, #f1f5f9); }
      .pp-fin-btn-primary { border-color: #4f46e5; background: #4f46e5; color: #ffffff; }
      .pp-fin-btn-primary:hover { background: #4338ca; }
      .pp-fin-btn-emerald { border-color: #059669; background: #059669; color: #ffffff; }
      .pp-fin-btn-emerald:hover { background: #047857; }
      .pp-fin-btn-rose { border-color: #fecdd3; background: #fff1f2; color: #be123c; }
      html.dark .pp-fin-btn-rose { border-color: rgba(244, 63, 94, .4); background: rgba(225, 29, 72, .14); color: #fda4af; }
    `;
    document.head.appendChild(style);
  }

  function updateHeaderPill() {
    injectStyles();
    let btn = document.getElementById('ppFinanceVaultBtn');
    const allowed = canAccessFinance() && !isSessionLocked();
    if (!allowed) {
      if (btn) btn.style.display = 'none';
      return;
    }
    if (!btn) {
      const headerRight = document.getElementById('headerMenuWrap')?.parentElement
        || document.querySelector('header .flex')
        || document.querySelector('header')
        || document.body;
      btn = document.createElement('button');
      btn.id = 'ppFinanceVaultBtn';
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (!state.unlocked && state.pendingReconnectHandle && getSessionMasterKey()) {
          reconnectFinanceVault();
        } else {
          openFinanceVaultModal();
        }
      });
      headerRight.appendChild(btn);
    }
    const hasReconnect = !state.unlocked && Boolean(state.pendingReconnectHandle);
    btn.style.display = '';
    btn.className = `pp-fin-pill ${state.unlocked ? 'pp-fin-unlocked' : (hasReconnect ? 'pp-fin-reconnect' : '')}`;
    const fullText = state.unlocked
      ? 'Finance Unlocked'
      : (hasReconnect ? 'Reconnect Finance' : 'Finance Vault');
    const shortText = state.unlocked
      ? 'Fin ✓'
      : (hasReconnect ? 'Fin ↻' : 'Fin');
    btn.innerHTML = `<span class="pp-fin-lbl-full">${esc(fullText)}</span><span class="pp-fin-lbl-short">${esc(shortText)}</span>`;
    btn.title = state.unlocked
      ? `Separate finance DB unlocked & auto-syncing to ${state.fileName}`
      : (hasReconnect
          ? `Click to reconnect remembered Finance Vault (${state.fileName}) without picking a file`
          : 'Open or create the separate encrypted Finance Vault file (uses your active session key)');
  }

  function closeFinanceVaultModal() {
    document.getElementById('ppFinVaultModalBg')?.remove();
  }

  function openFinanceVaultModal() {
    if (!canAccessFinance() || isSessionLocked()) {
      toast('Financial data access is restricted by your Administrator.', 'warning');
      return;
    }
    closeFinanceVaultModal();
    injectStyles();
    const masterKey = getSessionMasterKey();
    const isAdmin = typeof ppHasAdminAccess === 'function'
      ? ppHasAdminAccess()
      : (typeof ppIsStandardUser !== 'function' || !ppIsStandardUser());
    const db = getLiveDbRef();
    const meta = getMainDbFinanceMeta(db);
    if (meta.fileName) state.fileName = meta.fileName;
    if (meta.filePath) state.filePath = meta.filePath;
    const displayPath = meta.filePath || state.filePath || state.fileName;
    const finSummary = extractFinancialsFromDb(db);
    const rateCount = Object.keys(finSummary.deptRates).length;
    const costCount = Object.keys(finSummary.projectCosts).length;
    const supportsDirPicker = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
    const hasReconnect = !state.unlocked && Boolean(state.pendingReconnectHandle);
    const nonLiveNotice = isNonLiveMode()
      ? `<div class="pp-fin-banner pp-fin-warn"><strong>${ui.demoMode ? 'Demo Sandbox Active' : 'What-If Mode Active'}:</strong> Finance Vault actions apply to your Live Database. Exit ${ui.demoMode ? 'Demo' : 'What-If'} mode before modifying financial files.</div>`
      : '';

    const bg = document.createElement('div');
    bg.id = 'ppFinVaultModalBg';
    bg.className = 'pp-fin-modal-bg';
    bg.innerHTML = `
      <div class="pp-fin-modal" role="dialog" aria-modal="true" aria-label="Separate Finance Vault">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem">
          <div style="min-width:0">
            <h3>${state.unlocked ? 'Finance Vault — Unlocked' : 'Separate Finance Database'}</h3>
            <div style="font-size:11.5px;color:var(--text-muted,#64748b);margin-top:.2rem">
              Keeps Department Day Rates &amp; Project Cost Budgets in a separate encrypted file (<code style="font-family:monospace">${esc(state.fileName)}</code>).
            </div>
          </div>
          <button type="button" id="ppFinCloseTopBtn" aria-label="Close Finance Vault" style="border:none;background:transparent;font-size:20px;line-height:1;color:var(--text-muted,#64748b);cursor:pointer;padding:.2rem .4rem;flex-shrink:0">&times;</button>
        </div>

        ${nonLiveNotice}

        ${masterKey ? `
          <div class="pp-fin-banner pp-fin-ok">
            <strong>Unified Session Key Active:</strong> Protected automatically with the Administrator AES-256-GCM encryption key — no separate finance password needed.
            ${state.unlocked
              ? `<div style="margin-top:.25rem">Active live financial records: <strong>${rateCount}</strong> dept rate${rateCount === 1 ? '' : 's'}, <strong>${costCount}</strong> project cost budget${costCount === 1 ? '' : 's'}${state.fileHandle ? ' · Live sync &amp; polling active' : ' · Manual file export'}.</div>`
              : `<div style="margin-top:.25rem">File stays separate from the main roadmap database (${meta.enabled || state.splitMode ? 'linked in Main DB' : 'ready to split'}).</div>`}
          </div>
        ` : `
          <div class="pp-fin-banner pp-fin-warn">
            <strong>Administrator Encryption Key Not Active:</strong> Set the workspace Administrator password first so both the main database and the separate Finance Vault encrypt seamlessly with the same master key.
          </div>
        `}

        ${state.lastError ? `
          <div class="pp-fin-banner pp-fin-warn">
            <strong>Last Sync Notice:</strong> ${esc(state.lastError)}
          </div>
        ` : ''}

        <div class="pp-fin-banner" style="margin-top:.65rem">
          <div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint,#64748b)">
            Finance DB Path Stored in Main Database
          </div>
          <div style="font-size:11px;color:var(--text-muted,#64748b);margin-top:.2rem">
            Saved inside the main DB so authorized users auto-open this file without re-selecting it once remembered on this device.
          </div>
          <div class="pp-fin-pw-wrap">
            <input id="ppFinPathInput" type="text" class="pp-fin-field" style="font-family:monospace;font-size:11.5px"
              value="${esc(displayPath)}" placeholder="e.g., G:\\Shared drives\\PMO\\pulseplan-finance.enc.json" ${isAdmin ? '' : 'readonly'} />
            ${isAdmin ? '<button type="button" id="ppFinSavePathBtn" class="pp-fin-btn">Save Path</button>' : ''}
          </div>
          ${supportsDirPicker ? `
            <div style="margin-top:.45rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
              <span style="font-size:10.5px;color:var(--text-muted,#64748b)">${state.dirHandle ? `Shared folder linked: <strong>${esc(state.dirHandle.name)}</strong>` : 'Optional: link the shared folder once to auto-locate by filename.'}</span>
              <button type="button" id="ppFinLinkDirBtn" class="pp-fin-btn" style="padding:.28rem .58rem;font-size:11px">${state.dirHandle ? 'Change Folder' : 'Link Shared Folder'}</button>
            </div>` : ''}
        </div>

        <div id="ppFinLegacyMigrateWrap" style="display:none;margin-top:.85rem;padding:.75rem;border-radius:.75rem;border:1px solid #fde68a;background:#fffbeb;color:#78350f;font-size:11.5px">
          <div style="font-weight:700;margin-bottom:.35rem">Legacy Password-B Finance File Detected</div>
          <div>This file was encrypted with an older separate Password B. Enter that legacy password below to unlock it and migrate to your unified session key.</div>
          <div class="pp-fin-pw-wrap">
            <input id="ppFinLegacyPwInput" type="password" class="pp-fin-field" placeholder="Enter legacy Password B..." autocomplete="off" />
            <button type="button" id="ppFinLegacyUnlockBtn" class="pp-fin-btn pp-fin-btn-emerald">Unlock &amp; Migrate</button>
          </div>
        </div>

        <div class="pp-fin-row">
          ${!masterKey
            ? `${isAdmin ? `<button type="button" id="ppFinSetupKeyBtn" class="pp-fin-btn pp-fin-btn-emerald">Set Administrator Encryption Key</button>` : ''}`
            : (!state.unlocked
                ? `${hasReconnect ? `<button type="button" id="ppFinReconnectBtn" class="pp-fin-btn pp-fin-btn-emerald">Reconnect Remembered File</button>` : ''}
                   <button type="button" id="ppFinUnlockBtn" class="pp-fin-btn ${hasReconnect ? '' : 'pp-fin-btn-emerald'}">Open &amp; Unlock Finance File</button>
                   ${isAdmin && !isNonLiveMode() ? `<button type="button" id="ppFinSplitBtn" class="pp-fin-btn pp-fin-btn-primary">Create Separate File &amp; Strip Main DB</button>` : ''}`
                : `${!isNonLiveMode() ? `<button type="button" id="ppFinSaveBtn" class="pp-fin-btn pp-fin-btn-primary">Sync Finance File Now</button>` : ''}
                   <button type="button" id="ppFinLockBtn" class="pp-fin-btn pp-fin-btn-rose">Lock &amp; Clear Financials</button>`)}
          <button type="button" id="ppFinCloseBtn" class="pp-fin-btn" style="margin-left:auto">Close</button>
        </div>
      </div>`;

    bg.addEventListener('click', (ev) => { if (ev.target === bg) closeFinanceVaultModal(); });
    document.body.appendChild(bg);

    bg.querySelector('#ppFinCloseTopBtn')?.addEventListener('click', closeFinanceVaultModal);
    bg.querySelector('#ppFinCloseBtn')?.addEventListener('click', closeFinanceVaultModal);

    bg.querySelector('#ppFinSavePathBtn')?.addEventListener('click', async () => {
      const val = (bg.querySelector('#ppFinPathInput')?.value || '').trim().replace(/^["']|["']$/g, '');
      if (!val) return toast('Enter a Finance Vault filename or path.', 'warning');
      const parts = val.split(/[\\/]/).filter(Boolean);
      const fname = parts.length ? parts[parts.length - 1] : val;
      syncFinanceMetaToMainDb(fname, val);
      if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof writeDBToLinkedFile === 'function') {
        await writeDBToLinkedFile();
      }
      if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
      toast(`Saved Finance Vault path in main database (${fname}).`, 'success');
    });

    bg.querySelector('#ppFinLinkDirBtn')?.addEventListener('click', async () => {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        state.dirHandle = dirHandle;
        await saveHandleInIDB(FIN_DIR_KEY, dirHandle);
        if (!state.unlocked) {
          state.fileHandle = null;
          state.pendingReconnectHandle = null;
          await deleteHandleFromIDB(FIN_HANDLE_KEY);
        }
        toast(`Linked shared folder "${dirHandle.name}" for automatic Finance Vault lookup.`, 'success');
        if (!state.unlocked && getSessionMasterKey()) {
          const res = await tryAutoOpenFinanceVault({ allowPermissionPrompt: true, silent: false });
          if (res.opened) {
            closeFinanceVaultModal();
            return;
          }
        }
        openFinanceVaultModal();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        toast(`Could not link folder: ${err?.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinReconnectBtn')?.addEventListener('click', async () => {
      const res = await tryAutoOpenFinanceVault({ allowPermissionPrompt: true, silent: false });
      if (res.opened) closeFinanceVaultModal();
      else toast('Could not access the remembered Finance file. Pick it below to re-link.', 'warning');
    });

    bg.querySelector('#ppFinSetupKeyBtn')?.addEventListener('click', () => {
      closeFinanceVaultModal();
      if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog();
    });

    bg.querySelector('#ppFinSplitBtn')?.addEventListener('click', async () => {
      const key = getSessionMasterKey();
      if (!key) return toast('Enable Administrator encryption first.', 'warning');
      if (isNonLiveMode()) return toast('Exit Demo/What-If mode before splitting the Finance Vault.', 'warning');
      if (typeof ppConfirmAction === 'function') {
        const ok = await ppConfirmAction({
          title: 'Create Separate Finance Vault & Strip Main DB?',
          message: 'Department Day Rates and Project Cost Budgets will be written to a separate encrypted Finance Vault file and stripped from the main roadmap database on disk.',
          confirmLabel: 'Split & Strip Main DB',
          tone: 'warning',
        });
        if (!ok) return;
      }
      try {
        const curDb = getLiveDbRef();
        const payload = extractFinancialsFromDb(curDb);
        const writeId = generateFinWriteId();
        const encText = await encryptFinancePayload(payload, key, writeId);
        const savedName = await saveEncryptedFinanceFile(encText, true);
        const typedPath = (bg.querySelector('#ppFinPathInput')?.value || '').trim();
        saveSplitFlag(true);
        state.unlocked = true;
        state.lastPayload = cloneFinancePayload(payload);
        state.lastSavedJson = canonicalFinanceJson(payload);
        state.lastWriteId = writeId;
        state.explicitEmptyAllowed = false;
        state.lastError = '';
        // Record Finance Vault path inside the main database & flush through unified write pipeline
        syncFinanceMetaToMainDb(savedName, typedPath && typedPath.endsWith(savedName) ? typedPath : '');
        if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof writeDBToLinkedFile === 'function') {
          await writeDBToLinkedFile({ forceOverwrite: true });
        }
        startFinancePolling();
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
        closeFinanceVaultModal();
        toast(`Created separate Finance Vault (${savedName}), saved path in main DB, and stripped financials from main file.`, 'success');
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        toast(`Could not create Finance Vault: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinUnlockBtn')?.addEventListener('click', async () => {
      const key = getSessionMasterKey();
      if (!key) return toast('Sign in with an encrypted session first.', 'warning');
      try {
        const picked = await pickAndReadFinanceFile();
        try {
          const payload = await decryptFinancePayload(picked.raw, key);
          if (isSessionLocked() || !canAccessFinance()) return;
          const curDb = getLiveDbRef();
          mergeFinancialsIntoDb(curDb, payload);
          saveSplitFlag(true);
          state.fileHandle = picked.handle;
          state.pendingReconnectHandle = null;
          state.fileName = picked.fileName || state.fileName;
          state.unlocked = true;
          state.lastPayload = cloneFinancePayload(payload);
          state.lastSavedJson = canonicalFinanceJson(payload);
          state.lastKnownModified = picked.lastModified;
          state.lastWriteId = extractWriteIdFromRaw(picked.raw);
          state.explicitEmptyAllowed = false;
          state.lastError = '';
          state.legacyPendingRaw = null;
          if (picked.handle) await saveHandleInIDB(FIN_HANDLE_KEY, picked.handle);
          if (isAdmin) {
            syncFinanceMetaToMainDb(state.fileName, '');
            if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof writeDBToLinkedFile === 'function') {
              await writeDBToLinkedFile();
            }
          }
          startFinancePolling();
          if (typeof renderAll === 'function') renderAll();
          updateHeaderPill();
          if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
          closeFinanceVaultModal();
          toast(`Finance Vault unlocked & remembered for auto-open (${state.fileName}).`, 'success');
        } catch (_decErr) {
          let parsedEnv = null;
          try { parsedEnv = JSON.parse(picked.raw); } catch (_e) {}
          if (parsedEnv && parsedEnv.type === 'pulseplan-finance-vault') {
            state.legacyPendingRaw = picked.raw;
            state.legacyPendingPick = picked;
            const wrap = bg.querySelector('#ppFinLegacyMigrateWrap');
            if (wrap) wrap.style.display = 'block';
            bg.querySelector('#ppFinLegacyPwInput')?.focus();
          } else {
            toast('Selected file is not a valid PulsePlan Finance Vault.', 'error');
          }
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        toast(`Could not open Finance Vault: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinLegacyUnlockBtn')?.addEventListener('click', async () => {
      const legacyPw = (bg.querySelector('#ppFinLegacyPwInput')?.value || '').trim();
      const key = getSessionMasterKey();
      if (!legacyPw || !state.legacyPendingRaw || !key) return;
      try {
        const payload = await decryptFinancePayload(state.legacyPendingRaw, legacyPw);
        const picked = state.legacyPendingPick || {};
        const curDb = getLiveDbRef();
        mergeFinancialsIntoDb(curDb, payload);
        saveSplitFlag(true);
        state.fileHandle = picked.handle || state.fileHandle;
        state.fileName = picked.fileName || state.fileName;
        state.unlocked = true;
        state.lastPayload = cloneFinancePayload(payload);
        state.lastSavedJson = canonicalFinanceJson(payload);
        state.explicitEmptyAllowed = false;
        state.legacyPendingRaw = null;
        state.legacyPendingPick = null;
        if (state.fileHandle) await saveHandleInIDB(FIN_HANDLE_KEY, state.fileHandle);
        if (state.fileHandle && typeof state.fileHandle.createWritable === 'function') {
          const writeId = generateFinWriteId();
          const migratedText = await encryptFinancePayload(payload, key, writeId);
          const writable = await state.fileHandle.createWritable();
          await writable.write(migratedText);
          await writable.close();
          state.lastWriteId = writeId;
          try {
            const f = await state.fileHandle.getFile();
            state.lastKnownModified = Number(f?.lastModified || Date.now());
          } catch (_e) {
            state.lastKnownModified = Date.now();
          }
        }
        if (isAdmin) {
          syncFinanceMetaToMainDb(state.fileName, '');
          if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof writeDBToLinkedFile === 'function') {
            await writeDBToLinkedFile();
          }
        }
        startFinancePolling();
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
        closeFinanceVaultModal();
        toast(`Legacy Finance Vault unlocked & migrated to unified encryption (${state.fileName}).`, 'success');
      } catch (_err) {
        toast('Legacy Password B did not match this file.', 'error');
      }
    });

    bg.querySelector('#ppFinSaveBtn')?.addEventListener('click', async () => {
      const key = getSessionMasterKey();
      if (!key) return toast('Active encryption key required to save.', 'error');
      if (isNonLiveMode()) return toast('Exit Demo/What-If mode before saving the Finance Vault.', 'warning');
      try {
        if (state.fileHandle) {
          const res = await autoSyncFinanceFile({ immediate: true });
          if (res?.ok) {
            if (isAdmin) syncFinanceMetaToMainDb(state.fileName, '');
            closeFinanceVaultModal();
            toast(`Synced separate Finance Vault (${state.fileName}).`, 'success');
          }
          return;
        }
        const curDb = getLiveDbRef();
        const payload = extractFinancialsFromDb(curDb);
        const writeId = generateFinWriteId();
        const encText = await encryptFinancePayload(payload, key, writeId);
        const savedName = await saveEncryptedFinanceFile(encText, false);
        state.lastPayload = cloneFinancePayload(payload);
        state.lastSavedJson = canonicalFinanceJson(payload);
        state.lastWriteId = writeId;
        if (isAdmin) syncFinanceMetaToMainDb(savedName, '');
        startFinancePolling();
        closeFinanceVaultModal();
        toast(`Updated separate Finance Vault (${savedName}).`, 'success');
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        toast(`Save failed: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinLockBtn')?.addEventListener('click', async () => {
      if (typeof ppConfirmAction === 'function') {
        const ok = await ppConfirmAction({
          title: 'Lock Finance Vault & Clear Financials?',
          message: 'Any unsaved financial edits will first be synced to the Finance Vault file, then Day Rates and Project Cost Budgets will be cleared from active memory until unlocked again.',
          confirmLabel: 'Lock & Clear Financials',
          tone: 'danger',
        });
        if (!ok) return;
      }
      try {
        await flushFinanceVaultIfDirty();
        lockFinanceVaultSilently(true);
        if (typeof clearUndoHistory === 'function') clearUndoHistory();
        await writeStrippedMainFileNow();
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
        closeFinanceVaultModal();
        toast('Finance Vault locked and financial figures cleared from active memory & main file.', 'info');
      } catch (err) {
        toast(`Lock/strip error: ${err.message || err}`, 'error');
      }
    });
  }

  async function reencryptFinanceVaultNow(explicitKey, previousKey = '') {
    const key = (typeof explicitKey === 'string' && explicitKey.length >= 8) ? explicitKey : getSessionMasterKey();
    const meta = getMainDbFinanceMeta(getLiveDbRef());
    if (!key) {
      return { unlocked: state.unlocked, reencryptedOnDisk: false, needsManualDownload: false, needsAttention: Boolean(meta.enabled), fileName: state.fileName };
    }
    // If Finance Vault is linked but currently locked, attempt seamless open with previousKey before rotating!
    if (!state.unlocked && (meta.enabled || state.splitMode) && previousKey) {
      await tryAutoOpenFinanceVault({ allowPermissionPrompt: false, silent: true, explicitKey: previousKey });
    }
    if (!state.unlocked) {
      return {
        unlocked: false,
        reencryptedOnDisk: false,
        needsManualDownload: false,
        needsAttention: Boolean(meta.enabled || state.splitMode),
        fileName: meta.fileName || state.fileName,
      };
    }
    const db = getLiveDbRef();
    const payload = extractFinancialsFromDb(db);
    state.lastPayload = cloneFinancePayload(payload);
    state.lastSavedJson = canonicalFinanceJson(payload);
    if (state.fileHandle && typeof state.fileHandle.createWritable === 'function') {
      const writeId = generateFinWriteId();
      const encText = await encryptFinancePayload(payload, key, writeId);
      const writable = await withFinTimeout(state.fileHandle.createWritable(), FIN_IO_TIMEOUT_MS, 'Finance Vault re-encryption timed out');
      await writable.write(encText);
      await writable.close();
      state.lastWriteId = writeId;
      try {
        const f = await state.fileHandle.getFile();
        state.lastKnownModified = Number(f?.lastModified || Date.now());
      } catch (_e) {
        state.lastKnownModified = Date.now();
      }
      return { unlocked: true, reencryptedOnDisk: true, needsManualDownload: false, needsAttention: false, fileName: state.fileName };
    }
    return { unlocked: true, reencryptedOnDisk: false, needsManualDownload: true, needsAttention: true, fileName: state.fileName };
  }

  function getFinanceVaultStatus() {
    const meta = getMainDbFinanceMeta();
    const resolvedName = meta.fileName || state.fileName;
    const resolvedPath = meta.filePath || state.filePath || resolvedName;
    return {
      unlocked: state.unlocked,
      splitMode: state.splitMode || meta.enabled,
      fileName: resolvedName,
      filePath: resolvedPath,
      linkedInMainDb: meta.enabled,
      hasFileHandle: Boolean(state.fileHandle),
      hasDirHandle: Boolean(state.dirHandle),
      hasPendingReconnect: Boolean(!state.unlocked && state.pendingReconnectHandle),
      hasSessionKey: Boolean(getSessionMasterKey()),
      canAccess: canAccessFinance(),
      isPolling: Boolean(state.pollTimer),
      lastError: state.lastError,
    };
  }

  if (typeof renderAll === 'function') {
    const nativeRenderAll = renderAll;
    renderAll = function (...args) {
      const res = nativeRenderAll.apply(this, args);
      updateHeaderPill();
      return res;
    };
  }

  if (typeof window !== 'undefined') {
    window.ppOpenFinanceVaultModal = openFinanceVaultModal;
    window.ppLockFinanceVaultSilently = lockFinanceVaultSilently;
    window.ppGetFinanceVaultStatus = getFinanceVaultStatus;
    window.ppReencryptFinanceVaultNow = reencryptFinanceVaultNow;
    window.ppTryAutoOpenFinanceVault = tryAutoOpenFinanceVault;
    window.ppReconnectFinanceVault = reconnectFinanceVault;
    window.ppOnMainDbSavedForFinance = onMainDbSavedForFinance;
    window.ppOnMainDbReloadedForFinance = onMainDbReloadedForFinance;
    window.ppReapplyFinanceOverlayAfterMainReload = reapplyFinanceOverlayAfterMainReload;
    window.ppGetStrippedCloneForMainSync = getStrippedCloneForMainSync;
    window.ppFlushFinanceVaultIfDirty = flushFinanceVaultIfDirty;
    window.ppResetFinanceVaultForDbSwitch = resetFinanceVaultForDbSwitch;
    window.ppPollFinanceVaultNow = pollFinanceVaultNow;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__ppFinanceVaultTestApi = {
      encryptFinancePayload,
      decryptFinancePayload,
      extractFinancialsFromDb,
      mergeFinancialsIntoDb,
      mergeFinancePayloadsThreeWay,
      stripFinancialsFromDb,
      getStrippedCloneForMainSync,
      getFinanceVaultStatus,
      lockFinanceVaultSilently,
      reencryptFinanceVaultNow,
      getMainDbFinanceMeta,
      syncFinanceMetaToMainDb,
      tryAutoOpenFinanceVault,
      autoSyncFinanceFile,
      pollFinanceVaultNow,
      onMainDbSavedForFinance,
      onMainDbReloadedForFinance,
      reapplyFinanceOverlayAfterMainReload,
      flushFinanceVaultIfDirty,
      resetFinanceVaultForDbSwitch,
      setTestHandles: ({ fileHandle = null, dirHandle = null } = {}) => {
        state.fileHandle = fileHandle;
        state.dirHandle = dirHandle;
        state.pendingReconnectHandle = null;
      },
    };
  }
})();
