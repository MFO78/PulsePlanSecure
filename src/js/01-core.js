    /* ============================================================================
     * 1. STORAGE KEYS, COLOR CONTRAST HELPERS, MOD 4 CLASSIFIER & ISO UTILITIES
     * ============================================================================ */
    const STORAGE_KEYS = {
      LIVE_DB: 'pulseplan_live_db_v2',
      DEMO_DB: 'pulseplan_demo_db_v2',
      UI_PREFS: 'pulseplan_ui_prefs_v2',
      SAVED_VIEWS: 'pulseplan_saved_views_v1',
      SECURE_MODE: 'pulseplan_secure_mode_v1',
    };

    const IDB_NAME = 'pulseplan_handles_db';
    const IDB_STORE = 'file_handles';
    const HANDLE_KEY = 'shared_db_handle';

    const PALETTE = [
      '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b',
      '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'
    ];

    const DEFAULT_RETENTION = {
      maxChangeLog: 100,
      maxSnapshots: 10,
      maxDumpHistory: 15,
      autoPruneOnSave: true,
    };

    const DEFAULT_FTE3_SCHEME = {
      basis: 'capacityPct', // 'capacityPct' | 'absoluteFte'
      yellowPct: 25,
      redPct: 50,
      yellowFte: 1.0,
      redFte: 2.5,
    };

    const PULSEPLAN_BUILD_ID = '2026-11-23-v8.3';
    const _debugLogEntries = [];
    const MAX_DEBUG_LOG_ENTRIES = 120;

    function ppDebug(level, message, details = null) {
      const lvl = String(level || 'INFO').toUpperCase();
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
      let detailStr = '';
      if (details !== null && details !== undefined) {
        try {
          detailStr = typeof details === 'string' ? details : JSON.stringify(details);
        } catch (e) {
          detailStr = String(details);
        }
      }
      _debugLogEntries.push({ time, iso: now.toISOString(), level: lvl, message: String(message || ''), details: detailStr });
      if (_debugLogEntries.length > MAX_DEBUG_LOG_ENTRIES) {
        _debugLogEntries.splice(0, _debugLogEntries.length - MAX_DEBUG_LOG_ENTRIES);
      }
      try {
        const prefix = `[PulsePlan ${time}]`;
        if (lvl === 'ERROR') console.error(prefix, message, details ?? '');
        else if (lvl === 'WARN') console.warn(prefix, message, details ?? '');
        else console.info(prefix, message, details ?? '');
      } catch (e) {}
      try {
        if (typeof renderSyncDebugPanel === 'function' && typeof ui !== 'undefined' && ui && ui.activeTab === 'sync') {
          renderSyncDebugPanel();
        }
      } catch (e) {}
    }

    function withTimeout(promise, ms, timeoutMessage = 'Operation timed out') {
      let timerId = null;
      return Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timerId = setTimeout(() => {
            const err = new Error(timeoutMessage);
            err.name = 'TimeoutError';
            reject(err);
          }, ms);
        }),
      ]).finally(() => {
        if (timerId !== null) clearTimeout(timerId);
      });
    }

    function getDebugEnvironmentSummary() {
      let swControlled = false;
      try { swControlled = Boolean(typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller); } catch (e) {}
      let inIframe = false;
      try { inIframe = typeof window !== 'undefined' && window.self !== window.top; } catch (e) { inIframe = true; }
      return {
        build: PULSEPLAN_BUILD_ID,
        protocol: typeof location !== 'undefined' ? location.protocol : 'n/a',
        origin: typeof location !== 'undefined' ? location.origin : 'n/a',
        isSecureContext: typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
        inIframe,
        hasFsApi: typeof supportsFileSystemAccess === 'function' ? supportsFileSystemAccess() : false,
        hasIndexedDB: typeof indexedDB !== 'undefined',
        swControlled,
        linkedFile: typeof linkedFileHandle !== 'undefined' && linkedFileHandle ? linkedFileHandle.name : null,
        rememberedFile: typeof rememberedFileHandle !== 'undefined' && rememberedFileHandle ? rememberedFileHandle.name : null,
        activeTab: typeof ui !== 'undefined' && ui ? ui.activeTab : 'n/a',
        demoMode: typeof ui !== 'undefined' && ui ? Boolean(ui.demoMode) : false,
        whatIfMode: typeof ui !== 'undefined' && ui ? Boolean(ui.whatIfMode) : false,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
      };
    }

    function formatDebugReport() {
      const env = getDebugEnvironmentSummary();
      const lines = [
        `PulsePlan Diagnostics Report (${env.build})`,
        `Generated: ${new Date().toISOString()}`,
        `URL: ${env.origin} (${env.protocol}) | SecureContext: ${env.isSecureContext} | Iframe: ${env.inIframe}`,
        `FS Access API: ${env.hasFsApi} | IndexedDB: ${env.hasIndexedDB} | SW Controlled: ${env.swControlled}`,
        `State: tab=${env.activeTab}, demo=${env.demoMode}, whatIf=${env.whatIfMode}, linked=${env.linkedFile || 'none'}, remembered=${env.rememberedFile || 'none'}`,
        `UA: ${env.userAgent}`,
        '--- Event Log ---',
        ..._debugLogEntries.map(e => `[${e.time}] [${e.level}] ${e.message}${e.details ? ' | ' + e.details : ''}`),
      ];
      return lines.join('\n');
    }

    function clearDebugLog() {
      _debugLogEntries.length = 0;
      ppDebug('INFO', 'Debug log cleared by user');
      if (typeof renderSyncDebugPanel === 'function') renderSyncDebugPanel();
    }

    function confirmClearDebugLog() {
      if (_debugLogEntries.length === 0) return;
      if (typeof openConfirmModal === 'function') {
        openConfirmModal(
          'Clear Debug Log',
          `Clear all ${_debugLogEntries.length} diagnostic log entries from this session?`,
          'Clear Log',
          () => clearDebugLog()
        );
      } else {
        clearDebugLog();
      }
    }

    async function copyDebugReport() {
      const text = formatDebugReport();
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
          showToast('Diagnostics debug log copied to clipboard', 'success');
          return;
        }
      } catch (e) {}
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast('Diagnostics debug log copied to clipboard', 'success');
      } catch (e) {
        showToast('Could not copy automatically — open browser console (F12) for [PulsePlan] logs.', 'warning');
      }
    }

    function safeGetStorage(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function safeSetStorage(key, val) {
      try {
        localStorage.setItem(key, val);
      } catch (e) {
        ppDebug('WARN', 'localStorage.setItem failed', { key, bytes: String(val || '').length, name: e?.name, message: e?.message });
      }
    }

    function uid(prefix = 'id') {
      return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatBytes(bytes) {
      const b = Math.max(0, Number(bytes) || 0);
      if (b < 1024) return `${b} B`;
      if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
      return `${(b / (1024 * 1024)).toFixed(2)} MB`;
    }

    function getUserInitials(name) {
      const cleaned = String(name || 'PM').trim();
      if (!cleaned) return 'PM';
      const parts = cleaned.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return cleaned.slice(0, 2).toUpperCase();
    }

    /**
     * Progressive subtle haptic pulse on supported mobile touch devices.
     */
    function triggerHaptic(ms = 10) {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(ms);
        }
      } catch (e) {}
    }

    /**
     * Feature-detects native <input type="week"> support (Safari falls back to text).
     */
    let _nativeWeekSupport = null;
    function supportsNativeWeekInput() {
      if (_nativeWeekSupport !== null) return _nativeWeekSupport;
      try {
        const inp = document.createElement('input');
        inp.setAttribute('type', 'week');
        inp.value = '2026-W01';
        _nativeWeekSupport = inp.type === 'week' && inp.value === '2026-W01';
      } catch (e) {
        _nativeWeekSupport = false;
      }
      return _nativeWeekSupport;
    }

    /**
     * Universal export helper:
     * - mode 'disk': Save directly to a user-chosen disk path via showSaveFilePicker (or pre-acquired fileHandle), with <a download> fallback
     * - mode 'download': Direct browser download to disk (never opens OS Share sheet)
     * - mode 'share': Web Share API when supported, with <a download> fallback
     * - mode 'auto' (default): Web Share ONLY on narrow touch-first phones; desktop (incl. Windows touch laptops) always downloads to disk
     */
    async function shareOrDownloadFile(blob, filename, mimeType, title = 'PulsePlan Export', opts = {}) {
      const mode = opts && opts.mode ? String(opts.mode) : 'auto';
      const resolvedMime = mimeType || blob?.type || 'application/octet-stream';

      if (mode === 'disk') {
        const preHandle = opts && opts.fileHandle ? opts.fileHandle : null;
        let handle = preHandle;
        if (!handle && typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function' && (typeof location === 'undefined' || location.protocol !== 'file:')) {
          const extMatch = String(filename || '').match(/(\.[a-z0-9]+)$/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : '';
          const pickerOpts = { suggestedName: filename };
          if (ext && resolvedMime) {
            pickerOpts.types = [{ description: title || 'PulsePlan File', accept: { [resolvedMime.split(';')[0]]: [ext] } }];
          }
          try {
            handle = await window.showSaveFilePicker(pickerOpts);
          } catch (err) {
            if (err && err.name === 'AbortError') return 'cancelled';
            handle = null; // Fall back cleanly to direct browser download
          }
        }
        if (handle && typeof handle.createWritable === 'function') {
          try {
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return 'saved';
          } catch (err) {
            if (err && err.name === 'AbortError') return 'cancelled';
            // Fall through to direct download on unexpected disk write error
          }
        }
      }

      const isNarrowViewport = Boolean(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
      const isFinePointer = Boolean(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
      const isTouchPhone = isNarrowViewport && !isFinePointer;
      const shouldShare = mode === 'share' || (mode === 'auto' && isTouchPhone);

      if (shouldShare && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof File === 'function') {
        try {
          const file = new File([blob], filename, { type: resolvedMime });
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            await navigator.share({ title, files: [file] });
            return 'shared';
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return 'cancelled';
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return 'downloaded';
    }

    /**
     * Computes high-contrast text, border, chip, and nested comment styles
     * for color-filled project/department/FTE cards (WCAG AA compliant).
     */
    function getFilledCardTheme(hexColor) {
      let hex = String(hexColor || '#4f46e5').trim();
      if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
        hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        hex = '#4f46e5';
      }
      let r = parseInt(hex.slice(1, 3), 16);
      let g = parseInt(hex.slice(3, 5), 16);
      let b = parseInt(hex.slice(5, 7), 16);
      if (typeof ui !== 'undefined' && ui && ui.darkMode) {
        r = Math.round(r * 0.82 + 15 * 0.18);
        g = Math.round(g * 0.82 + 23 * 0.18);
        b = Math.round(b * 0.82 + 42 * 0.18);
        hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
      }
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const isLight = luminance > 0.62;
      return {
        bg: hex,
        text: isLight ? '#0f172a' : '#ffffff',
        mutedText: isLight ? 'rgba(15, 23, 42, 0.78)' : 'rgba(255, 255, 255, 0.88)',
        border: isLight ? 'rgba(15, 23, 42, 0.24)' : 'rgba(255, 255, 255, 0.26)',
        chipBg: isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.22)',
        commentBg: isLight ? 'rgba(255, 255, 255, 0.62)' : 'rgba(15, 23, 42, 0.26)',
        commentBorder: isLight ? 'rgba(15, 23, 42, 0.16)' : 'rgba(255, 255, 255, 0.22)',
        commentText: isLight ? '#0f172a' : 'rgba(255, 255, 255, 0.96)',
      };
    }

    /**
     * 6-Tier FTE Heat-Scale color based on % share of department available capacity.
     */
    function getFteCardColor(fte, capacityFte) {
      const val = Number(fte) || 0;
      if (val <= 0.0001) return '#64748b'; // Note-only / 0% (Slate)
      const cap = Number(capacityFte) || 0;
      if (cap <= 0.0001) return '#e11d48'; // >100% (Rose)
      const pct = (val / cap) * 100;
      if (pct <= 20) return '#0284c7';     // <= 20% (Sky)
      if (pct <= 40) return '#059669';     // 20-40% (Emerald)
      if (pct <= 65) return '#4f46e5';     // 40-65% (Indigo)
      if (pct <= 100) return '#d97706';    // 65-100% (Amber)
      return '#e11d48';                    // > 100% (Rose)
    }

    /* ---------- Mod 4: 3-Level FTE Demand Classifier (Green / Yellow / Red) ---------- */

    function getFte3Settings(db = getActiveDB()) {
      const raw = (db && db.settings && db.settings.fte3Scheme) || {};
      const basis = raw.basis === 'absoluteFte' ? 'absoluteFte' : 'capacityPct';
      const yellowPct = Math.max(5, Math.min(95, Number(raw.yellowPct ?? DEFAULT_FTE3_SCHEME.yellowPct) || 25));
      const redPct = Math.max(yellowPct + 5, Math.min(150, Number(raw.redPct ?? DEFAULT_FTE3_SCHEME.redPct) || 50));
      const yellowFte = Math.max(0.25, Math.min(50, Number(raw.yellowFte ?? DEFAULT_FTE3_SCHEME.yellowFte) || 1.0));
      const redFte = Math.max(yellowFte + 0.25, Math.min(100, Number(raw.redFte ?? DEFAULT_FTE3_SCHEME.redFte) || 2.5));
      return { basis, yellowPct, redPct, yellowFte, redFte };
    }

    /**
     * Classifies an allocation into 3 unmistakable WCAG AA demand tiers:
     * Green (#15803d + white), Yellow (#facc15 + slate-900), Red (#dc2626 + white)
     * plus non-colour glyphs for WCAG 1.4.1 accessibility.
     */
    function getFte3DemandTier(fte, capacityFte, db = getActiveDB()) {
      const val = Number(fte) || 0;
      if (val <= 0.0001) {
        return {
          tier: 'note',
          color: '#64748b',
          symbol: '✎',
          shortLabel: 'Note',
          ariaLabel: 'Note only (0 FTE)',
        };
      }
      const cfg = getFte3Settings(db);
      if (cfg.basis === 'absoluteFte') {
        if (val >= cfg.redFte) {
          return { tier: 'high', color: '#dc2626', symbol: '‼', shortLabel: 'High', ariaLabel: 'High demand (Red)' };
        }
        if (val >= cfg.yellowFte) {
          return { tier: 'med', color: '#facc15', symbol: '▲', shortLabel: 'Med', ariaLabel: 'Moderate demand (Yellow)' };
        }
        return { tier: 'low', color: '#15803d', symbol: '●', shortLabel: 'Low', ariaLabel: 'Low demand (Green)' };
      }
      const cap = Number(capacityFte) || 0;
      const pct = cap <= 0.0001 ? 999 : (val / cap) * 100;
      if (pct >= cfg.redPct) {
        return { tier: 'high', color: '#dc2626', symbol: '‼', shortLabel: 'High', ariaLabel: 'High demand (Red)' };
      }
      if (pct >= cfg.yellowPct) {
        return { tier: 'med', color: '#facc15', symbol: '▲', shortLabel: 'Med', ariaLabel: 'Moderate demand (Yellow)' };
      }
      return { tier: 'low', color: '#15803d', symbol: '●', shortLabel: 'Low', ariaLabel: 'Low demand (Green)' };
    }

    function renderFte3Legend(db = getActiveDB()) {
      const el = document.getElementById('fte3LegendLabels');
      if (!el) return;
      const cfg = getFte3Settings(db);
      if (cfg.basis === 'absoluteFte') {
        el.innerHTML = `
          <span class="text-[10px] text-slate-400 uppercase tracking-wider font-bold">3-Level (FTE):</span>
          <span class="inline-flex items-center gap-1"><span class="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-white" style="background:#15803d" aria-hidden="true">&#9679;</span>&lt; ${cfg.yellowFte}</span>
          <span class="inline-flex items-center gap-1"><span class="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-slate-900" style="background:#facc15" aria-hidden="true">&#9650;</span>${cfg.yellowFte}–&lt;${cfg.redFte}</span>
          <span class="inline-flex items-center gap-1"><span class="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-white" style="background:#dc2626" aria-hidden="true">&#8252;</span>&ge; ${cfg.redFte} FTE</span>`;
      } else {
        el.innerHTML = `
          <span class="text-[10px] text-slate-400 uppercase tracking-wider font-bold">3-Level (% Cap):</span>
          <span class="inline-flex items-center gap-1"><span class="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-white" style="background:#15803d" aria-hidden="true">&#9679;</span>&lt; ${cfg.yellowPct}%</span>
          <span class="inline-flex items-center gap-1"><span class="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-slate-900" style="background:#facc15" aria-hidden="true">&#9650;</span>${cfg.yellowPct}–${cfg.redPct - 1}%</span>
          <span class="inline-flex items-center gap-1"><span class="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold text-white" style="background:#dc2626" aria-hidden="true">&#8252;</span>&ge; ${cfg.redPct}%</span>`;
      }
    }

    /**
     * Sorted copies of departments & projects for dropdown menus
     * (never mutates custom display order in db.departments / db.projects).
     */
    function getSortedDepartments(db = getActiveDB()) {
      return [...(db.departments || [])].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true })
      );
    }

    function getSortedProjects(db = getActiveDB()) {
      return [...(db.projects || [])].sort((a, b) => {
        const aAdmin = isNonFteProject(a);
        const bAdmin = isNonFteProject(b);
        if (aAdmin !== bAdmin) return aAdmin ? 1 : -1;
        const codeA = String(a.code || '').trim();
        const codeB = String(b.code || '').trim();
        if (codeA && codeB) {
          const cmp = codeA.localeCompare(codeB, undefined, { sensitivity: 'base', numeric: true });
          if (cmp !== 0) return cmp;
        } else if (codeA && !codeB) {
          return -1;
        } else if (!codeA && codeB) {
          return 1;
        }
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
      });
    }

    function isNonFteProject(p) {
      return Boolean(p && (p.nonFte || p.category === 'admin'));
    }

    function formatProjectOptionLabel(p) {
      const code = String(p?.code || '').trim();
      const name = String(p?.name || '').trim();
      const base = code ? `[${code}] ${name}` : name;
      if (isNonFteProject(p)) return `${base} (Admin · Non-FTE)`;
      if (p?.tentative) return `${base} (Pipeline)`;
      return base;
    }

    function getManpowerStep(unit = ui.manpowerUnit) {
      if (unit === 'days') return { step: 1, decimals: 1 };
      if (unit === 'hours') return { step: 4, decimals: 1 };
      return { step: 0.25, decimals: 2 };
    }

    function stepNumericInput(inputId, delta, min = 0, max = 999999, decimals = 2, onAfterChange = null) {
      const el = document.getElementById(inputId);
      if (!el) return;
      const cur = parseFloat(el.value);
      const base = isNaN(cur) ? 0 : cur;
      const factor = Math.pow(10, decimals);
      const next = Math.max(min, Math.min(max, Math.round((base + delta) * factor) / factor));
      el.value = String(next);
      triggerHaptic(8);
      if (typeof onAfterChange === 'function') onAfterChange(next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function stepDateInput(inputId, deltaDays) {
      const el = document.getElementById(inputId);
      if (!el) return;
      const base = el.value && /^\d{4}-\d{2}-\d{2}$/.test(el.value)
        ? parseISODate(el.value)
        : new Date();
      base.setUTCDate(base.getUTCDate() + deltaDays);
      el.value = dateToISODate(base);
      triggerHaptic(8);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /* ---------- ISO Week & Month Helpers (Weekly Source of Truth) ---------- */

    function pad2(n) { return String(n).padStart(2, '0'); }

    function dateToISODate(d) {
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    }

    function parseISODate(isoStr) {
      const [y, m, d] = isoStr.split('-').map(Number);
      return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    }

    function dateToISOWeekKey(dateObj) {
      const d = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
    }

    function isoWeekKeyToMonday(weekKey) {
      const [yStr, wStr] = weekKey.split('-W');
      const year = parseInt(yStr, 10);
      const week = parseInt(wStr, 10);
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const jan4Day = jan4.getUTCDay() || 7;
      const week1Mon = new Date(jan4);
      week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
      const target = new Date(week1Mon);
      target.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
      return target;
    }

    function isoWeekKeyToThursday(weekKey) {
      const mon = isoWeekKeyToMonday(weekKey);
      const thu = new Date(mon);
      thu.setUTCDate(mon.getUTCDate() + 3);
      return thu;
    }

    function addWeeksToWeekKey(weekKey, delta) {
      const mon = isoWeekKeyToMonday(weekKey);
      mon.setUTCDate(mon.getUTCDate() + delta * 7);
      return dateToISOWeekKey(mon);
    }

    function addMonthsToMonthKey(monthKey, delta) {
      const [y, m] = monthKey.split('-').map(Number);
      const d = new Date(Date.UTC(y, (m - 1) + delta, 1));
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    }

    function getCurrentMonthKey() {
      const now = new Date();
      return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    }

    function getCurrentWeekKey() {
      const now = new Date();
      return dateToISOWeekKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
    }

    const _monthWeeksCache = {};
    function getWeeksInMonth(monthKey) {
      if (_monthWeeksCache[monthKey]) return _monthWeeksCache[monthKey];
      const [y, m] = monthKey.split('-').map(Number);
      const firstDay = new Date(Date.UTC(y, m - 1, 1));
      const lastDay = new Date(Date.UTC(y, m, 0));
      const weeks = [];
      const seen = new Set();

      const cursor = new Date(firstDay);
      cursor.setUTCDate(cursor.getUTCDate() - 7);
      const end = new Date(lastDay);
      end.setUTCDate(end.getUTCDate() + 7);

      while (cursor <= end) {
        const wk = dateToISOWeekKey(cursor);
        if (!seen.has(wk)) {
          seen.add(wk);
          const thu = isoWeekKeyToThursday(wk);
          const thuMonth = `${thu.getUTCFullYear()}-${pad2(thu.getUTCMonth() + 1)}`;
          if (thuMonth === monthKey) weeks.push(wk);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      _monthWeeksCache[monthKey] = weeks;
      return weeks;
    }

    function getWeekOwningMonth(weekKey) {
      const thu = isoWeekKeyToThursday(weekKey);
      return `${thu.getUTCFullYear()}-${pad2(thu.getUTCMonth() + 1)}`;
    }

    const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function formatPeriodHeader(periodKey, timeUnit) {
      const monthNames = MONTH_NAMES_SHORT;
      if (timeUnit === 'month') {
        const [y, m] = periodKey.split('-').map(Number);
        const wks = getWeeksInMonth(periodKey);
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        return {
          title: `${monthNames[m - 1]} ${y}`,
          shortTitle: `${monthNames[m - 1]} '${String(y).slice(2)}`,
          sub: `${wks.length} wks`,
          dateRange: `1–${lastDay} ${monthNames[m - 1]} • ${wks.length} wks`
        };
      } else {
        const mon = isoWeekKeyToMonday(periodKey);
        const sun = new Date(mon);
        sun.setUTCDate(mon.getUTCDate() + 6);
        const wkNum = periodKey.split('-')[1];
        const m1 = monthNames[mon.getUTCMonth()];
        const m2 = monthNames[sun.getUTCMonth()];
        const y1 = mon.getUTCFullYear();
        const y2 = sun.getUTCFullYear();
        let dateRange;
        if (y1 !== y2) {
          dateRange = `${mon.getUTCDate()} ${m1} '${String(y1).slice(2)} – ${sun.getUTCDate()} ${m2} '${String(y2).slice(2)}`;
        } else if (m1 !== m2) {
          dateRange = `${mon.getUTCDate()} ${m1} – ${sun.getUTCDate()} ${m2}`;
        } else {
          dateRange = `${mon.getUTCDate()}–${sun.getUTCDate()} ${m1}`;
        }
        return {
          title: `${wkNum} '${String(y1).slice(2)}`,
          shortTitle: `${wkNum} '${String(y1).slice(2)}`,
          sub: `${mon.getUTCDate()} ${m1}`,
          dateRange
        };
      }
    }

    function getPeriodMidDateISO(periodKey, timeUnit) {
      if (timeUnit === 'month') return `${periodKey}-15`;
      return dateToISODate(isoWeekKeyToThursday(periodKey));
    }

    function addDaysToISODate(isoDate, deltaDays) {
      if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
      const d = parseISODate(isoDate);
      d.setUTCDate(d.getUTCDate() + (parseInt(deltaDays, 10) || 0));
      return dateToISODate(d);
    }

    /**
     * Builds universal period dropdown options (works in Safari, iOS, Firefox & Chrome).
     */
    function buildPeriodSelectOptions(anchorKey, timeUnit, backCount = 12, fwdCount = 24) {
      const options = [];
      for (let i = -backCount; i <= fwdCount; i++) {
        const pk = timeUnit === 'month'
          ? addMonthsToMonthKey(anchorKey, i)
          : addWeeksToWeekKey(anchorKey, i);
        const h = formatPeriodHeader(pk, timeUnit);
        options.push({ key: pk, label: `${h.title} (${h.dateRange || h.sub})` });
      }
      return options;
    }

