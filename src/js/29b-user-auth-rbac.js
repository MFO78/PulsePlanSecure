/* Multi-User Login, Wrapped-Key Auth, Role-Based Access Control (Tabs + Finance + Delegated Admin),
 * Full-Hide Logout Gate, Dropdown Sign-In, Self-Service & Main Admin Password Change, and Mobile Permissions Cards */
(function ppUserAuthRbacModule() {
  const ALL_TABS = ['matrix', 'health', 'data', 'sync'];
  const TAB_META = {
    matrix: { short: 'Roadmap', label: 'Roadmap Matrix' },
    health: { short: 'Health', label: 'Health & Evolution' },
    data: { short: 'Setup', label: 'Setup & Data' },
    sync: { short: 'Sync', label: 'Sync & Snapshots' },
  };
  const PLAINTEXT_CACHE_KEYS = [
    'pulseplan_live_db_v2',
    'pulseplan_people_dir_v1',
    'pulseplan_pbs_cache_v1',
    'pulseplan_msp_meta_v1',
    'pulseplan_saved_views_v1',
  ];

  const ppAuthSession = {
    mode: 'open', // 'open' | 'admin' | 'user' | 'locked'
    userId: null,
    userName: '',
    roleTitle: '',
    isAdmin: false,
    mustChangePassword: false,
    permissions: {
      tabs: { matrix: true, health: true, data: true, sync: true },
      finance: true,
    },
  };

  let pendingResetUserId = '';
  let pendingResetDraft = '';
  let pendingEditUserId = '';
  let ppLockedState = null; // { envelope, reason, detail, fileName, hadLinkedFile, lockedAt } — ciphertext ONLY, zero plaintext
  let isSigningOut = false;

  function esc(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(str ?? ''));
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  // Always target liveDB for all user management, authentication & RBAC operations (never Demo or What-If clones)
  function getDb() {
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    if (typeof getActiveDB === 'function') return getActiveDB();
    return null;
  }

  function ppIsSigningOut() {
    return isSigningOut;
  }

  function ensureAccessControl(db) {
    if (!db || typeof db !== 'object') {
      return { version: 1, adminName: 'Administrator', users: [] };
    }
    if (!db.accessControl || typeof db.accessControl !== 'object') {
      db.accessControl = { version: 1, adminName: 'Administrator', users: [] };
    }
    if (!Array.isArray(db.accessControl.users)) db.accessControl.users = [];
    if (!String(db.accessControl.adminName || '').trim()) db.accessControl.adminName = 'Administrator';
    return db.accessControl;
  }

  function getMasterKeyActive() {
    return typeof ppSyncPassphrase === 'string' && ppSyncPassphrase.length >= 8;
  }

  function getInitials(name) {
    if (typeof getUserInitials === 'function') return getUserInitials(name);
    const parts = String(name || 'U').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function generateTempPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let raw = '';
    for (let i = 0; i < bytes.length; i++) raw += alphabet[bytes[i] % alphabet.length];
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  }

  function persistDbChanges() {
    if (typeof touchDBAndSave === 'function') {
      touchDBAndSave();
    } else if (typeof saveLiveDB === 'function') {
      saveLiveDB();
    }
  }

  // Persist user/auth changes once (avoiding double revision bump) AND flush immediately to linked disk file even if autoSaveToFile is OFF
  async function persistAuthChangeToDisk({ logType = '', logSummary = '', forceOverwrite = false } = {}) {
    if (logType && logSummary && typeof recordChange === 'function') {
      recordChange(logType, logSummary);
    } else {
      persistDbChanges();
    }
    if (typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof linkedFileHandle.createWritable === 'function' && typeof writeDBToLinkedFile === 'function') {
      try {
        const res = await writeDBToLinkedFile({ forceOverwrite });
        return { savedToDisk: Boolean(res?.ok), unlinked: false, res };
      } catch (err) {
        return { savedToDisk: false, unlinked: false, error: err };
      }
    }
    return { savedToDisk: false, unlinked: true };
  }

  function preserveScrollPosition(fn) {
    const modalCard = typeof document !== 'undefined' ? document.getElementById('modalCard') : null;
    const mainEl = typeof document !== 'undefined' ? document.getElementById('mainWorkspace') : null;
    const prevModalTop = modalCard ? modalCard.scrollTop : 0;
    const prevMainTop = mainEl ? mainEl.scrollTop : 0;
    fn();
    if (modalCard) modalCard.scrollTop = prevModalTop;
    if (mainEl) mainEl.scrollTop = prevMainTop;
    if (typeof window !== 'undefined' && typeof isMobileViewport === 'function' && isMobileViewport() && window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  }

  /* ==================== RBAC CORE PREDICATES ==================== */

  function ppGetAuthSession() {
    return {
      ...ppAuthSession,
      permissions: {
        tabs: { ...ppAuthSession.permissions.tabs },
        finance: Boolean(ppAuthSession.permissions.finance),
      },
    };
  }

  function ppIsSessionLocked() {
    return ppAuthSession.mode === 'locked';
  }

  function ppIsMainAdmin() {
    return ppAuthSession.mode === 'admin';
  }

  function ppIsDelegatedAdmin() {
    return ppAuthSession.mode === 'user' && Boolean(ppAuthSession.isAdmin);
  }

  function ppIsNamedUser() {
    return ppAuthSession.mode === 'user';
  }

  function ppIsStandardUser() {
    return ppAuthSession.mode === 'user' && !ppAuthSession.isAdmin;
  }

  function ppHasAdminAccess() {
    if (ppIsSessionLocked()) return false;
    return ppAuthSession.mode === 'open' || ppAuthSession.mode === 'admin' || ppIsDelegatedAdmin();
  }

  function ppCanAccessTab(tab) {
    if (ppIsSessionLocked()) return false;
    if (ppHasAdminAccess()) return true;
    return Boolean(ppAuthSession.permissions?.tabs?.[tab]);
  }

  function ppCanAccessFinance() {
    if (ppIsSessionLocked()) return false;
    if (ppHasAdminAccess()) return true;
    return Boolean(ppAuthSession.permissions?.finance);
  }

  function ppGetFirstAllowedTab() {
    for (const t of ALL_TABS) {
      if (ppCanAccessTab(t)) return t;
    }
    return 'matrix';
  }

  function normalizeUserPermissions(rawPerm) {
    const rawTabs = (rawPerm && rawPerm.tabs && typeof rawPerm.tabs === 'object') ? rawPerm.tabs : {};
    const tabs = {
      matrix: rawTabs.matrix !== undefined ? Boolean(rawTabs.matrix) : true,
      health: rawTabs.health !== undefined ? Boolean(rawTabs.health) : true,
      data: Boolean(rawTabs.data),
      sync: Boolean(rawTabs.sync),
    };
    if (!tabs.matrix && !tabs.health && !tabs.data && !tabs.sync) tabs.matrix = true;
    return { tabs, finance: Boolean(rawPerm && rawPerm.finance) };
  }

  function exitLockedScreenUI() {
    if (typeof document === 'undefined') return;
    document.documentElement?.classList?.remove('pp-session-locked');
    const lockEl = document.getElementById('ppLockedScreen');
    if (lockEl) {
      lockEl.classList.add('hidden');
      lockEl.innerHTML = '';
    }
  }

  function ppApplyAuthenticatedSession(role, userRecord = null, adminNameOverride = '') {
    const db = getDb();
    const ac = ensureAccessControl(db);
    exitLockedScreenUI();
    ppLockedState = null;

    if (role === 'user' && userRecord) {
      const delegatedAdmin = Boolean(userRecord.isAdmin);
      const perms = delegatedAdmin
        ? { tabs: { matrix: true, health: true, data: true, sync: true }, finance: true }
        : normalizeUserPermissions(userRecord.permissions);

      ppAuthSession.mode = 'user';
      ppAuthSession.userId = userRecord.id;
      ppAuthSession.userName = userRecord.name;
      ppAuthSession.roleTitle = userRecord.roleTitle || (delegatedAdmin ? 'Administrator' : 'Team Member');
      ppAuthSession.isAdmin = delegatedAdmin;
      ppAuthSession.mustChangePassword = Boolean(userRecord.mustChangePassword);
      ppAuthSession.permissions = perms;

      if (typeof ui !== 'undefined') {
        ui.userName = userRecord.name;
        if (!delegatedAdmin) {
          ui.demoMode = false;
          ui.whatIfMode = false;
          if (typeof whatIfDB !== 'undefined') whatIfDB = null;
        }
        if (!ppCanAccessTab(ui.activeTab)) {
          ui.activeTab = ppGetFirstAllowedTab();
        }
        if (typeof persistUIPrefs === 'function') persistUIPrefs();
      }
      if (!ppCanAccessFinance() && typeof window !== 'undefined' && typeof window.ppLockFinanceVaultSilently === 'function') {
        window.ppLockFinanceVaultSilently(true);
      }
    } else if (role === 'admin') {
      const adminLabel = String(adminNameOverride || ac.adminName || 'Administrator').trim() || 'Administrator';
      ppAuthSession.mode = 'admin';
      ppAuthSession.userId = '__ADMIN__';
      ppAuthSession.userName = adminLabel;
      ppAuthSession.roleTitle = 'Main Administrator';
      ppAuthSession.isAdmin = true;
      ppAuthSession.mustChangePassword = false;
      ppAuthSession.permissions = {
        tabs: { matrix: true, health: true, data: true, sync: true },
        finance: true,
      };
      if (typeof ui !== 'undefined') {
        if (!ui.userName || ui.userName === 'Project Mgr' || ac.users.some(u => u.name === ui.userName)) {
          ui.userName = adminLabel;
        }
        if (typeof persistUIPrefs === 'function') persistUIPrefs();
      }
    } else {
      ppAuthSession.mode = 'open';
      ppAuthSession.userId = null;
      ppAuthSession.userName = (typeof ui !== 'undefined' && ui.userName) || 'Project Mgr';
      ppAuthSession.roleTitle = '';
      ppAuthSession.isAdmin = false;
      ppAuthSession.mustChangePassword = false;
      ppAuthSession.permissions = {
        tabs: { matrix: true, health: true, data: true, sync: true },
        finance: true,
      };
    }
    ppSyncAuthChromeUI();
    ppRefreshSyncHubUI();
  }

  function ppSyncAuthAfterDbLoad(db) {
    const ac = ensureAccessControl(db);
    if (ppAuthSession.mode === 'locked') {
      if (getMasterKeyActive()) {
        ppApplyAuthenticatedSession('admin', null, ac.adminName);
      } else {
        ppApplyAuthenticatedSession('open');
      }
      return { revoked: false };
    }
    if (ppAuthSession.mode === 'user' && ppAuthSession.userId) {
      const fresh = ac.users.find(u => u && u.id === ppAuthSession.userId);
      if (!fresh || fresh.enabled === false || fresh.needsAdminKeyReset || !fresh.keySlot) {
        ppSignOutAndLockSession('revoked', { skipFlush: true, skipEnvelope: true });
        toast('Your account access was disabled, removed, or requires a password reset by an Administrator.', 'warning');
        return { revoked: true };
      }
      ppApplyAuthenticatedSession('user', fresh);
      return { revoked: false };
    } else if (ppAuthSession.mode === 'admin') {
      ppAuthSession.userName = ac.adminName || 'Administrator';
      ppSyncAuthChromeUI();
      return { revoked: false };
    } else if (getMasterKeyActive()) {
      ppApplyAuthenticatedSession('admin', null, ac.adminName);
      return { revoked: false };
    }
    return { revoked: false };
  }

  /* ==================== FULL-HIDE SIGN OUT, CONNECTION-LOSS WIPE & LOCKED WORKSPACE GATE ==================== */

  function clearPlaintextLocalCaches() {
    try {
      if (typeof STORAGE_KEYS !== 'undefined' && STORAGE_KEYS.LIVE_DB && typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEYS.LIVE_DB);
      }
      if (typeof localStorage !== 'undefined') {
        PLAINTEXT_CACHE_KEYS.forEach(k => {
          try { localStorage.removeItem(k); } catch (_e) {}
        });
      }
    } catch (_err) {}
  }

  function scrubSensitiveWorkspaceDom() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const clearIds = [
      'matrixHead', 'matrixBody', 'matrixFoot', 'matrixFloatingHeader', 'mobileMatrixCards',
      'healthSummaryCards', 'healthDeptBars', 'healthProjectBars', 'healthAlertsList',
      'dataDepartmentsBody', 'dataProjectsBody', 'dataMilestonesBody',
      'changeLogContainer', 'snapshotsContainer', 'modalCard', 'toastContainer',
    ];
    clearIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    document.getElementById('ppAdminAccessCard')?.remove();
    document.getElementById('ppPeopleDirCard')?.remove();
    const extBanner = document.getElementById('externalUpdateBanner');
    if (extBanner) extBanner.classList.add('hidden');
  }

  function closeAllOverlaysForLock() {
    removeAuthOverlay();
    pendingResetUserId = '';
    pendingResetDraft = '';
    pendingEditUserId = '';
    if (typeof closeModal === 'function') {
      try { closeModal(); } catch (_e) {}
    }
    if (typeof closeHeaderWorkspaceMenu === 'function') {
      try { closeHeaderWorkspaceMenu(); } catch (_e) {}
    }
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      document.querySelectorAll('dialog[open]').forEach(dlg => {
        try {
          if (typeof dlg.close === 'function') dlg.close();
          else dlg.removeAttribute('open');
        } catch (_e) {}
      });
      const toastContainer = document.getElementById('toastContainer');
      if (toastContainer) toastContainer.innerHTML = '';
    }
  }

  function renderLockedScreenUI() {
    if (typeof document === 'undefined') return;
    document.documentElement?.classList?.add('pp-session-locked');
    let lockEl = document.getElementById('ppLockedScreen');
    if (!lockEl && document.body) {
      lockEl = document.createElement('section');
      lockEl.id = 'ppLockedScreen';
      lockEl.setAttribute('aria-label', 'Workspace signed out');
      if (typeof document.body.prepend === 'function') document.body.prepend(lockEl);
      else if (typeof document.body.appendChild === 'function') document.body.appendChild(lockEl);
    }
    if (!lockEl) return;

    const reason = ppLockedState?.reason || 'manual';
    const detail = String(ppLockedState?.detail || '').trim();
    const activeHandle = (typeof linkedFileHandle !== 'undefined' && linkedFileHandle)
      || (typeof rememberedFileHandle !== 'undefined' && rememberedFileHandle)
      || null;
    const hasUnlockTarget = Boolean(activeHandle || ppLockedState?.envelope);
    const rawFileName = ppLockedState?.fileName || activeHandle?.name || '';
    const fileLabel = rawFileName && typeof getConnectedFileDisplayPath === 'function'
      ? (getConnectedFileDisplayPath(rawFileName) || rawFileName)
      : rawFileName;

    const copyByReason = {
      connection_lost: {
        badge: 'PulsePlanSecure · Connection Lost',
        badgeCls: 'text-amber-700',
        title: 'Database Connection Lost',
        subtitle: detail
          ? `Connection to the database file was interrupted (${detail}). All local data was cleared from screen, memory, and browser cache until you reconnect and re-enter your password.`
          : 'Connection to the database file was lost. All local data was cleared from screen, memory, and browser cache until you reconnect and re-enter your password.',
        primaryBtn: 'Reconnect & Sign In',
      },
      reconnect_required: {
        badge: 'PulsePlanSecure · Protected',
        badgeCls: 'text-emerald-700',
        title: 'Sign In to Unlock Workspace',
        subtitle: 'Your previous session was protected. Local plaintext data is cleared between reloads — reconnect to your database and enter your password to continue.',
        primaryBtn: 'Reconnect & Sign In',
      },
      unlinked: {
        badge: 'PulsePlanSecure · Disconnected',
        badgeCls: 'text-amber-700',
        title: 'Database Disconnected',
        subtitle: 'The linked database file was disconnected and all local workspace data has been cleared. Open a database file and sign in to resume.',
        primaryBtn: 'Sign In to Workspace',
      },
      inactivity: {
        badge: 'PulsePlanSecure · Protected',
        badgeCls: 'text-emerald-700',
        title: 'Session Locked for Security',
        subtitle: 'Your session timed out due to inactivity. All workspace data was cleared from screen, memory, and browser cache.',
        primaryBtn: 'Sign In to Workspace',
      },
      revoked: {
        badge: 'PulsePlanSecure · Access Updated',
        badgeCls: 'text-rose-700',
        title: 'Access Revoked — Signed Out',
        subtitle: 'Your account access was updated or requires a password reset by an Administrator. All workspace information has been cleared.',
        primaryBtn: 'Sign In as Another User',
      },
      manual: {
        badge: 'PulsePlanSecure · Protected',
        badgeCls: 'text-emerald-700',
        title: 'You Are Signed Out',
        subtitle: 'All roadmap, team, and financial information has been completely hidden and cleared from memory and cache.',
        primaryBtn: 'Sign In to Workspace',
      },
    };
    const copy = copyByReason[reason] || copyByReason.manual;
    const supportsDirectPicker = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

    lockEl.classList.remove('hidden');
    lockEl.innerHTML = `
      <div class="pp-locked-card" role="region" aria-labelledby="ppLockedTitle">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl ${reason === 'connection_lost' ? 'bg-amber-600' : 'bg-indigo-600'} text-white flex items-center justify-center shadow-sm shrink-0">
            <svg class="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-[10px] font-extrabold uppercase tracking-wider ${copy.badgeCls}">${esc(copy.badge)}</div>
            <h2 id="ppLockedTitle" class="text-lg font-extrabold leading-tight" style="color:var(--text-heading,#0f172a)">${esc(copy.title)}</h2>
          </div>
        </div>

        <p class="text-xs leading-relaxed" style="color:var(--text-muted,#64748b)">${esc(copy.subtitle)}</p>

        ${fileLabel ? `
          <div class="px-3 py-2 rounded-xl border text-[11px] space-y-0.5"
            style="border-color:var(--border-subtle,#e2e8f0);background:var(--surface-subtle,#f8fafc)">
            <div style="color:var(--text-muted,#64748b)">Remembered database location:</div>
            <div class="font-bold truncate font-mono text-[10.5px]" title="${esc(fileLabel)}" style="color:var(--text-primary,#0f172a)">${esc(fileLabel)}</div>
          </div>` : ''}

        <div class="space-y-2 pt-1">
          ${hasUnlockTarget ? `
            <button type="button" id="ppLockedSignInBtn"
              class="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition cursor-pointer">
              ${esc(copy.primaryBtn)}
            </button>` : ''}
          ${supportsDirectPicker ? `
            <button type="button" id="ppLockedOpenFileBtn"
              class="w-full py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition cursor-pointer">
              Open Encrypted Database File...
            </button>` : ''}
          <button type="button" id="ppLockedImportFileBtn"
            class="w-full py-2 px-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition cursor-pointer">
            Import Encrypted File (.json)...
          </button>
        </div>

        <div class="flex items-center justify-between gap-2 pt-3 border-t text-[11px]" style="border-color:var(--border-subtle,#e2e8f0);color:var(--text-faint,#64748b)">
          <span>AES-256-GCM · Local data cleared</span>
          <button type="button" id="ppLockedFreshBtn" class="font-semibold hover:underline cursor-pointer" style="color:var(--text-muted,#64748b)">
            Start Empty Workspace
          </button>
        </div>
      </div>`;

    lockEl.querySelector('#ppLockedSignInBtn')?.addEventListener('click', () => {
      ppUnlockFromLockedScreen();
    });
    lockEl.querySelector('#ppLockedOpenFileBtn')?.addEventListener('click', () => {
      if (typeof openSharedDatabaseFile === 'function') openSharedDatabaseFile();
    });
    lockEl.querySelector('#ppLockedImportFileBtn')?.addEventListener('click', () => {
      if (typeof triggerJsonImportPicker === 'function') triggerJsonImportPicker();
      else document.getElementById('jsonImportInput')?.click();
    });
    lockEl.querySelector('#ppLockedFreshBtn')?.addEventListener('click', async () => {
      if (typeof ppConfirmAction === 'function') {
        const ok = await ppConfirmAction({
          title: 'Start a Fresh Empty Workspace?',
          message: 'This disconnects the current session from the locked database and opens an empty local workspace (your file on disk is untouched).',
          confirmLabel: 'Start Empty Workspace',
          tone: 'warning',
        });
        if (!ok) return;
      }
      ppLockedState = null;
      if (typeof linkedFileHandle !== 'undefined') linkedFileHandle = null;
      if (typeof ppClearSecureSessionFlag === 'function') ppClearSecureSessionFlag();
      if (typeof liveDB !== 'undefined' && typeof createEmptyDB === 'function') {
        liveDB = createEmptyDB();
      }
      ppApplyAuthenticatedSession('open');
      if (typeof renderAll === 'function') renderAll();
      toast('Started a fresh empty workspace.', 'info');
    });
  }

  function ppEnterInitialLockedGate(fileName = '', reason = 'reconnect_required') {
    clearPlaintextLocalCaches();
    if (typeof liveDB !== 'undefined' && typeof createEmptyDB === 'function') {
      liveDB = createEmptyDB();
    }
    if (typeof whatIfDB !== 'undefined') whatIfDB = null;
    if (typeof ppSyncPassphrase !== 'undefined') ppSyncPassphrase = '';
    if (typeof window !== 'undefined') {
      window.ppLockFinanceVaultSilently?.(true);
      window.ppClearPbsMemoryAndStopSync?.();
      window.ppResetPeopleDirectoryMemory?.();
      window.ppClearMspMemoryAndStopSync?.();
    }
    ppAuthSession.mode = 'locked';
    ppAuthSession.userId = null;
    ppAuthSession.userName = '';
    ppAuthSession.roleTitle = '';
    ppAuthSession.isAdmin = false;
    ppAuthSession.mustChangePassword = false;
    ppAuthSession.permissions = {
      tabs: { matrix: false, health: false, data: false, sync: false },
      finance: false,
    };
    ppLockedState = {
      envelope: null,
      reason,
      detail: '',
      fileName: String(fileName || ''),
      hadLinkedFile: true,
      lockedAt: new Date().toISOString(),
    };
    scrubSensitiveWorkspaceDom();
    renderLockedScreenUI();
    ppSyncAuthChromeUI();
    if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
  }

  function ppRefreshLockedScreenUI() {
    if (ppIsSessionLocked()) {
      renderLockedScreenUI();
    }
  }

  async function ppSignOutAndLockSession(reason = 'manual', opts = {}) {
    if (reason === 'disabled') {
      if (typeof window !== 'undefined' && typeof window.ppLockFinanceVaultSilently === 'function') {
        window.ppLockFinanceVaultSilently(true);
      }
      ppApplyAuthenticatedSession('open');
      if (typeof renderAll === 'function') renderAll();
      return;
    }
    if (isSigningOut) return;
    isSigningOut = true;

    const skipFlush = Boolean(opts.skipFlush) || reason === 'connection_lost' || reason === 'revoked' || reason === 'unlinked';
    const skipEnvelope = Boolean(opts.skipEnvelope) || reason === 'connection_lost' || reason === 'revoked' || reason === 'unlinked';

    try {
      const linkedName = opts.fileName
        || ((typeof linkedFileHandle !== 'undefined' && linkedFileHandle?.name)
          ? linkedFileHandle.name
          : ((typeof rememberedFileHandle !== 'undefined' && rememberedFileHandle?.name) ? rememberedFileHandle.name : ''));
      const hadLinkedFile = Boolean((typeof linkedFileHandle !== 'undefined' && linkedFileHandle) || reason === 'connection_lost');

      // Wait briefly for any in-flight linked-file save to finish BEFORE clearing ppSyncPassphrase or liveDB!
      const waitStart = Date.now();
      while (typeof isSavingToFile !== 'undefined' && isSavingToFile && Date.now() - waitStart < 4500) {
        await new Promise(r => setTimeout(r, 60));
      }

      // Cancel any queued debounce timer immediately so it cannot fire mid-lock
      if (typeof saveDebounceTimer !== 'undefined' && saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
      }

      // Flush pending writes ONLY on intentional sign-out / inactivity while key & connection are valid
      if (!skipFlush && getMasterKeyActive()) {
        if (hadLinkedFile && typeof linkedFileHandle !== 'undefined' && linkedFileHandle && typeof linkedFileHandle.createWritable === 'function' && typeof writeDBToLinkedFile === 'function') {
          try {
            if (typeof saveQueued !== 'undefined' && saveQueued) {
              await writeDBToLinkedFile({ allowWhileSigningOut: true });
            }
          } catch (_e) {}
        }
        if (typeof window !== 'undefined' && typeof window.ppFlushFinanceVaultIfDirty === 'function') {
          try { await window.ppFlushFinanceVaultIfDirty(); } catch (_e) {}
        }
        if (typeof window !== 'undefined' && typeof window.ppFlushPbsBeforeLock === 'function') {
          try { await window.ppFlushPbsBeforeLock(); } catch (_e) {}
        }
      }

      // Encrypt an in-memory ciphertext-only envelope ONLY for intentional manual/inactivity sign-out when not skipped
      let lockedEnvelope = null;
      const curLive = (typeof liveDB !== 'undefined' && liveDB) ? liveDB : getDb();
      if (!skipEnvelope && curLive && getMasterKeyActive() && typeof encryptPulsePlanData === 'function') {
        try {
          lockedEnvelope = await encryptPulsePlanData(curLive, ppSyncPassphrase);
        } catch (_e) {}
      }

      // Lock & scrub Finance Vault, PBS, People Directory & MSP memory/sync
      if (typeof window !== 'undefined') {
        try { window.ppLockFinanceVaultSilently?.(true); } catch (_e) {}
        try { window.ppClearPbsMemoryAndStopSync?.(); } catch (_e) {}
        try { window.ppResetPeopleDirectoryMemory?.(); } catch (_e) {}
        try { window.ppClearMspMemoryAndStopSync?.(); } catch (_e) {}
      }

      // Clear master key, inactivity timer & file polling
      if (typeof ppSyncPassphrase !== 'undefined') ppSyncPassphrase = '';
      if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
      if (typeof stopFilePolling === 'function') stopFilePolling();

      // Scrub ALL in-memory DBs and localStorage plaintext caches (browser still remembers file handles in IndexedDB!)
      if (typeof liveDB !== 'undefined' && typeof createEmptyDB === 'function') {
        liveDB = createEmptyDB();
      }
      if (typeof whatIfDB !== 'undefined') whatIfDB = null;
      if (typeof ui !== 'undefined') {
        ui.whatIfMode = false;
        ui.demoMode = false;
      }
      if (typeof lastSyncedSnapshot !== 'undefined') lastSyncedSnapshot = null;
      if (typeof pendingAutoReload !== 'undefined') pendingAutoReload = false;
      if (typeof saveQueued !== 'undefined') saveQueued = false;
      if (typeof clearUndoHistory === 'function') clearUndoHistory();
      clearPlaintextLocalCaches();
      closeAllOverlaysForLock();

      ppAuthSession.mode = 'locked';
      ppAuthSession.userId = null;
      ppAuthSession.userName = '';
      ppAuthSession.roleTitle = '';
      ppAuthSession.isAdmin = false;
      ppAuthSession.mustChangePassword = false;
      ppAuthSession.permissions = {
        tabs: { matrix: false, health: false, data: false, sync: false },
        finance: false,
      };
      ppLockedState = {
        envelope: lockedEnvelope,
        reason,
        detail: String(opts.detail || ''),
        fileName: linkedName,
        hadLinkedFile,
        lockedAt: new Date().toISOString(),
      };

      // Re-render once against empty DB AND explicitly scrub sensitive DOM containers so zero text remains anywhere
      if (typeof renderAll === 'function') {
        try { renderAll(); } catch (_e) {}
      }
      scrubSensitiveWorkspaceDom();
      renderLockedScreenUI();
      if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();

      if (reason === 'inactivity') {
        toast('Session locked after inactivity. All workspace info cleared from screen.', 'info');
      } else if (reason === 'connection_lost') {
        toast('Database connection lost. Local data cleared until reconnected and unlocked.', 'warning');
      } else if (reason === 'manual') {
        toast('Signed out. All workspace information cleared from screen.', 'info');
      }
    } finally {
      isSigningOut = false;
    }
  }

  async function ppUnlockFromLockedScreen() {
    let envelope = null;
    let sourceFileName = ppLockedState?.fileName || 'Encrypted Workspace';
    let fromLinkedDisk = false;
    let diskLastModified = 0;
    const mustReadFreshDisk = ppLockedState?.reason === 'connection_lost' || ppLockedState?.reason === 'reconnect_required';

    let diskHandle = (typeof linkedFileHandle !== 'undefined' && linkedFileHandle)
      || (typeof rememberedFileHandle !== 'undefined' && rememberedFileHandle)
      || null;

    if (diskHandle) {
      try {
        if (typeof diskHandle.queryPermission === 'function') {
          let perm = await diskHandle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted' && typeof diskHandle.requestPermission === 'function') {
            perm = await diskHandle.requestPermission({ mode: 'readwrite' });
          }
          if (perm !== 'granted') diskHandle = null;
        }
        if (diskHandle) {
          const file = await diskHandle.getFile();
          diskLastModified = file.lastModified || 0;
          const raw = typeof ppReadRawFileText === 'function' ? await ppReadRawFileText(file) : await file.text();
          const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
          if (parsed && parsed.format === 'pulseplan-encrypted-v1') {
            envelope = parsed;
            sourceFileName = diskHandle.name || sourceFileName;
            fromLinkedDisk = true;
            if (typeof linkedFileHandle !== 'undefined') linkedFileHandle = diskHandle;
            if (typeof rememberedFileHandle !== 'undefined') rememberedFileHandle = diskHandle;
          } else if (parsed && typeof parsed === 'object' && typeof attachAndLoadFileHandle === 'function') {
            // Disk file was unencrypted JSON — load it cleanly through the normal handler
            await attachAndLoadFileHandle(diskHandle, false);
            return;
          }
        }
      } catch (_e) {
        diskHandle = null;
      }
    }

    if (!envelope && !mustReadFreshDisk && ppLockedState?.envelope) {
      envelope = ppLockedState.envelope;
    }

    if (!envelope) {
      if (mustReadFreshDisk) {
        toast('Database file is still unreachable or permission was not granted. Click "Open Encrypted Database File..." to locate it.', 'warning');
      } else if (typeof openSharedDatabaseFile === 'function' && typeof window.showOpenFilePicker === 'function') {
        openSharedDatabaseFile();
      } else if (typeof triggerJsonImportPicker === 'function') {
        triggerJsonImportPicker();
      } else {
        toast('Open an encrypted PulsePlan file to sign back in.', 'info');
      }
      return;
    }

    const res = await ppPromptEncryptedFileLogin(envelope, { fileName: sourceFileName });
    if (!res || !res.plainJson || !res.masterPass) return;

    const parsedDb = JSON.parse(res.plainJson);
    const normalized = typeof normalizeAndMigrateDB === 'function' ? normalizeAndMigrateDB(parsedDb) : parsedDb;
    if (typeof liveDB !== 'undefined') liveDB = normalized;
    if (typeof ppSyncPassphrase !== 'undefined') ppSyncPassphrase = res.masterPass;
    if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
    if (typeof ppMarkSecureSessionFlag === 'function') ppMarkSecureSessionFlag(sourceFileName, true);

    if (typeof ppPersistLiveDBCacheSafe === 'function') {
      ppPersistLiveDBCacheSafe(normalized);
    }

    if (fromLinkedDisk) {
      if (typeof lastKnownFileModified !== 'undefined') lastKnownFileModified = diskLastModified;
      if (typeof lastWrittenId !== 'undefined') lastWrittenId = normalized.meta?.lastWriteId || '';
      if (typeof lastSyncedSnapshot !== 'undefined' && typeof cloneSyncSnapshot === 'function') {
        lastSyncedSnapshot = cloneSyncSnapshot(normalized);
      }
      if (typeof syncWarningState !== 'undefined') syncWarningState = null;
      if (typeof saveQueued !== 'undefined') saveQueued = false;
      if (typeof pendingAutoReload !== 'undefined') pendingAutoReload = false;
      const extBanner = typeof document !== 'undefined' ? document.getElementById('externalUpdateBanner') : null;
      if (extBanner) extBanner.classList.add('hidden');
      if (typeof startFilePolling === 'function') startFilePolling();
      if (typeof updateFileSyncUI === 'function') updateFileSyncUI();
    }

    ppApplyAuthenticatedSession(res.authRole, res.userRecord, envelope.auth?.adminName);
    if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
    if (typeof renderAll === 'function') renderAll();

    // Auto-open the linked Finance Vault and PBS folder if remembered on this device
    if (typeof window !== 'undefined') {
      if (typeof window.ppTryAutoOpenFinanceVault === 'function') {
        window.ppTryAutoOpenFinanceVault({ allowPermissionPrompt: true, silent: false }).catch(() => {});
      }
      if (typeof window.ppTryAutoReconnectPbsFolder === 'function') {
        window.ppTryAutoReconnectPbsFolder({ allowPrompt: false }).catch(() => {});
      }
    }

    const who = res.authRole === 'admin'
      ? (normalized.accessControl?.adminName || 'Administrator')
      : (res.userRecord?.name || 'User');
    toast(`Welcome back, ${who}.`, 'success');
    ppCheckForcedPasswordChange();
  }

  function ppOnSessionLocked(reason = 'manual') {
    if (reason === 'disabled') {
      if (typeof window !== 'undefined' && typeof window.ppLockFinanceVaultSilently === 'function') {
        window.ppLockFinanceVaultSilently(true);
      }
      ppApplyAuthenticatedSession('open');
      if (typeof renderAll === 'function') renderAll();
      return;
    }
    ppSignOutAndLockSession(reason);
  }

  /* ==================== CRYPTO ACTIONS: PROVISION, EDIT, ENABLE/DISABLE, RESET, SELF-CHANGE & MAIN ADMIN CHANGE PASSWORD ==================== */

  async function createOrUpdateUserAccount({ name, roleTitle = '', isAdmin = false, permissions, tempPassword, mustChangePassword = true }) {
    if (!ppHasAdminAccess()) throw new Error('Administrator privileges required.');
    if (!getMasterKeyActive()) throw new Error('Enable the Administrator encryption password first.');
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('User name is required.');
    if (!tempPassword || tempPassword.length < 8) throw new Error('Initial password must be at least 8 characters.');

    const db = getDb();
    const ac = ensureAccessControl(db);
    if (cleanName.toLowerCase() === String(ac.adminName || 'Administrator').trim().toLowerCase()) {
      throw new Error(`Name "${cleanName}" is reserved for the Main Administrator.`);
    }
    if (ac.users.some(u => u && u.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`A user named "${cleanName}" already exists.`);
    }

    const userId = typeof uid === 'function' ? uid('usr') : `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const keySlot = await ppWrapMasterPassphrase(ppSyncPassphrase, tempPassword, userId);

    // Re-check duplicates after async PBKDF2 to guarantee zero duplicate entries on double-submit
    if (ac.users.some(u => u && u.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`A user named "${cleanName}" already exists.`);
    }

    const grantedAdmin = Boolean(isAdmin);
    // Preserve custom base permissions even when isAdmin=true so revoking Admin genuinely restores custom permissions!
    const basePerms = normalizeUserPermissions(permissions);
    const record = {
      id: userId,
      name: cleanName,
      roleTitle: String(roleTitle || '').trim(),
      enabled: true,
      isAdmin: grantedAdmin,
      mustChangePassword: Boolean(mustChangePassword),
      needsAdminKeyReset: false,
      permissions: basePerms,
      keySlot,
      updatedAt: new Date().toISOString(),
    };
    ac.users.push(record);
    await persistAuthChangeToDisk({
      logType: 'Access',
      logSummary: `Added user login "${cleanName}" (${grantedAdmin ? 'Admin Rights' : (basePerms.finance ? 'Finance ON' : 'No Finance')})`,
    });
    return record;
  }

  async function updateUserAccountDetails(userId, { name, roleTitle = '' }) {
    if (!ppHasAdminAccess()) throw new Error('Administrator privileges required.');
    const cleanName = String(name || '').trim();
    const cleanRole = String(roleTitle || '').trim();
    if (!cleanName) throw new Error('User display name cannot be empty.');
    const db = getDb();
    const ac = ensureAccessControl(db);
    const user = ac.users.find(u => u && u.id === userId);
    if (!user) throw new Error('User not found.');
    if (cleanName.toLowerCase() === String(ac.adminName || 'Administrator').trim().toLowerCase()) {
      throw new Error(`Name "${cleanName}" is reserved for the Main Administrator.`);
    }
    if (ac.users.some(u => u && u.id !== userId && u.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`Another user named "${cleanName}" already exists.`);
    }
    const prevName = user.name;
    user.name = cleanName;
    user.roleTitle = cleanRole;
    user.updatedAt = new Date().toISOString();
    if (ppIsNamedUser() && ppAuthSession.userId === user.id) {
      ppAuthSession.userName = cleanName;
      ppAuthSession.roleTitle = cleanRole || (user.isAdmin ? 'Administrator' : 'Team Member');
      if (typeof ui !== 'undefined') {
        ui.userName = cleanName;
        if (typeof persistUIPrefs === 'function') persistUIPrefs();
      }
      if (typeof updateHeaderUserDisplay === 'function') updateHeaderUserDisplay();
    }
    await persistAuthChangeToDisk({
      logType: 'Access',
      logSummary: prevName !== cleanName
        ? `Renamed user "${prevName}" to "${cleanName}"${cleanRole ? ` (${cleanRole})` : ''}`
        : `Updated role for "${cleanName}" to "${cleanRole || 'Team Member'}"`,
    });
    return user;
  }

  async function toggleUserAccountEnabled(userId, nextEnabled) {
    if (!ppHasAdminAccess()) throw new Error('Administrator privileges required.');
    if (ppIsNamedUser() && ppAuthSession.userId === userId) {
      throw new Error('You cannot disable your currently signed-in account.');
    }
    const db = getDb();
    const ac = ensureAccessControl(db);
    const user = ac.users.find(u => u && u.id === userId);
    if (!user) throw new Error('User not found.');
    const enabled = typeof nextEnabled === 'boolean' ? nextEnabled : (user.enabled === false);
    user.enabled = enabled;
    user.updatedAt = new Date().toISOString();
    await persistAuthChangeToDisk({
      logType: 'Access',
      logSummary: `${enabled ? 'Re-enabled' : 'Disabled'} user account "${user.name}"`,
    });
    return user;
  }

  async function adminResetUserPassword(userId, newTempPassword, requireChange = true) {
    if (!ppHasAdminAccess()) throw new Error('Administrator privileges required.');
    if (!getMasterKeyActive()) throw new Error('Enable the Administrator encryption password first.');
    if (ppIsNamedUser() && ppAuthSession.userId === userId) {
      throw new Error('Use "Change My Personal Password" to update your own password.');
    }
    if (!newTempPassword || newTempPassword.length < 8) throw new Error('Temporary password must be at least 8 characters.');

    const db = getDb();
    const ac = ensureAccessControl(db);
    const user = ac.users.find(u => u && u.id === userId);
    if (!user) throw new Error('User not found.');

    user.keySlot = await ppWrapMasterPassphrase(ppSyncPassphrase, newTempPassword, user.id);
    user.mustChangePassword = Boolean(requireChange);
    user.needsAdminKeyReset = false;
    user.enabled = true;
    user.updatedAt = new Date().toISOString();

    await persistAuthChangeToDisk({
      logType: 'Access',
      logSummary: `Administrator reset password for "${user.name}"`,
    });
    return user;
  }

  async function changeCurrentUserPassword({ currentPassword = '', newPassword, skipCurrentVerify = false }) {
    if (!ppIsNamedUser() || !ppAuthSession.userId) {
      throw new Error('Only signed-in team users can use personal password change.');
    }
    if (!getMasterKeyActive()) {
      throw new Error('Active encrypted session required.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long.');
    }
    if (!skipCurrentVerify && currentPassword && newPassword === currentPassword) {
      throw new Error('New password must be different from your current password.');
    }
    const db = getDb();
    const ac = ensureAccessControl(db);
    const user = ac.users.find(u => u && u.id === ppAuthSession.userId);
    if (!user) throw new Error('User account record not found in database.');

    let masterToWrap = ppSyncPassphrase;
    if (!skipCurrentVerify) {
      if (!currentPassword) throw new Error('Enter your current password.');
      masterToWrap = await ppUnwrapMasterPassphrase(user.keySlot, currentPassword, user.id);
    }

    user.keySlot = await ppWrapMasterPassphrase(masterToWrap, newPassword, user.id);
    user.mustChangePassword = false;
    user.needsAdminKeyReset = false;
    user.updatedAt = new Date().toISOString();
    ppAuthSession.mustChangePassword = false;

    await persistAuthChangeToDisk({
      logType: 'Access',
      logSummary: `"${user.name}" updated their personal password`,
    });
    return user;
  }

  async function changeMainAdminPassword({ currentPassword, newPassword }) {
    if (ppIsNamedUser()) {
      throw new Error('Only the Main Administrator can change the Main Administrator password.');
    }
    if (!getMasterKeyActive()) {
      throw new Error('Administrator encryption is not active yet. Enable encryption first.');
    }
    if (!currentPassword) {
      throw new Error('Enter your current Administrator password.');
    }
    if (currentPassword !== ppSyncPassphrase) {
      throw new Error('Current Administrator password is incorrect.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New Administrator password must be at least 8 characters long.');
    }
    if (newPassword === currentPassword) {
      throw new Error('New password must be different from your current password.');
    }

    const oldPassword = currentPassword;
    const db = getDb();
    const ac = ensureAccessControl(db);
    const nowIso = new Date().toISOString();

    // Rotate master encryption password
    ppSyncPassphrase = newPassword;
    if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();

    // Scrub old wrapped key slots (encrypted against previous Admin key) and flag users for reset
    let resetUserCount = 0;
    ac.users.forEach(u => {
      if (!u) return;
      u.keySlot = null;
      u.needsAdminKeyReset = true;
      u.mustChangePassword = true;
      u.updatedAt = nowIso;
      if (u.enabled !== false) resetUserCount++;
    });

    // Record change once & flush encrypted main DB to linked disk file if connected
    const diskRes = await persistAuthChangeToDisk({
      logType: 'Security',
      logSummary: 'Main Administrator changed the master encryption password',
      forceOverwrite: true,
    });
    const mainFileReencrypted = Boolean(diskRes.savedToDisk);

    // Re-encrypt separate Finance Vault (even attempting seamless unlock with oldPassword if locked)
    let financeResult = { unlocked: false, reencryptedOnDisk: false, needsManualDownload: false, needsAttention: false };
    if (typeof window !== 'undefined' && typeof window.ppReencryptFinanceVaultNow === 'function') {
      try {
        financeResult = await window.ppReencryptFinanceVaultNow(newPassword, oldPassword);
      } catch (_e) {
        financeResult = { unlocked: false, reencryptedOnDisk: false, needsManualDownload: false, needsAttention: true };
      }
    }

    // Re-encrypt all encrypted PBS files in the linked PBS shared folder
    let pbsResult = { attempted: false, rotatedCount: 0, failedFiles: [], needsAttention: false };
    if (typeof window !== 'undefined' && typeof window.ppReencryptAllPbsFilesInFolder === 'function') {
      try {
        pbsResult = await window.ppReencryptAllPbsFilesInFolder(oldPassword, newPassword);
      } catch (_e) {
        pbsResult = { attempted: true, rotatedCount: 0, failedFiles: ['(error)'], needsAttention: true };
      }
    }

    ppApplyAuthenticatedSession('admin', null, ac.adminName);
    if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
    if (typeof renderAll === 'function') renderAll();

    return { resetUserCount, mainFileReencrypted, financeResult, pbsResult };
  }

  async function authenticateInMemoryAccount(accountId, password) {
    if (!password) throw new Error('Please enter your password.');
    const db = getDb();
    const ac = ensureAccessControl(db);

    if (accountId === '__ADMIN__') {
      if (getMasterKeyActive()) {
        if (password !== ppSyncPassphrase) {
          throw new Error('Incorrect Administrator password.');
        }
        ppApplyAuthenticatedSession('admin', null, ac.adminName);
        if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
        if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
        return { authRole: 'admin', userRecord: null };
      }
      if (ac.users.length > 0) {
        throw new Error('Cannot set a new Administrator password while existing team accounts are configured. Unlock the encrypted file with the Main Administrator password first.');
      }
      if (password.length < 8) throw new Error('Administrator password must be at least 8 characters.');
      ppSyncPassphrase = password;
      ppApplyAuthenticatedSession('admin', null, ac.adminName);
      if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
      if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
      return { authRole: 'admin', userRecord: null };
    }

    const user = ac.users.find(u => u && u.id === accountId);
    if (!user || user.enabled === false) {
      throw new Error('User account is disabled or not found.');
    }
    if (user.needsAdminKeyReset || !user.keySlot) {
      throw new Error('Password reset required by the Administrator before signing in.');
    }
    const unwrappedMaster = await ppUnwrapMasterPassphrase(user.keySlot, password, user.id);
    if (getMasterKeyActive() && unwrappedMaster !== ppSyncPassphrase) {
      throw new Error('This account key is outdated. Ask your Administrator to reset your password.');
    }
    ppSyncPassphrase = unwrappedMaster;
    if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
    ppApplyAuthenticatedSession('user', user);
    if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
    return { authRole: 'user', userRecord: user };
  }

  /* ==================== MODERN SIGN-IN DIALOG WITH USER DROPDOWN ==================== */

  let activeAuthKeyHandler = null;

  function removeAuthOverlay() {
    if (activeAuthKeyHandler && typeof document !== 'undefined') {
      document.removeEventListener('keydown', activeAuthKeyHandler, true);
      activeAuthKeyHandler = null;
    }
    document.getElementById('ppAuthOverlay')?.remove();
  }

  function renderModernLoginDialog({ title, subtitle, adminName, accounts, resetRequiredUsers = [], defaultAccountId, onAuthenticate, onCancel }) {
    removeAuthOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'ppAuthOverlay';
    overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
    overlay.style.background = 'rgba(15, 23, 42, 0.58)';
    overlay.style.backdropFilter = 'blur(4px)';

    const allAccounts = [
      {
        id: '__ADMIN__',
        name: adminName || 'Administrator',
        roleTitle: 'Main Administrator · Full Access',
        isMainAdmin: true,
        isAdmin: true,
        mustChange: false,
      },
      ...accounts.map(u => ({
        id: u.id,
        name: u.name,
        roleTitle: u.isAdmin ? (u.roleTitle ? `${u.roleTitle} · Admin` : 'Administrator') : (u.roleTitle || 'Team Member'),
        isMainAdmin: false,
        isAdmin: Boolean(u.isAdmin),
        mustChange: Boolean(u.mustChangePassword),
      })),
    ];

    let selectedId = allAccounts.some(a => a.id === defaultAccountId)
      ? defaultAccountId
      : '__ADMIN__';

    const optionsHtml = allAccounts.map(acct => {
      const roleSuffix = acct.isMainAdmin
        ? 'Main Administrator'
        : (acct.isAdmin ? 'Admin' : (acct.roleTitle || 'Team Member'));
      const tempSuffix = acct.mustChange ? ' · Temp Password' : '';
      return `<option value="${esc(acct.id)}" ${acct.id === selectedId ? 'selected' : ''}>${esc(acct.name)} (${esc(roleSuffix)}${tempSuffix})</option>`;
    }).join('') + (Array.isArray(resetRequiredUsers) && resetRequiredUsers.length > 0
      ? resetRequiredUsers.map(u => `<option value="" disabled>${esc(u.name || 'User')} (Password reset required by Admin)</option>`).join('')
      : '');

    const resetNoticeHtml = Array.isArray(resetRequiredUsers) && resetRequiredUsers.length > 0
      ? `<div class="rounded-xl px-3 py-2 text-[11px] bg-amber-50 text-amber-900 border border-amber-200 leading-relaxed">
          <strong>Password Reset Required:</strong> ${esc(resetRequiredUsers.map(u => u.name).filter(Boolean).join(', '))} cannot sign in until an Administrator assigns a new temporary password.
        </div>`
      : '';

    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="ppLoginTitle"
        class="w-full max-w-md rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden text-xs"
        style="background:var(--surface-card,#ffffff);color:var(--text-primary,#0f172a);border-color:var(--border-subtle,#cbd5e1)">
        <div class="p-5 space-y-4">
          <div class="flex items-start justify-between gap-3 pp-modal-header-row">
            <div class="flex items-start gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <div class="min-w-0">
                <h2 id="ppLoginTitle" class="text-base font-extrabold" style="color:var(--text-heading,#0f172a)">${esc(title)}</h2>
                <p class="text-[11px] mt-0.5 leading-relaxed" style="color:var(--text-muted,#64748b)">${esc(subtitle)}</p>
              </div>
            </div>
            <button type="button" id="ppLoginCloseBtn" aria-label="Close sign in dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold cursor-pointer shrink-0">&times;</button>
          </div>

          <form id="ppLoginForm" class="space-y-3.5" onsubmit="return false;">
            <div class="space-y-1.5">
              <label for="ppLoginAcctSelect" class="block text-[11px] font-bold uppercase tracking-wider" style="color:var(--text-faint,#64748b)">Select User Account</label>
              <select id="ppLoginAcctSelect" class="pp-login-select" aria-label="Select user account">${optionsHtml}</select>
              <div id="ppLoginSelectedPreview" class="pp-login-preview"></div>
            </div>

            ${resetNoticeHtml}

            <div class="space-y-1.5">
              <label for="ppLoginPassword" id="ppLoginPwLabel" class="block font-semibold" style="color:var(--text-secondary,#334155)">Password</label>
              <div class="pp-pw-input-row">
                <input id="ppLoginPassword" type="password" autocomplete="current-password" placeholder="Enter your password..."
                  class="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium"
                  style="background:var(--surface-subtle,#f8fafc);color:var(--text-primary,#0f172a);border-color:var(--border-subtle,#cbd5e1)" />
                <button type="button" id="ppLoginEyeBtn" class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold transition cursor-pointer shrink-0">Show</button>
              </div>
            </div>

            <div id="ppLoginErr" role="alert" class="hidden rounded-xl px-3 py-2 text-[11.5px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"></div>

            <div class="flex items-center justify-between gap-2 pt-2 border-t" style="border-color:var(--border-subtle,#e2e8f0)">
              <span class="text-[10.5px]" style="color:var(--text-faint,#64748b)">AES-256-GCM · Local Zero-Server Auth</span>
              <div class="flex items-center gap-2 shrink-0">
                <button type="button" id="ppLoginCancelBtn" class="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer">Cancel</button>
                <button type="submit" id="ppLoginSubmitBtn" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition cursor-pointer">Sign In</button>
              </div>
            </div>
          </form>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const acctSel = overlay.querySelector('#ppLoginAcctSelect');
    const previewEl = overlay.querySelector('#ppLoginSelectedPreview');
    const pwInput = overlay.querySelector('#ppLoginPassword');
    const pwLabel = overlay.querySelector('#ppLoginPwLabel');
    const errBox = overlay.querySelector('#ppLoginErr');
    const submitBtn = overlay.querySelector('#ppLoginSubmitBtn');
    const eyeBtn = overlay.querySelector('#ppLoginEyeBtn');

    const updateSelectedUI = () => {
      const acct = allAccounts.find(a => a.id === selectedId) || allAccounts[0];
      if (acctSel && acctSel.value !== acct.id) acctSel.value = acct.id;
      if (pwLabel) pwLabel.textContent = acct.isMainAdmin ? `${acct.name} Password` : `Password for ${acct.name}`;
      if (pwInput) pwInput.placeholder = acct.isMainAdmin ? 'Enter Main Administrator password...' : `Enter ${acct.name}'s password...`;
      if (previewEl) {
        const badgeText = acct.isMainAdmin ? 'Main Admin' : (acct.isAdmin ? 'Admin' : 'Member');
        const badgeCls = acct.isAdmin ? 'pp-role-admin' : 'pp-role-user';
        previewEl.innerHTML = `
          <span class="pp-auth-avatar ${acct.isAdmin ? 'pp-auth-avatar-admin' : ''}">${acct.isMainAdmin ? 'AD' : esc(getInitials(acct.name))}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-extrabold truncate" style="color:var(--text-heading,#0f172a)">${esc(acct.name)}</span>
              <span class="pp-role-badge ${badgeCls}">${badgeText}</span>
              ${acct.mustChange ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9.5px] font-bold">Temp Password</span>' : ''}
            </div>
            <div class="text-[11px] truncate" style="color:var(--text-muted,#64748b)">
              ${acct.mustChange ? 'You will choose your personal password right after signing in.' : esc(acct.roleTitle)}
            </div>
          </div>`;
      }
      if (errBox) errBox.classList.add('hidden');
      pwInput?.focus();
    };

    acctSel?.addEventListener('change', () => {
      selectedId = acctSel.value || '__ADMIN__';
      updateSelectedUI();
    });

    eyeBtn?.addEventListener('click', () => {
      if (!pwInput) return;
      const show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      eyeBtn.textContent = show ? 'Hide' : 'Show';
    });

    const cancelAll = () => {
      removeAuthOverlay();
      if (typeof onCancel === 'function') onCancel();
    };

    overlay.querySelector('#ppLoginCloseBtn')?.addEventListener('click', cancelAll);
    overlay.querySelector('#ppLoginCancelBtn')?.addEventListener('click', cancelAll);

    // Document-level Escape close & Tab focus trap while dialog is open
    activeAuthKeyHandler = (ev) => {
      if (!document.getElementById('ppAuthOverlay')) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancelAll();
        return;
      }
      if (ev.key === 'Tab') {
        const focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', activeAuthKeyHandler, true);

    overlay.querySelector('#ppLoginForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pw = (pwInput?.value || '').trim();
      if (!pw) {
        if (errBox) {
          errBox.textContent = 'Please enter your password.';
          errBox.classList.remove('hidden');
        }
        pwInput?.focus();
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';
      }
      if (errBox) errBox.classList.add('hidden');
      try {
        await onAuthenticate(selectedId, pw);
        removeAuthOverlay();
      } catch (err) {
        if (errBox) {
          errBox.textContent = err?.message || 'Sign-in failed. Check your password.';
          errBox.classList.remove('hidden');
        }
        if (pwInput) {
          pwInput.select();
          pwInput.focus();
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In';
        }
      }
    });

    updateSelectedUI();
  }

  function ppPromptEncryptedFileLogin(envelope, opts = {}) {
    return new Promise((resolve) => {
      const authUsers = Array.isArray(envelope?.auth?.users) ? envelope.auth.users : [];
      const resetRequiredUsers = Array.isArray(envelope?.auth?.resetRequiredUsers) ? envelope.auth.resetRequiredUsers : [];
      const adminName = envelope?.auth?.adminName || 'Administrator';
      const fileLabel = opts.fileName ? `"${opts.fileName}"` : 'encrypted PulsePlan database';
      const hasAnyTeam = authUsers.length > 0 || resetRequiredUsers.length > 0;
      renderModernLoginDialog({
        title: hasAnyTeam ? 'Sign In to Workspace' : 'Unlock Encrypted Workspace',
        subtitle: hasAnyTeam
          ? `Select your account from the dropdown to unlock ${fileLabel}. Encryption stays protected by the Administrator master key.`
          : `Enter the Administrator password to decrypt and open ${fileLabel}.`,
        adminName,
        accounts: authUsers,
        resetRequiredUsers,
        defaultAccountId: '__ADMIN__',
        onAuthenticate: async (accountId, password) => {
          const result = await ppDecryptWithUserCredentials(envelope, accountId, password);
          resolve(result);
        },
        onCancel: () => resolve(null),
      });
    });
  }

  function ppOpenSwitchLoginModal(preferredAccountId = '') {
    const db = getDb();
    const ac = ensureAccessControl(db);
    const activeUsers = ac.users.filter(u => u && u.enabled !== false && u.keySlot && !u.needsAdminKeyReset);
    const resetRequiredUsers = ac.users.filter(u => u && u.enabled !== false && (!u.keySlot || u.needsAdminKeyReset));
    renderModernLoginDialog({
      title: 'Switch Account / Sign In',
      subtitle: 'Choose Administrator or any team user from the dropdown. Permissions and Finance access update immediately.',
      adminName: ac.adminName || 'Administrator',
      accounts: activeUsers,
      resetRequiredUsers,
      defaultAccountId: preferredAccountId || (ppIsNamedUser() ? '__ADMIN__' : (activeUsers[0]?.id || '__ADMIN__')),
      onAuthenticate: async (accountId, password) => {
        const res = await authenticateInMemoryAccount(accountId, password);
        if (typeof renderAll === 'function') renderAll();
        if (typeof window !== 'undefined' && typeof window.ppTryAutoOpenFinanceVault === 'function') {
          window.ppTryAutoOpenFinanceVault({ allowPermissionPrompt: true, silent: true }).catch(() => {});
        }
        if (res.authRole === 'admin') {
          toast(`Signed in as ${ac.adminName || 'Administrator'} (Main Administrator)`, 'success');
        } else {
          toast(`Signed in as ${res.userRecord.name}${res.userRecord.isAdmin ? ' (Admin)' : ''}`, 'success');
          if (res.userRecord.mustChangePassword) {
            setTimeout(() => ppOpenChangeMyPasswordModal(true), 120);
          }
        }
      },
      onCancel: () => {},
    });
  }

  /* ==================== PASSWORD CHANGE MODALS (PERSONAL USER & MAIN ADMINISTRATOR) ==================== */

  function ppCheckForcedPasswordChange() {
    if (ppIsNamedUser() && ppAuthSession.mustChangePassword) {
      ppOpenChangeMyPasswordModal(true);
    }
  }

  function ppOpenPasswordActionModal() {
    if (ppIsNamedUser()) {
      ppOpenChangeMyPasswordModal(false);
    } else if (getMasterKeyActive()) {
      ppOpenChangeAdminPasswordModal();
    } else if (typeof openSyncEncryptionDialog === 'function') {
      openSyncEncryptionDialog();
    }
  }

  function ppOpenChangeAdminPasswordModal() {
    if (ppIsNamedUser()) {
      toast('Only the Main Administrator can change the Main Administrator password.', 'warning');
      return;
    }
    if (!getMasterKeyActive()) {
      if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog();
      return;
    }
    const db = getDb();
    const ac = ensureAccessControl(db);
    const activeUsersCount = ac.users.filter(u => u && u.enabled !== false).length;

    showModal(`
      <form id="ppChangeAdminPwForm" class="p-5 space-y-4 text-xs" onsubmit="return false;">
        <div class="flex items-start justify-between gap-3 pp-modal-header-row">
          <div class="flex items-start gap-2.5 min-w-0">
            <span class="pp-auth-avatar pp-auth-avatar-admin">AD</span>
            <div class="min-w-0">
              <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">Change Administrator Password</h3>
              <p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                Verify your current Main Administrator password, then choose a new master password (min 8 chars). Synced main DB, Finance Vault, and PBS folder files re-encrypt automatically.
              </p>
            </div>
          </div>
          <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold shrink-0 cursor-pointer">&times;</button>
        </div>

        ${activeUsersCount > 0 ? `
          <div class="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-[11px] leading-relaxed">
            <strong>Team Password Notice:</strong> ${activeUsersCount} team user${activeUsersCount === 1 ? '' : 's'} currently wrap your existing master key. After changing your Administrator password, their temporary passwords will be flagged so you can reset them in <strong>Team Access Manager</strong>.
          </div>` : ''}

        <div class="space-y-1">
          <label for="ppCurAdminPw" class="block font-semibold text-slate-700">Current Administrator Password</label>
          <input id="ppCurAdminPw" type="password" autocomplete="current-password" placeholder="Enter your current Administrator password..."
            class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs" />
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label for="ppNewAdminPw" class="block font-semibold text-slate-700">New Administrator Password (min 8 chars)</label>
            <span id="ppAdminPwStrengthLbl" class="text-[10px] font-bold text-slate-400"></span>
          </div>
          <div class="pp-pw-input-row">
            <input id="ppNewAdminPw" type="password" autocomplete="new-password" placeholder="Choose a strong new Administrator password..."
              class="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs" />
            <button type="button" id="ppAdminPwEyeBtn" class="px-2.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold cursor-pointer">Show</button>
          </div>
          <div class="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div id="ppAdminPwStrengthBar" class="h-full rounded-full bg-slate-200 transition-all" style="width:0%"></div>
          </div>
        </div>

        <div class="space-y-1">
          <label for="ppConfAdminPw" class="block font-semibold text-slate-700">Confirm New Administrator Password</label>
          <input id="ppConfAdminPw" type="password" autocomplete="new-password" placeholder="Repeat new Administrator password..."
            class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs" />
        </div>

        <div id="ppChangeAdminPwErr" role="alert" class="hidden rounded-xl px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200 font-semibold"></div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onclick="closeModal()" class="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer">Cancel</button>
          <button type="submit" id="ppChangeAdminPwSubmit" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer">Update Admin Password</button>
        </div>
      </form>`, 'max-w-md');

    const curInp = document.getElementById('ppCurAdminPw');
    const newInp = document.getElementById('ppNewAdminPw');
    const confInp = document.getElementById('ppConfAdminPw');
    const eyeBtn = document.getElementById('ppAdminPwEyeBtn');
    const errEl = document.getElementById('ppChangeAdminPwErr');
    const submitBtn = document.getElementById('ppChangeAdminPwSubmit');

    newInp?.addEventListener('input', () => {
      if (typeof ppEvaluatePassphraseStrength !== 'function') return;
      const st = ppEvaluatePassphraseStrength((newInp.value || '').trim());
      const bar = document.getElementById('ppAdminPwStrengthBar');
      const lbl = document.getElementById('ppAdminPwStrengthLbl');
      if (bar) {
        bar.style.width = `${st.pct}%`;
        bar.className = `h-full rounded-full transition-all ${st.color}`;
      }
      if (lbl) {
        lbl.textContent = st.label;
        lbl.className = `text-[10px] font-bold ${st.text}`;
      }
    });

    eyeBtn?.addEventListener('click', () => {
      const show = newInp.type === 'password';
      [curInp, newInp, confInp].forEach(inp => { if (inp) inp.type = show ? 'text' : 'password'; });
      eyeBtn.textContent = show ? 'Hide' : 'Show';
    });

    document.getElementById('ppChangeAdminPwForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const curPw = (curInp?.value || '').trim();
      const nextPw = (newInp?.value || '').trim();
      const confPw = (confInp?.value || '').trim();
      if (!curPw) {
        errEl.textContent = 'Enter your current Administrator password.';
        errEl.classList.remove('hidden');
        return;
      }
      if (nextPw.length < 8) {
        errEl.textContent = 'New Administrator password must be at least 8 characters long.';
        errEl.classList.remove('hidden');
        return;
      }
      if (nextPw !== confPw) {
        errEl.textContent = 'New passwords do not match.';
        errEl.classList.remove('hidden');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Re-encrypting...';
      errEl.classList.add('hidden');
      try {
        const res = await changeMainAdminPassword({ currentPassword: curPw, newPassword: nextPw });
        closeModal();
        const extra = [];
        const hasWarnings = Boolean(res.financeResult?.needsAttention || res.pbsResult?.needsAttention);
        if (res.mainFileReencrypted) extra.push('Main DB re-encrypted on disk');
        if (res.financeResult?.reencryptedOnDisk) extra.push('Finance Vault re-encrypted');
        else if (res.financeResult?.needsAttention) extra.push('Reconnect Finance Vault with old password to re-encrypt it');
        if (res.pbsResult?.rotatedCount > 0) extra.push(`${res.pbsResult.rotatedCount} PBS file(s) re-encrypted`);
        else if (res.pbsResult?.needsAttention) extra.push('Reconnect PBS folder to re-encrypt PBS files');
        if (res.resetUserCount > 0) extra.push(`${res.resetUserCount} team user(s) need password reset`);
        toast(
          `Main Administrator password updated.${extra.length ? ' ' + extra.join(' · ') + '.' : ''}`,
          hasWarnings ? 'warning' : 'success'
        );
        if (res.resetUserCount > 0) {
          setTimeout(() => ppOpenTeamAccessModal(), 160);
        }
      } catch (err) {
        errEl.textContent = err?.message || 'Could not update Administrator password.';
        errEl.classList.remove('hidden');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update Admin Password';
        }
      }
    });
  }

  function ppOpenChangeMyPasswordModal(isForced = false) {
    if (!ppIsNamedUser()) {
      ppOpenChangeAdminPasswordModal();
      return;
    }
    const userName = ppAuthSession.userName || 'Team Member';
    showModal(`
      <form id="ppChangeMyPwForm" ${isForced ? 'data-forced="1"' : ''} class="p-5 space-y-4 text-xs" onsubmit="return false;">
        <div class="flex items-start justify-between gap-3 pp-modal-header-row">
          <div class="flex items-start gap-2.5 min-w-0">
            <span class="pp-auth-avatar ${ppIsDelegatedAdmin() ? 'pp-auth-avatar-admin' : ''}">${esc(getInitials(userName))}</span>
            <div class="min-w-0">
              <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">${isForced ? 'Choose Your Personal Password' : 'Change My Password'}</h3>
              <p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                ${isForced
                  ? 'Your Administrator assigned a temporary password. Set your own private password now — only you will know it.'
                  : 'Update your personal sign-in password. Workspace encryption remains protected seamlessly under the hood.'}
              </p>
            </div>
          </div>
          ${isForced ? '' : '<button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold shrink-0 cursor-pointer">&times;</button>'}
        </div>

        ${isForced ? '' : `
        <div class="space-y-1">
          <label for="ppCurUserPw" class="block font-semibold text-slate-700">Current Password</label>
          <input id="ppCurUserPw" type="password" autocomplete="current-password" placeholder="Enter your current password..."
            class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs" />
        </div>`}

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label for="ppNewUserPw" class="block font-semibold text-slate-700">New Personal Password (min 8 chars)</label>
            <span id="ppUserPwStrengthLbl" class="text-[10px] font-bold text-slate-400"></span>
          </div>
          <div class="pp-pw-input-row">
            <input id="ppNewUserPw" type="password" autocomplete="new-password" placeholder="Choose a strong personal password..."
              class="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs" />
            <button type="button" id="ppUserPwEyeBtn" class="px-2.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold cursor-pointer">Show</button>
          </div>
          <div class="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div id="ppUserPwStrengthBar" class="h-full rounded-full bg-slate-200 transition-all" style="width:0%"></div>
          </div>
        </div>

        <div class="space-y-1">
          <label for="ppConfUserPw" class="block font-semibold text-slate-700">Repeat New Password</label>
          <input id="ppConfUserPw" type="password" autocomplete="new-password" placeholder="Repeat your new password..."
            class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs" />
        </div>

        <div id="ppChangeMyPwErr" role="alert" class="hidden rounded-xl px-3 py-2 bg-rose-50 text-rose-700 border border-rose-200 font-semibold"></div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          ${isForced ? '<button type="button" onclick="closeModal()" class="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold cursor-pointer">Later</button>' : '<button type="button" onclick="closeModal()" class="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer">Cancel</button>'}
          <button type="submit" id="ppChangeMyPwSubmit" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer">Save Personal Password</button>
        </div>
      </form>`, 'max-w-md');

    const newInp = document.getElementById('ppNewUserPw');
    const confInp = document.getElementById('ppConfUserPw');
    const curInp = document.getElementById('ppCurUserPw');
    const eyeBtn = document.getElementById('ppUserPwEyeBtn');
    const errEl = document.getElementById('ppChangeMyPwErr');
    const submitBtn = document.getElementById('ppChangeMyPwSubmit');

    newInp?.addEventListener('input', () => {
      if (typeof ppEvaluatePassphraseStrength !== 'function') return;
      const st = ppEvaluatePassphraseStrength((newInp.value || '').trim());
      const bar = document.getElementById('ppUserPwStrengthBar');
      const lbl = document.getElementById('ppUserPwStrengthLbl');
      if (bar) {
        bar.style.width = `${st.pct}%`;
        bar.className = `h-full rounded-full transition-all ${st.color}`;
      }
      if (lbl) {
        lbl.textContent = st.label;
        lbl.className = `text-[10px] font-bold ${st.text}`;
      }
    });

    eyeBtn?.addEventListener('click', () => {
      const show = newInp.type === 'password';
      [curInp, newInp, confInp].forEach(inp => { if (inp) inp.type = show ? 'text' : 'password'; });
      eyeBtn.textContent = show ? 'Hide' : 'Show';
    });

    document.getElementById('ppChangeMyPwForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const curPw = (curInp?.value || '').trim();
      const nextPw = (newInp?.value || '').trim();
      const confPw = (confInp?.value || '').trim();
      if (nextPw.length < 8) {
        errEl.textContent = 'New password must be at least 8 characters long.';
        errEl.classList.remove('hidden');
        return;
      }
      if (!isForced && curPw && nextPw === curPw) {
        errEl.textContent = 'New password must be different from your current password.';
        errEl.classList.remove('hidden');
        return;
      }
      if (nextPw !== confPw) {
        errEl.textContent = 'Passwords do not match.';
        errEl.classList.remove('hidden');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating...';
      errEl.classList.add('hidden');
      try {
        await changeCurrentUserPassword({
          currentPassword: curPw,
          newPassword: nextPw,
          skipCurrentVerify: isForced,
        });
        closeModal();
        if (typeof renderAll === 'function') renderAll();
        toast('Personal password updated and encrypted key slot saved.', 'success');
      } catch (err) {
        errEl.textContent = err?.message || 'Could not update password.';
        errEl.classList.remove('hidden');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save Personal Password';
        }
      }
    });
  }

  /* ==================== ADMIN TEAM ACCESS & RESPONSIVE PERMISSIONS MANAGER ==================== */

  function cssEscSafe(val) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(val ?? ''));
    return String(val ?? '').replace(/["\\]/g, '\\$&');
  }

  function buildTeamUsersListHtml(db) {
    const ac = ensureAccessControl(db);
    if (ac.users.length === 0) {
      return `
        <div class="p-6 rounded-xl border border-dashed border-slate-200 text-center text-slate-400 text-xs">
          No team user logins created yet. Add an owner or lead above to grant tailored tab, financial, or Administrator access.
        </div>`;
    }

    return `
      <div class="pp-user-list">
        ${ac.users.map(u => {
          const perms = normalizeUserPermissions(u.permissions);
          const isUserAdmin = Boolean(u.isAdmin);
          const isDisabled = u.enabled === false;
          const isSelf = ppIsNamedUser() && ppAuthSession.userId === u.id;
          const isResetting = pendingResetUserId === u.id;
          const isEditing = pendingEditUserId === u.id;
          const resetValue = isResetting ? (pendingResetDraft || (pendingResetDraft = generateTempPassword())) : '';
          const statusChip = isDisabled
            ? '<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold whitespace-nowrap">Disabled</span>'
            : (u.needsAdminKeyReset
                ? '<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold whitespace-nowrap">Key Reset Needed</span>'
                : (u.mustChangePassword
                    ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold whitespace-nowrap">Temp Password</span>'
                    : '<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold whitespace-nowrap">Personal Key Active</span>'));

          return `
            <article class="pp-user-card ${isUserAdmin ? 'is-delegated-admin' : ''} ${isDisabled ? 'is-disabled' : ''}" data-pp-user-row="${esc(u.id)}">
              <div class="pp-user-card-head">
                <div class="pp-user-card-id">
                  <span class="pp-auth-avatar ${isUserAdmin ? 'pp-auth-avatar-admin' : ''}">${esc(getInitials(u.name))}</span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="font-extrabold text-[13px] text-slate-900 truncate">${esc(u.name)}</span>
                      <span class="pp-role-badge ${isUserAdmin ? 'pp-role-admin' : 'pp-role-user'}">${isUserAdmin ? 'Admin' : 'Member'}</span>
                      ${isSelf ? '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9.5px] font-bold">You</span>' : ''}
                      ${statusChip}
                    </div>
                    <div class="text-[11px] text-slate-500 mt-0.5">${esc(u.roleTitle || (isUserAdmin ? 'Delegated Administrator' : 'Team Member'))}</div>
                  </div>
                </div>

                <div class="pp-user-card-actions">
                  <button type="button" data-pp-edit-open="${esc(u.id)}"
                    class="pp-user-action-btn border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
                    Edit
                  </button>
                  <button type="button" data-pp-toggle-enabled="${esc(u.id)}" ${isSelf ? 'disabled title="Cannot disable your currently signed-in account"' : ''}
                    class="pp-user-action-btn border ${isDisabled ? 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-700' : 'border-amber-200 bg-amber-50/70 hover:bg-amber-100 text-amber-800'} disabled:opacity-40 disabled:cursor-not-allowed">
                    ${isDisabled ? 'Enable' : 'Disable'}
                  </button>
                  <button type="button" data-pp-reset-open="${esc(u.id)}" ${isSelf ? 'disabled title="Use Change My Personal Password to update your own password"' : ''}
                    class="pp-user-action-btn border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    Reset Pw
                  </button>
                  <button type="button" data-pp-delete-user="${esc(u.id)}" ${isSelf ? 'disabled title="Cannot remove your currently signed-in account"' : ''}
                    class="pp-user-action-btn border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    Remove
                  </button>
                </div>
              </div>

              ${isEditing ? `
                <div class="pp-user-edit-panel">
                  <div class="text-[11px] font-bold text-slate-700">Edit user details for ${esc(u.name)}:</div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" data-pp-edit-name="${esc(u.id)}" value="${esc(u.name)}" placeholder="Display name"
                      class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold" />
                    <input type="text" data-pp-edit-role="${esc(u.id)}" value="${esc(u.roleTitle || '')}" placeholder="Role / Title (e.g., Technical Lead)"
                      class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs" />
                  </div>
                  <div class="flex items-center justify-end gap-2">
                    <button type="button" data-pp-edit-cancel="${esc(u.id)}" class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-semibold cursor-pointer">Cancel</button>
                    <button type="button" data-pp-edit-save="${esc(u.id)}" class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold cursor-pointer">Save Details</button>
                  </div>
                </div>` : ''}

              <div class="pp-user-card-perms">
                <div class="pp-perm-group">
                  <div class="pp-perm-group-label">Allowed Workspace Tabs</div>
                  <div class="pp-perm-pills-row">
                    ${ALL_TABS.map(t => {
                      const active = isUserAdmin || perms.tabs[t];
                      return `
                        <button type="button" data-pp-toggle-tab="${t}" data-pp-uid="${esc(u.id)}"
                          ${isUserAdmin || isDisabled ? `disabled title="${isDisabled ? 'Enable account first to edit permissions' : 'Admin Rights grants access to all tabs'}"` : `title="Toggle access to ${TAB_META[t].label}"`}
                          aria-pressed="${String(active)}"
                          class="pp-perm-pill ${active ? 'is-on' : ''}">
                          <span>${active ? '&#10003;' : '&times;'}</span>
                          <span>${TAB_META[t].short}</span>
                        </button>`;
                    }).join('')}
                  </div>
                  ${isUserAdmin ? '<div class="text-[10.5px] text-emerald-700 font-semibold">All tabs &amp; team management unlocked via Admin Rights.</div>' : ''}
                </div>

                <div class="pp-perm-group">
                  <div class="pp-perm-group-label">Financial Data &amp; Role Rights</div>
                  <div class="pp-perm-pills-row">
                    <button type="button" data-pp-toggle-fin="${esc(u.id)}"
                      ${isUserAdmin || isDisabled ? `disabled title="${isDisabled ? 'Enable account first to edit permissions' : 'Admin Rights includes full Financial Data access'}"` : 'title="Toggle access to Day Rates, Project Costs & Finance Vault"'}
                      aria-pressed="${String(isUserAdmin || perms.finance)}"
                      class="pp-perm-pill is-fin ${(isUserAdmin || perms.finance) ? 'is-on' : ''}">
                      <span>${(isUserAdmin || perms.finance) ? '&#10003; Financial Data' : '&times; Finance Restricted'}</span>
                    </button>
                    <button type="button" data-pp-toggle-admin="${esc(u.id)}"
                      ${isSelf || isDisabled ? `disabled title="${isSelf ? 'You cannot remove your own Admin rights while signed in' : 'Enable account first to change Admin rights'}"` : 'title="Grant or revoke full Administrator rights (all tabs, Finance, and Team Access)"'}
                      aria-pressed="${String(isUserAdmin)}"
                      class="pp-perm-pill is-admin-pill ${isUserAdmin ? 'is-on' : ''}">
                      <span>${isUserAdmin ? '&#9733; Admin Rights' : 'Grant Admin'}</span>
                    </button>
                  </div>
                </div>
              </div>

              ${isResetting ? `
                <div class="pp-user-reset-panel">
                  <div class="text-[11px] font-bold text-indigo-900">Set new temporary password for ${esc(u.name)}:</div>
                  <div class="pp-pw-input-row">
                    <input type="text" data-pp-reset-input="${esc(u.id)}" value="${esc(resetValue)}" class="px-2.5 py-2 rounded-lg border border-indigo-200 bg-white font-mono text-xs font-semibold" />
                    <button type="button" data-pp-reset-gen="${esc(u.id)}" class="px-2.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold cursor-pointer">New</button>
                    <button type="button" data-pp-reset-copy="${esc(u.id)}" class="px-2.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold cursor-pointer">Copy</button>
                  </div>
                  <div class="flex items-center justify-end gap-2">
                    <button type="button" data-pp-reset-cancel="${esc(u.id)}" class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-semibold cursor-pointer">Cancel</button>
                    <button type="button" data-pp-reset-save="${esc(u.id)}" class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold cursor-pointer">Save Reset</button>
                  </div>
                </div>` : ''}
            </article>`;
        }).join('')}
      </div>`;
  }

  function buildTeamAccessInnerHtml(db) {
    const ac = ensureAccessControl(db);
    const hasKey = getMasterKeyActive();
    const canEditMainAdmin = !ppIsNamedUser();
    const isNonLive = typeof ui !== 'undefined' && (ui.demoMode || ui.whatIfMode);
    const isLinked = typeof linkedFileHandle !== 'undefined' && Boolean(linkedFileHandle);
    const people = typeof window !== 'undefined' && typeof window.ppGetPeopleDirectory === 'function'
      ? window.ppGetPeopleDirectory()
      : (Array.isArray(db?.peopleDirectory) ? db.peopleDirectory : []);
    const existingNames = new Set(ac.users.map(u => u.name.toLowerCase()));
    const availablePeople = people.filter(p => p && p.name && !existingNames.has(p.name.toLowerCase()));

    return `
      <div class="space-y-4 text-xs">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-extrabold text-slate-900">Team Users, Login &amp; Access Permissions</h3>
            <p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Each user sets their own password to internally unlock your Administrator encryption key (never shown). Control which tabs, financial data, and Admin rights each member receives.
            </p>
          </div>
          ${canEditMainAdmin ? `
            <div class="w-full sm:w-auto space-y-1">
              <div class="text-[11px] font-semibold text-slate-500">Main Admin Display Name</div>
              <div class="pp-pw-input-row">
                <input type="text" data-pp-admin-name-input aria-label="Main Administrator display name" value="${esc(ac.adminName)}" class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold sm:w-36" />
                ${hasKey ? `<button type="button" data-pp-open-change-admin-pw class="px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold cursor-pointer whitespace-nowrap">Change Admin Pw</button>` : ''}
              </div>
            </div>` : ''}
        </div>

        ${isNonLive ? `
          <div class="px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 text-indigo-800 text-[11px] font-medium">
            <strong>Live Database Target:</strong> You are currently previewing ${ui.demoMode ? 'Demo Sandbox' : 'What-If Mode'}, so all user account changes below apply directly to your Live Database.
          </div>` : ''}

        ${hasKey && !isLinked ? `
          <div class="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50/70 text-amber-900 text-[11px] leading-relaxed">
            <strong>No Shared File Linked:</strong> Connect a shared <code>.json</code> file in <strong>Sync &amp; Snapshots</strong> (or export a backup) so user accounts are saved to disk for your team.
          </div>` : ''}

        ${!hasKey ? `
          <div class="p-3.5 rounded-xl border border-amber-200 bg-amber-50/80 text-amber-900 flex flex-wrap items-center justify-between gap-3">
            <div class="space-y-0.5">
              <div class="font-bold">Step 1: Activate Administrator Encryption Password</div>
              <div class="text-[11px]">Set your Main Administrator password first so each team user's password can securely wrap and unlock it.</div>
            </div>
            <button type="button" data-pp-open-admin-enc class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer shrink-0">Set Admin Password</button>
          </div>
        ` : `
          <form data-pp-add-user-form class="p-3.5 rounded-xl border border-slate-200 bg-slate-50/80 space-y-3" onsubmit="return false;">
            <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
              ${availablePeople.length > 0 ? `
              <div class="sm:col-span-4">
                <label class="block text-[11px] font-semibold text-slate-600 mb-1">Pick Owner / Tech Lead</label>
                <select data-pp-pick-person class="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium">
                  <option value="">Custom name...</option>
                  ${availablePeople.map(p => `<option value="${esc(p.name)}" data-role="${esc(p.role)}">${esc(p.name)} (${esc(p.role)})</option>`).join('')}
                </select>
              </div>` : ''}
              <div class="${availablePeople.length > 0 ? 'sm:col-span-4' : 'sm:col-span-5'}">
                <label class="block text-[11px] font-semibold text-slate-600 mb-1">User Display Name</label>
                <input type="text" data-pp-new-name placeholder="e.g., Elena Rostova" class="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold" />
              </div>
              <div class="${availablePeople.length > 0 ? 'sm:col-span-4' : 'sm:col-span-7'}">
                <label class="block text-[11px] font-semibold text-slate-600 mb-1">Initial Temporary Password (min 8 chars)</label>
                <div class="pp-pw-input-row">
                  <input type="text" data-pp-new-pw value="${esc(generateTempPassword())}" class="px-2.5 py-2 rounded-xl border border-slate-200 bg-white font-mono text-xs font-semibold" />
                  <button type="button" data-pp-gen-pw title="Generate random temporary password" class="px-2.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold cursor-pointer">New</button>
                  <button type="button" data-pp-copy-pw title="Copy temporary password" class="px-2.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold cursor-pointer">Copy</button>
                </div>
              </div>
            </div>

            <div class="space-y-2 pt-1">
              <div class="pp-perm-group-label">Initial Permissions</div>
              <div class="pp-perm-pills-row">
                <button type="button" data-pp-new-tab="matrix" aria-pressed="true" class="pp-perm-pill is-on">&#10003; Roadmap</button>
                <button type="button" data-pp-new-tab="health" aria-pressed="true" class="pp-perm-pill is-on">&#10003; Health</button>
                <button type="button" data-pp-new-tab="data" aria-pressed="false" class="pp-perm-pill">&times; Setup</button>
                <button type="button" data-pp-new-tab="sync" aria-pressed="false" class="pp-perm-pill">&times; Sync</button>
                <button type="button" data-pp-new-fin aria-pressed="false" class="pp-perm-pill is-fin">&times; Financial Data</button>
                <button type="button" data-pp-new-admin aria-pressed="false" class="pp-perm-pill is-admin-pill">Grant Admin</button>
              </div>
              <div data-pp-new-admin-hint class="hidden text-[10.5px] font-semibold text-emerald-700">
                Admin Rights automatically grants full access to all tabs, Financial Data, and Team Access Manager.
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2.5 pt-1">
              <label class="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input type="checkbox" data-pp-new-must-change checked class="rounded text-indigo-600" />
                <span>Prompt user to choose their personal password on first sign-in</span>
              </label>
              <button type="submit" data-pp-add-submit class="w-full sm:w-auto px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition cursor-pointer">+ Add User Login</button>
            </div>
          </form>
        `}

        <div data-pp-users-list>${buildTeamUsersListHtml(db)}</div>
      </div>`;
  }

  function wireTeamUsersListEvents(listHost, onUsersChanged, onFullRerender) {
    if (!listHost) return;
    const db = getDb();
    const ac = ensureAccessControl(db);

    listHost.querySelectorAll('[data-pp-toggle-tab]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return toast('Administrator privileges required.', 'warning');
        const uidVal = btn.getAttribute('data-pp-uid');
        const tabKey = btn.getAttribute('data-pp-toggle-tab');
        const user = ac.users.find(u => u.id === uidVal);
        if (!user || user.isAdmin || user.enabled === false) return;
        const perms = normalizeUserPermissions(user.permissions);
        const nextVal = !perms.tabs[tabKey];
        const enabledCount = ALL_TABS.filter(t => (t === tabKey ? nextVal : perms.tabs[t])).length;
        if (enabledCount === 0) {
          toast('At least one workspace tab must remain enabled.', 'warning');
          return;
        }
        perms.tabs[tabKey] = nextVal;
        user.permissions = perms;
        user.updatedAt = new Date().toISOString();
        onUsersChanged();
        await persistAuthChangeToDisk({
          logType: 'Access',
          logSummary: `${nextVal ? 'Enabled' : 'Restricted'} ${TAB_META[tabKey]?.label || tabKey} tab for "${user.name}"`,
        });
      });
    });

    listHost.querySelectorAll('[data-pp-toggle-fin]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return toast('Administrator privileges required.', 'warning');
        const uidVal = btn.getAttribute('data-pp-toggle-fin');
        const user = ac.users.find(u => u.id === uidVal);
        if (!user || user.isAdmin || user.enabled === false) return;
        const perms = normalizeUserPermissions(user.permissions);
        perms.finance = !perms.finance;
        user.permissions = perms;
        user.updatedAt = new Date().toISOString();
        onUsersChanged();
        toast(`${user.name}: Financial data ${perms.finance ? 'enabled' : 'restricted'}.`, 'info');
        await persistAuthChangeToDisk({
          logType: 'Access',
          logSummary: `${perms.finance ? 'Enabled' : 'Restricted'} Financial Data for "${user.name}"`,
        });
      });
    });

    listHost.querySelectorAll('[data-pp-toggle-admin]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return toast('Administrator privileges required.', 'warning');
        const uidVal = btn.getAttribute('data-pp-toggle-admin');
        const user = ac.users.find(u => u.id === uidVal);
        if (!user || user.enabled === false) return;
        if (ppIsNamedUser() && ppAuthSession.userId === user.id) {
          toast('You cannot revoke your own Admin rights while signed in.', 'warning');
          return;
        }
        user.isAdmin = !Boolean(user.isAdmin);
        user.updatedAt = new Date().toISOString();
        onUsersChanged();
        toast(
          user.isAdmin
            ? `Granted Administrator rights to "${user.name}".`
            : `Revoked Administrator rights from "${user.name}". Custom tab & finance permissions restored.`,
          'info'
        );
        await persistAuthChangeToDisk({
          logType: 'Access',
          logSummary: `${user.isAdmin ? 'Granted' : 'Revoked'} Administrator rights for "${user.name}"`,
        });
      });
    });

    listHost.querySelectorAll('[data-pp-toggle-enabled]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return toast('Administrator privileges required.', 'warning');
        const uidVal = btn.getAttribute('data-pp-toggle-enabled');
        const target = ac.users.find(u => u.id === uidVal);
        if (!target) return;
        if (ppIsNamedUser() && ppAuthSession.userId === uidVal) {
          toast('Cannot disable your currently signed-in account.', 'warning');
          return;
        }
        const willDisable = target.enabled !== false;
        if (willDisable && typeof ppConfirmAction === 'function') {
          const ok = await ppConfirmAction({
            title: `Disable User "${target.name}"?`,
            message: `"${target.name}" will immediately lose access to the workspace until re-enabled by an Administrator.`,
            confirmLabel: 'Disable Account',
            tone: 'warning',
          });
          if (!ok) return;
        }
        try {
          await toggleUserAccountEnabled(uidVal, !willDisable);
          onUsersChanged();
          ppSyncAuthChromeUI();
          ppRefreshSyncHubUI();
          toast(`${willDisable ? 'Disabled' : 'Re-enabled'} user account "${target.name}".`, 'info');
        } catch (err) {
          toast(err?.message || 'Could not update user status.', 'error');
        }
      });
    });

    listHost.querySelectorAll('[data-pp-edit-open]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return;
        const uidVal = btn.getAttribute('data-pp-edit-open') || '';
        pendingEditUserId = pendingEditUserId === uidVal ? '' : uidVal;
        onUsersChanged();
      });
    });

    listHost.querySelectorAll('[data-pp-edit-cancel]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        pendingEditUserId = '';
        onUsersChanged();
      });
    });

    listHost.querySelectorAll('[data-pp-edit-save]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return;
        const uidVal = btn.getAttribute('data-pp-edit-save');
        const escUid = cssEscSafe(uidVal);
        const nameInp = listHost.querySelector(`[data-pp-edit-name="${escUid}"]`);
        const roleInp = listHost.querySelector(`[data-pp-edit-role="${escUid}"]`);
        try {
          btn.disabled = true;
          const updated = await updateUserAccountDetails(uidVal, {
            name: nameInp?.value || '',
            roleTitle: roleInp?.value || '',
          });
          pendingEditUserId = '';
          toast(`Updated user "${updated.name}".`, 'success');
          if (typeof onFullRerender === 'function') onFullRerender();
          else onUsersChanged();
          ppSyncAuthChromeUI();
          ppRefreshSyncHubUI();
        } catch (err) {
          toast(err?.message || 'Could not update user details.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    listHost.querySelectorAll('[data-pp-reset-open]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return toast('Administrator privileges required.', 'warning');
        if (!getMasterKeyActive()) {
          toast('Enable Administrator encryption first before resetting passwords.', 'warning');
          return;
        }
        const uidVal = btn.getAttribute('data-pp-reset-open') || '';
        if (ppIsNamedUser() && ppAuthSession.userId === uidVal) {
          toast('Use "Change My Personal Password" to update your own password.', 'warning');
          return;
        }
        pendingResetUserId = uidVal;
        pendingResetDraft = generateTempPassword();
        onUsersChanged();
      });
    });

    listHost.querySelectorAll('[data-pp-reset-input]').forEach(inp => {
      inp.addEventListener('input', () => {
        pendingResetDraft = inp.value;
      });
    });

    listHost.querySelectorAll('[data-pp-reset-cancel]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        pendingResetUserId = '';
        pendingResetDraft = '';
        onUsersChanged();
      });
    });

    listHost.querySelectorAll('[data-pp-reset-gen]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const uidVal = cssEscSafe(btn.getAttribute('data-pp-reset-gen'));
        const inp = listHost.querySelector(`[data-pp-reset-input="${uidVal}"]`);
        const nextPw = generateTempPassword();
        pendingResetDraft = nextPw;
        if (inp) inp.value = nextPw;
      });
    });

    listHost.querySelectorAll('[data-pp-reset-copy]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const uidVal = cssEscSafe(btn.getAttribute('data-pp-reset-copy'));
        const inp = listHost.querySelector(`[data-pp-reset-input="${uidVal}"]`);
        const txt = inp?.value || '';
        if (!txt) return;
        try {
          await navigator.clipboard.writeText(txt);
          toast('Temporary password copied to clipboard.', 'success');
        } catch (_e) {
          inp?.select();
          toast('Temporary password selected — press Ctrl+C to copy.', 'info');
        }
      });
    });

    listHost.querySelectorAll('[data-pp-reset-save]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return toast('Administrator privileges required.', 'warning');
        const rawUid = btn.getAttribute('data-pp-reset-save');
        const escUid = cssEscSafe(rawUid);
        const inp = listHost.querySelector(`[data-pp-reset-input="${escUid}"]`);
        const nextTemp = (inp?.value || '').trim();
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          const user = await adminResetUserPassword(rawUid, nextTemp, true);
          pendingResetUserId = '';
          pendingResetDraft = '';
          toast(`Password reset for "${user.name}". They will choose a personal password on next login.`, 'success');
          onUsersChanged();
        } catch (err) {
          toast(err?.message || 'Password reset failed.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save Reset';
        }
      });
    });

    listHost.querySelectorAll('[data-pp-delete-user]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (!ppHasAdminAccess()) return toast('Administrator privileges required.', 'warning');
        const uidVal = btn.getAttribute('data-pp-delete-user');
        if (ppIsNamedUser() && ppAuthSession.userId === uidVal) {
          toast('Cannot remove your currently signed-in account.', 'warning');
          return;
        }
        const target = ac.users.find(u => u.id === uidVal);
        if (!target) return;
        if (typeof ppConfirmAction === 'function') {
          const ok = await ppConfirmAction({
            title: `Remove User Login "${target.name}"?`,
            message: `"${target.name}" will be permanently removed from Team Users and will no longer be able to sign in to this database.`,
            confirmLabel: 'Remove User',
            tone: 'danger',
          });
          if (!ok) return;
        }
        ac.users = ac.users.filter(u => u.id !== uidVal);
        if (pendingResetUserId === uidVal) { pendingResetUserId = ''; pendingResetDraft = ''; }
        if (pendingEditUserId === uidVal) pendingEditUserId = '';
        await persistAuthChangeToDisk({
          logType: 'Access',
          logSummary: `Removed user login "${target.name}"`,
        });
        if (typeof onFullRerender === 'function') onFullRerender();
        else onUsersChanged();
        ppSyncAuthChromeUI();
        ppRefreshSyncHubUI();
        toast(`Removed user login for "${target.name}".`, 'info');
      });
    });
  }

  function wireTeamAccessContainer(container, onFullRerender, onUsersOnlyRerender) {
    if (!container) return;
    const db = getDb();
    const ac = ensureAccessControl(db);

    container.querySelector('[data-pp-admin-name-input]')?.addEventListener('change', async (ev) => {
      if (ppIsNamedUser()) return;
      const next = String(ev.target.value || '').trim() || 'Administrator';
      ac.adminName = next;
      if (ppAuthSession.mode === 'admin') {
        ppAuthSession.userName = next;
        if (typeof ui !== 'undefined') {
          ui.userName = next;
          if (typeof persistUIPrefs === 'function') persistUIPrefs();
        }
        if (typeof updateHeaderUserDisplay === 'function') updateHeaderUserDisplay();
      }
      await persistAuthChangeToDisk({
        logType: 'Access',
        logSummary: `Updated Main Administrator display name to "${next}"`,
      });
      ppSyncAuthChromeUI();
      ppRefreshSyncHubUI();
      toast(`Administrator display name set to "${next}"`, 'success');
    });

    container.querySelector('[data-pp-open-admin-enc]')?.addEventListener('click', () => {
      if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog();
    });

    container.querySelector('[data-pp-open-change-admin-pw]')?.addEventListener('click', () => {
      ppOpenChangeAdminPasswordModal();
    });

    const form = container.querySelector('[data-pp-add-user-form]');
    if (form) {
      const pickSel = form.querySelector('[data-pp-pick-person]');
      const nameInp = form.querySelector('[data-pp-new-name]');
      const pwInp = form.querySelector('[data-pp-new-pw]');
      const finBtn = form.querySelector('[data-pp-new-fin]');
      const adminBtn = form.querySelector('[data-pp-new-admin]');
      const adminHint = form.querySelector('[data-pp-new-admin-hint]');
      const submitBtn = form.querySelector('[data-pp-add-submit]');
      const tabBtns = Array.from(form.querySelectorAll('[data-pp-new-tab]'));
      let pickedRole = '';

      const newTabsState = { matrix: true, health: true, data: false, sync: false };
      let newFinState = false;
      let newAdminState = false;

      const syncNewPermButtons = () => {
        tabBtns.forEach(btn => {
          const t = btn.getAttribute('data-pp-new-tab');
          const active = newAdminState || Boolean(newTabsState[t]);
          btn.classList.toggle('is-on', active);
          btn.setAttribute('aria-pressed', String(active));
          btn.disabled = newAdminState;
          btn.innerHTML = `${active ? '&#10003;' : '&times;'} ${TAB_META[t].short}`;
        });
        if (finBtn) {
          const active = newAdminState || newFinState;
          finBtn.classList.toggle('is-on', active);
          finBtn.setAttribute('aria-pressed', String(active));
          finBtn.disabled = newAdminState;
          finBtn.innerHTML = `${active ? '&#10003;' : '&times;'} Financial Data`;
        }
        if (adminBtn) {
          adminBtn.classList.toggle('is-on', newAdminState);
          adminBtn.setAttribute('aria-pressed', String(newAdminState));
          adminBtn.innerHTML = newAdminState ? '&#9733; Admin Rights' : 'Grant Admin';
        }
        if (adminHint) adminHint.classList.toggle('hidden', !newAdminState);
      };

      tabBtns.forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (newAdminState) return;
          const t = btn.getAttribute('data-pp-new-tab');
          const nextVal = !newTabsState[t];
          const enabledCount = ALL_TABS.filter(k => (k === t ? nextVal : newTabsState[k])).length;
          if (enabledCount === 0) {
            toast('Select at least one workspace tab.', 'warning');
            return;
          }
          newTabsState[t] = nextVal;
          syncNewPermButtons();
        });
      });

      finBtn?.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (newAdminState) return;
        newFinState = !newFinState;
        syncNewPermButtons();
      });

      adminBtn?.addEventListener('click', (ev) => {
        ev.preventDefault();
        newAdminState = !newAdminState;
        syncNewPermButtons();
      });

      syncNewPermButtons();

      pickSel?.addEventListener('change', () => {
        const opt = pickSel.options[pickSel.selectedIndex];
        if (pickSel.value) {
          if (nameInp) nameInp.value = pickSel.value;
          pickedRole = opt?.getAttribute('data-role') || '';
        } else {
          pickedRole = '';
        }
      });

      nameInp?.addEventListener('input', () => {
        if (pickSel && nameInp.value.trim() !== pickSel.value) {
          pickSel.value = '';
          pickedRole = '';
        }
      });

      form.querySelector('[data-pp-gen-pw]')?.addEventListener('click', () => {
        if (pwInp) pwInp.value = generateTempPassword();
      });

      form.querySelector('[data-pp-copy-pw]')?.addEventListener('click', async () => {
        const txt = pwInp?.value || '';
        if (!txt) return;
        try {
          await navigator.clipboard.writeText(txt);
          toast('Temporary password copied to clipboard.', 'success');
        } catch (_e) {
          pwInp?.select();
          toast('Temporary password selected — press Ctrl+C to copy.', 'info');
        }
      });

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (submitBtn && submitBtn.disabled) return;
        const nm = (nameInp?.value || '').trim();
        const pw = (pwInp?.value || '').trim();
        const mustChangePassword = Boolean(form.querySelector('[data-pp-new-must-change]')?.checked);
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating...';
        }
        try {
          await createOrUpdateUserAccount({
            name: nm,
            roleTitle: pickedRole || (newAdminState ? 'Administrator' : 'Team Member'),
            isAdmin: newAdminState,
            permissions: { tabs: { ...newTabsState }, finance: newFinState },
            tempPassword: pw,
            mustChangePassword,
          });
          toast(`Created login for "${nm}". Share their temporary password securely.`, 'success');
          onFullRerender();
          ppSyncAuthChromeUI();
          ppRefreshSyncHubUI();
        } catch (err) {
          toast(err?.message || 'Could not add user.', 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '+ Add User Login';
          }
        }
      });
    }

    const listHost = container.querySelector('[data-pp-users-list]');
    wireTeamUsersListEvents(listHost, onUsersOnlyRerender, onFullRerender);
  }

  function refreshUsersListInContainer(container, onAfterChange, onFullRerender) {
    if (!container) return;
    const listHost = container.querySelector('[data-pp-users-list]');
    if (!listHost) return;
    preserveScrollPosition(() => {
      listHost.innerHTML = buildTeamUsersListHtml(getDb());
      wireTeamUsersListEvents(listHost, onAfterChange, onFullRerender);
    });
  }

  function renderAdminAccessCardInSetup() {
    const dataTab = document.getElementById('tab-data');
    if (!dataTab) return;
    let card = document.getElementById('ppAdminAccessCard');
    if (!ppHasAdminAccess() || ppIsSessionLocked()) {
      if (card) card.remove();
      return;
    }
    if (!card) {
      card = document.createElement('section');
      card.id = 'ppAdminAccessCard';
      card.className = 'pp-access-card';
      card.setAttribute('aria-label', 'Team Users and Access Permissions');
      dataTab.appendChild(card);
    }
    const rerenderUsersOnly = () => {
      refreshUsersListInContainer(card, rerenderUsersOnly, renderAdminAccessCardInSetup);
    };
    preserveScrollPosition(() => {
      card.innerHTML = buildTeamAccessInnerHtml(getDb());
      wireTeamAccessContainer(card, renderAdminAccessCardInSetup, rerenderUsersOnly);
    });
  }

  function ppOpenTeamAccessModal() {
    if (!ppHasAdminAccess()) {
      toast('Only an Administrator can manage team users and permissions.', 'warning');
      return;
    }
    pendingResetUserId = '';
    pendingResetDraft = '';
    pendingEditUserId = '';
    const db = getDb();
    const roleLabel = ppIsDelegatedAdmin() ? 'Delegated Admin' : 'Main Administrator';
    showModal(`
      <div class="p-4 sm:p-5 space-y-4 text-xs">
        <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100 pp-modal-header-row">
          <div class="flex items-center gap-2 min-w-0">
            <span class="pp-role-badge pp-role-admin shrink-0">${esc(roleLabel)}</span>
            <h3 id="modalTitle" class="text-base font-extrabold text-slate-900 truncate">Team Access Manager</h3>
          </div>
          <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold shrink-0 cursor-pointer">&times;</button>
        </div>
        <div id="ppTeamAccessModalBody">${buildTeamAccessInnerHtml(db)}</div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer">Done</button>
        </div>
      </div>`, 'max-w-3xl');

    const body = document.getElementById('ppTeamAccessModalBody');
    const syncSetupUsersIfPresent = () => {
      if (document.getElementById('ppAdminAccessCard')) {
        renderAdminAccessCardInSetup();
      }
    };
    const rerenderModalUsersOnly = () => {
      refreshUsersListInContainer(body, rerenderModalUsersOnly, rerenderModalFull);
      syncSetupUsersIfPresent();
    };
    const rerenderModalFull = () => {
      if (!body) return;
      preserveScrollPosition(() => {
        body.innerHTML = buildTeamAccessInnerHtml(getDb());
        wireTeamAccessContainer(body, rerenderModalFull, rerenderModalUsersOnly);
      });
      syncSetupUsersIfPresent();
    };
    wireTeamAccessContainer(body, rerenderModalFull, rerenderModalUsersOnly);
  }

  /* ==================== MODERNIZED ACCOUNT & USER SWITCHER MODAL ==================== */

  const nativeOpenUserSwitcherModal = typeof openUserSwitcherModal === 'function' ? openUserSwitcherModal : null;

  function openModernAccountModal() {
    const db = getDb();
    const ac = ensureAccessControl(db);
    const hasEncOrUsers = getMasterKeyActive() || ac.users.length > 0 || ppAuthSession.mode !== 'open';

    // Preserve legacy quick-user switcher UX (and test.mjs compatibility) when auth is not yet configured
    if (!hasEncOrUsers) {
      const current = (typeof ui !== 'undefined' ? ui.userName : 'Project Mgr').trim() || 'Project Mgr';
      const suggestions = typeof getSuggestedTeamUsers === 'function' ? getSuggestedTeamUsers() : [current];
      const removedCount = (typeof ui !== 'undefined' && Array.isArray(ui.removedUsers)) ? ui.removedUsers.length : 0;

      const chipsHtml = suggestions.map(name => {
        const isCur = name.toLowerCase() === current.toLowerCase();
        const canRemove = suggestions.length > 1 || name.toLowerCase() !== 'project mgr';
        return `
          <div class="inline-flex items-center rounded-xl border text-xs font-semibold transition overflow-hidden ${isCur ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-700'}">
            <button type="button" data-user-name="${esc(name)}" onclick="selectQuickUser(this.dataset.userName)"
              class="inline-flex items-center gap-1.5 pl-2.5 ${canRemove ? 'pr-1.5' : 'pr-3'} py-1.5 hover:bg-slate-100 transition cursor-pointer">
              <span class="w-5 h-5 rounded-md ${isCur ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'} text-[9px] font-extrabold flex items-center justify-center shrink-0">${esc(getInitials(name))}</span>
              <span>${esc(name)}</span>
            </button>
            ${canRemove ? `<button type="button" data-user-name="${esc(name)}" onclick="confirmRemoveQuickUser(this.dataset.userName)"
              title="Remove ${esc(name)}" aria-label="Remove user ${esc(name)}"
              class="px-2 py-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 font-bold leading-none transition cursor-pointer">&times;</button>` : ''}
          </div>`;
      }).join('');

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between pp-modal-header-row">
            <div class="flex items-center gap-3 min-w-0">
              <span class="pp-auth-avatar">${esc(getInitials(current))}</span>
              <div class="min-w-0">
                <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">Account &amp; Sign In</h3>
                <p class="text-[11px] text-slate-500">Shown in Change Log, Snapshots &amp; Sync metadata</p>
              </div>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold shrink-0 cursor-pointer">&times;</button>
          </div>

          <form onsubmit="event.preventDefault(); saveUserSwitcherModal();" class="space-y-3">
            <div>
              <label for="mUserNameInput" class="block font-semibold text-slate-700 mb-1">Display Name / Role</label>
              <div class="pp-pw-input-row">
                <input id="mUserNameInput" type="text" value="${esc(current)}" placeholder="e.g., Alex (PM)"
                  class="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-900" />
                <button type="submit" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition cursor-pointer shrink-0">Apply</button>
              </div>
            </div>

            ${suggestions.length > 0 || removedCount > 0 ? `
              <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400">Quick Switch</div>
                  ${removedCount > 0 ? `<button type="button" onclick="restoreRemovedUsers()" class="text-[11px] font-semibold text-indigo-600 hover:underline cursor-pointer">Restore ${removedCount} removed</button>` : ''}
                </div>
                <div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">${chipsHtml}</div>
              </div>` : ''}
          </form>

          <div class="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/60 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-extrabold text-emerald-900">Multi-User Login &amp; Encryption</span>
              <span class="pp-role-badge pp-role-admin">Admin Setup</span>
            </div>
            <p class="text-[11px] text-emerald-800 leading-relaxed">
              Set an Administrator password to enable AES-256-GCM encryption, add personal team logins, and control tab, financial &amp; Admin permissions.
            </p>
            <div class="flex flex-wrap gap-2 pt-0.5">
              <button type="button" onclick="closeModal(); openSyncEncryptionDialog();" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer">Set Admin Password</button>
              <button type="button" onclick="closeModal(); openSharedDatabaseFile();" class="px-3 py-1.5 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 font-semibold cursor-pointer">Open Encrypted File</button>
            </div>
          </div>
        </div>`, 'max-w-md');
      return;
    }

    // Authenticated / Configured Security Account Hub
    const isAdmin = ppHasAdminAccess();
    const isMainAdmin = !ppIsNamedUser();
    const isDelegated = ppIsDelegatedAdmin();
    const activeName = ppIsNamedUser()
      ? ppAuthSession.userName
      : (ac.adminName || (typeof ui !== 'undefined' ? ui.userName : 'Administrator'));
    const roleChipText = isMainAdmin
      ? 'Main Admin'
      : (isDelegated ? 'Admin' : (ppAuthSession.roleTitle || 'Member'));
    const activeUsersCount = ac.users.filter(u => u && u.enabled !== false).length;
    const permChips = [
      ...ALL_TABS.filter(t => ppCanAccessTab(t)).map(t => `<span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">${TAB_META[t].short}</span>`),
      ppCanAccessFinance()
        ? '<span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">Financial Data</span>'
        : '<span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-semibold">Finance Restricted</span>',
    ].join('');

    showModal(`
      <div class="p-5 space-y-4 text-xs">
        <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
        <div class="flex items-start justify-between gap-3 pp-modal-header-row">
          <div class="flex items-center gap-3 min-w-0">
            <span class="pp-auth-avatar ${isAdmin ? 'pp-auth-avatar-admin' : ''}">${isMainAdmin ? 'AD' : esc(getInitials(activeName))}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 id="modalTitle" class="text-base font-extrabold text-slate-900 truncate">${esc(activeName)}</h3>
                <span class="pp-role-badge ${isAdmin ? 'pp-role-admin' : 'pp-role-user'}">${esc(roleChipText)}</span>
              </div>
              <p class="text-[11px] text-slate-500 mt-0.5">${getMasterKeyActive() ? 'AES-256-GCM session active' : 'Encryption key locked'}</p>
            </div>
          </div>
          <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold shrink-0 cursor-pointer">&times;</button>
        </div>

        <div class="space-y-1.5">
          <div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Active Access Scope</div>
          <div class="flex flex-wrap gap-1.5">${permChips}</div>
        </div>

        <div class="space-y-2 pt-1">
          ${isAdmin ? `
            <button type="button" onclick="closeModal(); ppOpenTeamAccessModal();"
              class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 font-semibold transition cursor-pointer">
              <span>Manage Team Users &amp; Permissions</span>
              <span class="text-[11px] font-bold text-indigo-600 shrink-0">${activeUsersCount} user${activeUsersCount === 1 ? '' : 's'} &rarr;</span>
            </button>` : ''}

          ${isMainAdmin ? `
            ${getMasterKeyActive() ? `
              <button type="button" onclick="closeModal(); ppOpenChangeAdminPasswordModal();"
                class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-300 text-emerald-900 font-semibold transition cursor-pointer">
                <span>Change Main Administrator Password</span>
                <span class="text-[11px] font-bold text-emerald-700 shrink-0">Update &rarr;</span>
              </button>` : ''}
            <button type="button" onclick="closeModal(); openSyncEncryptionDialog();"
              class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-800 font-semibold transition cursor-pointer">
              <span>Encryption Settings &amp; Auto-Lock</span>
              <span class="text-[11px] font-bold text-emerald-700 shrink-0">${getMasterKeyActive() ? 'Active' : 'Configure'}</span>
            </button>
          ` : `
            <button type="button" onclick="closeModal(); ppOpenChangeMyPasswordModal(false);"
              class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 font-semibold transition cursor-pointer">
              <span>Change My Personal Password</span>
              <span class="text-[11px] font-bold text-indigo-600 shrink-0">Update &rarr;</span>
            </button>
          `}

          <button type="button" onclick="closeModal(); ppOpenSwitchLoginModal();"
            class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold transition cursor-pointer">
            <span>Switch Account / Sign In as Another User</span>
            <span class="text-[11px] font-bold text-slate-500 shrink-0">Sign In &rarr;</span>
          </button>

          ${getMasterKeyActive() || ppAuthSession.mode === 'admin' || ppAuthSession.mode === 'user' ? `
            <button type="button" id="ppModalLockSessionBtn"
              class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-50 text-rose-700 font-semibold transition cursor-pointer">
              <span>Sign Out &amp; Hide All Data</span>
              <span class="text-[11px] font-bold shrink-0">Sign Out</span>
            </button>` : ''}
        </div>
      </div>`, 'max-w-md');

    document.getElementById('ppModalLockSessionBtn')?.addEventListener('click', () => {
      ppSignOutAndLockSession('manual');
    });
  }

  /* ==================== HEADER CHROME & SYNC HUB LIVE UPDATERS ==================== */

  function ppSyncAuthChromeUI() {
    const db = getDb();
    const ac = ensureAccessControl(db);
    const isStd = ppIsStandardUser();
    const isAdmin = ppHasAdminAccess();
    const isMainAdmin = !ppIsNamedUser();
    const isSignedInProtected = getMasterKeyActive() || ppAuthSession.mode === 'admin' || ppAuthSession.mode === 'user';
    const activeUsersCount = ac.users.filter(u => u && u.enabled !== false).length;

    const roleBadge = document.getElementById('headerMenuRoleBadge');
    if (roleBadge) {
      if (isStd) {
        roleBadge.textContent = 'Member';
        roleBadge.className = 'pp-role-badge pp-role-user';
      } else if (ppIsDelegatedAdmin()) {
        roleBadge.textContent = 'Admin';
        roleBadge.className = 'pp-role-badge pp-role-admin';
      } else if (ppAuthSession.mode === 'admin' || getMasterKeyActive()) {
        roleBadge.textContent = 'Main Admin';
        roleBadge.className = 'pp-role-badge pp-role-admin';
      } else {
        roleBadge.className = 'hidden pp-role-badge pp-role-admin';
      }
    }

    const manageBtn = document.getElementById('headerMenuManageUsersBtn');
    const manageCnt = document.getElementById('headerMenuUsersCount');
    if (manageBtn) {
      manageBtn.classList.toggle('hidden', !isAdmin || ppIsSessionLocked());
      if (manageCnt) manageCnt.textContent = String(activeUsersCount);
    }

    const changePwBtn = document.getElementById('headerMenuChangePwBtn');
    const changePwLbl = document.getElementById('headerMenuChangePwLabel');
    if (changePwBtn) {
      const showChangePw = ppIsNamedUser() || (isMainAdmin && getMasterKeyActive());
      changePwBtn.classList.toggle('hidden', !showChangePw);
      if (changePwLbl) {
        changePwLbl.textContent = ppIsNamedUser() ? 'Change My Password' : 'Change Admin Password';
      }
    }

    const signOutBtn = document.getElementById('headerMenuSignOutBtn');
    if (signOutBtn) {
      signOutBtn.classList.toggle('hidden', !isSignedInProtected || ppIsSessionLocked());
    }

    const encMenuBtn = document.getElementById('ppSyncEncMenuBtn');
    if (encMenuBtn) encMenuBtn.classList.toggle('hidden', ppIsNamedUser());

    const demoToggleBtn = document.getElementById('demoToggleBtn');
    if (demoToggleBtn) demoToggleBtn.classList.toggle('hidden', isStd);

    const mDemoToggleBtn = document.getElementById('mDemoToggleBtn');
    if (mDemoToggleBtn) mDemoToggleBtn.classList.toggle('hidden', isStd);

    const whatIfToggleBtn = document.getElementById('whatIfToggleBtn');
    if (whatIfToggleBtn) whatIfToggleBtn.classList.toggle('hidden', isStd);

    const canSync = ppCanAccessTab('sync');
    const mobileSnapBtn = document.getElementById('mobileQuickSaveSnapBtn');
    if (mobileSnapBtn) mobileSnapBtn.classList.toggle('hidden', !canSync);
    const mobileShareBtn = document.getElementById('mobileQuickShareJsonBtn');
    if (mobileShareBtn) mobileShareBtn.classList.toggle('hidden', !canSync);

    const encChip = document.getElementById('ppSyncEncChip');
    if (encChip) {
      const encActive = getMasterKeyActive();
      encChip.textContent = encActive ? 'ON' : 'OFF';
      encChip.className = encActive ? 'text-[10px] font-bold text-emerald-600' : 'text-[10px] font-bold text-slate-400';
    }
    if (typeof ppUpdateHeaderShieldBadge === 'function') ppUpdateHeaderShieldBadge();
  }

  function ppRefreshSyncHubUI() {
    const db = getDb();
    if (!db) return;
    const ac = ensureAccessControl(db);
    const isAdmin = ppHasAdminAccess();
    const isNamed = ppIsNamedUser();
    const encActive = getMasterKeyActive();
    const activeUsers = ac.users.filter(u => u && u.enabled !== false).length;

    const encBadge = document.getElementById('ppSyncTabEncBadge');
    if (encBadge) {
      encBadge.textContent = encActive ? 'AES-256-GCM Active' : 'Plaintext JSON';
      encBadge.className = encActive
        ? 'px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase whitespace-nowrap'
        : 'px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-bold text-[10px] uppercase whitespace-nowrap';
    }

    // Tile 1: Sync Connection
    const connTitle = document.getElementById('syncHeroConnTitle');
    const connSub = document.getElementById('syncHeroConnSub');
    if (connTitle && connSub) {
      const hasLinked = typeof linkedFileHandle !== 'undefined' && Boolean(linkedFileHandle);
      const isMissing = typeof syncWarningState !== 'undefined' && syncWarningState?.type === 'missing';
      const dotCls = hasLinked ? 'pp-status-dot-ok' : (isMissing ? 'pp-status-dot-err' : 'pp-status-dot-warn');
      const label = hasLinked ? linkedFileHandle.name : (isMissing ? 'Linked File Missing' : 'Browser Storage Only');
      connTitle.innerHTML = `<span id="syncHeroConnDot" class="pp-status-dot ${dotCls}" aria-hidden="true"></span><span class="truncate">${esc(label)}</span>`;
      connSub.textContent = hasLinked
        ? `Rev ${db.meta?.revision || 1} · Last saved by ${db.meta?.lastModifiedBy || ui?.userName || 'Team'}`
        : 'Link a shared .json file in Google Drive Desktop or a shared folder for live team sync.';
    }

    // Tile 2: Encryption & Signed-in Account
    const authTitle = document.getElementById('syncHeroAuthTitle');
    const authSub = document.getElementById('syncHeroAuthSub');
    const encBtn = document.getElementById('ppSyncTabEncBtn');
    const teamBtn = document.getElementById('syncHeroTeamBtn');
    if (authTitle && authSub) {
      const dotCls = encActive ? 'pp-status-dot-ok' : 'pp-status-dot-neutral';
      const who = isNamed
        ? `${ppAuthSession.userName} (${ppIsDelegatedAdmin() ? 'Admin' : 'Member'})`
        : `${ac.adminName || 'Administrator'}${encActive ? ' (Main Admin)' : ''}`;
      authTitle.innerHTML = `<span id="syncHeroAuthDot" class="pp-status-dot ${dotCls}" aria-hidden="true"></span><span class="truncate">${esc(who)}</span>`;
      if (isNamed) {
        authSub.textContent = ppIsDelegatedAdmin()
          ? 'Signed in with personal password · Delegated Administrator with full team & Finance access.'
          : 'Signed in with personal password · Master AES-256-GCM key unlocked internally.';
      } else if (encActive) {
        authSub.textContent = `AES-256-GCM active · ${activeUsers} team login${activeUsers === 1 ? '' : 's'} configured.`;
      } else {
        authSub.textContent = 'Set an Administrator password to encrypt files and add team user logins.';
      }
    }
    if (encBtn) {
      encBtn.classList.toggle('hidden', isNamed);
      encBtn.textContent = encActive ? 'Admin Key' : 'Enable Encryption';
    }
    if (teamBtn) {
      teamBtn.classList.toggle('hidden', !isAdmin);
      teamBtn.textContent = activeUsers > 0 ? `Team Users (${activeUsers})` : 'Team Users';
    }

    // Tile 3: Separate Finance Vault (shows stored Main DB path + 1-click reconnect when remembered)
    const finTile = document.getElementById('syncHeroFinanceTile');
    const finBadge = document.getElementById('syncHeroFinBadge');
    const finTitle = document.getElementById('syncHeroFinTitle');
    const finSub = document.getElementById('syncHeroFinSub');
    const finBtn = document.getElementById('syncHeroFinBtn');
    const canFin = ppCanAccessFinance();
    if (finTile) finTile.classList.toggle('hidden', !canFin);
    if (canFin && finTitle && finSub && typeof window !== 'undefined' && typeof window.ppGetFinanceVaultStatus === 'function') {
      const st = window.ppGetFinanceVaultStatus();
      const dotCls = st.unlocked ? 'pp-status-dot-ok' : (st.splitMode ? 'pp-status-dot-warn' : 'pp-status-dot-neutral');
      finTitle.innerHTML = `<span id="syncHeroFinDot" class="pp-status-dot ${dotCls}" aria-hidden="true"></span><span class="truncate">${esc(st.unlocked || st.linkedInMainDb ? st.fileName : 'Separate Finance Vault')}</span>`;
      if (finBadge) {
        finBadge.textContent = st.unlocked ? 'Unlocked' : (st.hasPendingReconnect ? '1-Click Open' : (st.splitMode ? 'Split · Locked' : 'Ready'));
        finBadge.className = st.unlocked
          ? 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase whitespace-nowrap'
          : (st.hasPendingReconnect
              ? 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 uppercase whitespace-nowrap'
              : 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 uppercase whitespace-nowrap');
      }
      finSub.textContent = st.unlocked
        ? `Auto-syncing separate file: ${st.filePath || st.fileName}`
        : (st.hasPendingReconnect
            ? `Remembered file ready (${st.filePath || st.fileName}) — click once to grant access & unlock.`
            : (st.linkedInMainDb
                ? `Linked in main DB: ${st.filePath || st.fileName} (auto-opens once remembered on this device).`
                : (st.hasSessionKey
                    ? 'Kept in its own encrypted file using your session key — no separate finance password needed.'
                    : 'Enable Administrator encryption first to create or open the separate Finance Vault.')));
      if (finBtn) {
        finBtn.textContent = st.unlocked
          ? 'Manage Vault'
          : (st.hasPendingReconnect ? 'Reconnect Finance' : 'Open Finance Vault');
        finBtn.onclick = () => {
          if (!st.unlocked && st.hasPendingReconnect && typeof window.ppReconnectFinanceVault === 'function') {
            window.ppReconnectFinanceVault();
          } else if (typeof window.ppOpenFinanceVaultModal === 'function') {
            window.ppOpenFinanceVaultModal();
          }
        };
      }
    }

    const strip = document.querySelector('.pp-sync-strip');
    if (strip) {
      strip.style.gridTemplateColumns = canFin ? '' : 'repeat(2, minmax(0, 1fr))';
    }
  }

  /* ==================== GLOBAL WIRING ==================== */

  if (typeof openUserSwitcherModal === 'function') {
    openUserSwitcherModal = openModernAccountModal;
  }

  if (typeof renderAll === 'function') {
    const prevRenderAll = renderAll;
    renderAll = function (...args) {
      const res = prevRenderAll.apply(this, args);
      ppSyncAuthChromeUI();
      if (!ppIsSessionLocked()) {
        if (typeof ui !== 'undefined' && ui.activeTab === 'sync') {
          ppRefreshSyncHubUI();
        }
      }
      return res;
    };
  }

  if (typeof renderDataTab === 'function') {
    const prevRenderDataTab = renderDataTab;
    renderDataTab = function (...args) {
      const res = prevRenderDataTab.apply(this, args);
      if (!ppIsSessionLocked()) {
        renderAdminAccessCardInSetup();
      }
      return res;
    };
  }

  function ppOnModalClosed() {
    pendingResetUserId = '';
    pendingResetDraft = '';
    pendingEditUserId = '';
  }

  const exportsMap = {
    ppGetAuthSession,
    ppIsSessionLocked,
    ppIsSigningOut,
    ppIsMainAdmin,
    ppIsDelegatedAdmin,
    ppIsNamedUser,
    ppIsStandardUser,
    ppHasAdminAccess,
    ppCanAccessTab,
    ppCanAccessFinance,
    ppGetFirstAllowedTab,
    ppApplyAuthenticatedSession,
    ppSyncAuthAfterDbLoad,
    ppOnSessionLocked,
    ppSignOutAndLockSession,
    ppEnterInitialLockedGate,
    ppRefreshLockedScreenUI,
    ppClearPlaintextLocalCaches: clearPlaintextLocalCaches,
    ppUnlockFromLockedScreen,
    ppPromptEncryptedFileLogin,
    ppOpenSwitchLoginModal,
    ppCheckForcedPasswordChange,
    ppOpenPasswordActionModal,
    ppOpenChangeAdminPasswordModal,
    ppChangeMainAdminPassword: changeMainAdminPassword,
    ppOpenChangeMyPasswordModal,
    ppOpenTeamAccessModal,
    ppRefreshTeamAccessSetupCard: renderAdminAccessCardInSetup,
    ppOnModalClosed,
    ppSyncAuthChromeUI,
    ppRefreshSyncHubUI,
    openUserSwitcherModal: openModernAccountModal,
  };

  if (typeof window !== 'undefined') {
    Object.assign(window, exportsMap);
  }
  if (typeof globalThis !== 'undefined') {
    Object.assign(globalThis, exportsMap);
    globalThis.__ppAuthRbacTestApi = {
      ...exportsMap,
      createOrUpdateUserAccount,
      updateUserAccountDetails,
      toggleUserAccountEnabled,
      adminResetUserPassword,
      changeCurrentUserPassword,
      changeMainAdminPassword,
      authenticateInMemoryAccount,
      normalizeUserPermissions,
      generateTempPassword,
      nativeOpenUserSwitcherModal,
      getLockedState: () => ppLockedState,
    };
  }
})();
