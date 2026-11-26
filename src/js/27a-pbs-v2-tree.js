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

  function flattenTreeRows(doc, parentId, depth, out) {
    const list = out || [];
    getChildren(doc, parentId || null).forEach(item => {
      list.push({ item, depth: depth || 0 });
      flattenTreeRows(doc, item.id, (depth || 0) + 1, list);
    });
    return list;
  }

  /* milestones: array of { id, date, status }. todayIso: 'YYYY-MM-DD'. */
  function computeMaturitySummary(doc, milestones, todayIso) {
    const counts = { Draft: 0, PDR: 0, CDR: 0, Qualified: 0, Delivered: 0 };
    const empty = { total: 0, counts, qualifiedPct: 0, overdueCount: 0, overdueIds: new Set(), bottleneckMap: new Map() };
    if (!doc || !Array.isArray(doc.items)) return empty;
    const msMap = new Map((milestones || []).map(m => [m.id, m]));
    const overdueIds = new Set();
    doc.items.forEach(it => {
      counts[MATURITY_OPTIONS.includes(it.maturity) ? it.maturity : 'Draft']++;
      const ms = it.milestoneId ? msMap.get(it.milestoneId) : null;
      if (ms && ms.date && todayIso && ms.date < todayIso && ms.status !== 'Done' && ms.status !== 'Completed') {
        overdueIds.add(it.id);
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
    return { total, counts, qualifiedPct: total ? Math.round((done / total) * 100) : 0, overdueCount: overdueIds.size, overdueIds, bottleneckMap };
  }

  /* filter: { search, deptId, maturity, milestoneId }. collapsedIds: Set. Keeps ancestors of matches as context rows. */
  function getFilteredTreeRows(doc, filter, collapsedIds) {
    if (!doc || !Array.isArray(doc.items)) return [];
    const f = filter || {};
    const q = String(f.search || '').trim().toLowerCase();
    const collapsed = collapsedIds || new Set();
    const hasFilter = Boolean(q || f.deptId || f.maturity || f.milestoneId);

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
    doc.items.forEach(it => {
      if (f.deptId && it.deptId !== f.deptId) return;
      if (f.maturity && it.maturity !== f.maturity) return;
      if (f.milestoneId && it.milestoneId !== f.milestoneId) return;
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

  /* Computes SWaP-R project totals, descendant roll-ups per item, and per-domain populated item counts. */
  function computeSwpRollups(doc) {
    const empty = {
      totalMass: null, totalPowerConsumption: null, totalPowerDissipation: null,
      massCount: 0, powerConsCount: 0, powerDissCount: 0,
      lruCount: 0, spareAvailCount: 0, spareDelivCount: 0,
      docsItemsCount: 0, procItemsCount: 0, engItemsCount: 0, anySpecsCount: 0,
      byId: new Map(),
    };
    if (!doc || !Array.isArray(doc.items) || !doc.items.length) return empty;

    let massSum = 0; let massCount = 0;
    let pConsSum = 0; let powerConsCount = 0;
    let pDissSum = 0; let powerDissCount = 0;
    let lruCount = 0; let spareAvailCount = 0; let spareDelivCount = 0;
    let docsItemsCount = 0; let procItemsCount = 0; let engItemsCount = 0; let anySpecsCount = 0;

    doc.items.forEach(it => {
      if (isNum(it.mass)) { massSum += it.mass; massCount++; }
      if (isNum(it.powerConsumption)) { pConsSum += it.powerConsumption; powerConsCount++; }
      if (isNum(it.powerDissipation)) { pDissSum += it.powerDissipation; powerDissCount++; }
      if (it.lru === 'Yes') lruCount++;
      if (it.spareAvailable === 'Yes') spareAvailCount++;
      if (it.spareToDeliver === 'Yes') spareDelivCount++;

      const hasDocs = Boolean(it.description || it.mechDrawing || it.elecDrawing || it.refDoc);
      const hasProc = Boolean(it.manufacturer || it.partNumber || it.procurementStatus || isNum(it.leadTime) || it.componentAlt);
      const hasEng = Boolean(it.heritage || isNum(it.mass) || isNum(it.powerConsumption) || isNum(it.powerDissipation) || isNum(it.mtbf) || it.lru || it.spareAvailable || it.spareToDeliver);
      if (hasDocs) docsItemsCount++;
      if (hasProc) procItemsCount++;
      if (hasEng) engItemsCount++;
      if (hasDocs || hasProc || hasEng || it.acronym) anySpecsCount++;
    });

    const childrenByParent = new Map();
    doc.items.forEach(it => {
      const pid = it.parentId || null;
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
      byId.set(item.id, {
        descMass: dmc ? round4(dm) : null,
        descPowerCons: dpcc ? round4(dpc) : null,
        descPowerDiss: dpdc ? round4(dpd) : null,
      });
      const res = {
        m: dm + (isNum(item.mass) ? item.mass : 0), mc: dmc + (isNum(item.mass) ? 1 : 0),
        pc: dpc + (isNum(item.powerConsumption) ? item.powerConsumption : 0), pcc: dpcc + (isNum(item.powerConsumption) ? 1 : 0),
        pd: dpd + (isNum(item.powerDissipation) ? item.powerDissipation : 0), pdc: dpdc + (isNum(item.powerDissipation) ? 1 : 0),
      };
      memo.set(item.id, res);
      return res;
    }
    doc.items.forEach(it => walkSubtree(it, new Set()));

    return {
      totalMass: massCount ? round4(massSum) : null,
      totalPowerConsumption: powerConsCount ? round4(pConsSum) : null,
      totalPowerDissipation: powerDissCount ? round4(pDissSum) : null,
      massCount, powerConsCount, powerDissCount,
      lruCount, spareAvailCount, spareDelivCount,
      docsItemsCount, procItemsCount, engItemsCount, anySpecsCount,
      byId,
    };
  }

  P.MATURITY_OPTIONS = MATURITY_OPTIONS;
  P.MATURITY_RANK = MATURITY_RANK;
  P.tree = { getChildren, isDescendant, suggestNextCode, reorderItem, flattenTreeRows, computeMaturitySummary, getFilteredTreeRows, computeSwpRollups };
})();
