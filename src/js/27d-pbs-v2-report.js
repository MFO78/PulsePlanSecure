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
  function paretoSvgFilename(project, fallbackId, metricKey) { return `pbs_${safeName(project, fallbackId)}_pareto_${P.data.sanitizeFilenamePart(metricKey || 'metric')}.svg`; }
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
      .replace(/\u20AC/g, 'EUR ')
      .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...')
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  }

  function paretoGroupLabel(groupBy) {
    if (groupBy === 'roots') return 'Top-Level Subsystems';
    if (groupBy === 'dept') return 'By Department';
    return 'Contributors (Items)';
  }

  function fmtGroupedNumber(v) {
    if (!isNum(v)) return '0';
    const abs = Math.abs(v);
    const maxFrac = abs >= 1000 ? 0 : (abs >= 10 ? 1 : (abs >= 1 ? 2 : 3));
    try {
      return v.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
    } catch (_e) {
      return fmtNum(v);
    }
  }

  function formatParetoValue(val, metric, forPdf) {
    if (!isNum(val)) return '-';
    const numStr = fmtGroupedNumber(val);
    if (!metric) return forPdf ? pdfSafe(numStr) : numStr;
    if (metric.isCurrency) {
      const sym = String(metric.currency || '€');
      const raw = sym.length > 1 ? `${sym} ${numStr}` : `${sym}${numStr}`;
      return forPdf ? pdfSafe(raw) : raw;
    }
    const raw = metric.unit ? `${numStr} ${metric.unit}` : numStr;
    return forPdf ? pdfSafe(raw) : raw;
  }

  function formatParetoAxisTick(val, metric, forPdf) {
    if (!isNum(val)) return '0';
    const abs = Math.abs(val);
    let compact;
    if (abs >= 1e6) compact = `${fmtNum(Math.round((val / 1e6) * 10) / 10)}M`;
    else if (abs >= 1e4) compact = `${fmtNum(Math.round((val / 1e3) * 10) / 10)}k`;
    else compact = fmtGroupedNumber(val);
    if (metric && metric.isCurrency) {
      const sym = String(metric.currency || '€');
      const raw = sym.length > 1 ? `${sym} ${compact}` : `${sym}${compact}`;
      return forPdf ? pdfSafe(raw) : raw;
    }
    return forPdf ? pdfSafe(compact) : compact;
  }

  function niceParetoMax(maxVal) {
    if (!isNum(maxVal) || maxVal <= 0) return 10;
    const exp = Math.floor(Math.log10(maxVal));
    const mag = Math.pow(10, exp);
    const norm = maxVal / mag;
    let nice;
    if (norm <= 1) nice = 1;
    else if (norm <= 1.2) nice = 1.2;
    else if (norm <= 1.5) nice = 1.5;
    else if (norm <= 2) nice = 2;
    else if (norm <= 2.5) nice = 2.5;
    else if (norm <= 3) nice = 3;
    else if (norm <= 4) nice = 4;
    else if (norm <= 5) nice = 5;
    else if (norm <= 6) nice = 6;
    else if (norm <= 8) nice = 8;
    else nice = 10;
    return nice * mag;
  }

  /* Builds a responsive or standalone dual-axis Pareto SVG diagram (descending bars + cumulative % curve + 80% threshold). */
  function buildParetoSvg(paretoData, opts) {
    const o = opts || {};
    const standalone = Boolean(o.standalone);
    const dark = Boolean(o.darkMode) && !o.printMode && !standalone;
    const W = o.width || 820;
    const headerH = standalone ? 58 : 0;
    const H = (o.height || 340) + headerH;
    const metric = (paretoData && paretoData.metric) || { label: 'Metric', unit: '', color: '#4f46e5', softColor: '#c7d2fe', lineColor: '#f59e0b' };
    const bars = (paretoData && Array.isArray(paretoData.bars)) ? paretoData.bars : [];

    const bg = dark ? '#0f172a' : '#ffffff';
    const plotBg = dark ? '#111c33' : '#f8fafc';
    const gridStroke = dark ? '#334155' : '#e2e8f0';
    const axisText = dark ? '#94a3b8' : '#64748b';
    const labelText = dark ? '#e2e8f0' : '#0f172a';
    const mutedBarFill = dark ? '#334155' : (metric.softColor || '#cbd5e1');
    const othersBarFill = dark ? '#475569' : '#94a3b8';
    const lineColor = metric.lineColor || '#f59e0b';
    const dotInner = dark ? '#0f172a' : '#ffffff';

    const titleStr = o.title || `Pareto Analysis \u2014 ${metric.label}${metric.unit && !metric.isCurrency ? ` (${metric.unit})` : ''}`;
    const vitalStr = paretoData && paretoData.contributorCount > 0
      ? `80/20 Vital Few: Top ${paretoData.vitalCount} of ${paretoData.contributorCount} (${paretoData.vitalShareOfItemsPct}%) drive ${paretoData.vitalPct}% \u00b7 Total ${formatParetoValue(paretoData.total, metric, false)}`
      : 'No recorded values in scope';
    const subtitleStr = o.subtitle || `${paretoGroupLabel(paretoData && paretoData.groupBy)} \u00b7 ${vitalStr}`;

    const sizeAttrs = standalone
      ? `width="${W}" height="${H}"`
      : `width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"`;
    const vbAttr = standalone ? `viewBox="0 0 ${W} ${H}"` : '';

    const headerSvg = standalone
      ? `<rect width="${W}" height="${headerH}" fill="#0f172a"/>
  <rect y="${headerH - 4}" width="${W}" height="4" fill="${xmlEsc(metric.color || '#4f46e5')}"/>
  <text x="20" y="25" font-size="15" font-weight="800" fill="#ffffff">${xmlEsc(titleStr)}</text>
  <text x="20" y="43" font-size="10.5" fill="#cbd5e1">${xmlEsc(subtitleStr)}</text>`
      : '';

    if (!bars.length) {
      const msg = paretoData && paretoData.restricted
        ? 'Financial cost data is restricted for your account.'
        : `No PBS items have positive ${metric.label} values in this scope.`;
      const body = `${headerSvg}
  <rect x="0" y="${headerH}" width="${W}" height="${H - headerH}" fill="${bg}" rx="${standalone ? 0 : 8}"/>
  <text x="${W / 2}" y="${headerH + (H - headerH) / 2 - 4}" text-anchor="middle" font-size="13" font-weight="700" fill="${axisText}">${xmlEsc(msg)}</text>
  <text x="${W / 2}" y="${headerH + (H - headerH) / 2 + 16}" text-anchor="middle" font-size="11" fill="${axisText}">Add ${xmlEsc(metric.label)} values to PBS items to generate the Pareto diagram.</text>`;
      return `${standalone ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''}<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs} ${vbAttr} role="img" aria-label="${xmlEsc(titleStr)}" style="font-family:Inter,system-ui,-apple-system,sans-serif;display:block;max-width:100%;background:${bg}">${body}</svg>`;
    }

    const padL = 72;
    const padR = 58;
    const padT = headerH + 34;
    const padB = 82;
    const plotW = Math.max(240, W - padL - padR);
    const plotH = Math.max(120, H - padT - padB);
    const maxBarVal = Math.max(...bars.map(b => b.value), 0);
    const yMax = niceParetoMax(maxBarVal * 1.12);

    const yVal = (v) => padT + plotH - (Math.min(yMax, Math.max(0, v)) / yMax) * plotH;
    const yPct = (p) => padT + plotH - (Math.min(100, Math.max(0, p)) / 100) * plotH;

    const parts = [];
    if (headerSvg) parts.push(headerSvg);
    parts.push(`<rect x="0" y="${headerH}" width="${W}" height="${H - headerH}" fill="${bg}" rx="${standalone ? 0 : 8}"/>`);
    parts.push(`<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="${plotBg}" rx="4"/>`);

    // Legend row at top of plot
    const legY = headerH + 17;
    parts.push(`<g font-size="10" font-weight="600" fill="${axisText}">
    <rect x="${padL}" y="${legY - 8}" width="10" height="10" rx="2" fill="${xmlEsc(metric.color)}"/>
    <text x="${padL + 14}" y="${legY}">Vital Few (\u226480%)</text>
    <rect x="${padL + 112}" y="${legY - 8}" width="10" height="10" rx="2" fill="${mutedBarFill}" stroke="${xmlEsc(metric.color)}" stroke-width="1"/>
    <text x="${padL + 126}" y="${legY}">Remaining 20%</text>
    <line x1="${padL + 220}" y1="${legY - 3}" x2="${padL + 236}" y2="${legY - 3}" stroke="${xmlEsc(lineColor)}" stroke-width="2.2"/>
    <circle cx="${padL + 228}" cy="${legY - 3}" r="3" fill="${dotInner}" stroke="${xmlEsc(lineColor)}" stroke-width="1.8"/>
    <text x="${padL + 241}" y="${legY}">Cumulative %</text>
    <line x1="${padL + 324}" y1="${legY - 3}" x2="${padL + 340}" y2="${legY - 3}" stroke="#ef4444" stroke-width="1.4" stroke-dasharray="4,3"/>
    <text x="${padL + 345}" y="${legY}">80% Threshold</text>
  </g>`);

    // Gridlines + Left/Right Y-axis ticks (5 steps: 0, 20, 40, 60, 80, 100%)
    for (let i = 0; i <= 5; i++) {
      const pctTick = i * 20;
      const valTick = (yMax * i) / 5;
      const y = yPct(pctTick);
      parts.push(`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="${gridStroke}" stroke-width="${i === 0 ? 1.2 : 0.8}"/>`);
      parts.push(`<text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${axisText}">${xmlEsc(formatParetoAxisTick(valTick, metric, false))}</text>`);
      parts.push(`<text x="${padL + plotW + 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="start" font-size="10" fill="${axisText}">${pctTick}%</text>`);
    }

    // Axis titles
    const leftAxisTitle = metric.isCurrency ? `${metric.label} (${metric.currency})` : `${metric.label} (${metric.unit})`;
    parts.push(`<text x="16" y="${(padT + plotH / 2).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${axisText}" transform="rotate(-90 16 ${(padT + plotH / 2).toFixed(1)})">${xmlEsc(leftAxisTitle)}</text>`);
    parts.push(`<text x="${W - 14}" y="${(padT + plotH / 2).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${axisText}" transform="rotate(90 ${W - 14} ${(padT + plotH / 2).toFixed(1)})">Cumulative %</text>`);

    // Bars
    const slotW = plotW / bars.length;
    const barW = Math.max(10, Math.min(54, slotW * 0.64));
    const showValLabels = bars.length <= 16;
    const pts = [];

    bars.forEach((b, idx) => {
      const cx = padL + slotW * (idx + 0.5);
      const bx = cx - barW / 2;
      const by = yVal(b.value);
      const bh = Math.max(2, padT + plotH - by);
      const fill = b.isOthers ? othersBarFill : (b.vitalFew ? metric.color : mutedBarFill);
      const stroke = b.isOthers ? '#64748b' : metric.color;
      const tipLines = [
        `#${b.rank} ${b.label}`,
        `${metric.label}: ${formatParetoValue(b.value, metric, false)} (${b.pct}% of total)`,
        `Cumulative: ${b.cumPct}%`,
      ];
      if (b.effectiveQty && b.effectiveQty > 1) tipLines.push(`Effective Qty: \u00d7${b.effectiveQty}`);
      if (b.isOthers && b.otherCount) tipLines.push(`Includes ${b.otherCount} remaining entries`);
      else if (b.vitalFew) tipLines.push('Classification: Vital Few (\u226480% driver)');

      parts.push(`<g>
    <title>${xmlEsc(tipLines.join('\n'))}</title>
    <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3.5" fill="${xmlEsc(fill)}" stroke="${xmlEsc(stroke)}" stroke-width="${b.vitalFew ? 0 : 1}"/>
  </g>`);

      if (showValLabels) {
        const valLbl = formatParetoAxisTick(b.value, metric, false);
        const lblY = Math.max(padT + 11, by - 5);
        parts.push(`<text x="${cx.toFixed(1)}" y="${lblY.toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${labelText}">${xmlEsc(valLbl)}</text>`);
      }

      // X-axis label (angled slightly when more than 6 bars for readability)
      const maxChars = bars.length > 14 ? 12 : (bars.length > 8 ? 16 : 20);
      const xLbl = clip(b.shortLabel || b.label, maxChars);
      const xLblY = padT + plotH + 14;
      if (bars.length > 5) {
        parts.push(`<text x="${cx.toFixed(1)}" y="${xLblY.toFixed(1)}" text-anchor="end" font-size="9.5" font-weight="${b.vitalFew ? 700 : 500}" fill="${b.isOthers ? axisText : labelText}" transform="rotate(-32 ${cx.toFixed(1)} ${xLblY.toFixed(1)})"><title>${xmlEsc(b.label)}</title>${xmlEsc(xLbl)}</text>`);
      } else {
        parts.push(`<text x="${cx.toFixed(1)}" y="${(xLblY + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="${b.vitalFew ? 700 : 500}" fill="${b.isOthers ? axisText : labelText}"><title>${xmlEsc(b.label)}</title>${xmlEsc(xLbl)}</text>`);
      }

      pts.push({ cx, cy: yPct(b.cumPct), bar: b });
    });

    // 80% Pareto threshold dashed line (drawn above bars, below cumulative curve)
    const y80 = yPct(80);
    parts.push(`<line x1="${padL}" y1="${y80.toFixed(1)}" x2="${padL + plotW}" y2="${y80.toFixed(1)}" stroke="#ef4444" stroke-width="1.4" stroke-dasharray="5,4"/>`);
    parts.push(`<rect x="${(padL + plotW - 34).toFixed(1)}" y="${(y80 - 15).toFixed(1)}" width="31" height="13" rx="3" fill="#ef4444"/><text x="${(padL + plotW - 18.5).toFixed(1)}" y="${(y80 - 5.5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#ffffff">80%</text>`);

    // Cumulative % polyline + dots
    if (pts.length > 1) {
      const polyPts = pts.map(p => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
      parts.push(`<polyline points="${polyPts}" fill="none" stroke="${xmlEsc(lineColor)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    const labelStep = bars.length > 14 ? 2 : 1;
    pts.forEach((p, idx) => {
      const b = p.bar;
      parts.push(`<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="3.8" fill="${dotInner}" stroke="${xmlEsc(lineColor)}" stroke-width="2"><title>${xmlEsc(`${b.label}: ${b.cumPct}% cumulative`)}</title></circle>`);
      if (idx % labelStep === 0 || idx === pts.length - 1) {
        const py = p.cy < padT + 18 ? p.cy + 14 : p.cy - 8;
        parts.push(`<text x="${p.cx.toFixed(1)}" y="${py.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${xmlEsc(lineColor)}">${Math.round(b.cumPct)}%</text>`);
      }
    });

    return `${standalone ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''}<svg xmlns="http://www.w3.org/2000/svg" ${sizeAttrs} ${vbAttr} role="img" aria-label="${xmlEsc(titleStr)}" style="font-family:Inter,system-ui,-apple-system,sans-serif;display:block;max-width:100%;background:${bg}">
  <title>${xmlEsc(titleStr)}</title>
  ${parts.join('\n  ')}
</svg>`;
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
    if ((typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance()) && isNum(n.unitCost)) lines.push(`Unit Cost: ${fmtNum(n.unitCost)}`);
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
    { key: 'unitCost', label: 'Unit Cost', group: 'proc', w: 54, align: 'right', financeOnly: true, has: it => (typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance()) && isNum(it.unitCost) },
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
    const allowFin = typeof ppCanAccessFinance !== 'function' || ppCanAccessFinance();
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
      activeCols = REPORT_COLS.filter(c => selFieldSet.has(c.key) && (!c.financeOnly || allowFin));
      if (!activeCols.length) activeCols = REPORT_COLS.filter(c => c.key === 'code' || c.key === 'name');
    } else {
      activeCols = REPORT_COLS.filter(c => {
        if (c.financeOnly && !allowFin) return false;
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
          case 'unitCost': {
            if (!allowFin) return '-';
            const m = metricCell(item.unitCost, sub && sub.descUnitCost, sub && sub.descUnitCostUnit, Boolean(sub && sub.unitCostOverlap), Boolean(sub && sub.unitCostOverBudget), effQ);
            if (m.isRollup) rollupCols.add(idx);
            if (m.isWarn) warnCols.add(idx);
            if (m.isErr) errCols.add(idx);
            return m.text;
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

    /* Append a single unified TOTAL (or FILTERED) row directly at the bottom when numeric SWaP / Cost / LRU / Spare columns are present. */
    const hasTotalCols = Boolean(
      totalRollups && (
        (colIdx.mass !== undefined && totalRollups.totalMass !== null)
        || (colIdx.powerConsumption !== undefined && totalRollups.totalPowerConsumption !== null)
        || (colIdx.powerDissipation !== undefined && totalRollups.totalPowerDissipation !== null)
        || (allowFin && colIdx.unitCost !== undefined && totalRollups.totalUnitCost !== null)
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
      const metricKeySet = new Set(['mass', 'powerConsumption', 'powerDissipation', 'unitCost', 'lru', 'spareAvailable', 'spareToDeliver']);
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
          if (col.key === 'unitCost') return (allowFin && totalRollups.totalUnitCost !== null) ? pdfSafe(fmtNum(totalRollups.totalUnitCost)) : '-';
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
    if (allowFin && totalRollups && totalRollups.totalUnitCost !== null) {
      const curSym = (db && db.settings && (db.settings.currency || db.settings.currencySymbol)) || '€';
      swpSub.push(`Cost: ${curSym}${fmtNum(totalRollups.totalUnitCost)}`);
    }
    const scopeTag = isFiltered ? `Filtered (${matchedIdSet.size} of ${allFlat.length} items)` : `${rows.length} item${rows.length === 1 ? '' : 's'}`;
    const viewTag = selFieldSet ? `Selected fields (${activeCols.length})` : (visOptSet ? 'Current columns' : '');

    // Optional Pareto diagrams requested in PDF export options
    const paretoCharts = [];
    const reqPareto = Array.isArray(opts.paretoMetrics) ? opts.paretoMetrics : (opts.paretoMetrics instanceof Set ? Array.from(opts.paretoMetrics) : []);
    if (reqPareto.length && P.tree && typeof P.tree.computeParetoData === 'function') {
      const validKeys = new Set((P.PARETO_METRICS || []).filter(m => !m.financeOnly || allowFin).map(m => m.key));
      const pGroupBy = ['leaves', 'roots', 'dept'].includes(opts.paretoGroupBy) ? opts.paretoGroupBy : 'leaves';
      const pMaxBars = typeof opts.paretoMaxBars === 'number' && opts.paretoMaxBars > 1 ? Math.floor(opts.paretoMaxBars) : 12;
      const seenMetric = new Set();
      reqPareto.forEach(mk => {
        if (!validKeys.has(mk) || seenMetric.has(mk)) return;
        seenMetric.add(mk);
        const data = P.tree.computeParetoData(doc, mk, {
          groupBy: pGroupBy,
          matchedIds: matchedIdSet,
          maxBars: pMaxBars,
          db,
        });
        if (!data.restricted) {
          paretoCharts.push({
            ...data,
            scopeTag,
            projectLabel: `[${project ? project.code : ''}] ${project ? project.name : 'Project'}`,
            dateStr: dateStr || '',
            userName: userName || 'Project Mgr',
          });
        }
      });
    }

    return {
      title: pdfSafe(`Product Breakdown Structure - [${project ? project.code : ''}] ${project ? project.name : 'Project'}`),
      subtitle: pdfSafe(`Revision ${(doc.meta && doc.meta.revision) || 1}  |  ${scopeTag}${viewTag ? `  |  ${viewTag}` : ''}${paretoCharts.length ? `  |  ${paretoCharts.length} Pareto${paretoCharts.length === 1 ? '' : 's'}` : ''}  |  Exported ${dateStr} by ${userName || 'Project Mgr'}${swpSub.length ? `  |  ${swpSub.join('  |  ')}` : ''}`),
      projectColor: project && project.color ? project.color : null,
      cols: activeCols,
      colIdx,
      head: activeCols.map(c => c.label),
      rows,
      totalRow,
      hasOpt,
      isFiltered,
      paretoCharts,
      layout: { pageFormat, pageLabel, neededW, marginX, fontSize, cellPadding },
    };
  }

  /* Draws a crisp pure-vector Pareto chart + ranked breakdown table onto a new landscape PDF page. */
  function renderPdfParetoPage(pdf, chart, model, projRgb) {
    if (typeof pdf.addPage === 'function') pdf.addPage();
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = typeof pdf.internal.pageSize.getHeight === 'function' ? pdf.internal.pageSize.getHeight() : 595;
    const marginX = Math.max(30, (model.layout && model.layout.marginX) || 36);
    const printableW = Math.max(400, pageW - marginX * 2);
    const metric = chart.metric || { label: 'Metric', unit: '', rgb: [79, 70, 229], softRgb: [199, 210, 254], lineRgb: [217, 119, 6] };
    const barRgb = Array.isArray(metric.rgb) ? metric.rgb : [79, 70, 229];
    const softRgb = Array.isArray(metric.softRgb) ? metric.softRgb : tint(barRgb, 0.35);
    const lineRgb = Array.isArray(metric.lineRgb) ? metric.lineRgb : [217, 119, 6];

    const setDraw = (r, g, b) => { if (typeof pdf.setDrawColor === 'function') pdf.setDrawColor(r, g, b); };
    const setLW = (w) => { if (typeof pdf.setLineWidth === 'function') pdf.setLineWidth(w); };
    const drawLine = (x1, y1, x2, y2) => { if (typeof pdf.line === 'function') pdf.line(x1, y1, x2, y2); };
    const setDash = (pat) => { if (typeof pdf.setLineDashPattern === 'function') pdf.setLineDashPattern(pat, 0); };

    // Matching dark banner header
    pdf.setFillColor(15, 23, 42); pdf.rect(0, 0, pageW, 60, 'F');
    pdf.setFillColor(barRgb[0], barRgb[1], barRgb[2]); pdf.rect(0, 56, pageW, 4, 'F');
    const unitNote = metric.isCurrency ? '' : (metric.unit ? ` (${metric.unit})` : '');
    const pTitle = pdfSafe(`Pareto Analysis: ${metric.label}${unitNote}  -  ${chart.projectLabel || model.title}`);
    const vitalSummary = chart.contributorCount > 0
      ? `80/20 Vital Few: Top ${chart.vitalCount} of ${chart.contributorCount} (${chart.vitalShareOfItemsPct}%) drive ${chart.vitalPct}%  |  Total: ${formatParetoValue(chart.total, metric, true)}`
      : 'No recorded values in current scope';
    const pSub = pdfSafe(`${paretoGroupLabel(chart.groupBy)}  |  ${chart.scopeTag || ''}  |  ${vitalSummary}`);
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13.5); pdf.text(pTitle, marginX, 26);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(203, 213, 225); pdf.text(pSub, marginX, 44);

    const bars = Array.isArray(chart.bars) ? chart.bars : [];
    if (!bars.length) {
      pdf.setFillColor(248, 250, 252);
      setDraw(203, 213, 225);
      setLW(0.8);
      pdf.rect(marginX, 90, printableW, 110, 'FD');
      pdf.setTextColor(100, 116, 139);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text(pdfSafe(`No PBS items have positive ${metric.label} values in this scope.`), marginX + printableW / 2, 142, { align: 'center' });
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(pdfSafe(`Populate ${metric.label} values on PBS items to render the Pareto breakdown.`), marginX + printableW / 2, 162, { align: 'center' });
      return;
    }

    // Legend row
    const legY = 76;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    pdf.setFillColor(barRgb[0], barRgb[1], barRgb[2]); pdf.rect(marginX, legY - 7, 9, 8, 'F');
    pdf.text('Vital Few (<=80%)', marginX + 13, legY);
    pdf.setFillColor(softRgb[0], softRgb[1], softRgb[2]); setDraw(barRgb[0], barRgb[1], barRgb[2]); setLW(0.6); pdf.rect(marginX + 104, legY - 7, 9, 8, 'FD');
    pdf.text('Remaining 20%', marginX + 117, legY);
    setDraw(lineRgb[0], lineRgb[1], lineRgb[2]); setLW(1.6); drawLine(marginX + 196, legY - 3, marginX + 210, legY - 3);
    pdf.text('Cumulative %', marginX + 214, legY);
    setDraw(239, 68, 68); setLW(1); setDash([3, 2]); drawLine(marginX + 286, legY - 3, marginX + 300, legY - 3); setDash([]);
    pdf.text('80% Threshold', marginX + 304, legY);

    // Chart plot geometry (upper portion of landscape page, leaving room for compact summary table below)
    const chartTop = 90;
    const chartH = Math.max(155, Math.min(235, Math.floor((pageH - 130) * 0.48)));
    const plotL = marginX + 54;
    const plotR = marginX + printableW - 42;
    const plotW = Math.max(200, plotR - plotL);
    const plotB = chartTop + chartH;

    pdf.setFillColor(248, 250, 252);
    pdf.rect(plotL, chartTop, plotW, chartH, 'F');

    const maxBarVal = Math.max(...bars.map(b => b.value), 0);
    const yMax = niceParetoMax(maxBarVal * 1.14);
    const yForVal = (v) => plotB - (Math.min(yMax, Math.max(0, v)) / yMax) * chartH;
    const yForPct = (p) => plotB - (Math.min(100, Math.max(0, p)) / 100) * chartH;

    // Gridlines + Y-axis labels
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    for (let i = 0; i <= 5; i++) {
      const pctTick = i * 20;
      const valTick = (yMax * i) / 5;
      const y = yForPct(pctTick);
      setDraw(226, 232, 240);
      setLW(i === 0 ? 0.9 : 0.45);
      drawLine(plotL, y, plotR, y);
      pdf.text(formatParetoAxisTick(valTick, metric, true), plotL - 6, y + 2.5, { align: 'right' });
      pdf.text(`${pctTick}%`, plotR + 6, y + 2.5);
    }

    // Bars + X-axis labels
    const slotW = plotW / bars.length;
    const barW = Math.max(12, Math.min(48, slotW * 0.62));
    const pts = [];

    bars.forEach((b, idx) => {
      const cx = plotL + slotW * (idx + 0.5);
      const bx = cx - barW / 2;
      const by = yForVal(b.value);
      const bh = Math.max(1.5, plotB - by);
      if (b.isOthers) {
        pdf.setFillColor(148, 163, 184);
        pdf.rect(bx, by, barW, bh, 'F');
      } else if (b.vitalFew) {
        pdf.setFillColor(barRgb[0], barRgb[1], barRgb[2]);
        pdf.rect(bx, by, barW, bh, 'F');
      } else {
        pdf.setFillColor(softRgb[0], softRgb[1], softRgb[2]);
        setDraw(barRgb[0], barRgb[1], barRgb[2]);
        setLW(0.6);
        pdf.rect(bx, by, barW, bh, 'FD');
      }

      // Bar value label
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(15, 23, 42);
      const valTxt = formatParetoAxisTick(b.value, metric, true);
      pdf.text(valTxt, cx, Math.max(chartTop + 9, by - 3.5), { align: 'center' });

      // X-axis label (2 compact lines if needed, clean without overlapping)
      pdf.setFont('helvetica', b.vitalFew ? 'bold' : 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(b.isOthers ? 100 : 30, b.isOthers ? 116 : 41, b.isOthers ? 139 : 59);
      const maxChars = Math.max(8, Math.floor(slotW / 4.2));
      const rawLbl = pdfSafe(b.shortLabel || b.label);
      const xLbl = clip(rawLbl, maxChars);
      pdf.text(xLbl, cx, plotB + 11, { align: 'center' });
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`${b.pct}%`, cx, plotB + 20, { align: 'center' });

      pts.push({ cx, cy: yForPct(b.cumPct), bar: b });
    });

    // 80% threshold line
    const y80 = yForPct(80);
    setDraw(239, 68, 68);
    setLW(1);
    setDash([4, 3]);
    drawLine(plotL, y80, plotR, y80);
    setDash([]);
    pdf.setFillColor(239, 68, 68);
    pdf.rect(plotR - 26, y80 - 11, 24, 10, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.8);
    pdf.text('80%', plotR - 14, y80 - 3.5, { align: 'center' });

    // Cumulative % polyline + point markers
    setDraw(lineRgb[0], lineRgb[1], lineRgb[2]);
    setLW(1.7);
    for (let i = 1; i < pts.length; i++) {
      drawLine(pts[i - 1].cx, pts[i - 1].cy, pts[i].cx, pts[i].cy);
    }
    pts.forEach((p) => {
      if (typeof pdf.circle === 'function') {
        pdf.setFillColor(255, 255, 255);
        setDraw(lineRgb[0], lineRgb[1], lineRgb[2]);
        setLW(1.3);
        pdf.circle(p.cx, p.cy, 2.7, 'FD');
      }
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(lineRgb[0], lineRgb[1], lineRgb[2]);
      const py = p.cy < chartTop + 14 ? p.cy + 10 : p.cy - 5;
      pdf.text(`${Math.round(p.bar.cumPct)}%`, p.cx, py, { align: 'center' });
    });

    // Ranked Breakdown Table underneath chart
    const showQty = chart.groupBy === 'leaves';
    const valHead = pdfSafe(metric.isCurrency ? `${metric.label}` : `${metric.label} (${metric.unit})`);
    const tHead = showQty
      ? ['#', 'Code', 'Deliverable / Subsystem', 'Eff. Qty', valHead, 'Share %', 'Cum. %', 'Pareto Class']
      : ['#', 'Code', chart.groupBy === 'dept' ? 'Department' : 'Subsystem', 'Items', valHead, 'Share %', 'Cum. %', 'Pareto Class'];
    const tBody = bars.map(b => [
      b.isOthers ? '-' : String(b.rank),
      pdfSafe(b.code || '-'),
      pdfSafe(b.name || b.label),
      showQty ? (b.effectiveQty ? `x${b.effectiveQty}` : '-') : String(b.itemCount || 1),
      formatParetoValue(b.value, metric, true),
      `${b.pct}%`,
      `${b.cumPct}%`,
      b.isOthers ? 'Others' : (b.vitalFew ? 'Vital Few (<=80%)' : 'Remaining 20%'),
    ]);
    tBody.push([
      '',
      'TOTAL',
      pdfSafe(`${chart.contributorCount} contributor${chart.contributorCount === 1 ? '' : 's'}`),
      '',
      formatParetoValue(chart.total, metric, true),
      '100%',
      '100%',
      pdfSafe(`Top ${chart.vitalCount} = ${chart.vitalPct}%`),
    ]);

    pdf.autoTable({
      startY: plotB + 30,
      head: [tHead],
      body: tBody,
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 3.5, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.45 },
      headStyles: { fillColor: barRgb, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 26, fontStyle: 'bold' },
        1: { cellWidth: 52, fontStyle: 'bold' },
        3: { halign: 'right', cellWidth: 46 },
        4: { halign: 'right', cellWidth: 82, fontStyle: 'bold' },
        5: { halign: 'right', cellWidth: 50 },
        6: { halign: 'right', cellWidth: 52, fontStyle: 'bold' },
        7: { halign: 'center', cellWidth: 86 },
      },
      didParseCell(data) {
        if (data.section !== 'body') return;
        const isLast = data.row.index === tBody.length - 1;
        if (isLast) {
          data.cell.styles.fillColor = [226, 232, 240];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [15, 23, 42];
          return;
        }
        const entry = bars[data.row.index];
        if (entry && entry.vitalFew && data.column.index === 7) {
          data.cell.styles.textColor = barRgb;
          data.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawCell() {},
      margin: { left: marginX, right: marginX, bottom: 26 },
    });
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
        if (colIdx.code !== undefined && data.column.index === colIdx.code) {
          const pad = lay.cellPadding;
          const codeIndent = Math.min(20, m.depth * (model.hasOpt ? 3.5 : 5));
          data.cell.styles.cellPadding = { top: pad, right: pad, bottom: pad, left: pad + 4 + codeIndent };
          if (m.depth <= 1) data.cell.styles.fontStyle = 'bold';
        }
        if (colIdx.name !== undefined && data.column.index === colIdx.name) {
          if (m.depth <= 1) data.cell.styles.fontStyle = 'bold';
          const pad = lay.cellPadding;
          const step = model.hasOpt ? 11 : 15;
          const extraForBranch = m.depth > 0 ? 4 : 0;
          const maxIndent = Math.max(36, Math.round((columnStyles[colIdx.name]?.cellWidth || 120) * 0.45));
          const leftIndent = Math.min(maxIndent, m.depth * step + extraForBranch);
          data.cell.styles.cellPadding = { top: pad, right: pad, bottom: pad, left: pad + 2 + leftIndent };
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
        if (data.section !== 'body') return;
        const m = meta[data.row.index];
        if (!m || m.isTotal) return;
        if (data.column.index === 0 && m.deptRgb) {
          pdf.setFillColor(m.deptRgb[0], m.deptRgb[1], m.deptRgb[2]);
          pdf.rect(data.cell.x, data.cell.y, 4, data.cell.height, 'F');
        }
        // Draw crisp vector tree connectors & subtle ancestor guide lines in the Name column
        if (colIdx.name !== undefined && data.column.index === colIdx.name && m.depth > 0 && typeof pdf.line === 'function') {
          const pad = lay.cellPadding;
          const step = model.hasOpt ? 11 : 15;
          const baseX = data.cell.x + pad + 2;
          const midY = data.cell.y + Math.min(data.cell.height / 2, pad + lay.fontSize * 0.65);
          const maxIndent = Math.max(36, Math.round((data.cell.width || 120) * 0.45));
          const branchX = baseX + Math.min(maxIndent - 4, (m.depth - 1) * step + Math.round(step * 0.45));
          const elbowEndX = Math.min(data.cell.x + data.cell.width - pad, branchX + Math.min(step * 0.55 + 2, 9));

          // Subtle ancestor vertical guide lines for deeper nesting (depth >= 2)
          if (m.depth >= 2) {
            if (typeof pdf.setDrawColor === 'function') pdf.setDrawColor(226, 232, 240);
            if (typeof pdf.setLineWidth === 'function') pdf.setLineWidth(0.45);
            for (let lvl = 0; lvl < m.depth - 1; lvl++) {
              const gx = baseX + lvl * step + Math.round(step * 0.45);
              if (gx < branchX - 2) {
                pdf.line(gx, data.cell.y, gx, data.cell.y + data.cell.height);
              }
            }
          }
          // L-shaped connector for the item's own level
          if (typeof pdf.setDrawColor === 'function') pdf.setDrawColor(148, 163, 184);
          if (typeof pdf.setLineWidth === 'function') pdf.setLineWidth(0.7);
          pdf.line(branchX, data.cell.y, branchX, midY);
          pdf.line(branchX, midY, elbowEndX, midY);
        }
      },
      margin: { left: marginX, right: marginX, bottom: 32 },
    });

    if (Array.isArray(model.paretoCharts) && model.paretoCharts.length) {
      model.paretoCharts.forEach(chart => {
        renderPdfParetoPage(pdf, chart, model, projRgb);
      });
    }

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
        let contentHtml = htmlEsc(cell);
        if (idx === 0 && !r.isTotal) styles.push(`border-left:4px solid ${htmlEsc(accent)}`);
        if (col.key === 'code') {
          styles.push('font-family:monospace;font-weight:700');
          if (!r.isTotal && r.depth > 0) styles.push(`padding-left:${8 + Math.min(24, r.depth * (dense ? 5 : 7))}px`);
        }
        if (!r.isTotal && colIdx.name !== undefined && idx === colIdx.name) {
          const stepPx = dense ? 14 : 18;
          styles.push(`padding-left:${8 + r.depth * stepPx}px;font-weight:${r.depth <= 1 ? 700 : 500}`);
          if (r.depth > 0) {
            contentHtml = `<span style="color:#94a3b8;font-family:monospace;margin-right:4px">&#9492;&#9472;</span>${contentHtml}`;
          }
        }
        if (!r.isTotal && colIdx.dept !== undefined && idx === colIdx.dept && r.deptColor) styles.push(`color:${htmlEsc(r.deptColor)};font-weight:600`);
        if (col.align) styles.push(`text-align:${col.align}`);
        if (r.isTotal) styles.push('white-space:nowrap');
        if (r.rollupCols && r.rollupCols.has(idx)) styles.push('font-style:italic;color:#64748b');
        if (r.warnCols && r.warnCols.has(idx)) styles.push('color:#b45309;font-weight:700');
        if (r.errCols && r.errCols.has(idx)) styles.push('color:#be123c;font-weight:700');
        return `<td${styles.length ? ` style="${styles.join(';')}"` : ''}>${contentHtml}</td>`;
      }).join('');
      return `<tr${rowStyle}>${tds}</tr>`;
    }).join('');

    const ths = cols.map(c => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${htmlEsc(c.label)}</th>`).join('');

    const paretoHtml = (Array.isArray(model.paretoCharts) ? model.paretoCharts : []).map(chart => {
      const m = chart.metric || { label: 'Metric', unit: '', color: '#4f46e5' };
      const unitNote = m.isCurrency ? '' : (m.unit ? ` (${m.unit})` : '');
      const svg = buildParetoSvg(chart, { printMode: true, width: 920, height: 310 });
      const showQty = chart.groupBy === 'leaves';
      const vitalNote = chart.contributorCount > 0
        ? `80/20 Vital Few: Top <strong>${chart.vitalCount}</strong> of ${chart.contributorCount} (${chart.vitalShareOfItemsPct}%) drive <strong>${chart.vitalPct}%</strong> &middot; Total: <strong>${htmlEsc(formatParetoValue(chart.total, m, false))}</strong>`
        : 'No recorded values in scope.';
      const pRows = (chart.bars || []).map(b => `<tr>
        <td style="text-align:center;font-weight:700">${b.isOthers ? '\u2014' : b.rank}</td>
        <td style="font-family:monospace;font-weight:700">${htmlEsc(b.code || '\u2014')}</td>
        <td>${htmlEsc(b.name || b.label)}</td>
        <td style="text-align:right">${showQty ? (b.effectiveQty ? `&times;${b.effectiveQty}` : '\u2014') : (b.itemCount || 1)}</td>
        <td style="text-align:right;font-weight:700">${htmlEsc(formatParetoValue(b.value, m, false))}</td>
        <td style="text-align:right">${b.pct}%</td>
        <td style="text-align:right;font-weight:700">${b.cumPct}%</td>
        <td style="text-align:center;font-weight:${b.vitalFew ? 700 : 500};color:${b.vitalFew ? htmlEsc(m.color) : '#64748b'}">${b.isOthers ? 'Others' : (b.vitalFew ? 'Vital Few (\u226480%)' : 'Remaining 20%')}</td>
      </tr>`).join('');
      const tbl = chart.bars && chart.bars.length
        ? `<table style="margin-top:10px"><thead><tr><th style="background:${htmlEsc(m.color)};text-align:center">#</th><th style="background:${htmlEsc(m.color)}">Code</th><th style="background:${htmlEsc(m.color)}">${chart.groupBy === 'dept' ? 'Department' : (chart.groupBy === 'roots' ? 'Subsystem' : 'Deliverable / Subsystem')}</th><th style="background:${htmlEsc(m.color)};text-align:right">${showQty ? 'Eff. Qty' : 'Items'}</th><th style="background:${htmlEsc(m.color)};text-align:right">${htmlEsc(m.label)}${htmlEsc(unitNote)}</th><th style="background:${htmlEsc(m.color)};text-align:right">Share %</th><th style="background:${htmlEsc(m.color)};text-align:right">Cum. %</th><th style="background:${htmlEsc(m.color)};text-align:center">Class</th></tr></thead><tbody>${pRows}<tr style="background:#e2e8f0;font-weight:700"><td></td><td>TOTAL</td><td>${chart.contributorCount} contributor${chart.contributorCount === 1 ? '' : 's'}</td><td></td><td style="text-align:right">${htmlEsc(formatParetoValue(chart.total, m, false))}</td><td style="text-align:right">100%</td><td style="text-align:right">100%</td><td style="text-align:center">Top ${chart.vitalCount} = ${chart.vitalPct}%</td></tr></tbody></table>`
        : '';
      return `<section class="pp-print-pareto"><h2>Pareto Analysis &mdash; ${htmlEsc(m.label)}${htmlEsc(unitNote)}</h2><p>${htmlEsc(paretoGroupLabel(chart.groupBy))} &middot; ${vitalNote}</p><div class="pp-print-pareto-svg">${svg}</div>${tbl}</section>`;
    }).join('');

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${htmlEsc(model.title)}</title>`
      + `<style>@page{size:landscape;margin:10mm}body{font-family:Inter,system-ui,sans-serif;color:#0f172a;margin:20px;font-size:${dense ? '10.5px' : '12px'}}h1{font-size:17px;margin:0 0 4px}h2{font-size:15px;margin:0 0 4px}p{color:#475569;margin:0 0 12px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:${dense ? '4px 5px' : '6px 8px'};text-align:left;vertical-align:top}th{background:#4f46e5;color:#fff;font-size:${dense ? '9.5px' : '11px'};white-space:nowrap}.pp-print-pareto{page-break-before:always;break-before:page;padding-top:4px}.pp-print-pareto-svg{border:1px solid #cbd5e1;border-radius:6px;padding:6px;background:#fff}</style>`
      + `</head><body><h1>${htmlEsc(model.title)}</h1><p>${htmlEsc(model.subtitle)}</p><table><thead><tr>${ths}</tr></thead>`
      + `<tbody>${body || `<tr><td colspan="${cols.length}">No PBS items recorded.</td></tr>`}</tbody></table>${paretoHtml}</body></html>`;
  }

  P.report = {
    REPORT_COLS, svgFilename, paretoSvgFilename, pdfFilename, pdfSafe,
    paretoGroupLabel, formatParetoValue, buildSvg, buildParetoSvg, buildReportModel, renderPdf, buildPrintHtml,
  };
})();
