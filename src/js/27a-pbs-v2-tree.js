/* PBS v2 - part 1/6: pure tree helpers (auto-numbering, reorder, filter, maturity summary).
 * Inert: only registers functions on window.__ppPbsV2.tree; no DOM access or global side effects. */
(function ppPbsV2TreePart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const MATURITY_OPTIONS = ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];
  const MATURITY_RANK = { Draft: 0, PDR: 1, CDR: 2, Qualified: 3, Delivered: 4 };

  function getChildren(doc, parentId) {
    if (!doc || !Array.isArray(doc.items)) return [];
    return doc.items.filter(item => (item.parentId || null) === (parentId || null));
  }

  function isDescendant(doc, candidateId, ancestorId) {
    if (!doc || !candidateId || !ancestorId) return false;
    const byId = new Map(doc.items.map(i => [i.id, i]));
    let cur = byId.get(candidateId);
    let guard = 0;
    while (cur && cur.parentId && guard < 200) {
      if (cur.parentId === ancestorId) return true;
      cur = byId.get(cur.parentId);
      guard++;
    }
    return false;
  }

  function suggestNextCode(doc, parentId) {
    if (!doc) return '1';
    const siblings = getChildren(doc, parentId || null);
    const parent = parentId ? doc.items.find(i => i.id === parentId) : null;
    const prefix = parent && parent.code ? `${parent.code}.` : '';
    let maxNum = 0;
    siblings.forEach(s => {
      const raw = String(s.code || '').trim();
      const tail = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
      const m = tail.match(/^(\d+)$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
    return `${prefix}${maxNum + 1 || siblings.length + 1}`;
  }

  /* action: 'up' | 'down' | 'indent' | 'outdent'. Returns { ok, newParentId }. */
  function reorderItem(doc, itemId, action) {
    const fail = { ok: false, newParentId: null };
    if (!doc || !Array.isArray(doc.items)) return fail;
    const item = doc.items.find(i => i.id === itemId);
    if (!item) return fail;
    const siblings = getChildren(doc, item.parentId || null);
    const idx = siblings.findIndex(s => s.id === itemId);
    if (idx < 0) return fail;

    if (action === 'up') {
      if (idx === 0) return fail;
      const other = siblings[idx - 1];
      const a = doc.items.indexOf(other);
      const b = doc.items.indexOf(item);
      doc.items[a] = item;
      doc.items[b] = other;
      return { ok: true, newParentId: item.parentId || null };
    }
    if (action === 'down') {
      if (idx >= siblings.length - 1) return fail;
      const other = siblings[idx + 1];
      const a = doc.items.indexOf(item);
      const b = doc.items.indexOf(other);
      doc.items[a] = other;
      doc.items[b] = item;
      return { ok: true, newParentId: item.parentId || null };
    }
    if (action === 'indent') {
      if (idx === 0) return fail;
      const newParent = siblings[idx - 1];
      if (newParent.id === item.id || isDescendant(doc, newParent.id, item.id)) return fail;
      item.parentId = newParent.id;
      return { ok: true, newParentId: newParent.id };
    }
    if (action === 'outdent') {
      if (!item.parentId) return fail;
      const parent = doc.items.find(i => i.id === item.parentId);
      item.parentId = parent ? (parent.parentId || null) : null;
      return { ok: true, newParentId: item.parentId };
    }
    return fail;
  }

  function renumberTree(doc) {
    if (!doc || !Array.isArray(doc.items)) return { changed: 0 };
    let changed = 0;
    (function walk(parentId, prefix) {
      getChildren(doc, parentId).forEach((item, idx) => {
        const nextCode = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
        if (item.code !== nextCode) { item.code = nextCode; changed++; }
        walk(item.id, nextCode);
      });
    })(null, '');
    return { changed };
  }

  function flattenTreeRows(doc, parentId, depth, out) {
    const list = out || [];
    getChildren(doc, parentId || null).forEach(item => {
      list.push({ item, depth: depth || 0 });
      flattenTreeRows(doc, item.id, (depth || 0) + 1, list);
    });
    return list;
  }

  const PROC_DONE = new Set(['received', 'in stock', 'delivered']);
  function parseIsoDateUtc(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function formatUtcIso(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  /* milestones: array of { id, date, status }. todayIso: 'YYYY-MM-DD'. */
  function computeMaturitySummary(doc, milestones, todayIso) {
    const counts = { Draft: 0, PDR: 0, CDR: 0, Qualified: 0, Delivered: 0 };
    const empty = {
      total: 0, counts, qualifiedPct: 0, overdueCount: 0, overdueIds: new Set(),
      leadRiskCount: 0, leadRiskMap: new Map(), bottleneckMap: new Map(),
    };
    if (!doc || !Array.isArray(doc.items)) return empty;
    const msMap = new Map((milestones || []).map(m => [m.id, m]));
    const overdueIds = new Set();
    const leadRiskMap = new Map();
    const todayMs = parseIsoDateUtc(todayIso);
    doc.items.forEach(it => {
      counts[MATURITY_OPTIONS.includes(it.maturity) ? it.maturity : 'Draft']++;
      const ms = it.milestoneId ? msMap.get(it.milestoneId) : null;
      const msOpen = Boolean(ms && ms.date && ms.status !== 'Done' && ms.status !== 'Completed');
      if (msOpen && todayIso && ms.date < todayIso) {
        overdueIds.add(it.id);
      }
      if (msOpen && todayMs !== null && it.maturity !== 'Delivered'
        && isNum(it.leadTime) && it.leadTime > 0
        && !PROC_DONE.has(String(it.procurementStatus || '').trim().toLowerCase())) {
        const msMs = parseIsoDateUtc(ms.date);
        const etaMs = todayMs + Math.ceil(it.leadTime * 7) * 86400000;
        if (msMs !== null && etaMs > msMs) {
          const slipWeeks = Math.max(1, Math.ceil((etaMs - msMs) / (7 * 86400000)));
          leadRiskMap.set(it.id, { etaIso: formatUtcIso(etaMs), milestoneDate: ms.date, slipWeeks });
        }
      }
    });

    const memo = new Map();
    function minDescRank(id) {
      if (memo.has(id)) return memo.get(id);
      let min = null;
      getChildren(doc, id).forEach(k => {
        const r = MATURITY_RANK[k.maturity] ?? 0;
        if (min === null || r < min) min = r;
        const sub = minDescRank(k.id);
        if (sub !== null && (min === null || sub < min)) min = sub;
      });
      memo.set(id, min);
      return min;
    }
    const bottleneckMap = new Map();
    doc.items.forEach(it => {
      const minR = minDescRank(it.id);
      if (minR !== null && minR < (MATURITY_RANK[it.maturity] ?? 0)) bottleneckMap.set(it.id, MATURITY_OPTIONS[minR]);
    });

    const total = doc.items.length;
    const done = counts.Qualified + counts.Delivered;
    return {
      total, counts, qualifiedPct: total ? Math.round((done / total) * 100) : 0,
      overdueCount: overdueIds.size, overdueIds,
      leadRiskCount: leadRiskMap.size, leadRiskMap,
      bottleneckMap,
    };
  }

  /* filter: { search, deptId, maturity, milestoneId, heritage, procStatus, flag }. collapsedIds: Set. aux?: { summary, rollups }. Keeps ancestors of matches as context rows. */
  function getFilteredTreeRows(doc, filter, collapsedIds, aux) {
    if (!doc || !Array.isArray(doc.items)) return [];
    const f = filter || {};
    const q = String(f.search || '').trim().toLowerCase();
    const collapsed = collapsedIds || new Set();
    const hasFilter = Boolean(q || f.deptId || f.maturity || f.milestoneId || f.heritage || f.procStatus || f.flag);

    if (!hasFilter) {
      const visible = [];
      (function walk(parentId, depth) {
        getChildren(doc, parentId).forEach(item => {
          const hasChildren = getChildren(doc, item.id).length > 0;
          visible.push({ item, depth, hasChildren, isContextOnly: false });
          if (hasChildren && !collapsed.has(item.id)) walk(item.id, depth + 1);
        });
      })(null, 0);
      return visible;
    }

    const byId = new Map(doc.items.map(i => [i.id, i]));
    const matched = new Set();
    const sum = aux && aux.summary ? aux.summary : null;
    const rol = aux && aux.rollups ? aux.rollups : null;
    doc.items.forEach(it => {
      if (f.deptId && it.deptId !== f.deptId) return;
      if (f.maturity && it.maturity !== f.maturity) return;
      if (f.milestoneId && it.milestoneId !== f.milestoneId) return;
      if (f.heritage && it.heritage !== f.heritage) return;
      if (f.procStatus && it.procurementStatus !== f.procStatus) return;
      if (f.flag) {
        if (f.flag === 'lru' && it.lru !== 'Yes') return;
        if (f.flag === 'spareDeliv' && it.spareToDeliver !== 'Yes') return;
        if (f.flag === 'spareGap' && !(it.spareToDeliver === 'Yes' && it.spareAvailable === 'No')) return;
        if (f.flag === 'leadRisk' && !(sum && sum.leadRiskMap && sum.leadRiskMap.has(it.id))) return;
        if (f.flag === 'overdue' && !(sum && sum.overdueIds && sum.overdueIds.has(it.id))) return;
        if (f.flag === 'overlap' && !(rol && rol.overlapIds && rol.overlapIds.has(it.id))) return;
      }
      if (q) {
        const hay = `${it.code || ''} ${it.acronym || ''} ${it.name || ''} ${it.description || ''} ${it.heritage || ''} ${it.owner || ''} ${it.notes || ''} ${it.manufacturer || ''} ${it.partNumber || ''} ${it.procurementStatus || ''} ${it.mechDrawing || ''} ${it.elecDrawing || ''} ${it.refDoc || ''} ${it.componentAlt || ''}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      matched.add(it.id);
    });
    const keep = new Set(matched);
    matched.forEach(id => {
      let cur = byId.get(id);
      let guard = 0;
      while (cur && cur.parentId && guard < 200) {
        keep.add(cur.parentId);
        cur = byId.get(cur.parentId);
        guard++;
      }
    });
    return flattenTreeRows(doc, null, 0, [])
      .filter(r => keep.has(r.item.id))
      .map(r => ({ item: r.item, depth: r.depth, hasChildren: getChildren(doc, r.item.id).length > 0, isContextOnly: !matched.has(r.item.id) }));
  }

  function round4(n) { return Math.round(n * 10000) / 10000; }
  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
  function effQty(it) { return (it && isNum(it.qty) && it.qty > 1) ? it.qty : 1; }

  /* Computes SWaP-R project totals (qty-multiplied, without double-counting parent budgets over children),
   * descendant roll-ups per item, spares gaps, parent/child overlap flags, and per-domain populated item counts. */
  function computeSwpRollups(doc) {
    const empty = {
      totalMass: null, totalPowerConsumption: null, totalPowerDissipation: null, totalUnitCost: null,
      massCount: 0, powerConsCount: 0, powerDissCount: 0, unitCostCount: 0,
      lruCount: 0, spareAvailCount: 0, spareDelivCount: 0,
      spareGapCount: 0, spareGapIds: new Set(),
      overlapCount: 0, overlapIds: new Set(), hasQty: false,
      docsItemsCount: 0, procItemsCount: 0, engItemsCount: 0, anySpecsCount: 0,
      byId: new Map(),
    };
    if (!doc || !Array.isArray(doc.items) || !doc.items.length) return empty;

    let massCount = 0; let powerConsCount = 0; let powerDissCount = 0; let unitCostCount = 0;
    let lruCount = 0; let spareAvailCount = 0; let spareDelivCount = 0;
    let docsItemsCount = 0; let procItemsCount = 0; let engItemsCount = 0; let anySpecsCount = 0;
    let hasQty = false;
    const spareGapIds = new Set();
    const overlapIds = new Set();

    const itemById = new Map(doc.items.map(it => [it.id, it]));
    const childrenByParent = new Map();

    doc.items.forEach(it => {
      if (isNum(it.mass)) massCount++;
      if (isNum(it.powerConsumption)) powerConsCount++;
      if (isNum(it.powerDissipation)) powerDissCount++;
      if (isNum(it.unitCost) && it.unitCost > 0) unitCostCount++;
      if (isNum(it.qty) && it.qty > 1) hasQty = true;
      if (it.lru === 'Yes') lruCount++;
      if (it.spareAvailable === 'Yes') spareAvailCount++;
      if (it.spareToDeliver === 'Yes') spareDelivCount++;
      if (it.spareToDeliver === 'Yes' && it.spareAvailable === 'No') spareGapIds.add(it.id);

      const hasDocs = Boolean(it.description || it.mechDrawing || it.elecDrawing || it.refDoc);
      const hasProc = Boolean(it.manufacturer || it.partNumber || it.procurementStatus || isNum(it.leadTime) || isNum(it.unitCost) || it.componentAlt);
      const hasEng = Boolean(it.heritage || (isNum(it.qty) && it.qty > 1) || isNum(it.mass) || isNum(it.powerConsumption) || isNum(it.powerDissipation) || isNum(it.mtbf) || it.lru || it.spareAvailable || it.spareToDeliver);
      if (hasDocs) docsItemsCount++;
      if (hasProc) procItemsCount++;
      if (hasEng) engItemsCount++;
      if (hasDocs || hasProc || hasEng || it.acronym) anySpecsCount++;

      const pid = (it.parentId && itemById.has(it.parentId) && it.parentId !== it.id) ? it.parentId : null;
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid).push(it);
    });

    const byId = new Map();
    const memo = new Map();
    function walkSubtree(item, seen) {
      if (memo.has(item.id)) return memo.get(item.id);
      if (seen.has(item.id)) return { m: 0, mc: 0, pc: 0, pcc: 0, pd: 0, pdc: 0, uc: 0, ucc: 0 };
      seen.add(item.id);
      let dm = 0; let dmc = 0;
      let dpc = 0; let dpcc = 0;
      let dpd = 0; let dpdc = 0;
      let duc = 0; let ducc = 0;
      (childrenByParent.get(item.id) || []).forEach(child => {
        const sub = walkSubtree(child, seen);
        dm += sub.m; dmc += sub.mc;
        dpc += sub.pc; dpcc += sub.pcc;
        dpd += sub.pd; dpdc += sub.pdc;
        duc += sub.uc; ducc += sub.ucc;
      });
      seen.delete(item.id);

      const q = effQty(item);
      const hasOwnM = isNum(item.mass); const hasDescM = dmc > 0;
      const hasOwnPc = isNum(item.powerConsumption); const hasDescPc = dpcc > 0;
      const hasOwnPd = isNum(item.powerDissipation); const hasDescPd = dpdc > 0;
      const hasOwnUc = isNum(item.unitCost); const hasDescUc = ducc > 0;

      const massOverlap = hasOwnM && hasDescM;
      const powerConsOverlap = hasOwnPc && hasDescPc;
      const powerDissOverlap = hasOwnPd && hasDescPd;
      const unitCostOverlap = hasOwnUc && hasDescUc;
      if (massOverlap || powerConsOverlap || powerDissOverlap || unitCostOverlap) overlapIds.add(item.id);

      const effM = hasDescM ? dm * q : (hasOwnM ? item.mass * q : 0);
      const effPc = hasDescPc ? dpc * q : (hasOwnPc ? item.powerConsumption * q : 0);
      const effPd = hasDescPd ? dpd * q : (hasOwnPd ? item.powerDissipation * q : 0);
      const effUc = hasDescUc ? duc * q : (hasOwnUc ? item.unitCost * q : 0);

      byId.set(item.id, {
        effQty: q,
        descMass: hasDescM ? round4(dm * q) : null,
        descMassUnit: hasDescM ? round4(dm) : null,
        lineMass: hasOwnM ? round4(item.mass * q) : null,
        massOverlap,
        massOverBudget: massOverlap && dm > item.mass,
        descPowerCons: hasDescPc ? round4(dpc * q) : null,
        descPowerConsUnit: hasDescPc ? round4(dpc) : null,
        linePowerCons: hasOwnPc ? round4(item.powerConsumption * q) : null,
        powerConsOverlap,
        powerConsOverBudget: powerConsOverlap && dpc > item.powerConsumption,
        descPowerDiss: hasDescPd ? round4(dpd * q) : null,
        descPowerDissUnit: hasDescPd ? round4(dpd) : null,
        linePowerDiss: hasOwnPd ? round4(item.powerDissipation * q) : null,
        powerDissOverlap,
        powerDissOverBudget: powerDissOverlap && dpd > item.powerDissipation,
        descUnitCost: hasDescUc ? round4(duc * q) : null,
        descUnitCostUnit: hasDescUc ? round4(duc) : null,
        lineUnitCost: hasOwnUc ? round4(item.unitCost * q) : null,
        unitCostOverlap,
        unitCostOverBudget: unitCostOverlap && duc > item.unitCost,
      });

      const res = {
        m: effM, mc: (hasDescM || hasOwnM) ? 1 : 0,
        pc: effPc, pcc: (hasDescPc || hasOwnPc) ? 1 : 0,
        pd: effPd, pdc: (hasDescPd || hasOwnPd) ? 1 : 0,
        uc: effUc, ucc: (hasDescUc || hasOwnUc) ? 1 : 0,
      };
      memo.set(item.id, res);
      return res;
    }

    let totalM = 0; let totalMc = 0;
    let totalPc = 0; let totalPcc = 0;
    let totalPd = 0; let totalPdc = 0;
    let totalUc = 0; let totalUcc = 0;
    (childrenByParent.get(null) || []).forEach(root => {
      const sub = walkSubtree(root, new Set());
      totalM += sub.m; totalMc += sub.mc;
      totalPc += sub.pc; totalPcc += sub.pcc;
      totalPd += sub.pd; totalPdc += sub.pdc;
      totalUc += sub.uc; totalUcc += sub.ucc;
    });
    doc.items.forEach(it => { if (!byId.has(it.id)) walkSubtree(it, new Set()); });

    return {
      totalMass: totalMc ? round4(totalM) : null,
      totalPowerConsumption: totalPcc ? round4(totalPc) : null,
      totalPowerDissipation: totalPdc ? round4(totalPd) : null,
      totalUnitCost: totalUcc ? round4(totalUc) : null,
      massCount, powerConsCount, powerDissCount, unitCostCount,
      lruCount, spareAvailCount, spareDelivCount,
      spareGapCount: spareGapIds.size, spareGapIds,
      overlapCount: overlapIds.size, overlapIds, hasQty,
      docsItemsCount, procItemsCount, engItemsCount, anySpecsCount,
      byId,
    };
  }

  function buildFilteredSubDoc(doc, matchedIds) {
    if (!doc || !Array.isArray(doc.items)) return { items: [] };
    const idSet = matchedIds instanceof Set ? matchedIds : (Array.isArray(matchedIds) ? new Set(matchedIds) : null);
    if (!idSet || !idSet.size) return { items: [] };
    const byId = new Map(doc.items.map(it => [it.id, it]));
    const nearestMatchedAncestor = (it) => {
      let cur = it.parentId ? byId.get(it.parentId) : null;
      let guard = 0;
      while (cur && guard < 200) {
        if (idSet.has(cur.id)) return cur.id;
        cur = cur.parentId ? byId.get(cur.parentId) : null;
        guard++;
      }
      return null;
    };
    return {
      items: doc.items
        .filter(it => idSet.has(it.id))
        .map(it => ({ ...it, parentId: nearestMatchedAncestor(it) })),
    };
  }

  /* Computes non-double-counting SWaP/LRU/Spare subtotals over a subset of matched item IDs. */
  function computeFilteredRollups(doc, matchedIds) {
    if (!doc || !Array.isArray(doc.items) || !matchedIds || !(matchedIds instanceof Set ? matchedIds.size : matchedIds.length)) {
      return computeSwpRollups({ items: [] });
    }
    return computeSwpRollups(buildFilteredSubDoc(doc, matchedIds));
  }

  /* ---------- Pareto Analysis (non-double-counting SWaP-C contributor ranking & 80/20 vital-few breakdown) ---------- */
  const PARETO_METRICS = [
    {
      key: 'unitCost',
      label: 'Cost',
      shortLabel: 'Cost',
      unit: '',
      isCurrency: true,
      financeOnly: true,
      descKey: 'descUnitCost',
      lineKey: 'lineUnitCost',
      color: '#059669',
      rgb: [5, 150, 105],
      softColor: '#a7f3d0',
      softRgb: [167, 243, 208],
      lineColor: '#f59e0b',
      lineRgb: [217, 119, 6],
    },
    {
      key: 'mass',
      label: 'Mass',
      shortLabel: 'Mass',
      unit: 'kg',
      isCurrency: false,
      financeOnly: false,
      descKey: 'descMass',
      lineKey: 'lineMass',
      color: '#4f46e5',
      rgb: [79, 70, 229],
      softColor: '#c7d2fe',
      softRgb: [199, 210, 254],
      lineColor: '#f59e0b',
      lineRgb: [217, 119, 6],
    },
    {
      key: 'powerConsumption',
      label: 'Power Consumption',
      shortLabel: 'Power Cons.',
      unit: 'W',
      isCurrency: false,
      financeOnly: false,
      descKey: 'descPowerCons',
      lineKey: 'linePowerCons',
      color: '#d97706',
      rgb: [217, 119, 6],
      softColor: '#fde68a',
      softRgb: [253, 230, 138],
      lineColor: '#4f46e5',
      lineRgb: [79, 70, 229],
    },
    {
      key: 'powerDissipation',
      label: 'Power Dissipation',
      shortLabel: 'Power Diss.',
      unit: 'W',
      isCurrency: false,
      financeOnly: false,
      descKey: 'descPowerDiss',
      lineKey: 'linePowerDiss',
      color: '#e11d48',
      rgb: [225, 29, 72],
      softColor: '#fecdd3',
      softRgb: [254, 205, 211],
      lineColor: '#4f46e5',
      lineRgb: [79, 70, 229],
    },
  ];

  function canAccessParetoFinance() {
    return typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance();
  }

  function getAvailableParetoMetrics() {
    const allowFin = canAccessParetoFinance();
    return PARETO_METRICS.filter(m => !m.financeOnly || allowFin);
  }

  function resolveParetoMetric(metricKey) {
    return PARETO_METRICS.find(m => m.key === metricKey) || null;
  }

  function extractLeafContributors(workDoc, rollups, metric) {
    const items = (workDoc && Array.isArray(workDoc.items)) ? workDoc.items : [];
    if (!items.length) return [];
    const itemById = new Map(items.map(it => [it.id, it]));
    const childrenByParent = new Map();
    items.forEach(it => {
      const pid = (it.parentId && itemById.has(it.parentId) && it.parentId !== it.id) ? it.parentId : null;
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid).push(it);
    });

    const entries = [];
    const visited = new Set();
    function walk(item, ancQty, stack) {
      if (stack.has(item.id)) return;
      visited.add(item.id);
      stack.add(item.id);
      const q = effQty(item);
      const cumQty = ancQty * q;
      const sub = rollups.byId.get(item.id);
      const hasDesc = Boolean(sub && sub[metric.descKey] !== null);
      if (hasDesc) {
        (childrenByParent.get(item.id) || []).forEach(child => walk(child, cumQty, stack));
      } else if (isNum(item[metric.key]) && item[metric.key] > 0) {
        const val = round4(item[metric.key] * cumQty);
        if (val > 0) {
          const code = String(item.code || '').trim();
          const name = String(item.name || '').trim();
          const acronym = String(item.acronym || '').trim();
          entries.push({
            id: item.id,
            code,
            name,
            acronym,
            deptId: item.deptId || '',
            label: code ? `${code} ${name}` : name,
            shortLabel: acronym && code ? `${code} · ${acronym}` : (code ? `${code} ${name}` : name),
            value: val,
            unitValue: item[metric.key],
            effectiveQty: cumQty,
            itemCount: 1,
            isOthers: false,
          });
        }
      }
      stack.delete(item.id);
    }

    (childrenByParent.get(null) || []).forEach(root => walk(root, 1, new Set()));
    items.forEach(it => { if (!visited.has(it.id)) walk(it, 1, new Set()); });
    return entries;
  }

  /* options?: { groupBy?: 'leaves'|'roots'|'dept', matchedIds?: Set|Array|null, maxBars?: number, db?: object } */
  function computeParetoData(doc, metricKey, options) {
    const opts = options || {};
    const metricDef = resolveParetoMetric(metricKey) || PARETO_METRICS[1];
    const db = opts.db || null;
    const currency = (db && db.settings && (db.settings.currency || db.settings.currencySymbol)) || '€';
    const metric = {
      ...metricDef,
      currency,
      unit: metricDef.isCurrency ? currency : metricDef.unit,
    };
    const groupBy = ['leaves', 'roots', 'dept'].includes(opts.groupBy) ? opts.groupBy : 'leaves';
    const maxBars = typeof opts.maxBars === 'number' && opts.maxBars >= 0 ? Math.floor(opts.maxBars) : 12;
    const isFiltered = Boolean(opts.matchedIds);

    const empty = (restricted) => ({
      metric,
      groupBy,
      isFiltered,
      restricted: Boolean(restricted),
      total: 0,
      contributorCount: 0,
      vitalCount: 0,
      vitalPct: 0,
      vitalShareOfItemsPct: 0,
      bars: [],
      allEntries: [],
    });

    if (metric.financeOnly && !canAccessParetoFinance()) return empty(true);
    if (!doc || !Array.isArray(doc.items) || !doc.items.length) return empty(false);

    const workDoc = isFiltered ? buildFilteredSubDoc(doc, opts.matchedIds) : doc;
    if (!workDoc.items.length) return empty(false);
    const rollups = computeSwpRollups(workDoc);
    const deptMap = new Map(((db && db.departments) || []).map(d => [d.id, d]));

    let rawEntries = [];
    if (groupBy === 'roots') {
      const itemById = new Map(workDoc.items.map(it => [it.id, it]));
      const roots = workDoc.items.filter(it => !(it.parentId && itemById.has(it.parentId) && it.parentId !== it.id));
      const leafEntries = extractLeafContributors(workDoc, rollups, metric);
      const rootOf = (id) => {
        let cur = itemById.get(id);
        let guard = 0;
        while (cur && cur.parentId && itemById.has(cur.parentId) && cur.parentId !== cur.id && guard < 200) {
          cur = itemById.get(cur.parentId);
          guard++;
        }
        return cur ? cur.id : id;
      };
      const countByRoot = new Map();
      leafEntries.forEach(e => {
        const rid = rootOf(e.id);
        countByRoot.set(rid, (countByRoot.get(rid) || 0) + 1);
      });
      roots.forEach(root => {
        const sub = rollups.byId.get(root.id);
        const val = sub
          ? (sub[metric.descKey] !== null ? sub[metric.descKey] : (sub[metric.lineKey] !== null ? sub[metric.lineKey] : 0))
          : 0;
        if (val > 0) {
          const code = String(root.code || '').trim();
          const name = String(root.name || '').trim();
          const acronym = String(root.acronym || '').trim();
          const dept = root.deptId ? deptMap.get(root.deptId) : null;
          rawEntries.push({
            id: root.id,
            code,
            name,
            acronym,
            deptId: root.deptId || '',
            deptColor: dept && dept.color ? dept.color : '',
            label: code ? `${code} ${name}` : name,
            shortLabel: acronym && code ? `${code} · ${acronym}` : (code ? `${code} ${name}` : name),
            value: round4(val),
            unitValue: null,
            effectiveQty: sub ? sub.effQty : 1,
            itemCount: countByRoot.get(root.id) || 1,
            isOthers: false,
          });
        }
      });
    } else if (groupBy === 'dept') {
      const leafEntries = extractLeafContributors(workDoc, rollups, metric);
      const buckets = new Map();
      leafEntries.forEach(e => {
        const key = e.deptId && deptMap.has(e.deptId) ? e.deptId : '__unassigned__';
        if (!buckets.has(key)) {
          const dept = key !== '__unassigned__' ? deptMap.get(key) : null;
          buckets.set(key, {
            id: key,
            code: dept ? String(dept.code || '').trim() : '',
            name: dept ? String(dept.name || '').trim() : 'Unassigned',
            acronym: '',
            deptId: dept ? dept.id : '',
            deptColor: dept && dept.color ? dept.color : '',
            label: dept ? `[${dept.code}] ${dept.name}` : 'Unassigned',
            shortLabel: dept ? `[${dept.code}] ${dept.name}` : 'Unassigned',
            value: 0,
            unitValue: null,
            effectiveQty: null,
            itemCount: 0,
            isOthers: false,
          });
        }
        const b = buckets.get(key);
        b.value = round4(b.value + e.value);
        b.itemCount += 1;
      });
      rawEntries = Array.from(buckets.values()).filter(b => b.value > 0);
    } else {
      rawEntries = extractLeafContributors(workDoc, rollups, metric).map(e => {
        const dept = e.deptId ? deptMap.get(e.deptId) : null;
        return { ...e, deptColor: dept && dept.color ? dept.color : '' };
      });
    }

    if (!rawEntries.length) return empty(false);

    rawEntries.sort((a, b) => (b.value - a.value) || String(a.code || a.label).localeCompare(String(b.code || b.label), undefined, { numeric: true }));

    const total = round4(rawEntries.reduce((sum, e) => sum + e.value, 0));
    if (total <= 0) return empty(false);

    let cumVal = 0;
    let prevCumPct = 0;
    let vitalCount = 0;
    let vitalPct = 0;

    const allEntries = rawEntries.map((e, idx) => {
      cumVal = round4(cumVal + e.value);
      const pct = (e.value / total) * 100;
      const cumPct = idx === rawEntries.length - 1 ? 100 : Math.min(100, (cumVal / total) * 100);
      const vitalFew = prevCumPct < 80;
      if (vitalFew) {
        vitalCount = idx + 1;
        vitalPct = cumPct;
      }
      prevCumPct = cumPct;
      return {
        ...e,
        rank: idx + 1,
        pct: Math.round(pct * 10) / 10,
        cumValue: cumVal,
        cumPct: Math.round(cumPct * 10) / 10,
        vitalFew,
      };
    });

    let bars = allEntries;
    if (maxBars > 1 && allEntries.length > maxBars) {
      const keepCount = maxBars - 1;
      const head = allEntries.slice(0, keepCount);
      const tail = allEntries.slice(keepCount);
      const tailValue = round4(tail.reduce((s, e) => s + e.value, 0));
      const tailItemCount = tail.reduce((s, e) => s + (e.itemCount || 1), 0);
      const lastHeadCum = head.length ? head[head.length - 1].cumValue : 0;
      const tailPct = Math.round(((tailValue / total) * 100) * 10) / 10;
      bars = [
        ...head,
        {
          id: '__others__',
          code: '',
          name: `Others (${tail.length} ${groupBy === 'dept' ? 'depts' : (groupBy === 'roots' ? 'subsystems' : 'items')})`,
          acronym: '',
          deptId: '',
          deptColor: '',
          label: `Others (${tail.length})`,
          shortLabel: `Others (${tail.length})`,
          value: tailValue,
          unitValue: null,
          effectiveQty: null,
          itemCount: tailItemCount,
          otherCount: tail.length,
          rank: keepCount + 1,
          pct: tailPct,
          cumValue: round4(lastHeadCum + tailValue),
          cumPct: 100,
          vitalFew: false,
          isOthers: true,
        },
      ];
    }

    return {
      metric,
      groupBy,
      isFiltered,
      restricted: false,
      total,
      contributorCount: allEntries.length,
      vitalCount,
      vitalPct: Math.round(vitalPct * 10) / 10,
      vitalShareOfItemsPct: Math.round((vitalCount / allEntries.length) * 100),
      bars,
      allEntries,
    };
  }

  function getParetoMetricCounts(doc, options) {
    const opts = options || {};
    const counts = {};
    getAvailableParetoMetrics().forEach(m => {
      const res = computeParetoData(doc, m.key, {
        groupBy: opts.groupBy || 'leaves',
        matchedIds: opts.matchedIds || null,
        maxBars: 0,
        db: opts.db || null,
      });
      counts[m.key] = res.contributorCount;
    });
    return counts;
  }

  P.MATURITY_OPTIONS = MATURITY_OPTIONS;
  P.MATURITY_RANK = MATURITY_RANK;
  P.PARETO_METRICS = PARETO_METRICS;
  P.tree = {
    getChildren, isDescendant, suggestNextCode, reorderItem, renumberTree,
    flattenTreeRows, computeMaturitySummary, getFilteredTreeRows, computeSwpRollups, computeFilteredRollups,
    getAvailableParetoMetrics, computeParetoData, getParetoMetricCounts,
  };
})();
