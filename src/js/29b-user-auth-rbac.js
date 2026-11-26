/* Multi-User Login, Wrapped-Key Auth, Role-Based Access Control (Tabs + Finance),
 * Self-Service Password Selection, Admin Password Reset & Modernized Sync/Login Hub */
(function ppUserAuthRbacModule() {
  const ALL_TABS = ['matrix', 'health', 'data', 'sync'];
  const TAB_META = {
    matrix: { short: 'Roadmap', label: 'Roadmap Matrix' },
    health: { short: 'Health', label: 'Health & Evolution' },
    data: { short: 'Setup', label: 'Setup & Data' },
    sync: { short: 'Sync', label: 'Sync & Snapshots' },
  };

  const ppAuthSession = {
    mode: 'open', // 'open' | 'admin' | 'user'
    userId: null,
    userName: '',
    roleTitle: '',
    mustChangePassword: false,
    permissions: {
      tabs: { matrix: true, health: true, data: true, sync: true },
      finance: true,
    },
  };

  let pendingResetUserId = '';

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

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return null;
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

  function ppIsStandardUser() {
    return ppAuthSession.mode === 'user';
  }

  function ppHasAdminAccess() {
    return ppAuthSession.mode !== 'user';
  }

  function ppCanAccessTab(tab) {
    if (!ppIsStandardUser()) return true;
    return Boolean(ppAuthSession.permissions?.tabs?.[tab]);
  }

  function ppCanAccessFinance() {
    if (!ppIsStandardUser()) return true;
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

  function ppApplyAuthenticatedSession(role, userRecord = null, adminNameOverride = '') {
    const db = getDb();
    const ac = ensureAccessControl(db);
    if (role === 'user' && userRecord) {
      const perms = normalizeUserPermissions(userRecord.permissions);
      ppAuthSession.mode = 'user';
      ppAuthSession.userId = userRecord.id;
      ppAuthSession.userName = userRecord.name;
      ppAuthSession.roleTitle = userRecord.roleTitle || 'Team Member';
      ppAuthSession.mustChangePassword = Boolean(userRecord.mustChangePassword);
      ppAuthSession.permissions = perms;

      if (typeof ui !== 'undefined') {
        ui.userName = userRecord.name;
        ui.demoMode = false;
        ui.whatIfMode = false;
        if (typeof whatIfDB !== 'undefined') whatIfDB = null;
        if (!ppCanAccessTab(ui.activeTab)) {
          ui.activeTab = ppGetFirstAllowedTab();
        }
        if (typeof persistUIPrefs === 'function') persistUIPrefs();
      }
      if (!perms.finance && typeof window !== 'undefined' && typeof window.ppLockFinanceVaultSilently === 'function') {
        window.ppLockFinanceVaultSilently(true);
      }
    } else if (role === 'admin') {
      const adminLabel = String(adminNameOverride || ac.adminName || 'Administrator').trim() || 'Administrator';
      ppAuthSession.mode = 'admin';
      ppAuthSession.userId = '__ADMIN__';
      ppAuthSession.userName = adminLabel;
      ppAuthSession.roleTitle = 'Administrator';
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
    if (ppAuthSession.mode === 'user' && ppAuthSession.userId) {
      const fresh = ac.users.find(u => u && u.id === ppAuthSession.userId);
      if (!fresh || fresh.enabled === false) {
        if (typeof ppSyncPassphrase !== 'undefined') ppSyncPassphrase = '';
        ppOnSessionLocked('revoked');
        toast('Your account was disabled or removed by the Administrator.', 'warning');
        return;
      }
      ppApplyAuthenticatedSession('user', fresh);
    } else if (ppAuthSession.mode === 'admin') {
      ppAuthSession.userName = ac.adminName || 'Administrator';
      ppSyncAuthChromeUI();
    } else if (getMasterKeyActive()) {
      ppApplyAuthenticatedSession('admin', null, ac.adminName);
    }
  }

  function ppOnSessionLocked(reason = 'manual') {
    if (typeof window !== 'undefined' && typeof window.ppLockFinanceVaultSilently === 'function') {
      window.ppLockFinanceVaultSilently(true);
    }
    if (reason === 'disabled') {
      ppApplyAuthenticatedSession('open');
    } else if (ppAuthSession.mode === 'user' || ppAuthSession.mode === 'admin') {
      ppApplyAuthenticatedSession('open');
    }
    if (typeof renderAll === 'function') renderAll();
  }

  /* ==================== CRYPTO ACTIONS: PROVISION, RESET, SELF-CHANGE PASSWORD ==================== */

  async function createOrUpdateUserAccount({ name, roleTitle = '', permissions, tempPassword, mustChangePassword = true }) {
    if (!ppHasAdminAccess()) throw new Error('Administrator privileges required.');
    if (!getMasterKeyActive()) throw new Error('Enable the Administrator encryption password first.');
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('User name is required.');
    if (!tempPassword || tempPassword.length < 8) throw new Error('Initial password must be at least 8 characters.');

    const db = getDb();
    const ac = ensureAccessControl(db);
    const existing = ac.users.find(u => u.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) throw new Error(`A user named "${cleanName}" already exists.`);

    const userId = typeof uid === 'function' ? uid('usr') : `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const keySlot = await ppWrapMasterPassphrase(ppSyncPassphrase, tempPassword, userId);
    const record = {
      id: userId,
      name: cleanName,
      roleTitle: String(roleTitle || '').trim(),
      enabled: true,
      mustChangePassword: Boolean(mustChangePassword),
      needsAdminKeyReset: false,
      permissions: normalizeUserPermissions(permissions),
      keySlot,
      updatedAt: new Date().toISOString(),
    };
    ac.users.push(record);
    if (typeof recordChange === 'function') {
      recordChange('Access', `Added user login "${cleanName}" (${record.permissions.finance ? 'Finance ON' : 'No Finance'})`);
    }
    persistDbChanges();
    return record;
  }

  async function adminResetUserPassword(userId, newTempPassword, requireChange = true) {
    if (!ppHasAdminAccess()) throw new Error('Administrator privileges required.');
    if (!getMasterKeyActive()) throw new Error('Enable the Administrator encryption password first.');
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

    if (typeof recordChange === 'function') {
      recordChange('Access', `Administrator reset password for "${user.name}"`);
    }
    persistDbChanges();
    return user;
  }

  async function changeCurrentUserPassword({ currentPassword = '', newPassword, skipCurrentVerify = false }) {
    if (!ppIsStandardUser() || !ppAuthSession.userId) {
      throw new Error('Only signed-in standard users can use personal password change.');
    }
    if (!getMasterKeyActive()) {
      throw new Error('Active encrypted session required.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long.');
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

    if (typeof recordChange === 'function') {
      recordChange('Access', `"${user.name}" updated their personal password`);
    }
    persistDbChanges();
    return user;
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
      // If session was locked but we have at least one user, we can't verify admin key without a file; accept min-8 to re-establish session
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

  /* ==================== MODERN SIGN-IN DIALOG (ENCRYPTED FILE & ACCOUNT SWITCH) ==================== */

  function removeAuthOverlay() {
    document.getElementById('ppAuthOverlay')?.remove();
  }

  function renderModernLoginDialog({ title, subtitle, adminName, accounts, defaultAccountId, onAuthenticate, onCancel }) {
    removeAuthOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'ppAuthOverlay';
    overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center p-4';
    overlay.style.background = 'rgba(15, 23, 42, 0.58)';
    overlay.style.backdropFilter = 'blur(4px)';

    let selectedId = defaultAccountId || (accounts.length > 0 ? accounts[0].id : '__ADMIN__');
    const allCards = [
      { id: '__ADMIN__', name: adminName || 'Administrator', roleTitle: 'Administrator · Full Access', isAdmin: true, mustChange: false },
      ...accounts.map(u => ({
        id: u.id,
        name: u.name,
        roleTitle: u.roleTitle || 'Team Member',
        isAdmin: false,
        mustChange: Boolean(u.mustChangePassword),
      })),
    ];

    const renderCards = () => allCards.map(acct => {
      const sel = acct.id === selectedId;
      return `
        <button type="button" data-pp-login-acct="${esc(acct.id)}" class="pp-auth-acct-card ${sel ? 'is-selected' : ''}">
          <span class="pp-auth-avatar ${acct.isAdmin ? 'pp-auth-avatar-admin' : ''}">${acct.isAdmin ? 'AD' : esc(getInitials(acct.name))}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-xs font-bold truncate">${esc(acct.name)}</span>
            <span class="block text-[10px] text-slate-500 truncate">${esc(acct.roleTitle)}${acct.mustChange ? ' · Reset' : ''}</span>
          </span>
        </button>`;
    }).join('');

    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="ppLoginTitle"
        class="w-full max-w-md rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden text-xs"
        style="background:var(--surface-card,#ffffff);color:var(--text-primary,#0f172a);border-color:var(--border-subtle,#cbd5e1)">
        <div class="p-5 space-y-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <div>
                <h2 id="ppLoginTitle" class="text-base font-extrabold" style="color:var(--text-heading,#0f172a)">${esc(title)}</h2>
                <p class="text-[11px] mt-0.5 leading-relaxed" style="color:var(--text-muted,#64748b)">${esc(subtitle)}</p>
              </div>
            </div>
            <button type="button" id="ppLoginCloseBtn" aria-label="Close sign in dialog" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold cursor-pointer shrink-0">&times;</button>
          </div>

          <div class="space-y-1.5">
            <div class="text-[10.5px] font-extrabold uppercase tracking-wider" style="color:var(--text-faint,#64748b)">Select Account</div>
            <div id="ppLoginAcctGrid" class="pp-auth-acct-grid">${renderCards()}</div>
          </div>

          <form id="ppLoginForm" class="space-y-3" onsubmit="return false;">
            <div class="space-y-1.5">
              <label for="ppLoginPassword" id="ppLoginPwLabel" class="block font-semibold" style="color:var(--text-secondary,#334155)">Password</label>
              <div class="flex items-center gap-1.5">
                <input id="ppLoginPassword" type="password" autocomplete="current-password" placeholder="Enter your password..."
                  class="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium"
                  style="background:var(--surface-subtle,#f8fafc);color:var(--text-primary,#0f172a);border-color:var(--border-subtle,#cbd5e1)" />
                <button type="button" id="ppLoginEyeBtn" class="px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-semibold transition cursor-pointer shrink-0">Show</button>
              </div>
            </div>

            <div id="ppLoginErr" role="alert" class="hidden rounded-xl px-3 py-2 text-[11.5px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"></div>

            <div class="flex items-center justify-between gap-2 pt-2 border-t" style="border-color:var(--border-subtle,#e2e8f0)">
              <span class="text-[10.5px]" style="color:var(--text-faint,#64748b)">AES-256-GCM · Local Zero-Server Auth</span>
              <div class="flex items-center gap-2">
                <button type="button" id="ppLoginCancelBtn" class="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition cursor-pointer">Cancel</button>
                <button type="submit" id="ppLoginSubmitBtn" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition cursor-pointer">Sign In</button>
              </div>
            </div>
          </form>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const pwInput = overlay.querySelector('#ppLoginPassword');
    const pwLabel = overlay.querySelector('#ppLoginPwLabel');
    const errBox = overlay.querySelector('#ppLoginErr');
    const submitBtn = overlay.querySelector('#ppLoginSubmitBtn');
    const eyeBtn = overlay.querySelector('#ppLoginEyeBtn');
    const grid = overlay.querySelector('#ppLoginAcctGrid');

    const updateSelectedUI = () => {
      const acct = allCards.find(a => a.id === selectedId) || allCards[0];
      if (pwLabel) pwLabel.textContent = acct.isAdmin ? `${acct.name} Password` : `Password for ${acct.name}`;
      if (pwInput) pwInput.placeholder = acct.isAdmin ? 'Enter Administrator password...' : `Enter ${acct.name}'s password...`;
      grid?.querySelectorAll('[data-pp-login-acct]').forEach(btn => {
        btn.classList.toggle('is-selected', btn.getAttribute('data-pp-login-acct') === selectedId);
      });
      if (errBox) errBox.classList.add('hidden');
      pwInput?.focus();
    };

    grid?.addEventListener('click', (ev) => {
      const card = ev.target?.closest?.('[data-pp-login-acct]');
      if (!card) return;
      selectedId = card.getAttribute('data-pp-login-acct') || '__ADMIN__';
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
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') cancelAll();
    });

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
      const adminName = envelope?.auth?.adminName || 'Administrator';
      const fileLabel = opts.fileName ? `"${opts.fileName}"` : 'encrypted PulsePlan database';
      renderModernLoginDialog({
        title: authUsers.length > 0 ? 'Sign In to Workspace' : 'Unlock Encrypted Workspace',
        subtitle: authUsers.length > 0
          ? `Choose your account to unlock ${fileLabel}. Encryption stays protected by the Administrator master key.`
          : `Enter the Administrator password to decrypt and open ${fileLabel}.`,
        adminName,
        accounts: authUsers,
        defaultAccountId: authUsers.length > 0 ? authUsers[0].id : '__ADMIN__',
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
    renderModernLoginDialog({
      title: 'Switch Account / Sign In',
      subtitle: 'Sign in as Administrator or any team member. Permissions and Finance access update immediately.',
      adminName: ac.adminName || 'Administrator',
      accounts: activeUsers,
      defaultAccountId: preferredAccountId || (ppIsStandardUser() ? '__ADMIN__' : (activeUsers[0]?.id || '__ADMIN__')),
      onAuthenticate: async (accountId, password) => {
        const res = await authenticateInMemoryAccount(accountId, password);
        if (typeof renderAll === 'function') renderAll();
        if (res.authRole === 'admin') {
          toast(`Signed in as ${ac.adminName || 'Administrator'} (Full Access)`, 'success');
        } else {
          toast(`Signed in as ${res.userRecord.name}`, 'success');
          if (res.userRecord.mustChangePassword) {
            setTimeout(() => ppOpenChangeMyPasswordModal(true), 120);
          }
        }
      },
      onCancel: () => {},
    });
  }

  /* ==================== SELF-SERVICE CHANGE PASSWORD (FORCED & VOLUNTARY) ==================== */

  function ppCheckForcedPasswordChange() {
    if (ppIsStandardUser() && ppAuthSession.mustChangePassword) {
      ppOpenChangeMyPasswordModal(true);
    }
  }

  function ppOpenChangeMyPasswordModal(isForced = false) {
    if (!ppIsStandardUser()) {
      if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog();
      return;
    }
    const userName = ppAuthSession.userName || 'Team Member';
    showModal(`
      <form id="ppChangeMyPwForm" class="p-5 space-y-4 text-xs" onsubmit="return false;">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-2.5">
            <span class="pp-auth-avatar">${esc(getInitials(userName))}</span>
            <div>
              <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">${isForced ? 'Choose Your Personal Password' : 'Change My Password'}</h3>
              <p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                ${isForced
                  ? 'Your Administrator assigned a temporary password. Set your own private password now — only you will know it.'
                  : 'Update your personal sign-in password. Workspace encryption remains protected seamlessly under the hood.'}
              </p>
            </div>
          </div>
          ${isForced ? '' : '<button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>'}
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
          <div class="flex items-center gap-1.5">
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
      const st = ppEvaluatePassphraseStrength(newInp.value || '');
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
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Personal Password';
      }
    });
  }

  /* ==================== ADMIN TEAM ACCESS & PERMISSIONS MANAGER ==================== */

  function buildTeamAccessInnerHtml(db) {
    const ac = ensureAccessControl(db);
    const hasKey = getMasterKeyActive();
    const people = typeof window !== 'undefined' && typeof window.ppGetPeopleDirectory === 'function'
      ? window.ppGetPeopleDirectory()
      : (Array.isArray(db?.peopleDirectory) ? db.peopleDirectory : []);
    const existingNames = new Set(ac.users.map(u => u.name.toLowerCase()));
    const availablePeople = people.filter(p => p && p.name && !existingNames.has(p.name.toLowerCase()));

    const rowsHtml = ac.users.length === 0
      ? `<tr><td colspan="4" class="py-6 text-center text-slate-400">No team user logins created yet. Add an owner or lead above to grant tailored access.</td></tr>`
      : ac.users.map(u => {
          const perms = normalizeUserPermissions(u.permissions);
          const isResetting = pendingResetUserId === u.id;
          const statusChip = u.needsAdminKeyReset
            ? '<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">Key Reset Needed</span>'
            : (u.mustChangePassword
                ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">Temp Password</span>'
                : '<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">Personal Key Active</span>');

          return `
            <tr data-pp-user-row="${esc(u.id)}">
              <td>
                <div class="flex items-center gap-2.5">
                  <span class="pp-auth-avatar">${esc(getInitials(u.name))}</span>
                  <div class="min-w-0">
                    <div class="font-bold text-slate-900 flex flex-wrap items-center gap-1.5">
                      <span>${esc(u.name)}</span>
                      ${statusChip}
                    </div>
                    <div class="text-[11px] text-slate-500">${esc(u.roleTitle || 'Team Member')}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  ${ALL_TABS.map(t => `
                    <button type="button" data-pp-toggle-tab="${t}" data-pp-uid="${esc(u.id)}"
                      class="pp-perm-pill ${perms.tabs[t] ? 'is-on' : ''}"
                      title="Toggle access to ${TAB_META[t].label}">
                      ${perms.tabs[t] ? '&#10003;' : '&times;'} ${TAB_META[t].short}
                    </button>`).join('')}
                </div>
              </td>
              <td>
                <button type="button" data-pp-toggle-fin="${esc(u.id)}"
                  class="pp-perm-pill is-fin ${perms.finance ? 'is-on' : ''}"
                  title="Toggle access to Day Rates, Project Costs & Finance Vault">
                  ${perms.finance ? '&#10003; Finance ON' : 'Restricted'}
                </button>
              </td>
              <td style="text-align:right;white-space:nowrap">
                <div class="inline-flex items-center gap-1.5">
                  <button type="button" data-pp-reset-open="${esc(u.id)}" class="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 text-[11px] font-semibold cursor-pointer">Reset Pw</button>
                  <button type="button" data-pp-delete-user="${esc(u.id)}" class="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 text-[11px] font-semibold cursor-pointer">Remove</button>
                </div>
              </td>
            </tr>
            ${isResetting ? `
            <tr>
              <td colspan="4" class="bg-indigo-50/50">
                <div class="flex flex-wrap items-center gap-2 py-1">
                  <span class="text-[11px] font-bold text-indigo-900">New temp password for ${esc(u.name)}:</span>
                  <input type="text" data-pp-reset-input="${esc(u.id)}" value="${esc(generateTempPassword())}" class="px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white font-mono text-xs font-semibold w-44" />
                  <button type="button" data-pp-reset-gen="${esc(u.id)}" class="px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold cursor-pointer">Generate</button>
                  <button type="button" data-pp-reset-save="${esc(u.id)}" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold cursor-pointer">Save Reset</button>
                  <button type="button" data-pp-reset-cancel="${esc(u.id)}" class="px-2 py-1.5 rounded-lg text-slate-500 hover:underline text-[11px] font-semibold cursor-pointer">Cancel</button>
                </div>
              </td>
            </tr>` : ''}`;
        }).join('');

    return `
      <div class="space-y-4 text-xs">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-extrabold text-slate-900">Team Users, Login &amp; Access Permissions</h3>
            <p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Each user sets their own password to internally unlock your Administrator encryption key (never shown). Control which tabs and financial data each member can see.
            </p>
          </div>
          <div class="flex items-center gap-1.5">
            <label for="ppAdminNameInput" class="text-[11px] font-semibold text-slate-500">Admin Name:</label>
            <input id="ppAdminNameInput" type="text" value="${esc(ac.adminName)}" class="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold w-36" />
          </div>
        </div>

        ${!hasKey ? `
          <div class="p-3.5 rounded-xl border border-amber-200 bg-amber-50/80 text-amber-900 flex flex-wrap items-center justify-between gap-3">
            <div class="space-y-0.5">
              <div class="font-bold">Step 1: Activate Administrator Encryption Password</div>
              <div class="text-[11px]">Set your Administrator password first so each team user's password can securely wrap and unlock it.</div>
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
                <div class="flex items-center gap-1">
                  <input type="text" data-pp-new-pw value="${esc(generateTempPassword())}" class="flex-1 min-w-0 px-2.5 py-2 rounded-xl border border-slate-200 bg-white font-mono text-xs font-semibold" />
                  <button type="button" data-pp-gen-pw title="Generate random temporary password" class="px-2 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold cursor-pointer">New</button>
                  <button type="button" data-pp-copy-pw title="Copy temporary password" class="px-2 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold cursor-pointer">Copy</button>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-[11px] font-semibold text-slate-500 mr-1">Initial Access:</span>
                <label class="pp-perm-pill is-on"><input type="checkbox" data-pp-new-tab="matrix" checked class="sr-only" /><span>Roadmap</span></label>
                <label class="pp-perm-pill is-on"><input type="checkbox" data-pp-new-tab="health" checked class="sr-only" /><span>Health</span></label>
                <label class="pp-perm-pill"><input type="checkbox" data-pp-new-tab="data" class="sr-only" /><span>Setup</span></label>
                <label class="pp-perm-pill"><input type="checkbox" data-pp-new-tab="sync" class="sr-only" /><span>Sync</span></label>
                <label class="pp-perm-pill is-fin"><input type="checkbox" data-pp-new-fin class="sr-only" /><span>Financial Data</span></label>
              </div>
              <button type="submit" class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition cursor-pointer">+ Add User Login</button>
            </div>
            <label class="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
              <input type="checkbox" data-pp-new-must-change checked class="rounded text-indigo-600" />
              <span>Prompt user to choose their own personal password on first sign-in</span>
            </label>
          </form>
        `}

        <div class="overflow-x-auto">
          <table class="pp-access-table">
            <thead>
              <tr>
                <th>User Account</th>
                <th>Allowed Tabs</th>
                <th>Financial Data</th>
                <th style="text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  function wireTeamAccessContainer(container, onRerender) {
    if (!container) return;
    const db = getDb();
    const ac = ensureAccessControl(db);

    container.querySelector('#ppAdminNameInput')?.addEventListener('change', (ev) => {
      const next = String(ev.target.value || '').trim() || 'Administrator';
      ac.adminName = next;
      if (ppAuthSession.mode === 'admin') {
        ppAuthSession.userName = next;
      }
      persistDbChanges();
      ppSyncAuthChromeUI();
      ppRefreshSyncHubUI();
      toast(`Administrator display name set to "${next}"`, 'success');
    });

    container.querySelector('[data-pp-open-admin-enc]')?.addEventListener('click', () => {
      if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog();
    });

    const form = container.querySelector('[data-pp-add-user-form]');
    if (form) {
      const pickSel = form.querySelector('[data-pp-pick-person]');
      const nameInp = form.querySelector('[data-pp-new-name]');
      const pwInp = form.querySelector('[data-pp-new-pw]');
      let pickedRole = '';

      pickSel?.addEventListener('change', () => {
        const opt = pickSel.options[pickSel.selectedIndex];
        if (pickSel.value) {
          if (nameInp) nameInp.value = pickSel.value;
          pickedRole = opt?.getAttribute('data-role') || '';
        } else {
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

      form.querySelectorAll('label.pp-perm-pill input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (typeof cb.closest === 'function') {
            cb.closest('label.pp-perm-pill')?.classList.toggle('is-on', cb.checked);
          }
        });
      });

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const nm = (nameInp?.value || '').trim();
        const pw = (pwInp?.value || '').trim();
        const tabs = {
          matrix: Boolean(form.querySelector('[data-pp-new-tab="matrix"]')?.checked),
          health: Boolean(form.querySelector('[data-pp-new-tab="health"]')?.checked),
          data: Boolean(form.querySelector('[data-pp-new-tab="data"]')?.checked),
          sync: Boolean(form.querySelector('[data-pp-new-tab="sync"]')?.checked),
        };
        const finance = Boolean(form.querySelector('[data-pp-new-fin]')?.checked);
        const mustChangePassword = Boolean(form.querySelector('[data-pp-new-must-change]')?.checked);
        try {
          await createOrUpdateUserAccount({
            name: nm,
            roleTitle: pickedRole || 'Team Member',
            permissions: { tabs, finance },
            tempPassword: pw,
            mustChangePassword,
          });
          toast(`Created login for "${nm}". Share their temporary password securely.`, 'success');
          onRerender();
          ppSyncAuthChromeUI();
          ppRefreshSyncHubUI();
        } catch (err) {
          toast(err?.message || 'Could not add user.', 'error');
        }
      });
    }

    container.querySelectorAll('[data-pp-toggle-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uidVal = btn.getAttribute('data-pp-uid');
        const tabKey = btn.getAttribute('data-pp-toggle-tab');
        const user = ac.users.find(u => u.id === uidVal);
        if (!user) return;
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
        persistDbChanges();
        onRerender();
      });
    });

    container.querySelectorAll('[data-pp-toggle-fin]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uidVal = btn.getAttribute('data-pp-toggle-fin');
        const user = ac.users.find(u => u.id === uidVal);
        if (!user) return;
        const perms = normalizeUserPermissions(user.permissions);
        perms.finance = !perms.finance;
        user.permissions = perms;
        user.updatedAt = new Date().toISOString();
        persistDbChanges();
        onRerender();
        toast(`${user.name}: Financial data ${perms.finance ? 'enabled' : 'restricted'}.`, 'info');
      });
    });

    container.querySelectorAll('[data-pp-reset-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!getMasterKeyActive()) {
          toast('Enable Administrator encryption first before resetting passwords.', 'warning');
          return;
        }
        pendingResetUserId = btn.getAttribute('data-pp-reset-open') || '';
        onRerender();
      });
    });

    container.querySelectorAll('[data-pp-reset-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingResetUserId = '';
        onRerender();
      });
    });

    container.querySelectorAll('[data-pp-reset-gen]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uidVal = btn.getAttribute('data-pp-reset-gen');
        const inp = container.querySelector(`[data-pp-reset-input="${uidVal}"]`);
        if (inp) inp.value = generateTempPassword();
      });
    });

    container.querySelectorAll('[data-pp-reset-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uidVal = btn.getAttribute('data-pp-reset-save');
        const inp = container.querySelector(`[data-pp-reset-input="${uidVal}"]`);
        const nextTemp = (inp?.value || '').trim();
        try {
          const user = await adminResetUserPassword(uidVal, nextTemp, true);
          pendingResetUserId = '';
          toast(`Password reset for "${user.name}". They will choose a personal password on next login.`, 'success');
          onRerender();
        } catch (err) {
          toast(err?.message || 'Password reset failed.', 'error');
        }
      });
    });

    container.querySelectorAll('[data-pp-delete-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uidVal = btn.getAttribute('data-pp-delete-user');
        const target = ac.users.find(u => u.id === uidVal);
        if (!target) return;
        ac.users = ac.users.filter(u => u.id !== uidVal);
        if (pendingResetUserId === uidVal) pendingResetUserId = '';
        if (typeof recordChange === 'function') {
          recordChange('Access', `Removed user login "${target.name}"`);
        }
        persistDbChanges();
        onRerender();
        ppSyncAuthChromeUI();
        ppRefreshSyncHubUI();
        toast(`Removed user login for "${target.name}".`, 'info');
      });
    });
  }

  function renderAdminAccessCardInSetup() {
    const dataTab = document.getElementById('tab-data');
    if (!dataTab) return;
    let card = document.getElementById('ppAdminAccessCard');
    if (!ppHasAdminAccess()) {
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
    const db = getDb();
    card.innerHTML = buildTeamAccessInnerHtml(db);
    wireTeamAccessContainer(card, renderAdminAccessCardInSetup);
  }

  function ppOpenTeamAccessModal() {
    if (!ppHasAdminAccess()) {
      toast('Only the Administrator can manage team users and permissions.', 'warning');
      return;
    }
    const db = getDb();
    showModal(`
      <div class="p-5 space-y-4 text-xs">
        <div class="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div class="flex items-center gap-2">
            <span class="pp-role-badge pp-role-admin">Administrator</span>
            <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">Team Access Manager</h3>
          </div>
          <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold cursor-pointer">&times;</button>
        </div>
        <div id="ppTeamAccessModalBody">${buildTeamAccessInnerHtml(db)}</div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer">Done</button>
        </div>
      </div>`, 'max-w-3xl');

    const body = document.getElementById('ppTeamAccessModalBody');
    const rerenderModal = () => {
      if (!body) return;
      body.innerHTML = buildTeamAccessInnerHtml(getDb());
      wireTeamAccessContainer(body, rerenderModal);
      renderAdminAccessCardInSetup();
    };
    wireTeamAccessContainer(body, rerenderModal);
  }

  /* ==================== MODERNIZED ACCOUNT & USER SWITCHER MODAL ==================== */

  const nativeOpenUserSwitcherModal = typeof openUserSwitcherModal === 'function' ? openUserSwitcherModal : null;

  function openModernAccountModal() {
    const db = getDb();
    const ac = ensureAccessControl(db);
    const hasEncOrUsers = getMasterKeyActive() || ac.users.length > 0 || ppAuthSession.mode !== 'open';

    // Preserve 100% legacy quick-user switcher UX (and test.mjs compatibility) when auth is not yet configured,
    // while giving it a crisp modern layout and a 1-click Admin Security setup bridge.
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
            ${canRemove ? `<button type="button" data-user-name="${esc(name)}" onclick="removeQuickUser(this.dataset.userName)"
              title="Remove ${esc(name)}" aria-label="Remove user ${esc(name)}"
              class="px-2 py-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 font-bold leading-none transition cursor-pointer">&times;</button>` : ''}
          </div>`;
      }).join('');

      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="pp-auth-avatar">${esc(getInitials(current))}</span>
              <div>
                <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">Account &amp; Sign In</h3>
                <p class="text-[11px] text-slate-500">Shown in Change Log, Snapshots &amp; Sync metadata</p>
              </div>
            </div>
            <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold">&times;</button>
          </div>

          <form onsubmit="event.preventDefault(); saveUserSwitcherModal();" class="space-y-3">
            <div>
              <label for="mUserNameInput" class="block font-semibold text-slate-700 mb-1">Display Name / Role</label>
              <div class="flex items-center gap-2">
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
              Set an Administrator password to enable AES-256-GCM encryption, add personal team logins, and control tab &amp; financial permissions.
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
    const activeName = ppIsStandardUser() ? ppAuthSession.userName : (ac.adminName || (typeof ui !== 'undefined' ? ui.userName : 'Administrator'));
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
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="pp-auth-avatar ${isAdmin ? 'pp-auth-avatar-admin' : ''}">${isAdmin ? 'AD' : esc(getInitials(activeName))}</span>
            <div>
              <div class="flex items-center gap-2">
                <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">${esc(activeName)}</h3>
                <span class="pp-role-badge ${isAdmin ? 'pp-role-admin' : 'pp-role-user'}">${isAdmin ? 'Administrator' : esc(ppAuthSession.roleTitle || 'Member')}</span>
              </div>
              <p class="text-[11px] text-slate-500 mt-0.5">${getMasterKeyActive() ? 'AES-256-GCM session active' : 'Encryption key locked'}</p>
            </div>
          </div>
          <button type="button" aria-label="Close dialog" onclick="closeModal()" class="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg font-bold cursor-pointer">&times;</button>
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
              <span class="text-[11px] font-bold text-indigo-600">${activeUsersCount} user${activeUsersCount === 1 ? '' : 's'} &rarr;</span>
            </button>
            <button type="button" onclick="closeModal(); openSyncEncryptionDialog();"
              class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-800 font-semibold transition cursor-pointer">
              <span>Administrator Encryption Key &amp; Auto-Lock</span>
              <span class="text-[11px] font-bold text-emerald-700">${getMasterKeyActive() ? 'Active' : 'Configure'}</span>
            </button>
          ` : `
            <button type="button" onclick="closeModal(); ppOpenChangeMyPasswordModal(false);"
              class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-300 text-slate-800 font-semibold transition cursor-pointer">
              <span>Change My Personal Password</span>
              <span class="text-[11px] font-bold text-indigo-600">Update &rarr;</span>
            </button>
          `}

          <button type="button" onclick="closeModal(); ppOpenSwitchLoginModal();"
            class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold transition cursor-pointer">
            <span>Switch Account / Sign In as Another User</span>
            <span class="text-[11px] font-bold text-slate-500">Sign In &rarr;</span>
          </button>

          ${getMasterKeyActive() ? `
            <button type="button" id="ppModalLockSessionBtn"
              class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-50 text-rose-700 font-semibold transition cursor-pointer">
              <span>Sign Out &amp; Lock Session</span>
              <span class="text-[11px] font-bold">Lock</span>
            </button>` : ''}
        </div>
      </div>`, 'max-w-md');

    document.getElementById('ppModalLockSessionBtn')?.addEventListener('click', () => {
      if (typeof ppSyncPassphrase !== 'undefined') ppSyncPassphrase = '';
      if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
      ppOnSessionLocked('manual');
      if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
      closeModal();
      toast('Session locked. Encryption key cleared from memory.', 'info');
    });
  }

  /* ==================== HEADER CHROME & SYNC HUB LIVE UPDATERS ==================== */

  function ppSyncAuthChromeUI() {
    const db = getDb();
    const ac = ensureAccessControl(db);
    const isStd = ppIsStandardUser();
    const isAdminAuth = ppAuthSession.mode === 'admin';
    const activeUsersCount = ac.users.filter(u => u && u.enabled !== false).length;

    const roleBadge = document.getElementById('headerMenuRoleBadge');
    if (roleBadge) {
      if (isStd) {
        roleBadge.textContent = 'Member';
        roleBadge.className = 'pp-role-badge pp-role-user';
      } else if (isAdminAuth || getMasterKeyActive()) {
        roleBadge.textContent = 'Admin';
        roleBadge.className = 'pp-role-badge pp-role-admin';
      } else {
        roleBadge.className = 'hidden pp-role-badge pp-role-admin';
      }
    }

    const manageBtn = document.getElementById('headerMenuManageUsersBtn');
    const manageCnt = document.getElementById('headerMenuUsersCount');
    if (manageBtn) {
      manageBtn.classList.toggle('hidden', isStd);
      if (manageCnt) manageCnt.textContent = String(activeUsersCount);
    }

    const changePwBtn = document.getElementById('headerMenuChangePwBtn');
    if (changePwBtn) changePwBtn.classList.toggle('hidden', !isStd);

    const encMenuBtn = document.getElementById('ppSyncEncMenuBtn');
    if (encMenuBtn) encMenuBtn.classList.toggle('hidden', isStd);

    // Prevent restricted non-admin users from bypassing tab/finance rules via Demo Mode
    const demoToggleBtn = document.getElementById('demoToggleBtn');
    if (demoToggleBtn) demoToggleBtn.classList.toggle('hidden', isStd);
  }

  function ppRefreshSyncHubUI() {
    const db = getDb();
    if (!db) return;
    const ac = ensureAccessControl(db);
    const isStd = ppIsStandardUser();
    const encActive = getMasterKeyActive();
    const activeUsers = ac.users.filter(u => u && u.enabled !== false).length;

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
      const who = isStd
        ? `${ppAuthSession.userName} (Member)`
        : `${ac.adminName || 'Administrator'}${encActive ? ' (Admin)' : ''}`;
      authTitle.innerHTML = `<span id="syncHeroAuthDot" class="pp-status-dot ${dotCls}" aria-hidden="true"></span><span class="truncate">${esc(who)}</span>`;
      if (isStd) {
        authSub.textContent = 'Signed in with personal password · Master AES-256-GCM key unlocked internally.';
      } else if (encActive) {
        authSub.textContent = `AES-256-GCM active · ${activeUsers} team login${activeUsers === 1 ? '' : 's'} configured.`;
      } else {
        authSub.textContent = 'Set an Administrator password to encrypt files and add team user logins.';
      }
    }
    if (encBtn) {
      encBtn.classList.toggle('hidden', isStd);
      encBtn.textContent = encActive ? 'Admin Key' : 'Enable Encryption';
    }
    if (teamBtn) {
      teamBtn.classList.toggle('hidden', isStd);
      teamBtn.textContent = activeUsers > 0 ? `Team Users (${activeUsers})` : 'Team Users';
    }

    // Tile 3: Separate Finance Vault
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
      finTitle.innerHTML = `<span id="syncHeroFinDot" class="pp-status-dot ${dotCls}" aria-hidden="true"></span><span class="truncate">${esc(st.unlocked ? st.fileName : 'Separate Finance Vault')}</span>`;
      if (finBadge) {
        finBadge.textContent = st.unlocked ? 'Unlocked' : (st.splitMode ? 'Split · Locked' : 'Ready');
        finBadge.className = st.unlocked
          ? 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase whitespace-nowrap'
          : 'px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 uppercase whitespace-nowrap';
      }
      finSub.textContent = st.unlocked
        ? 'Separate encrypted file auto-syncing with your unified session key.'
        : (st.hasSessionKey
            ? 'Kept in its own encrypted file using your session key — no separate finance password needed.'
            : 'Enable Administrator encryption first to create or open the separate Finance Vault.');
      if (finBtn) finBtn.textContent = st.unlocked ? 'Manage Vault' : 'Open Finance Vault';
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
      if (typeof ui !== 'undefined' && ui.activeTab === 'data') {
        renderAdminAccessCardInSetup();
      }
      if (typeof ui !== 'undefined' && ui.activeTab === 'sync') {
        ppRefreshSyncHubUI();
      }
      return res;
    };
  }

  if (typeof renderDataTab === 'function') {
    const prevRenderDataTab = renderDataTab;
    renderDataTab = function (...args) {
      const res = prevRenderDataTab.apply(this, args);
      renderAdminAccessCardInSetup();
      return res;
    };
  }

  const exportsMap = {
    ppGetAuthSession,
    ppIsStandardUser,
    ppHasAdminAccess,
    ppCanAccessTab,
    ppCanAccessFinance,
    ppGetFirstAllowedTab,
    ppApplyAuthenticatedSession,
    ppSyncAuthAfterDbLoad,
    ppOnSessionLocked,
    ppPromptEncryptedFileLogin,
    ppOpenSwitchLoginModal,
    ppCheckForcedPasswordChange,
    ppOpenChangeMyPasswordModal,
    ppOpenTeamAccessModal,
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
      adminResetUserPassword,
      changeCurrentUserPassword,
      authenticateInMemoryAccount,
      normalizeUserPermissions,
      generateTempPassword,
      nativeOpenUserSwitcherModal,
    };
  }
})();
