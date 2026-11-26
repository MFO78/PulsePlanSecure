/* PBS v2 - part 4/6: SVG diagram and PDF report builders.
 * Inert: only registers functions on window.__ppPbsV2.report; no DOM access, no downloads, nothing runs at load time. */
(function ppPbsV2ReportPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const MAT_COLORS = { Draft: '#64748b', PDR: '#d97706', CDR: '#4f46e5', Qualified: '#059669', Delivered: '#047857' };
  const MAT_PDF_RGB = { Qualified: [4, 120, 87], Delivered: [4, 120, 87], CDR: [67, 56, 202], PDR: [180, 83, 9] };

  const children = (doc, id) => P.tree.getChildren(doc, id);
  const safeName = (project, fallbackId) => P.data.sanitizeFilenamePart(project ? (project.code || project.id) : fallbackId);

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

  /* ---------- Top-down SVG diagram ---------- */
  function buildSvg(doc, project, db, dateStr) {
    const deptMap = new Map(((db && db.departments) || []).map(x => [x.id, x]));
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
      cards.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <rect width="${W}" height="${H}" rx="10" fill="${n.isRoot ? '#0f172a' : '#ffffff'}" stroke="${n.isRoot ? '#0f172a' : '#cbd5e1'}" stroke-width="1.2"/>
    <rect width="6" height="${H}" rx="3" fill="${xmlEsc(accent)}"/>
    <text x="14" y="20" font-size="10.5" font-weight="700" font-family="ui-monospace,monospace" fill="${n.isRoot ? '#a7f3d0' : '#475569'}">${xmlEsc(clip(n.code, 12))}</text>
    ${badge}
    <text x="14" y="42" font-size="12" font-weight="700" fill="${n.isRoot ? '#ffffff' : '#0f172a'}">${xmlEsc(clip(n.name, 26))}</text>
    <text x="14" y="60" font-size="10" fill="${n.isRoot ? '#cbd5e1' : '#64748b'}">${xmlEsc(clip(sub, 28))}</text>
  </g>`);
    });

    const title = `PBS Diagram \u2014 ${project ? `[${project.code}] ${project.name}` : 'Project'}`;
    const subtitle = `Revision ${(doc.meta && doc.meta.revision) || 1} \u00b7 ${doc.items.length} items \u00b7 Generated ${dateStr || ''}`;
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

  /* ---------- PDF / print report ---------- */
  const REPORT_HEAD = ['Code', 'Deliverable / Subsystem', 'Maturity', 'Department', 'Owner', 'Milestone', 'Notes'];

  function buildReportModel(doc, project, db, userName, dateStr) {
    const deptMap = new Map(((db && db.departments) || []).map(d => [d.id, d]));
    const msMap = new Map(((db && db.milestones) || []).map(m => [m.id, m]));
    const rows = P.tree.flattenTreeRows(doc, null, 0, []).map(({ item, depth }) => {
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      return {
        depth,
        maturity: item.maturity,
        deptColor: dept && dept.color ? dept.color : null,
        cells: [
          pdfSafe(item.code), pdfSafe(item.name), pdfSafe(item.maturity),
          dept ? pdfSafe(`[${dept.code}] ${dept.name}`) : '-',
          item.owner ? pdfSafe(item.owner) : '-',
          ms ? pdfSafe(`${ms.title}${ms.date ? ` (${ms.date})` : ''}`) : '-',
          pdfSafe(item.notes || ''),
        ],
      };
    });
    return {
      title: pdfSafe(`Product Breakdown Structure - [${project ? project.code : ''}] ${project ? project.name : 'Project'}`),
      subtitle: pdfSafe(`Revision ${(doc.meta && doc.meta.revision) || 1}  |  ${rows.length} item${rows.length === 1 ? '' : 's'}  |  Exported ${dateStr} by ${userName || 'Project Mgr'}`),
      projectColor: project && project.color ? project.color : null,
      head: REPORT_HEAD,
      rows,
    };
  }

  /* JsPdf = window.jspdf.jsPDF. Returns the jsPDF instance (caller calls .save(filename)). Throws if autoTable is missing. */
  function renderPdf(JsPdf, model) {
    const projRgb = hexToRgb(model.projectColor, [79, 70, 229]);
    const pdf = new JsPdf({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    if (typeof pdf.autoTable !== 'function') throw new Error('PDF table plugin (autoTable) is not available.');
    const pageW = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(15, 23, 42); pdf.rect(0, 0, pageW, 64, 'F');
    pdf.setFillColor(projRgb[0], projRgb[1], projRgb[2]); pdf.rect(0, 60, pageW, 4, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.text(model.title, 36, 28);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(203, 213, 225); pdf.text(model.subtitle, 36, 46);

    const meta = model.rows.map(r => ({ depth: r.depth, maturity: r.maturity, deptRgb: r.deptColor ? hexToRgb(r.deptColor) : null }));
    pdf.autoTable({
      startY: 78,
      head: [model.head],
      body: model.rows.length ? model.rows.map(r => r.cells) : [['-', 'No PBS items recorded', '-', '-', '-', '-', '']],
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 6, textColor: [15, 23, 42], lineColor: [226, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: projRgb, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 54, fontStyle: 'bold' }, 1: { cellWidth: 195 }, 2: { cellWidth: 66, fontStyle: 'bold' }, 3: { cellWidth: 115 }, 4: { cellWidth: 85 }, 5: { cellWidth: 120 }, 6: { cellWidth: 'auto' } },
      didParseCell(data) {
        if (data.section !== 'body') return;
        const m = meta[data.row.index];
        if (!m) return;
        if (m.deptRgb) {
          data.cell.styles.fillColor = tint(m.deptRgb, 0.11);
          if (data.column.index === 3) { data.cell.styles.textColor = m.deptRgb; data.cell.styles.fontStyle = 'bold'; }
        }
        if (data.column.index === 1) {
          if (m.depth === 0) data.cell.styles.fontStyle = 'bold';
          data.cell.styles.cellPadding = { top: 6, right: 6, bottom: 6, left: 8 + m.depth * 14 };
        }
        if (data.column.index === 2) data.cell.styles.textColor = MAT_PDF_RGB[m.maturity] || [100, 116, 139];
      },
      didDrawCell(data) {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const m = meta[data.row.index];
        if (m && m.deptRgb) { pdf.setFillColor(m.deptRgb[0], m.deptRgb[1], m.deptRgb[2]); pdf.rect(data.cell.x, data.cell.y, 4, data.cell.height, 'F'); }
      },
      margin: { left: 36, right: 36, bottom: 36 },
    });
    return pdf;
  }

  /* Offline fallback: a standalone, print-ready HTML document (caller opens it in a window and prints). */
  function buildPrintHtml(model) {
    const body = model.rows.map(r => {
      const accent = r.deptColor || '#cbd5e1';
      const c = r.cells;
      return `<tr><td style="font-family:monospace;font-weight:700;border-left:4px solid ${htmlEsc(accent)}">${htmlEsc(c[0])}</td>`
        + `<td style="padding-left:${8 + r.depth * 16}px;font-weight:${r.depth === 0 ? 700 : 500}">${htmlEsc(c[1])}</td>`
        + `<td>${htmlEsc(c[2])}</td><td style="color:${htmlEsc(r.deptColor || '#475569')};font-weight:600">${htmlEsc(c[3])}</td>`
        + `<td>${htmlEsc(c[4])}</td><td>${htmlEsc(c[5])}</td><td>${htmlEsc(c[6])}</td></tr>`;
    }).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${htmlEsc(model.title)}</title>`
      + '<style>body{font-family:Inter,system-ui,sans-serif;color:#0f172a;margin:24px;font-size:12px}h1{font-size:18px;margin:0 0 4px}p{color:#475569;margin:0 0 16px;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}th{background:#4f46e5;color:#fff;font-size:11px}</style>'
      + `</head><body><h1>${htmlEsc(model.title)}</h1><p>${htmlEsc(model.subtitle)}</p><table><thead><tr>${model.head.map(h => `<th>${htmlEsc(h)}</th>`).join('')}</tr></thead>`
      + `<tbody>${body || '<tr><td colspan="7">No PBS items recorded.</td></tr>'}</tbody></table></body></html>`;
  }

  P.report = { svgFilename, pdfFilename, pdfSafe, buildSvg, buildReportModel, renderPdf, buildPrintHtml };
})();
