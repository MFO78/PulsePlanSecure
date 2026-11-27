    /* ============================================================================
     * 13. PULSEPLANSECURE: TRANSPARENT SYNC & SHARE JSON ENCRYPTION (AES-256-GCM),
     *     PASS-STRENGTH METER, INACTIVITY LOCK, BUILD REVISION TRACKER & LICENCE
     * ============================================================================ */

    const PP_BUILD_INFO = {
      version: 'v9.0-secure',
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
    let ppLastActivityAt = Date.now();
    let ppOrigFileText = null;

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

    async function ppDeriveAesKey(passphrase, saltBytes, iterations = PP_PBKDF2_ITERATIONS) {
      const enc = new TextEncoder();
      const baseKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: Number(iterations) || PP_PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }

    async function ppWrapMasterPassphrase(masterPassphrase, userPassword, userId = '') {
      if (!masterPassphrase || masterPassphrase.length < 8) {
        throw new Error('Administrator passphrase must be active (at least 8 characters).');
      }
      if (!userPassword || userPassword.length < 8) {
        throw new Error('User password must be at least 8 characters long.');
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await ppDeriveAesKey(userPassword, salt, PP_PBKDF2_ITERATIONS);
      const payload = JSON.stringify({
        v: 1,
        userId: String(userId || ''),
        masterPass: masterPassphrase,
      });
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
      return {
        kdf: 'PBKDF2-SHA256',
        iterations: PP_PBKDF2_ITERATIONS,
        salt: ppBytesToBase64(salt),
        iv: ppBytesToBase64(iv),
        wrapped: ppBytesToBase64(new Uint8Array(cipherBuf)),
      };
    }

    async function ppUnwrapMasterPassphrase(keySlot, userPassword, expectedUserId = '') {
      if (!keySlot || !keySlot.salt || !keySlot.iv || !keySlot.wrapped) {
        throw new Error('User key slot is missing or requires an Administrator password reset.');
      }
      if (!userPassword) {
        throw new Error('Password is required.');
      }
      const salt = ppBase64ToBytes(keySlot.salt);
      const iv = ppBase64ToBytes(keySlot.iv);
      const wrappedBytes = ppBase64ToBytes(keySlot.wrapped);
      const key = await ppDeriveAesKey(userPassword, salt, keySlot.iterations || PP_PBKDF2_ITERATIONS);
      let decoded;
      try {
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, wrappedBytes);
        decoded = JSON.parse(new TextDecoder().decode(plainBuf));
      } catch (_err) {
        throw new Error('Incorrect password. Please try again.');
      }
      if (!decoded || decoded.v !== 1 || typeof decoded.masterPass !== 'string' || decoded.masterPass.length < 8) {
        throw new Error('Corrupted user key slot. Ask your Administrator to reset your password.');
      }
      if (expectedUserId && decoded.userId && decoded.userId !== expectedUserId) {
        throw new Error('Key slot identity mismatch.');
      }
      return decoded.masterPass;
    }

    function ppBuildOuterAuthMetadata(dbObj) {
      const ac = dbObj && typeof dbObj === 'object' ? dbObj.accessControl : null;
      if (!ac || typeof ac !== 'object') return null;
      const allUsers = Array.isArray(ac.users) ? ac.users : [];
      const adminName = String(ac.adminName || 'Administrator').trim() || 'Administrator';
      const activeUsers = allUsers.filter(u =>
        u && u.id && u.name && u.enabled !== false && !u.needsAdminKeyReset &&
        u.keySlot && u.keySlot.salt && u.keySlot.iv && u.keySlot.wrapped
      );
      const resetRequiredUsers = allUsers.filter(u =>
        u && u.id && u.name && u.enabled !== false && (u.needsAdminKeyReset || !u.keySlot)
      );
      if (activeUsers.length === 0) {
        return null;
      }
      return {
        version: 1,
        adminName,
        users: activeUsers.map(u => ({
          id: String(u.id),
          name: String(u.name),
          roleTitle: String(u.roleTitle || ''),
          isAdmin: Boolean(u.isAdmin),
          mustChangePassword: Boolean(u.mustChangePassword),
          keySlot: {
            kdf: String(u.keySlot.kdf || 'PBKDF2-SHA256'),
            iterations: Number(u.keySlot.iterations) || PP_PBKDF2_ITERATIONS,
            salt: String(u.keySlot.salt),
            iv: String(u.keySlot.iv),
            wrapped: String(u.keySlot.wrapped),
          },
        })),
        resetRequiredUsers: resetRequiredUsers.map(u => ({
          id: String(u.id),
          name: String(u.name),
          roleTitle: String(u.roleTitle || ''),
          isAdmin: Boolean(u.isAdmin),
        })),
      };
    }

    async function encryptPulsePlanData(dbObj, passphrase) {
      if (!passphrase || passphrase.length < 8) {
        throw new Error('Passphrase must be at least 8 characters long.');
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await ppDeriveAesKey(passphrase, salt, PP_PBKDF2_ITERATIONS);
      const plaintext = new TextEncoder().encode(JSON.stringify(dbObj));
      const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
      const envelope = {
        format: PP_ENC_FORMAT,
        kdf: 'PBKDF2-SHA256',
        iterations: PP_PBKDF2_ITERATIONS,
        cipher: 'AES-256-GCM',
        createdAt: new Date().toISOString(),
        salt: ppBytesToBase64(salt),
        iv: ppBytesToBase64(iv),
        ciphertext: ppBytesToBase64(new Uint8Array(cipherBuf)),
      };
      const outerAuth = ppBuildOuterAuthMetadata(dbObj);
      if (outerAuth) envelope.auth = outerAuth;
      return envelope;
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
      const key = await ppDeriveAesKey(passphrase, salt, envelope.iterations || PP_PBKDF2_ITERATIONS);
      try {
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return new TextDecoder().decode(plainBuf);
      } catch (_err) {
        throw new Error('Decryption failed. Check your passphrase or verify the JSON file was not altered.');
      }
    }

    async function ppDecryptWithUserCredentials(envelope, accountId, password) {
      if (!envelope || envelope.format !== PP_ENC_FORMAT) {
        throw new Error('Invalid encrypted PulsePlan file.');
      }
      if (!password) {
        throw new Error('Please enter your password.');
      }
      if (!accountId || accountId === '__ADMIN__') {
        const plainJson = await decryptPulsePlanData(envelope, password);
        return { plainJson, masterPass: password, authRole: 'admin', userRecord: null };
      }
      const authUsers = Array.isArray(envelope.auth?.users) ? envelope.auth.users : [];
      const slotEntry = authUsers.find(u => u && u.id === accountId);
      if (!slotEntry || !slotEntry.keySlot) {
        throw new Error('Account not found or requires a password reset by your Administrator.');
      }
      const masterPass = await ppUnwrapMasterPassphrase(slotEntry.keySlot, password, accountId);
      const plainJson = await decryptPulsePlanData(envelope, masterPass);
      let parsedDb = null;
      try {
        parsedDb = JSON.parse(plainJson);
      } catch (_err) {
        throw new Error('Decrypted database is malformed.');
      }
      const authUser = Array.isArray(parsedDb?.accessControl?.users)
        ? parsedDb.accessControl.users.find(u => u && u.id === accountId)
        : null;
      if (!authUser || authUser.enabled === false) {
        throw new Error('This user account has been disabled or removed by the Administrator.');
      }
      if (authUser.needsAdminKeyReset) {
        throw new Error('Administrator reset your workspace key. Ask your Administrator for a new temporary password.');
      }
      return { plainJson, masterPass, authRole: 'user', userRecord: authUser };
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
      const st = ppEvaluatePassphraseStrength(String(pass || '').trim());
      bar.style.width = st.pct + '%';
      bar.className = 'h-full rounded-full transition-all ' + st.color;
      lbl.textContent = st.label;
      lbl.className = 'text-[10px] font-bold ' + st.text;
    }

    function ppGetCurrentDbRef() {
      // Auth & encryption operations always target liveDB (never ephemeral What-If or Demo sandboxes)
      if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
      if (typeof getActiveDB === 'function') return getActiveDB();
      return null;
    }

    function ppTriggerInactivityLock() {
      if (typeof ppSignOutAndLockSession === 'function') {
        ppSignOutAndLockSession('inactivity');
        return;
      }
      ppSyncPassphrase = '';
      if (typeof ppOnSessionLocked === 'function') ppOnSessionLocked('inactivity');
      updateSyncEncryptionBadges();
      if (typeof showToast === 'function') {
        showToast('Session locked after inactivity. Sign in again to read or write encrypted files.', 'info');
      }
    }

    function ppCheckWallClockInactivityLock() {
      if (!ppSyncPassphrase || ppAutoLockMinutes <= 0) return false;
      if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return false;
      const elapsed = Date.now() - (ppLastActivityAt || Date.now());
      if (elapsed >= ppAutoLockMinutes * 60 * 1000) {
        ppTriggerInactivityLock();
        return true;
      }
      return false;
    }

    function resetPassphraseAutoLock() {
      ppLastActivityAt = Date.now();
      if (ppAutoLockTimer) {
        clearTimeout(ppAutoLockTimer);
        ppAutoLockTimer = null;
      }
      if (ppSyncPassphrase && ppAutoLockMinutes > 0) {
        ppAutoLockTimer = setTimeout(() => {
          ppTriggerInactivityLock();
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
      if (typeof ppRefreshSyncHubUI === 'function') ppRefreshSyncHubUI();
      if (typeof ppSyncAuthChromeUI === 'function') ppSyncAuthChromeUI();
    }

    function setEncryptStatus(msg, isError) {
      const el = document.getElementById('ppEncryptStatus');
      if (!el) return;
      el.textContent = msg;
      el.className = isError
        ? 'text-xs rounded-xl px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200'
        : 'text-xs rounded-xl px-3 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200';
    }

    function openSyncEncryptionDialog(promptReason = '') {
      const isNamedUser = typeof ppIsNamedUser === 'function'
        ? ppIsNamedUser()
        : (typeof ppIsStandardUser === 'function' && ppIsStandardUser());
      if (!ppPassphraseResolver && isNamedUser) {
        if (typeof openUserSwitcherModal === 'function') openUserSwitcherModal();
        else if (typeof showToast === 'function') showToast('Only the Main Administrator can configure or rotate the master encryption key.', 'warning');
        return;
      }
      const dlg = document.getElementById('ppEncryptDialog');
      if (!dlg) return;
      const isDecryptPrompt = Boolean(ppPassphraseResolver);
      const hasExistingKey = Boolean(ppSyncPassphrase);
      const isChangingExisting = !isDecryptPrompt && hasExistingKey;
      const titleEl = document.getElementById('ppEncryptDialogTitle');
      if (titleEl) {
        titleEl.textContent = isDecryptPrompt
          ? 'Unlock Encrypted Database'
          : (isChangingExisting ? 'Main Administrator Key & Auto-Lock' : 'Administrator Encryption Key (AES-256-GCM)');
      }
      const reasonEl = document.getElementById('ppEncryptReason');
      if (reasonEl) {
        reasonEl.textContent = promptReason || (isChangingExisting
          ? 'Change the Main Administrator password (verify your current password first) or update the inactivity auto-lock timeout.'
          : 'Set the Administrator master password. It encrypts synced .json files, backups, and the separate Finance Vault automatically. Team users unlock it internally with their own passwords.');
      }
      const statusEl = document.getElementById('ppEncryptStatus');
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'hidden text-xs rounded-xl px-3 py-2';
      }
      const curWrap = document.getElementById('ppEncryptCurrentWrap');
      const curEl = document.getElementById('ppEncryptCurrentPassphrase');
      const passEl = document.getElementById('ppEncryptPassphrase');
      const passLbl = document.getElementById('ppEncryptPassLabel');
      const confEl = document.getElementById('ppEncryptPassphraseConfirm');
      const confWrap = document.getElementById('ppEncryptConfirmWrap');
      const disableBtn = document.getElementById('ppEncryptDisableBtn');
      const saveBtn = document.getElementById('ppEncryptSaveBtn');
      const userWarnEl = document.getElementById('ppEncryptUserWarn');
      if (curWrap) curWrap.classList.toggle('hidden', !isChangingExisting);
      if (curEl) {
        curEl.value = '';
        curEl.type = 'password';
      }
      if (passEl) {
        passEl.value = '';
        passEl.type = 'password';
        passEl.placeholder = isChangingExisting
          ? 'Leave blank to keep password, or enter new (min 8 chars)...'
          : 'Enter Administrator password...';
      }
      if (passLbl) {
        passLbl.textContent = isChangingExisting
          ? 'New Administrator Password (optional, min 8 chars)'
          : 'Administrator Password (min 8 chars)';
      }
      if (confEl) {
        confEl.value = '';
        confEl.type = 'password';
      }
      const eyeBtn = document.getElementById('ppEncryptEyeBtn');
      if (eyeBtn) eyeBtn.textContent = 'Show';
      if (confWrap) confWrap.classList.toggle('hidden', isDecryptPrompt);
      if (disableBtn) disableBtn.classList.toggle('hidden', isDecryptPrompt || !hasExistingKey);
      if (saveBtn) saveBtn.textContent = isDecryptPrompt ? 'Decrypt & Open' : (isChangingExisting ? 'Save Changes' : 'Enable Encryption');

      const curDb = ppGetCurrentDbRef();
      const existingUserCount = Array.isArray(curDb?.accessControl?.users) ? curDb.accessControl.users.filter(u => u && u.enabled !== false).length : 0;
      if (userWarnEl) {
        const showWarn = isChangingExisting && existingUserCount > 0;
        userWarnEl.classList.toggle('hidden', !showWarn);
        if (showWarn) {
          userWarnEl.textContent = `Heads up: ${existingUserCount} team user account${existingUserCount === 1 ? '' : 's'} currently wrap your existing Admin key. Changing the Main Admin password requires resetting their temporary passwords in Team Access.`;
        }
      }

      updatePassphraseStrengthUI('');
      const timeoutSel = document.getElementById('ppEncryptAutoLock');
      if (timeoutSel) timeoutSel.value = String(ppAutoLockMinutes);
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', 'open');
      if (isChangingExisting && curEl) curEl.focus();
      else if (passEl) passEl.focus();
    }

    function promptForDecryptionPassphrase() {
      return new Promise((resolve) => {
        ppPassphraseResolver = resolve;
        openSyncEncryptionDialog('This .json file is encrypted (AES-256-GCM). Enter the Administrator passphrase to decrypt and load it.');
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
      const incSnap = document.getElementById('chkExportIncludeSnapshots') || document.getElementById('exportIncludeSnapshots');
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
            if (typeof recordDumpEvent === 'function') {
              recordDumpEvent('JSON', filename, jsonText.length, `AES-256-GCM · ${(dbObj.departments || []).length} depts, ${(dbObj.projects || []).length} projs`);
            }
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
      if (typeof recordDumpEvent === 'function') {
        recordDumpEvent('JSON', filename, jsonText.length, `AES-256-GCM · ${(dbObj.departments || []).length} depts, ${(dbObj.projects || []).length} projs`);
      }
      if (typeof showToast === 'function') {
        showToast('Encrypted JSON saved (AES-256-GCM).', 'success');
      }
    }

    async function ppReadRawFileText(file) {
      if (!file) return '';
      if (ppOrigFileText) return ppOrigFileText.call(file);
      if (typeof file.text === 'function') return file.text();
      return '';
    }

    async function ppResolveEncryptedJsonText(raw, opts = {}) {
      if (typeof raw !== 'string' || !raw.includes(PP_ENC_FORMAT)) return raw;
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (_err) {
        return raw;
      }
      if (!parsed || parsed.format !== PP_ENC_FORMAT) return raw;

      // Fast path: already unlocked in memory (e.g., silent auto-reload or 3-way merge check)
      if (ppSyncPassphrase && !opts.forceLoginPrompt) {
        try {
          const plainJson = await decryptPulsePlanData(parsed, ppSyncPassphrase);
          resetPassphraseAutoLock();
          updateSyncEncryptionBadges();
          return plainJson;
        } catch (_err) {
          if (opts.isSilentAutoReload) {
            throw new Error('Encrypted file passphrase changed on disk. Sign in again to reload.');
          }
          // Fall through to interactive login
        }
      }

      if (opts.isSilentAutoReload) {
        throw new Error('Session locked — sign in to reload encrypted file.');
      }

      // Interactive modern multi-user login dialog (if loaded)
      if (typeof ppPromptEncryptedFileLogin === 'function') {
        const res = await ppPromptEncryptedFileLogin(parsed, opts);
        if (!res || !res.plainJson || !res.masterPass) {
          throw new Error('Sign-in cancelled.');
        }
        ppSyncPassphrase = res.masterPass;
        resetPassphraseAutoLock();
        if (typeof ppApplyAuthenticatedSession === 'function') {
          ppApplyAuthenticatedSession(res.authRole, res.userRecord, parsed.auth?.adminName);
        }
        updateSyncEncryptionBadges();
        return res.plainJson;
      }

      // Legacy fallback: single passphrase prompt
      const pass = await promptForDecryptionPassphrase();
      if (!pass) {
        throw new Error('Decryption cancelled: no passphrase provided.');
      }
      const plainJson = await decryptPulsePlanData(parsed, pass);
      ppSyncPassphrase = pass;
      resetPassphraseAutoLock();
      if (typeof ppApplyAuthenticatedSession === 'function') {
        ppApplyAuthenticatedSession('admin', null, parsed.auth?.adminName);
      }
      updateSyncEncryptionBadges();
      return plainJson;
    }

    function installTransparentJsonCryptoHooks() {
      if (typeof window === 'undefined') return;

      if (typeof FileSystemFileHandle !== 'undefined' && FileSystemFileHandle.prototype && FileSystemFileHandle.prototype.createWritable && !FileSystemFileHandle.prototype.__ppCryptoWrapped) {
        const origCreateWritable = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = async function (...args) {
          if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) {
            throw new Error('Refused file write while workspace session is locked.');
          }
          const writable = await origCreateWritable.apply(this, args);
          const origWrite = writable.write.bind(writable);
          writable.write = async function (data) {
            if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) {
              throw new Error('Refused file write while workspace session is locked.');
            }
            let rawStr = null;
            if (typeof data === 'string') {
              rawStr = data;
            } else if (typeof Blob !== 'undefined' && data instanceof Blob && (!data.type || data.type.includes('json'))) {
              try { rawStr = await data.text(); } catch (_e) {}
            }
            if (ppSyncPassphrase && typeof rawStr === 'string' && rawStr.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(rawStr);
                if (parsed && parsed.format !== PP_ENC_FORMAT && parsed.type !== 'pulseplan-finance-vault' && parsed.type !== 'pulseplan-pbs' && (parsed.departments || parsed.projects)) {
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
        ppOrigFileText = origText;
        File.prototype.text = async function (...args) {
          const raw = await origText.apply(this, args);
          return ppResolveEncryptedJsonText(raw, { fileName: this?.name || '' });
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
        dialog#ppEncryptDialog::backdrop, dialog#ppLicenceDialog::backdrop { background: rgba(15, 23, 42, 0.58); backdrop-filter: blur(4px); }
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
          background-color: #162033; border-color: #334155; color: #f1f5f9;
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
            <span>Admin Encryption Key</span>
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
          <span class="text-[10px] text-slate-400">EUPL-1.2</span>`;
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
            <span class="text-slate-500">AES-256-GCM master encryption with per-user login &amp; unified Finance Vault.</span>
          </div>
          <button type="button" id="ppSyncTabEncBtn" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition cursor-pointer">Configure Admin Key</button>`;
        if (targetCard && typeof targetCard.appendChild === 'function') {
          targetCard.appendChild(bar);
        } else {
          syncTab.prepend(bar);
        }
      }
      document.getElementById('ppSyncTabEncBtn')?.addEventListener('click', () => openSyncEncryptionDialog());

      if (!document.getElementById('ppEncryptDialog')) {
        const encDialog = document.createElement('dialog');
        encDialog.id = 'ppEncryptDialog';
        encDialog.setAttribute('aria-labelledby', 'ppEncryptDialogTitle');
        encDialog.className = 'rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-0 w-full max-w-md';
        encDialog.innerHTML = `
          <form id="ppEncryptForm" class="p-5 space-y-4 text-xs" onsubmit="return false;">
            <header class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-2.5">
                <div class="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                  <svg class="w-4.5 h-4.5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <div>
                  <h2 id="ppEncryptDialogTitle" class="text-base font-extrabold text-slate-900">Administrator Encryption Key (AES-256-GCM)</h2>
                  <p id="ppEncryptReason" class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">Set the Administrator master password. It encrypts synced .json files, backups, and the separate Finance Vault automatically.</p>
                </div>
              </div>
              <button type="button" id="ppEncryptCloseBtn" aria-label="Close encryption dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold shrink-0">&times;</button>
            </header>
            <div id="ppEncryptUserWarn" class="hidden text-[11px] leading-relaxed rounded-xl px-3 py-2 bg-amber-50 text-amber-900 border border-amber-200"></div>
            <div id="ppEncryptCurrentWrap" class="hidden space-y-1.5">
              <label for="ppEncryptCurrentPassphrase" class="block font-semibold text-slate-700">Current Administrator Password (required to change password)</label>
              <input id="ppEncryptCurrentPassphrase" type="password" autocomplete="current-password" placeholder="Verify current Administrator password..." class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900" />
            </div>
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <label id="ppEncryptPassLabel" for="ppEncryptPassphrase" class="block font-semibold text-slate-700">Administrator Password (min 8 chars)</label>
                <span id="ppStrengthLabel" class="text-[10px] font-bold text-slate-400"></span>
              </div>
              <div class="flex items-center gap-1.5 pp-pw-input-row">
                <input id="ppEncryptPassphrase" type="password" autocomplete="new-password" placeholder="Enter Administrator password..." class="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900" />
                <button type="button" id="ppEncryptEyeBtn" class="px-2.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold transition cursor-pointer shrink-0">Show</button>
              </div>
              <div class="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                <div id="ppStrengthBar" class="h-full rounded-full bg-slate-200 transition-all" style="width:0%"></div>
              </div>
            </div>
            <div id="ppEncryptConfirmWrap" class="space-y-1.5">
              <label for="ppEncryptPassphraseConfirm" class="block font-semibold text-slate-700">Confirm Administrator Password</label>
              <input id="ppEncryptPassphraseConfirm" type="password" autocomplete="new-password" placeholder="Repeat Administrator password..." class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900" />
            </div>
            <div class="space-y-1.5">
              <label for="ppEncryptAutoLock" class="block font-semibold text-slate-700">Auto-lock session after inactivity</label>
              <select id="ppEncryptAutoLock" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900">
                <option value="15">15 minutes</option>
                <option value="30" selected>30 minutes (default)</option>
                <option value="60">60 minutes</option>
                <option value="0">Never (until tab closed)</option>
              </select>
            </div>
            <div id="ppEncryptStatus" role="status" class="hidden text-xs rounded-xl px-3 py-2"></div>
            <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <button type="button" id="ppEncryptDisableBtn" class="px-3 py-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 font-semibold transition cursor-pointer">Disable Encryption</button>
              <div class="flex items-center gap-2 ml-auto">
                <button type="button" id="ppEncryptCancelBtn" class="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer">Cancel</button>
                <button type="submit" id="ppEncryptSaveBtn" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition cursor-pointer">Enable Encryption</button>
              </div>
            </div>
          </form>`;
        document.body.appendChild(encDialog);

        const closeAndResolve = (val) => {
          if (typeof encDialog.close === 'function') encDialog.close();
          else encDialog.removeAttribute('open');
          if (ppPassphraseResolver) {
            const fn = ppPassphraseResolver;
            ppPassphraseResolver = null;
            fn(val);
          }
        };

        document.getElementById('ppEncryptPassphrase')?.addEventListener('input', (e) => {
          updatePassphraseStrengthUI(e.target.value || '');
        });

        document.getElementById('ppEncryptEyeBtn')?.addEventListener('click', () => {
          const p0 = document.getElementById('ppEncryptCurrentPassphrase');
          const p1 = document.getElementById('ppEncryptPassphrase');
          const p2 = document.getElementById('ppEncryptPassphraseConfirm');
          const btn = document.getElementById('ppEncryptEyeBtn');
          if (!p1 || !btn) return;
          const show = p1.type === 'password';
          if (p0) p0.type = show ? 'text' : 'password';
          p1.type = show ? 'text' : 'password';
          if (p2) p2.type = show ? 'text' : 'password';
          btn.textContent = show ? 'Hide' : 'Show';
        });

        document.getElementById('ppEncryptCloseBtn')?.addEventListener('click', () => closeAndResolve(''));
        document.getElementById('ppEncryptCancelBtn')?.addEventListener('click', () => closeAndResolve(''));
        encDialog.addEventListener('cancel', () => closeAndResolve(''));

        const handleSave = async () => {
          const curVal = (document.getElementById('ppEncryptCurrentPassphrase')?.value || '').trim();
          const val = (document.getElementById('ppEncryptPassphrase')?.value || '').trim();
          const confVal = (document.getElementById('ppEncryptPassphraseConfirm')?.value || '').trim();
          const isDecryptPrompt = Boolean(ppPassphraseResolver);
          const saveBtn = document.getElementById('ppEncryptSaveBtn');
          const origBtnText = saveBtn ? saveBtn.textContent : '';
          const timeoutVal = parseInt(document.getElementById('ppEncryptAutoLock')?.value || '30', 10);
          ppAutoLockMinutes = isNaN(timeoutVal) ? 30 : timeoutVal;

          // If encryption is already active and new password is left empty, save auto-lock preference only
          if (!isDecryptPrompt && ppSyncPassphrase && !val && !confVal) {
            resetPassphraseAutoLock();
            updateSyncEncryptionBadges();
            setEncryptStatus('Auto-lock settings saved.', false);
            if (typeof showToast === 'function') showToast('Auto-lock preference saved.', 'success');
            setTimeout(() => closeAndResolve(''), 400);
            return;
          }

          if (val.length < 8) {
            setEncryptStatus('Administrator password must be at least 8 characters long.', true);
            return;
          }
          if (!isDecryptPrompt && confVal !== val) {
            setEncryptStatus('Passwords do not match. Please repeat the Administrator password.', true);
            return;
          }

          // For decryption prompts, resolve WITHOUT mutating ppSyncPassphrase until caller confirms decryption succeeds (fixes H5)
          if (isDecryptPrompt) {
            closeAndResolve(val);
            return;
          }

          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Encrypting...';
          }

          try {
            const prevPass = ppSyncPassphrase;
            if (prevPass) {
              if (!curVal) {
                setEncryptStatus('Enter your current Administrator password to change it.', true);
                return;
              }
              if (curVal !== prevPass) {
                setEncryptStatus('Current Administrator password is incorrect.', true);
                return;
              }
              if (val === prevPass) {
                setEncryptStatus('New Administrator password must be different from your current password.', true);
                return;
              }
              if (typeof ppChangeMainAdminPassword === 'function') {
                const res = await ppChangeMainAdminPassword({ currentPassword: curVal, newPassword: val });
                const parts = ['Main Administrator password updated.'];
                if (res.financeResult?.reencryptedOnDisk) parts.push('Finance Vault re-encrypted.');
                else if (res.financeResult?.needsAttention) parts.push('Warning: Separate Finance Vault is locked and still uses the old password.');
                if (res.pbsResult?.reencryptedCount > 0) parts.push(`${res.pbsResult.reencryptedCount} PBS file(s) re-encrypted.`);
                else if (res.pbsResult?.needsAttention) parts.push('Warning: Linked PBS folder could not be re-encrypted automatically.');
                if (res.resetUserCount > 0) parts.push(`${res.resetUserCount} team user(s) flagged for password reset.`);
                setEncryptStatus(parts.join(' '), false);
                if (typeof showToast === 'function') showToast(parts.join(' '), 'success');
                setTimeout(() => {
                  closeAndResolve('');
                  if (res.resetUserCount > 0 && typeof ppOpenTeamAccessModal === 'function') {
                    ppOpenTeamAccessModal();
                  }
                }, 600);
                return;
              }
            }

            ppSyncPassphrase = val;
            resetPassphraseAutoLock();
            const curDb = ppGetCurrentDbRef();
            // If re-enabling encryption on a DB that already has team users, flag existing user keySlots for reset so stale slots never masquerade as active (H2)
            if (Array.isArray(curDb?.accessControl?.users) && curDb.accessControl.users.length > 0) {
              curDb.accessControl.users.forEach(u => {
                if (u && (!prevPass || prevPass !== val)) {
                  u.keySlot = null;
                  u.needsAdminKeyReset = true;
                  u.mustChangePassword = true;
                }
              });
            }
            if (curDb && typeof curDb === 'object') {
              if (!curDb.accessControl || typeof curDb.accessControl !== 'object') {
                curDb.accessControl = { version: 1, adminName: 'Administrator', users: [] };
              }
              const existingAdminName = String(curDb.accessControl.adminName || '').trim();
              const hasConfiguredUsers = Array.isArray(curDb.accessControl.users) && curDb.accessControl.users.length > 0;
              const curUiName = (typeof ui !== 'undefined' && ui && typeof ui.userName === 'string') ? ui.userName.trim() : '';
              if (!prevPass && !hasConfiguredUsers && (!existingAdminName || existingAdminName === 'Administrator') && curUiName && curUiName !== 'Project Mgr' && curUiName !== 'Administrator') {
                curDb.accessControl.adminName = curUiName;
              }
            }
            if (typeof ppApplyAuthenticatedSession === 'function') {
              ppApplyAuthenticatedSession('admin', null, curDb?.accessControl?.adminName);
            }
            if (typeof ppMarkSecureSessionFlag === 'function') {
              ppMarkSecureSessionFlag(typeof linkedFileHandle !== 'undefined' && linkedFileHandle?.name ? linkedFileHandle.name : '', true);
            }
            if (typeof touchDBAndSave === 'function') touchDBAndSave();
            if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof writeDBToLinkedFile === 'function') {
              try { await writeDBToLinkedFile({ forceOverwrite: true }); } catch (_e) {}
            }
            if (typeof window !== 'undefined' && typeof window.ppTryAutoOpenFinanceVault === 'function') {
              window.ppTryAutoOpenFinanceVault({ allowPermissionPrompt: false, silent: true }).catch(() => {});
            }
            updateSyncEncryptionBadges();
            setEncryptStatus('Administrator AES-256-GCM encryption enabled. Synced files, backups, and Finance Vault now encrypt automatically.', false);
            if (typeof showToast === 'function') showToast('Administrator AES-256-GCM encryption enabled.', 'success');
            if (typeof renderAll === 'function') renderAll();
            setTimeout(() => closeAndResolve(''), 550);
          } catch (err) {
            setEncryptStatus(err?.message || 'Could not update Administrator encryption settings.', true);
          } finally {
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.textContent = origBtnText || 'Save Changes';
            }
          }
        };

        document.getElementById('ppEncryptForm')?.addEventListener('submit', (e) => {
          e.preventDefault();
          handleSave();
        });

        document.getElementById('ppEncryptDisableBtn')?.addEventListener('click', async () => {
          const curPass = ppSyncPassphrase;
          const ok = typeof ppConfirmWithPassword === 'function'
            ? await ppConfirmWithPassword({
                title: 'Disable AES-256-GCM Encryption?',
                message: 'Disabling encryption turns off multi-user access protection and writes future saves as standard unencrypted plaintext JSON. Enter the Main Administrator password to confirm.',
                confirmLabel: 'Disable Encryption',
                expectedPassword: curPass,
                requireWord: 'DISABLE',
              })
            : (typeof ppConfirmAction === 'function'
                ? await ppConfirmAction({
                    title: 'Disable Encryption?',
                    message: 'Future saves will write unencrypted plaintext JSON.',
                    confirmLabel: 'Disable Encryption',
                  })
                : true);
          if (!ok) return;
          ppSyncPassphrase = '';
          resetPassphraseAutoLock();
          if (typeof ppClearSecureSessionFlag === 'function') ppClearSecureSessionFlag();
          if (typeof ppOnSessionLocked === 'function') ppOnSessionLocked('disabled');
          updateSyncEncryptionBadges();
          if (typeof showToast === 'function') showToast('Encryption disabled. Future saves will write standard plaintext JSON.', 'warning');
          if (typeof renderAll === 'function') renderAll();
          closeAndResolve('');
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
                <p class="text-[11px] text-slate-500 mt-0.5">EUPL-1.2 &amp; Local-First Privacy Notice (${PP_BUILD_INFO.version} &middot; ${PP_BUILD_INFO.sha})</p>
              </div>
              <button type="button" id="ppLicenceCloseBtn" aria-label="Close user licence dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
            </header>
            <section class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-slate-700 leading-relaxed max-h-[55dvh] overflow-y-auto">
              <p><strong>Licensed under the EUPL-1.2.</strong> Copyright &copy; 2026 PulsePlanSecure Contributors.</p>
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
