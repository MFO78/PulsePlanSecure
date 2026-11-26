#!/usr/bin/env node
/**
 * PulsePlan Zero-Dependency Automated Logic Test Suite
 *
 * Loads the compiled runtime script from index.html inside a sandboxed Node vm
 * context and verifies core date/pro-rata math, scheduling power tools,
 * What-If isolation, Undo/Redo, CSV import parsing, and migration integrity.
 *
 * Usage: node test.mjs
 */

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync('index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if (!scriptMatch) {
  console.error('❌ Could not extract inline <script> from index.html');
  process.exit(1);
}

// Minimal deterministic browser/DOM stub for headless logic testing
const memStorage = new Map();
const noop = () => {};
const makeStubEl = () => ({
  style: { setProperty: noop },
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  setAttribute: noop,
  getAttribute: () => null,
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  appendChild: noop,
  remove: noop,
  focus: noop,
  closest: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30, bottom: 30 }),
  innerHTML: '',
  textContent: '',
  value: '',
  dataset: {},
});

const sandbox = {
  console,
  Math,
  Date,
  JSON,
  Object,
  Array,
  Set,
  Map,
  Number,
  String,
  Boolean,
  RegExp,
  Error,
  Promise,
  Uint8Array,
  TextEncoder,
  TextDecoder,
  btoa,
  atob,
  Event: globalThis.Event,
  crypto: globalThis.crypto,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
  setTimeout: () => 0,
  clearTimeout: noop,
  setInterval: () => 0,
  clearInterval: noop,
  requestAnimationFrame: noop,
  localStorage: {
    getItem: (k) => (memStorage.has(k) ? memStorage.get(k) : null),
    setItem: (k, v) => memStorage.set(k, String(v)),
    removeItem: (k) => memStorage.delete(k),
  },
  navigator: { userAgent: 'PulsePlanTestRunner' },
  document: {
    documentElement: makeStubEl(),
    head: makeStubEl(),
    body: makeStubEl(),
    activeElement: null,
    fullscreenElement: null,
    fonts: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeStubEl(),
    addEventListener: noop,
    removeEventListener: noop,
  },
  window: null,
};
sandbox.window = {
  innerWidth: 1440,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false }),
  print: noop,
  scrollTo: noop,
};

const ctx = vm.createContext(sandbox);
// Prevent init() from running DOM boot side-effects on load; we call pure functions directly
const testableCode = scriptMatch[1].replace(/\binit\(\);\s*$/, '');
vm.runInContext(testableCode, ctx);

// Initialize a clean liveDB and demoDB in the VM context
vm.runInContext(`
  liveDB = createSampleDemoDB();
  demoDB = createSampleDemoDB();
  ui.demoMode = false;
  ui.whatIfMode = false;
  ui.timeUnit = 'week';
  ui.manpowerUnit = 'fte';
`, ctx);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('ISO week & month pro-rata math (4-week vs 5-week months)', () => {
  const res = vm.runInContext(`({
    wJan2026: getWeeksInMonth('2026-01'),
    wFeb2026: getWeeksInMonth('2026-02'),
    nextWk: addWeeksToWeekKey('2026-W52', 2),
    nextMo: addMonthsToMonthKey('2026-11', 3),
    addDays: addDaysToISODate('2026-01-28', 7),
  })`, ctx);
  assert.equal(res.wJan2026.length, 5, 'Jan 2026 has 5 ISO Thursdays');
  assert.equal(res.wFeb2026.length, 4, 'Feb 2026 has 4 ISO Thursdays');
  assert.equal(res.nextWk, '2027-W01', '2026 has 53 ISO weeks, so W52+2 = 2027-W01');
  assert.equal(res.nextMo, '2027-02');
  assert.equal(res.addDays, '2026-02-04');
});

test('FTE <-> Days <-> Hours round-trip conversions', () => {
  const res = vm.runInContext(`({
    days5wk: fteToDisplayValue(2.0, '2026-01', 'month', 'days'),
    hours4wk: fteToDisplayValue(1.5, '2026-02', 'month', 'hours'),
    backFteDays: displayValueToFte(50, '2026-01', 'month', 'days'),
    backFteHours: displayValueToFte(240, '2026-02', 'month', 'hours'),
  })`, ctx);
  assert.equal(res.days5wk, 50); // 2 FTE * 5d * 5wks
  assert.equal(res.hours4wk, 240); // 1.5 FTE * 5d * 8h * 4wks
  assert.equal(res.backFteDays, 2);
  assert.equal(res.backFteHours, 1.5);
});

test('Shift Project Schedule (+2 weeks) is lossless and preserves milestone baseline', () => {
  const res = vm.runInContext(`(() => {
    const db = createEmptyDB();
    db.departments = [{ id: 'd1', name: 'Eng', code: 'ENG', color: '#4f46e5', defaultCapacity: 5, manager: '' }];
    db.projects = [{ id: 'p1', name: 'Alpha', code: 'ALP', color: '#0ea5e9', status: 'Active', priority: 'High', owner: '', budgetDays: 100, archived: false }];
    db.allocations['d1::p1::2026-W10'] = 2.0;
    db.allocations['d1::p1::2026-W11'] = 3.0;
    db.allocations['d1::p1::2026-W12'] = 1.5;
    db.comments['d1::p1::2026-W10'] = 'Kickoff';
    db.milestones = [{ id: 'm1', projectId: 'p1', deptId: 'd1', title: 'Beta', date: '2026-03-10', baselineDate: '2026-03-10', status: 'Pending' }];

    const out = shiftProjectSchedule('p1', 2, 'week', { shiftMilestones: true, shiftBaseline: false, shiftComments: true }, db);
    return { out, allocs: db.allocations, comments: db.comments, ms: db.milestones[0] };
  })()`, ctx);

  assert.equal(res.out.movedAllocs, 3);
  assert.equal(res.out.movedComments, 1);
  assert.equal(res.out.movedMilestones, 1);
  assert.equal(res.allocs['d1::p1::2026-W10'], undefined);
  assert.equal(res.allocs['d1::p1::2026-W12'], 2.0);
  assert.equal(res.allocs['d1::p1::2026-W13'], 3.0);
  assert.equal(res.allocs['d1::p1::2026-W14'], 1.5);
  assert.equal(res.comments['d1::p1::2026-W12'], 'Kickoff');
  assert.equal(res.ms.date, '2026-03-24');
  assert.equal(res.ms.baselineDate, '2026-03-10');
});

test('Company Holiday / Shutdown % scales capacity and resets cleanly at 100%', () => {
  const res = vm.runInContext(`(() => {
    const db = createEmptyDB();
    db.departments = [
      { id: 'd1', name: 'Eng', code: 'ENG', color: '#4f46e5', defaultCapacity: 8.0, manager: '' },
      { id: 'd2', name: 'Des', code: 'DES', color: '#ec4899', defaultCapacity: 3.0, manager: '' },
    ];
    applyHolidayFactor(['d1', 'd2'], '2026-W33', 2, 'week', 50, db);
    const mid = { ...db.capacityOverrides };
    applyHolidayFactor(['d1'], '2026-W33', 1, 'week', 100, db);
    return { mid, after: db.capacityOverrides };
  })()`, ctx);

  assert.equal(res.mid['d1::2026-W33'], 4);
  assert.equal(res.mid['d1::2026-W34'], 4);
  assert.equal(res.mid['d2::2026-W33'], 1.5);
  assert.equal(res.after['d1::2026-W33'], undefined);
  assert.equal(res.after['d1::2026-W34'], 4);
});

test('Project Effort Budget planned days & migration preserves budgetDays + archived', () => {
  const res = vm.runInContext(`(() => {
    const raw = {
      departments: [{ id: 'd1', name: 'Eng', code: 'ENG', defaultCapacity: 5 }],
      projects: [{ id: 'p1', name: 'Old', code: 'OLD', budgetDays: 60, archived: true }],
      allocations: { 'd1::p1::2026-W05': 2.0, 'd1::p1::2026-W06': 1.5 },
    };
    const migrated = normalizeAndMigrateDB(raw);
    return {
      proj: migrated.projects[0],
      plannedDays: getProjectTotalPlannedDays('p1', migrated),
    };
  })()`, ctx);

  assert.equal(res.proj.budgetDays, 60);
  assert.equal(res.proj.archived, true);
  assert.equal(res.plannedDays, 17.5); // (2.0 + 1.5) * 5d
});

test('What-If Scenario Mode isolates edits from Live DB and computes live delta', () => {
  const res = vm.runInContext(`(() => {
    liveDB = createSampleDemoDB();
    const beforeKey = Object.keys(liveDB.allocations)[0];
    const beforeVal = liveDB.allocations[beforeKey];
    enterWhatIfMode();
    const activeIsWhatIf = getActiveDB() === whatIfDB && getActiveDB() !== liveDB;
    getActiveDB().allocations[beforeKey] = beforeVal + 1.5;
    touchDBAndSave();
    const liveUnchanged = liveDB.allocations[beforeKey] === beforeVal;
    const summary = computeWhatIfDeltaSummary();
    discardWhatIfMode();
    const restoredLive = getActiveDB() === liveDB && !ui.whatIfMode;
    return { activeIsWhatIf, liveUnchanged, summary, restoredLive };
  })()`, ctx);

  assert.equal(res.activeIsWhatIf, true);
  assert.equal(res.liveUnchanged, true);
  assert.match(res.summary, /\+1\.5 FTE-wks/);
  assert.equal(res.restoredLive, true);
});

test('Undo / Redo restores and reapplies allocation edits accurately', () => {
  const res = vm.runInContext(`(() => {
    liveDB = createEmptyDB();
    liveDB.departments = [{ id: 'd1', name: 'Eng', code: 'ENG', color: '#4f46e5', defaultCapacity: 5, manager: '' }];
    liveDB.projects = [{ id: 'p1', name: 'Nova', code: 'NVA', color: '#4f46e5', status: 'Active', priority: 'High', owner: '', budgetDays: 0, archived: false }];
    clearUndoHistory();
    liveDB.allocations['d1::p1::2026-W10'] = 1.0;
    pushUndoState('Raise allocation');
    liveDB.allocations['d1::p1::2026-W10'] = 4.0;
    const afterEdit = liveDB.allocations['d1::p1::2026-W10'];
    undoLastChange();
    const afterUndo = liveDB.allocations['d1::p1::2026-W10'];
    redoLastChange();
    const afterRedo = liveDB.allocations['d1::p1::2026-W10'];
    return { afterEdit, afterUndo, afterRedo };
  })()`, ctx);

  assert.equal(res.afterEdit, 4.0);
  assert.equal(res.afterUndo, 1.0);
  assert.equal(res.afterRedo, 4.0);
});

test('CSV / Excel paste parser handles tabs, commas, header skipping, Days->FTE & errors', () => {
  const res = vm.runInContext(`(() => {
    const db = createSampleDemoDB();
    const sample = [
      'Department, Project, Period, Value',
      'ENG, NVA, 2026-W10, 10',
      'Product Design\\tAtlas Mobile v3\\t2026-02\\t20',
      'BADDEPT, NVA, 2026-W10, 5',
      'ENG, NVA, NOTADATE, 5',
    ].join('\\n');
    return parseDelimitedAllocations(sample, 'days', db);
  })()`, ctx);

  assert.equal(res.valid.length, 2);
  assert.equal(res.errors.length, 2);
  assert.equal(res.valid[0].deptCode, 'ENG');
  assert.equal(res.valid[0].fte, 2.0); // 10 days / 5d/wk = 2.0 FTE
  assert.equal(res.valid[1].deptCode, 'DES');
  assert.equal(res.valid[1].fte, 1.0); // 20 days / (4 wks * 5d) = 1.0 FTE
});

test('Saved Views persist and reload cleanly from storage', () => {
  const res = vm.runInContext(`(() => {
    persistSavedViews([{ id: 'v1', name: 'Steering 2W', state: { horizon: 2, compactRowLabels: true, noteSize: 'lg' } }]);
    return getSavedViews();
  })()`, ctx);

  assert.equal(res.length, 1);
  assert.equal(res[0].name, 'Steering 2W');
  assert.equal(res[0].state.horizon, 2);
  assert.equal(res[0].state.compactRowLabels, true);
});

test('Full-column layout geometry prevents half columns for Vertical & Detailed row labels', () => {
  const res = vm.runInContext(`({
    det12on1400: computeFullColumnGeometry(1400, 12, false, false),
    det4on1400: computeFullColumnGeometry(1400, 4, false, false),
    vert4on1024: computeFullColumnGeometry(1024, 4, true, false),
    vert2on1440: computeFullColumnGeometry(1440, 2, true, false),
  })`, ctx);

  // 12 periods on 1400px: visibleCols must be an exact integer filling 100% of (1400 - stickyW)
  assert.equal(Number.isInteger(res.det12on1400.visibleCols), true);
  assert.ok(Math.abs(res.det12on1400.stickyW + res.det12on1400.colW * res.det12on1400.visibleCols - 1400) < 0.01);
  // 4 periods on 1400px (Detailed): all 4 periods fit cleanly edge-to-edge
  assert.equal(res.det4on1400.visibleCols, 4);
  assert.ok(Math.abs(res.det4on1400.totalTableW - 1400) < 0.01);
  // 4 periods on 1024px (Vertical 62px): all 4 fit with 0 overflow
  assert.equal(res.vert4on1024.visibleCols, 4);
  assert.equal(res.vert4on1024.stickyW, 62);
  assert.ok(Math.abs(res.vert4on1024.totalTableW - 1024) < 0.01);
  // 2 periods on 1440px (Vertical 62px): exact 50/50 split
  assert.equal(res.vert2on1440.visibleCols, 2);
  assert.ok(Math.abs(res.vert2on1440.totalTableW - 1440) < 0.01);
  // Browser tab SVG favicon is embedded in index.html
  assert.equal(html.includes('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,'), true);
});

test('Projects are sorted naturally by project code everywhere', () => {
  const res = vm.runInContext(`(() => {
    const demoCodes = createSampleDemoDB().projects.map(p => p.code);
    const mig = normalizeAndMigrateDB({
      departments: [{ id: 'd1', name: 'Eng', code: 'ENG', defaultCapacity: 5 }],
      projects: [
        { id: 'p3', name: 'Zeta', code: 'P10' },
        { id: 'p1', name: 'Alpha', code: 'P2' },
        { id: 'p2', name: 'Beta', code: 'A01' },
      ],
    });
    return { demoCodes, migCodes: mig.projects.map(p => p.code) };
  })()`, ctx);

  assert.deepEqual([...res.demoCodes], ['AIC', 'ATL', 'CLD', 'EPR', 'NVA']);
  assert.deepEqual([...res.migCodes], ['A01', 'P2', 'P10']);
});

test('Users can be removed from Quick Switch and restored cleanly', () => {
  const res = vm.runInContext(`(() => {
    ui.recentUsers = ['Marco', 'Elena Rostova'];
    ui.removedUsers = [];
    ui.userName = 'Marco';
    removeQuickUser('Elena Rostova');
    const afterRemove = getSuggestedTeamUsers();
    removeQuickUser('Marco');
    const activeAfterRemovingSelf = ui.userName;
    const afterRemovingSelf = getSuggestedTeamUsers();
    setActiveUserName('Marco', false);
    const afterReAdd = getSuggestedTeamUsers();
    return { afterRemove, activeAfterRemovingSelf, afterRemovingSelf, afterReAdd };
  })()`, ctx);

  assert.equal(res.afterRemove.includes('Elena Rostova'), false);
  assert.notEqual(res.activeAfterRemovingSelf, 'Marco');
  assert.equal(res.afterRemovingSelf.includes('Marco'), false);
  assert.equal(res.afterReAdd.includes('Marco'), true);
});

test('Mobile Collapse All / Expand All toggles all visible accordion rows cleanly', () => {
  const res = vm.runInContext(`(() => {
    liveDB = createSampleDemoDB();
    ui.axis = 'department';
    ui.filterDept = 'all';
    ui.mobileCollapsedIds = [];
    const total = getMobileVisibleRows().length;
    toggleMobileCollapseAll();
    const afterCollapse = ui.mobileCollapsedIds.length;
    toggleMobileCollapseAll();
    const afterExpand = ui.mobileCollapsedIds.length;
    return { total, afterCollapse, afterExpand };
  })()`, ctx);

  assert.equal(res.total, 4);
  assert.equal(res.afterCollapse, 4);
  assert.equal(res.afterExpand, 0);
});

test('Tentative / Pipeline toggle excludes tentative projects from totals and separates Committed vs Pipeline', () => {
  const res = vm.runInContext(`(() => {
    const db = createEmptyDB();
    db.departments = [{ id: 'd1', name: 'Eng', code: 'ENG', color: '#4f46e5', defaultCapacity: 5, manager: '', dayRate: 600 }];
    db.projects = [
      { id: 'p1', name: 'Committed', code: 'COM', color: '#4f46e5', status: 'Active', priority: 'High', owner: '', budgetDays: 0, budgetCost: 0, tentative: false, archived: false },
      { id: 'p2', name: 'Pipeline', code: 'PIP', color: '#f59e0b', status: 'Planned', priority: 'Low', owner: '', budgetDays: 0, budgetCost: 0, tentative: true, archived: false },
    ];
    db.allocations['d1::p1::2026-W10'] = 3.0;
    db.allocations['d1::p2::2026-W10'] = 1.5;
    ui.filterProj = 'all';
    ui.includeTentative = true;
    const withPipe = getDeptTotalAllocatedFte('d1', '2026-W10', 'week', db);
    const splitOn = getDeptCommittedVsTentativeFte('d1', '2026-W10', 'week', db);
    ui.includeTentative = false;
    const withoutPipe = getDeptTotalAllocatedFte('d1', '2026-W10', 'week', db);
    const splitOff = getDeptCommittedVsTentativeFte('d1', '2026-W10', 'week', db);
    ui.includeTentative = true;
    return { withPipe, withoutPipe, splitOn, splitOff };
  })()`, ctx);

  assert.equal(res.withPipe, 4.5);
  assert.equal(res.withoutPipe, 3.0);
  assert.equal(res.splitOn.committed, 3.0);
  assert.equal(res.splitOn.tentative, 1.5);
  assert.equal(res.splitOff.tentative, 0);
});

test('Department day rates compute project cost burn & currency formatting accurately', () => {
  const res = vm.runInContext(`(() => {
    const raw = {
      settings: { daysPerWeek: 5, currency: '$' },
      departments: [
        { id: 'd1', name: 'Eng', code: 'ENG', defaultCapacity: 5, dayRate: 800 },
        { id: 'd2', name: 'Des', code: 'DES', defaultCapacity: 3, dayRate: 600 },
      ],
      projects: [{ id: 'p1', name: 'Nova', code: 'NVA', budgetCost: 50000, tentative: true }],
      allocations: { 'd1::p1::2026-W10': 2.0, 'd2::p1::2026-W10': 1.0 },
    };
    const mig = normalizeAndMigrateDB(raw);
    return {
      currency: mig.settings.currency,
      dayRate: mig.departments[0].dayRate,
      budgetCost: mig.projects[0].budgetCost,
      tentative: mig.projects[0].tentative,
      cost: getProjectTotalPlannedCost('p1', mig),
      formatted: formatCurrency(getProjectTotalPlannedCost('p1', mig), mig),
    };
  })()`, ctx);

  assert.equal(res.currency, '$');
  assert.equal(res.dayRate, 800);
  assert.equal(res.budgetCost, 50000);
  assert.equal(res.tentative, true);
  assert.equal(res.cost, 11000); // (2*5*800) + (1*5*600) = 8000 + 3000
  assert.equal(res.formatted, '$11k');
});

test('Grouped Variable Capacity Overrides merge contiguous identical weekly spans cleanly', () => {
  const res = vm.runInContext(`(() => {
    const db = createEmptyDB();
    db.departments = [{ id: 'd1', name: 'Eng', code: 'ENG', color: '#4f46e5', defaultCapacity: 8.0, manager: '', dayRate: 0 }];
    db.capacityOverrides = {
      'd1::2026-W10': 9.5,
      'd1::2026-W11': 9.5,
      'd1::2026-W12': 9.5,
      'd1::2026-W13': 10.0,
      'd1::2026-W20': 6.0,
    };
    return getGroupedCapacityOverrides(db, 'all');
  })()`, ctx);

  assert.equal(res.length, 3);
  assert.equal(res[0].startWk, '2026-W10');
  assert.equal(res[0].endWk, '2026-W12');
  assert.equal(res[0].weekKeys.length, 3);
  assert.equal(res[0].deltaFte, 1.5);
  assert.equal(res[1].startWk, '2026-W13');
  assert.equal(res[1].fte, 10.0);
  assert.equal(res[2].deltaFte, -2.0);
});

test('Bottleneck Resolver ranks tentative/low-priority project first and computes accurate buffer & trim', () => {
  const res = vm.runInContext(`(() => {
    const db = createEmptyDB();
    db.departments = [{ id: 'd1', name: 'Eng', code: 'ENG', color: '#4f46e5', defaultCapacity: 5.0, manager: '', dayRate: 0 }];
    db.projects = [
      { id: 'p_crit', name: 'Core', code: 'COR', color: '#4f46e5', status: 'Active', priority: 'Critical', owner: '', budgetDays: 0, budgetCost: 0, tentative: false, archived: false },
      { id: 'p_pipe', name: 'Proposal', code: 'PRP', color: '#f59e0b', status: 'Planned', priority: 'High', owner: '', budgetDays: 0, budgetCost: 0, tentative: true, archived: false },
    ];
    db.allocations['d1::p_crit::2026-W10'] = 4.0;
    db.allocations['d1::p_pipe::2026-W10'] = 2.0;
    ui.includeTentative = true;
    ui.filterProj = 'all';
    return computeBottleneckOptions('d1', '2026-W10', 'week', db);
  })()`, ctx);

  assert.equal(res.pct, 120);
  assert.equal(res.excessFte, 1.0);
  assert.equal(res.candidate.proj.id, 'p_pipe');
  assert.equal(res.trimTargetFte, 1.0);
  assert.equal(res.afterTrimPct, 100);
  assert.equal(res.bufferCapFte, 6.0);
  assert.equal(res.afterBufferPct, 100);
});

test('Multi-mode CSV parsers handle Variable Capacities and Milestones cleanly', () => {
  const res = vm.runInContext(`(() => {
    const db = createSampleDemoDB();
    const caps = parseDelimitedCapacities('Dept, Period, Capacity\\nENG, 2026-W10, 9.5\\nDES, 2026-02, 2.5\\nBAD, 2026-W10, 5', 'fte', db);
    const ms = parseDelimitedMilestones('Project, Title, TargetDate, BaselineDate, Dept, Status\\nNVA, Launch Gate, 2026-06-15, 2026-06-01, ENG, At Risk\\nBAD, X, 2026-06-15', db);
    return { caps, ms };
  })()`, ctx);

  assert.equal(res.caps.valid.length, 2);
  assert.equal(res.caps.errors.length, 1);
  assert.equal(res.caps.valid[0].fte, 9.5);
  assert.equal(res.ms.valid.length, 1);
  assert.equal(res.ms.errors.length, 1);
  assert.equal(res.ms.valid[0].title, 'Launch Gate');
  assert.equal(res.ms.valid[0].status, 'At Risk');
});

test('Duplicate Project & Executive Briefing copy produce accurate results and PWA manifest link exists', () => {
  const res = vm.runInContext(`(() => {
    const db = createSampleDemoDB();
    const beforeCount = db.projects.length;
    const dup = duplicateProject('p_nova', { name: 'Nova Phase 2', code: 'NV2', copyAllocations: true, copyMilestones: true, tentative: true }, db);
    const briefing = buildExecutiveBriefingText(db);
    return {
      beforeCount,
      afterCount: db.projects.length,
      dupCode: dup.project.code,
      dupTentative: dup.project.tentative,
      copiedAllocs: dup.copiedAllocs,
      copiedMs: dup.copiedMs,
      hasBriefingHeader: briefing.includes('PULSEPLAN EXECUTIVE BRIEFING'),
      hasBottlenecksSec: briefing.includes('BOTTLENECKS'),
    };
  })()`, ctx);

  assert.equal(res.afterCount, res.beforeCount + 1);
  assert.equal(res.dupCode, 'NV2');
  assert.equal(res.dupTentative, true);
  assert.ok(res.copiedAllocs > 0);
  assert.ok(res.copiedMs > 0);
  assert.equal(res.hasBriefingHeader, true);
  assert.equal(res.hasBottlenecksSec, true);
  assert.equal(html.includes('<link rel="manifest" href="./manifest.webmanifest" />'), true);
});

test('End-to-end DOM render smoke test across all tabs, subtabs, views, and modals (zero ReferenceErrors)', () => {
  const bodyHtml = fs.readFileSync('src/html/body.html', 'utf8');
  const domIds = [...new Set([...bodyHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];
  const elMap = new Map();
  const makeStatefulEl = (id) => {
    const attrs = new Map();
    const classes = new Set();
    const el = {
      id,
      tagName: 'DIV',
      style: { setProperty: noop },
      className: '',
      innerHTML: '',
      textContent: '',
      value: '',
      checked: false,
      disabled: false,
      open: false,
      options: [],
      dataset: {},
      clientWidth: 1200,
      scrollLeft: 0,
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
      appendChild: noop,
      remove: noop,
      focus: noop,
      select: noop,
      showModal: () => { el.open = true; },
      close: () => { el.open = false; },
      closest: () => null,
      scrollTo: noop,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 400, bottom: 400 }),
    };
    return el;
  };
  domIds.forEach(id => elMap.set(id, makeStatefulEl(id)));

  const prevGetById = sandbox.document.getElementById;
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) elMap.set(id, makeStatefulEl(id));
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      liveDB = createSampleDemoDB();
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.timeUnit = 'month';
      ui.horizon = 4;

      // Roadmap desktop + mobile across all 3 axes
      window.innerWidth = 1440;
      ui.activeTab = 'matrix';
      ['department', 'project', 'timeline'].forEach(ax => { ui.axis = ax; renderAll(); });
      window.innerWidth = 375;
      ui.mobileLayoutMode = 'cards';
      ['department', 'project', 'timeline'].forEach(ax => { ui.axis = ax; renderAll(); });

      // Health desktop + mobile + all 5 snapshot compare subtabs
      window.innerWidth = 1440;
      ui.activeTab = 'health';
      ui.compareSnapshotId = liveDB.snapshots[0].id;
      renderAll();
      ['deptPeriod', 'project', 'cells', 'milestones', 'capacity'].forEach(st => { ui.compareSubTab = st; renderSnapshotComparison(); });
      selectHealthChartBar(0);

      // Setup & Data tab across all 4 subtabs (verify Depts, Overrides w/ dates, Projects, Milestones ALL populate!)
      ui.activeTab = 'data';
      ['departments', 'projects', 'milestones', 'settings'].forEach(sub => { ui.dataSubTab = sub; renderAll(); });
      const deptsHtml = document.getElementById('dataDepartmentsBody').innerHTML;
      const overridesHtml = document.getElementById('dataCapacityOverridesTable').innerHTML;
      const projsHtml = document.getElementById('dataProjectsBody').innerHTML;
      const msHtml = document.getElementById('dataMilestonesBody').innerHTML;

      // Sync tab + key modals
      ui.activeTab = 'sync';
      renderAll();
      openDeptModal('d_eng');
      openProjectModal('p_nova');
      openMilestoneModal('ms_1');
      openAllocationModal('d_eng', 'p_nova', ui.startMonth);
      openCapacityModal('d_eng', ui.startMonth);
      const capModalHtml = document.getElementById('modalCard').innerHTML;
      ui.axis = 'department';
      openCellDetailModal('d_eng', ui.startMonth);
      ui.axis = 'timeline';
      openCellDetailModal('p_nova', ui.startMonth);
      openBottleneckResolverModal('d_eng', addMonthsToMonthKey(ui.startMonth, 1));
      openSyncConflictModal({ lastModifiedBy: 'Elena', revision: 9 }, Date.now(), createSampleDemoDB());
      openCsvImportModal('allocations');
      openCsvImportModal('capacities');
      openCsvImportModal('milestones');
      openDuplicateProjectModal('p_nova');
      openManualModal();
      closeModal();

      return { deptsHtml, overridesHtml, projsHtml, msHtml, capModalHtml };
    })()`, ctx);

    assert.ok(out.deptsHtml.includes('Engineering'), 'Departments table rendered');
    assert.ok(out.overridesHtml.includes('9.5 FTE'), 'Variable capacity overrides panel rendered');
    assert.ok(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/.test(out.overridesHtml), 'Overrides panel includes calendar date range beside week numbers');
    assert.ok(out.projsHtml.includes('Project Nova'), 'Projects table rendered');
    assert.ok(out.msHtml.includes('Nova Beta Cut'), 'Milestones table rendered');
    assert.ok(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/.test(out.capModalHtml), 'Capacity modal active overrides include calendar date range');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Desktop shared database file open (attachAndLoadFileHandle) loads legacy v2 JSON, clears What-If/Demo, and recovers cleanly from parse errors', async () => {
  const prevShowToast = sandbox.showToast;
  const prevGetById = sandbox.document.getElementById;
  const toasts = [];
  const elMap = new Map();
  sandbox.showToast = (msg, type) => toasts.push({ msg, type });
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const el = makeStubEl();
      el.id = id;
      el.options = [];
      el.dataset = {};
      el.clientWidth = 1200;
      el.scrollLeft = 0;
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 400, bottom: 400 });
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const legacyJson = '\uFEFF' + JSON.stringify({
      meta: { version: 2, revision: 12, lastModifiedBy: 'Marco', lastModifiedAt: '2026-06-01T10:00:00Z' },
      settings: { daysPerWeek: 5, hoursPerDay: 8, warnThreshold: 85, overThreshold: 100 },
      departments: [{ id: 'd_eng', name: 'Engineering', code: 'ENG', color: '#4f46e5', defaultCapacity: 8 }],
      projects: [{ id: 'p_alpha', name: 'Alpha', code: 'ALP', color: '#0ea5e9', status: 'Active', priority: 'High' }],
      allocations: { 'd_eng::p_alpha::2026-W20': 2.5 },
      capacityOverrides: { 'd_eng::2026-W20': 6 },
      comments: { 'd_eng::p_alpha::2026-W20': 'Kickoff' },
      milestones: [{ id: 'm1', title: 'Gate 1', projectId: 'p_alpha', deptId: 'd_eng', date: '2026-05-15', status: 'Pending' }],
      snapshots: [],
      changeLog: [],
    });

    const validHandle = {
      name: 'company_roadmap.json',
      async getFile() {
        return { lastModified: Date.now(), async text() { return legacyJson; } };
      },
    };
    const badJsonHandle = {
      name: 'corrupted.json',
      async getFile() {
        return { lastModified: Date.now(), async text() { return '{ broken json'; } };
      },
    };

    sandbox.__testValidHandle = validHandle;
    sandbox.__testBadHandle = badJsonHandle;

    const res = await vm.runInContext(`(async () => {
      ui.demoMode = true;
      ui.whatIfMode = true;
      whatIfDB = createSampleDemoDB();
      ui.activeTab = 'data';
      await attachAndLoadFileHandle(__testValidHandle, false, false);
      const afterValid = {
        demoMode: ui.demoMode,
        whatIfMode: ui.whatIfMode,
        whatIfNull: whatIfDB === null,
        linkedName: linkedFileHandle && linkedFileHandle.name,
        deptCount: liveDB.departments.length,
        projCount: liveDB.projects.length,
        reloadingFlag: isReloadingFromFile,
      };
      await attachAndLoadFileHandle(__testBadHandle, false, false);
      const afterBad = {
        reloadingFlag: isReloadingFromFile,
        stillHasLiveDepts: liveDB.departments.length,
      };
      stopFilePolling();
      linkedFileHandle = null;
      rememberedFileHandle = null;
      return { afterValid, afterBad };
    })()`, ctx);

    assert.equal(res.afterValid.demoMode, false, 'Connecting shared file exits Demo mode');
    assert.equal(res.afterValid.whatIfMode, false, 'Connecting shared file exits What-If mode');
    assert.equal(res.afterValid.whatIfNull, true, 'Connecting shared file clears whatIfDB');
    assert.equal(res.afterValid.linkedName, 'company_roadmap.json', 'File handle is linked');
    assert.equal(res.afterValid.deptCount, 1, 'Legacy v2 departments loaded');
    assert.equal(res.afterValid.projCount, 1, 'Legacy v2 projects loaded');
    assert.equal(res.afterValid.reloadingFlag, false, 'isReloadingFromFile resets after valid load');
    assert.equal(res.afterBad.reloadingFlag, false, 'isReloadingFromFile resets even after parse error');
    assert.equal(res.afterBad.stillHasLiveDepts, 1, 'Corrupted file does not wipe existing liveDB');
    assert.ok(toasts.some(t => t.type === 'success' && t.msg.includes('company_roadmap.json')), 'Shows success toast on valid load');
    assert.ok(toasts.some(t => t.type === 'error' && t.msg.includes('corrupted.json')), 'Shows specific filename & error on parse failure');
  } finally {
    delete sandbox.__testValidHandle;
    delete sandbox.__testBadHandle;
    sandbox.showToast = prevShowToast;
    sandbox.document.getElementById = prevGetById;
  }
});

test('Mobile web-app meta tag, hung IndexedDB resilience, policy auto-abort detection, and debug log reporting', async () => {
  assert.ok(html.includes('<meta name="mobile-web-app-capable" content="yes" />'), 'index.html includes modern mobile-web-app-capable meta tag');
  assert.ok(!html.includes('apple-mobile-web-app-capable'), 'index.html removes deprecated apple-mobile-web-app-capable meta tag');

  const prevShowToast = sandbox.showToast;
  const prevIDB = sandbox.indexedDB;
  const prevOpenPicker = sandbox.window.showOpenFilePicker;
  const prevSavePicker = sandbox.window.showSaveFilePicker;
  const prevLoc = sandbox.location;
  const toasts = [];
  sandbox.showToast = (msg, type, opts) => toasts.push({ msg, type, opts });
  // Simulate a corporate laptop where indexedDB.open() hangs indefinitely (never fires onsuccess/onerror)
  sandbox.indexedDB = { open: () => ({}) };
  sandbox.location = { protocol: 'https:', origin: 'https://mfo78.github.io', hostname: 'mfo78.github.io' };
  // Simulate an enterprise browser policy that immediately auto-aborts showOpenFilePicker in < 200ms
  sandbox.window.showOpenFilePicker = async () => {
    const err = new Error('Blocked by enterprise policy');
    err.name = 'AbortError';
    throw err;
  };
  sandbox.window.showSaveFilePicker = async () => { throw new Error('unused'); };

  try {
    const t0 = Date.now();
    const out = await vm.runInContext(`(async () => {
      clearDebugLog();
      await openSharedDatabaseFile();
      const report = formatDebugReport();
      return { report };
    })()`, ctx);
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 1000, `openSharedDatabaseFile did not hang (${elapsed}ms)`);
    assert.ok(toasts.some(t => t.type === 'warning' && t.msg.includes('Chrome 158+') && t.msg.includes('Import JSON') && t.opts?.actionLabel === 'Import JSON'), 'AbortError provides Chrome 158+ warning toast with one-click Import JSON action button');
    assert.ok(out.report.includes('PulsePlan Diagnostics Report'), 'formatDebugReport outputs structured header');
    assert.ok(out.report.includes('showOpenFilePicker AbortError'), 'Debug log records AbortError diagnostics');
  } finally {
    sandbox.showToast = prevShowToast;
    sandbox.indexedDB = prevIDB;
    sandbox.window.showOpenFilePicker = prevOpenPicker;
    sandbox.window.showSaveFilePicker = prevSavePicker;
    sandbox.location = prevLoc;
  }
});

test('Connected File full-path formatting & Sync tab display (Windows Copy-as-path quotes, folder prefix, runtime file.path)', () => {
  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const el = makeStubEl();
      el.id = id;
      el.options = [];
      el.dataset = {};
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      const p1 = formatLinkedFileFullPath('roadmap.json', 'G:\\\\My Drive\\\\PulsePlan');
      const p2 = formatLinkedFileFullPath('roadmap.json', 'G:\\\\My Drive\\\\PulsePlan\\\\');
      const p3 = formatLinkedFileFullPath('roadmap.json', '"G:\\\\My Drive\\\\PulsePlan\\\\roadmap.json"');
      const p4 = formatLinkedFileFullPath('roadmap.json', '/Users/marco/Drive/PulsePlan');
      const p5 = formatLinkedFileFullPath('roadmap.json', '');

      ui.linkedFilePaths = { 'roadmap.json': p3 };
      linkedFileHandle = { name: 'roadmap.json' };
      linkedFileDetectedPath = '';
      renderSyncTab();
      const statusHtml = document.getElementById('syncFileStatusBox').innerHTML;

      linkedFileDetectedPath = 'C:\\\\Runtime\\\\Path\\\\roadmap.json';
      const runtimeDisplay = getConnectedFileDisplayPath('roadmap.json');

      linkedFileHandle = null;
      linkedFileDetectedPath = '';
      ui.linkedFilePaths = {};
      return { p1, p2, p3, p4, p5, statusHtml, runtimeDisplay };
    })()`, ctx);

    assert.equal(out.p1, 'G:\\My Drive\\PulsePlan\\roadmap.json', 'Appends filename with backslash for Windows folder');
    assert.equal(out.p2, 'G:\\My Drive\\PulsePlan\\roadmap.json', 'Handles trailing backslash without doubling');
    assert.equal(out.p3, 'G:\\My Drive\\PulsePlan\\roadmap.json', 'Strips Windows Copy-as-path quotes and does not duplicate filename');
    assert.equal(out.p4, '/Users/marco/Drive/PulsePlan/roadmap.json', 'Uses forward slash for Unix/macOS paths');
    assert.equal(out.p5, 'roadmap.json', 'Falls back to bare filename when path empty');
    assert.equal(out.runtimeDisplay, 'C:\\Runtime\\Path\\roadmap.json', 'Prefers runtime-detected file.path when available');
    assert.ok(out.statusHtml.includes('G:\\My Drive\\PulsePlan\\roadmap.json'), 'Sync tab Connected File displays full path');
    assert.ok(out.statusHtml.includes('Edit path'), 'Sync tab offers Edit path button');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Timeline/Gantt respects all 4 colour schemes (accent, fill, fte, fte3) on desktop & mobile, and mobile clears stale Esc status strip', () => {
  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  const makeTrackedEl = (id) => {
    const classes = new Set();
    const el = {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      checked: false,
      disabled: false,
      options: [],
      dataset: {},
      style: { setProperty: noop },
      clientWidth: 1200,
      scrollLeft: 0,
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      },
      setAttribute: noop,
      getAttribute: () => null,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
      appendChild: noop,
      remove: noop,
      focus: noop,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 400, bottom: 400 }),
    };
    return el;
  };
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) elMap.set(id, makeTrackedEl(id));
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      liveDB = createSampleDemoDB();
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.activeTab = 'matrix';
      ui.axis = 'timeline';
      ui.timeUnit = 'month';
      ui.horizon = 4;
      ui.startMonth = getCurrentMonthKey();
      ui.startWeek = getCurrentWeekKey();
      ui.filterDept = 'all';
      ui.filterProj = 'all';
      ui.matrixSearch = '';
      ui.filterOverOnly = false;
      ui.filterAtRiskOnly = false;
      ui.filterHasNotesOnly = false;
      ui.hideEmptyRows = false;
      ui.includeTentative = true;
      ui.spotlightProjId = '';

      // Desktop Timeline across all 4 colour modes
      window.innerWidth = 1440;
      ui.cellColorMode = 'accent'; renderMatrix();
      const dAccent = document.getElementById('matrixWrapper').innerHTML;
      ui.cellColorMode = 'fill'; renderMatrix();
      const dFill = document.getElementById('matrixWrapper').innerHTML;
      ui.cellColorMode = 'fte'; renderMatrix();
      const dFte = document.getElementById('matrixWrapper').innerHTML;
      ui.cellColorMode = 'fte3'; renderMatrix();
      const dFte3 = document.getElementById('matrixWrapper').innerHTML;

      // Mobile Timeline across all 4 colour modes
      window.innerWidth = 375;
      ui.mobileLayoutMode = 'cards';
      ui.cellColorMode = 'accent'; renderMobileMatrixCards();
      const mAccent = document.getElementById('mobileMatrixDeck').innerHTML;
      ui.cellColorMode = 'fill'; renderMobileMatrixCards();
      const mFill = document.getElementById('mobileMatrixDeck').innerHTML;
      ui.cellColorMode = 'fte'; renderMobileMatrixCards();
      const mFte = document.getElementById('mobileMatrixDeck').innerHTML;
      ui.cellColorMode = 'fte3'; renderMobileMatrixCards();
      const mFte3 = document.getElementById('mobileMatrixDeck').innerHTML;

      // Mobile Grid Spotlight shows statusStrip with responsive (Esc), then switching to Cards clears/hides statusStrip
      ui.mobileLayoutMode = 'grid';
      ui.spotlightProjId = 'p_nova';
      renderAll();
      const stripHtmlOnGrid = document.getElementById('matrixStatusStrip').innerHTML;
      const stripHiddenOnGrid = document.getElementById('matrixStatusStrip').classList.contains('hidden');

      ui.mobileLayoutMode = 'cards';
      renderAll();
      const stripHiddenOnCards = document.getElementById('matrixStatusStrip').classList.contains('hidden');
      const stripHtmlOnCards = document.getElementById('matrixStatusStrip').innerHTML;
      const deckWithSpot = document.getElementById('mobileMatrixDeck').innerHTML;

      ui.spotlightProjId = '';
      renderAll();
      const deckAfterClear = document.getElementById('mobileMatrixDeck').innerHTML;

      return { dAccent, dFill, dFte, dFte3, mAccent, mFill, mFte, mFte3, stripHtmlOnGrid, stripHiddenOnGrid, stripHiddenOnCards, stripHtmlOnCards, deckWithSpot, deckAfterClear };
    })()`, ctx);

    assert.ok(out.dAccent.includes('timeline-bar-accent'), 'Desktop Timeline Accent mode uses timeline-bar-accent');
    assert.ok(!out.dFill.includes('timeline-bar-accent') && out.dFill.includes('background-color:'), 'Desktop Timeline Fill mode uses full project colour fill');
    assert.ok(out.dFte.includes('cap') && (out.dFte.includes('ring-1 ring-white/75') || out.dFte.includes('ring-1 ring-white/70')), 'Desktop Timeline By FTE mode renders heat colour + project identity dot');
    assert.ok(out.dFte3.includes('●') || out.dFte3.includes('▲') || out.dFte3.includes('‼'), 'Desktop Timeline 3-Level mode renders demand tier symbol');

    assert.ok(out.mAccent.includes('timeline-bar-accent'), 'Mobile Timeline Accent mode uses timeline-bar-accent');
    assert.ok(!out.mFill.includes('timeline-bar-accent') && out.mFill.includes('opacity:'), 'Mobile Timeline Fill mode uses full project colour fill');
    assert.ok(out.mFte.includes('% cap'), 'Mobile Timeline By FTE mode renders FTE heat scale + % cap tooltip');
    assert.ok(out.mFte3.includes('●') || out.mFte3.includes('▲') || out.mFte3.includes('‼'), 'Mobile Timeline 3-Level mode renders demand tier symbol');

    assert.equal(out.stripHiddenOnGrid, false, 'Status strip shows in Grid mode when Spotlight is active');
    assert.ok(out.stripHtmlOnGrid.includes('hidden md:inline'), 'Esc keyboard hint is hidden on mobile viewports');
    assert.equal(out.stripHiddenOnCards, true, 'Switching to Mobile Cards hides desktop status strip so it never gets stuck');
    assert.equal(out.stripHtmlOnCards, '', 'Desktop status strip HTML is cleared in Mobile Cards mode');
    assert.ok(out.deckWithSpot.includes('Clear Spotlight') && !out.deckWithSpot.includes('Esc'), 'Mobile Spotlight banner has 1-tap Clear Spotlight button without Esc text');
    assert.ok(!out.deckAfterClear.includes('Clear Spotlight'), 'Clearing spotlight removes mobile spotlight banner cleanly');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Genuine PWA manifest PNG icons, fluid full-width 4K layout, and promptPwaInstall flow', async () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
  const has192 = manifest.icons.some(i => i.src === './icon-192.png' && i.sizes === '192x192' && i.type === 'image/png');
  const has512 = manifest.icons.some(i => i.src === './icon-512.png' && i.sizes === '512x512' && i.type === 'image/png');
  const hasMaskable = manifest.icons.some(i => i.src === './icon-maskable-512.png' && i.purpose === 'maskable');
  assert.ok(has192 && has512 && hasMaskable, 'manifest.webmanifest declares 192x192, 512x512, and maskable PNG icons');
  assert.ok(fs.existsSync('icon-192.png'), 'icon-192.png exists on disk');
  assert.ok(fs.existsSync('icon-512.png'), 'icon-512.png exists on disk');
  assert.ok(fs.existsSync('icon-maskable-512.png'), 'icon-maskable-512.png exists on disk');
  assert.ok(html.includes('href="./icon-192.png"'), 'index.html references ./icon-192.png apple-touch-icon');
  assert.ok(!html.includes('max-w-[1600px]'), 'index.html uses fluid full-width layout without max-w-[1600px] 4K sidebars');

  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set(['hidden']);
      const el = makeStubEl();
      el.id = id;
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const res = await vm.runInContext(`(async () => {
      let promptCalled = 0;
      deferredPwaPrompt = {
        prompt: async () => { promptCalled++; },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      };
      updatePwaInstallUI();
      const hdrVisibleWhenReady = !document.getElementById('pwaInstallHeaderBtn').classList.contains('hidden');
      const chipWhenReady = document.getElementById('pwaInstallMenuChip').textContent;

      await promptPwaInstall();
      const hdrHiddenAfterPrompt = document.getElementById('pwaInstallHeaderBtn').classList.contains('hidden');

      // Fallback when no deferred prompt: opens manual install guide modal
      await promptPwaInstall();
      const guideHtml = document.getElementById('modalCard').innerHTML;
      closeModal();
      return { promptCalled, hdrVisibleWhenReady, chipWhenReady, hdrHiddenAfterPrompt, guideHtml };
    })()`, ctx);

    assert.equal(res.promptCalled, 1, 'Native beforeinstallprompt.prompt() is invoked when available');
    assert.equal(res.hdrVisibleWhenReady, true, 'Header Install button reveals when beforeinstallprompt is captured');
    assert.equal(res.chipWhenReady, 'Ready', 'Workspace menu Install chip shows Ready');
    assert.equal(res.hdrHiddenAfterPrompt, true, 'Header Install button hides after prompt completes');
    assert.ok(res.guideHtml.includes('Install PulsePlan App (PWA)'), 'Fallback opens Install PWA guide modal');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Standard (1-6) vs Simplified Overview (12/18/24), shiftStartByInterval, and 4K column geometry', () => {
  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set();
      const el = makeStubEl();
      el.id = id;
      el.clientWidth = 1400;
      el.options = [];
      el.dataset = {};
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      liveDB = createSampleDemoDB();
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.activeTab = 'matrix';
      ui.timeUnit = 'month';
      ui.startMonth = '2026-01';
      ui.horizon = 6;
      shiftStartByInterval(1);
      const afterFwd6 = ui.startMonth;
      shiftStartByInterval(-1);
      const afterBack6 = ui.startMonth;

      // Legacy horizon snapping (8 -> 12, 16 -> 18)
      ui.horizon = 8;
      const snap8 = getActiveHorizon();
      ui.horizon = 16;
      const snap16 = getActiveHorizon();

      // Geometry on Laptop (1400px) & 4K (3700px) for Standard 6 and Overview 12 / 18 / 24
      const gStd6Laptop = computeFullColumnGeometry(1400, 6, false, false);
      const gOv12Laptop = computeFullColumnGeometry(1400, 12, false, false);
      const gOv18Laptop = computeFullColumnGeometry(1400, 18, false, false);
      const gOv24Laptop = computeFullColumnGeometry(1400, 24, false, false);
      const gOv24FourK = computeFullColumnGeometry(3700, 24, false, false);

      // Render 12-month Simplified Overview across By Dept, By Project, and Timeline
      window.innerWidth = 1440;
      ui.startMonth = getCurrentMonthKey();
      ui.horizon = 12;
      ui.compactRowLabels = false;
      ui.cellColorMode = 'fill';
      ui.axis = 'department'; renderMatrix();
      const ovDeptHtml = document.getElementById('matrixWrapper').innerHTML;
      const ovStripHtml = document.getElementById('matrixStatusStrip').innerHTML;
      ui.axis = 'project'; renderMatrix();
      const ovProjHtml = document.getElementById('matrixWrapper').innerHTML;
      ui.axis = 'timeline'; renderMatrix();
      const ovTlHtml = document.getElementById('matrixWrapper').innerHTML;

      return { afterFwd6, afterBack6, snap8, snap16, gStd6Laptop, gOv12Laptop, gOv18Laptop, gOv24Laptop, gOv24FourK, ovDeptHtml, ovStripHtml, ovProjHtml, ovTlHtml };
    })()`, ctx);

    assert.equal(out.afterFwd6, '2026-07', 'shiftStartByInterval(+1) with 6-month horizon jumps +6 months');
    assert.equal(out.afterBack6, '2026-01', 'shiftStartByInterval(-1) jumps back -6 months');
    assert.equal(out.snap8, 12, 'Legacy horizon 8 snaps cleanly to 12 (Overview)');
    assert.equal(out.snap16, 18, 'Legacy horizon 16 snaps cleanly to 18 (Overview)');
    assert.equal(out.gStd6Laptop.visibleCols, 6, 'Standard 6 periods all fit on 1400px desktop');
    assert.equal(out.gOv12Laptop.visibleCols, 12, 'Overview 12 periods all fit simultaneously on 1400px desktop');
    assert.equal(out.gOv18Laptop.visibleCols, 18, 'Overview 18 periods all fit simultaneously on 1400px desktop');
    assert.equal(out.gOv24Laptop.visibleCols, 24, 'Overview 24 periods all fit simultaneously on 1400px desktop');
    assert.equal(out.gOv24FourK.visibleCols, 24, 'Overview 24 periods fit on 4K with generous columns');
    assert.ok(out.gOv24FourK.colW > 130, '4K display scales Overview 24 columns > 130px wide');
    assert.ok(out.ovStripHtml.includes('Simplified Overview') && out.ovStripHtml.includes('Standard (6)'), 'Overview displays status banner with 1-click Standard (6) return button');
    assert.ok(out.ovDeptHtml.includes('data-period-count="12"') && out.ovDeptHtml.includes('shiftStartByInterval'), 'Overview By Dept renders 12 compact columns + interval jump buttons');
    assert.ok(out.ovProjHtml.includes('data-period-count="12"'), 'Overview By Project renders 12 compact columns');
    assert.ok(out.ovTlHtml.includes('timeline-bar-overview'), 'Overview Timeline renders compact continuous overview Gantt bars');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Enhanced Timeline bars, Rich Detailed Row Labels, and Welcome & Setup Splash Screen', () => {
  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set(['hidden']);
      const el = makeStubEl();
      el.id = id;
      el.clientWidth = 1440;
      el.options = [];
      el.dataset = {};
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      liveDB = createSampleDemoDB();
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.activeTab = 'matrix';
      ui.timeUnit = 'month';
      ui.startMonth = getCurrentMonthKey();
      ui.horizon = 4;
      ui.cellColorMode = 'fill';
      window.innerWidth = 1440;

      // Rich Detailed Row Labels in By Dept
      ui.compactRowLabels = false;
      ui.axis = 'department'; renderMatrix();
      const deptDetailed = document.getElementById('matrixWrapper').innerHTML;

      // Rich Detailed Row Labels + Enhanced 2-row Timeline bars with larger text-[11px] dept chips
      ui.axis = 'timeline'; renderMatrix();
      const tlDetailed = document.getElementById('matrixWrapper').innerHTML;

      // Vertical Row Labels in Timeline uses tighter .timeline-vertical-text
      ui.compactRowLabels = true;
      renderMatrix();
      const tlVertical = document.getElementById('matrixWrapper').innerHTML;

      // Welcome Splash Screen open + dismiss with name & welcomeSeen persistence
      ui.welcomeSeen = false;
      openWelcomeModal(true);
      const welcomeHtml = document.getElementById('modalCard').innerHTML;
      const modalOpen = !document.getElementById('modalOverlay').classList.contains('hidden');
      document.getElementById('welcomeUserNameInput').value = 'Marco Formaggi';
      document.getElementById('welcomeDontShowAgain').checked = true;
      dismissWelcomeModal();
      const seenAfter = ui.welcomeSeen;
      const userAfter = ui.userName;
      const modalClosedAfter = document.getElementById('modalOverlay').classList.contains('hidden');

      return { deptDetailed, tlDetailed, tlVertical, welcomeHtml, modalOpen, seenAfter, userAfter, modalClosedAfter };
    })()`, ctx);

    assert.ok(out.deptDetailed.includes('Peak ') && out.deptDetailed.includes('Elena Rostova') && out.deptDetailed.includes('proj'), 'Detailed By Dept row label displays Peak %, Manager, and active project count');
    assert.ok(out.tlDetailed.includes('timeline-bar-std') && out.tlDetailed.includes('text-[11px] font-bold'), 'Standard Timeline renders enhanced 2-row bar with readable 11px department chips');
    assert.ok(out.tlDetailed.includes('Budget') && out.tlDetailed.includes('S. Chen') && out.tlDetailed.includes('depts'), 'Detailed Timeline/Project row label displays Budget bar, Owner, Priority, and active dept count');
    assert.ok(out.tlVertical.includes('timeline-vertical-text'), 'Vertical Timeline row header uses tighter .timeline-vertical-text');
    assert.equal(out.modalOpen, true, 'openWelcomeModal opens splash screen dialog');
    assert.ok(out.welcomeHtml.includes('Welcome to PulsePlan') && out.welcomeHtml.includes('Explore Demo Sandbox') && out.welcomeHtml.includes('Load Shared Database'), 'Welcome modal renders greeting and guided setup paths');
    assert.equal(out.seenAfter, true, 'dismissWelcomeModal persists ui.welcomeSeen = true');
    assert.equal(out.userAfter, 'Marco Formaggi', 'dismissWelcomeModal saves display name');
    assert.equal(out.modalClosedAfter, true, 'dismissWelcomeModal closes dialog cleanly');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Active Variable Capacity Overrides auto-groups company-wide holidays & shutdowns (including separate superpositions) with expand/collapse all', () => {
  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set(['hidden']);
      const el = makeStubEl();
      el.id = id;
      el.options = [];
      el.dataset = {};
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      liveDB = createSampleDemoDB();
      liveDB.capacityOverrides = {};
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.overrideDeptFilter = 'all';
      ui.expandedOverrideGroups = [];

      // 1. Company Shutdown (0%) across 2 consecutive weeks W52-W53 via Holiday tool
      applyHolidayFactor(liveDB.departments.map(d => d.id), '2026-W52', 2, 'week', 0, liveDB);

      // 2. Separately-created overlapping 50% Holiday superposition on W33 (ENG spans W32-W34; other 3 depts only W33)
      liveDB.capacityOverrides['d_eng::2026-W32'] = 4.0;
      liveDB.capacityOverrides['d_eng::2026-W33'] = 4.0;
      liveDB.capacityOverrides['d_eng::2026-W34'] = 4.0;
      liveDB.capacityOverrides['d_des::2026-W33'] = 1.5;
      liveDB.capacityOverrides['d_dat::2026-W33'] = 2.0;
      liveDB.capacityOverrides['d_ops::2026-W33'] = 1.75;

      // 3. Separately-created mixed-rate company-wide dip on W40
      liveDB.capacityOverrides['d_eng::2026-W40'] = 6.0; // 75%
      liveDB.capacityOverrides['d_des::2026-W40'] = 1.5; // 50%
      liveDB.capacityOverrides['d_dat::2026-W40'] = 3.0; // 75%
      liveDB.capacityOverrides['d_ops::2026-W40'] = 2.0; // 57%

      // 4. Company-wide capacity INCREASE on W20 should NOT be grouped as holiday/shutdown
      liveDB.capacityOverrides['d_eng::2026-W20'] = 9.0;
      liveDB.capacityOverrides['d_des::2026-W20'] = 4.0;
      liveDB.capacityOverrides['d_dat::2026-W20'] = 5.0;
      liveDB.capacityOverrides['d_ops::2026-W20'] = 4.5;

      const structured = getStructuredCapacityOverrides(liveDB, 'all');
      const companies = structured.filter(e => e.kind === 'company');
      const depts = structured.filter(e => e.kind === 'dept');

      // Render collapsed by default
      renderCapacityOverridesTable(liveDB);
      const htmlCollapsed = document.getElementById('dataCapacityOverridesTable').innerHTML;
      const expandBtnVisible = !document.getElementById('btnToggleExpandAllOverrides').classList.contains('hidden');
      const labelCollapsed = document.getElementById('btnToggleExpandAllOverridesLabel').textContent;

      // Expand All -> reveals department FTE breakdown rows
      toggleAllOverrideGroups();
      const htmlExpanded = document.getElementById('dataCapacityOverridesTable').innerHTML;
      const labelExpanded = document.getElementById('btnToggleExpandAllOverridesLabel').textContent;

      // Collapse All -> hides sub-rows again
      toggleAllOverrideGroups();
      const htmlReCollapsed = document.getElementById('dataCapacityOverridesTable').innerHTML;
      const labelReCollapsed = document.getElementById('btnToggleExpandAllOverridesLabel').textContent;

      // Reset two department slices inside W33 superposition (ENG & DES) -> W33 drops below 60% majority (2/4) and ungroups; ENG W32 & W34 preserved
      resetCapacityOverrideSpan('d_eng', '2026-W33', '2026-W33');
      const afterOneReset = getStructuredCapacityOverrides(liveDB, 'all');
      const w33AfterOne = afterOneReset.find(e => e.kind === 'company' && e.startWk === '2026-W33');
      resetCapacityOverrideSpan('d_des', '2026-W33', '2026-W33');
      const afterSliceReset = getStructuredCapacityOverrides(liveDB, 'all');
      const engW32Still = liveDB.capacityOverrides['d_eng::2026-W32'];
      const engW33Gone = !Object.prototype.hasOwnProperty.call(liveDB.capacityOverrides, 'd_eng::2026-W33');
      const engW34Still = liveDB.capacityOverrides['d_eng::2026-W34'];

      // Reset entire Company Shutdown group W52-W53
      resetCompanyOverrideGroup('2026-W52', '2026-W53');
      const shutdownRemaining = liveDB.departments.some(d => liveDB.capacityOverrides[d.id + '::2026-W52'] !== undefined || liveDB.capacityOverrides[d.id + '::2026-W53'] !== undefined);

      return {
        companies, depts, htmlCollapsed, expandBtnVisible, labelCollapsed,
        htmlExpanded, labelExpanded, htmlReCollapsed, labelReCollapsed,
        w33AfterOne,
        afterSliceResetCompanies: afterSliceReset.filter(e => e.kind === 'company').length,
        engW32Still, engW33Gone, engW34Still, shutdownRemaining,
      };
    })()`, ctx);

    assert.equal(out.companies.length, 3, 'Detects 3 company-wide groups: W33 (50% holiday superposition), W40 (mixed dip), W52-W53 (0% shutdown)');
    const w33 = out.companies.find(c => c.startWk === '2026-W33');
    const w40 = out.companies.find(c => c.startWk === '2026-W40');
    const w52 = out.companies.find(c => c.startWk === '2026-W52');
    assert.ok(w33 && w33.label === 'Company Holiday' && w33.pctLabel === '50%' && w33.items.length === 4, 'W33 superposition detected as Company Holiday (50%) across 4 depts');
    assert.ok(w40 && w40.label === 'Company-Wide Holiday / Dip' && w40.items.length === 4, 'W40 mixed-rate dip grouped into expandable company row');
    assert.ok(w52 && w52.label === 'Company Shutdown' && w52.endWk === '2026-W53' && w52.weekKeys.length === 2 && w52.totalFte === 0, 'W52-W53 merged into single 2-week Company Shutdown (0%)');
    assert.ok(out.depts.some(d => d.deptId === 'd_eng' && d.startWk === '2026-W32' && d.endWk === '2026-W32'), 'ENG W32 outside superposition remains an individual dept span');
    assert.ok(out.depts.some(d => d.deptId === 'd_eng' && d.startWk === '2026-W34' && d.endWk === '2026-W34'), 'ENG W34 outside superposition remains an individual dept span');
    assert.equal(out.depts.filter(d => d.startWk === '2026-W20').length, 4, 'W20 capacity increases are NOT grouped as holiday/shutdown');

    assert.equal(out.expandBtnVisible, true, 'Expand/Collapse All button is visible when company-wide groups exist');
    assert.equal(out.labelCollapsed, 'Expand All', 'Button shows Expand All when groups are collapsed');
    assert.ok(!out.htmlCollapsed.includes('data-override-group-child'), 'Department sub-rows are hidden when collapsed');
    assert.equal(out.labelExpanded, 'Collapse All', 'Button toggles to Collapse All when all groups are expanded');
    assert.ok(out.htmlExpanded.includes('data-override-group-child') && out.htmlExpanded.includes('1.75 FTE'), 'Expanding reveals per-department overridden FTE values');
    assert.equal(out.labelReCollapsed, 'Expand All', 'Clicking Collapse All collapses all groups back');
    assert.ok(!out.htmlReCollapsed.includes('data-override-group-child'), 'Department sub-rows are hidden again after Collapse All');

    assert.equal(out.engW32Still, 4.0, 'Resetting ENG W33 slice preserves ENG W32');
    assert.equal(out.engW33Gone, true, 'Resetting ENG W33 slice removes ENG W33');
    assert.equal(out.engW34Still, 4.0, 'Resetting ENG W33 slice preserves ENG W34');
    assert.ok(out.w33AfterOne && out.w33AfterOne.isPartial && out.w33AfterOne.items.length === 3, 'With 3/4 depts remaining at 50%, W33 stays grouped as partial Company Holiday (3/4 depts)');
    assert.equal(out.afterSliceResetCompanies, 2, 'Dropping below majority (2/4) cleanly ungroups W33 while leaving W40 and W52-W53 grouped');
    assert.equal(out.shutdownRemaining, false, 'resetCompanyOverrideGroup removes all dept overrides across W52-W53');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Per-dept Start/End capacity overrides with dates, unified Roadmap Cap modal (Holiday + Dept FTE), and Light Mode contrast CSS', () => {
  assert.ok(!html.includes('id="btnAddCapacityOverride"'), 'Generic Add Override button linked to first dept is removed from Setup panel');
  assert.ok(html.includes('html:not(.dark) body') && html.includes('--surface-page: #e8eef6'), 'Light Mode contrast & depth tokens are compiled into index.html');

  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set();
      const el = makeStubEl();
      el.id = id;
      el.clientWidth = 1400;
      el.options = [];
      el.dataset = {};
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      liveDB = createSampleDemoDB();
      liveDB.capacityOverrides = {};
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.timeUnit = 'week';
      ui.startWeek = '2026-W47';
      ui.horizon = 4;
      ui.axis = 'department';
      window.innerWidth = 1440;

      // 1. Roadmap column header uses Cap -> openPeriodCapacityModal (not Hol%)
      renderMatrix();
      const matrixHtml = document.getElementById('matrixWrapper').innerHTML;

      // 2. Per-department openCapacityModal has Start & End pickers showing calendar dates + saves range
      openCapacityModal('d_des', '2026-W47', { forceWeeks: true, endPeriod: '2026-W49' });
      const capModalHtml = document.getElementById('modalCard').innerHTML;
      document.getElementById('mCapDept').value = 'd_des';
      document.getElementById('mCapUnit').value = 'week';
      document.getElementById('mCapStart').value = '2026-W47';
      document.getElementById('mCapEnd').value = '2026-W49';
      document.getElementById('mCapValue').value = '1.5';
      saveCapacityModal();
      const desSaved = [
        liveDB.capacityOverrides['d_des::2026-W47'],
        liveDB.capacityOverrides['d_des::2026-W48'],
        liveDB.capacityOverrides['d_des::2026-W49'],
        liveDB.capacityOverrides['d_des::2026-W50'],
      ];

      // 3. Unified openPeriodCapacityModal supports both Company Holiday/% AND Dept FTE Override
      openPeriodCapacityModal('2026-W50', { forceWeeks: true });
      const periodCapHtml = document.getElementById('modalCard').innerHTML;
      setPeriodCapacityModalMode('dept');
      document.getElementById('mHolDeptSelect').value = 'd_ops';
      document.getElementById('mHolTimeUnit').value = 'week';
      document.getElementById('mHolStart').value = '2026-W50';
      document.getElementById('mHolEnd').value = '2026-W51';
      document.getElementById('mHolDeptFte').value = '5.0';
      applyPeriodDeptCapacityModal();
      const opsSaved = [
        liveDB.capacityOverrides['d_ops::2026-W50'],
        liveDB.capacityOverrides['d_ops::2026-W51'],
      ];

      // 4. Period select options include calendar date ranges alongside week numbers
      const wkOpts = buildPeriodSelectOptions('2026-W47', 'week', 0, 2);
      return { matrixHtml, capModalHtml, desSaved, periodCapHtml, opsSaved, wkOptLabel: wkOpts[0].label };
    })()`, ctx);

    assert.ok(out.matrixHtml.includes("openPeriodCapacityModal('2026-W47')") && out.matrixHtml.includes('>Cap</button>'), 'Roadmap column hover shows general Cap button calling openPeriodCapacityModal');
    assert.ok(!out.matrixHtml.includes('>Hol%</button>'), 'Old Hol%-only button label replaced by Cap');
    assert.ok(out.capModalHtml.includes('id="mCapStart"') && out.capModalHtml.includes('id="mCapEnd"') && out.capModalHtml.includes('16–22 Nov'), 'Capacity modal lets user pick both Start and End with calendar dates');
    assert.deepEqual([...out.desSaved], [1.5, 1.5, 1.5, undefined], 'saveCapacityModal applies exact Start..End weekly span');
    assert.ok(out.periodCapHtml.includes('Company Holiday / %') && out.periodCapHtml.includes('Dept FTE Override'), 'Unified Cap modal lets user define either a company holiday or momentary dept FTE override');
    assert.deepEqual([...out.opsSaved], [5.0, 5.0], 'applyPeriodDeptCapacityModal applies momentary department FTE across Start..End');
    assert.ok(out.wkOptLabel.includes('W47') && out.wkOptLabel.includes('16–22 Nov'), 'buildPeriodSelectOptions shows calendar date range alongside ISO week');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Sync write queue, self-write lastWriteId cloud drift absorption, and 3-way buffered auto-merge vs true collision', async () => {
  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set(['hidden']);
      const el = makeStubEl();
      el.id = id;
      el.options = [];
      el.dataset = {};
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = await vm.runInContext(`(async () => {
      liveDB = createSampleDemoDB();
      liveDB.allocations = { 'd_eng::p_nova::2026-W48': 2.0, 'd_des::p_atlas::2026-W48': 1.0 };
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.userName = 'MFO';
      ui.autoSaveToFile = true;
      ui.autoReloadFromFile = true;

      let diskJson = JSON.stringify(liveDB);
      let diskMtime = 10000;
      let writeCount = 0;

      linkedFileHandle = {
        name: 'pulseplan_company_roadmap.json',
        getFile: async () => ({
          name: 'pulseplan_company_roadmap.json',
          lastModified: diskMtime,
          size: diskJson.length,
          text: async () => diskJson,
        }),
        createWritable: async () => ({
          write: async (txt) => { diskJson = String(txt); },
          close: async () => { writeCount++; diskMtime += 1000; },
        }),
      };

      // Initial write establishes lastWrittenId & lastSyncedSnapshot
      lastKnownFileModified = diskMtime;
      lastSyncedSnapshot = cloneSyncSnapshot(liveDB);
      await writeDBToLinkedFile();
      const firstWriteId = lastWrittenId;
      const writesAfterInit = writeCount;

      // 1. Simulate Google Drive / OneDrive bumping mtime +3000ms after uploading our OWN save
      diskMtime += 3000;
      await checkExternalFileUpdates();
      const bannerHiddenAfterSelfDrift = document.getElementById('externalUpdateBanner').classList.contains('hidden');
      const mtimeAbsorbedByPoll = lastKnownFileModified === diskMtime;

      // Another cloud drift + quick local edit -> zero conflict, saves cleanly!
      diskMtime += 2500;
      liveDB.allocations['d_eng::p_nova::2026-W48'] = 2.5;
      await writeDBToLinkedFile();
      const conflictAfterSelfDrift = !document.getElementById('modalOverlay').classList.contains('hidden');
      const parsedAfterSelfEdit = JSON.parse(diskJson);

      // 2. Simulate concurrent edit on DIFFERENT cell by another device/tab (d_des::p_atlas) while local edits d_eng::p_nova
      const extObj = JSON.parse(diskJson);
      extObj.meta.revision = (extObj.meta.revision || 1) + 1;
      extObj.meta.lastWriteId = 'w_other_device_1';
      extObj.meta.lastModifiedBy = 'Alice';
      extObj.allocations['d_des::p_atlas::2026-W48'] = 1.75;
      diskJson = JSON.stringify(extObj);
      diskMtime += 4000;

      liveDB.allocations['d_eng::p_nova::2026-W48'] = 3.0;
      await writeDBToLinkedFile();
      const conflictAfterDisjoint = !document.getElementById('modalOverlay').classList.contains('hidden');
      const mergedOnDisk = JSON.parse(diskJson);

      // 3. Simulate TRUE collision on the SAME cell (d_eng::p_nova::2026-W48)
      const colObj = JSON.parse(diskJson);
      colObj.meta.revision = (colObj.meta.revision || 1) + 1;
      colObj.meta.lastWriteId = 'w_other_device_2';
      colObj.meta.lastModifiedBy = 'MFO';
      colObj.allocations['d_eng::p_nova::2026-W48'] = 4.0;
      diskJson = JSON.stringify(colObj);
      diskMtime += 4000;

      liveDB.allocations['d_eng::p_nova::2026-W48'] = 0.75;
      await writeDBToLinkedFile();
      const conflictOpenedOnCollision = !document.getElementById('modalOverlay').classList.contains('hidden');
      const conflictModalHtml = document.getElementById('modalCard').innerHTML;

      // Clean up global sync handles
      closeModal();
      linkedFileHandle = null;
      lastKnownFileModified = 0;
      lastWrittenId = '';
      lastSyncedSnapshot = null;
      saveQueued = false;

      return {
        firstWriteId, writesAfterInit, bannerHiddenAfterSelfDrift, mtimeAbsorbedByPoll,
        conflictAfterSelfDrift,
        selfEditVal: parsedAfterSelfEdit.allocations['d_eng::p_nova::2026-W48'],
        conflictAfterDisjoint,
        mergedLocalVal: mergedOnDisk.allocations['d_eng::p_nova::2026-W48'],
        mergedDiskVal: mergedOnDisk.allocations['d_des::p_atlas::2026-W48'],
        conflictOpenedOnCollision, conflictModalHtml,
      };
    })()`, ctx);

    assert.ok(out.firstWriteId && out.firstWriteId.startsWith('w_'), 'Write stamps unique meta.lastWriteId');
    assert.equal(out.bannerHiddenAfterSelfDrift, true, 'Poll does not show reload banner on cloud timestamp drift for own writeId');
    assert.equal(out.mtimeAbsorbedByPoll, true, 'Poll absorbs cloud mtime drift cleanly');
    assert.equal(out.conflictAfterSelfDrift, false, 'Pre-write guard does not conflict with own cloud-drifted save');
    assert.equal(out.selfEditVal, 2.5, 'Local edit saves cleanly after absorbing self-write drift');
    assert.equal(out.conflictAfterDisjoint, false, 'Disjoint edits auto-merge via 3-way buffer with zero conflict modal');
    assert.equal(out.mergedLocalVal, 3.0, '3-way auto-merge preserves buffered local edit');
    assert.equal(out.mergedDiskVal, 1.75, '3-way auto-merge preserves external disk edit');
    assert.equal(out.conflictOpenedOnCollision, true, 'True same-cell collision pauses save and opens Sync Conflict modal');
    assert.ok(out.conflictModalHtml.includes('Another tab or device signed in with your name'), 'Same-user collision copy clearly indicates another tab/device');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Admin (Non-FTE) project category logs issues & meetings across periods with zero FTE impact', () => {
  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set(['hidden']);
      const el = makeStubEl();
      el.id = id;
      el.clientWidth = 1440;
      el.options = [];
      el.dataset = {};
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = vm.runInContext(`(() => {
      liveDB = createSampleDemoDB();
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.timeUnit = 'week';
      ui.startWeek = '2026-W48';
      ui.horizon = 4;
      ui.filterDept = 'all';
      ui.filterProj = 'all';
      ui.matrixSearch = '';
      ui.compactRowLabels = false;
      ui.cellColorMode = 'fte3';
      window.innerWidth = 1440;

      // 1. Create an Admin (Non-FTE) project with alphabetically early code 'AAA' to verify bottom sorting
      openProjectModal('');
      const projModalHtml = document.getElementById('modalCard').innerHTML;
      document.getElementById('mProjId').value = '';
      document.getElementById('mProjName').value = 'Dept Issues & Meetings';
      document.getElementById('mProjCode').value = 'AAA';
      document.getElementById('mProjCategory').value = 'admin';
      document.getElementById('mProjStatus').value = 'Active';
      document.getElementById('mProjPriority').value = 'High';
      document.getElementById('mProjOwner').value = 'MFO';
      document.getElementById('mProjColor').value = '#0ea5e9';
      document.getElementById('mProjBudget').value = '999';
      document.getElementById('mProjBudgetCost').value = '50000';
      document.getElementById('mProjArchived').checked = false;
      saveProjectModal();

      const adminProj = liveDB.projects.find(p => p.code === 'AAA');
      const sortedCodes = getSortedProjects(liveDB).map(p => p.code);
      const optLabel = formatProjectOptionLabel(adminProj);

      // Measure baseline ENG load in W48 before logging Admin note
      const fteBefore = getDeptTotalAllocatedFte('d_eng', '2026-W48', 'week', liveDB);

      // 2. Log Admin Issues & Meetings across 2 consecutive weeks (W48 & W49) via openAllocationModal (zero FTE required)
      openAllocationModal('d_eng', adminProj.id, '2026-W48');
      const allocModalHtml = document.getElementById('modalCard').innerHTML;
      document.getElementById('mAllocDept').value = 'd_eng';
      document.getElementById('mAllocProj').value = adminProj.id;
      document.getElementById('mAllocPeriod').value = '2026-W48';
      document.getElementById('mAllocValue').value = ''; // No FTE needed!
      document.getElementById('mAllocComment').value = 'Server audit risk; Q4 architecture review meeting requested';
      document.getElementById('mAllocRepeat').value = '2';
      saveAllocationModal();

      const fteAfter = getDeptTotalAllocatedFte('d_eng', '2026-W48', 'week', liveDB);
      const projFte = getProjTotalAllocatedFte(adminProj.id, '2026-W48', 'week', liveDB);
      const hasAllocKey = Object.keys(liveDB.allocations).some(k => k.includes('::' + adminProj.id + '::'));
      const noteW48 = liveDB.comments['d_eng::' + adminProj.id + '::2026-W48'];
      const noteW49 = liveDB.comments['d_eng::' + adminProj.id + '::2026-W49'];

      // 3. Render Desktop By Dept, Timeline/Gantt, By Project, 12-wk Overview (all in solid-fill fte3 mode!) + Mobile Timeline/By Dept + Setup
      ui.axis = 'department'; renderMatrix();
      const deptHtml = document.getElementById('matrixWrapper').innerHTML;
      ui.axis = 'timeline'; renderMatrix();
      const tlHtml = document.getElementById('matrixWrapper').innerHTML;
      ui.axis = 'project'; renderMatrix();
      const projHtml = document.getElementById('matrixWrapper').innerHTML;
      ui.horizon = 12; ui.axis = 'department'; renderMatrix();
      const ovHtml = document.getElementById('matrixWrapper').innerHTML;
      ui.horizon = 4;

      // Mobile Timeline & Mobile By Dept rendering
      ui.axis = 'timeline';
      ui.mobileSelectedPeriod = '2026-W48';
      renderMobileMatrixCards();
      const mobTlHtml = document.getElementById('mobileMatrixDeck').innerHTML;
      ui.axis = 'department';
      renderMobileMatrixCards();
      const mobDeptHtml = document.getElementById('mobileMatrixDeck').innerHTML;

      // Setup -> Projects list order & hashed swatch
      renderDataTab();
      const setupProjHtml = document.getElementById('dataProjectsBody').innerHTML;

      const briefing = buildExecutiveBriefingText(liveDB);

      return {
        adminProj, sortedCodes, projModalHtml, optLabel, allocModalHtml,
        fteBefore, fteAfter, projFte, hasAllocKey, noteW48, noteW49,
        deptHtml, tlHtml, projHtml, ovHtml, mobTlHtml, mobDeptHtml, setupProjHtml, briefing,
      };
    })()`, ctx);

    assert.ok(out.projModalHtml.includes('value="admin"') && out.projModalHtml.includes('Admin (Non-FTE)'), 'Project modal offers Admin (Non-FTE) category');
    assert.equal(out.adminProj.nonFte, true, 'Admin project sets nonFte = true');
    assert.equal(out.adminProj.category, 'admin', 'Admin project sets category = admin');
    assert.equal(out.adminProj.budgetDays, 0, 'Admin project ignores FTE effort budget');
    assert.equal(out.adminProj.budgetCost, 0, 'Admin project ignores cost budget');
    assert.equal(out.sortedCodes[out.sortedCodes.length - 1], 'AAA', 'Admin project sorts strictly at the bottom of projects list even with code AAA');
    assert.ok(out.optLabel.includes('(Admin · Non-FTE)'), 'Project dropdown label tags Admin (Non-FTE)');
    assert.ok(out.allocModalHtml.includes('Admin — Issues &amp; Meetings') && out.allocModalHtml.includes('No FTE required'), 'Allocation modal adapts to Admin Note mode without requiring FTE');
    assert.equal(out.fteAfter, out.fteBefore, 'Admin notes have strictly zero impact on department FTE utilisation');
    assert.equal(out.projFte, 0, 'Admin project total FTE is always 0');
    assert.equal(out.hasAllocKey, false, 'Saving Admin notes writes zero entries into db.allocations');
    assert.ok(out.noteW48.includes('Server audit risk') && out.noteW49.includes('Server audit risk'), 'Admin notes repeat cleanly across selected weeks');
    assert.ok(out.deptHtml.includes('admin-hashed-card') && out.deptHtml.includes('Server audit risk'), 'By Dept renders Admin card with hashed styling (never solid colour) even in 3-Level mode');
    assert.ok(out.tlHtml.includes('admin-hashed-bar timeline-bar-start') && out.tlHtml.includes('admin-hashed-bar timeline-bar-end') && out.tlHtml.includes('admin-row-divider'), 'Desktop Timeline/Gantt populates continuous hashed Admin spans at the bottom with divider');
    assert.ok(out.projHtml.includes('admin-hashed-card') && out.projHtml.includes('admin-row-divider') && out.projHtml.includes('Admin Notes'), 'By Project renders hashed Admin cards and bottom divider');
    assert.ok(out.ovHtml.includes('admin-hashed-chip') && out.ovHtml.includes('AAA') && out.ovHtml.includes('&#9998;'), '12-period Simplified Overview surfaces hashed Admin note chips');
    assert.ok(out.mobTlHtml.includes('admin-hashed-bar') && out.mobTlHtml.includes('2 notes') && out.mobTlHtml.includes('admin-hashed-swatch'), 'Mobile Timeline/Gantt populates Admin project with hashed bars and note count');
    assert.ok(out.mobDeptHtml.includes('admin-hashed-card') && out.mobDeptHtml.includes('Server audit risk'), 'Mobile By Dept renders Admin card with hashed styling instead of solid fill');
    assert.ok(out.setupProjHtml.includes('admin-hashed-swatch') && out.setupProjHtml.includes('admin-row-divider'), 'Setup -> Projects renders Admin project at the bottom with hashed swatch and divider');
    assert.ok(out.briefing.includes('ADMIN — DEPT ISSUES & REQUESTED MEETINGS:') && out.briefing.includes('Server audit risk'), 'Executive Briefing groups Admin issues & meetings in its own section');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('Resilient holiday grouping, Project Technical Lead, Dedicated Milestones lane in By Dept, Desktop PDF Save-to-Disk, and Sync Backup-to-Folder', async () => {
  assert.ok(html.includes('id="btnBackupConnectedToFolder"'), 'Sync & Snapshots exposes Backup to Folder button');
  assert.ok(html.includes('>Technical Lead</th>'), 'Setup -> Projects table includes Technical Lead column');

  const prevGetById = sandbox.document.getElementById;
  const elMap = new Map();
  sandbox.document.getElementById = (id) => {
    if (!elMap.has(id)) {
      const classes = new Set(['hidden']);
      const el = makeStubEl();
      el.id = id;
      el.clientWidth = 1440;
      el.options = [];
      el.dataset = {};
      el.classList = {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (x, f) => { if (f === undefined) { if (classes.has(x)) classes.delete(x); else classes.add(x); } else if (f) classes.add(x); else classes.delete(x); },
        contains: (x) => classes.has(x),
      };
      elMap.set(id, el);
    }
    return elMap.get(id);
  };
  try {
    const out = await vm.runInContext(`(async () => {
      liveDB = createSampleDemoDB();
      liveDB.capacityOverrides = {};
      ui.demoMode = false;
      ui.whatIfMode = false;
      ui.timeUnit = 'week';
      ui.startWeek = '2026-W48';
      ui.horizon = 4;
      ui.filterDept = 'all';
      ui.filterProj = 'all';
      ui.matrixSearch = '';
      ui.compactRowLabels = false;
      window.innerWidth = 1440;

      // 1. Resilient Company-Wide Holiday & Shutdown Grouping:
      // Apply 0% shutdown on original 4 depts, then add a 0-FTE dept AND a newly added active dept (no overrides in W52!)
      applyHolidayFactor(liveDB.departments.map(d => d.id), '2026-W52', 2, 'week', 0, liveDB);
      liveDB.departments.push({ id: 'd_zero', name: 'Zero Cap', code: 'ZRO', color: '#64748b', defaultCapacity: 0, manager: '', dayRate: 0 });
      liveDB.departments.push({ id: 'd_new', name: 'New Team', code: 'NEW', color: '#14b8a6', defaultCapacity: 2.0, manager: '', dayRate: 0 });
      // Also test tiny dept rounding edge case (0.25 FTE at 90% -> rounds to 0.25 = baseFte) while other 4 depts drop to 90%
      liveDB.departments.push({ id: 'd_tiny', name: 'Tiny Lab', code: 'TNY', color: '#f97316', defaultCapacity: 0.25, manager: '', dayRate: 0 });
      applyHolidayFactor(liveDB.departments.map(d => d.id), '2026-W50', 1, 'week', 90, liveDB);
      // And give d_new a boost (+1 FTE) during W52 shutdown so boosted dept stays separate while 4 depts remain grouped!
      liveDB.capacityOverrides['d_new::2026-W52'] = 3.0;

      const structured = getStructuredCapacityOverrides(liveDB, 'all');
      const w52Group = structured.find(e => e.kind === 'company' && e.startWk === '2026-W52');
      const w50Group = structured.find(e => e.kind === 'company' && e.startWk === '2026-W50');
      const newBoostSeparate = structured.some(e => e.kind === 'dept' && e.deptId === 'd_new' && e.startWk === '2026-W52');

      // 2. Project Technical Lead end-to-end
      openProjectModal('p_nova');
      const projModalHtml = document.getElementById('modalCard').innerHTML;
      document.getElementById('mProjId').value = 'p_nova';
      document.getElementById('mProjName').value = 'Project Nova (Core Platform)';
      document.getElementById('mProjCode').value = 'NVA';
      document.getElementById('mProjCategory').value = 'standard';
      document.getElementById('mProjStatus').value = 'Active';
      document.getElementById('mProjPriority').value = 'High';
      document.getElementById('mProjOwner').value = 'S. Chen';
      document.getElementById('mProjTechLead').value = 'Dr. K. Patel';
      document.getElementById('mProjColor').value = '#4f46e5';
      document.getElementById('mProjBudget').value = '700';
      document.getElementById('mProjBudgetCost').value = '450000';
      document.getElementById('mProjArchived').checked = false;
      saveProjectModal();

      const updatedNova = liveDB.projects.find(p => p.id === 'p_nova');
      const migratedBack = normalizeAndMigrateDB(JSON.parse(JSON.stringify(liveDB)));
      const migratedNovaLead = migratedBack.projects.find(p => p.id === 'p_nova')?.techLead;
      renderDataTab();
      const setupProjHtml = document.getElementById('dataProjectsBody').innerHTML;
      ui.axis = 'project';
      ui.matrixSearch = 'Patel';
      renderMatrix();
      const searchByLeadHtml = document.getElementById('matrixWrapper').innerHTML;
      ui.matrixSearch = '';

      // 3. Dedicated Milestones field in By Department view (Desktop & Mobile)
      liveDB.milestones = [
        { id: 'ms_test1', title: 'Alpha Freeze Gate', projectId: 'p_nova', deptId: 'd_eng', baselineDate: '2026-11-25', date: '2026-11-25', status: 'Pending', notes: '' },
      ];
      ui.axis = 'department';
      renderMatrix();
      const deptMatrixHtml = document.getElementById('matrixWrapper').innerHTML;
      const msRowIdx = deptMatrixHtml.indexOf('data-row-id="__MILESTONES__"');
      const engRowIdx = deptMatrixHtml.indexOf('data-row-id="d_eng"');
      const engRowSlice = engRowIdx >= 0 ? deptMatrixHtml.slice(engRowIdx, deptMatrixHtml.indexOf('</tr>', engRowIdx)) : '';
      const msInDedicatedRow = msRowIdx >= 0 && deptMatrixHtml.slice(msRowIdx, engRowIdx).includes('Alpha Freeze Gate');
      const msInDeptCell = engRowSlice.includes('Alpha Freeze Gate');

      // Drag milestone inside dedicated __MILESTONES__ lane to W49 -> reschedules date while preserving deptId!
      activeDragPayload = { type: 'milestone', msId: 'ms_test1', periodKey: '2026-W48' };
      handleCellDrop({ preventDefault: () => {}, currentTarget: { classList: { remove: () => {} } }, altKey: false }, '__MILESTONES__', '2026-W49');
      const msAfterDrag = { ...liveDB.milestones[0] };

      // Mobile By Department dedicated milestones card
      ui.mobileSelectedPeriod = '2026-W49';
      renderMobileMatrixCards();
      const mobDeptHtml = document.getElementById('mobileMatrixDeck').innerHTML;
      const mobHasDedicatedMs = mobDeptHtml.includes('data-mobile-milestones-field="1"') && mobDeptHtml.includes('Alpha Freeze Gate');

      // 4. Desktop PDF Export Save-to-Disk option (no Web Share hijack on desktop)
      let savedPdfBytes = 0;
      let sharedCalled = false;
      window.showSaveFilePicker = async (pickerOpts) => ({
        name: pickerOpts.suggestedName,
        createWritable: async () => ({
          write: async (b) => { savedPdfBytes = b.size || String(b).length; },
          close: async () => {},
        }),
      });
      navigator.share = async () => { sharedCalled = true; };
      navigator.canShare = () => true;
      openExportPdfModal();
      const pdfModalHtml = document.getElementById('modalCard').innerHTML;
      // Verify PDF period count selector honors explicit count (e.g., 12 weeks even when screen ui.horizon is 4) and updates live preview
      const pdfMatchPeriods = getPdfExportPeriods({ periodCount: 'match' });
      const pdf12Periods = getPdfExportPeriods({ periodCount: 12 });
      const pdf6Periods = getPdfExportPeriods({ periodCount: '6' });
      document.getElementById('mPdfPeriodCount').value = '12';
      document.getElementById('mPdfColsPerPage').value = '4';
      syncPdfHorizonSummary();
      const pdfPreviewTxt = document.getElementById('mPdfHorizonSummary').textContent;
      const pdfDiskOutcome = await shareOrDownloadFile({ size: 14, type: 'application/pdf' }, 'report.pdf', 'application/pdf', 'Report', { mode: 'disk' });

      // 5. Sync & Snapshots Backup Connected File to Folder
      let backupDirPicked = false;
      let backupFilename = '';
      let backupWrittenText = '';
      linkedFileHandle = {
        name: 'company_plan.json',
        getFile: async () => ({ text: async () => JSON.stringify(liveDB) }),
      };
      window.showDirectoryPicker = async () => {
        backupDirPicked = true;
        return {
          name: 'PulsePlan_Backups',
          getFileHandle: async (fname) => {
            backupFilename = fname;
            return {
              createWritable: async () => ({
                write: async (txt) => { backupWrittenText = String(txt); },
                close: async () => {},
              }),
            };
          },
        };
      };
      await backupConnectedJsonToFolder();
      const linkedStillIntact = linkedFileHandle && linkedFileHandle.name === 'company_plan.json';
      const lastDump = liveDB.dumpHistory[0];

      // Cleanup mocks
      linkedFileHandle = null;
      delete window.showSaveFilePicker;
      delete window.showDirectoryPicker;
      delete navigator.share;
      delete navigator.canShare;
      closeModal();

      return {
        w52Group, w50Group, newBoostSeparate,
        projModalHtml, updatedNovaLead: updatedNova?.techLead, migratedNovaLead,
        setupProjHtml, searchByLeadHtml,
        msRowIdx, engRowIdx, msInDedicatedRow, msInDeptCell, msAfterDrag, mobHasDedicatedMs,
        pdfModalHtml, pdfMatchLen: pdfMatchPeriods.length, pdf12Len: pdf12Periods.length, pdf6Len: pdf6Periods.length, pdfPreviewTxt,
        pdfDiskOutcome, savedPdfBytes, sharedCalled,
        backupDirPicked, backupFilename, backupWrittenLen: backupWrittenText.length,
        backupHasTechLead: backupWrittenText.includes('Dr. K. Patel'),
        linkedStillIntact, lastDump,
      };
    })()`, ctx);

    assert.ok(out.w52Group && out.w52Group.items.length === 4 && out.w52Group.isPartial, 'W52 shutdown stays grouped even with 0-FTE dept, newly added dept, and boosted dept');
    assert.equal(out.newBoostSeparate, true, 'Boosted dept in W52 stays separate as its own dept row alongside the grouped shutdown');
    assert.ok(out.w50Group && out.w50Group.items.length >= 5, '90% holiday groups cleanly even when 0.25-FTE tiny dept rounds back to base');

    assert.ok(out.projModalHtml.includes('id="mProjTechLead"') && out.projModalHtml.includes('Technical Lead'), 'Project modal includes Technical Lead field');
    assert.equal(out.updatedNovaLead, 'Dr. K. Patel', 'saveProjectModal saves Technical Lead');
    assert.equal(out.migratedNovaLead, 'Dr. K. Patel', 'normalizeAndMigrateDB preserves Technical Lead');
    assert.ok(out.setupProjHtml.includes('Dr. K. Patel'), 'Setup -> Projects renders Technical Lead');
    assert.ok(out.searchByLeadHtml.includes('TL: Dr. K. Patel') && out.searchByLeadHtml.includes('Project Nova'), 'Roadmap Detailed row label displays Technical Lead and search matches it');

    assert.ok(out.msRowIdx >= 0 && out.msRowIdx < out.engRowIdx, 'Dedicated Milestones row renders at top of By Department matrix');
    assert.equal(out.msInDedicatedRow, true, 'Milestone appears inside dedicated Milestones lane');
    assert.equal(out.msInDeptCell, false, 'Milestone is no longer rendered inside individual department cell in By Department view');
    assert.equal(out.msAfterDrag.deptId, 'd_eng', 'Dragging milestone within dedicated Milestones lane preserves its deptId');
    assert.ok(out.msAfterDrag.date.startsWith('2026-12-'), 'Dragging milestone within dedicated Milestones lane reschedules target date to W49');
    assert.equal(out.mobHasDedicatedMs, true, 'Mobile By Department view renders dedicated Milestones field');

    assert.ok(out.pdfModalHtml.includes('id="mPdfDelivery"') && out.pdfModalHtml.includes('Save to Disk'), 'PDF Export modal exposes Desktop Save-to-Disk option');
    assert.ok(out.pdfModalHtml.includes('id="mPdfPeriodCount"') && out.pdfModalHtml.includes('Periods in Report'), 'PDF Export modal exposes Periods in Report selector');
    assert.equal(out.pdfMatchLen, 4, 'getPdfExportPeriods("match") mirrors active 4-week view');
    assert.equal(out.pdf6Len, 6, 'getPdfExportPeriods("6") generates 6 periods even when screen horizon is 4');
    assert.equal(out.pdf12Len, 12, 'getPdfExportPeriods(12) generates 12 periods even when screen horizon is 4');
    assert.ok(out.pdfPreviewTxt.includes('12 weeks') && out.pdfPreviewTxt.includes('3 matrix pages') && out.pdfPreviewTxt.includes('4 cols/page'), 'Live PDF preview accurately computes periods and page split');
    assert.equal(out.pdfDiskOutcome, 'saved', 'PDF Save-to-Disk writes directly via showSaveFilePicker');
    assert.ok(out.savedPdfBytes > 0 && out.sharedCalled === false, 'Desktop PDF save writes bytes to disk without calling Web Share');

    assert.equal(out.backupDirPicked, true, 'Backup to Folder prompts via showDirectoryPicker');
    assert.ok(out.backupFilename.startsWith('company_plan_backup_') && out.backupFilename.endsWith('.json'), 'Backup creates timestamped JSON filename based on connected file');
    assert.ok(out.backupWrittenLen > 500 && out.backupHasTechLead, 'Backup writes full live JSON payload');
    assert.equal(out.linkedStillIntact, true, 'Creating folder backup leaves active live sync link untouched');
    assert.ok(out.lastDump && out.lastDump.format === 'BACKUP' && out.lastDump.filename.includes('PulsePlan_Backups/'), 'Folder backup is recorded in Rolling Dump History');
  } finally {
    sandbox.document.getElementById = prevGetById;
  }
});

test('PBS v2 optional engineering/procurement/documentation fields: schema, SWaP roll-ups, search, CSV, clone, SVG, unified wide PDF & sticky table', () => {
  const out = vm.runInContext(`(() => {
    const P = globalThis.__ppPbsV2;
    const db = {
      departments: [
        { id: 'd_elec', code: 'ELC', name: 'Electronics', color: '#4f46e5' },
        { id: 'd_mech', code: 'MCH', name: 'Mechanical', color: '#059669' },
      ],
      milestones: [
        { id: 'm_cdr', projectId: 'p_sat', title: 'CDR Freeze', date: '2026-09-01', status: 'Pending' },
      ],
    };
    const project = { id: 'p_sat', code: 'SAT', name: 'Orbital Bus', color: '#4f46e5' };

    // 1. Legacy PBS doc normalizes cleanly with empty optional fields
    const legacyDoc = P.data.normalizePbsDoc({
      schema: 'pulseplan-pbs-v1',
      items: [
        { id: 'i_leg', parentId: null, code: '1', name: 'Legacy Payload', deptId: 'd_elec', owner: 'Ada', maturity: 'PDR', milestoneId: 'm_cdr', notes: 'Baseline note' },
      ],
    }, project, 'Tester');
    const legacyCounts = P.data.countOptionalFields(legacyDoc.items[0]);
    const legacyRollups = P.tree.computeSwpRollups(legacyDoc);
    const legacyModel = P.report.buildReportModel(legacyDoc, project, db, 'Tester', '2026-11-26');
    const legacyPrintHtml = P.report.buildPrintHtml(legacyModel);
    const legacySvg = P.report.buildSvg(legacyDoc, project, db, '2026-11-26');

    // 2. Full PBS doc with all 18 optional fields + parent/child hierarchy for roll-ups
    const fullDoc = P.data.normalizePbsDoc({
      schema: 'pulseplan-pbs-v1',
      meta: { revision: 3 },
      items: [
        {
          id: 'i_root', parentId: null, code: '1', name: 'Avionics Bay', deptId: 'd_elec', owner: 'Ada',
          maturity: 'CDR', milestoneId: 'm_cdr', notes: 'Qualification pending',
          acronym: 'AVB', heritage: 'update', description: 'Main flight avionics assembly',
        },
        {
          id: 'i_psu', parentId: 'i_root', code: '1.1', name: 'Power Supply Unit', deptId: 'd_elec', owner: 'Bob',
          maturity: 'Qualified', milestoneId: 'm_cdr', notes: 'Tested at -40C..+85C',
          acronym: 'PSU', description: '28V regulated isolated DC-DC converter', heritage: 'New',
          mechDrawing: 'DWG-M-101 Rev C', elecDrawing: 'DWG-E-204 Rev B', refDoc: 'ICD-PWR-009',
          manufacturer: 'Vicor', partNumber: 'DCM3623T50M53C2T00', procurementStatus: 'Ordered',
          mass: '1.25', powerConsumption: 45, powerDissipation: 8.5, mtbf: '50,000',
          lru: true, spareAvailable: false, spareToDeliver: 'yes',
          leadTime: '14', componentAlt: 'XP Power QHL400',
        },
        {
          id: 'i_enc', parentId: 'i_root', code: '1.2', name: 'Alu Enclosure', deptId: 'd_mech', owner: 'Cara',
          maturity: 'Delivered', milestoneId: '', notes: '',
          acronym: 'ENC', heritage: 'Existing', mechDrawing: 'DWG-M-102 Rev A',
          manufacturer: 'ProtoFab', partNumber: 'PF-8820', procurementStatus: 'In Stock',
          mass: 2.1, powerConsumption: 0, powerDissipation: 0, mtbf: -50,
          lru: 'No', spareAvailable: 'Yes', spareToDeliver: 'No', leadTime: 6,
        },
      ],
    }, project, 'Tester');

    const psu = fullDoc.items[1];
    const enc = fullDoc.items[2];
    const psuCounts = P.data.countOptionalFields(psu);
    const rollups = P.tree.computeSwpRollups(fullDoc);
    const rootSub = rollups.byId.get('i_root');

    // 3. Conflict diff catches optional field mutations
    const remoteDoc = JSON.parse(JSON.stringify(fullDoc));
    remoteDoc.items[1].partNumber = 'DCM3623-REV2';
    const diff = P.data.computeConflictDiff(fullDoc, remoteDoc);

    // 4. Search matches optional fields (acronym, P/N, manufacturer, drawing, alternative)
    const searchByPn = P.tree.getFilteredTreeRows(fullDoc, { search: 'DCM3623' }, new Set());
    const searchByDwg = P.tree.getFilteredTreeRows(fullDoc, { search: 'DWG-M-102' }, new Set());
    const searchByAlt = P.tree.getFilteredTreeRows(fullDoc, { search: 'QHL400' }, new Set());

    // 5. CSV export & header-mapped round-trip + legacy 8-col import + aliased Excel headers with units
    const csvOut = P.io.buildPbsCsv(fullDoc, db);
    const csvRoundTrip = P.io.parsePbsCsv(csvOut, db);
    const legacyCsv = 'Code,ParentCode,Name,Maturity,Department,Owner,Milestone,Notes\\r\\n1,,Root Legacy,PDR,ELC,Ada,CDR Freeze,Keep clean\\r\\n';
    const legacyParsed = P.io.parsePbsCsv(legacyCsv, db);
    const excelCsv = 'Code,Name,Acronym,Existing/Update/New,Mass,Power Consumption,SPARE to be delivered (yes/no),Lead time,LRU\\r\\n1,Sensor Box,SNS,New,2.5 kg,18 W,Yes,10 wks,badval\\r\\n';
    const excelParsed = P.io.parsePbsCsv(excelCsv, db);

    // 6. Clone preserves hardware specs & resets milestoneId, procurementStatus, spareAvailable
    const cloned = P.io.cloneItems(fullDoc);
    const clonedPsu = cloned.find(x => x.code === '1.1');

    // 7. SVG diagram + single unified PDF report (A4 legacy / A3 moderate / Wide full) + Print HTML
    const fullSvg = P.report.buildSvg(fullDoc, project, db, '2026-11-26');
    const medDoc = P.data.normalizePbsDoc({
      schema: 'pulseplan-pbs-v1',
      items: [{
        id: 'i_med', parentId: null, code: '1', name: 'Transponder', deptId: 'd_elec', owner: 'Ada', maturity: 'CDR',
        acronym: 'TXP', heritage: 'New', manufacturer: 'Thales', partNumber: 'TX-400', mass: 1.8, powerConsumption: 22,
      }],
    }, project, 'Tester');
    const medModel = P.report.buildReportModel(medDoc, project, db, 'Tester', '2026-11-26');
    const fullModel = P.report.buildReportModel(fullDoc, project, db, 'Tester', '2026-11-26');
    const fullPrintHtml = P.report.buildPrintHtml(fullModel);

    function runMockPdf(model) {
      const tables = [];
      let ctorOpts = null;
      function MockJsPdf(opts) {
        ctorOpts = opts;
        const fmt = opts && opts.format;
        const w = Array.isArray(fmt) ? Math.max(fmt[0], fmt[1]) : (fmt === 'a3' ? 1191 : 842);
        const h = Array.isArray(fmt) ? Math.min(fmt[0], fmt[1]) : (fmt === 'a3' ? 842 : 595);
        this.internal = { pageSize: { getWidth: () => w, getHeight: () => h } };
        this.lastAutoTable = { finalY: 160 };
        this.setFillColor = () => {};
        this.rect = () => {};
        this.setTextColor = () => {};
        this.setFont = () => {};
        this.setFontSize = () => {};
        this.text = () => {};
        this.addPage = () => {};
        this.autoTable = (aOpts) => {
          tables.push({ head: aOpts.head[0], rows: aOpts.body.length, body: aOpts.body });
          this.lastAutoTable = { finalY: (aOpts.startY || 80) + aOpts.body.length * 18 + 30 };
        };
      }
      P.report.renderPdf(MockJsPdf, model);
      return { tables, ctorOpts };
    }
    const legacyPdf = runMockPdf(legacyModel);
    const medPdf = runMockPdf(medModel);
    const fullPdf = runMockPdf(fullModel);

    // 8. Unified in-app table with frozen left columns + additive column-group toggles & collapsible form
    const baseCtx = (d, opts = {}) => ({
      doc: d, db, project,
      summary: P.tree.computeMaturitySummary(d, db.milestones, '2026-06-01'),
      rollups: P.tree.computeSwpRollups(d),
      rows: P.tree.getFilteredTreeRows(d, {}, new Set()),
      collapsedIds: new Set(),
      colGroups: opts.colGroups || { docs: false, proc: false, swp: false },
      filter: { search: '', deptId: '', maturity: '', milestoneId: '' },
      edit: opts.edit || null,
      conflict: null, notices: [],
      owners: ['Ada', 'Bob'], manufacturers: ['Vicor', 'ProtoFab'], procStatuses: P.PROC_STATUS_PRESETS,
      projectMilestones: db.milestones, cloneSources: [], canDirSync: false, dirName: '', hasRemembered: false,
      status: { text: 'Saved locally', tone: 'idle' },
    });

    const sparseDoc = P.data.normalizePbsDoc({
      schema: 'pulseplan-pbs-v1',
      items: [{ id: 'i_sp', parentId: null, code: '1', name: 'Bracket', maturity: 'PDR', mass: 0.45 }],
    }, project, 'Tester');
    const sparseCols = P.view.resolveVisibleOptionalCols(sparseDoc, { docs: false, proc: false, swp: true });

    const htmlLegacy = P.view.buildDialogHtml(baseCtx(legacyDoc, { colGroups: P.view.getPopulatedGroupFlags(legacyDoc) }));
    const htmlMainOnly = P.view.buildDialogHtml(baseCtx(fullDoc, { colGroups: { docs: false, proc: false, swp: false } }));
    const htmlProcAndSwp = P.view.buildDialogHtml(baseCtx(fullDoc, { colGroups: { docs: false, proc: true, swp: true } }));
    const htmlAllPop = P.view.buildDialogHtml(baseCtx(fullDoc, { colGroups: P.view.getPopulatedGroupFlags(fullDoc) }));
    const htmlEditNew = P.view.buildDialogHtml(baseCtx(fullDoc, {
      edit: { open: true, item: null, parentId: null, suggestedCode: '2', parentCandidates: fullDoc.items, openSections: { docs: false, proc: false, eng: false } },
    }));
    const htmlEditPsu = P.view.buildDialogHtml(baseCtx(fullDoc, {
      edit: { open: true, item: psu, parentId: 'i_root', suggestedCode: '1.1', parentCandidates: [fullDoc.items[0]], openSections: { docs: true, proc: true, eng: true } },
    }));

    return {
      legacyCounts, legacyRollups, legacyModel, legacyPdf, legacyPrintHtml, legacySvg,
      medModel, medPdf,
      psu, enc, psuCounts, rollups, rootSub, diff,
      searchByPnLen: searchByPn.length, searchByDwgLen: searchByDwg.length, searchByAltLen: searchByAlt.length,
      csvOut, csvRoundTrip, legacyParsed, excelParsed,
      clonedPsu,
      fullSvg, fullModel, fullPdf, fullPrintHtml,
      sparseColKeys: sparseCols.map(c => c.key),
      htmlLegacy, htmlMainOnly, htmlProcAndSwp, htmlAllPop, htmlEditNew, htmlEditPsu,
    };
  })()`, ctx);

  // Legacy backward-compatibility & zero-clutter checks
  assert.equal(out.legacyCounts.total, 0, 'Legacy item has 0 optional fields populated');
  assert.equal(out.legacyRollups.totalMass, null, 'Legacy doc has null totalMass');
  assert.equal(out.legacyModel.head.length, 7, 'Legacy PDF keeps exact 7 main columns');
  assert.equal(out.legacyPdf.ctorOpts.format, 'a4', 'Legacy PDF uses A4 Landscape');
  assert.equal(out.legacyPdf.tables.length, 1, 'Legacy PDF renders exactly 1 unified table');
  assert.equal(out.htmlLegacy.includes('pp-pbs-sticky'), false, 'Legacy table does not enable sticky horizontal scroll');
  assert.equal(out.htmlLegacy.includes('pp-pbs-pill-swp'), false, 'Legacy summary bar shows no SWaP pills');
  assert.equal(out.htmlLegacy.includes('pp-pbs-total-row'), false, 'Legacy table hides totals footer');

  // Full 18-field normalization checks
  assert.equal(out.psuCounts.total, 18, 'PSU item has all 18 optional fields populated');
  assert.equal(out.psu.mass, 1.25, 'String numeric mass normalizes to 1.25');
  assert.equal(out.psu.mtbf, 50000, 'Comma-grouped MTBF normalizes to 50000');
  assert.equal(out.psu.lru, 'Yes', 'Boolean true normalizes to Yes');
  assert.equal(out.psu.spareAvailable, 'No', 'Boolean false normalizes to No');
  assert.equal(out.psu.spareToDeliver, 'Yes', 'Lowercase yes normalizes to Yes');
  assert.equal(out.psu.leadTime, 14, 'Lead time normalizes to 14');
  assert.equal(out.enc.powerConsumption, 0, 'Zero numeric value is preserved as 0 (not null)');
  assert.equal(out.enc.mtbf, null, 'Negative numeric MTBF is rejected to null');

  // SWaP roll-ups & descendant totals
  assert.equal(out.rollups.totalMass, 3.35, 'Total mass sums 1.25 + 2.1 = 3.35 kg');
  assert.equal(out.rollups.totalPowerConsumption, 45, 'Total power consumption sums 45 + 0 = 45 W');
  assert.equal(out.rollups.totalPowerDissipation, 8.5, 'Total power dissipation sums 8.5 + 0 = 8.5 W');
  assert.equal(out.rollups.lruCount, 1, 'Counts 1 LRU=Yes item');
  assert.equal(out.rollups.spareAvailCount, 1, 'Counts 1 SPARE Available=Yes item');
  assert.equal(out.rollups.spareDelivCount, 1, 'Counts 1 SPARE to be Delivered=Yes item');
  assert.equal(out.rootSub.descMass, 3.35, 'Empty parent rolls up descendant mass 3.35 kg');
  assert.equal(out.rootSub.descPowerCons, 45, 'Empty parent rolls up descendant power consumption 45 W');

  // Conflict diff & extended search
  assert.equal(out.diff.modifiedBoth.length, 1, 'Conflict diff detects optional partNumber edit');
  assert.equal(out.searchByPnLen, 2, 'Search by Part Number matches item plus parent context row');
  assert.equal(out.searchByDwgLen, 2, 'Search by Mechanical Drawing matches item plus parent context row');
  assert.equal(out.searchByAltLen, 2, 'Search by Component Alternative matches item plus parent context row');

  // CSV round-trip, legacy CSV, and aliased Excel headers
  assert.equal(out.csvRoundTrip.warnings.length, 0, '26-column CSV round-trip produces zero warnings');
  const rtPsu = out.csvRoundTrip.items.find(i => i.code === '1.1');
  const rtEnc = out.csvRoundTrip.items.find(i => i.code === '1.2');
  assert.equal(rtPsu.acronym, 'PSU');
  assert.equal(rtPsu.heritage, 'New');
  assert.equal(rtPsu.mechDrawing, 'DWG-M-101 Rev C');
  assert.equal(rtPsu.elecDrawing, 'DWG-E-204 Rev B');
  assert.equal(rtPsu.refDoc, 'ICD-PWR-009');
  assert.equal(rtPsu.manufacturer, 'Vicor');
  assert.equal(rtPsu.partNumber, 'DCM3623T50M53C2T00');
  assert.equal(rtPsu.procurementStatus, 'Ordered');
  assert.equal(rtPsu.mass, 1.25);
  assert.equal(rtPsu.powerConsumption, 45);
  assert.equal(rtPsu.powerDissipation, 8.5);
  assert.equal(rtPsu.mtbf, 50000);
  assert.equal(rtPsu.lru, 'Yes');
  assert.equal(rtPsu.spareAvailable, 'No');
  assert.equal(rtPsu.spareToDeliver, 'Yes');
  assert.equal(rtPsu.leadTime, 14);
  assert.equal(rtPsu.componentAlt, 'XP Power QHL400');
  assert.equal(rtEnc.powerConsumption, 0, 'CSV round-trip preserves explicit 0 W');
  assert.equal(out.legacyParsed.items.length, 1, 'Legacy 8-column CSV imports cleanly');
  assert.equal(out.legacyParsed.warnings.length, 0, 'Legacy 8-column CSV has 0 warnings');
  assert.equal(out.excelParsed.items[0].mass, 2.5, 'Excel CSV strips trailing kg unit');
  assert.equal(out.excelParsed.items[0].powerConsumption, 18, 'Excel CSV strips trailing W unit');
  assert.equal(out.excelParsed.items[0].leadTime, 10, 'Excel CSV strips trailing wks unit');
  assert.equal(out.excelParsed.items[0].spareToDeliver, 'Yes', 'Excel CSV maps aliased SPARE to be delivered header');
  assert.equal(out.excelParsed.items[0].lru, '', 'Invalid LRU value ignored cleanly');
  assert.ok(out.excelParsed.warnings.some(w => w.includes('invalid LRU')), 'Invalid LRU emits import warning');

  // Clone behavior
  assert.equal(out.clonedPsu.partNumber, 'DCM3623T50M53C2T00', 'Clone preserves hardware Part Number');
  assert.equal(out.clonedPsu.mass, 1.25, 'Clone preserves hardware Mass');
  assert.equal(out.clonedPsu.mechDrawing, 'DWG-M-101 Rev C', 'Clone preserves Mechanical Drawing');
  assert.equal(out.clonedPsu.spareToDeliver, 'Yes', 'Clone preserves contractual SPARE to be Delivered');
  assert.equal(out.clonedPsu.milestoneId, '', 'Clone resets milestoneId');
  assert.equal(out.clonedPsu.procurementStatus, '', 'Clone resets project-specific procurementStatus');
  assert.equal(out.clonedPsu.spareAvailable, '', 'Clone resets project-specific spareAvailable');

  // SVG & single unified wide PDF / Print exports
  assert.ok(out.fullSvg.includes('1.1 \u00b7 PSU'), 'SVG card header includes compact Acronym');
  assert.ok(out.fullSvg.includes('>NEW</text>') && out.fullSvg.includes('>UPD</text>'), 'SVG cards show compact heritage pills');
  assert.ok(out.fullSvg.includes('Mass 3.35 kg') && out.fullSvg.includes('Power 45 W'), 'SVG subtitle surfaces SWaP totals');
  assert.ok(out.fullSvg.includes('DCM3623T50M53C2T00') && out.fullSvg.includes('XP Power QHL400'), 'SVG card <title> embeds full hover specs');
  assert.equal(out.medModel.head.length, 13, 'Moderate PBS dynamically includes only its 6 populated optional columns alongside main 7');
  assert.equal(out.medPdf.ctorOpts.format, 'a3', 'Moderate PBS PDF auto-scales to A3 Landscape');
  assert.equal(out.medPdf.tables.length, 1, 'Moderate PBS renders a single unified table');
  assert.equal(out.fullModel.head.length, 25, 'Full PBS includes all 18 optional columns inline alongside the 7 main columns');
  assert.equal(out.fullPdf.tables.length, 1, 'Full PBS PDF renders 1 single unified table (no separate annexes)');
  assert.ok(Array.isArray(out.fullPdf.ctorOpts.format) && out.fullPdf.ctorOpts.format[0] > 1191, 'Full 25-col PBS auto-scales to Wide Landscape page width');
  const massColIdx = out.fullModel.colIdx.mass;
  assert.equal(out.fullModel.rows[0].cells[massColIdx], 'Sum 3.35', 'Parent row shows rolled-up Sum directly in the Mass column');
  assert.equal(out.fullModel.totalRow.cells[massColIdx], '3.35', 'Unified PDF TOTAL row aligns total Mass directly under Mass column');
  assert.equal((out.fullPrintHtml.match(/<table/g) || []).length, 1, 'Offline print HTML renders a single unified horizontal table');
  assert.ok(out.fullPrintHtml.includes('DCM3623T50M53C2T00') && out.fullPrintHtml.includes('DWG-M-101 Rev C') && out.fullPrintHtml.includes('TOTAL'), 'Print HTML includes all populated specs inline plus TOTAL row');

  // Unified in-app table, frozen left columns, additive column-group toggles & collapsible form
  assert.equal(out.sparseColKeys.join(','), 'mass', 'Enabling SWaP on a doc with only Mass shows ONLY Mass (no blank clutter columns)');
  assert.equal(out.htmlMainOnly.includes('pp-pbs-sticky'), false, 'Main Only keeps clean 7-column table without horizontal sticky scrolling');
  assert.ok(out.htmlMainOnly.includes('pp-pbs-acr') && out.htmlMainOnly.includes('PSU') && out.htmlMainOnly.includes('pp-pbs-her-New'), 'Main Only still keeps compact Acronym & Heritage chips inline');
  assert.ok(out.htmlProcAndSwp.includes('pp-pbs-sticky') && out.htmlProcAndSwp.includes('Maturity') && out.htmlProcAndSwp.includes('Department') && out.htmlProcAndSwp.includes('DCM3623T50M53C2T00') && out.htmlProcAndSwp.includes('&Sigma; 3.35') && out.htmlProcAndSwp.includes('pp-pbs-total-row'), 'Additive Procurement + SWaP toggles keep main columns visible, freeze Code/Deliverable, and render totals footer');
  assert.ok(out.htmlAllPop.includes('DWG-M-101 Rev C') && out.htmlAllPop.includes('Vicor') && out.htmlAllPop.includes('50000') && out.htmlAllPop.includes('Mass: 3.35 kg'), 'All Populated shows Docs + Procurement + SWaP inline alongside main columns');
  assert.ok(out.htmlEditNew.includes('data-pbs-section="docs">') && out.htmlEditNew.includes('data-pbs-section="proc">') && out.htmlEditNew.includes('data-pbs-section="eng">'), 'New item form starts with all 3 optional sections collapsed');
  assert.ok(out.htmlEditPsu.includes('data-pbs-section="docs" open>') && out.htmlEditPsu.includes('id="ppPbsProcStatusList"') && out.htmlEditPsu.includes('In Manufacture'), 'Edit form auto-opens populated sections and provides Procurement Status preset suggestions');
});

test('PBS v2 enhancements: non-double-counting SWaP + Qty, lead-time/spares risk, field conflict diff, filters/subtotals, renumber, URLs & current-view PDF', () => {
  const out = vm.runInContext(`(() => {
    const P = globalThis.__ppPbsV2;
    const project = { id: 'p_enh', code: 'ORB', name: 'Orbiter Bus', color: '#0ea5e9' };
    const db = {
      departments: [
        { id: 'd_el', code: 'EL', name: 'Electrical', color: '#4f46e5' },
        { id: 'd_me', code: 'ME', name: 'Mechanical', color: '#10b981' },
      ],
      milestones: [
        { id: 'm_cdr', title: 'CDR Hardware Freeze', date: '2026-08-01', status: 'Open', projectId: 'p_enh' },
        { id: 'm_done', title: 'PDR', date: '2026-04-01', status: 'Done', projectId: 'p_enh' },
      ],
    };

    // 1. Parent budget (5 kg) + children (1.25 kg + 4x0.25 kg = 2.25 kg + 2.1 kg = 4.35 kg) -> no double-counting!
    // Also include lead-time slip (14 wks from 2026-06-01 -> ~2026-09-07 > 2026-08-01), spares gap, clickable URL, and delivered/received exemptions.
    const doc = P.data.normalizePbsDoc({
      schema: 'pulseplan-pbs-v1',
      items: [
        { id: 'r1', parentId: null, code: '1', name: 'Avionics Bay', acronym: 'AVB', heritage: 'Update', maturity: 'CDR', mass: 4.0, powerConsumption: 80 },
        { id: 'c1', parentId: 'r1', code: '1.1', name: 'Power Supply', acronym: 'PSU', heritage: 'New', maturity: 'CDR', deptId: 'd_el', milestoneId: 'm_cdr', procurementStatus: 'Ordered', leadTime: 14, mass: 1.25, powerConsumption: 45, powerDissipation: 8.5, lru: 'Yes', spareAvailable: 'No', spareToDeliver: 'Yes', refDoc: 'https://docs.example.com/icd/PWR-009' },
        { id: 'c2', parentId: 'r1', code: '1.2', name: 'IMU Sensor', acronym: 'IMU', heritage: 'Existing', maturity: 'Qualified', deptId: 'd_el', milestoneId: 'm_cdr', procurementStatus: 'Received', leadTime: 20, qty: 4, mass: 0.25, powerConsumption: 5, powerDissipation: 2, spareAvailable: 'Yes', spareToDeliver: 'Yes' },
        { id: 'c3', parentId: 'r1', code: '1.3', name: 'Alu Housing', acronym: 'HSG', heritage: 'Existing', maturity: 'Delivered', deptId: 'd_me', milestoneId: 'm_cdr', procurementStatus: 'In Stock', leadTime: 16, mass: 2.1, powerConsumption: 0, powerDissipation: 0 },
      ],
    }, project, 'Tester');

    const summary = P.tree.computeMaturitySummary(doc, db.milestones, '2026-06-01');
    const rollups = P.tree.computeSwpRollups(doc);
    const r1Sub = rollups.byId.get('r1');
    const c2Sub = rollups.byId.get('c2');

    // 2. Per-field conflict diff
    const remoteDoc = JSON.parse(JSON.stringify(doc));
    remoteDoc.items[1].mass = 1.6;
    remoteDoc.items[1].procurementStatus = 'In Transit';
    remoteDoc.items[1].qty = 2;
    const conflictDiff = P.data.computeConflictDiff(doc, remoteDoc, db);
    const conflictHtml = P.view.renderConflictPanel({ conflict: { diff: conflictDiff } });

    // 3. Extended filters & filtered subtotals (Electrical dept only -> c1 + c2 = 1.25 + 1.0 = 2.25 kg)
    const aux = { summary, rollups };
    const elRows = P.tree.getFilteredTreeRows(doc, { deptId: 'd_el' }, new Set(), aux);
    const elMatchedIds = new Set(elRows.filter(r => !r.isContextOnly).map(r => r.item.id));
    const elRollups = P.tree.computeFilteredRollups(doc, elMatchedIds);
    const gapRows = P.tree.getFilteredTreeRows(doc, { flag: 'spareGap' }, new Set(), aux);
    const leadRiskRows = P.tree.getFilteredTreeRows(doc, { flag: 'leadRisk' }, new Set(), aux);
    const heritageRows = P.tree.getFilteredTreeRows(doc, { heritage: 'New' }, new Set(), aux);
    const procRows = P.tree.getFilteredTreeRows(doc, { procStatus: 'Ordered' }, new Set(), aux);
    const overlapRows = P.tree.getFilteredTreeRows(doc, { flag: 'overlap' }, new Set(), aux);

    // 4. Current-view PDF (filtered Electrical + SWaP cols only) vs Full PDF
    const fullModel = P.report.buildReportModel(doc, project, db, 'Tester', '2026-06-01');
    const viewModel = P.report.buildReportModel(doc, project, db, 'Tester', '2026-06-01', {
      visibleOptKeys: ['qty', 'mass', 'powerConsumption'],
      rowIds: elRows.map(r => r.item.id),
      matchedIds: Array.from(elMatchedIds),
      todayIso: '2026-06-01',
    });
    const fullSvg = P.report.buildSvg(doc, project, db, '2026-06-01');

    // 5. CSV round-trip with Qty + pasted Excel TSV with Qty
    const csv = P.io.buildPbsCsv(doc, db);
    const csvRt = P.io.parsePbsCsv(csv, db);
    const pastedTsv = P.io.parsePbsCsv('Code\\tName\\tQty\\tMass (kg)\\n1\\tSensor\\t4x\\t0.25 kg\\n2\\tBadQty\\t0\\t1', db);

    // 6. Auto-renumber after moving 1.3 above 1.2
    const docRen = JSON.parse(JSON.stringify(doc));
    P.tree.reorderItem(docRen, 'c3', 'up');
    const codesBefore = P.tree.flattenTreeRows(docRen, null, 0, []).map(r => r.item.code).join(',');
    const renRes = P.tree.renumberTree(docRen);
    const codesAfter = P.tree.flattenTreeRows(docRen, null, 0, []).map(r => r.item.code).join(',');

    // 7. Clickable URL rendering & XSS safety
    const safeLink = P.view.renderTextOrLink('https://docs.example.com/icd/PWR-009');
    const badProto = P.view.renderTextOrLink('javascript:alert(1)');
    const plainDwg = P.view.renderTextOrLink('DWG-M-101 Rev C');

    // 8. Full dialog HTML with filtered state, Undo/Redo, Paste panel, risk pills
    const dialogHtml = P.view.buildDialogHtml({
      doc, db, project, summary, rollups,
      filteredRollups: elRollups, isFiltered: true, matchedCount: elMatchedIds.size,
      rows: elRows, collapsedIds: new Set(),
      colGroups: { docs: true, proc: true, swp: true },
      filter: { search: '', deptId: 'd_el', maturity: '', milestoneId: '', heritage: '', procStatus: '', flag: '' },
      edit: null, pasteOpen: true, canUndo: true, canRedo: false,
      undoLabel: 'Undo: Update 1.1', redoLabel: 'Nothing to redo',
      conflict: null, notices: [], owners: [], manufacturers: [], procStatuses: P.PROC_STATUS_PRESETS,
      projectMilestones: db.milestones, cloneSources: [], canDirSync: false, dirName: '', hasRemembered: false,
      status: { text: 'Saved locally', tone: 'idle' },
    });

    return {
      summary, rollups, r1Sub, c2Sub,
      conflictChanges: conflictDiff.modifiedBoth[0].changes.map(c => c.key).join(','),
      conflictHtml,
      elRollups,
      gapIds: gapRows.filter(r => !r.isContextOnly).map(r => r.item.id).join(','),
      leadRiskIds: leadRiskRows.filter(r => !r.isContextOnly).map(r => r.item.id).join(','),
      heritageIds: heritageRows.filter(r => !r.isContextOnly).map(r => r.item.id).join(','),
      procIds: procRows.filter(r => !r.isContextOnly).map(r => r.item.id).join(','),
      overlapIds: overlapRows.filter(r => !r.isContextOnly).map(r => r.item.id).join(','),
      fullModel, viewModel, fullSvg,
      csvRtQty: csvRt.items.find(i => i.code === '1.2').qty,
      csvRtWarnings: csvRt.warnings.length,
      pastedTsv,
      codesBefore, renChanged: renRes.changed, codesAfter,
      safeLink, badProto, plainDwg, dialogHtml,
    };
  })()`, ctx);

  // SWaP non-double-counting + Qty multiplication
  assert.equal(out.rollups.totalMass, 4.35, 'Total mass uses children sum (1.25 + 4*0.25 + 2.1 = 4.35) without double-counting parent budget 4.0');
  assert.equal(out.rollups.totalPowerConsumption, 65, 'Total power uses children sum (45 + 4*5 + 0 = 65 W) without double-counting parent 80 W');
  assert.equal(out.rollups.totalPowerDissipation, 16.5, 'Total power dissipation multiplies Qty (8.5 + 4*2 = 16.5 W)');
  assert.equal(out.rollups.overlapCount, 1, 'Detects 1 parent with budget/children overlap');
  assert.equal(out.r1Sub.massOverlap, true, 'Flags parent mass overlap');
  assert.equal(out.r1Sub.massOverBudget, true, 'Flags children mass (4.35) exceeding parent budget (4.0)');
  assert.equal(out.r1Sub.powerConsOverlap, true, 'Flags parent power overlap');
  assert.equal(out.r1Sub.powerConsOverBudget, false, 'Children power (65) is under parent budget (80)');
  assert.equal(out.c2Sub.lineMass, 1, 'Qty=4 multiplies unit mass 0.25 -> lineMass 1 kg');

  // Lead-time risk & spares gap
  assert.equal(out.summary.leadRiskCount, 1, 'Only Ordered/non-Delivered PSU triggers lead-time risk (Received & Delivered items excluded)');
  assert.equal(out.leadRiskIds, 'c1', 'Lead-time risk filter matches c1');
  assert.equal(out.rollups.spareGapCount, 1, 'Detects 1 spares gap (spareToDeliver=Yes & spareAvailable=No)');
  assert.equal(out.gapIds, 'c1', 'Spares gap filter matches c1');
  assert.equal(out.heritageIds, 'c1', 'Heritage filter matches New item');
  assert.equal(out.procIds, 'c1', 'Procurement status filter matches Ordered item');
  assert.equal(out.overlapIds, 'r1', 'Overlap flag filter matches r1');

  // Per-field conflict diff
  assert.equal(out.conflictChanges, 'procurementStatus,qty,mass', 'Conflict diff reports exact changed optional fields');
  assert.ok(out.conflictHtml.includes('Mass (kg)') && out.conflictHtml.includes('Proc. Status') && out.conflictHtml.includes('In Transit'), 'Conflict panel renders changed field labels and values');

  // Filtered subtotals & current-view PDF
  assert.equal(out.elRollups.totalMass, 2.25, 'Electrical filtered subtotal sums 1.25 + 4*0.25 = 2.25 kg');
  assert.equal(out.elRollups.totalPowerConsumption, 65, 'Electrical filtered subtotal sums 45 + 4*5 = 65 W');
  assert.equal(out.fullModel.rows[2].cells[out.fullModel.colIdx.mass], '1 (4x0.25)', 'Full PDF shows qty-multiplied mass breakdown');
  assert.ok(out.fullModel.rows[0].cells[out.fullModel.colIdx.mass].includes('Sum 4.35 [vs 4]'), 'Full PDF annotates parent budget overlap');
  assert.ok(out.fullModel.rows[1].cells[out.fullModel.colIdx.leadTime].includes('w!)'), 'Full PDF annotates lead-time slip risk');
  assert.equal(out.fullModel.rows[1].cells[out.fullModel.colIdx.spareToDeliver], 'Yes (!)', 'Full PDF flags spares gap');
  assert.equal(out.viewModel.head.length, 10, 'Current-view PDF restricts columns to 7 main + 3 selected optional cols (qty, mass, pwrCons)');
  assert.equal(out.viewModel.layout.pageFormat, 'a4', 'Focused 10-col current-view PDF fits cleanly on A4 Landscape');
  assert.equal(out.viewModel.totalRow.cells[0], 'FILTERED', 'Filtered PDF labels bottom row FILTERED');
  assert.equal(out.viewModel.totalRow.cells[out.viewModel.colIdx.mass], '2.25', 'Filtered PDF total mass matches Electrical slice');
  assert.ok(out.fullSvg.includes('IMU \u00d74') && out.fullSvg.includes('Quantity: 4'), 'SVG embeds Qty in card header and tooltip');

  // CSV + Excel paste Qty & Renumber
  assert.equal(out.csvRtWarnings, 0, '27-column CSV round-trip with Qty has zero warnings');
  assert.equal(out.csvRtQty, 4, 'CSV round-trip preserves Quantity=4');
  assert.equal(out.pastedTsv.items[0].qty, 4, 'Pasted TSV parses 4x as qty=4');
  assert.equal(out.pastedTsv.items[1].qty, null, 'Pasted TSV rejects qty=0 to null');
  assert.ok(out.pastedTsv.warnings.some(w => w.includes('invalid Quantity')), 'Invalid pasted Qty emits warning');
  assert.equal(out.codesBefore, '1,1.1,1.3,1.2', 'Moving 1.3 up puts codes out of order');
  assert.equal(out.renChanged, 2, 'renumberTree updates the 2 out-of-sequence codes');
  assert.equal(out.codesAfter, '1,1.1,1.2,1.3', 'renumberTree restores clean sequential hierarchy');

  // Clickable URLs & UI controls
  assert.ok(out.safeLink.includes('<a href="https://docs.example.com/icd/PWR-009"') && out.safeLink.includes('rel="noopener noreferrer"'), 'https:// refDoc renders as safe clickable link');
  assert.equal(out.badProto.includes('<a '), false, 'javascript: URL is rejected and rendered as plain escaped text');
  assert.equal(out.plainDwg, 'DWG-M-101 Rev C', 'Plain drawing ID stays plain text');
  assert.ok(out.dialogHtml.includes('id="ppPbsUndoBtn"') && out.dialogHtml.includes('id="ppPbsRedoBtn" disabled') && out.dialogHtml.includes('id="ppPbsRenumberBtn"') && out.dialogHtml.includes('id="ppPbsPastePanel"'), 'Dialog renders Undo/Redo, Renumber, and Paste panel');
  assert.ok(out.dialogHtml.includes('id="ppPbsExportPdfViewBtn"') && out.dialogHtml.includes('FILTERED') && out.dialogHtml.includes('2 / 4 items'), 'Dialog renders PDF (Current View) and FILTERED subtotal footer');
  assert.ok(out.dialogHtml.includes('data-pbs-flag-pill="leadRisk"') && out.dialogHtml.includes('data-pbs-flag-pill="spareGap"') && out.dialogHtml.includes('data-pbs-flag-pill="overlap"'), 'Summary bar renders clickable lead-time, spares-gap, and budget-overlap pills');
  assert.ok(out.dialogHtml.includes('pp-pbs-yn-Warn') && out.dialogHtml.includes('pp-pbs-link'), 'Table renders spares gap warning pill and clickable URL link');
});

test('WhatsApp-style automatic bullet lists in Roadmap notes (editor transforms, exit on empty bullet, safe HTML rendering)', () => {
  const out = vm.runInContext(`(() => {
    const api = globalThis.__ppRoadmapBulletsTestApi;
    if (!api) throw new Error('Missing __ppRoadmapBulletsTestApi');

    // 1. Typing "- " at start of line converts to "• "
    const dashSpace = api.transformDashSpaceOnInput('- ', 2, 2);
    const dashSpaceLine2 = api.transformDashSpaceOnInput('Heading\\n- ', 10, 10);
    const midLineIgnore = api.transformDashSpaceOnInput('hello - ', 8, 8);

    // 2. Pressing Enter on "- First item" normalizes and starts next bullet "• "
    const enterFromDash = api.transformEnterKey('- First item', 12, 12);
    // 3. Pressing Enter on "-NoSpace" also works seamlessly
    const enterNoSpace = api.transformEnterKey('-NoSpace', 8, 8);
    // 4. Pressing Enter on "• Second" continues "• "
    const enterFromBullet = api.transformEnterKey('• First\\n• Second', 16, 16);
    // 5. Pressing Enter on empty bullet "• " exits the list cleanly
    const exitEmpty = api.transformEnterKey('• First\\n• ', 10, 10);
    // 6. Pressing Enter mid-bullet splits cleanly into two bullets
    const splitMid = api.transformEnterKey('• Alpha Beta', 7, 7);
    // 7. Backspace right after "• " removes bullet prefix
    const bsBullet = api.transformBackspaceKey('• ', 2, 2);

    // 8. Safe HTML rendering groups consecutive bullets into <ul class="pp-note-bullets"> and escapes HTML
    const rendered = api.ppFormatRoadmapNoteHtml('Overview:\\n• Ship <script>v1</script>\\n- Verify QA\\nDone');

    return {
      dashSpace, dashSpaceLine2, midLineIgnore,
      enterFromDash, enterNoSpace, enterFromBullet, exitEmpty, splitMid, bsBullet, rendered,
    };
  })()`, ctx);

  assert.equal(out.dashSpace.value, '• ', 'Typing "- " converts to "• "');
  assert.equal(out.dashSpaceLine2.value, 'Heading\n• ', 'Typing "- " on a new line converts to "• "');
  assert.equal(out.midLineIgnore, null, 'Mid-line "- " is untouched');
  assert.equal(out.enterFromDash.value, '• First item\n• ', 'Enter on "- First item" turns into bullet list and starts next bullet');
  assert.equal(out.enterNoSpace.value, '• NoSpace\n• ', 'Enter on "-NoSpace" turns into bullet list');
  assert.equal(out.enterFromBullet.value, '• First\n• Second\n• ', 'Enter on existing bullet adds next bullet');
  assert.equal(out.exitEmpty.value, '• First\n', 'Enter on empty bullet removes prefix and exits list');
  assert.equal(out.splitMid.value, '• Alpha\n• Beta', 'Enter mid-bullet splits text onto next bullet');
  assert.equal(out.bsBullet.value, '', 'Backspace after "• " clears bullet prefix cleanly');
  assert.ok(out.rendered.includes('<ul class="pp-note-bullets">') && out.rendered.includes('<li>Ship &lt;script&gt;v1&lt;/script&gt;</li>') && out.rendered.includes('<li>Verify QA</li>'), 'Rendered Roadmap note groups bullets and escapes XSS');
});

test('Multi-user RBAC, wrapped-key login, self-service password change, admin reset & unified-key separate Finance Vault', async () => {
  assert.ok(html.includes('class="pp-sync-strip"') && html.includes('class="pp-switch-track"'), 'Modernized Sync Hub status strip and toggle switches are present in HTML');

  const out = await vm.runInContext(`(async () => {
    const auth = globalThis.__ppAuthRbacTestApi;
    const fin = globalThis.__ppFinanceVaultTestApi;
    if (!auth || !fin) throw new Error('Missing auth or finance test API');

    liveDB = createSampleDemoDB();
    liveDB.peopleDirectory = [{ id: 'ppl_1', name: 'Elena Rostova', role: 'Technical Lead' }];
    ui.demoMode = false;
    ui.whatIfMode = false;
    ui.activeTab = 'sync';

    // 1. Admin enables master encryption password
    const adminPw = 'AdminMaster#2026!';
    ppSyncPassphrase = adminPw;
    auth.ppApplyAuthenticatedSession('admin', null, 'Lead Admin');
    const adminHasAccess = auth.ppHasAdminAccess();
    const adminSeesRates = hasAnyDayRates(liveDB);

    // 2. Admin provisions two users: Elena (Matrix+Health, NO finance) & Marco (Matrix+Health+Sync, Finance ON)
    const elena = await auth.createOrUpdateUserAccount({
      name: 'Elena Rostova',
      roleTitle: 'Technical Lead',
      permissions: { tabs: { matrix: true, health: true, data: false, sync: false }, finance: false },
      tempPassword: 'ElenaTemp#123',
      mustChangePassword: true,
    });
    const marco = await auth.createOrUpdateUserAccount({
      name: 'Marco Bellini',
      roleTitle: 'Project Owner',
      permissions: { tabs: { matrix: true, health: true, data: false, sync: true }, finance: true },
      tempPassword: 'MarcoTemp#456',
      mustChangePassword: false,
    });

    // 3. Verify normalizeAndMigrateDB & 3-way merge preserve accessControl + peopleDirectory
    const migrated = normalizeAndMigrateDB(JSON.parse(JSON.stringify(liveDB)));
    const preservedUsers = migrated.accessControl.users.length;
    const preservedPeople = migrated.peopleDirectory.length;

    const baseSnap = cloneSyncSnapshot(liveDB);
    const localCopy = cloneSyncSnapshot(liveDB);
    const diskCopy = cloneSyncSnapshot(liveDB);
    diskCopy.comments['d_eng::p_nova::2026-W48'] = '• Remote bullet';
    localCopy.accessControl.adminName = 'Chief Admin';
    const mergeRes = tryThreeWayAutoMerge(baseSnap, localCopy, diskCopy);

    // 4. Separate Finance Vault encrypted with SAME Admin key (no Password B)
    const finPayload = fin.extractFinancialsFromDb(liveDB);
    const finEncJson = await fin.encryptFinancePayload(finPayload, adminPw);

    // 5. Switch to Elena (restricted tabs, NO finance)
    ppSyncPassphrase = ''; // Clear key to prove Elena's password unwraps Admin key internally!
    await auth.authenticateInMemoryAccount(elena.id, 'ElenaTemp#123');
    const elenaUnwrappedKeyMatches = (ppSyncPassphrase === adminPw);
    const elenaCanMatrix = auth.ppCanAccessTab('matrix');
    const elenaCanData = auth.ppCanAccessTab('data');
    const elenaCanSync = auth.ppCanAccessTab('sync');
    const elenaCanFin = auth.ppCanAccessFinance();
    const elenaSeesRates = hasAnyDayRates(liveDB);
    switchTab('data');
    const tabAfterBlockedSwitch = ui.activeTab;

    // 6. Elena chooses her own personal password -> old temp password stops working
    await auth.changeCurrentUserPassword({
      currentPassword: 'ElenaTemp#123',
      newPassword: 'ElenaPrivate#999',
      skipCurrentVerify: false,
    });
    const elenaMustChangeAfter = liveDB.accessControl.users.find(u => u.id === elena.id).mustChangePassword;
    let oldPwRejected = false;
    try {
      await auth.authenticateInMemoryAccount(elena.id, 'ElenaTemp#123');
    } catch (_e) {
      oldPwRejected = true;
    }
    ppSyncPassphrase = '';
    await auth.authenticateInMemoryAccount(elena.id, 'ElenaPrivate#999');
    const elenaPersonalWorks = (ppSyncPassphrase === adminPw);

    // 7. Switch to Marco (Finance ON) -> internally unwraps Admin key AND decrypts separate Finance Vault without Password B!
    ppSyncPassphrase = '';
    await auth.authenticateInMemoryAccount(marco.id, 'MarcoTemp#456');
    const marcoCanFin = auth.ppCanAccessFinance();
    const marcoSeesRates = hasAnyDayRates(liveDB);
    const marcoDecryptedFin = await fin.decryptFinancePayload(finEncJson, ppSyncPassphrase);

    // 8. Switch back to Admin & reset Elena's password
    await auth.authenticateInMemoryAccount('__ADMIN__', adminPw);
    const adminBack = auth.ppHasAdminAccess() && !auth.ppIsStandardUser();
    await auth.adminResetUserPassword(elena.id, 'AdminReset#777', true);
    const elenaResetFlag = liveDB.accessControl.users.find(u => u.id === elena.id).mustChangePassword;
    ppSyncPassphrase = '';
    await auth.authenticateInMemoryAccount(elena.id, 'AdminReset#777');
    const elenaResetWorks = (ppSyncPassphrase === adminPw);

    // Cleanup session back to open
    ppSyncPassphrase = '';
    auth.ppApplyAuthenticatedSession('open');

    return {
      adminHasAccess, adminSeesRates,
      preservedUsers, preservedPeople,
      mergeOk: mergeRes.ok,
      mergedAdminName: mergeRes.mergedDB?.accessControl?.adminName,
      mergedUsersLen: mergeRes.mergedDB?.accessControl?.users?.length,
      elenaUnwrappedKeyMatches, elenaCanMatrix, elenaCanData, elenaCanSync, elenaCanFin, elenaSeesRates,
      tabAfterBlockedSwitch, elenaMustChangeAfter, oldPwRejected, elenaPersonalWorks,
      marcoCanFin, marcoSeesRates,
      marcoFinRateEng: marcoDecryptedFin?.deptRates?.d_eng?.dayRate,
      adminBack, elenaResetFlag, elenaResetWorks,
    };
  })()`, ctx);

  assert.equal(out.adminHasAccess, true, 'Admin session has admin access');
  assert.equal(out.adminSeesRates, true, 'Admin session sees financial day rates');

  assert.equal(out.preservedUsers, 2, 'normalizeAndMigrateDB preserves configured user accounts');
  assert.equal(out.preservedPeople, 1, 'normalizeAndMigrateDB preserves peopleDirectory');
  assert.equal(out.mergeOk, true, '3-way auto-merge succeeds with disjoint comments and accessControl edits');
  assert.equal(out.mergedAdminName, 'Chief Admin', '3-way merge preserves updated adminName');
  assert.equal(out.mergedUsersLen, 2, '3-way merge preserves configured user accounts');
  assert.equal(out.elenaUnwrappedKeyMatches, true, 'User login internally unwraps Administrator master key');
  assert.equal(out.elenaCanMatrix, true, 'Elena can access allowed Roadmap tab');
  assert.equal(out.elenaCanData, false, 'Elena is blocked from Setup & Data tab');
  assert.equal(out.elenaCanSync, false, 'Elena is blocked from Sync & Snapshots tab');
  assert.equal(out.elenaCanFin, false, 'Elena is blocked from Financial Data');
  assert.equal(out.elenaSeesRates, false, 'hasAnyDayRates hides all financial metrics for non-finance user');
  assert.equal(out.tabAfterBlockedSwitch, 'matrix', 'switchTab refuses disallowed tab and stays on allowed tab');
  assert.equal(out.elenaMustChangeAfter, false, 'Personal password update clears mustChangePassword flag');
  assert.equal(out.oldPwRejected, true, 'Old temporary password is rejected after user picks personal password');
  assert.equal(out.elenaPersonalWorks, true, 'Personal password unlocks Administrator key internally');
  assert.equal(out.marcoCanFin, true, 'Finance-authorized user has financial access');
  assert.equal(out.marcoSeesRates, true, 'Finance-authorized user sees department rates');
  assert.equal(out.marcoFinRateEng, 650, 'Finance-authorized user decrypts separate Finance Vault with unified session key (no Password B)');
  assert.equal(out.adminBack, true, 'Administrator can sign back in with Admin password');
  assert.equal(out.elenaResetFlag, true, 'Admin password reset sets mustChangePassword flag');
  assert.equal(out.elenaResetWorks, true, 'User can sign in with Admin-reset temporary password');
});

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`✅ PASS: ${t.name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${t.name}\n   ${err.message}`);
    failed++;
  }
}

console.log(`\nSummary: ${passed}/${tests.length} tests passed${failed ? `, ${failed} failed` : ''}.`);
process.exit(failed ? 1 : 0);
