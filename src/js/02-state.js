    /* ============================================================================
     * 2. APPLICATION STATE, DATABASE FACTORIES & MOD 3 ROLLING RETENTION ENGINE
     * ============================================================================ */
    let ui = {
      activeTab: 'matrix',
      dataSubTab: 'departments',
      demoMode: false,
      whatIfMode: false,
      darkMode: false,
      presentMode: false,
      compactRowLabels: true,         // true = vertical 62px spine | false = detailed 216px column
      noteSize: 'md',                 // 'sm' (Normal) | 'md' (Large default) | 'lg' (XL)
      matrixSettingsOpen: false,
      showArchivedProjects: false,
      showCellComments: true,
      cellColorMode: 'fill',          // 'accent' | 'fill' | 'fte' | 'fte3'
      axis: 'department',             // 'department' | 'project' | 'timeline'
      timeUnit: 'month',              // 'month' | 'week'
      manpowerUnit: 'fte',            // 'fte' | 'days' | 'hours'
      horizon: 4,
      startMonth: getCurrentMonthKey(),
      startWeek: getCurrentWeekKey(),
      filterDept: 'all',
      filterProj: 'all',
      hideEmptyRows: false,
      includeTentative: true,         // true = include Pipeline / Tentative projects in totals & grid
      spotlightProjId: '',
      matrixSearch: '',
      filterOverOnly: false,
      filterAtRiskOnly: false,
      filterHasNotesOnly: false,
      overrideDeptFilter: 'all',      // Setup tab Variable Overrides filter
      // Mobile Hybrid State (Pattern 1 + Pattern 2)
      mobileLayoutMode: 'cards',      // 'cards' (Period-Focus Deck) | 'grid' (2D Table)
      mobileSelectedPeriod: '',       // Currently focused periodKey in mobile card deck
      mobileCollapsedIds: [],         // Track collapsed accordion row IDs so edits preserve state
      selectedChartPeriodIdx: -1,     // Tapped bar index in Health SVG chart
      // Mod 2 Snapshot Comparison UI state
      compareSnapshotId: '',
      compareTargetId: '__CURRENT__',
      compareChangedOnly: true,
      compareSubTab: 'deptPeriod',    // 'deptPeriod' | 'project' | 'cells' | 'milestones' | 'capacity'
      // Mod 1 PDF Report options (with Colorful Vector Matrix & Columns/Page)
      pdfOptions: {
        title: 'PulsePlan - Company Roadmap & Utilisation Report',
        colorMode: 'match',
        periodCount: 'match',
        colsPerPage: 6,
        includeChart: true,
        includeMatrix: true,
        includeDeptHealth: true,
        includeProjectPortfolio: true,
        includeMilestones: true,
        includeCommentsAppendix: true,
        includeSnapshotDiff: true,
        includeChangeLog: true,
        changeLogLimit: 15,
      },
      dragMode: 'move',
      userName: 'Project Mgr',
      recentUsers: [],
      removedUsers: [],
      autoSaveToFile: true,
      autoReloadFromFile: true,
      pollIntervalMs: 15000,
      linkedFilePaths: {},            // Per-device saved folder/full paths keyed by filename (browser hides local disk paths for security)
      welcomeSeen: false,             // First-use welcome/setup splash screen flag
      expandedOverrideGroups: [],     // In-memory expanded company-wide override group IDs in Setup & Data
    };

    const VALID_HORIZONS = [1, 2, 3, 4, 6, 12, 18, 24];

    let liveDB = null;
    let demoDB = null;
    let whatIfDB = null;
    let activeDragPayload = null;
    let lastFocusedBeforeModal = null;
    let deferredPwaPrompt = null;

    // Shared File Sync runtime state
    const SESSION_CLIENT_ID = `cli_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let linkedFileHandle = null;
    let linkedFileDetectedPath = '';
    let rememberedFileHandle = null;
    let lastKnownFileModified = 0;
    let lastWrittenId = '';
    let lastSyncedSnapshot = null; // Clean clone of last disk-synced DB for 3-way buffered auto-merge
    let saveQueued = false;        // Serialized write-buffer flag when edits arrive while a save is in flight
    let pollTimerId = null;
    let saveDebounceTimer = null;
    let isSavingToFile = false;
    let isReloadingFromFile = false;
    let pendingAutoReload = false;
    let syncWarningState = { type: null, fileName: '', dismissed: false };

    function getActiveHorizon() {
      const n = Math.max(1, Math.min(24, parseInt(ui.horizon, 10) || 4));
      if (VALID_HORIZONS.includes(n)) return n;
      if (n <= 6) return n === 5 ? 6 : n;
      if (n <= 15) return 12;
      if (n <= 21) return 18;
      return 24;
    }

    function isOverviewHorizon(count = getActiveHorizon()) {
      return Number(count) > 6;
    }

    function getActiveCellColorMode() {
      const mode = ui.cellColorMode;
      return (mode === 'fill' || mode === 'fte' || mode === 'fte3') ? mode : 'accent';
    }

    function isMobileViewport() {
      return typeof window !== 'undefined' && window.innerWidth < 768;
    }

    function shouldRenderMobileCards() {
      return isMobileViewport() && ui.mobileLayoutMode !== 'grid';
    }

    function getMobileSelectedPeriod() {
      const periods = getVisiblePeriods();
      if (periods.length === 0) return ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;
      if (ui.mobileSelectedPeriod && periods.includes(ui.mobileSelectedPeriod)) {
        return ui.mobileSelectedPeriod;
      }
      const curKey = ui.timeUnit === 'month' ? getCurrentMonthKey() : getCurrentWeekKey();
      const chosen = periods.includes(curKey) ? curKey : periods[0];
      ui.mobileSelectedPeriod = chosen;
      return chosen;
    }

    function createEmptyDB() {
      return {
        meta: {
          version: 3,
          revision: 1,
          lastModifiedAt: new Date().toISOString(),
          lastModifiedBy: ui.userName || 'Project Mgr',
          lastWriteId: '',
          lastClientId: '',
        },
        settings: {
          daysPerWeek: 5,
          hoursPerDay: 8,
          warnThreshold: 85,
          overThreshold: 100,
          currency: '€',
          retention: { ...DEFAULT_RETENTION },
          fte3Scheme: { ...DEFAULT_FTE3_SCHEME },
        },
        departments: [],
        projects: [],
        allocations: {},       // `${deptId}::${projId}::${weekKey}` => fte
        capacityOverrides: {}, // `${deptId}::${weekKey}` => fte
        comments: {},          // `${deptId}::${projId}::${periodKey}` => string
        milestones: [],
        snapshots: [],         // [{ id, name, notes, createdAt, createdBy, pinned, data }]
        changeLog: [],
        dumpHistory: [],       // [{ id, timestamp, user, format, filename, revision, sizeBytes, summary }]
        peopleDirectory: [],   // [{ id, name, role }]
        accessControl: {       // Multi-user RBAC & wrapped-key login metadata
          version: 1,
          adminName: 'Administrator',
          users: [],
        },
      };
    }

    function createSampleDemoDB() {
      const db = createEmptyDB();
      const baseMonth = getCurrentMonthKey();
      const m0 = baseMonth;
      const m1 = addMonthsToMonthKey(baseMonth, 1);
      const m2 = addMonthsToMonthKey(baseMonth, 2);
      const m3 = addMonthsToMonthKey(baseMonth, 3);
      const m4 = addMonthsToMonthKey(baseMonth, 4);
      const m5 = addMonthsToMonthKey(baseMonth, 5);

      db.departments = [
        { id: 'd_eng', name: 'Engineering', code: 'ENG', color: '#4f46e5', defaultCapacity: 8.0, manager: 'Elena Rostova', dayRate: 650 },
        { id: 'd_des', name: 'Product Design', code: 'DES', color: '#ec4899', defaultCapacity: 3.0, manager: 'Marco Bellini', dayRate: 580 },
        { id: 'd_dat', name: 'Data & AI', code: 'DAT', color: '#0ea5e9', defaultCapacity: 4.0, manager: 'Priya Nair', dayRate: 700 },
        { id: 'd_ops', name: 'Operations & QA', code: 'OPS', color: '#10b981', defaultCapacity: 3.5, manager: 'Liam Vance', dayRate: 520 },
      ];

      db.projects = getSortedProjects({
        projects: [
          { id: 'p_nova', name: 'Project Nova (Core Platform)', code: 'NVA', color: '#4f46e5', status: 'Active', priority: 'High', owner: 'S. Chen', techLead: 'E. Rostova', budgetDays: 700, budgetCost: 450000, tentative: false, archived: false },
          { id: 'p_atlas', name: 'Atlas Mobile v3', code: 'ATL', color: '#0ea5e9', status: 'Active', priority: 'High', owner: 'M. Rossi', techLead: 'A. Novak', budgetDays: 450, budgetCost: 275000, tentative: false, archived: false },
          { id: 'p_pulse', name: 'AI Copilot Analytics', code: 'AIC', color: '#8b5cf6', status: 'Active', priority: 'Medium', owner: 'P. Nair', techLead: 'D. Park', budgetDays: 280, budgetCost: 200000, tentative: false, archived: false },
          { id: 'p_cloud', name: 'Cloud EU Migration', code: 'CLD', color: '#10b981', status: 'At Risk', priority: 'Critical', owner: 'E. Rostova', techLead: 'L. Vance', budgetDays: 360, budgetCost: 210000, tentative: false, archived: false },
          { id: 'p_brand', name: 'Enterprise Portal Refresh', code: 'EPR', color: '#f59e0b', status: 'Planned', priority: 'Low', owner: 'M. Bellini', techLead: '', budgetDays: 120, budgetCost: 75000, tentative: true, archived: false },
        ],
      });

      const setMonthAlloc = (deptId, projId, monthKey, fte) => {
        getWeeksInMonth(monthKey).forEach(wk => {
          db.allocations[`${deptId}::${projId}::${wk}`] = fte;
        });
      };
      const setMonthCap = (deptId, monthKey, fte) => {
        getWeeksInMonth(monthKey).forEach(wk => {
          db.capacityOverrides[`${deptId}::${wk}`] = fte;
        });
      };

      setMonthCap('d_eng', m3, 9.5);
      setMonthCap('d_eng', m4, 9.5);
      setMonthCap('d_eng', m5, 10.0);
      setMonthCap('d_des', m2, 2.0);

      [m0, m1, m2, m3].forEach(m => setMonthAlloc('d_eng', 'p_nova', m, 3.5));
      [m4, m5].forEach(m => setMonthAlloc('d_eng', 'p_nova', m, 2.0));
      [m0, m1, m2].forEach(m => setMonthAlloc('d_eng', 'p_atlas', m, 2.5));
      [m3, m4].forEach(m => setMonthAlloc('d_eng', 'p_atlas', m, 2.0));
      [m1, m2, m3].forEach(m => setMonthAlloc('d_eng', 'p_cloud', m, 3.0));
      [m4, m5].forEach(m => setMonthAlloc('d_eng', 'p_cloud', m, 1.5));

      [m0, m1].forEach(m => setMonthAlloc('d_des', 'p_atlas', m, 1.5));
      [m0, m1, m2].forEach(m => setMonthAlloc('d_des', 'p_nova', m, 1.0));
      [m2, m3, m4].forEach(m => setMonthAlloc('d_des', 'p_brand', m, 1.5));

      [m0, m1, m2, m3, m4].forEach(m => setMonthAlloc('d_dat', 'p_pulse', m, 2.5));
      [m1, m2, m3].forEach(m => setMonthAlloc('d_dat', 'p_nova', m, 1.2));

      [m0, m1, m2, m3].forEach(m => setMonthAlloc('d_ops', 'p_cloud', m, 2.0));
      [m2, m3, m4, m5].forEach(m => setMonthAlloc('d_ops', 'p_atlas', m, 1.0));
      [m0, m1, m4, m5].forEach(m => setMonthAlloc('d_ops', 'p_nova', m, 1.0));

      const m0Weeks = getWeeksInMonth(m0);
      const m1Weeks = getWeeksInMonth(m1);
      db.comments[`d_eng::p_nova::${m0}`] = 'API v2 auth migration complete.\nFocusing on load-testing before Beta cut.';
      db.comments[`d_eng::p_cloud::${m1}`] = 'Overallocated by +1.0 FTE — reviewing contractor buffer with Ops.';
      db.comments[`d_ops::p_cloud::${m1}`] = 'Awaiting EU legal sign-off on Frankfurt cluster failover.';
      if (m0Weeks[0]) {
        db.comments[`d_des::p_atlas::${m0Weeks[0]}`] = 'Finalize iOS navigation prototypes.\nDesign review scheduled Thu 14:00.';
      }
      if (m1Weeks[0]) {
        db.comments[`d_dat::p_pulse::${m1Weeks[0]}`] = 'Benchmarking prompt latency across top 5 enterprise datasets.';
      }

      db.milestones = [
        { id: 'ms_1', title: 'Nova Beta Cut', projectId: 'p_nova', deptId: 'd_eng', baselineDate: `${m1}-18`, date: `${m1}-18`, status: 'In Progress', notes: 'Core API freeze' },
        { id: 'ms_2', title: 'EU Data Center Cutover', projectId: 'p_cloud', deptId: 'd_ops', baselineDate: `${m2}-10`, date: `${m2}-24`, status: 'At Risk', notes: 'Delayed +14d pending compliance sign-off' },
        { id: 'ms_3', title: 'Atlas App Store Launch', projectId: 'p_atlas', deptId: 'd_des', baselineDate: `${m3}-12`, date: `${m3}-12`, status: 'Pending', notes: 'iOS + Android release' },
        { id: 'ms_4', title: 'Copilot GA Release', projectId: 'p_pulse', deptId: 'd_dat', baselineDate: `${m4}-05`, date: `${m4}-15`, status: 'Pending', notes: 'Model evaluation buffer' },
      ];

      const snap1Alloc = JSON.parse(JSON.stringify(db.allocations));
      getWeeksInMonth(m2).forEach(wk => { snap1Alloc[`d_eng::p_cloud::${wk}`] = 1.5; });
      getWeeksInMonth(m1).forEach(wk => { snap1Alloc[`d_eng::p_cloud::${wk}`] = 2.0; });
      const snap1Cap = JSON.parse(JSON.stringify(db.capacityOverrides));
      getWeeksInMonth(m3).forEach(wk => { delete snap1Cap[`d_eng::${wk}`]; });
      const snap1Ms = db.milestones.map(ms => ({ ...ms, date: ms.baselineDate, status: 'Pending' }));
      snap1Ms.push({ id: 'ms_legacy', title: 'Legacy DC Decommission', projectId: 'p_cloud', deptId: 'd_ops', baselineDate: `${m2}-02`, date: `${m2}-02`, status: 'Pending', notes: 'Descope candidate' });

      db.snapshots = [
        {
          id: 'snap_mid_review',
          name: 'Mid-Month Steering Review',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
          createdBy: 'Project Mgr',
          pinned: false,
          notes: 'Added +1.5 FTE hiring ramp to Engineering from Month 4.',
          data: {
            allocations: JSON.parse(JSON.stringify(db.allocations)),
            capacityOverrides: JSON.parse(JSON.stringify(db.capacityOverrides)),
            comments: JSON.parse(JSON.stringify(db.comments)),
            milestones: JSON.parse(JSON.stringify(db.milestones)),
          }
        },
        {
          id: 'snap_q_plan',
          name: 'Original Quarterly Baseline',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 28).toISOString(),
          createdBy: 'Elena Rostova',
          pinned: true,
          notes: 'Approved executive plan before EU Cloud scope expansion.',
          data: {
            allocations: snap1Alloc,
            capacityOverrides: snap1Cap,
            comments: {},
            milestones: snap1Ms,
          }
        }
      ];

      db.changeLog = [
        { id: uid('log'), timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), user: 'Project Mgr', type: 'Allocation', summary: 'Engineering -> [CLD] Cloud EU Migration updated to 3.0 FTE in ' + m2 },
        { id: uid('log'), timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), user: 'Project Mgr', type: 'Milestone', summary: 'EU Data Center Cutover moved from ' + m2 + '-10 to ' + m2 + '-24 (+14d)' },
        { id: uid('log'), timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), user: 'Elena Rostova', type: 'Capacity', summary: 'Engineering capacity increased to 9.5 FTE starting ' + m3 },
      ];

      db.dumpHistory = [
        {
          id: uid('dump'),
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
          user: 'Elena Rostova',
          format: 'JSON',
          filename: `pulseplan_demo_${new Date().toISOString().slice(0, 10)}.json`,
          revision: 1,
          sizeBytes: 14820,
          summary: '4 depts, 5 projects, 2 snapshots',
        }
      ];

      return db;
    }

    /* ---------- Backward-Compatible JSON Schema Normalizer & Migrator ---------- */

    function normalizeWeekKeyFormat(rawPeriod) {
      if (!rawPeriod) return null;
      const s = String(rawPeriod).trim();
      const wkMatch = s.match(/^(\d{4})-?[Ww](\d{1,2})$/);
      if (wkMatch) return { kind: 'week', key: `${wkMatch[1]}-W${pad2(parseInt(wkMatch[2], 10))}` };
      const moMatch = s.match(/^(\d{4})-(\d{1,2})$/);
      if (moMatch) return { kind: 'month', key: `${moMatch[1]}-${pad2(parseInt(moMatch[2], 10))}` };
      const dtMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (dtMatch) {
        const iso = `${dtMatch[1]}-${pad2(parseInt(dtMatch[2], 10))}-${pad2(parseInt(dtMatch[3], 10))}`;
        return { kind: 'week', key: dateToISOWeekKey(parseISODate(iso)) };
      }
      return null;
    }

    function extractNumericFte(val, periodInfo, settings) {
      if (typeof val === 'number') return isFinite(val) ? val : 0;
      if (typeof val === 'string') {
        const n = parseFloat(val);
        return isFinite(n) ? n : 0;
      }
      if (val && typeof val === 'object') {
        if (val.fte !== undefined) return parseFloat(val.fte) || 0;
        if (val.value !== undefined) return parseFloat(val.value) || 0;
        if (val.amount !== undefined) return parseFloat(val.amount) || 0;
        if (val.capacity !== undefined) return parseFloat(val.capacity) || 0;
        if (val.days !== undefined) {
          const dpw = Number(settings.daysPerWeek) || 5;
          const wks = periodInfo && periodInfo.kind === 'month' ? getWeeksInMonth(periodInfo.key).length : 1;
          return (parseFloat(val.days) || 0) / (dpw * wks);
        }
        if (val.hours !== undefined) {
          const dpw = Number(settings.daysPerWeek) || 5;
          const hpd = Number(settings.hoursPerDay) || 8;
          const wks = periodInfo && periodInfo.kind === 'month' ? getWeeksInMonth(periodInfo.key).length : 1;
          return (parseFloat(val.hours) || 0) / (dpw * hpd * wks);
        }
      }
      return 0;
    }

    function parseCompositeKey(compositeKey, deptIds, projIds) {
      const separators = ['::', '|', '/', '->'];
      for (const sep of separators) {
        if (compositeKey.includes(sep)) {
          const parts = compositeKey.split(sep).map(p => p.trim()).filter(Boolean);
          if (parts.length === 3) {
            let deptId = null, projId = null, periodInfo = null;
            parts.forEach(part => {
              const pInfo = normalizeWeekKeyFormat(part);
              if (pInfo && !periodInfo) periodInfo = pInfo;
              else if (deptIds.has(part) && !deptId) deptId = part;
              else if (projIds.has(part) && !projId) projId = part;
            });
            if (!deptId && !projId && normalizeWeekKeyFormat(parts[2])) {
              deptId = parts[0]; projId = parts[1]; periodInfo = normalizeWeekKeyFormat(parts[2]);
            }
            if (deptId && projId && periodInfo) return { deptId, projId, periodInfo };
          }
          if (parts.length === 2) {
            let deptId = null, periodInfo = null;
            parts.forEach(part => {
              const pInfo = normalizeWeekKeyFormat(part);
              if (pInfo && !periodInfo) periodInfo = pInfo;
              else if (!deptId) deptId = part;
            });
            if (deptId && periodInfo) return { deptId, periodInfo };
          }
        }
      }
      const colonParts = compositeKey.split(':');
      if (colonParts.length === 3 && normalizeWeekKeyFormat(colonParts[2])) {
        return { deptId: colonParts[0], projId: colonParts[1], periodInfo: normalizeWeekKeyFormat(colonParts[2]) };
      }
      if (colonParts.length === 2 && normalizeWeekKeyFormat(colonParts[1])) {
        return { deptId: colonParts[0], periodInfo: normalizeWeekKeyFormat(colonParts[1]) };
      }
      return null;
    }

    function normalizeAndMigrateDB(rawInput) {
      if (!rawInput || typeof rawInput !== 'object') return null;

      const src = (rawInput.departments || rawInput.projects)
        ? rawInput
        : (rawInput.data && (rawInput.data.departments || rawInput.data.projects))
          ? rawInput.data
          : (rawInput.db && (rawInput.db.departments || rawInput.db.projects))
            ? rawInput.db
            : (rawInput.liveDB && (rawInput.liveDB.departments || rawInput.liveDB.projects))
              ? rawInput.liveDB
              : null;

      if (!src) return null;

      const db = createEmptyDB();

      if (src.meta && typeof src.meta === 'object') {
        db.meta = {
          version: 3,
          revision: Number(src.meta.revision) || 1,
          lastModifiedAt: src.meta.lastModifiedAt || src.meta.updatedAt || new Date().toISOString(),
          lastModifiedBy: src.meta.lastModifiedBy || src.meta.updatedBy || ui.userName || 'Project Mgr',
          lastWriteId: String(src.meta.lastWriteId || ''),
          lastClientId: String(src.meta.lastClientId || ''),
        };
      }

      const rawSet = src.settings || src.config || {};
      const dpw = Number(rawSet.daysPerWeek ?? rawSet.workingDaysPerWeek ?? rawSet.days_per_week) || 5;
      const hpd = Number(rawSet.hoursPerDay ?? rawSet.hours_per_day)
        || (rawSet.hoursPerWeek ? (Number(rawSet.hoursPerWeek) / dpw) : 8);
      const rawRet = rawSet.retention || {};
      const rawFte3 = rawSet.fte3Scheme || {};

      db.settings = {
        daysPerWeek: dpw,
        hoursPerDay: hpd,
        warnThreshold: Number(rawSet.warnThreshold ?? rawSet.warningThreshold ?? rawSet.warnPct) || 85,
        overThreshold: Number(rawSet.overThreshold ?? rawSet.overloadThreshold ?? rawSet.overPct) || 100,
        currency: String(rawSet.currency || '€').trim() || '€',
        retention: {
          maxChangeLog: Math.max(10, Math.min(500, parseInt(rawRet.maxChangeLog ?? DEFAULT_RETENTION.maxChangeLog, 10) || 100)),
          maxSnapshots: Math.max(1, Math.min(50, parseInt(rawRet.maxSnapshots ?? DEFAULT_RETENTION.maxSnapshots, 10) || 10)),
          maxDumpHistory: Math.max(5, Math.min(100, parseInt(rawRet.maxDumpHistory ?? DEFAULT_RETENTION.maxDumpHistory, 10) || 15)),
          autoPruneOnSave: rawRet.autoPruneOnSave !== undefined ? Boolean(rawRet.autoPruneOnSave) : true,
        },
        fte3Scheme: {
          basis: rawFte3.basis === 'absoluteFte' ? 'absoluteFte' : 'capacityPct',
          yellowPct: Math.max(5, Math.min(95, Number(rawFte3.yellowPct ?? DEFAULT_FTE3_SCHEME.yellowPct) || 25)),
          redPct: Math.max(10, Math.min(150, Number(rawFte3.redPct ?? DEFAULT_FTE3_SCHEME.redPct) || 50)),
          yellowFte: Math.max(0.25, Math.min(50, Number(rawFte3.yellowFte ?? DEFAULT_FTE3_SCHEME.yellowFte) || 1.0)),
          redFte: Math.max(0.5, Math.min(100, Number(rawFte3.redFte ?? DEFAULT_FTE3_SCHEME.redFte) || 2.5)),
        },
      };

      const rawDepts = Array.isArray(src.departments)
        ? src.departments
        : (src.departments && typeof src.departments === 'object' ? Object.values(src.departments) : []);
      const embeddedDeptOverrides = [];

      db.departments = rawDepts.filter(Boolean).map((d, idx) => {
        const id = String(d.id || uid('d'));
        const name = String(d.name || d.title || `Department ${idx + 1}`).trim();
        const code = String(d.code || d.shortCode || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || `D${idx + 1}`).toUpperCase();
        const defaultCapacity = Number(d.defaultCapacity ?? d.capacity ?? d.baseCapacity ?? d.defaultFte ?? d.headcount ?? d.fte ?? 0) || 0;
        const manager = String(d.manager || d.lead || d.owner || '').trim();
        const color = d.color || PALETTE[idx % PALETTE.length];
        const dayRate = Math.max(0, Number(d.dayRate ?? d.dailyRate ?? 0) || 0);

        const inlineOverrides = d.capacityOverrides || d.variableCapacity || d.capacities || d.capacityByPeriod;
        if (inlineOverrides && typeof inlineOverrides === 'object') {
          embeddedDeptOverrides.push({ deptId: id, map: inlineOverrides });
        }
        return { id, name, code, color, defaultCapacity, manager, dayRate };
      });

      const rawProjs = Array.isArray(src.projects)
        ? src.projects
        : (src.projects && typeof src.projects === 'object' ? Object.values(src.projects) : []);

      db.projects = getSortedProjects({
        projects: rawProjs.filter(Boolean).map((p, idx) => {
          const id = String(p.id || uid('p'));
          const name = String(p.name || p.title || `Project ${idx + 1}`).trim();
          const code = String(p.code || p.projectCode || p.shortCode || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || `P${idx + 1}`).toUpperCase();
          const status = String(p.status || 'Active');
          const priority = String(p.priority || 'Medium');
          const owner = String(p.owner || p.lead || p.manager || '').trim();
          const techLead = String(p.techLead || p.technicalLead || p.tech_lead || '').trim();
          const color = p.color || PALETTE[(idx + 2) % PALETTE.length];
          const nonFte = Boolean(p.nonFte || p.category === 'admin');
          const budgetDays = nonFte ? 0 : Math.max(0, Number(p.budgetDays ?? p.targetDays ?? 0) || 0);
          const budgetCost = nonFte ? 0 : Math.max(0, Number(p.budgetCost ?? p.costBudget ?? 0) || 0);
          const tentative = nonFte ? false : Boolean(p.tentative);
          const archived = Boolean(p.archived);
          const category = nonFte ? 'admin' : (tentative ? 'tentative' : 'standard');
          return { id, name, code, color, status, priority, owner, techLead, budgetDays, budgetCost, tentative, nonFte, category, archived };
        }),
      });

      const deptIds = new Set(db.departments.map(d => d.id));
      const projIds = new Set(db.projects.map(p => p.id));

      const normalizeAllocationsCollection = (rawAlloc, targetComments) => {
        const out = {};
        if (!rawAlloc) return out;
        const writeAlloc = (deptId, projId, periodInfo, rawVal, noteText) => {
          if (!deptId || !projId || !periodInfo) return;
          const fte = extractNumericFte(rawVal, periodInfo, db.settings);
          const cleanFte = Math.max(0, Math.round(fte * 1000) / 1000);
          if (cleanFte > 0.0001) {
            const weeks = periodInfo.kind === 'month' ? getWeeksInMonth(periodInfo.key) : [periodInfo.key];
            weeks.forEach(wk => { out[`${deptId}::${projId}::${wk}`] = cleanFte; });
          }
          if (targetComments && noteText && String(noteText).trim()) {
            targetComments[`${deptId}::${projId}::${periodInfo.key}`] = String(noteText).trim();
          }
        };

        if (Array.isArray(rawAlloc)) {
          rawAlloc.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const deptId = item.deptId || item.departmentId || item.dept;
            const projId = item.projId || item.projectId || item.proj;
            const pInfo = normalizeWeekKeyFormat(item.weekKey || item.week || item.period || item.month || item.monthKey || item.date);
            writeAlloc(deptId, projId, pInfo, item, item.note || item.comment || item.notes);
          });
          return out;
        }

        if (typeof rawAlloc === 'object') {
          Object.entries(rawAlloc).forEach(([k, v]) => {
            if (v === null || v === undefined) return;
            const parsedKey = parseCompositeKey(k, deptIds, projIds);
            if (parsedKey && parsedKey.projId && parsedKey.periodInfo) {
              const noteText = (v && typeof v === 'object') ? (v.note || v.comment || v.notes) : '';
              writeAlloc(parsedKey.deptId, parsedKey.projId, parsedKey.periodInfo, v, noteText);
              return;
            }
            if (typeof v === 'object' && !Array.isArray(v)) {
              const topPeriod = normalizeWeekKeyFormat(k);
              if (topPeriod) {
                Object.entries(v).forEach(([k2, v2]) => {
                  if (v2 && typeof v2 === 'object') {
                    Object.entries(v2).forEach(([k3, v3]) => {
                      const dId = deptIds.has(k2) ? k2 : (deptIds.has(k3) ? k3 : k2);
                      const pId = projIds.has(k3) ? k3 : (projIds.has(k2) ? k2 : k3);
                      const noteText = (v3 && typeof v3 === 'object') ? (v3.note || v3.comment) : '';
                      writeAlloc(dId, pId, topPeriod, v3, noteText);
                    });
                  }
                });
                return;
              }
              const pairSep = ['::', '|', '/'].find(s => k.includes(s));
              if (pairSep) {
                const [a, b] = k.split(pairSep);
                const dId = deptIds.has(a) ? a : (deptIds.has(b) ? b : a);
                const pId = projIds.has(b) ? b : (projIds.has(a) ? a : b);
                Object.entries(v).forEach(([pk, pv]) => {
                  const pInfo = normalizeWeekKeyFormat(pk);
                  const noteText = (pv && typeof pv === 'object') ? (pv.note || pv.comment) : '';
                  writeAlloc(dId, pId, pInfo, pv, noteText);
                });
                return;
              }
              Object.entries(v).forEach(([k2, v2]) => {
                if (v2 && typeof v2 === 'object') {
                  Object.entries(v2).forEach(([k3, v3]) => {
                    const pInfo = normalizeWeekKeyFormat(k3);
                    const dId = deptIds.has(k) ? k : (deptIds.has(k2) ? k2 : k);
                    const pId = projIds.has(k2) ? k2 : (projIds.has(k) ? k : k2);
                    const noteText = (v3 && typeof v3 === 'object') ? (v3.note || v3.comment) : '';
                    writeAlloc(dId, pId, pInfo, v3, noteText);
                  });
                }
              });
            }
          });
        }
        return out;
      };

      const normalizeCapacityCollection = (rawCaps) => {
        const out = {};
        const writeCap = (deptId, periodInfo, rawVal) => {
          if (!deptId || !periodInfo) return;
          const val = extractNumericFte(rawVal, periodInfo, db.settings);
          if (!isFinite(val) || val < 0) return;
          const weeks = periodInfo.kind === 'month' ? getWeeksInMonth(periodInfo.key) : [periodInfo.key];
          weeks.forEach(wk => { out[`${deptId}::${wk}`] = Math.round(val * 1000) / 1000; });
        };

        embeddedDeptOverrides.forEach(({ deptId, map }) => {
          Object.entries(map).forEach(([pk, val]) => writeCap(deptId, normalizeWeekKeyFormat(pk), val));
        });

        if (!rawCaps) return out;
        if (Array.isArray(rawCaps)) {
          rawCaps.forEach(item => {
            if (!item || typeof item !== 'object') return;
            const dId = item.deptId || item.departmentId || item.dept;
            const pInfo = normalizeWeekKeyFormat(item.weekKey || item.week || item.period || item.month || item.monthKey);
            writeCap(dId, pInfo, item);
          });
          return out;
        }
        if (typeof rawCaps === 'object') {
          Object.entries(rawCaps).forEach(([k, v]) => {
            const parsedKey = parseCompositeKey(k, deptIds, projIds);
            if (parsedKey && parsedKey.deptId && parsedKey.periodInfo) {
              writeCap(parsedKey.deptId, parsedKey.periodInfo, v);
            } else if (v && typeof v === 'object') {
              Object.entries(v).forEach(([pk, pv]) => writeCap(k, normalizeWeekKeyFormat(pk), pv));
            }
          });
        }
        return out;
      };

      const normalizeMilestonesList = (rawMs) => {
        if (!Array.isArray(rawMs)) return [];
        return rawMs.filter(Boolean).map(m => {
          let date = m.date || m.targetDate || m.dueDate || m.currentDate || '';
          if (!date && (m.weekKey || m.week || m.period || m.month)) {
            const pInfo = normalizeWeekKeyFormat(m.weekKey || m.week || m.period || m.month);
            if (pInfo) date = getPeriodMidDateISO(pInfo.key, pInfo.kind);
          }
          const baselineDate = m.baselineDate || m.originalDate || m.plannedDate || date;
          return {
            id: String(m.id || uid('ms')),
            title: String(m.title || m.name || m.label || 'Milestone').trim(),
            projectId: String(m.projectId || m.projId || ''),
            deptId: String(m.deptId || m.departmentId || ''),
            baselineDate,
            date,
            status: String(m.status || 'Pending'),
            notes: String(m.notes || m.description || m.comment || ''),
          };
        });
      };

      const normalizeCommentsCollection = (rawComments) => {
        const out = {};
        if (!rawComments || typeof rawComments !== 'object') return out;
        Object.entries(rawComments).forEach(([k, v]) => {
          const text = typeof v === 'string' ? v.trim() : (v && typeof v === 'object' ? String(v.text || v.comment || v.note || '').trim() : '');
          if (!text) return;
          const parsedKey = parseCompositeKey(k, deptIds, projIds);
          if (parsedKey && parsedKey.deptId && parsedKey.projId && parsedKey.periodInfo) {
            out[`${parsedKey.deptId}::${parsedKey.projId}::${parsedKey.periodInfo.key}`] = text;
          } else {
            out[k] = text;
          }
        });
        return out;
      };

      db.comments = normalizeCommentsCollection(src.comments || src.cellComments || src.notes);
      db.allocations = normalizeAllocationsCollection(src.allocations || src.manpower || src.plan, db.comments);
      db.capacityOverrides = normalizeCapacityCollection(src.capacityOverrides || src.capacities || src.variableCapacity || src.deptCapacities);
      db.milestones = normalizeMilestonesList(src.milestones);

      const rawSnaps = Array.isArray(src.snapshots) ? src.snapshots : [];
      db.snapshots = rawSnaps.filter(Boolean).map((s, idx) => {
        const sData = s.data || s.state || s;
        const snapComments = normalizeCommentsCollection(sData.comments || sData.cellComments);
        return {
          id: String(s.id || uid('snap')),
          name: String(s.name || s.label || s.title || `Snapshot ${idx + 1}`).trim(),
          createdAt: s.createdAt || s.timestamp || s.date || new Date().toISOString(),
          createdBy: String(s.createdBy || s.author || s.user || 'PM'),
          pinned: Boolean(s.pinned),
          notes: String(s.notes || s.description || ''),
          data: {
            allocations: normalizeAllocationsCollection(sData.allocations || sData.manpower, snapComments),
            capacityOverrides: normalizeCapacityCollection(sData.capacityOverrides || sData.capacities),
            comments: snapComments,
            milestones: normalizeMilestonesList(sData.milestones),
          }
        };
      });

      const rawLog = src.changeLog || src.changelog || src.history || src.auditLog || [];
      db.changeLog = (Array.isArray(rawLog) ? rawLog : []).filter(Boolean).map(l => ({
        id: String(l.id || uid('log')),
        timestamp: l.timestamp || l.time || l.date || l.at || new Date().toISOString(),
        user: String(l.user || l.author || l.by || 'Project Mgr'),
        type: String(l.type || l.category || l.kind || 'Update'),
        summary: String(l.summary || l.message || l.description || l.detail || l.action || ''),
      }));

      const rawDumps = Array.isArray(src.dumpHistory) ? src.dumpHistory : [];
      db.dumpHistory = rawDumps.filter(Boolean).map(d => ({
        id: String(d.id || uid('dump')),
        timestamp: d.timestamp || new Date().toISOString(),
        user: String(d.user || 'Project Mgr'),
        format: String(d.format || 'JSON').toUpperCase(),
        filename: String(d.filename || ''),
        revision: Number(d.revision) || 1,
        sizeBytes: Number(d.sizeBytes) || 0,
        summary: String(d.summary || ''),
      }));

      const rawPeople = Array.isArray(src.peopleDirectory) ? src.peopleDirectory : [];
      db.peopleDirectory = rawPeople
        .filter(p => p && String(p.name || '').trim())
        .map(p => ({
          id: String(p.id || uid('ppl')),
          name: String(p.name).trim(),
          role: ['Both', 'Project Owner', 'Technical Lead'].includes(p.role) ? p.role : 'Both',
        }));

      const rawAc = (src.accessControl && typeof src.accessControl === 'object') ? src.accessControl : {};
      const rawUsers = Array.isArray(rawAc.users) ? rawAc.users : [];
      db.accessControl = {
        version: 1,
        adminName: String(rawAc.adminName || 'Administrator').trim() || 'Administrator',
        users: rawUsers
          .filter(u => u && String(u.name || '').trim())
          .map(u => {
            const rawTabs = (u.permissions && u.permissions.tabs && typeof u.permissions.tabs === 'object') ? u.permissions.tabs : {};
            const tabs = {
              matrix: rawTabs.matrix !== undefined ? Boolean(rawTabs.matrix) : true,
              health: rawTabs.health !== undefined ? Boolean(rawTabs.health) : true,
              data: Boolean(rawTabs.data),
              sync: Boolean(rawTabs.sync),
            };
            if (!tabs.matrix && !tabs.health && !tabs.data && !tabs.sync) tabs.matrix = true;
            const ks = (u.keySlot && typeof u.keySlot === 'object' && u.keySlot.salt && u.keySlot.iv && u.keySlot.wrapped)
              ? {
                  kdf: String(u.keySlot.kdf || 'PBKDF2-SHA256'),
                  iterations: Number(u.keySlot.iterations) || 250000,
                  salt: String(u.keySlot.salt),
                  iv: String(u.keySlot.iv),
                  wrapped: String(u.keySlot.wrapped),
                }
              : null;
            return {
              id: String(u.id || uid('usr')),
              name: String(u.name).trim(),
              roleTitle: String(u.roleTitle || '').trim(),
              enabled: u.enabled !== false,
              isAdmin: Boolean(u.isAdmin),
              mustChangePassword: Boolean(u.mustChangePassword),
              needsAdminKeyReset: Boolean(u.needsAdminKeyReset),
              permissions: {
                tabs,
                finance: Boolean(u.permissions && u.permissions.finance),
              },
              keySlot: ks,
              updatedAt: u.updatedAt || new Date().toISOString(),
            };
          }),
      };

      return db;
    }

    /* ---------- Mod 3: Rolling Retention & Compaction Engine ---------- */

    function getRetentionSettings(db = getActiveDB()) {
      const raw = (db && db.settings && db.settings.retention) || {};
      return {
        maxChangeLog: Math.max(10, Math.min(500, parseInt(raw.maxChangeLog ?? DEFAULT_RETENTION.maxChangeLog, 10) || 100)),
        maxSnapshots: Math.max(1, Math.min(50, parseInt(raw.maxSnapshots ?? DEFAULT_RETENTION.maxSnapshots, 10) || 10)),
        maxDumpHistory: Math.max(5, Math.min(100, parseInt(raw.maxDumpHistory ?? DEFAULT_RETENTION.maxDumpHistory, 10) || 15)),
        autoPruneOnSave: raw.autoPruneOnSave !== undefined ? Boolean(raw.autoPruneOnSave) : true,
      };
    }

    function enforceRollingHistory(db, { dryRun = false, limits = null } = {}) {
      if (!db) return { prunedLog: 0, prunedSnaps: 0, prunedDumps: 0, orphansRemoved: 0, savedBytes: 0, retiredArchive: null };
      const ret = limits ? { ...getRetentionSettings(db), ...limits } : getRetentionSettings(db);
      const beforeBytes = JSON.stringify(db).length;

      const deptIds = new Set((db.departments || []).map(d => d.id));
      const projIds = new Set((db.projects || []).map(p => p.id));

      const logArr = Array.isArray(db.changeLog) ? db.changeLog : [];
      const retiredLog = logArr.length > ret.maxChangeLog ? logArr.slice(ret.maxChangeLog) : [];

      const snapArr = Array.isArray(db.snapshots) ? db.snapshots : [];
      const keptSnaps = [];
      const retiredSnaps = [];
      let unpinnedCount = 0;
      snapArr.forEach(s => {
        if (s.pinned) {
          keptSnaps.push(s);
        } else if (unpinnedCount < ret.maxSnapshots) {
          unpinnedCount++;
          keptSnaps.push(s);
        } else {
          retiredSnaps.push(s);
        }
      });

      const dumpArr = Array.isArray(db.dumpHistory) ? db.dumpHistory : [];
      const retiredDumps = dumpArr.length > ret.maxDumpHistory ? dumpArr.slice(ret.maxDumpHistory) : [];

      let orphansRemoved = 0;
      const allocKeysToRemove = [];
      Object.entries(db.allocations || {}).forEach(([k, v]) => {
        const [dId, pId] = k.split('::');
        if (Number(v) <= 0.0001 || !deptIds.has(dId) || !projIds.has(pId)) {
          allocKeysToRemove.push(k);
          orphansRemoved++;
        }
      });
      const capKeysToRemove = [];
      Object.entries(db.capacityOverrides || {}).forEach(([k, v]) => {
        const [dId] = k.split('::');
        if (!deptIds.has(dId) || !isFinite(Number(v)) || Number(v) < 0) {
          capKeysToRemove.push(k);
          orphansRemoved++;
        }
      });
      const commentKeysToRemove = [];
      Object.entries(db.comments || {}).forEach(([k, v]) => {
        const [dId, pId] = k.split('::');
        if (!String(v || '').trim() || !deptIds.has(dId) || !projIds.has(pId)) {
          commentKeysToRemove.push(k);
          orphansRemoved++;
        }
      });

      const retiredArchive = (retiredLog.length || retiredSnaps.length || retiredDumps.length)
        ? {
            archivedAt: new Date().toISOString(),
            archivedBy: ui.userName || 'Project Mgr',
            retiredChangeLog: retiredLog,
            retiredSnapshots: retiredSnaps,
            retiredDumpHistory: retiredDumps,
          }
        : null;

      if (!dryRun) {
        if (retiredLog.length) db.changeLog = logArr.slice(0, ret.maxChangeLog);
        if (retiredSnaps.length) db.snapshots = keptSnaps;
        if (retiredDumps.length) db.dumpHistory = dumpArr.slice(0, ret.maxDumpHistory);
        allocKeysToRemove.forEach(k => delete db.allocations[k]);
        capKeysToRemove.forEach(k => delete db.capacityOverrides[k]);
        commentKeysToRemove.forEach(k => delete db.comments[k]);

        const validSnapIds = new Set((db.snapshots || []).map(s => s.id));
        if (ui.compareSnapshotId && !validSnapIds.has(ui.compareSnapshotId)) ui.compareSnapshotId = '';
        if (ui.compareTargetId && ui.compareTargetId !== '__CURRENT__' && !validSnapIds.has(ui.compareTargetId)) {
          ui.compareTargetId = '__CURRENT__';
        }
      }

      const afterBytes = dryRun
        ? Math.max(0, beforeBytes - JSON.stringify(retiredLog).length - JSON.stringify(retiredSnaps).length - JSON.stringify(retiredDumps).length)
        : JSON.stringify(db).length;

      return {
        prunedLog: retiredLog.length,
        prunedSnaps: retiredSnaps.length,
        prunedDumps: retiredDumps.length,
        orphansRemoved,
        savedBytes: Math.max(0, beforeBytes - afterBytes),
        retiredArchive,
      };
    }

    function computePayloadMetrics(db = getActiveDB()) {
      const snapsBytes = JSON.stringify(db.snapshots || []).length;
      const logBytes = JSON.stringify(db.changeLog || []).length;
      const dumpBytes = JSON.stringify(db.dumpHistory || []).length;
      const totalBytes = JSON.stringify(db || {}).length;
      const coreBytes = Math.max(0, totalBytes - snapsBytes - logBytes - dumpBytes);
      const pinnedSnapCount = (db.snapshots || []).filter(s => s.pinned).length;
      const unpinnedSnapCount = (db.snapshots || []).length - pinnedSnapCount;
      return {
        totalBytes, coreBytes, snapsBytes, logBytes, dumpBytes,
        pinnedSnapCount, unpinnedSnapCount,
        logCount: (db.changeLog || []).length,
        dumpCount: (db.dumpHistory || []).length,
        snapCount: (db.snapshots || []).length,
      };
    }

    function recordDumpEvent(format, filename, sizeBytes, summary) {
      const db = getActiveDB();
      if (!Array.isArray(db.dumpHistory)) db.dumpHistory = [];
      db.dumpHistory.unshift({
        id: uid('dump'),
        timestamp: new Date().toISOString(),
        user: ui.userName || 'Project Mgr',
        format: String(format || 'JSON').toUpperCase(),
        filename: String(filename || ''),
        revision: db.meta?.revision || 1,
        sizeBytes: Math.max(0, Number(sizeBytes) || 0),
        summary: String(summary || ''),
      });
      enforceRollingHistory(db);
      if (ui.whatIfMode && whatIfDB) {
        // Ephemeral in-memory What-If sandbox; do not overwrite Live DB or shared file
      } else if (ui.demoMode) {
        safeSetStorage(STORAGE_KEYS.DEMO_DB, JSON.stringify(demoDB));
      } else {
        safeSetStorage(STORAGE_KEYS.LIVE_DB, JSON.stringify(liveDB));
        scheduleAutoSaveToFile();
      }
      if (ui.activeTab === 'sync') renderSyncTab();
    }

    function syncHorizonAfterDBLoad(db) {
      ui.filterDept = 'all';
      ui.filterProj = 'all';
      ui.compareSnapshotId = '';
      ui.compareTargetId = '__CURRENT__';
      ui.mobileSelectedPeriod = '';

      const allWeeks = new Set();
      Object.keys(db.allocations || {}).forEach(k => {
        const wk = k.split('::')[2];
        if (wk && /^\d{4}-W\d{2}$/.test(wk)) allWeeks.add(wk);
      });
      (db.milestones || []).forEach(m => {
        if (m.date && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) {
          allWeeks.add(dateToISOWeekKey(parseISODate(m.date)));
        }
      });

      if (allWeeks.size === 0) return false;

      const visible = getVisiblePeriods();
      const visibleWeekSet = new Set();
      visible.forEach(pk => {
        if (ui.timeUnit === 'month') getWeeksInMonth(pk).forEach(w => visibleWeekSet.add(w));
        else visibleWeekSet.add(pk);
      });

      const hasAnyVisible = [...allWeeks].some(w => visibleWeekSet.has(w));
      if (!hasAnyVisible) {
        const sortedWeeks = [...allWeeks].sort();
        const earliestWk = sortedWeeks[0];
        ui.startWeek = earliestWk;
        ui.startMonth = getWeekOwningMonth(earliestWk);
        ui.mobileSelectedPeriod = ui.timeUnit === 'month' ? ui.startMonth : ui.startWeek;
        persistUIPrefs();
        return true;
      }
      return false;
    }

    function getActiveDB() {
      if (ui.whatIfMode && whatIfDB) return whatIfDB;
      return ui.demoMode ? demoDB : liveDB;
    }

    function getProjectTotalPlannedDays(projId, db = getActiveDB()) {
      const dpw = Number(db?.settings?.daysPerWeek) || 5;
      let totalDays = 0;
      Object.entries(db?.allocations || {}).forEach(([key, fte]) => {
        const parts = key.split('::');
        if (parts[1] === projId) totalDays += (Number(fte) || 0) * dpw;
      });
      return Math.round(totalDays * 10) / 10;
    }

    function getCurrencySymbol(db = getActiveDB()) {
      return (db && db.settings && db.settings.currency) ? String(db.settings.currency) : '€';
    }

    function formatCurrency(amount, db = getActiveDB()) {
      const sym = getCurrencySymbol(db);
      const val = Number(amount) || 0;
      const abs = Math.abs(val);
      const sign = val < 0 ? '-' : '';
      const prefix = sym.length > 1 ? `${sym} ` : sym;
      if (abs >= 1000000) return `${sign}${prefix}${(Math.round((abs / 1000000) * 100) / 100)}M`;
      if (abs >= 10000) return `${sign}${prefix}${(Math.round((abs / 1000) * 10) / 10)}k`;
      if (abs >= 1000) return `${sign}${prefix}${(Math.round((abs / 1000) * 100) / 100)}k`;
      return `${sign}${prefix}${Math.round(abs).toLocaleString('en-US')}`;
    }

    function hasAnyDayRates(db = getActiveDB()) {
      if (typeof ppCanAccessFinance === 'function' && !ppCanAccessFinance()) return false;
      return (db?.departments || []).some(d => (Number(d.dayRate) || 0) > 0);
    }

    function getProjectTotalPlannedCost(projId, db = getActiveDB()) {
      const dpw = Number(db?.settings?.daysPerWeek) || 5;
      const rateByDept = new Map((db?.departments || []).map(d => [d.id, Number(d.dayRate) || 0]));
      let totalCost = 0;
      Object.entries(db?.allocations || {}).forEach(([key, fte]) => {
        const parts = key.split('::');
        if (parts[1] === projId) {
          const rate = rateByDept.get(parts[0]) || 0;
          if (rate > 0) totalCost += (Number(fte) || 0) * dpw * rate;
        }
      });
      return Math.round(totalCost);
    }

    function isProjectIncludedInPlan(proj, includeTentative = ui.includeTentative) {
      if (!proj) return false;
      if (!includeTentative && proj.tentative) return false;
      return true;
    }

    function getGroupedCapacityOverrides(db = getActiveDB(), deptFilter = 'all') {
      const overrides = db?.capacityOverrides || {};
      const deptMap = new Map((db?.departments || []).map(d => [d.id, d]));
      const byDept = new Map();

      Object.entries(overrides).forEach(([key, val]) => {
        const parts = key.split('::');
        const deptId = parts[0];
        const wk = parts[1];
        if (!deptId || !wk || !/^\d{4}-W\d{2}$/.test(wk)) return;
        if (deptFilter !== 'all' && deptId !== deptFilter) return;
        const dept = deptMap.get(deptId);
        if (!dept) return;
        const numVal = Math.round((Number(val) || 0) * 1000) / 1000;
        if (!byDept.has(deptId)) byDept.set(deptId, []);
        byDept.get(deptId).push({ weekKey: wk, fte: numVal });
      });

      const spans = [];
      (db?.departments || []).forEach(dept => {
        const list = byDept.get(dept.id);
        if (!list || list.length === 0) return;
        list.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
        let cur = null;
        list.forEach(item => {
          const isContiguous = cur && addWeeksToWeekKey(cur.endWk, 1) === item.weekKey && Math.abs(cur.fte - item.fte) < 0.001;
          if (isContiguous) {
            cur.endWk = item.weekKey;
            cur.weekKeys.push(item.weekKey);
          } else {
            if (cur) spans.push(cur);
            const baseFte = Number(dept.defaultCapacity) || 0;
            cur = {
              deptId: dept.id,
              dept,
              startWk: item.weekKey,
              endWk: item.weekKey,
              weekKeys: [item.weekKey],
              fte: item.fte,
              baseFte,
              deltaFte: Math.round((item.fte - baseFte) * 100) / 100,
            };
          }
        });
        if (cur) spans.push(cur);
      });

      return spans;
    }

    function getStructuredCapacityOverrides(db = getActiveDB(), deptFilter = 'all') {
      const overrides = db?.capacityOverrides || {};
      const depts = db?.departments || [];
      const deptMap = new Map(depts.map(d => [d.id, d]));
      const deptOrder = new Map(depts.map((d, i) => [d.id, i]));
      const byWeek = new Map();

      Object.entries(overrides).forEach(([key, val]) => {
        const parts = key.split('::');
        const deptId = parts[0];
        const wk = parts[1];
        if (!deptId || !wk || !/^\d{4}-W\d{2}$/.test(wk)) return;
        if (!deptMap.has(deptId)) return;
        const numVal = Math.round((Number(val) || 0) * 1000) / 1000;
        if (!byWeek.has(wk)) byWeek.set(wk, new Map());
        byWeek.get(wk).set(deptId, numVal);
      });

      const sortedWeeks = [...byWeek.keys()].sort((a, b) => a.localeCompare(b));
      const companyWeekMap = new Map(); // wk -> { deptIds: Set, valuesByDept: Map }

      // Automatically detect company-wide holiday / shutdown superposition weeks
      // Resilient to: 0-capacity depts, newly added / on-call depts, tiny-dept rounding, and mixed-rate dips
      const activeDepts = depts.filter(d => (Number(d.defaultCapacity) || 0) > 0);
      const baselineDepts = activeDepts.length >= 2 ? activeDepts : depts;
      if (baselineDepts.length >= 2) {
        const totalBaseAll = baselineDepts.reduce((acc, d) => acc + (Number(d.defaultCapacity) || 0), 0);
        if (totalBaseAll > 0) {
          const denom = baselineDepts.length;
          sortedWeeks.forEach(wk => {
            const wkMap = byWeek.get(wk);
            if (!wkMap || wkMap.size < 2) return;

            const reducedDepts = [];
            const equalDepts = [];
            depts.forEach(d => {
              if (!wkMap.has(d.id)) return;
              const baseFte = Number(d.defaultCapacity) || 0;
              const fte = wkMap.get(d.id);
              if (baseFte > 0) {
                if (fte < baseFte - 0.001) reducedDepts.push(d);
                else if (Math.abs(fte - baseFte) <= 0.001) equalDepts.push(d);
              } else if (fte <= 0.001) {
                reducedDepts.push(d);
              }
            });

            if (reducedDepts.length < 2) return;

            // Include tiny departments whose uniform-% scaled FTE rounded back to baseFte (e.g. 0.25 * 90% -> 0.25)
            const reducedActive = reducedDepts.filter(d => (Number(d.defaultCapacity) || 0) > 0);
            const sumRedBase = reducedActive.reduce((acc, d) => acc + (Number(d.defaultCapacity) || 0), 0);
            const sumRedFte = reducedActive.reduce((acc, d) => acc + wkMap.get(d.id), 0);
            const approxPct = sumRedBase > 0 ? Math.round((sumRedFte / sumRedBase) * 100) : 0;

            const groupedDepts = [...reducedDepts];
            if (approxPct > 0 && approxPct < 100 && equalDepts.length > 0) {
              equalDepts.forEach(d => {
                const baseFte = Number(d.defaultCapacity) || 0;
                const roundedScaled = Math.round((baseFte * (approxPct / 100)) * 20) / 20;
                if (Math.abs(roundedScaled - baseFte) <= 0.001) {
                  groupedDepts.push(d);
                }
              });
            }

            const groupedActiveCount = groupedDepts.filter(d => (Number(d.defaultCapacity) || 0) > 0).length;
            const isFullActive = groupedActiveCount >= denom;
            const isAllShutdown = groupedDepts.every(d => wkMap.get(d.id) <= 0.001);
            const isShutdownMajority = isAllShutdown && groupedActiveCount >= Math.max(2, Math.ceil(denom * 0.6));
            const isUniformReduced = !isAllShutdown && groupedDepts.every(d => {
              const baseFte = Number(d.defaultCapacity) || 0;
              if (baseFte <= 0) return true;
              const fte = wkMap.get(d.id);
              const pct = Math.round((fte / baseFte) * 100);
              const expected = Math.round((baseFte * (approxPct / 100)) * 20) / 20;
              return Math.abs(fte - expected) <= 0.051 || Math.abs(pct - approxPct) <= 5;
            });
            const isHolidayMajority = groupedActiveCount >= Math.max(2, Math.ceil(denom * 0.6))
              && (isUniformReduced || (denom >= 3 && groupedActiveCount >= denom - 1));

            if (isFullActive || isShutdownMajority || isHolidayMajority) {
              const idSet = new Set(groupedDepts.map(d => d.id));
              const vals = new Map();
              groupedDepts.forEach(d => vals.set(d.id, wkMap.get(d.id)));
              companyWeekMap.set(wk, { deptIds: idSet, valuesByDept: vals });
            }
          });
        }
      }

      // Merge contiguous company-wide weeks that have identical grouped departments and per-department FTE overrides
      const companyGroups = [];
      let curCo = null;
      const finalizeCompanyGroup = (grp) => {
        const coveredDepts = depts.filter(d => grp.deptIds.has(d.id));
        const items = coveredDepts.map(d => {
          const baseFte = Number(d.defaultCapacity) || 0;
          const fte = grp.valuesByDept.get(d.id);
          const deltaFte = Math.round((fte - baseFte) * 100) / 100;
          const pct = baseFte > 0 ? Math.round((fte / baseFte) * 100) : 0;
          return { deptId: d.id, dept: d, baseFte, fte, deltaFte, pct };
        });
        const totalBaseFte = Math.round(items.reduce((acc, it) => acc + it.baseFte, 0) * 100) / 100;
        const totalFte = Math.round(items.reduce((acc, it) => acc + it.fte, 0) * 100) / 100;
        const totalDeltaFte = Math.round((totalFte - totalBaseFte) * 100) / 100;
        const overallPct = totalBaseFte > 0 ? Math.round((totalFte / totalBaseFte) * 100) : 0;
        const isShutdown = totalFte <= 0.001;
        const isUniformPct = !isShutdown && items.every(it => {
          if (it.baseFte <= 0) return true;
          const expected = Math.round((it.baseFte * (overallPct / 100)) * 20) / 20;
          return Math.abs(it.fte - expected) <= 0.051 || Math.abs(it.pct - overallPct) <= 3;
        });
        const eventType = isShutdown ? 'shutdown' : (isUniformPct ? 'holiday' : 'mixed-holiday');
        const label = isShutdown ? 'Company Shutdown' : (isUniformPct ? 'Company Holiday' : 'Company-Wide Holiday / Dip');
        const pctLabel = isShutdown ? '0%' : (isUniformPct ? `${overallPct}%` : `~${overallPct}% avg`);
        const totalActiveDepts = baselineDepts.length;
        const coveredActiveDepts = items.filter(it => it.baseFte > 0).length;
        const isPartial = coveredActiveDepts < totalActiveDepts;
        return {
          kind: 'company',
          id: `co__${grp.startWk}__${grp.endWk}`,
          startWk: grp.startWk,
          endWk: grp.endWk,
          weekKeys: grp.weekKeys,
          eventType,
          label,
          pctLabel,
          pctFactor: overallPct,
          totalBaseFte,
          totalFte,
          totalDeltaFte,
          totalDepts: totalActiveDepts,
          isPartial,
          deptIds: items.map(it => it.deptId),
          items,
        };
      };

      [...companyWeekMap.keys()].sort((a, b) => a.localeCompare(b)).forEach(wk => {
        const wkEntry = companyWeekMap.get(wk);
        const sameAsPrev = curCo
          && addWeeksToWeekKey(curCo.endWk, 1) === wk
          && curCo.deptIds.size === wkEntry.deptIds.size
          && [...curCo.deptIds].every(id => wkEntry.deptIds.has(id) && Math.abs((curCo.valuesByDept.get(id) || 0) - (wkEntry.valuesByDept.get(id) || 0)) < 0.001);
        if (sameAsPrev) {
          curCo.endWk = wk;
          curCo.weekKeys.push(wk);
        } else {
          if (curCo) companyGroups.push(finalizeCompanyGroup(curCo));
          curCo = { startWk: wk, endWk: wk, weekKeys: [wk], deptIds: wkEntry.deptIds, valuesByDept: wkEntry.valuesByDept };
        }
      });
      if (curCo) companyGroups.push(finalizeCompanyGroup(curCo));

      // Single-department filter: show that department's spans with subtle company-wide badges when overlapping
      if (deptFilter !== 'all') {
        const companyByWk = new Map();
        companyGroups.forEach(cg => {
          if (cg.deptIds.includes(deptFilter)) {
            cg.weekKeys.forEach(wk => companyByWk.set(wk, cg));
          }
        });
        return getGroupedCapacityOverrides(db, deptFilter).map(sp => {
          const coMatches = sp.weekKeys.map(wk => companyByWk.get(wk)).filter(Boolean);
          let companyBadge = '';
          if (coMatches.length === sp.weekKeys.length && coMatches.length > 0) {
            const first = coMatches[0];
            companyBadge = coMatches.every(c => c.id === first.id)
              ? `${first.label} (${first.pctLabel})`
              : 'Company-Wide Holiday';
          } else if (coMatches.length > 0) {
            companyBadge = `Incl. ${coMatches.length} company wk${coMatches.length === 1 ? '' : 's'}`;
          }
          return {
            ...sp,
            kind: 'dept',
            id: `dept__${sp.deptId}__${sp.startWk}__${sp.endWk}`,
            companyBadge,
          };
        });
      }

      // All-Departments view: extract remaining non-company-wide overrides into per-department contiguous spans
      const byDeptRemaining = new Map();
      sortedWeeks.forEach(wk => {
        const coEntry = companyWeekMap.get(wk);
        const wkMap = byWeek.get(wk);
        wkMap.forEach((fte, deptId) => {
          if (coEntry && coEntry.deptIds.has(deptId)) return;
          if (!byDeptRemaining.has(deptId)) byDeptRemaining.set(deptId, []);
          byDeptRemaining.get(deptId).push({ weekKey: wk, fte });
        });
      });

      const deptSpans = [];
      depts.forEach(dept => {
        const list = byDeptRemaining.get(dept.id);
        if (!list || list.length === 0) return;
        list.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
        let cur = null;
        list.forEach(item => {
          const isContiguous = cur && addWeeksToWeekKey(cur.endWk, 1) === item.weekKey && Math.abs(cur.fte - item.fte) < 0.001;
          if (isContiguous) {
            cur.endWk = item.weekKey;
            cur.weekKeys.push(item.weekKey);
          } else {
            if (cur) deptSpans.push(cur);
            const baseFte = Number(dept.defaultCapacity) || 0;
            cur = {
              kind: 'dept',
              id: '',
              deptId: dept.id,
              dept,
              startWk: item.weekKey,
              endWk: item.weekKey,
              weekKeys: [item.weekKey],
              fte: item.fte,
              baseFte,
              deltaFte: Math.round((item.fte - baseFte) * 100) / 100,
              companyBadge: '',
            };
          }
        });
        if (cur) deptSpans.push(cur);
      });
      deptSpans.forEach(sp => { sp.id = `dept__${sp.deptId}__${sp.startWk}__${sp.endWk}`; });

      const combined = [...companyGroups, ...deptSpans];
      combined.sort((a, b) => {
        const wkCmp = a.startWk.localeCompare(b.startWk);
        if (wkCmp !== 0) return wkCmp;
        if (a.kind !== b.kind) return a.kind === 'company' ? -1 : 1;
        if (a.kind === 'dept' && b.kind === 'dept') {
          return (deptOrder.get(a.deptId) ?? 999) - (deptOrder.get(b.deptId) ?? 999);
        }
        return a.endWk.localeCompare(b.endWk);
      });
      return combined;
    }

    function persistUIPrefs() {
      const toSave = { ...ui, whatIfMode: false, presentMode: false, expandedOverrideGroups: [] };
      safeSetStorage(STORAGE_KEYS.UI_PREFS, JSON.stringify(toSave));
    }

    function recordChange(type, summary) {
      const db = getActiveDB();
      if (!Array.isArray(db.changeLog)) db.changeLog = [];
      db.changeLog.unshift({
        id: uid('log'),
        timestamp: new Date().toISOString(),
        user: ui.userName || 'Project Mgr',
        type,
        summary,
      });
      const ret = getRetentionSettings(db);
      if (ret.autoPruneOnSave) enforceRollingHistory(db);
      else if (db.changeLog.length > 500) db.changeLog.length = 500;
      touchDBAndSave();
    }

    function touchDBAndSave() {
      const db = getActiveDB();
      db.meta = db.meta || { version: 3, revision: 0 };
      db.meta.version = 3;
      db.meta.revision = (db.meta.revision || 0) + 1;
      db.meta.lastModifiedAt = new Date().toISOString();
      db.meta.lastModifiedBy = ui.userName || 'Project Mgr';

      if (ui.whatIfMode && whatIfDB) {
        // Ephemeral What-If clone: never write to LIVE_DB or shared file until explicitly committed
        return;
      }
      if (ui.demoMode) {
        safeSetStorage(STORAGE_KEYS.DEMO_DB, JSON.stringify(demoDB));
      } else {
        safeSetStorage(STORAGE_KEYS.LIVE_DB, JSON.stringify(liveDB));
        scheduleAutoSaveToFile();
      }
    }

    /* ---------- In-Memory Undo / Redo Engine (30-step bounded history) ---------- */

    const MAX_UNDO_STEPS = 30;
    let _undoStack = [];
    let _redoStack = [];

    function captureUndoSnapshot(db = getActiveDB()) {
      return JSON.stringify({
        departments: db.departments || [],
        projects: db.projects || [],
        allocations: db.allocations || {},
        capacityOverrides: db.capacityOverrides || {},
        comments: db.comments || {},
        milestones: db.milestones || [],
      });
    }

    function applyUndoSnapshot(snapshotJson, db = getActiveDB()) {
      const parsed = JSON.parse(snapshotJson);
      db.departments = parsed.departments || [];
      db.projects = parsed.projects || [];
      db.allocations = parsed.allocations || {};
      db.capacityOverrides = parsed.capacityOverrides || {};
      db.comments = parsed.comments || {};
      db.milestones = parsed.milestones || [];
    }

    function pushUndoState(label = 'Change') {
      const db = getActiveDB();
      if (!db) return;
      _undoStack.push({ label: String(label || 'Change'), data: captureUndoSnapshot(db) });
      if (_undoStack.length > MAX_UNDO_STEPS) _undoStack.shift();
      _redoStack = [];
      updateUndoRedoButtons();
    }

    function clearUndoHistory() {
      _undoStack = [];
      _redoStack = [];
      updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
      const undoBtn = document.getElementById('btnUndo');
      const redoBtn = document.getElementById('btnRedo');
      const mUndoBtn = document.getElementById('mBtnUndo');
      const mRedoBtn = document.getElementById('mBtnRedo');
      const last = _undoStack[_undoStack.length - 1];
      const next = _redoStack[_redoStack.length - 1];
      [undoBtn, mUndoBtn].forEach(b => {
        if (!b) return;
        b.disabled = _undoStack.length === 0;
        b.title = last ? `Undo: ${last.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
      });
      [redoBtn, mRedoBtn].forEach(b => {
        if (!b) return;
        b.disabled = _redoStack.length === 0;
        b.title = next ? `Redo: ${next.label} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
      });
      const mUndoLbl = document.getElementById('mBtnUndoLabel');
      const mRedoLbl = document.getElementById('mBtnRedoLabel');
      if (mUndoLbl) mUndoLbl.textContent = last ? `Undo: ${last.label}` : 'Undo';
      if (mRedoLbl) mRedoLbl.textContent = next ? `Redo: ${next.label}` : 'Redo';
    }

    function undoLastChange() {
      if (_undoStack.length === 0) {
        showToast('Nothing to undo', 'info');
        return;
      }
      const db = getActiveDB();
      const entry = _undoStack.pop();
      _redoStack.push({ label: entry.label, data: captureUndoSnapshot(db) });
      applyUndoSnapshot(entry.data, db);
      touchDBAndSave();
      renderAll();
      updateUndoRedoButtons();
      showToast(`Undid: ${entry.label}`, 'info');
    }

    function redoLastChange() {
      if (_redoStack.length === 0) {
        showToast('Nothing to redo', 'info');
        return;
      }
      const db = getActiveDB();
      const entry = _redoStack.pop();
      _undoStack.push({ label: entry.label, data: captureUndoSnapshot(db) });
      applyUndoSnapshot(entry.data, db);
      touchDBAndSave();
      renderAll();
      updateUndoRedoButtons();
      showToast(`Redid: ${entry.label}`, 'info');
    }

