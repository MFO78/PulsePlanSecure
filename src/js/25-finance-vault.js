/* Isolated Dual-File Finance Vault: Separate AES-256-GCM encrypted file (Password B) for Day Rates & Project Costs. */
(function ppFinanceVaultModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  const VAULT_VERSION = 2;
  const PBKDF2_ITERS = 250000;
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

  /* ---------- Exact Financial Schema (dayRate & budgetCost) ---------- */
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
  }

  /* ---------- Hard Cryptographic Gate: Strip Before Main Password-A Encryption ---------- */
  if (typeof encryptPulsePlanData === 'function') {
    const nativeEncryptMain = encryptPulsePlanData;
    encryptPulsePlanData = async function (dbObj, passphrase) {
      if (state.splitMode && dbObj && typeof dbObj === 'object') {
        const cleanClone = JSON.parse(JSON.stringify(dbObj));
        stripFinancialsFromDb(cleanClone);
        if (state.unlocked) scheduleFinanceAutoSync();
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
    if (!state.unlocked || !state.password || !state.fileHandle) return;
    try {
      const db = getDb();
      const payload = extractFinancialsFromDb(db);
      const encText = await encryptFinancePayload(payload, state.password);
      const writable = await state.fileHandle.createWritable();
      await writable.write(encText);
      await writable.close();
      state.lastPayload = payload;
    } catch (_e) {}
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

  /* ---------- UI: Header Pill + Finance Vault Modal (with Repeat Password & Show/Hide) ---------- */
  function injectStyles() {
    if (document.getElementById('ppFinVaultStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppFinVaultStyles';
    style.textContent = `
      .pp-fin-pill { display: inline-flex; align-items: center; gap: .35rem; padding: .32rem .68rem; border-radius: 999px; font-size: 11px; font-weight: 700; cursor: pointer; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; }
      .pp-fin-pill.pp-fin-unlocked { border-color: #6ee7b7; background: #ecfdf5; color: #047857; }
      .pp-fin-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,.55); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem; }
      .pp-fin-modal { width: 100%; max-width: 500px; border-radius: 1rem; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); border: 1px solid var(--border-subtle, #e2e8f0); padding: 1.25rem; box-shadow: 0 20px 50px rgba(0,0,0,.25); }
      .pp-fin-modal h3 { margin: 0 0 .35rem; font-size: 15px; font-weight: 800; }
      .pp-fin-pw-wrap { display: flex; gap: .4rem; align-items: center; margin-top: .35rem; }
      .pp-fin-field { flex: 1; padding: .48rem .7rem; border-radius: .6rem; border: 1px solid #cbd5e1; background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 12.5px; }
      .pp-fin-eye { padding: .45rem .65rem; border-radius: .6rem; border: 1px solid #cbd5e1; background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #334155); font-size: 11.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
      .pp-fin-row { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .95rem; }
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
    btn.textContent = state.unlocked ? '🔓 Finance Unlocked' : '🔒 Finance Vault';
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
        <h3>${state.unlocked ? '🔓 Finance Vault (Unlocked)' : '🔒 Dual-File Finance Vault'}</h3>
        <div style="font-size:12px;color:var(--text-muted,#64748b);line-height:1.45">
          Stores <strong>Department Day Rates</strong> (<code>dayRate</code>) and <strong>Project Cost Budgets</strong> (<code>budgetCost</code>) in <code>${esc(state.fileName)}</code> (AES-256-GCM, <strong>Password B</strong>) and strips them from the main synced database (<strong>Password A</strong>).
        </div>
        <div style="margin-top:.8rem">
          <label style="font-size:11.5px;font-weight:700" for="ppFinPasswordInput">Finance Password (Password B)</label>
          <div class="pp-fin-pw-wrap">
            <input id="ppFinPasswordInput" type="password" class="pp-fin-field" placeholder="Enter Finance Password B..." autocomplete="off" />
            <button type="button" id="ppFinTogglePwBtn" class="pp-fin-eye" aria-label="Show or hide password">Show</button>
          </div>
        </div>
        ${!state.unlocked ? `
        <div style="margin-top:.65rem">
          <label style="font-size:11.5px;font-weight:700" for="ppFinPasswordConfirm">Repeat Password B (required when creating a new Finance File)</label>
          <div class="pp-fin-pw-wrap">
            <input id="ppFinPasswordConfirm" type="password" class="pp-fin-field" placeholder="Repeat Finance Password B..." autocomplete="off" />
          </div>
        </div>` : ''}
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

    const pwInput = bg.querySelector('#ppFinPasswordInput');
    const pwConfirm = bg.querySelector('#ppFinPasswordConfirm');
    const toggleBtn = bg.querySelector('#ppFinTogglePwBtn');

    toggleBtn?.addEventListener('click', () => {
      const showing = pwInput.type === 'text';
      pwInput.type = showing ? 'password' : 'text';
      if (pwConfirm) pwConfirm.type = showing ? 'password' : 'text';
      toggleBtn.textContent = showing ? 'Show' : 'Hide';
    });

    bg.querySelector('#ppFinCloseBtn')?.addEventListener('click', closeFinanceVaultModal);

    bg.querySelector('#ppFinSplitBtn')?.addEventListener('click', async () => {
      const pw = (pwInput?.value || '').trim();
      const pw2 = (pwConfirm?.value || '').trim();
      if (pw.length < 6) return toast('Enter a Finance Password of at least 6 characters.', 'error');
      if (pw !== pw2) return toast('Passwords do not match. Please repeat Password B carefully.', 'error');
      try {
        const db = getDb();
        const payload = extractFinancialsFromDb(db);
        const encText = await encryptFinancePayload(payload, pw);
        const savedName = await saveEncryptedFinanceFile(encText, true);
        saveSplitFlag(true);
        state.unlocked = false;
        state.password = '';
        state.lastPayload = null;
        await writeStrippedMainFileNow();
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        closeFinanceVaultModal();
        toast(`Saved ${savedName} & directly wrote stripped main database (0 day rates / 0 cost budgets).`, 'success');
      } catch (err) {
        toast(`Could not create Finance Vault: ${err.message || err}`, 'error');
      }
    });

    bg.querySelector('#ppFinUnlockBtn')?.addEventListener('click', async () => {
      const pw = (pwInput?.value || '').trim();
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
      const pw = (pwInput?.value || '').trim() || state.password;
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

    bg.querySelector('#ppFinLockBtn')?.addEventListener('click', async () => {
      try {
        state.unlocked = false;
        state.password = '';
        state.lastPayload = null;
        await writeStrippedMainFileNow();
        if (typeof renderAll === 'function') renderAll();
        updateHeaderPill();
        closeFinanceVaultModal();
        toast('Financials locked and stripped directly from the main synced file.', 'info');
      } catch (err) {
        toast(`Lock/strip error: ${err.message || err}`, 'error');
      }
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
