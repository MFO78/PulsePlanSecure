/* PBS v2 - part 2/6: data layer (schema normalisation, cache, AES-256-GCM codec, conflict diff & merge).
 * Inert: only registers functions on window.__ppPbsV2.data; nothing runs at load time. */
(function ppPbsV2DataPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const PBS_SCHEMA = 'pulseplan-pbs-v1';
  const CACHE_KEY = 'pulseplan_pbs_cache_v1';
  const MATURITY_OPTIONS = ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];
  const HERITAGE_OPTIONS = ['Existing', 'Update', 'New'];
  const YESNO_OPTIONS = ['Yes', 'No'];
  const PROC_STATUS_PRESETS = ['Not Started', 'RFQ', 'Ordered', 'In Manufacture', 'In Transit', 'Received', 'In Stock', 'Delivered'];
  const OPTIONAL_GROUPS = {
    identity: ['acronym', 'description', 'heritage'],
    docs: ['mechDrawing', 'elecDrawing', 'refDoc'],
    proc: ['manufacturer', 'partNumber', 'procurementStatus', 'leadTime', 'componentAlt'],
    eng: ['qty', 'mass', 'powerConsumption', 'powerDissipation', 'mtbf', 'lru', 'spareAvailable', 'spareToDeliver'],
  };
  const OPTIONAL_FIELD_KEYS = [
    ...OPTIONAL_GROUPS.identity,
    ...OPTIONAL_GROUPS.docs,
    ...OPTIONAL_GROUPS.proc,
    ...OPTIONAL_GROUPS.eng,
  ];

  function normalizeHeritage(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return '';
    return HERITAGE_OPTIONS.find(h => h.toLowerCase() === s) || '';
  }

  function normalizeYesNo(v) {
    if (v === true) return 'Yes';
    if (v === false) return 'No';
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'yes' || s === 'y' || s === 'true' || s === '1') return 'Yes';
    if (s === 'no' || s === 'n' || s === 'false' || s === '0') return 'No';
    return '';
  }

  function parseOptionalNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return (Number.isFinite(v) && v >= 0) ? Math.round(v * 10000) / 10000 : null;
    let s = String(v).trim().replace(/\s+/g, '');
    if (!s) return null;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
    const n = Number(s);
    return (Number.isFinite(n) && n >= 0) ? Math.round(n * 10000) / 10000 : null;
  }

  function parseOptionalQty(v) {
    if (v === null || v === undefined || v === '') return null;
    const raw = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
    if (!Number.isFinite(raw) || raw < 1 || !Number.isInteger(raw) || raw > 1000000) return null;
    return raw;
  }

  function formatNum(v) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '';
    return String(Math.round(Number(v) * 10000) / 10000);
  }

  function isFieldFilled(item, key) {
    if (!item) return false;
    const v = item[key];
    if (key === 'qty') return typeof v === 'number' && Number.isFinite(v) && v > 1;
    return typeof v === 'number' ? Number.isFinite(v) : Boolean(v);
  }

  function countOptionalFields(item) {
    const count = (keys) => keys.reduce((acc, k) => acc + (isFieldFilled(item, k) ? 1 : 0), 0);
    const identity = count(OPTIONAL_GROUPS.identity);
    const docs = count(OPTIONAL_GROUPS.docs);
    const proc = count(OPTIONAL_GROUPS.proc);
    const eng = count(OPTIONAL_GROUPS.eng);
    return { identity, docs, proc, eng, total: identity + docs + proc + eng };
  }

  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function sanitizeFilenamePart(raw) {
    const clean = String(raw || 'project').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return (clean || 'project').slice(0, 40);
  }

  function getPbsFilename(project, fallbackId) {
    return `pbs_${sanitizeFilenamePart(project ? (project.code || project.id) : fallbackId)}.json`;
  }

  function createEmptyPbs(project, userName, fallbackProjectId) {
    return {
      schema: PBS_SCHEMA,
      projectId: project ? project.id : (fallbackProjectId || ''),
      projectCode: project ? (project.code || '') : '',
      projectName: project ? (project.name || 'Project') : 'Project',
      meta: { revision: 1, lastModifiedAt: new Date().toISOString(), lastModifiedBy: userName || 'Project Mgr', lastWriteId: '' },
      items: [],
    };
  }

  function normalizePbsDoc(raw, project, userName) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.schema !== PBS_SCHEMA && !Array.isArray(raw.items)) return null;
    const base = createEmptyPbs(project, userName);
    const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
    const items = Array.isArray(raw.items) ? raw.items.filter(Boolean).map((it, idx) => ({
      id: String(it.id || makeId('pbs')),
      parentId: it.parentId ? String(it.parentId) : null,
      code: String(it.code || String(idx + 1)).trim(),
      name: String(it.name || 'Untitled Item').trim(),
      deptId: String(it.deptId || ''),
      owner: String(it.owner || '').trim(),
      maturity: MATURITY_OPTIONS.includes(it.maturity) ? it.maturity : 'Draft',
      milestoneId: String(it.milestoneId || ''),
      notes: String(it.notes || '').trim(),
      acronym: String(it.acronym || '').trim().slice(0, 24),
      description: String(it.description || '').trim().slice(0, 1000),
      heritage: normalizeHeritage(it.heritage),
      mechDrawing: String(it.mechDrawing || '').trim().slice(0, 160),
      elecDrawing: String(it.elecDrawing || '').trim().slice(0, 160),
      refDoc: String(it.refDoc || '').trim().slice(0, 200),
      manufacturer: String(it.manufacturer || '').trim().slice(0, 140),
      partNumber: String(it.partNumber || '').trim().slice(0, 120),
      procurementStatus: String(it.procurementStatus || '').trim().slice(0, 80),
      qty: parseOptionalQty(it.qty),
      mass: parseOptionalNumber(it.mass),
      powerConsumption: parseOptionalNumber(it.powerConsumption),
      powerDissipation: parseOptionalNumber(it.powerDissipation),
      mtbf: parseOptionalNumber(it.mtbf),
      lru: normalizeYesNo(it.lru),
      spareAvailable: normalizeYesNo(it.spareAvailable),
      spareToDeliver: normalizeYesNo(it.spareToDeliver),
      leadTime: parseOptionalNumber(it.leadTime),
      componentAlt: String(it.componentAlt || '').trim().slice(0, 200),
    })) : [];
    const validIds = new Set(items.map(i => i.id));
    items.forEach(i => { if (i.parentId && (!validIds.has(i.parentId) || i.parentId === i.id)) i.parentId = null; });
    return {
      schema: PBS_SCHEMA,
      projectId: project ? project.id : String(raw.projectId || base.projectId),
      projectCode: project ? (project.code || '') : String(raw.projectCode || ''),
      projectName: project ? (project.name || '') : String(raw.projectName || 'Project'),
      meta: {
        revision: Number(meta.revision) || 1,
        lastModifiedAt: meta.lastModifiedAt || new Date().toISOString(),
        lastModifiedBy: meta.lastModifiedBy || userName || 'Project Mgr',
        lastWriteId: String(meta.lastWriteId || ''),
      },
      items,
    };
  }

  /* ---------- Browser cache (all projects' PBS docs) ---------- */
  function shouldSuppressPbsStorage() {
    if (typeof ppShouldSuppressPlaintextStorage === 'function' && ppShouldSuppressPlaintextStorage()) return true;
    if (typeof ppIsSessionLocked === 'function' && ppIsSessionLocked()) return true;
    return false;
  }

  function loadCache() {
    if (shouldSuppressPbsStorage()) return {};
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(CACHE_KEY) : localStorage.getItem(CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      if (shouldSuppressPbsStorage()) {
        if (typeof safeRemoveStorage === 'function') safeRemoveStorage(CACHE_KEY);
        else if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHE_KEY);
        return;
      }
      const raw = JSON.stringify(cache || {});
      if (typeof safeSetStorage === 'function') safeSetStorage(CACHE_KEY, raw);
      else localStorage.setItem(CACHE_KEY, raw);
    } catch (_e) {}
  }

  /* ---------- AES-256-GCM codec (env is injectable for tests; defaults read app globals at call time) ---------- */
  function defaultEnv() {
    return {
      getPassphrase: () => (typeof ppSyncPassphrase === 'string' && ppSyncPassphrase) ? ppSyncPassphrase : '',
      setPassphrase: (p) => { if (typeof ppSyncPassphrase !== 'undefined') ppSyncPassphrase = p; },
      encrypt: (doc, pass) => (typeof encryptPulsePlanData === 'function' ? encryptPulsePlanData(doc, pass) : null),
      decrypt: (env, pass) => (typeof decryptPulsePlanData === 'function' ? decryptPulsePlanData(env, pass) : null),
      promptPassphrase: () => (typeof promptForDecryptionPassphrase === 'function' ? promptForDecryptionPassphrase() : ''),
      format: (typeof PP_ENC_FORMAT === 'string' && PP_ENC_FORMAT) ? PP_ENC_FORMAT : 'pulseplan-encrypted-v1',
      touch: () => {
        if (typeof resetPassphraseAutoLock === 'function') resetPassphraseAutoLock();
        if (typeof updateSyncEncryptionBadges === 'function') updateSyncEncryptionBadges();
      },
    };
  }

  /* Returns { text, encrypted }. Throws err.code === 'PASSPHRASE_LOCKED' when encryption is required but locked. */
  async function encodePbsForDisk(doc, requireEncryption, env) {
    const e = env || defaultEnv();
    const pass = e.getPassphrase();
    if (pass && e.encrypt) {
      const envelope = await e.encrypt(doc, pass);
      if (envelope) {
        const outEnv = { ...envelope, type: 'pulseplan-pbs' };
        if (doc && doc.meta && doc.meta.lastWriteId) outEnv.writeId = String(doc.meta.lastWriteId);
        if (e.touch) e.touch();
        return { text: JSON.stringify(outEnv, null, 2), encrypted: true };
      }
    }
    if (requireEncryption) {
      const err = new Error('Encryption passphrase is locked. Unlock your session passphrase before saving this encrypted PBS.');
      err.code = 'PASSPHRASE_LOCKED';
      throw err;
    }
    return { text: JSON.stringify(doc, null, 2), encrypted: false };
  }

  /* Returns { doc, wasEncrypted }. */
  async function decodePbsFromText(rawText, project, env, userName, opts = {}) {
    const e = env || defaultEnv();
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (_err) {
      throw new Error('Selected file is not valid JSON.');
    }
    let wasEncrypted = false;
    if (parsed && parsed.format === e.format) {
      wasEncrypted = true;
      let pass = e.getPassphrase();
      if (!pass && !opts.silentPrompt && e.promptPassphrase) pass = await e.promptPassphrase();
      if (!pass) throw new Error('Decryption cancelled: passphrase required.');
      const plain = await e.decrypt(parsed, pass);
      if (plain == null) throw new Error('Encryption engine unavailable in this environment.');
      e.setPassphrase(pass);
      if (e.touch) e.touch();
      parsed = typeof plain === 'string' ? JSON.parse(plain) : plain;
    }
    const doc = normalizePbsDoc(parsed, project, userName);
    if (!doc) throw new Error('This JSON file does not contain a valid PulsePlan PBS structure.');
    return { doc, wasEncrypted };
  }

  /* ---------- Item-level conflict diff & non-conflicting merge ---------- */
  const FIELD_LABELS = [
    ['code', 'Code'], ['name', 'Deliverable'], ['acronym', 'Acronym'], ['heritage', 'Status'],
    ['maturity', 'Maturity'], ['deptId', 'Department'], ['owner', 'Owner'], ['milestoneId', 'Milestone'],
    ['description', 'Description'], ['notes', 'Notes'],
    ['mechDrawing', 'Mech. Dwg'], ['elecDrawing', 'Elec. Dwg'], ['refDoc', 'Ref. Doc'],
    ['manufacturer', 'Manufacturer'], ['partNumber', 'Part No.'], ['procurementStatus', 'Proc. Status'],
    ['leadTime', 'Lead (wks)'], ['componentAlt', 'Alternative'],
    ['qty', 'Qty'], ['mass', 'Mass (kg)'], ['powerConsumption', 'Pwr Cons (W)'], ['powerDissipation', 'Pwr Diss (W)'],
    ['mtbf', 'MTBF (h)'], ['lru', 'LRU'], ['spareAvailable', 'Spare Avail.'], ['spareToDeliver', 'Spare Deliv.'],
    ['parentId', 'Parent'],
  ];

  function itemSignature(it) {
    return JSON.stringify([
      it.parentId || null, it.code || '', it.name || '', it.deptId || '', it.owner || '', it.maturity || 'Draft', it.milestoneId || '', it.notes || '',
      it.acronym || '', it.description || '', it.heritage || '',
      it.mechDrawing || '', it.elecDrawing || '', it.refDoc || '',
      it.manufacturer || '', it.partNumber || '', it.procurementStatus || '',
      it.qty ?? null, it.mass ?? null, it.powerConsumption ?? null, it.powerDissipation ?? null, it.mtbf ?? null,
      it.lru || '', it.spareAvailable || '', it.spareToDeliver || '',
      it.leadTime ?? null, it.componentAlt || '',
    ]);
  }

  function formatDiffVal(key, val, db) {
    if (val === null || val === undefined || val === '') return '\u2014';
    if (key === 'deptId' && db && Array.isArray(db.departments)) {
      const d = db.departments.find(x => x.id === val);
      return d ? `[${d.code}] ${d.name}` : String(val);
    }
    if (key === 'milestoneId' && db && Array.isArray(db.milestones)) {
      const m = db.milestones.find(x => x.id === val);
      return m ? m.title : String(val);
    }
    return typeof val === 'number' ? formatNum(val) : String(val);
  }

  function diffItemFields(localItem, remoteItem, db) {
    const out = [];
    FIELD_LABELS.forEach(([key, label]) => {
      const lv = localItem ? (localItem[key] ?? '') : '';
      const rv = remoteItem ? (remoteItem[key] ?? '') : '';
      if (String(lv) !== String(rv)) {
        out.push({ key, label, localVal: formatDiffVal(key, lv, db), remoteVal: formatDiffVal(key, rv, db) });
      }
    });
    return out;
  }

  function computeConflictDiff(localDoc, remoteDoc, db) {
    const localItems = (localDoc && Array.isArray(localDoc.items)) ? localDoc.items : [];
    const remoteItems = (remoteDoc && Array.isArray(remoteDoc.items)) ? remoteDoc.items : [];
    const localMap = new Map(localItems.map(i => [i.id, i]));
    const remoteMap = new Map(remoteItems.map(i => [i.id, i]));
    const addedRemote = [];
    const modifiedBoth = [];
    const onlyLocal = [];
    remoteItems.forEach(r => {
      const l = localMap.get(r.id);
      if (!l) addedRemote.push(r);
      else if (itemSignature(l) !== itemSignature(r)) modifiedBoth.push({ local: l, remote: r, changes: diffItemFields(l, r, db) });
    });
    localItems.forEach(l => { if (!remoteMap.has(l.id)) onlyLocal.push(l); });
    return { addedRemote, modifiedBoth, onlyLocal };
  }

  /* Keeps every local item untouched, appends items that only exist remotely; items modified on both sides keep the local version. */
  function mergeConflictDocs(localDoc, remoteDoc) {
    const diff = computeConflictDiff(localDoc, remoteDoc);
    const merged = (localDoc.items || []).map(i => ({ ...i }));
    const ids = new Set(merged.map(i => i.id));
    diff.addedRemote.forEach(r => {
      if (!ids.has(r.id)) { merged.push({ ...r }); ids.add(r.id); }
    });
    merged.forEach(i => { if (i.parentId && !ids.has(i.parentId)) i.parentId = null; });
    return {
      ...localDoc,
      meta: { ...localDoc.meta, revision: Math.max(Number(localDoc.meta && localDoc.meta.revision) || 1, Number(remoteDoc.meta && remoteDoc.meta.revision) || 1) },
      items: merged,
    };
  }

  P.HERITAGE_OPTIONS = HERITAGE_OPTIONS;
  P.YESNO_OPTIONS = YESNO_OPTIONS;
  P.PROC_STATUS_PRESETS = PROC_STATUS_PRESETS;
  P.data = {
    PBS_SCHEMA, CACHE_KEY, HERITAGE_OPTIONS, YESNO_OPTIONS, PROC_STATUS_PRESETS, OPTIONAL_GROUPS, OPTIONAL_FIELD_KEYS, FIELD_LABELS,
    normalizeHeritage, normalizeYesNo, parseOptionalNumber, parseOptionalQty, formatNum, isFieldFilled, countOptionalFields,
    makeId, sanitizeFilenamePart, getPbsFilename, createEmptyPbs, normalizePbsDoc,
    loadCache, saveCache, encodePbsForDisk, decodePbsFromText, itemSignature, diffItemFields, computeConflictDiff, mergeConflictDocs,
  };
})();
