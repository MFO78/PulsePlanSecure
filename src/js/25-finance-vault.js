/* Isolated Dual-File Finance Vault: Separate AES-256-GCM encrypted file for Day Rates & Project Costs,
 * encrypted using the unified session Administrator key (unlocked internally by authorized user login) — no second password needed. */
(function ppFinanceVaultModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  const VAULT_VERSION = 3;
  const PBKDF2_ITERS = 250000;
  const SPLIT_FLAG_KEY = 'pulseplan_finance_split_enabled_v1';
  const FIN_LOG_RE = /(€|\$|£|day\s*rate|dayrate|budget\s*cost|budgetcost|cost\s*budget|\brate\b|\bcost\b|\bbudget\b)/i;

  const state = {
    unlocked: false,
    splitMode: loadSplitFlag(),
    fileHandle: null,
    fileName: 'pulseplan-finance.enc.json',
    lastPayload: null,
    autoSaveTimer: null,
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

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { departments: [], projects: [], settings: {} };
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

  async function encryptFinancePayload(payload, password) {
    if (!password || password.length < 6) {
      throw new Error('Active encryption key is required to encrypt the Finance Vault.');
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(password, salt, PBKDF2_ITERS);
    const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
    return JSON.stringify({
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
    }, null, 2);
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

  /* ---------- Exact Financial Schema (dayRate & budgetCost) + ChangeLog Redaction ---------- */
  function extractFinancialsFromDb(db) {
    const deptRates = {};
    (db.departments || []).forEach(d => {
      if (d && d.id && Number(d.dayRate) > 0) {
        deptRates[d.id] = { dayRate: Number(d.dayRate) };
      }
    });

    const projectCosts = {};
    (db.projects || []).forEach(p => {
      if (p && p.id && Number(p.budgetCost) > 0) {
        projectCosts[p.id] = { budgetCost: Number(p.budgetCost) };
      }
    });

    return { deptRates, projectCosts, exportedAt: new Date().toISOString() };
  }

  function mergeFinancialsIntoDb(db, payload) {
    if (!payload || typeof payload !== 'object') return;
    const deptRates = payload.deptRates || {};
    const projectCosts = payload.projectCosts || {};
    (db.departments || []).forEach(d => {
      if (d && d.id && deptRates[d.id] !== undefined) {
        d.dayRate = Number(deptRates[d.id].dayRate) || 0;
      }
    });
    (db.projects || []).forEach(p => {
      if (p && p.id && projectCosts[p.id] !== undefined) {
        p.budgetCost = Number(projectCosts[p.id].budgetCost) || 0;
      }
    });
  }

  function stripFinancialsFromDb(db) {
    (db.departments || []).forEach(d => {
      if (d) d.dayRate = 0;
    });
    (db.projects || []).forEach(p => {
      if (p) p.budgetCost = 0;
    });
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

  /* ---------- Hard Cryptographic Gate: Strip Financials Before Main Encryption ---------- */
  if (typeof encryptPulsePlanData === 'function') {
    const nativeEncryptMain = encryptPulsePlanData;
    encryptPulsePlanData = async function (dbObj, passphrase) {
      if (state.splitMode && dbObj && typeof dbObj === 'object') {
        const cleanClone = JSON.parse(JSON.stringify(dbObj));
        stripFinancialsFromDb(cleanClone);
        if (state.unlocked && canAccessFinance()) scheduleFinanceAutoSync();
        return nativeEncryptMain.call(this, cleanClone, passphrase);
      }
      return nativeEncryptMain.call(this, dbObj, passphrase);
    };
  }

  async function writeStrippedMainFileNow() {
    const db = getDb();
    stripFinancialsFromDb(db);
    if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle) {
      const writable = await linkedFileHandle.createWritable();
      await writable.write(JSON.stringify(db, null, 2));
      await writable.close();
    }
    if (typeof saveLiveDB === 'function') saveLiveDB();
    else if (typeof persistDB === 'function') persistDB();
    else if (typeof saveState === 'function') saveState();
  }

  /* ---------- File I/O + Auto-Sync to Linked Finance File ---------- */
  async function saveEncryptedFinanceFile(encryptedText, pickNewFile) {
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      if (pickNewFile || !state.fileHandle) {
        state.fileHandle = await window.showSaveFilePicker({
          suggestedName: state.fileName || 'pulseplan-finance.enc.json',
          types: [{ description: 'PulsePlan Encrypted Finance Vault', accept: { 'application/json': ['.json'] } }],
        });
        state.fileName = state.fileHandle.name || state.fileName;
      }
      const writable = await state.fileHandle.createWritable();
      await writable.write(encryptedText);
      await writable.close();
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

  async function autoSyncFinanceFile() {
    const masterKey = getSessionMasterKey();
    if (!state.unlocked || !masterKey || !state.fileHandle || !canAccessFinance()) return;
    try {
      const db = getDb();
      const payload = extractFinancialsFromDb(db);
      const encText = await encryptFinancePayload(payload, masterKey);
      const writable = await state.fileHandle.createWritable();
      await writable.write(encText);
      await writable.close();
      state.lastPayload = payload;
    } catch (_e) {}
  }

  function scheduleFinanceAutoSync() {
    if (!state.unlocked || !state.fileHandle || !canAccessFinance()) return;
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(autoSyncFinanceFile, 800);
  }

  async function pickAndReadFinanceFile() {
    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'PulsePlan Encrypted Finance Vault', accept: { 'application/json': ['.json'] } }],
      });
      state.fileHandle = handle;
      state.fileName = handle.name || state.fileName;
      const file = await handle.getFile();
      return typeof ppReadRawFileText === 'function' ? await ppReadRawFileText(file) : await file.text();
    }
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return reject(new Error('No file selected.'));
        state.fileName = f.name;
        const txt = typeof ppReadRawFileText === 'function' ? await ppReadRawFileText(f) : await f.text();
        resolve(txt);
      };
      inp.click();
    });
  }

  function lockFinanceVaultSilently(stripInMemory = true) {
    clearTimeout(state.autoSaveTimer);
    const wasUnlocked = state.unlocked;
    state.unlocked = false;
    state.lastPayload = null;
    state.legacyPendingRaw = null;
    if (stripInMemory && (wasUnlocked || state.splitMode)) {
      const db = getDb();
      if (db) stripFinancialsFromDb(db);
    }
    closeFinanceVaultModal();
    updateHeaderPill();
  }

  /* ---------- UI: Header Pill + Modern Unified Finance Vault Modal ---------- */
  function injectStyles() {
    if (document.getElementById('ppFinVaultStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppFinVaultStyles';
    style.textContent = `
      .pp-fin-pill { display: inline-flex; align-items: center; gap: .35rem; padding: .34rem .72rem; border-radius: 999px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-secondary, #334155); transition: background 140ms ease, border-color 140ms ease; }
      .pp-fin-pill:hover { background: var(--surface-hover, #e2e9f4); }
      .pp-fin-pill.pp-fin-unlocked { border-color: #6ee7b7; background: #ecfdf5; color: #047857; }
      html.dark .pp-fin-pill.pp-fin-unlocked { border-color: rgba(52, 211, 153, .45); background: rgba(16, 185, 129, .14); color: #6ee7b7; }
      .pp-fin-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,.58); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem; }
      .pp-fin-modal { width: 100%; max-width: 500px; border-radius: 1.15rem; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); border: 1px solid var(--border-subtle, #e2e8f0); padding: 1.35rem; box-shadow: 0 24px 56px rgba(15,23,42,.28); }
      .pp-fin-modal h3 { margin: 0; font-size: 15.5px; font-weight: 800; color: var(--text-heading, #0f172a); }
      .pp-fin-banner { margin-top: .85rem; padding: .7rem .85rem; border-radius: .75rem; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11.5px; line-height: 1.5; color: var(--text-secondary, #334155); }
      .pp-fin-banner.pp-fin-ok { border-color: #a7f3d0; background: #ecfdf5; color: #065f46; }
      html.dark .pp-fin-banner.pp-fin-ok { border-color: rgba(52, 211, 153, .35); background: rgba(16, 185, 129, .12); color: #a7f3d0; }
      .pp-fin-banner.pp-fin-warn { border-color: #fde68a; background: #fffbeb; color: #92400e; }
      html.dark .pp-fin-banner.pp-fin-warn { border-color: rgba(251, 191, 36, .35); background: rgba(245, 158, 11, .14); color: #fde68a; }
      .pp-fin-pw-wrap { display: flex; gap: .4rem; align-items: center; margin-top: .35rem; }
      .pp-fin-field { flex: 1; padding: .48rem .7rem; border-radius: .65rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 12.5px; }
      .pp-fin-row { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; padding-top: .85rem; border-top: 1px solid var(--border-subtle, #e2e8f0); }
      .pp-fin-btn { padding: .5rem .85rem; border-radius: .7rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-secondary, #334155); font-size: 12px; font-weight: 700; cursor: pointer; transition: opacity 140ms ease, background 140ms ease; }
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
    const allowed = canAccessFinance();
    if (!allowed) {
      if (btn) btn.style.display = 'none';
      return;
    }
    if (!btn) {
      const header = document.querySelector('header .flex') || document.querySelector('header') || document.body;
      btn = document.createElement('button');
      btn.id = 'ppFinanceVaultBtn';
      btn.type = 'button';
      btn.addEventListener('click', openFinanceVaultModal);
      header.appendChild(btn);
    }
    btn.style.display = '';
    btn.className = `pp-fin-pill ${state.unlocked ? 'pp-fin-unlocked' : ''}`;
    btn.textContent = state.unlocked ? 'Finance Unlocked' : 'Finance Vault';
    btn.title = state.unlocked
      ? `Separate finance DB unlocked & auto-syncing to ${state.fileName}`
      : 'Open or create the separate encrypted Finance Vault file (uses your active session key)';
  }

  function closeFinanceVaultModal() {
    document.getElementById('ppFinVaultModalBg')?.remove();
  }

  function openFinanceVaultModal() {
    if (!canAccessFinance()) {
      toast('Financial data access is restricted by your Administrator.', 'warning');
      return;
    }
    closeFinanceVaultModal();
    injectStyles();
    const masterKey = getSessionMasterKey();
    const isAdmin = typeof ppIsStandardUser !== 'function' || !ppIsStandardUser();
    const db = getDb();
    const finSummary = extractFinancialsFromDb(db);
    const rateCount = Object.keys(finSummary.deptRates).length;
    const costCount = Object.keys(finSummary.projectCosts).length;

    const bg = document.createElement('div');
    bg.id = 'ppFinVaultModalBg';
    bg.className = 'pp-fin-modal-bg';
    bg.innerHTML = `
      <div class="pp-fin-modal" role="dialog" aria-modal="true" aria-label="Separate Finance Vault">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem">
          <div>
            <h3>${state.unlocked ? 'Finance Vault — Unlocked' : 'Separate Finance Database'}</h3>
            <div style="font-size:11.5px;color:var(--text-muted,#64748b);margin-top:.2rem">
              Keeps Department Day Rates &amp; Project Cost Budgets in a separate encrypted file (<code style="font-family:monospace">${esc(state.fileName)}</code>).
            </div>
          </div>
          <button type="button" id="ppFinCloseTopBtn" aria-label="Close Finance Vault" style="border:none;background:transparent;font-size:20px;line-height:1;color:var(--text-muted,#64748b);cursor:pointer;padding:.2rem .4rem">&times;</button>
        </div>

        ${masterKey ? `
          <div class="pp-fin-banner pp-fin-ok">
            <strong>Unified Session Key Active:</strong> Protected automatically with the Administrator AES-256-GCM encryption key — no separate finance password needed.
            ${state.unlocked
              ? `<div style="margin-top:.25rem">Active financial records: <strong>${rateCount}</strong> dept rate${rateCount === 1 ? '' : 's'}, <strong>${costCount}</strong> project cost budget${costCount === 1 ? '' : 's'}.</div>`
              : `<div style="margin-top:.25rem">File stays completely separate from the main roadmap database (${state.splitMode ? 'split mode active' : 'ready to split'}).</div>`}
          </div>
        ` : `
          <div class="pp-fin-banner pp-fin-warn">
            <strong>Administrator Encryption Key Not Active:</strong> Set the workspace Administrator password first so both the main database and the separate Finance Vault encrypt seamlessly with the same master key.
          </div>
        `}

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
                ? `<button type="button" id="ppFinUnlockBtn" class="pp-fin-btn pp-fin-btn-emerald">Open &amp; Unlock Finance File</button>
                   ${isAdmin ? `<button type="button" id="ppFinSplitBtn" class="pp-fin-btn pp-fin-btn-primary">Create Separate File &amp; Strip Main DB</button>` : ''}`
                : `<button type="button" id="ppFinSaveBtn" class="pp-fin-btn pp-fin-btn-primary">Save Finance File Now</button>
                   <button type="button" id="ppFinLockBtn" class="pp-fin-btn pp-fin-btn-rose">Lock &amp; Clear Financials</button>`)}
          <button type="button" id="ppFinCloseBtn" class="pp-fin-btn" style="margin-left:auto">Close</button>
        </div>
      </div>`;

    bg.addEventListener('click', (ev) => { if (ev.target === bg) closeFinanceVaultModal(); });
    document.body.appendChild(bg);

    bg.querySelector('#ppFinCloseTopBtn')?.addEventListener('click', closeFinanceVaultModal);
    bg.querySelector('#ppFinCloseBtn')?.addEventListener('click', closeFinanceVaultModal);

    bg.querySelector('#ppFinSetupKeyBtn')?.addEventListener('click', () => {
      closeFinanceVaultModal();
      if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog();
    });

    bg.querySelector('#ppFinSplitBtn')?.addEventListener('click', async () => {
      const key = getSessionMasterKey();
      if (!key) return toast('Enable Administrator encryption first.', 'warning');
      try {
        const curDb = getDb();
        const payload = extractFinancialsFromDb(curDb);
        const encText = await encryptFinancePayload(payload, key);
        const savedName = await saveEncryptedFinanceFile(encText, true);
        saveSplitFlag(true);
        state.unlocked = true;
        state.lastPayload = payload;
        // Strip financials from the linked main file on disk while keeping them live in memory for the unlocked session
        const cleanClone = JSON.parse(JSON.stringify(curDb));
        stripFinancialsFromDb(cleanClone);
        if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle) {
          const writable = await linkedFileHandle.createWritable();
          await writable.write(JSON.stringify(cleanClone, null, 2));
          await writable.close();
        }
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
        closeFinanceVaultModal();
        toast(`Created separate Finance Vault (${savedName}) and stripped financials from the main database.`, 'success');
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        toast(`Could not create Finance Vault: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinUnlockBtn')?.addEventListener('click', async () => {
      const key = getSessionMasterKey();
      if (!key) return toast('Sign in with an encrypted session first.', 'warning');
      try {
        const raw = await pickAndReadFinanceFile();
        try {
          const payload = await decryptFinancePayload(raw, key);
          const curDb = getDb();
          mergeFinancialsIntoDb(curDb, payload);
          saveSplitFlag(true);
          state.unlocked = true;
          state.lastPayload = payload;
          state.legacyPendingRaw = null;
          if (typeof renderAll === 'function') renderAll();
          updateHeaderPill();
          if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
          closeFinanceVaultModal();
          toast(`Finance Vault unlocked & linked for auto-sync (${state.fileName}).`, 'success');
        } catch (_decErr) {
          // Check if it's a valid pulseplan-finance-vault file encrypted with a legacy Password B
          let parsedEnv = null;
          try { parsedEnv = JSON.parse(raw); } catch (_e) {}
          if (parsedEnv && parsedEnv.type === 'pulseplan-finance-vault') {
            state.legacyPendingRaw = raw;
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
        const curDb = getDb();
        mergeFinancialsIntoDb(curDb, payload);
        saveSplitFlag(true);
        state.unlocked = true;
        state.lastPayload = payload;
        state.legacyPendingRaw = null;
        // Re-encrypt immediately under the unified master key if we have a writable file handle
        if (state.fileHandle && typeof state.fileHandle.createWritable === 'function') {
          const migratedText = await encryptFinancePayload(payload, key);
          const writable = await state.fileHandle.createWritable();
          await writable.write(migratedText);
          await writable.close();
        }
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
      try {
        const curDb = getDb();
        const payload = extractFinancialsFromDb(curDb);
        const encText = await encryptFinancePayload(payload, key);
        const savedName = await saveEncryptedFinanceFile(encText, false);
        state.lastPayload = payload;
        closeFinanceVaultModal();
        toast(`Updated separate Finance Vault (${savedName}).`, 'success');
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        toast(`Save failed: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinLockBtn')?.addEventListener('click', async () => {
      try {
        state.unlocked = false;
        state.lastPayload = null;
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

  function getFinanceVaultStatus() {
    return {
      unlocked: state.unlocked,
      splitMode: state.splitMode,
      fileName: state.fileName,
      hasFileHandle: Boolean(state.fileHandle),
      hasSessionKey: Boolean(getSessionMasterKey()),
      canAccess: canAccessFinance(),
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
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__ppFinanceVaultTestApi = {
      encryptFinancePayload,
      decryptFinancePayload,
      extractFinancialsFromDb,
      mergeFinancialsIntoDb,
      stripFinancialsFromDb,
      getFinanceVaultStatus,
      lockFinanceVaultSilently,
    };
  }
})();
