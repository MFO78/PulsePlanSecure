/* PBS v2 - part 3/6: CSV import/export and project clone (pure functions).
 * Inert: only registers functions on window.__ppPbsV2.io; nothing runs at load time. */
(function ppPbsV2IoPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const HEADER = ['Code', 'ParentCode', 'Name', 'Maturity', 'Department', 'Owner', 'Milestone', 'Notes'];

  const tree = () => P.tree;
  const makeId = (p) => P.data.makeId(p);
  const maturities = () => P.MATURITY_OPTIONS || ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];

  /* Neutralise spreadsheet formulas (=, +, @, or - followed by a non-number) on export; undone on import. */
  function guardFormula(s) {
    return /^[=+@]/.test(s) || /^-[^\d.\s]/.test(s) ? `'${s}` : s;
  }
  function unguardFormula(s) {
    return /^'[=+@-]/.test(s) ? s.slice(1) : s;
  }

  function csvCell(val) {
    const s = guardFormula(String(val ?? ''));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function csvFilename(project, fallbackId) {
    return `pbs_${P.data.sanitizeFilenamePart(project ? (project.code || project.id) : fallbackId)}.csv`;
  }

  function buildPbsCsv(doc, db) {
    const database = db || {};
    const deptMap = new Map((database.departments || []).map(x => [x.id, x]));
    const msMap = new Map((database.milestones || []).map(x => [x.id, x]));
    const byId = new Map(((doc && doc.items) || []).map(x => [x.id, x]));
    const lines = [HEADER.join(',')];
    tree().flattenTreeRows(doc, null, 0, []).forEach(({ item }) => {
      const parent = item.parentId ? byId.get(item.parentId) : null;
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      lines.push([
        item.code, parent ? parent.code : '', item.name, item.maturity,
        dept ? dept.code : '', item.owner || '', ms ? ms.title : '', item.notes || '',
      ].map(csvCell).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  /* RFC-4180 style record parser: quoted fields may contain separators, quotes ("") and line breaks. */
  function parseCsvRecords(text, sep) {
    const records = [];
    let row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        row.push(cur); cur = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        records.push(row); row = [];
      } else {
        cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); records.push(row); }
    return records.filter(r => r.some(c => String(c).trim() !== ''));
  }

  /* Returns { items, warnings }. Items get fresh ids; parentId resolved via ParentCode or dotted code (1.2 -> 1). */
  function parsePbsCsv(rawText, db) {
    const clean = String(rawText || '').replace(/^\uFEFF/, '');
    const firstLine = clean.split(/\r?\n/, 1)[0] || '';
    const sep = firstLine.includes('\t') ? '\t' : (firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',');
    const records = parseCsvRecords(clean, sep);
    const warnings = [];
    if (!records.length) return { items: [], warnings };

    const head = records[0].map(c => c.trim().toLowerCase());
    const hasHeader = head.some(c => ['code', 'name', 'deliverable', 'maturity', 'parentcode'].includes(c));
    const rows = hasHeader ? records.slice(1) : records;

    const database = db || {};
    const depts = database.departments || [];
    const milestones = database.milestones || [];
    const items = [];
    const codeToId = new Map();

    rows.forEach((cols, idx) => {
      const c = cols.map(x => unguardFormula(String(x ?? '').trim()));
      const code = c[0] || String(items.length + 1);
      const mat = maturities().find(m => m.toLowerCase() === (c[3] || 'draft').toLowerCase());
      if (c[3] && !mat) warnings.push(`Row ${idx + 1}: unknown maturity "${c[3]}", set to Draft.`);
      const deptTok = (c[4] || '').toLowerCase();
      const dept = deptTok ? depts.find(d => (d.code || '').toLowerCase() === deptTok || (d.name || '').toLowerCase() === deptTok) : null;
      if (deptTok && !dept) warnings.push(`Row ${idx + 1}: department "${c[4]}" not found.`);
      const msTok = (c[6] || '').toLowerCase();
      const ms = msTok ? milestones.find(m => (m.title || '').toLowerCase() === msTok) : null;
      if (msTok && !ms) warnings.push(`Row ${idx + 1}: milestone "${c[6]}" not found.`);
      if (codeToId.has(code)) warnings.push(`Row ${idx + 1}: duplicate code "${code}"; parent links use the first occurrence.`);
      const id = makeId('pbs');
      items.push({
        id, parentId: null, _parentCode: c[1] || '', code, name: c[2] || `Item ${code}`,
        deptId: dept ? dept.id : '', owner: c[5] || '', maturity: mat || 'Draft',
        milestoneId: ms ? ms.id : '', notes: c[7] || '',
      });
      if (!codeToId.has(code)) codeToId.set(code, id);
    });

    items.forEach(it => {
      let parentCode = it._parentCode;
      if (!parentCode && it.code.includes('.')) parentCode = it.code.slice(0, it.code.lastIndexOf('.'));
      if (parentCode && codeToId.has(parentCode) && codeToId.get(parentCode) !== it.id) it.parentId = codeToId.get(parentCode);
      else if (it._parentCode) warnings.push(`Item ${it.code}: parent "${it._parentCode}" not found; placed at root.`);
      delete it._parentCode;
    });

    // Break accidental parent cycles (A -> B -> A) by moving the offending item to root.
    const doc = { items };
    items.forEach(it => {
      if (it.parentId && tree().isDescendant(doc, it.parentId, it.id)) {
        warnings.push(`Item ${it.code}: circular parent link removed.`);
        it.parentId = null;
      }
    });
    return { items, warnings };
  }

  /* Deep-copies a PBS doc's items with fresh ids; milestone links are dropped (they belong to the source project). */
  function cloneItems(sourceDoc) {
    const src = (sourceDoc && Array.isArray(sourceDoc.items)) ? sourceDoc.items : [];
    const idMap = new Map(src.map(it => [it.id, makeId('pbs')]));
    return src.map(it => ({ ...it, id: idMap.get(it.id), parentId: it.parentId ? (idMap.get(it.parentId) || null) : null, milestoneId: '' }));
  }

  P.io = { csvCell, csvFilename, buildPbsCsv, parseCsvRecords, parsePbsCsv, cloneItems };
})();
