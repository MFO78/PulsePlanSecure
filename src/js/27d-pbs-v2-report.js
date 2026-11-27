/* PBS v2 - part 4/6: SVG diagram and PDF report builders.
 * Inert: only registers functions on window.__ppPbsV2.report; no DOM access, no downloads, nothing runs at load time. */
(function ppPbsV2ReportPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const MAT_COLORS = { Draft: '#64748b', PDR: '#d97706', CDR: '#4f46e5', Qualified: '#059669', Delivered: '#047857' };
  const MAT_PDF_RGB = { Qualified: [4, 120, 87], Delivered: [4, 120, 87], CDR: [67, 56, 202], PDR: [180, 83, 9] };
  const HERITAGE_SVG = {
    Existing: { bg: '#e2e8f0', fg: '#334155', short: 'EXT' },
    Update: { bg: '#fef3c7', fg: '#92400e', short: 'UPD' },
    New: { bg: '#e0e7ff', fg: '#3730a3', short: 'NEW' },
  };

  const children = (doc, id) => P.tree.getChildren(doc, id);
  const safeName = (project, fallbackId) => P.data.sanitizeFilenamePart(project ? (project.code || project.id) : fallbackId);
  const fmtNum = (v) => (P.data && typeof P.data.formatNum === 'function' ? P.data.formatNum(v) : (v != null ? String(v) : ''));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function svgFilename(project, fallbackId) { return `pbs_${safeName(project, fallbackId)}_diagram.svg`; }
  function pdfFilename(project, fallbackId, dateStr) { return `pbs_${safeName(project, fallbackId)}_${dateStr}.pdf`; }

  function xmlEsc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function htmlEsc(str) { return xmlEsc(str).replace(/&apos;/g, '&#39;'); }
  function clip(s, n) { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}\u2026` : t; }

  function hexToRgb(hex, fallback) {
    const clean = String(hex || '').replace('#', '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(clean)) return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
    return fallback || [79, 70, 229];
  }
  const tint = (rgb, ratio) => rgb.map(c => Math.round(255 - (255 - c) * ratio));

  /* Helvetica in jsPDF only covers Latin-1: map common punctuation and drop the rest. */
  function pdfSafe(str) {
    return String(str ?? '')
      .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  }

  function buildCardTooltip(n, dept) {
    const lines = [`${n.code}${n.acronym ? ` [${n.acronym}]` : ''} — ${n.name}`];
    if (n.isRoot) return lines[0];
    if (n.maturity) lines.push(`Maturity: ${n.maturity}`);
    if (n.heritage) lines.push(`Status: ${n.heritage}`);
    if (dept) lines.push(`Department: [${dept.code}] ${dept.name}`);
    if (n.owner) lines.push(`Owner: ${n.owner}`);
    if (n.description) lines.push(`Description: ${n.description}`);
    if (n.manufacturer) lines.push(`Manufacturer: ${n.manufacturer}`);
    if (n.partNumber) lines.push(`Part Number: ${n.partNumber}`);
    if (n.procurementStatus) lines.push(`Procurement: ${n.procurementStatus}`);
    if (isNum(n.leadTime)) lines.push(`Lead Time: ${fmtNum(n.leadTime)} wks`);
    if (n.componentAlt) lines.push(`Alternative: ${n.componentAlt}`);
    if (isNum(n.qty) && n.qty > 1) lines.push(`Quantity: ${n.qty}`);
    if (isNum(n.mass)) lines.push(`Mass: ${fmtNum(n.mass)} kg`);
    if (isNum(n.powerConsumption)) lines.push(`Power Consumption: ${fmtNum(n.powerConsumption)} W`);
    if (isNum(n.powerDissipation)) lines.push(`Power Dissipation: ${fmtNum(n.powerDissipation)} W`);
    if (isNum(n.mtbf)) lines.push(`MTBF: ${fmtNum(n.mtbf)} h`);
    if (n.lru) lines.push(`LRU: ${n.lru}`);
    if (n.spareAvailable) lines.push(`SPARE Available: ${n.spareAvailable}`);
    if (n.spareToDeliver) lines.push(`SPARE to be Delivered: ${n.spareToDeliver}`);
    if (n.mechDrawing) lines.push(`Mech. Drawing: ${n.mechDrawing}`);
    if (n.elecDrawing) lines.push(`Elec. Drawing: ${n.elecDrawing}`);
    if (n.refDoc) lines.push(`Ref. Document: ${n.refDoc}`);
    if (n.notes) lines.push(`Notes: ${n.notes}`);
    return lines.join('\n');
  }

  /* ---------- Top-down SVG diagram ---------- */
  function buildSvg(doc, project, db, dateStr) {
    const deptMap = new Map(((db && db.departments) || []).map(x => [x.id, x]));
    const rollups = P.tree && typeof P.tree.computeSwpRollups === 'function' ? P.tree.computeSwpRollups(doc) : null;
    const W = 190, H = 74, H_GAP = 24, V_GAP = 42, PAD = 32, HEADER_H = 64;
    const roots = children(doc, null);
    const root = {
      id: '__root__', isRoot: true, code: project ? (project.code || 'PRJ') : 'PBS', name: project ? (project.name || 'Project') : 'Project',
      maturity: '', deptId: '', owner: `${doc.items.length} item${doc.items.length === 1 ? '' : 's'}`,
    };
    const kidsOf = (n) => (n.id === '__root__' ? roots : children(doc, n.id));

    const widths = new Map();
    (function measure(n) {
      const kids = kidsOf(n);
      const w = kids.length ? Math.max(W, kids.reduce((a, k) => a + measure(k), 0) + H_GAP * (kids.length - 1)) : W;
      widths.set(n.id, w);
      return w;
    })(root);

    const pos = new Map();
    let maxY = HEADER_H + H;
    (function place(n, left, depth) {
      const sw = widths.get(n.id);
      const x = left + (sw - W) / 2;
      const y = HEADER_H + PAD + depth * (H + V_GAP);
      pos.set(n.id, { n, x, y });
      maxY = Math.max(maxY, y + H);
      const kids = kidsOf(n);
      if (!kids.length) return;
      const span = kids.reduce((a, k) => a + widths.get(k.id), 0) + H_GAP * (kids.length - 1);
      let cx = left + (sw - span) / 2;
      kids.forEach(k => { place(k, cx, depth + 1); cx += widths.get(k.id) + H_GAP; });
    })(root, PAD, 0);

    const totalW = Math.max(640, widths.get('__root__') + PAD * 2);
    const totalH = maxY + PAD + 16;
    const edges = [];
    const cards = [];
    pos.forEach(({ n, x, y }) => {
      kidsOf(n).forEach(k => {
        const kp = pos.get(k.id);
        const px = x + W / 2, py = y + H, mid = py + V_GAP / 2;
        edges.push(`<path d="M${px},${py} V${mid} H${kp.x + W / 2} V${kp.y}" fill="none" stroke="#94a3b8" stroke-width="1.6"/>`);
      });
      const dept = n.deptId ? deptMap.get(n.deptId) : null;
      const accent = n.isRoot ? (project && project.color ? project.color : '#0f172a') : (dept && dept.color ? dept.color : '#6366f1');
      const sub = n.isRoot ? n.owner : `${dept ? `[${dept.code}] ` : ''}${n.owner || 'Unassigned'}`;
      const badge = n.maturity
        ? `<rect x="${W - 66}" y="8" width="58" height="16" rx="8" fill="${MAT_COLORS[n.maturity] || '#475569'}"/><text x="${W - 37}" y="19.5" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff">${xmlEsc(n.maturity)}</text>`
        : '';
      const hInfo = !n.isRoot && n.heritage && HERITAGE_SVG[n.heritage] ? HERITAGE_SVG[n.heritage] : null;
      const hBadge = hInfo
        ? `<rect x="${W - 36}" y="49" width="28" height="14" rx="4" fill="${hInfo.bg}"/><text x="${W - 22}" y="59" text-anchor="middle" font-size="8" font-weight="700" fill="${hInfo.fg}">${hInfo.short}</text>`
        : '';
      const qtySuffix = !n.isRoot && isNum(n.qty) && n.qty > 1 ? ` \u00d7${n.qty}` : '';
      const codeLabel = !n.isRoot && n.acronym ? clip(`${n.code} \u00b7 ${n.acronym}${qtySuffix}`, 17) : clip(`${n.code}${qtySuffix}`, 15);
      const tip = buildCardTooltip(n, dept);
      cards.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <title>${xmlEsc(tip)}</title>
    <rect width="${W}" height="${H}" rx="10" fill="${n.isRoot ? '#0f172a' : '#ffffff'}" stroke="${n.isRoot ? '#0f172a' : '#cbd5e1'}" stroke-width="1.2"/>
    <rect width="6" height="${H}" rx="3" fill="${xmlEsc(accent)}"/>
    <text x="14" y="20" font-size="10.5" font-weight="700" font-family="ui-monospace,monospace" fill="${n.isRoot ? '#a7f3d0' : '#475569'}">${xmlEsc(codeLabel)}</text>
    ${badge}
    <text x="14" y="42" font-size="12" font-weight="700" fill="${n.isRoot ? '#ffffff' : '#0f172a'}">${xmlEsc(clip(n.name, 26))}</text>
    <text x="14" y="60" font-size="10" fill="${n.isRoot ? '#cbd5e1' : '#64748b'}">${xmlEsc(clip(sub, hBadge ? 21 : 28))}</text>
    ${hBadge}
  </g>`);
    });

    const swpParts = [];
    if (rollups && rollups.totalMass !== null) swpParts.push(`Mass ${fmtNum(rollups.totalMass)} kg`);
    if (rollups && rollups.totalPowerConsumption !== null) swpParts.push(`Power ${fmtNum(rollups.totalPowerConsumption)} W`);
    if (rollups && rollups.totalPowerDissipation !== null) swpParts.push(`Diss. ${fmtNum(rollups.totalPowerDissipation)} W`);
    const title = `PBS Diagram \u2014 ${project ? `[${project.code}] ${project.name}` : 'Project'}`;
    const subtitle = `Revision ${(doc.meta && doc.meta.revision) || 1} \u00b7 ${doc.items.length} items \u00b7 Generated ${dateStr || ''}${swpParts.length ? ` \u00b7 ${swpParts.join(' \u00b7 ')}` : ''}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="${xmlEsc(title)}" style="font-family:Inter,system-ui,-apple-system,sans-serif;background:#f8fafc">
  <title>${xmlEsc(title)}</title>
  <rect width="${totalW}" height="${HEADER_H}" fill="#0f172a"/>
  <text x="${PAD}" y="28" font-size="16" font-weight="800" fill="#ffffff">${xmlEsc(title)}</text>
  <text x="${PAD}" y="47" font-size="11" fill="#cbd5e1">${xmlEsc(subtitle)}</text>
  ${edges.join('\n  ')}
  ${cards.join('\n  ')}
</svg>`;
  }

  /* ---------- PDF / print report (single unified horizontal table with dynamic populated or user-selected columns) ---------- */
  const REPORT_COLS = [
    { key: 'code', label: 'Code', group: 'core', always: true, w: 44, baseW: 54, bold: true, has: it => Boolean(it.code) },
    { key: 'acronym', label: 'Acronym', group: 'core', w: 46, has: it => Boolean(it.acronym) },
    { key: 'name', label: 'Deliverable / Subsystem', group: 'core', always: true, w: 132, baseW: 195, has: it => Boolean(it.name) },
    { key: 'heritage', label: 'Status', group: 'swp', w: 48, align: 'center', has: it => Boolean(it.heritage) },
    { key: 'maturity', label: 'Maturity', group: 'core', always: true, w: 54, baseW: 66, bold: true, has: it => Boolean(it.maturity) },
    { key: 'dept', label: 'Department', group: 'core', always: true, w: 80, baseW: 115, has: it => Boolean(it.deptId) },
    { key: 'owner', label: 'Owner', group: 'core', always: true, w: 62, baseW: 85, has: it => Boolean(it.owner) },
    { key: 'milestone', label: 'Milestone', group: 'core', always: true, w: 84, baseW: 120, has: it => Boolean(it.milestoneId) },
    { key: 'description', label: 'Description', group: 'docs', w: 112, has: it => Boolean(it.description) },
    { key: 'mechDrawing', label: 'Mech. Dwg', group: 'docs', w: 74, has: it => Boolean(it.mechDrawing) },
    { key: 'elecDrawing', label: 'Elec. Dwg', group: 'docs', w: 74, has: it => Boolean(it.elecDrawing) },
    { key: 'refDoc', label: 'Ref. Doc', group: 'docs', w: 76, has: it => Boolean(it.refDoc) },
    { key: 'manufacturer', label: 'Manufacturer', group: 'proc', w: 74, has: it => Boolean(it.manufacturer) },
    { key: 'partNumber', label: 'Part No.', group: 'proc', w: 80, has: it => Boolean(it.partNumber) },
    { key: 'procurementStatus', label: 'Proc. Status', group: 'proc', w: 66, has: it => Boolean(it.procurementStatus) },
    { key: 'leadTime', label: 'Lead (wks)', group: 'proc', w: 52, align: 'right', has: it => isNum(it.leadTime) },
    { key: 'componentAlt', label: 'Alternative', group: 'proc', w: 80, has: it => Boolean(it.componentAlt) },
    { key: 'qty', label: 'Qty', group: 'swp', w: 30, align: 'right', has: it => isNum(it.qty) && it.qty > 1 },
    { key: 'mass', label: 'Mass (kg)', group: 'swp', w: 54, align: 'right', has: it => isNum(it.mass) },
    { key: 'powerConsumption', label: 'Pwr Cons (W)', group: 'swp', w: 56, align: 'right', has: it => isNum(it.powerConsumption) },
    { key: 'powerDissipation', label: 'Pwr Diss (W)', group: 'swp', w: 56, align: 'right', has: it => isNum(it.powerDissipation) },
    { key: 'mtbf', label: 'MTBF (h)', group: 'swp', w: 52, align: 'right', has: it => isNum(it.mtbf) },
    { key: 'lru', label: 'LRU', group: 'swp', w: 40, align: 'center', has: it => Boolean(it.lru) },
    { key: 'spareAvailable', label: 'Spare Avail.', group: 'swp', w: 44, align: 'center', has: it => Boolean(it.spareAvailable) },
    { key: 'spareToDeliver', label: 'Spare Deliv.', group: 'swp', w: 48, align: 'center', has: it => Boolean(it.spareToDeliver) },
    { key: 'notes', label: 'Notes', group: 'core', always: true, w: 90, auto: true, has: it => Boolean(it.notes) },
  ];

  const round4 = (n) => Math.round(n * 10000) / 10000;

  /* options?: { selectedFieldKeys?: Set|Array, visibleOptKeys?: Set|Array, rowIds?: Set|Array, matchedIds?: Set|Array, todayIso?: string } */
  function buildReportModel(doc, project, db, userName, dateStr, options) {
    const opts = options || {};
    const deptMap = new Map(((db && db.departments) || []).map(d => [d.id, d]));
    const msMap = new Map(((db && db.milestones) || []).map(m => [m.id, m]));
    const fullRollups = P.tree && typeof P.tree.computeSwpRollups === 'function' ? P.tree.computeSwpRollups(doc) : null;
    const summary = P.tree && typeof P.tree.computeMaturitySummary === 'function'
      ? P.tree.computeMaturitySummary(doc, (db && db.milestones) || [], opts.todayIso || dateStr || '')
      : null;

    const allFlat = P.tree.flattenTreeRows(doc, null, 0, []);
    const rowIdSet = opts.rowIds ? new Set(opts.rowIds) : null;
    const matchedIdSet = opts.matchedIds ? new Set(opts.matchedIds) : null;
    const flat = rowIdSet ? allFlat.filter(({ item }) => rowIdSet.has(item.id)) : allFlat;
    const isFiltered = Boolean(matchedIdSet);
    const totalRollups = (isFiltered && P.tree && typeof P.tree.computeFilteredRollups === 'function')
      ? P.tree.computeFilteredRollups(doc, matchedIdSet)
      : fullRollups;

    const selFieldSet = opts.selectedFieldKeys
      ? (opts.selectedFieldKeys instanceof Set ? opts.selectedFieldKeys : new Set(opts.selectedFieldKeys))
      : null;
    const visOptSet = !selFieldSet && opts.visibleOptKeys ? new Set(opts.visibleOptKeys) : null;
    let activeCols;
    if (selFieldSet) {
      activeCols = REPORT_COLS.filter(c => selFieldSet.has(c.key));
      if (!activeCols.length) activeCols = REPORT_COLS.filter(c => c.key === 'code' || c.key === 'name');
    } else {
      activeCols = REPORT_COLS.filter(c => {
        if (c.always) return true;
        if (visOptSet && !visOptSet.has(c.key)) return false;
        return flat.some(({ item }) => c.has(item));
      });
    }
    const hasOpt = activeCols.some(c => !c.always);
    const colIdx = {};
    activeCols.forEach((c, i) => { colIdx[c.key] = i; });

    const metricCell = (own, desc, descUnit, overlap, overBudget, effQ) => {
      if (overlap) {
        const qNote = effQ > 1 ? ` (${effQ}x${fmtNum(descUnit)})` : '';
        return { text: pdfSafe(`Sum ${fmtNum(desc)}${qNote} [vs ${fmtNum(own)}]`), isRollup: true, isWarn: !overBudget, isErr: overBudget };
      }
      if (isNum(own)) {
        if (effQ > 1) return { text: pdfSafe(`${fmtNum(round4(own * effQ))} (${effQ}x${fmtNum(own)})`), isRollup: false, isWarn: false, isErr: false };
        return { text: pdfSafe(fmtNum(own)), isRollup: false, isWarn: false, isErr: false };
      }
      if (isNum(desc)) {
        const qNote = effQ > 1 ? ` (${effQ}x${fmtNum(descUnit)})` : '';
        return { text: pdfSafe(`Sum ${fmtNum(desc)}${qNote}`), isRollup: true, isWarn: false, isErr: false };
      }
      return { text: '-', isRollup: false, isWarn: false, isErr: false };
    };

    const rows = flat.map(({ item, depth }) => {
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      const sub = fullRollups && fullRollups.byId ? fullRollups.byId.get(item.id) : null;
      const effQ = sub ? sub.effQty : ((isNum(item.qty) && item.qty > 1) ? item.qty : 1);
      const leadRisk = summary && summary.leadRiskMap ? summary.leadRiskMap.get(item.id) : null;
      const isSpareGap = Boolean(fullRollups && fullRollups.spareGapIds && fullRollups.spareGapIds.has(item.id));
      const isContext = Boolean(matchedIdSet && !matchedIdSet.has(item.id));
      const rollupCols = new Set();
      const warnCols = new Set();
      const errCols = new Set();

      const cells = activeCols.map((col, idx) => {
        switch (col.key) {
          case 'code': return pdfSafe(item.code);
          case 'acronym': return item.acronym ? pdfSafe(item.acronym) : '-';
          case 'name': return pdfSafe(item.name);
          case 'heritage': return item.heritage ? pdfSafe(item.heritage) : '-';
          case 'maturity': return pdfSafe(item.maturity);
          case 'dept': return dept ? pdfSafe(`[${dept.code}] ${dept.name}`) : '-';
          case 'owner': return item.owner ? pdfSafe(item.owner) : '-';
          case 'milestone': return ms ? pdfSafe(`${ms.title}${ms.date ? ` (${ms.date})` : ''}`) : '-';
          case 'description': return item.description ? pdfSafe(item.description) : '-';
          case 'mechDrawing': return item.mechDrawing ? pdfSafe(item.mechDrawing) : '-';
          case 'elecDrawing': return item.elecDrawing ? pdfSafe(item.elecDrawing) : '-';
          case 'refDoc': return item.refDoc ? pdfSafe(item.refDoc) : '-';
          case 'manufacturer': return item.manufacturer ? pdfSafe(item.manufacturer) : '-';
          case 'partNumber': return item.partNumber ? pdfSafe(item.partNumber) : '-';
          case 'procurementStatus': return item.procurementStatus ? pdfSafe(item.procurementStatus) : '-';
          case 'leadTime': {
            if (!isNum(item.leadTime)) return '-';
            if (leadRisk) {
              errCols.add(idx);
              return pdfSafe(`${fmtNum(item.leadTime)} (+${leadRisk.slipWeeks}w!)`);
            }
            return pdfSafe(fmtNum(item.leadTime));
          }
          case 'componentAlt': return item.componentAlt ? pdfSafe(item.componentAlt) : '-';
          case 'qty': return isNum(item.qty) && item.qty > 1 ? String(item.qty) : (isNum(item.qty) ? '1' : '-');
          case 'mass': {
            const m = metricCell(item.mass, sub && sub.descMass, sub && sub.descMassUnit, Boolean(sub && sub.massOverlap), Boolean(sub && sub.massOverBudget), effQ);
            if (m.isRollup) rollupCols.add(idx);
            if (m.isWarn) warnCols.add(idx);
            if (m.isErr) errCols.add(idx);
            return m.text;
          }
          case 'powerConsumption': {
            const m = metricCell(item.powerConsumption, sub && sub.descPowerCons, sub && sub.descPowerConsUnit, Boolean(sub && sub.powerConsOverlap), Boolean(sub && sub.powerConsOverBudget), effQ);
            if (m.isRollup) rollupCols.add(idx);
            if (m.isWarn) warnCols.add(idx);
            if (m.isErr) errCols.add(idx);
            return m.text;
          }
          case 'powerDissipation': {
            const m = metricCell(item.powerDissipation, sub && sub.descPowerDiss, sub && sub.descPowerDissUnit, Boolean(sub && sub.powerDissOverlap), Boolean(sub && sub.powerDissOverBudget), effQ);
            if (m.isRollup) rollupCols.add(idx);
            if (m.isWarn) warnCols.add(idx);
            if (m.isErr) errCols.add(idx);
            return m.text;
          }
          case 'mtbf': return isNum(item.mtbf) ? pdfSafe(fmtNum(item.mtbf)) : '-';
          case 'lru': return item.lru ? pdfSafe(item.lru) : '-';
          case 'spareAvailable': return item.spareAvailable ? pdfSafe(item.spareAvailable) : '-';
          case 'spareToDeliver': {
            if (!item.spareToDeliver) return '-';
            if (isSpareGap) { warnCols.add(idx); return 'Yes (!)'; }
            return pdfSafe(item.spareToDeliver);
          }
          case 'notes': return pdfSafe(item.notes || '');
          default: return '';
        }
      });

      return {
        depth,
        maturity: item.maturity,
        deptColor: dept && dept.color ? dept.color : null,
        isTotal: false,
        isContext,
        rollupCols,
        warnCols,
        errCols,
        cells,
      };
    });

    /* Append a single unified TOTAL (or FILTERED) row directly at the bottom when numeric SWaP / LRU / Spare columns are present. */
    const hasTotalCols = Boolean(
      totalRollups && (
        (colIdx.mass !== undefined && totalRollups.totalMass !== null)
        || (colIdx.powerConsumption !== undefined && totalRollups.totalPowerConsumption !== null)
        || (colIdx.powerDissipation !== undefined && totalRollups.totalPowerDissipation !== null)
        || (colIdx.lru !== undefined && totalRollups.lruCount > 0)
        || (colIdx.spareAvailable !== undefined && totalRollups.spareAvailCount > 0)
        || (colIdx.spareToDeliver !== undefined && totalRollups.spareDelivCount > 0)
      )
    );
    const itemCountLabel = isFiltered
      ? `${matchedIdSet.size} / ${allFlat.length} items`
      : `${rows.length} item${rows.length === 1 ? '' : 's'}`;
    let totalRow = null;
    if (hasTotalCols && rows.length) {
      const totalLabel = isFiltered ? 'FILTERED' : 'TOTAL';
      const metricKeySet = new Set(['mass', 'powerConsumption', 'powerDissipation', 'lru', 'spareAvailable', 'spareToDeliver']);
      const fallbackLabelIdx = colIdx.code === undefined ? activeCols.findIndex(c => !metricKeySet.has(c.key)) : -1;
      totalRow = {
        depth: 0, maturity: '', deptColor: null, isTotal: true, isContext: false,
        rollupCols: new Set(), warnCols: new Set(), errCols: new Set(),
        cells: activeCols.map((col, idx) => {
          if (col.key === 'code') return totalLabel;
          if (col.key === 'name') return idx === fallbackLabelIdx ? pdfSafe(`${totalLabel} (${itemCountLabel})`) : pdfSafe(itemCountLabel);
          if (idx === fallbackLabelIdx) return totalLabel;
          if (col.key === 'mass') return totalRollups.totalMass !== null ? pdfSafe(fmtNum(totalRollups.totalMass)) : '-';
          if (col.key === 'powerConsumption') return totalRollups.totalPowerConsumption !== null ? pdfSafe(fmtNum(totalRollups.totalPowerConsumption)) : '-';
          if (col.key === 'powerDissipation') return totalRollups.totalPowerDissipation !== null ? pdfSafe(fmtNum(totalRollups.totalPowerDissipation)) : '-';
          if (col.key === 'lru') return totalRollups.lruCount ? `${totalRollups.lruCount} Yes` : '-';
          if (col.key === 'spareAvailable') return totalRollups.spareAvailCount ? `${totalRollups.spareAvailCount} Yes` : '-';
          if (col.key === 'spareToDeliver') return totalRollups.spareDelivCount ? `${totalRollups.spareDelivCount} Yes` : '-';
          return '';
        }),
      };
    }

    const neededW = activeCols.reduce((sum, c) => sum + (hasOpt ? c.w : (c.baseW || c.w)), 0);
    const marginX = hasOpt && activeCols.length > 12 ? 24 : 36;
    let pageFormat = 'a4';
    let pageLabel = 'A4 Landscape';
    let fontSize = hasOpt ? 8 : 8.5;
    let cellPadding = hasOpt ? 4.5 : 6;
    if (neededW > 770) {
      if (neededW <= 1142) {
        pageFormat = 'a3';
        pageLabel = 'A3 Landscape';
        fontSize = 7.8;
        cellPadding = 4.5;
      } else {
        const customW = Math.min(1860, Math.ceil(neededW + marginX * 2 + 16));
        pageFormat = [customW, 842];
        pageLabel = 'Wide Landscape';
        fontSize = 7.4;
        cellPadding = 4;
      }
    }

    const swpSub = [];
    if (totalRollups && totalRollups.totalMass !== null) swpSub.push(`Mass: ${fmtNum(totalRollups.totalMass)} kg`);
    if (totalRollups && totalRollups.totalPowerConsumption !== null) swpSub.push(`Power: ${fmtNum(totalRollups.totalPowerConsumption)} W`);
    if (totalRollups && totalRollups.totalPowerDissipation !== null) swpSub.push(`Diss.: ${fmtNum(totalRollups.totalPowerDissipation)} W`);
    const scopeTag = isFiltered ? `Filtered (${matchedIdSet.size} of ${allFlat.length} items)` : `${rows.length} item${rows.length === 1 ? '' : 's'}`;
    const viewTag = selFieldSet ? `Selected fields (${activeCols.length})` : (visOptSet ? 'Current columns' : '');

    return {
      title: pdfSafe(`Product Breakdown Structure - [${project ? project.code : ''}] ${project ? project.name : 'Project'}`),
      subtitle: pdfSafe(`Revision ${(doc.meta && doc.meta.revision) || 1}  |  ${scopeTag}${viewTag ? `  |  ${viewTag}` : ''}  |  Exported ${dateStr} by ${userName || 'Project Mgr'}${swpSub.length ? `  |  ${swpSub.join('  |  ')}` : ''}`),
      projectColor: project && project.color ? project.color : null,
      cols: activeCols,
      colIdx,
      head: activeCols.map(c => c.label),
      rows,
      totalRow,
      hasOpt,
      isFiltered,
      layout: { pageFormat, pageLabel, neededW, marginX, fontSize, cellPadding },
    };
  }

  /* JsPdf = window.jspdf.jsPDF. Returns the jsPDF instance (caller calls .save(filename)). Throws if autoTable is missing. */
  function renderPdf(JsPdf, model) {
    const projRgb = hexToRgb(model.projectColor, [79, 70, 229]);
    const lay = model.layout || { pageFormat: 'a4', marginX: 36, fontSize: 8.5, cellPadding: 6 };
    const pdf = new JsPdf({ orientation: 'landscape', unit: 'pt', format: lay.pageFormat });
    if (typeof pdf.autoTable !== 'function') throw new Error('PDF table plugin (autoTable) is not available.');
    const pageW = pdf.internal.pageSize.getWidth();
    const marginX = lay.marginX;
    const printableW = Math.max(400, pageW - marginX * 2);

    pdf.setFillColor(15, 23, 42); pdf.rect(0, 0, pageW, 64, 'F');
    pdf.setFillColor(projRgb[0], projRgb[1], projRgb[2]); pdf.rect(0, 60, pageW, 4, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.text(model.title, marginX, 28);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(203, 213, 225); pdf.text(model.subtitle, marginX, 46);

    const cols = model.cols || REPORT_COLS.filter(c => c.always);
    const colIdx = model.colIdx || { code: 0, name: 1, maturity: 2, dept: 3 };
    const rawTotalW = cols.reduce((sum, c) => sum + (model.hasOpt ? c.w : (c.baseW || c.w)), 0);
    const scale = rawTotalW > printableW ? (printableW / rawTotalW) : 1;
    const columnStyles = {};
    cols.forEach((c, i) => {
      const style = {};
      if (c.auto && scale >= 1) style.cellWidth = 'auto';
      else style.cellWidth = Math.max(28, Math.floor((model.hasOpt ? c.w : (c.baseW || c.w)) * scale));
      if (c.bold) style.fontStyle = 'bold';
      if (c.align) style.halign = c.align;
      columnStyles[i] = style;
    });

    const allRows = model.totalRow ? [...model.rows, model.totalRow] : model.rows;
    const emptyMsgCol = colIdx.name !== undefined ? colIdx.name : 0;
    const emptyBodyRow = cols.map((c, i) => (i === emptyMsgCol ? 'No PBS items recorded' : (c.key === 'notes' ? '' : '-')));
    const meta = allRows.map(r => ({
      depth: r.depth, maturity: r.maturity, isTotal: Boolean(r.isTotal), isContext: Boolean(r.isContext),
      rollupCols: r.rollupCols || new Set(),
      warnCols: r.warnCols || new Set(),
      errCols: r.errCols || new Set(),
      deptRgb: r.deptColor ? hexToRgb(r.deptColor) : null,
    }));

    pdf.autoTable({
      startY: 78,
      head: [model.head],
      body: allRows.length ? allRows.map(r => r.cells) : [emptyBodyRow],
      styles: { font: 'helvetica', fontSize: lay.fontSize, cellPadding: lay.cellPadding, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.5, overflow: 'linebreak' },
      headStyles: { fillColor: projRgb, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: Math.max(7, lay.fontSize - 0.3) },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles,
      didParseCell(data) {
        if (data.section !== 'body') return;
        const m = meta[data.row.index];
        if (!m) return;
        if (m.isTotal) {
          data.cell.styles.fillColor = [226, 232, 240];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [15, 23, 42];
          return;
        }
        if (m.isContext) data.cell.styles.textColor = [100, 116, 139];
        if (m.deptRgb) {
          data.cell.styles.fillColor = tint(m.deptRgb, 0.11);
          if (colIdx.dept !== undefined && data.column.index === colIdx.dept) { data.cell.styles.textColor = m.deptRgb; data.cell.styles.fontStyle = 'bold'; }
        }
        if (colIdx.name !== undefined && data.column.index === colIdx.name) {
          if (m.depth === 0) data.cell.styles.fontStyle = 'bold';
          const pad = lay.cellPadding;
          data.cell.styles.cellPadding = { top: pad, right: pad, bottom: pad, left: pad + 2 + m.depth * (model.hasOpt ? 10 : 14) };
        }
        if (colIdx.maturity !== undefined && data.column.index === colIdx.maturity) data.cell.styles.textColor = MAT_PDF_RGB[m.maturity] || [100, 116, 139];
        if (m.rollupCols && m.rollupCols.has(data.column.index)) {
          data.cell.styles.fontStyle = 'italic';
          data.cell.styles.textColor = [100, 116, 139];
        }
        if (m.warnCols && m.warnCols.has(data.column.index)) {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fontStyle = 'bold';
        }
        if (m.errCols && m.errCols.has(data.column.index)) {
          data.cell.styles.textColor = [190, 18, 60];
          data.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawCell(data) {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const m = meta[data.row.index];
        if (m && !m.isTotal && m.deptRgb) { pdf.setFillColor(m.deptRgb[0], m.deptRgb[1], m.deptRgb[2]); pdf.rect(data.cell.x, data.cell.y, 4, data.cell.height, 'F'); }
      },
      margin: { left: marginX, right: marginX, bottom: 32 },
    });

    return pdf;
  }

  /* Offline fallback: a standalone, print-ready HTML document (caller opens it in a window and prints). */
  function buildPrintHtml(model) {
    const cols = model.cols || REPORT_COLS.filter(c => c.always);
    const colIdx = model.colIdx || { code: 0, name: 1, maturity: 2, dept: 3 };
    const allRows = model.totalRow ? [...model.rows, model.totalRow] : model.rows;
    const dense = cols.length > 10;

    const body = allRows.map(r => {
      const accent = r.deptColor || '#cbd5e1';
      const rowStyle = r.isTotal ? ' style="background:#e2e8f0;font-weight:700"' : (r.isContext ? ' style="opacity:.65"' : '');
      const tds = r.cells.map((cell, idx) => {
        const col = cols[idx] || {};
        const styles = [];
        if (idx === 0 && !r.isTotal) styles.push(`border-left:4px solid ${htmlEsc(accent)}`);
        if (col.key === 'code') styles.push('font-family:monospace;font-weight:700');
        if (!r.isTotal && colIdx.name !== undefined && idx === colIdx.name) styles.push(`padding-left:${8 + r.depth * (dense ? 12 : 16)}px;font-weight:${r.depth === 0 ? 700 : 500}`);
        if (!r.isTotal && colIdx.dept !== undefined && idx === colIdx.dept && r.deptColor) styles.push(`color:${htmlEsc(r.deptColor)};font-weight:600`);
        if (col.align) styles.push(`text-align:${col.align}`);
        if (r.isTotal) styles.push('white-space:nowrap');
        if (r.rollupCols && r.rollupCols.has(idx)) styles.push('font-style:italic;color:#64748b');
        if (r.warnCols && r.warnCols.has(idx)) styles.push('color:#b45309;font-weight:700');
        if (r.errCols && r.errCols.has(idx)) styles.push('color:#be123c;font-weight:700');
        return `<td${styles.length ? ` style="${styles.join(';')}"` : ''}>${htmlEsc(cell)}</td>`;
      }).join('');
      return `<tr${rowStyle}>${tds}</tr>`;
    }).join('');

    const ths = cols.map(c => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${htmlEsc(c.label)}</th>`).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${htmlEsc(model.title)}</title>`
      + `<style>@page{size:landscape;margin:10mm}body{font-family:Inter,system-ui,sans-serif;color:#0f172a;margin:20px;font-size:${dense ? '10.5px' : '12px'}}h1{font-size:17px;margin:0 0 4px}p{color:#475569;margin:0 0 14px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:${dense ? '4px 5px' : '6px 8px'};text-align:left;vertical-align:top}th{background:#4f46e5;color:#fff;font-size:${dense ? '9.5px' : '11px'};white-space:nowrap}</style>`
      + `</head><body><h1>${htmlEsc(model.title)}</h1><p>${htmlEsc(model.subtitle)}</p><table><thead><tr>${ths}</tr></thead>`
      + `<tbody>${body || `<tr><td colspan="${cols.length}">No PBS items recorded.</td></tr>`}</tbody></table></body></html>`;
  }

  P.report = { REPORT_COLS, svgFilename, pdfFilename, pdfSafe, buildSvg, buildReportModel, renderPdf, buildPrintHtml };
})();
