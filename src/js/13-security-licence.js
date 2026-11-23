    /* ============================================================================
     * 13. PULSEPLANSECURE: TRANSPARENT SYNC & SHARE JSON ENCRYPTION (AES-256-GCM),
     *     PASS-STRENGTH METER, INACTIVITY LOCK, BUILD REVISION TRACKER & LICENCE
     * ============================================================================ */

    const PP_BUILD_INFO = {
      version: 'v8.4-secure',
      sha: '__PP_BUILD_SHA__',
      builtAt: '__PP_BUILD_DATE__',
    };

    if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
      MANUAL_SECTIONS.push({
        id: 'security',
        title: 'Security, Sync JSON Encryption & User Licence',
        badge: 'Security',
        keywords: 'security sri sha384 encryption aes gcm pbkdf2 password passphrase timeout lock json sync share backup revision version licence license privacy cors referrer pwa cache ci',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Hardened Architecture (PulsePlanSecure ${PP_BUILD_INFO.version})</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Tamper-Proof CDN Scripts (SRI):</strong> External PDF libraries (<code class="px-1 rounded bg-white font-mono">jsPDF</code> and <code class="px-1 rounded bg-white font-mono">jsPDF-AutoTable</code>) are cryptographically verified by the browser against SHA-384 Subresource Integrity hashes before execution, blocking compromised CDN code from accessing roadmap data or local files.</li>
                <li>&bull; <strong>Privacy &amp; CORS Isolation:</strong> External scripts load with <code class="px-1 rounded bg-white font-mono">crossorigin="anonymous"</code> and <code class="px-1 rounded bg-white font-mono">referrerpolicy="no-referrer"</code> so no credentials or page URLs leak to third-party servers.</li>
                <li>&bull; <strong>Halved PWA Cache &amp; HTML5 Cleanup:</strong> The Service Worker caches a single canonical <code class="px-1 rounded bg-white font-mono">./index.html</code> app shell instead of two duplicate 1.1 MB copies, aligns <code class="px-1 rounded bg-white font-mono">manifest.webmanifest</code> theme colour, preserves the <code class="px-1 rounded bg-white font-mono">&lt;nav&gt;</code> landmark, and removes obsolete HTML4 link tags.</li>
                <li>&bull; <strong>Automated CI/CD &amp; Revision Tracking:</strong> GitHub Actions automatically verifies SRI hashes, stamps the build revision in <strong>Appearance &amp; Help</strong>, runs cryptography and app test suites, optimises <code class="px-1 rounded bg-white font-mono">index.html</code>, and deploys to GitHub Pages on every push.</li>
              </ul>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Transparent Sync, Backup &amp; Share JSON Encryption (AES-256-GCM)</div>
              <p class="text-slate-600 leading-relaxed">
                Enable <strong>Shared JSON Encryption</strong> inside the <strong>Sync, Share &amp; Portable Files</strong> card (or <strong>Appearance &amp; Help</strong>) and set a passphrase (stored in memory for the current session only, with an automatic 30-minute inactivity lock).
                Every write to your linked shared <code class="px-1 rounded bg-white font-mono">.json</code> file, every <strong>Backup to Folder</strong> write, and every <strong>Share / Save JSON</strong> export is automatically encrypted using the browser's native <strong>Web Crypto API</strong> (<strong>PBKDF2-SHA-256</strong> with 250,000 iterations, random 128-bit salt, random 96-bit IV, and <strong>AES-256-GCM</strong>).
                When opening, importing, or reloading an encrypted <code class="px-1 rounded bg-white font-mono">.json</code> file, PulsePlanSecure detects the encrypted envelope automatically and decrypts it in memory. If the passphrase is lost, encrypted files cannot be recovered.
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
    let ppSyncPassphrase = '';
    let ppPassphraseResolver = null;
    let ppAutoLockMinutes = 30;
    let ppAutoLockTimer = null;

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
        throw new Error('Invalid or unsupported encrypted JSON envelope.');
      }
      if (!passphrase) {
        throw new Error('Passphrase required to decrypt this JSON file.');
      }
      const salt = ppBase64ToBytes(envelope.salt);
      const iv = ppBase64ToBytes(envelope.iv);
      const ciphertext = ppBase64ToBytes(envelope.ciphertext);
      const key = await ppDeriveAesKey(passphrase, salt);
      try {
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return new TextDecoder().decode(plainBuf);
      } catch (_err) {
        throw new Error('Decryption failed. Check your passphrase or verify the JSON file was not altered.');
      }
    }

    function ppEvaluatePassphraseStrength(pass) {
      if (!pass) return { label: '', pct: 0, color: 'bg-slate-200', text: 'text-slate-400' };
      let score = 0;
      if (pass.length >= 8) score++;
      if (pass.length >= 12) score++;
      if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score++;
      if (/\d/.test(pass)) score++;
      if (/[^A-Za-z0-9]/.test(pass)) score++;
      if (score <= 2) return { label: 'Weak', pct: 33, color: 'bg-rose-500', text: 'text-rose-600' };
      if (score <= 3) return { label: 'Fair', pct: 66, color: 'bg-amber-500', text: 'text-amber-600' };
      return { label: 'Strong', pct: 100, color: 'bg-emerald-500', text: 'text-emerald-600' };
    }

    function updatePassphraseStrengthUI(pass) {
      const bar = document.getElementById('ppStrengthBar');
      const lbl = document.getElementById('ppStrengthLabel');
      if (!bar || !lbl) return;
      const st = ppEvaluatePassphraseStrength(pass);
      bar.style.width = st.pct + '%';
      bar.className = 'h-full rounded-full transition-all ' + st.color;
      lbl.textContent = st.label;
      lbl.className = 'text-[10px] font-bold ' + st.text;
    }

    function ppGetCurrentDbRef() {
      if (typeof getActiveDB === 'function') return getActiveDB();
      if (typeof ui !== 'undefined' && ui.whatIfMode && typeof whatIfDB !== 'undefined' && whatIfDB) return whatIfDB;
      if (typeof ui !== 'undefined' && ui.demoMode && typeof demoDB !== 'undefined' && demoDB) return demoDB;
      if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
      return null;
    }

    function resetPassphraseAutoLock() {
      if (ppAutoLockTimer) {
        clearTimeout(ppAutoLockTimer);
        ppAutoLockTimer = null;
      }
      if (ppSyncPassphrase && ppAutoLockMinutes > 0) {
        ppAutoLockTimer = setTimeout(() => {
          ppSyncPassphrase = '';
          updateSyncEncryptionBadges();
          if (typeof showToast === 'function') {
            showToast('Sync JSON encryption passphrase locked after inactivity.', 'info');
          }
        }, ppAutoLockMinutes * 60 * 1000);
      }
    }

    function updateSyncEncryptionBadges() {
      const active = Boolean(ppSyncPassphrase);
      const chip = document.getElementById('ppSyncEncChip');
      if (chip) {
        chip.textContent = active ? 'ON' : 'OFF';
        chip.className = active ? 'text-[10px] font-bold text-emerald-600' : 'text-[10px] font-bold text-slate-400';
      }
      const bannerBadge = document.getElementById('ppSyncTabEncBadge');
      if (bannerBadge) {
        bannerBadge.textContent = active ? 'AES-256-GCM Active' : 'Plaintext JSON';
        bannerBadge.className = active
          ? 'px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase'
          : 'px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-bold text-[10px] uppercase';
      }
    }

    function setEncryptStatus(msg, isError) {
      const el = document.getElementById('ppEncryptStatus');
      if (!el) return;
      el.textContent = msg;
      el.className = isError
        ? 'text-xs rounded-lg px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200'
        : 'text-xs rounded-lg px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200';
    }

    function openSyncEncryptionDialog(promptReason = '') {
      const dlg = document.getElementById('ppEncryptDialog');
      if (!dlg) return;
      const reasonEl = document.getElementById('ppEncryptReason');
      if (reasonEl) {
        reasonEl.textContent = promptReason || 'Set a session passphrase to automatically encrypt synced .json saves, folder backups, and Share / Save JSON exports with AES-256-GCM.';
      }
      const statusEl = document.getElementById('ppEncryptStatus');
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'hidden text-xs rounded-lg px-3 py-2';
      }
      const passEl = document.getElementById('ppEncryptPassphrase');
      if (passEl) passEl.value = '';
      updatePassphraseStrengthUI('');
      const timeoutSel = document.getElementById('ppEncryptAutoLock');
      if (timeoutSel) timeoutSel.value = String(ppAutoLockMinutes);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', 'open');
      if (passEl) passEl.focus();
    }

    function promptForDecryptionPassphrase() {
      return new Promise((resolve) => {
        ppPassphraseResolver = resolve;
        openSyncEncryptionDialog('This .json file is encrypted (AES-256-GCM). Enter its passphrase to decrypt and load it.');
      });
    }

    function openLicenceDialog() {
      const dlg = document.getElementById('ppLicenceDialog');
      if (!dlg) return;
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', 'open');
    }

    async function checkAppUpdate() {
      try {
        if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) await reg.update();
        }
        if (typeof showToast === 'function') {
          showToast(`Checked for updates (${PP_BUILD_INFO.version} · ${PP_BUILD_INFO.sha}). Reloading...`, 'info');
        }
        setTimeout(() => window.location.reload(), 600);
      } catch (_err) {
        window.location.reload();
      }
    }

    async function handleEncryptedShareSaveJson() {
      const dbObj = ppGetCurrentDbRef();
      if (!dbObj) return;
      const payload = JSON.parse(JSON.stringify(dbObj));
      const incSnap = document.getElementById('exportIncludeSnapshots');
      if (incSnap && !incSnap.checked) {
        payload.snapshots = [];
      }
      resetPassphraseAutoLock();
      const envelope = await encryptPulsePlanData(payload, ppSyncPassphrase);
      const jsonText = JSON.stringify(envelope, null, 2);
      const filename = `pulseplan_encrypted_${new Date().toISOString().slice(0, 10)}.json`;

      if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
        try {
          const shareFile = new File([jsonText], filename, { type: 'application/json' });
          if (navigator.canShare({ files: [shareFile] })) {
            await navigator.share({ files: [shareFile], title: 'PulsePlan Encrypted JSON' });
            if (typeof showToast === 'function') showToast('Encrypted JSON shared (AES-256-GCM).', 'success');
            return;
          }
        } catch (_err) {
          // Fall back to direct download
        }
      }

      const blob = new Blob([jsonText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (typeof showToast === 'function') {
        showToast('Encrypted JSON saved (AES-256-GCM).', 'success');
      }
    }

    function installTransparentJsonCryptoHooks() {
      if (typeof window === 'undefined') return;

      if (typeof FileSystemFileHandle !== 'undefined' && FileSystemFileHandle.prototype && FileSystemFileHandle.prototype.createWritable && !FileSystemFileHandle.prototype.__ppCryptoWrapped) {
        const origCreateWritable = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = async function (...args) {
          const writable = await origCreateWritable.apply(this, args);
          const origWrite = writable.write.bind(writable);
          writable.write = async function (data) {
            if (ppSyncPassphrase && typeof data === 'string' && data.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(data);
                if (parsed && parsed.format !== PP_ENC_FORMAT && (parsed.departments || parsed.projects)) {
                  resetPassphraseAutoLock();
                  const envelope = await encryptPulsePlanData(parsed, ppSyncPassphrase);
                  return origWrite(JSON.stringify(envelope, null, 2));
                }
              } catch (_err) {
                // Fall through to original write if not PulsePlan JSON
              }
            }
            return origWrite(data);
          };
          return writable;
        };
        FileSystemFileHandle.prototype.__ppCryptoWrapped = true;
      }

      if (typeof File !== 'undefined' && File.prototype && File.prototype.text && !File.prototype.__ppCryptoWrapped) {
        const origText = File.prototype.text;
        File.prototype.text = async function (...args) {
          const raw = await origText.apply(this, args);
          if (typeof raw === 'string' && raw.includes(PP_ENC_FORMAT)) {
            let parsed = null;
            try {
              parsed = JSON.parse(raw);
            } catch (_err) {
              return raw;
            }
            if (parsed && parsed.format === PP_ENC_FORMAT) {
              let pass = ppSyncPassphrase;
              if (!pass) {
                pass = await promptForDecryptionPassphrase();
              }
              if (!pass) {
                throw new Error('Decryption cancelled: no passphrase provided.');
              }
              const plainJson = await decryptPulsePlanData(parsed, pass);
              ppSyncPassphrase = pass;
              resetPassphraseAutoLock();
              updateSyncEncryptionBadges();
              return plainJson;
            }
          }
          return raw;
        };
        File.prototype.__ppCryptoWrapped = true;
      }

      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && !document.__ppShareSaveHooked) {
        document.addEventListener('click', (e) => {
          if (!ppSyncPassphrase) return;
          const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
          if (!btn) return;
          const txt = (btn.textContent || '').trim();
          if (txt === 'Share / Save JSON') {
            e.preventDefault();
            e.stopImmediatePropagation();
            handleEncryptedShareSaveJson().catch((err) => {
              if (typeof showToast === 'function') showToast(err.message || 'Encrypted export failed.', 'error');
            });
          }
        }, true);
        document.__ppShareSaveHooked = true;
      }
    }

    function fixNavTablistLandmark() {
      if (typeof document.querySelector !== 'function') return;
      const nav = document.querySelector('header nav[role="tablist"]');
      if (!nav) return;
      nav.removeAttribute('role');
      const inner = document.createElement('div');
      inner.setAttribute('role', 'tablist');
      inner.className = 'flex items-center gap-1';
      while (nav.firstChild) inner.appendChild(nav.firstChild);
      nav.appendChild(inner);
    }

    function injectDarkModeDialogStyles() {
      if (!document.head || typeof document.head.appendChild !== 'function') return;
      if (document.getElementById('ppSecurityDialogStyles')) return;
      const style = document.createElement('style');
      style.id = 'ppSecurityDialogStyles';
      style.textContent = `
        dialog#ppEncryptDialog::backdrop, dialog#ppLicenceDialog::backdrop { background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(2px); }
        html.dark dialog#ppEncryptDialog, html.dark dialog#ppLicenceDialog,
        body.dark dialog#ppEncryptDialog, body.dark dialog#ppLicenceDialog {
          background-color: #0f172a; color: #f1f5f9; border-color: #334155;
        }
        html.dark dialog#ppEncryptDialog h2, html.dark dialog#ppLicenceDialog h2,
        body.dark dialog#ppEncryptDialog h2, body.dark dialog#ppLicenceDialog h2 { color: #f8fafc; }
        html.dark dialog#ppEncryptDialog input, html.dark dialog#ppEncryptDialog select,
        body.dark dialog#ppEncryptDialog input, body.dark dialog#ppEncryptDialog select {
          background-color: #1e293b; color: #f1f5f9; border-color: #334155;
        }
        html.dark dialog#ppLicenceDialog section, body.dark dialog#ppLicenceDialog section {
          background-color: #1e293b; color: #cbd5e1; border-color: #334155;
        }
        html.dark #ppSyncTabEncBar, body.dark #ppSyncTabEncBar {
          background-color: #1e293b; border-color: #334155; color: #f1f5f9;
        }
      `;
      document.head.appendChild(style);
    }

    function initSecurityAndLicenceUI() {
      if (typeof document === 'undefined' || !document.body) return;
      installTransparentJsonCryptoHooks();
      fixNavTablistLandmark();
      injectDarkModeDialogStyles();

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        ['click', 'keydown'].forEach((evt) => {
          window.addEventListener(evt, () => {
            if (ppSyncPassphrase) resetPassphraseAutoLock();
          }, { passive: true });
        });
      }

      const manualBtn = document.getElementById('manualBtn');
      if (manualBtn && manualBtn.parentElement && !document.getElementById('ppSyncEncMenuBtn')) {
        const encBtn = document.createElement('button');
        encBtn.id = 'ppSyncEncMenuBtn';
        encBtn.type = 'button';
        encBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-700 font-semibold transition cursor-pointer';
        encBtn.innerHTML = `
          <span class="flex items-center gap-2">
            <svg class="w-3.5 h-3.5 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span>Sync JSON Encryption</span>
          </span>
          <span id="ppSyncEncChip" class="text-[10px] font-bold text-slate-400">OFF</span>`;
        encBtn.addEventListener('click', () => {
          if (typeof closeHeaderWorkspaceMenu === 'function') closeHeaderWorkspaceMenu();
          openSyncEncryptionDialog();
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

        const revBtn = document.createElement('button');
        revBtn.id = 'ppRevisionBtn';
        revBtn.type = 'button';
        revBtn.title = 'Click to check for updates and refresh Service Worker cache';
        revBtn.className = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200/80 bg-slate-100/70 hover:bg-indigo-50 text-[10px] text-slate-500 hover:text-indigo-700 font-mono transition cursor-pointer';
        revBtn.innerHTML = `
          <span>${PP_BUILD_INFO.version} &middot; ${PP_BUILD_INFO.sha}</span>
          <span>${PP_BUILD_INFO.builtAt}</span>`;
        revBtn.addEventListener('click', () => {
          if (typeof closeHeaderWorkspaceMenu === 'function') closeHeaderWorkspaceMenu();
          checkAppUpdate();
        });

        manualBtn.parentElement.appendChild(encBtn);
        manualBtn.parentElement.appendChild(licBtn);
        manualBtn.parentElement.appendChild(revBtn);
      }

      const syncTab = document.getElementById('tab-sync');
      if (syncTab && !document.getElementById('ppSyncTabEncBar')) {
        let targetCard = null;
        if (typeof syncTab.querySelectorAll === 'function') {
          const headings = syncTab.querySelectorAll('h2, h3, div');
          for (const el of headings) {
            if (el.textContent && el.textContent.trim().startsWith('Sync, Share & Portable Files')) {
              targetCard = el.closest('section, article, div.rounded-2xl') || el.parentElement;
              break;
            }
          }
        }
        const bar = document.createElement('div');
        bar.id = 'ppSyncTabEncBar';
        bar.className = 'mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center justify-between gap-2 text-xs';
        bar.innerHTML = `
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold text-slate-900">Shared JSON Encryption</span>
            <span id="ppSyncTabEncBadge" class="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-bold text-[10px] uppercase">Plaintext JSON</span>
            <span class="text-slate-500">Encrypts linked <code class="px-1 rounded bg-white font-mono">.json</code> saves, folder backups &amp; Share / Save JSON with AES-256-GCM.</span>
          </div>
          <button type="button" id="ppSyncTabEncBtn" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition cursor-pointer">Configure Passphrase</button>`;
        if (targetCard && typeof targetCard.appendChild === 'function') {
          targetCard.appendChild(bar);
        } else {
          syncTab.prepend(bar);
        }
        document.getElementById('ppSyncTabEncBtn')?.addEventListener('click', () => openSyncEncryptionDialog());
      }

      if (!document.getElementById('ppEncryptDialog')) {
        const encDialog = document.createElement('dialog');
        encDialog.id = 'ppEncryptDialog';
        encDialog.setAttribute('aria-labelledby', 'ppEncryptDialogTitle');
        encDialog.className = 'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 w-full max-w-md';
        encDialog.innerHTML = `
          <div class="p-5 space-y-4 text-xs">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 id="ppEncryptDialogTitle" class="text-base font-extrabold text-slate-900">Sync JSON Encryption (AES-256-GCM)</h2>
                <p id="ppEncryptReason" class="text-[11px] text-slate-500 mt-0.5">Set a session passphrase to automatically encrypt synced .json saves, folder backups, and Share / Save JSON exports with AES-256-GCM.</p>
              </div>
              <button type="button" id="ppEncryptCloseBtn" aria-label="Close encryption dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
            </header>
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label for="ppEncryptPassphrase" class="block font-semibold text-slate-700">Passphrase (minimum 8 characters)</label>
                <span id="ppStrengthLabel" class="text-[10px] font-bold text-slate-400"></span>
              </div>
              <input id="ppEncryptPassphrase" type="password" autocomplete="new-password" placeholder="Enter passphrase..." class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900" />
              <div class="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                <div id="ppStrengthBar" class="h-full rounded-full bg-slate-200 transition-all" style="width:0%"></div>
              </div>
            </div>
            <div class="space-y-1.5">
              <label for="ppEncryptAutoLock" class="block font-semibold text-slate-700">Auto-lock passphrase after inactivity</label>
              <select id="ppEncryptAutoLock" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900">
                <option value="15">15 minutes</option>
                <option value="30" selected>30 minutes (default)</option>
                <option value="0">Never (until tab closed)</option>
              </select>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" id="ppEncryptSaveBtn" class="flex-1 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition cursor-pointer">Enable / Unlock</button>
              <button type="button" id="ppEncryptDisableBtn" class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer">Disable</button>
            </div>
            <div id="ppEncryptStatus" role="status" class="hidden text-xs rounded-lg px-3 py-2"></div>
          </div>`;
        document.body.appendChild(encDialog);

        const closeAndResolve = (val) => {
          encDialog.close();
          if (ppPassphraseResolver) {
            const fn = ppPassphraseResolver;
            ppPassphraseResolver = null;
            fn(val);
          }
        };

        document.getElementById('ppEncryptPassphrase')?.addEventListener('input', (e) => {
          updatePassphraseStrengthUI(e.target.value || '');
        });

        document.getElementById('ppEncryptCloseBtn')?.addEventListener('click', () => closeAndResolve(''));
        encDialog.addEventListener('cancel', () => closeAndResolve(''));

        document.getElementById('ppEncryptSaveBtn')?.addEventListener('click', () => {
          const val = (document.getElementById('ppEncryptPassphrase')?.value || '').trim();
          const timeoutVal = parseInt(document.getElementById('ppEncryptAutoLock')?.value || '30', 10);
          ppAutoLockMinutes = isNaN(timeoutVal) ? 30 : timeoutVal;
          if (val.length < 8) {
            setEncryptStatus('Passphrase must be at least 8 characters long.', true);
            return;
          }
          ppSyncPassphrase = val;
          resetPassphraseAutoLock();
          updateSyncEncryptionBadges();
          if (ppPassphraseResolver) {
            closeAndResolve(val);
          } else {
            setEncryptStatus('Sync JSON Encryption enabled for this session. Synced saves, backups, and Share / Save JSON will write AES-256-GCM ciphertext.', false);
          }
        });

        document.getElementById('ppEncryptDisableBtn')?.addEventListener('click', () => {
          ppSyncPassphrase = '';
          resetPassphraseAutoLock();
          updateSyncEncryptionBadges();
          setEncryptStatus('Sync JSON Encryption disabled. New saves will write standard JSON.', false);
        });
      }

      if (!document.getElementById('ppLicenceDialog')) {
        const licDialog = document.createElement('dialog');
        licDialog.id = 'ppLicenceDialog';
        licDialog.setAttribute('aria-labelledby', 'ppLicenceDialogTitle');
        licDialog.className = 'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 w-full max-w-lg';
        licDialog.innerHTML = `
          <div class="p-5 space-y-4 text-xs">
            <header class="flex items-start justify-between gap-3">
              <div>
                <h2 id="ppLicenceDialogTitle" class="text-base font-extrabold text-slate-900">PulsePlanSecure User Licence</h2>
                <p class="text-[11px] text-slate-500 mt-0.5">MIT Licence &amp; Local-First Privacy Notice (${PP_BUILD_INFO.version} &middot; ${PP_BUILD_INFO.sha})</p>
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

      updateSyncEncryptionBadges();
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSecurityAndLicenceUI);
      } else {
        initSecurityAndLicenceUI();
      }
    }
