/* PBS v2 - part 3/6: CSV import/export and project clone (pure functions).
 * Inert: only registers functions on window.__ppPbsV2.io; nothing runs at load time. */
(function ppPbsV2IoPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const HEADER = [
    'Code', 'ParentCode', 'Name', 'Maturity', 'Department', 'Owner', 'Milestone', 'Notes',
    'Acronym', 'Description', 'Existing/Update/New',
    'Mechanical Drawing', 'Electrical Drawing', 'Reference Document',
    'Manufacturer', 'Part Number', 'Procurement/Manufacture Status',
    'Mass (kg)', 'Power Consumption (W)', 'Power Dissipation (W)', 'MTBF (h)',
    'LRU', 'SPARE Available', 'SPARE to be Delivered',
    'Lead Time (wks)', 'Component Alternative',
  ];

  const POSITIONAL_KEYS = [
    'code', 'parentCode', 'name', 'maturity', 'department', 'owner', 'milestone', 'notes',
    'acronym', 'description', 'heritage',
    'mechDrawing', 'elecDrawing', 'refDoc',
    'manufacturer', 'partNumber', 'procurementStatus',
    'mass', 'powerConsumption', 'powerDissipation', 'mtbf',
    'lru', 'spareAvailable', 'spareToDeliver',
    'leadTime', 'componentAlt',
  ];

  const HEADER_ALIASES = {
    code: 'code', pbscode: 'code', itemcode: 'code', wbs: 'code',
    parentcode: 'parentCode', parent: 'parentCode',
    name: 'name', deliverable: 'name', deliverablesubsystem: 'name', subsystem: 'name', title: 'name', item: 'name',
    maturity: 'maturity', maturitygate: 'maturity', gate: 'maturity',
    department: 'department', dept: 'department', departmentcode: 'department',
    owner: 'owner', responsible: 'owner',
    milestone: 'milestone', linkedmilestone: 'milestone',
    notes: 'notes', acceptancecriteria: 'notes', notesacceptancecriteria: 'notes', remarks: 'notes',
    acronym: 'acronym', acr: 'acronym', shortname: 'acronym',
    description: 'description', desc: 'description',
    existingupdatenew: 'heritage', heritage: 'heritage', existingnew: 'heritage', designstatus: 'heritage', reuse: 'heritage',
    mechanicaldrawing: 'mechDrawing', mechdrawing: 'mechDrawing', mechdwg: 'mechDrawing', mechanicaldwg: 'mechDrawing',
    electricaldrawing: 'elecDrawing', elecdrawing: 'elecDrawing', elecdwg: 'elecDrawing', electricaldwg: 'elecDrawing',
    referencedocument: 'refDoc', referencedoc: 'refDoc', refdoc: 'refDoc', refdocument: 'refDoc',
    manufacturer: 'manufacturer', vendor: 'manufacturer', supplier: 'manufacturer', mfr: 'manufacturer', oem: 'manufacturer',
    partnumber: 'partNumber', partno: 'partNumber', pn: 'partNumber', mpn: 'partNumber',
    procurementmanufacturestatus: 'procurementStatus', procurementstatus: 'procurementStatus', manufacturestatus: 'procurementStatus', procstatus: 'procurementStatus', mfgstatus: 'procurementStatus',
    masskg: 'mass', mass: 'mass', weightkg: 'mass', weight: 'mass',
    powerconsumptionw: 'powerConsumption', powerconsumption: 'powerConsumption', powercons: 'powerConsumption', powerconsw: 'powerConsumption', inputpowerw: 'powerConsumption', inputpower: 'powerConsumption',
    powerdissipationw: 'powerDissipation', powerdissipation: 'powerDissipation', powerdiss: 'powerDissipation', powerdissw: 'powerDissipation', thermaldissipationw: 'powerDissipation', heatdissipationw: 'powerDissipation',
    mtbfh: 'mtbf', mtbfhrs: 'mtbf', mtbfhours: 'mtbf', mtbf: 'mtbf',
    lru: 'lru', lruyesno: 'lru',
    spareavailable: 'spareAvailable', spareavailableyesno: 'spareAvailable',
    sparetobedelivered: 'spareToDeliver', sparetodeliver: 'spareToDeliver', sparetobedeliveredyesno: 'spareToDeliver', sparetodeliveryesno: 'spareToDeliver',
    leadtimewks: 'leadTime', leadtimeweeks: 'leadTime', leadtimew: 'leadTime', leadtime: 'leadTime',
    componentalternative: 'componentAlt', alternative: 'componentAlt', altcomponent: 'componentAlt', secondsource: 'componentAlt',
  };

  const tree = () => P.tree;
  const data = () => P.data;
  const makeId = (p) => P.data.makeId(p);
  const maturities = () => P.MATURITY_OPTIONS || ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];

  function normHeaderToken(raw) {
    return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function parseCsvNumber(raw, unitRe, rowNum, label, warnings) {
    if (!raw) return null;
    const stripped = raw.replace(unitRe, '').trim();
    const num = data().parseOptionalNumber(stripped);
    if (num === null) warnings.push(`Row ${rowNum}: invalid ${label} "${raw}", ignored.`);
    return num;
  }

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
    const fmt = (v) => (v != null ? data().formatNum(v) : '');
    const lines = [HEADER.map(csvCell).join(',')];
    tree().flattenTreeRows(doc, null, 0, []).forEach(({ item }) => {
      const parent = item.parentId ? byId.get(item.parentId) : null;
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      lines.push([
        item.code, parent ? parent.code : '', item.name, item.maturity,
        dept ? dept.code : '', item.owner || '', ms ? ms.title : '', item.notes || '',
        item.acronym || '', item.description || '', item.heritage || '',
        item.mechDrawing || '', item.elecDrawing || '', item.refDoc || '',
        item.manufacturer || '', item.partNumber || '', item.procurementStatus || '',
        fmt(item.mass), fmt(item.powerConsumption), fmt(item.powerDissipation), fmt(item.mtbf),
        item.lru || '', item.spareAvailable || '', item.spareToDeliver || '',
        fmt(item.leadTime), item.componentAlt || '',
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

    const headNorm = records[0].map(normHeaderToken);
    const hasHeader = headNorm.some(tok => ['code', 'name', 'deliverable', 'maturity', 'parentcode', 'acronym', 'partnumber', 'manufacturer'].includes(tok));
    const colIndex = {};
    if (hasHeader) {
      headNorm.forEach((tok, idx) => {
        const key = HEADER_ALIASES[tok];
        if (key && colIndex[key] === undefined) colIndex[key] = idx;
      });
    } else {
      POSITIONAL_KEYS.forEach((key, idx) => { colIndex[key] = idx; });
    }
    const rows = hasHeader ? records.slice(1) : records;

    const database = db || {};
    const depts = database.departments || [];
    const milestones = database.milestones || [];
    const items = [];
    const codeToId = new Map();

    rows.forEach((cols, idx) => {
      const c = cols.map(x => unguardFormula(String(x ?? '').trim()));
      const get = (key) => (colIndex[key] !== undefined ? (c[colIndex[key]] || '') : '');
      const rowNum = idx + 1;

      const code = get('code') || String(items.length + 1);
      const rawMat = get('maturity');
      const mat = maturities().find(m => m.toLowerCase() === (rawMat || 'draft').toLowerCase());
      if (rawMat && !mat) warnings.push(`Row ${rowNum}: unknown maturity "${rawMat}", set to Draft.`);

      const rawDept = get('department');
      const deptTok = rawDept.toLowerCase();
      const dept = deptTok ? depts.find(d => (d.code || '').toLowerCase() === deptTok || (d.name || '').toLowerCase() === deptTok) : null;
      if (deptTok && !dept) warnings.push(`Row ${rowNum}: department "${rawDept}" not found.`);

      const rawMs = get('milestone');
      const msTok = rawMs.toLowerCase();
      const ms = msTok ? milestones.find(m => (m.title || '').toLowerCase() === msTok) : null;
      if (msTok && !ms) warnings.push(`Row ${rowNum}: milestone "${rawMs}" not found.`);

      const rawHeritage = get('heritage');
      const heritage = data().normalizeHeritage(rawHeritage);
      if (rawHeritage && !heritage) warnings.push(`Row ${rowNum}: unknown Existing/Update/New "${rawHeritage}", ignored.`);

      const parseYn = (rawVal, label) => {
        if (!rawVal) return '';
        const yn = data().normalizeYesNo(rawVal);
        if (!yn) warnings.push(`Row ${rowNum}: invalid ${label} "${rawVal}" (expected Yes/No), ignored.`);
        return yn;
      };

      if (codeToId.has(code)) warnings.push(`Row ${rowNum}: duplicate code "${code}"; parent links use the first occurrence.`);
      const id = makeId('pbs');
      items.push({
        id, parentId: null, _parentCode: get('parentCode'), code: code.slice(0, 40), name: (get('name') || `Item ${code}`).slice(0, 200),
        deptId: dept ? dept.id : '', owner: get('owner').slice(0, 120), maturity: mat || 'Draft',
        milestoneId: ms ? ms.id : '', notes: get('notes').slice(0, 1000),
        acronym: get('acronym').slice(0, 24),
        description: get('description').slice(0, 1000),
        heritage,
        mechDrawing: get('mechDrawing').slice(0, 160),
        elecDrawing: get('elecDrawing').slice(0, 160),
        refDoc: get('refDoc').slice(0, 200),
        manufacturer: get('manufacturer').slice(0, 140),
        partNumber: get('partNumber').slice(0, 120),
        procurementStatus: get('procurementStatus').slice(0, 80),
        mass: parseCsvNumber(get('mass'), /\s*kg$/i, rowNum, 'Mass (kg)', warnings),
        powerConsumption: parseCsvNumber(get('powerConsumption'), /\s*w$/i, rowNum, 'Power Consumption (W)', warnings),
        powerDissipation: parseCsvNumber(get('powerDissipation'), /\s*w$/i, rowNum, 'Power Dissipation (W)', warnings),
        mtbf: parseCsvNumber(get('mtbf'), /\s*(h|hr|hrs|hours)$/i, rowNum, 'MTBF (h)', warnings),
        lru: parseYn(get('lru'), 'LRU'),
        spareAvailable: parseYn(get('spareAvailable'), 'SPARE Available'),
        spareToDeliver: parseYn(get('spareToDeliver'), 'SPARE to be Delivered'),
        leadTime: parseCsvNumber(get('leadTime'), /\s*(wk|wks|week|weeks)$/i, rowNum, 'Lead Time (wks)', warnings),
        componentAlt: get('componentAlt').slice(0, 200),
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

  /* Deep-copies a PBS doc's items with fresh ids; project-execution links/statuses (milestone, procurement status, spare availability) are reset while hardware specs are preserved. */
  function cloneItems(sourceDoc) {
    const src = (sourceDoc && Array.isArray(sourceDoc.items)) ? sourceDoc.items : [];
    const idMap = new Map(src.map(it => [it.id, makeId('pbs')]));
    return src.map(it => ({
      ...it,
      id: idMap.get(it.id),
      parentId: it.parentId ? (idMap.get(it.parentId) || null) : null,
      milestoneId: '',
      procurementStatus: '',
      spareAvailable: '',
    }));
  }

  P.io = { HEADER, csvCell, csvFilename, buildPbsCsv, parseCsvRecords, parsePbsCsv, cloneItems };
})();
