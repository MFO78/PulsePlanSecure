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
      totalMass: null, totalPowerConsumption: null, totalPowerDissipation: null,
      massCount: 0, powerConsCount: 0, powerDissCount: 0,
      lruCount: 0, spareAvailCount: 0, spareDelivCount: 0,
      spareGapCount: 0, spareGapIds: new Set(),
      overlapCount: 0, overlapIds: new Set(), hasQty: false,
      docsItemsCount: 0, procItemsCount: 0, engItemsCount: 0, anySpecsCount: 0,
      byId: new Map(),
    };
    if (!doc || !Array.isArray(doc.items) || !doc.items.length) return empty;

    let massCount = 0; let powerConsCount = 0; let powerDissCount = 0;
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
      if (isNum(it.qty) && it.qty > 1) hasQty = true;
      if (it.lru === 'Yes') lruCount++;
      if (it.spareAvailable === 'Yes') spareAvailCount++;
      if (it.spareToDeliver === 'Yes') spareDelivCount++;
      if (it.spareToDeliver === 'Yes' && it.spareAvailable === 'No') spareGapIds.add(it.id);

      const hasDocs = Boolean(it.description || it.mechDrawing || it.elecDrawing || it.refDoc);
      const hasProc = Boolean(it.manufacturer || it.partNumber || it.procurementStatus || isNum(it.leadTime) || it.componentAlt);
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
      if (seen.has(item.id)) return { m: 0, mc: 0, pc: 0, pcc: 0, pd: 0, pdc: 0 };
      seen.add(item.id);
      let dm = 0; let dmc = 0;
      let dpc = 0; let dpcc = 0;
      let dpd = 0; let dpdc = 0;
      (childrenByParent.get(item.id) || []).forEach(child => {
        const sub = walkSubtree(child, seen);
        dm += sub.m; dmc += sub.mc;
        dpc += sub.pc; dpcc += sub.pcc;
        dpd += sub.pd; dpdc += sub.pdc;
      });
      seen.delete(item.id);

      const q = effQty(item);
      const hasOwnM = isNum(item.mass); const hasDescM = dmc > 0;
      const hasOwnPc = isNum(item.powerConsumption); const hasDescPc = dpcc > 0;
      const hasOwnPd = isNum(item.powerDissipation); const hasDescPd = dpdc > 0;

      const massOverlap = hasOwnM && hasDescM;
      const powerConsOverlap = hasOwnPc && hasDescPc;
      const powerDissOverlap = hasOwnPd && hasDescPd;
      if (massOverlap || powerConsOverlap || powerDissOverlap) overlapIds.add(item.id);

      const effM = hasDescM ? dm * q : (hasOwnM ? item.mass * q : 0);
      const effPc = hasDescPc ? dpc * q : (hasOwnPc ? item.powerConsumption * q : 0);
      const effPd = hasDescPd ? dpd * q : (hasOwnPd ? item.powerDissipation * q : 0);

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
      });

      const res = {
        m: effM, mc: (hasDescM || hasOwnM) ? 1 : 0,
        pc: effPc, pcc: (hasDescPc || hasOwnPc) ? 1 : 0,
        pd: effPd, pdc: (hasDescPd || hasOwnPd) ? 1 : 0,
      };
      memo.set(item.id, res);
      return res;
    }

    let totalM = 0; let totalMc = 0;
    let totalPc = 0; let totalPcc = 0;
    let totalPd = 0; let totalPdc = 0;
    (childrenByParent.get(null) || []).forEach(root => {
      const sub = walkSubtree(root, new Set());
      totalM += sub.m; totalMc += sub.mc;
      totalPc += sub.pc; totalPcc += sub.pcc;
      totalPd += sub.pd; totalPdc += sub.pdc;
    });
    doc.items.forEach(it => { if (!byId.has(it.id)) walkSubtree(it, new Set()); });

    return {
      totalMass: totalMc ? round4(totalM) : null,
      totalPowerConsumption: totalPcc ? round4(totalPc) : null,
      totalPowerDissipation: totalPdc ? round4(totalPd) : null,
      massCount, powerConsCount, powerDissCount,
      lruCount, spareAvailCount, spareDelivCount,
      spareGapCount: spareGapIds.size, spareGapIds,
      overlapCount: overlapIds.size, overlapIds, hasQty,
      docsItemsCount, procItemsCount, engItemsCount, anySpecsCount,
      byId,
    };
  }

  /* Computes non-double-counting SWaP/LRU/Spare subtotals over a subset of matched item IDs. */
  function computeFilteredRollups(doc, matchedIds) {
    if (!doc || !Array.isArray(doc.items) || !matchedIds || !matchedIds.size) return computeSwpRollups({ items: [] });
    const byId = new Map(doc.items.map(it => [it.id, it]));
    const nearestMatchedAncestor = (it) => {
      let cur = it.parentId ? byId.get(it.parentId) : null;
      let guard = 0;
      while (cur && guard < 200) {
        if (matchedIds.has(cur.id)) return cur.id;
        cur = cur.parentId ? byId.get(cur.parentId) : null;
        guard++;
      }
      return null;
    };
    const subItems = doc.items
      .filter(it => matchedIds.has(it.id))
      .map(it => ({ ...it, parentId: nearestMatchedAncestor(it) }));
    return computeSwpRollups({ items: subItems });
  }

  P.MATURITY_OPTIONS = MATURITY_OPTIONS;
  P.MATURITY_RANK = MATURITY_RANK;
  P.tree = {
    getChildren, isDescendant, suggestNextCode, reorderItem, renumberTree,
    flattenTreeRows, computeMaturitySummary, getFilteredTreeRows, computeSwpRollups, computeFilteredRollups,
  };
})();
