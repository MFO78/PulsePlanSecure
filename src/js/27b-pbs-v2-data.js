/* PBS v2 - part 2/6: data layer (schema normalisation, cache, AES-256-GCM codec, conflict diff & merge).
 * Inert: only registers functions on window.__ppPbsV2.data; nothing runs at load time. */
(function ppPbsV2DataPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const PBS_SCHEMA = 'pulseplan-pbs-v1';
  const CACHE_KEY = 'pulseplan_pbs_cache_v1';
  const MATURITY_OPTIONS = ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];

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
  function loadCache() {
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
        if (e.touch) e.touch();
        return { text: JSON.stringify(envelope, null, 2), encrypted: true };
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
  async function decodePbsFromText(rawText, project, env, userName) {
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
      if (!pass && e.promptPassphrase) pass = await e.promptPassphrase();
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
  function itemSignature(it) {
    return JSON.stringify([it.parentId || null, it.code, it.name, it.deptId, it.owner, it.maturity, it.milestoneId, it.notes]);
  }

  function computeConflictDiff(localDoc, remoteDoc) {
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
      else if (itemSignature(l) !== itemSignature(r)) modifiedBoth.push({ local: l, remote: r });
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

  P.data = {
    PBS_SCHEMA, CACHE_KEY, makeId, sanitizeFilenamePart, getPbsFilename, createEmptyPbs, normalizePbsDoc,
    loadCache, saveCache, encodePbsForDisk, decodePbsFromText, itemSignature, computeConflictDiff, mergeConflictDocs,
  };
})();
