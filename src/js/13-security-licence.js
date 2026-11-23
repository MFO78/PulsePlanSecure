    /* ============================================================================
     * 13. PULSEPLANSECURE: MANUAL SECURITY SECTION, AES-256-GCM DB ENCRYPTION & USER LICENCE
     * ============================================================================ */

    if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
      MANUAL_SECTIONS.push({
        id: 'security',
        title: 'Security, Database Encryption & User Licence',
        badge: 'Security',
        keywords: 'security sri sha384 encryption aes gcm pbkdf2 password passphrase ppenc licence license privacy cors referrer pwa cache ci',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Hardened Architecture (PulsePlanSecure vs. Standard)</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Tamper-Proof CDN Scripts (SRI):</strong> External PDF libraries (<code class="px-1 rounded bg-white font-mono">jsPDF</code> and <code class="px-1 rounded bg-white font-mono">jsPDF-AutoTable</code>) are cryptographically verified by the browser against SHA-384 Subresource Integrity hashes before execution, blocking compromised CDN code from accessing roadmap data or local files.</li>
                <li>&bull; <strong>Privacy &amp; CORS Isolation:</strong> External scripts load with <code class="px-1 rounded bg-white font-mono">crossorigin="anonymous"</code> and <code class="px-1 rounded bg-white font-mono">referrerpolicy="no-referrer"</code> so no credentials or page URLs leak to third-party servers.</li>
                <li>&bull; <strong>Halved PWA Cache &amp; HTML5 Cleanup:</strong> The Service Worker caches a single canonical <code class="px-1 rounded bg-white font-mono">./index.html</code> app shell instead of two duplicate 1.1 MB copies, aligns <code class="px-1 rounded bg-white font-mono">manifest.webmanifest</code> theme colour, and removes obsolete HTML4 link tags.</li>
                <li>&bull; <strong>Automated CI/CD Verification:</strong> GitHub Actions automatically verifies SRI hashes, rebuilds <code class="px-1 rounded bg-white font-mono">index.html</code>, runs the full test suite, and deploys to GitHub Pages on every push.</li>
              </ul>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">AES-256-GCM Encrypted Database (.ppenc)</div>
              <p class="text-slate-600 leading-relaxed">
                Open <strong>Appearance &amp; Help &rarr; Encrypted DB (.ppenc)</strong> in the top-right menu to export or import an authenticated, encrypted copy of your database.
                Encryption runs 100% locally in your browser using the native <strong>Web Crypto API</strong> (<strong>PBKDF2-SHA-256</strong> with 250,000 iterations, random 128-bit salt, random 96-bit IV, and <strong>AES-256-GCM</strong>). Your passphrase never leaves your device; if lost, encrypted files cannot be recovered.
              </p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">User Licence</div>
              <p class="text-slate-600 leading-relaxed">
                View the full software licence and data-privacy terms anytime via <strong>Appearance &amp; Help &rarr; User Licence</strong> in the workspace menu.
              </p>
            </div>
          </div>`,
      });
    }

    const PP_ENC_FORMAT = 'pulseplan-encrypted-v1';
    const PP_PBKDF2_ITERATIONS = 250000;

    function ppBytesToBase64(bytes) {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }

    function ppBase64ToBytes(b64) {
      const binary = atob(b64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }

    async function ppDeriveAesKey(passphrase, saltBytes) {
      const enc = new TextEncoder();
      const baseKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: PP_PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }

    async function encryptPulsePlanData(dbObj, passphrase) {
      if (!passphrase || passphrase.length < 8) {
        throw new Error('Passphrase must be at least 8 characters long.');
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await ppDeriveAesKey(passphrase, salt);
      const plaintext = new TextEncoder().encode(JSON.stringify(dbObj));
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
      return {
        format: PP_ENC_FORMAT,
        kdf: 'PBKDF2-SHA256',
        iterations: PP_PBKDF2_ITERATIONS,
        cipher: 'AES-256-GCM',
        createdAt: new Date().toISOString(),
        salt: ppBytesToBase64(salt),
        iv: ppBytesToBase64(iv),
        ciphertext: ppBytesToBase64(new Uint8Array(cipherBuf)),
      };
    }

    async function decryptPulsePlanData(envelope, passphrase) {
      if (!envelope || envelope.format !== PP_ENC_FORMAT || !envelope.salt || !envelope.iv || !envelope.ciphertext) {
        throw new Error('Invalid or unsupported encrypted database file.');
      }
      if (!passphrase) {
        throw new Error('Please enter the passphrase to decrypt this file.');
      }
      const salt = ppBase64ToBytes(envelope.salt);
      const iv = ppBase64ToBytes(envelope.iv);
      const ciphertext = ppBase64ToBytes(envelope.ciphertext);
      const key = await ppDeriveAesKey(passphrase, salt);
      try {
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return JSON.parse(new TextDecoder().decode(plainBuf));
      } catch (_err) {
        throw new Error('Decryption failed. Check your passphrase or verify the file has not been altered.');
      }
    }

    function ppGetCurrentDbRef() {
      if (typeof getActiveDB === 'function') return getActiveDB();
      if (typeof ui !== 'undefined' && ui.whatIfMode && typeof whatIfDB !== 'undefined' && whatIfDB) return whatIfDB;
      if (typeof ui !== 'undefined' && ui.demoMode && typeof demoDB !== 'undefined' && demoDB) return demoDB;
      if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
      return null;
    }

    function openEncryptDialog() {
      const dlg = document.getElementById('ppEncryptDialog');
      if (!dlg) return;
      const statusEl = document.getElementById('ppEncryptStatus');
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'text-xs hidden rounded-lg px-3 py-2';
      }
      const passEl = document.getElementById('ppEncryptPassphrase');
      if (passEl) passEl.value = '';
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', 'open');
    }

    function openLicenceDialog() {
      const dlg = document.getElementById('ppLicenceDialog');
      if (!dlg) return;
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', 'open');
    }

    function setEncryptStatus(msg, isError) {
      const el = document.getElementById('ppEncryptStatus');
      if (!el) return;
      el.textContent = msg;
      el.className = isError
        ? 'text-xs rounded-lg px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200'
        : 'text-xs rounded-lg px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200';
    }

    async function handleEncryptedExport() {
      const pass = (document.getElementById('ppEncryptPassphrase')?.value || '').trim();
      const dbObj = ppGetCurrentDbRef();
      if (!dbObj) {
        setEncryptStatus('No active database found to encrypt.', true);
        return;
      }
      try {
        setEncryptStatus('Encrypting with AES-256-GCM (PBKDF2 250k iterations)...', false);
        const envelope = await encryptPulsePlanData(dbObj, pass);
        const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pulseplan_encrypted_${new Date().toISOString().slice(0, 10)}.ppenc`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setEncryptStatus('Encrypted database downloaded (.ppenc). Store your passphrase safely.', false);
      } catch (err) {
        setEncryptStatus(err.message || 'Encryption failed.', true);
      }
    }

    async function handleEncryptedImport() {
      const pass = (document.getElementById('ppEncryptPassphrase')?.value || '').trim();
      const fileInput = document.getElementById('ppEncryptFileInput');
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (!file) {
        setEncryptStatus('Select a .ppenc file to decrypt and import.', true);
        return;
      }
      try {
        setEncryptStatus('Decrypting and verifying integrity...', false);
        const text = await file.text();
        const envelope = JSON.parse(text);
        const decrypted = await decryptPulsePlanData(envelope, pass);
        const migrated = typeof normalizeAndMigrateDB === 'function' ? normalizeAndMigrateDB(decrypted) : decrypted;
        if (!migrated) {
          setEncryptStatus('Decrypted file is not a valid PulsePlan database.', true);
          return;
        }
        if (typeof ui !== 'undefined' && ui.demoMode && typeof demoDB !== 'undefined') {
          demoDB = migrated;
        } else if (typeof liveDB !== 'undefined') {
          liveDB = migrated;
        }
        if (typeof persistAll === 'function') persistAll();
        else if (typeof saveState === 'function') saveState();
        if (typeof renderAll === 'function') renderAll();
        setEncryptStatus('Encrypted database decrypted and loaded successfully.', false);
      } catch (err) {
        setEncryptStatus(err.message || 'Decryption failed.', true);
      }
    }

    function initSecurityAndLicenceUI() {
      if (typeof document === 'undefined') return;
      const manualBtn = document.getElementById('manualBtn');
      if (manualBtn && manualBtn.parentElement && !document.getElementById('ppEncryptMenuBtn')) {
        const encBtn = document.createElement('button');
        encBtn.id = 'ppEncryptMenuBtn';
        encBtn.type = 'button';
        encBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-700 font-semibold transition cursor-pointer';
        encBtn.innerHTML = `
          <span class="flex items-center gap-2">
            <svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span>Encrypted DB (.ppenc)</span>
          </span>
          <span class="text-[10px] font-bold text-emerald-600">AES-256</span>`;
        encBtn.addEventListener('click', () => {
          if (typeof closeHeaderWorkspaceMenu === 'function') closeHeaderWorkspaceMenu();
          openEncryptDialog();
        });

        const licBtn = document.createElement('button');
        licBtn.id = 'ppLicenceMenuBtn';
        licBtn.type = 'button';
        licBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 font-semibold transition cursor-pointer';
        licBtn.innerHTML = `
          <span class="flex items-center gap-2">
            <svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span>User Licence</span>
          </span>
          <span class="text-[10px] text-slate-400">MIT</span>`;
        licBtn.addEventListener('click', () => {
          if (typeof closeHeaderWorkspaceMenu === 'function') closeHeaderWorkspaceMenu();
          openLicenceDialog();
        });

        manualBtn.parentElement.appendChild(encBtn);
        manualBtn.parentElement.appendChild(licBtn);
      }

      if (!document.getElementById('ppEncryptDialog')) {
        const encDialog = document.createElement('dialog');
        encDialog.id = 'ppEncryptDialog';
        encDialog.setAttribute('aria-labelledby', 'ppEncryptDialogTitle');
        encDialog.className = 'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 w-full max-w-md backdrop:bg-slate-900/50';
        encDialog.innerHTML = `
          <div class="p-5 space-y-4 text-xs">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 id="ppEncryptDialogTitle" class="text-base font-extrabold text-slate-900">Encrypted Database (.ppenc)</h2>
                <p class="text-[11px] text-slate-500 mt-0.5">Local AES-256-GCM encryption via Web Crypto API (PBKDF2-SHA-256, 250,000 iterations).</p>
              </div>
              <button type="button" id="ppEncryptCloseBtn" aria-label="Close encrypted database dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
            </header>
            <div class="space-y-2">
              <label for="ppEncryptPassphrase" class="block font-semibold text-slate-700">Passphrase (minimum 8 characters)</label>
              <input id="ppEncryptPassphrase" type="password" autocomplete="new-password" placeholder="Enter strong passphrase..." class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900" />
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" id="ppEncryptExportBtn" class="flex-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition cursor-pointer">Encrypt &amp; Download (.ppenc)</button>
            </div>
            <hr class="border-slate-200" />
            <div class="space-y-2">
              <label for="ppEncryptFileInput" class="block font-semibold text-slate-700">Decrypt &amp; Import existing .ppenc file</label>
              <input id="ppEncryptFileInput" type="file" accept=".ppenc,application/json" class="w-full text-xs text-slate-600" />
              <button type="button" id="ppEncryptImportBtn" class="w-full px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition cursor-pointer">Decrypt &amp; Load Database</button>
            </div>
            <div id="ppEncryptStatus" role="status" class="hidden text-xs rounded-lg px-3 py-2"></div>
          </div>`;
        document.body.appendChild(encDialog);
        document.getElementById('ppEncryptCloseBtn')?.addEventListener('click', () => encDialog.close());
        document.getElementById('ppEncryptExportBtn')?.addEventListener('click', handleEncryptedExport);
        document.getElementById('ppEncryptImportBtn')?.addEventListener('click', handleEncryptedImport);
      }

      if (!document.getElementById('ppLicenceDialog')) {
        const licDialog = document.createElement('dialog');
        licDialog.id = 'ppLicenceDialog';
        licDialog.setAttribute('aria-labelledby', 'ppLicenceDialogTitle');
        licDialog.className = 'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 w-full max-w-lg backdrop:bg-slate-900/50';
        licDialog.innerHTML = `
          <div class="p-5 space-y-4 text-xs">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 id="ppLicenceDialogTitle" class="text-base font-extrabold text-slate-900">PulsePlanSecure User Licence</h2>
                <p class="text-[11px] text-slate-500 mt-0.5">MIT Licence &amp; Local-First Privacy Notice</p>
              </div>
              <button type="button" id="ppLicenceCloseBtn" aria-label="Close user licence dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
            </header>
            <section class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-slate-700 leading-relaxed max-h-[55dvh] overflow-y-auto">
              <p><strong>Copyright (c) 2026 MFO78</strong></p>
              <p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
              <p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
              <p class="uppercase text-[11px] text-slate-600">THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p>
              <p><strong>Data Privacy:</strong> PulsePlanSecure processes and encrypts all planning data locally in your browser. No roadmap data or encryption passphrases are transmitted to external servers.</p>
            </section>
            <footer class="flex justify-end">
              <button type="button" id="ppLicenceDoneBtn" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition cursor-pointer">Close</button>
            </footer>
          </div>`;
        document.body.appendChild(licDialog);
        document.getElementById('ppLicenceCloseBtn')?.addEventListener('click', () => licDialog.close());
        document.getElementById('ppLicenceDoneBtn')?.addEventListener('click', () => licDialog.close());
      }
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSecurityAndLicenceUI);
      } else {
        initSecurityAndLicenceUI();
      }
    }
