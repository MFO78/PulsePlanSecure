/* Isolated Dual-File Finance Vault: Separate AES-256-GCM encrypted file (Password B) for Day Rates & Project Costs with auto-sync & strict main-DB stripping. */
(function ppFinanceVaultModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  const VAULT_VERSION = 1;
  const PBKDF2_ITERS = 250000;
  const FINANCE_PROJECT_KEYS = ['budget', 'cost', 'fixedCost', 'actualCost', 'targetCost', 'capex', 'opex'];
  const SPLIT_FLAG_KEY = 'pulseplan_finance_split_enabled_v1';

  const state = {
    unlocked: false,
    splitMode: loadSplitFlag(),
    fileHandle: null,
    fileName: 'pulseplan-finance.enc.json',
    password: '',
    lastPayload: null,
    autoSaveTimer: null,
  };

  function loadSplitFlag() {
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(SPLIT_FLAG_KEY) : localStorage.getItem(SPLIT_FLAG_KEY);
      return raw === '1';
    } catch (_e) {
      return false;
    }
  }

  function saveSplitFlag(val) {
    state.splitMode = !!val;
    try {
      const s = state.splitMode ? '1' : '0';
      if (typeof safeSetStorage === 'function') safeSetStorage(SPLIT_FLAG_KEY, s);
      else localStorage.setItem(SPLIT_FLAG_KEY, s);
    } catch (_e) {}
  }

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { departments: [], projects: [] };
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

  function persistMainDbClean() {
    const db = getDb();
    const backup = state.unlocked ? extractFinancialsFromDb(db) : null;
    stripFinancialsFromDb(db);
    if (typeof persistActiveDB === 'function') persistActiveDB();
    else if (typeof saveLocalState === 'function') saveLocalState();
    if (typeof nativeScheduleAutoSave === 'function') nativeScheduleAutoSave();
    else if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (backup && state.unlocked) {
      mergeFinancialsIntoDb(db, backup);
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

  async function deriveAesKey(password, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptFinancePayload(payload, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(password, salt);
    const plainBytes = new TextEncoder().encode(JSON.stringify(payload));
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes);
    return JSON.stringify({
      type: 'pulseplan-finance-vault',
      version: VAULT_VERSION,
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
    const key = await deriveAesKey(password, salt);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  /* ---------- Extract / Merge / Strip Financial Fields ---------- */
  function extractFinancialsFromDb(db) {
    const deptRates = {};
    (db.departments || []).forEach(d => {
      if (!d || !d.id) return;
      if (d.dayRate !== undefined && d.dayRate !== null && d.dayRate !== '') {
        deptRates[d.id] = { dayRate: Number(d.dayRate) || 0 };
      }
    });

    const projectCosts = {};
    (db.projects || []).forEach(p => {
      if (!p || !p.id) return;
      const entry = {};
      FINANCE_PROJECT_KEYS.forEach(k => {
        if (p[k] !== undefined && p[k] !== null && p[k] !== '') entry[k] = p[k];
      });
      if (Object.keys(entry).length > 0) projectCosts[p.id] = entry;
    });

    return { deptRates, projectCosts, exportedAt: new Date().toISOString() };
  }

  function mergeFinancialsIntoDb(db, payload) {
    if (!payload || typeof payload !== 'object') return;
    const deptRates = payload.deptRates || {};
    const projectCosts = payload.projectCosts || {};
    (db.departments || []).forEach(d => {
      if (d && d.id && deptRates[d.id]) d.dayRate = deptRates[d.id].dayRate;
    });
    (db.projects || []).forEach(p => {
      if (p && p.id && projectCosts[p.id]) Object.assign(p, projectCosts[p.id]);
    });
  }

  function stripFinancialsFromDb(db) {
    (db.departments || []).forEach(d => {
      if (d) d.dayRate = 0;
    });
    (db.projects || []).forEach(p => {
      if (!p) return;
      FINANCE_PROJECT_KEYS.forEach(k => {
        if (k in p) p[k] = 0;
      });
    });
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
    if (!state.unlocked || !state.password || !state.fileHandle) return;
    try {
      const db = getDb();
      const payload = extractFinancialsFromDb(db);
      const encText = await encryptFinancePayload(payload, state.password);
      const writable = await state.fileHandle.createWritable();
      await writable.write(encText);
      await writable.close();
      state.lastPayload = payload;
    } catch (_e) {
      // Silent fallback if browser requires user gesture for file handle write
    }
  }

  function scheduleFinanceAutoSync() {
    if (!state.unlocked || !state.fileHandle) return;
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
      return await file.text();
    }
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return reject(new Error('No file selected.'));
        state.fileName = f.name;
        resolve(await f.text());
      };
      inp.click();
    });
  }

  /* ---------- Intercept Main DB Auto-Save so Financials NEVER Leak to Main File ---------- */
  const nativeScheduleAutoSave = typeof scheduleAutoSave === 'function' ? scheduleAutoSave : null;
  if (nativeScheduleAutoSave) {
    scheduleAutoSave = function (...args) {
      if (state.splitMode) {
        scheduleFinanceAutoSync();
        const db = getDb();
        const backup = state.unlocked ? extractFinancialsFromDb(db) : null;
        stripFinancialsFromDb(db);
        const res = nativeScheduleAutoSave.apply(this, args);
        if (backup && state.unlocked) {
          setTimeout(() => mergeFinancialsIntoDb(db, backup), 50);
        }
        return res;
      }
      return nativeScheduleAutoSave.apply(this, args);
    };
  }

  /* ---------- UI: Header Pill + Finance Vault Modal ---------- */
  function injectStyles() {
    if (document.getElementById('ppFinVaultStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppFinVaultStyles';
    style.textContent = `
      .pp-fin-pill { display: inline-flex; align-items: center; gap: .35rem; padding: .32rem .68rem; border-radius: 999px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; }
      .pp-fin-pill.pp-fin-unlocked { border-color: #6ee7b7; background: #ecfdf5; color: #047857; }
      .pp-fin-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,.55); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem; }
      .pp-fin-modal { width: 100%; max-width: 480px; border-radius: 1rem; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); border: 1px solid var(--border-subtle, #e2e8f0); padding: 1.25rem; box-shadow: 0 20px 50px rgba(0,0,0,.25); }
      .pp-fin-modal h3 { margin: 0 0 .35rem; font-size: 15px; font-weight: 800; }
      .pp-fin-field { width: 100%; padding: .48rem .7rem; border-radius: .6rem; border: 1px solid #cbd5e1; background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 12.5px; margin-top: .35rem; }
      .pp-fin-row { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .85rem; }
      .pp-fin-btn { padding: .45rem .8rem; border-radius: .6rem; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; font-size: 12px; font-weight: 700; cursor: pointer; }
      .pp-fin-btn-primary { border-color: #4f46e5; background: #4f46e5; color: #ffffff; }
      .pp-fin-btn-emerald { border-color: #059669; background: #059669; color: #ffffff; }
      .pp-fin-btn-rose { border-color: #e11d48; background: #fff1f2; color: #be123c; }
    `;
    document.head.appendChild(style);
  }

  function updateHeaderPill() {
    injectStyles();
    let btn = document.getElementById('ppFinanceVaultBtn');
    if (!btn) {
      const header = document.querySelector('header .flex') || document.querySelector('header') || document.body;
      btn = document.createElement('button');
      btn.id = 'ppFinanceVaultBtn';
      btn.type = 'button';
      btn.addEventListener('click', openFinanceVaultModal);
      header.appendChild(btn);
    }
    btn.className = `pp-fin-pill ${state.unlocked ? 'pp-fin-unlocked' : ''}`;
    btn.textContent = state.unlocked ? '🔓 Finance Unlocked (Auto-Sync)' : '🔒 Finance Vault';
    btn.title = state.unlocked
      ? `Unlocked & auto-syncing to ${state.fileName} — click to save or lock`
      : 'Unlock or create a separate encrypted Finance Vault file (Password B)';
  }

  function closeFinanceVaultModal() {
    document.getElementById('ppFinVaultModalBg')?.remove();
  }

  function openFinanceVaultModal() {
    closeFinanceVaultModal();
    injectStyles();
    const bg = document.createElement('div');
    bg.id = 'ppFinVaultModalBg';
    bg.className = 'pp-fin-modal-bg';
    bg.innerHTML = `
      <div class="pp-fin-modal" role="dialog" aria-modal="true" aria-label="Finance Vault">
        <h3>${state.unlocked ? '🔓 Finance Vault (Unlocked & Auto-Syncing)' : '🔒 Dual-File Finance Vault'}</h3>
        <div style="font-size:12px;color:var(--text-muted,#64748b);line-height:1.45">
          Stores <strong>Department Day Rates</strong> and <strong>Project Costs/Budgets</strong> in <code>${esc(state.fileName)}</code> (AES-256-GCM, <strong>Password B</strong>) and strips them from the main synced database (<strong>Password A</strong>).
        </div>
        <div style="margin-top:.8rem">
          <label style="font-size:11.5px;font-weight:700" for="ppFinPasswordInput">Finance Password (Password B)</label>
          <input id="ppFinPasswordInput" type="password" class="pp-fin-field" placeholder="Enter Finance Password B..." autocomplete="off" />
        </div>
        <div class="pp-fin-row">
          ${!state.unlocked
            ? `<button type="button" id="ppFinUnlockBtn" class="pp-fin-btn pp-fin-btn-emerald">Open &amp; Unlock Finance File</button>
               <button type="button" id="ppFinSplitBtn" class="pp-fin-btn pp-fin-btn-primary">Create, Split &amp; Strip Main DB</button>`
            : `<button type="button" id="ppFinSaveBtn" class="pp-fin-btn pp-fin-btn-primary">Save Finance File Now</button>
               <button type="button" id="ppFinLockBtn" class="pp-fin-btn pp-fin-btn-rose">Lock &amp; Strip Financials Now</button>`}
          <button type="button" id="ppFinCloseBtn" class="pp-fin-btn">Close</button>
        </div>
      </div>`;

    bg.addEventListener('click', (ev) => { if (ev.target === bg) closeFinanceVaultModal(); });
    document.body.appendChild(bg);

    bg.querySelector('#ppFinCloseBtn')?.addEventListener('click', closeFinanceVaultModal);

    bg.querySelector('#ppFinSplitBtn')?.addEventListener('click', async () => {
      const pw = (bg.querySelector('#ppFinPasswordInput')?.value || '').trim();
      if (pw.length < 6) return toast('Enter a Finance Password of at least 6 characters.', 'error');
      try {
        const db = getDb();
        const payload = extractFinancialsFromDb(db);
        const encText = await encryptFinancePayload(payload, pw);
        const savedName = await saveEncryptedFinanceFile(encText, true);
        saveSplitFlag(true);
        state.unlocked = true;
        state.password = pw;
        state.lastPayload = payload;
        persistMainDbClean();
        updateHeaderPill();
        closeFinanceVaultModal();
        toast(`Saved ${savedName} & stripped financials from the main synced database.`, 'success');
      } catch (err) {
        toast(`Could not create Finance Vault: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinUnlockBtn')?.addEventListener('click', async () => {
      const pw = (bg.querySelector('#ppFinPasswordInput')?.value || '').trim();
      if (!pw) return toast('Enter Finance Password B.', 'error');
      try {
        const raw = await pickAndReadFinanceFile();
        const payload = await decryptFinancePayload(raw, pw);
        const db = getDb();
        mergeFinancialsIntoDb(db, payload);
        saveSplitFlag(true);
        state.unlocked = true;
        state.password = pw;
        state.lastPayload = payload;
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        closeFinanceVaultModal();
        toast(`Finance Vault unlocked & linked for auto-sync (${state.fileName}).`, 'success');
      } catch (_err) {
        toast('Decryption failed. Check Finance Password B and file.', 'error');
      }
    });

    bg.querySelector('#ppFinSaveBtn')?.addEventListener('click', async () => {
      const pw = (bg.querySelector('#ppFinPasswordInput')?.value || '').trim() || state.password;
      if (!pw) return toast('Enter Finance Password B to save.', 'error');
      try {
        const db = getDb();
        const payload = extractFinancialsFromDb(db);
        const encText = await encryptFinancePayload(payload, pw);
        const savedName = await saveEncryptedFinanceFile(encText, false);
        state.password = pw;
        state.lastPayload = payload;
        closeFinanceVaultModal();
        toast(`Updated Finance Vault (${savedName}).`, 'success');
      } catch (err) {
        toast(`Save failed: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinLockBtn')?.addEventListener('click', () => {
      state.unlocked = false;
      state.password = '';
      state.lastPayload = null;
      persistMainDbClean();
      if (typeof renderAll === 'function') renderAll();
      updateHeaderPill();
      closeFinanceVaultModal();
      toast('Financials locked, cleared from memory, and stripped from main synced DB.', 'info');
    });
  }

  if (typeof renderAll === 'function') {
    const nativeRenderAll = renderAll;
    renderAll = function (...args) {
      const res = nativeRenderAll.apply(this, args);
      updateHeaderPill();
      return res;
    };
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__ppFinanceVaultTestApi = {
      encryptFinancePayload,
      decryptFinancePayload,
      extractFinancialsFromDb,
      mergeFinancialsIntoDb,
      stripFinancialsFromDb,
    };
  }
})();
