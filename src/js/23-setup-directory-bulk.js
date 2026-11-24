/* Isolated Setup & Data enhancements: Project Owners & Technical Leads Directory + Dropdowns + Multi-Select Bulk Actions. */
(function ppSetupDirectoryBulkModule() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;

  const PEOPLE_KEY = 'pulseplan_people_dir_v1';
  const ROLES = ['Both', 'Project Owner', 'Technical Lead'];
  let peopleList = loadPeople();

  function esc(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(str ?? ''));
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDb() {
    if (typeof getActiveDB === 'function') return getActiveDB();
    if (typeof liveDB !== 'undefined' && liveDB) return liveDB;
    return { departments: [], projects: [], milestones: [], holidays: [] };
  }

  function toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'info');
  }

  function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function persistAppChanges() {
    if (typeof persistActiveDB === 'function') persistActiveDB();
    else if (typeof saveLocalState === 'function') saveLocalState();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof renderAll === 'function') renderAll();
  }

  function loadPeople() {
    try {
      const raw = typeof safeGetStorage === 'function' ? safeGetStorage(PEOPLE_KEY) : localStorage.getItem(PEOPLE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(p => p && p.name) : [];
    } catch (_e) {
      return [];
    }
  }

  function savePeople() {
    try {
      const raw = JSON.stringify(peopleList);
      if (typeof safeSetStorage === 'function') safeSetStorage(PEOPLE_KEY, raw);
      else localStorage.setItem(PEOPLE_KEY, raw);
      const db = getDb();
      if (db && typeof db === 'object') db.peopleDirectory = peopleList.slice();
    } catch (_e) {}
  }

  function seedPeopleFromProjects() {
    const db = getDb();
    if (db && Array.isArray(db.peopleDirectory) && db.peopleDirectory.length > 0 && peopleList.length === 0) {
      peopleList = db.peopleDirectory.filter(p => p && p.name);
      savePeople();
      return;
    }
    const existingNames = new Map(peopleList.map(p => [p.name.trim().toLowerCase(), p]));
    let changed = false;
    (db.projects || []).forEach(p => {
      const owner = String(p.owner || p.projectOwner || '').trim();
      const lead = String(p.techLead || p.technicalLead || p.lead || '').trim();
      if (owner) {
        const key = owner.toLowerCase();
        if (!existingNames.has(key)) {
          const rec = { id: makeId('ppl'), name: owner, role: lead.toLowerCase() === key ? 'Both' : 'Project Owner' };
          peopleList.push(rec);
          existingNames.set(key, rec);
          changed = true;
        }
      }
      if (lead) {
        const key = lead.toLowerCase();
        if (!existingNames.has(key)) {
          const rec = { id: makeId('ppl'), name: lead, role: 'Technical Lead' };
          peopleList.push(rec);
          existingNames.set(key, rec);
          changed = true;
        } else if (existingNames.get(key).role === 'Project Owner') {
          existingNames.get(key).role = 'Both';
          changed = true;
        }
      }
    });
    if (changed) savePeople();
  }

  /* ---------- Styles ---------- */
  function injectStyles() {
    if (document.getElementById('ppSetupEnhStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppSetupEnhStyles';
    style.textContent = `
      .pp-bulk-bar { display: none; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem; padding: .45rem .75rem; margin-bottom: .5rem; border-radius: .75rem; border: 1px solid #c7d2fe; background: #eef2ff; color: #312e81; font-size: 11.5px; font-weight: 600; }
      .pp-bulk-bar.pp-bulk-active { display: flex; }
      .pp-bulk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
      .pp-bulk-btn { padding: .28rem .6rem; border-radius: .5rem; border: 1px solid #cbd5e1; background: #ffffff; color: #334155; font-size: 11px; font-weight: 700; cursor: pointer; }
      .pp-bulk-btn:hover { background: #f1f5f9; }
      .pp-bulk-btn-danger { border-color: #fecdd3; background: #fff1f2; color: #be123c; }
      .pp-bulk-btn-danger:hover { background: #ffe4e6; }
      .pp-bulk-btn-amber { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
      .pp-bulk-btn-amber:hover { background: #fef3c7; }
      .pp-sel-col { width: 2rem; text-align: center; }
      .pp-sel-cb { width: 14px; height: 14px; cursor: pointer; accent-color: #4f46e5; }
      .pp-people-card { margin-top: 1.25rem; border: 1px solid var(--border-subtle, #e2e8f0); border-radius: 1rem; background: var(--surface-card, #ffffff); padding: 1rem; }
      .pp-people-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .75rem; }
      .pp-people-head h3 { margin: 0; font-size: 14px; font-weight: 800; color: var(--text-heading, #0f172a); }
      .pp-people-form { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
      .pp-people-input, .pp-people-select { padding: .35rem .6rem; border-radius: .6rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 12px; }
      .pp-people-btn { padding: .36rem .7rem; border-radius: .6rem; border: 1px solid #4f46e5; background: #4f46e5; color: #ffffff; font-size: 11.5px; font-weight: 700; cursor: pointer; }
      .pp-people-btn:hover { background: #4338ca; }
      .pp-people-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .pp-people-table th, .pp-people-table td { padding: .45rem .6rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); text-align: left; }
      .pp-people-table th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #64748b); }
      html.dark .pp-bulk-bar, body.dark .pp-bulk-bar { background: rgba(79,70,229,.22); border-color: rgba(129,140,248,.4); color: #e0e7ff; }
    `;
    document.head.appendChild(style);
  }

  /* ---------- People Directory Table in Setup & Data ---------- */
  function renderPeopleDirectorySection() {
    const dataTab = document.getElementById('tab-data') || document.getElementById('dataProjectsBody')?.closest('section');
    if (!dataTab) return;
    injectStyles();
    seedPeopleFromProjects();

    let card = document.getElementById('ppPeopleDirectoryCard');
    if (!card) {
      card = document.createElement('section');
      card.id = 'ppPeopleDirectoryCard';
      card.className = 'pp-people-card';
      card.setAttribute('aria-label', 'Project Owners and Technical Leads Directory');
      dataTab.appendChild(card);
    }

    const rowsHtml = peopleList.length
      ? peopleList.map(p => `
        <tr data-pp-row-id="${esc(p.id)}">
          <td class="pp-sel-col"><input type="checkbox" class="pp-sel-cb" data-pp-row-cb="people" value="${esc(p.id)}" aria-label="Select ${esc(p.name)}" /></td>
          <td><strong>${esc(p.name)}</strong></td>
          <td>
            <select class="pp-people-select" data-pp-role-person="${esc(p.id)}" aria-label="Role for ${esc(p.name)}">
              ${ROLES.map(r => `<option value="${esc(r)}" ${p.role === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
            </select>
          </td>
          <td style="text-align:right">
            <button type="button" class="pp-bulk-btn pp-bulk-btn-danger" data-pp-del-person="${esc(p.id)}">Delete</button>
          </td>
        </tr>`).join('')
      : `<tr><td colspan="4" style="text-align:center;color:var(--text-muted,#64748b);padding:1rem">No Project Owners or Technical Leads added yet.</td></tr>`;

    card.innerHTML = `
      <div class="pp-people-head">
        <div>
          <h3>Project Owners &amp; Technical Leads Directory</h3>
          <div style="font-size:11px;color:var(--text-muted,#64748b)">Choose <strong>Both</strong> when the same person can act as Project Owner and Technical Lead.</div>
        </div>
        <form id="ppAddPersonForm" class="pp-people-form">
          <input type="text" id="ppPersonNameInput" class="pp-people-input" placeholder="Full name..." required />
          <select id="ppPersonRoleSelect" class="pp-people-select" aria-label="Role">
            ${ROLES.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
          <button type="submit" class="pp-people-btn">+ Add Person</button>
        </form>
      </div>
      <div id="ppBulkBar-people" class="pp-bulk-bar">
        <span data-pp-bulk-count="people">0 selected</span>
        <div class="pp-bulk-actions">
          <button type="button" class="pp-bulk-btn pp-bulk-btn-danger" data-pp-bulk-del="people">Delete Selected</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="pp-people-table">
          <thead>
            <tr>
              <th class="pp-sel-col"><input type="checkbox" class="pp-sel-cb" data-pp-sel-all="people" aria-label="Select all people" /></th>
              <th>Name</th>
              <th>Role</th>
              <th style="text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody id="ppPeopleDirectoryBody">${rowsHtml}</tbody>
        </table>
      </div>`;

    card.querySelector('#ppAddPersonForm')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const nameInput = card.querySelector('#ppPersonNameInput');
      const roleSelect = card.querySelector('#ppPersonRoleSelect');
      const name = (nameInput?.value || '').trim();
      const role = ROLES.includes(roleSelect?.value) ? roleSelect.value : 'Both';
      if (!name) return;
      if (peopleList.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        toast(`${name} is already in the directory.`, 'info');
        return;
      }
      peopleList.push({ id: makeId('ppl'), name, role });
      savePeople();
      renderPeopleDirectorySection();
      toast(`Added ${name} (${role}).`, 'success');
    });

    card.querySelectorAll('[data-pp-role-person]').forEach(sel => {
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-pp-role-person');
        const target = peopleList.find(p => p.id === id);
        if (target && ROLES.includes(sel.value)) {
          target.role = sel.value;
          savePeople();
          toast(`Updated ${target.name} to ${target.role}.`, 'info');
        }
      });
    });

    card.querySelectorAll('[data-pp-del-person]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pp-del-person');
        peopleList = peopleList.filter(p => p.id !== id);
        savePeople();
        renderPeopleDirectorySection();
      });
    });

    wireBulkEventsForList(card, 'people', (ids) => {
      peopleList = peopleList.filter(p => !ids.has(p.id));
      savePeople();
      renderPeopleDirectorySection();
      toast(`Deleted ${ids.size} person(s).`, 'success');
    });
  }

  /* ---------- Replace Project Owner & Technical Lead Inputs with Native Dropdowns ---------- */
  function findInputByLabelText(labelText) {
    const target = labelText.toLowerCase();
    const labels = Array.from(document.querySelectorAll('label'));
    for (let i = 0; i < labels.length; i++) {
      const lbl = labels[i];
      if (String(lbl.textContent || '').trim().toLowerCase() === target) {
        const forId = lbl.getAttribute('for');
        if (forId) {
          const el = document.getElementById(forId);
          if (el && el.tagName === 'INPUT') return el;
        }
        const siblingInput = lbl.parentElement ? lbl.parentElement.querySelector('input') : null;
        if (siblingInput) return siblingInput;
      }
    }
    return null;
  }

  function convertInputToDirectoryDropdown(inputEl, roleFilter, selectId) {
    if (!inputEl || !inputEl.parentElement) return;
    seedPeopleFromProjects();
    let sel = inputEl.parentElement.querySelector(`select[data-pp-dir-for="${selectId}"]`);
    if (!sel) {
      sel = document.createElement('select');
      sel.setAttribute('data-pp-dir-for', selectId);
      sel.className = inputEl.className || 'w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm';
      sel.setAttribute('aria-label', roleFilter);
      sel.addEventListener('change', () => {
        inputEl.value = sel.value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      });
      inputEl.style.display = 'none';
      inputEl.parentElement.insertBefore(sel, inputEl.nextSibling);
    }
    const currentVal = String(inputEl.value || '').trim();
    const matching = peopleList.filter(p => p.role === 'Both' || p.role === roleFilter);
    const hasCurrent = currentVal && !matching.some(p => p.name === currentVal);
    sel.innerHTML = [
      `<option value="">Optional — Select ${esc(roleFilter)}</option>`,
      ...matching.map(p => `<option value="${esc(p.name)}" ${p.name === currentVal ? 'selected' : ''}>${esc(p.name)}</option>`),
      hasCurrent ? `<option value="${esc(currentVal)}" selected>${esc(currentVal)}</option>` : '',
    ].join('');
  }

  function enhanceProjectModalFields() {
    const ownerInput = findInputByLabelText('Project Owner');
    const leadInput = findInputByLabelText('Technical Lead');
    if (ownerInput) convertInputToDirectoryDropdown(ownerInput, 'Project Owner', 'owner');
    if (leadInput) convertInputToDirectoryDropdown(leadInput, 'Technical Lead', 'techLead');
  }

  if (typeof openProjectModal === 'function') {
    const nativeOpenProjectModal = openProjectModal;
    openProjectModal = function (...args) {
      const res = nativeOpenProjectModal.apply(this, args);
      enhanceProjectModalFields();
      setTimeout(enhanceProjectModalFields, 0);
      return res;
    };
  }

  /* ---------- Multi-Select Checkboxes & Bulk Actions for ALL Setup & Data Tables ---------- */
  function extractRowId(tr, listKey) {
    const patterns = {
      projects: /openProjectModal\(\s*['"]([^'"]+)['"]\s*\)/,
      departments: /openDeptModal\(\s*['"]([^'"]+)['"]\s*\)|deleteDept\(\s*['"]([^'"]+)['"]\s*\)/,
      milestones: /openMilestoneModal\(\s*['"]([^'"]+)['"]\s*\)|deleteMilestone\(\s*['"]([^'"]+)['"]\s*\)/,
      holidays: /deleteHoliday\(\s*['"]([^'"]+)['"]\s*\)|openHolidayModal\(\s*['"]([^'"]+)['"]\s*\)/,
    };
    const re = patterns[listKey];
    if (re) {
      const btns = tr.querySelectorAll('button[onclick]');
      for (let i = 0; i < btns.length; i++) {
        const m = (btns[i].getAttribute('onclick') || '').match(re);
        if (m) return m[1] || m[2] || '';
      }
    }
    return tr.getAttribute('data-id') || '';
  }

  function wireBulkEventsForList(container, listKey, onDelete, onArchive, onUnarchive) {
    const bar = container.querySelector(`#ppBulkBar-${listKey}`);
    const countEl = container.querySelector(`[data-pp-bulk-count="${listKey}"]`);
    const selAll = container.querySelector(`[data-pp-sel-all="${listKey}"]`);
    const getChecked = () => new Set(Array.from(container.querySelectorAll(`input[data-pp-row-cb="${listKey}"]:checked`)).map(cb => cb.value));

    function updateBar() {
      const ids = getChecked();
      if (countEl) countEl.textContent = `${ids.size} selected`;
      if (bar) bar.classList.toggle('pp-bulk-active', ids.size > 0);
      const allCbs = container.querySelectorAll(`input[data-pp-row-cb="${listKey}"]`);
      if (selAll) selAll.checked = allCbs.length > 0 && ids.size === allCbs.length;
    }

    if (selAll && !selAll.__ppWired) {
      selAll.__ppWired = true;
      selAll.addEventListener('change', () => {
        container.querySelectorAll(`input[data-pp-row-cb="${listKey}"]`).forEach(cb => { cb.checked = selAll.checked; });
        updateBar();
      });
    }

    container.querySelectorAll(`input[data-pp-row-cb="${listKey}"]`).forEach(cb => {
      if (cb.__ppWired) return;
      cb.__ppWired = true;
      cb.addEventListener('change', updateBar);
    });

    const delBtn = container.querySelector(`[data-pp-bulk-del="${listKey}"]`);
    if (delBtn && !delBtn.__ppWired) {
      delBtn.__ppWired = true;
      delBtn.addEventListener('click', () => {
        const ids = getChecked();
        if (!ids.size) return;
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(`Delete ${ids.size} selected item(s)?`)) return;
        }
        onDelete(ids);
      });
    }

    const archBtn = container.querySelector(`[data-pp-bulk-archive="${listKey}"]`);
    if (archBtn && onArchive && !archBtn.__ppWired) {
      archBtn.__ppWired = true;
      archBtn.addEventListener('click', () => {
        const ids = getChecked();
        if (ids.size) onArchive(ids);
      });
    }

    const unarchBtn = container.querySelector(`[data-pp-bulk-unarchive="${listKey}"]`);
    if (unarchBtn && onUnarchive && !unarchBtn.__ppWired) {
      unarchBtn.__ppWired = true;
      unarchBtn.addEventListener('click', () => {
        const ids = getChecked();
        if (ids.size) onUnarchive(ids);
      });
    }

    updateBar();
  }

  function enhanceDataTable(tbodyId, listKey, dbCollectionKey, allowArchive) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const table = tbody.closest('table');
    if (!table || !table.parentElement) return;
    injectStyles();

    const wrapper = table.parentElement;
    if (!document.getElementById(`ppBulkBar-${listKey}`)) {
      const bar = document.createElement('div');
      bar.id = `ppBulkBar-${listKey}`;
      bar.className = 'pp-bulk-bar';
      bar.innerHTML = `
        <span data-pp-bulk-count="${listKey}">0 selected</span>
        <div class="pp-bulk-actions">
          ${allowArchive ? `<button type="button" class="pp-bulk-btn pp-bulk-btn-amber" data-pp-bulk-archive="${listKey}">Archive Selected</button>` : ''}
          ${allowArchive ? `<button type="button" class="pp-bulk-btn" data-pp-bulk-unarchive="${listKey}">Unarchive Selected</button>` : ''}
          <button type="button" class="pp-bulk-btn pp-bulk-btn-danger" data-pp-bulk-del="${listKey}">Delete Selected</button>
        </div>`;
      wrapper.insertBefore(bar, table);
    }

    const theadRow = table.querySelector('thead tr');
    if (theadRow && !theadRow.querySelector(`[data-pp-sel-all="${listKey}"]`)) {
      const th = document.createElement('th');
      th.className = 'pp-sel-col';
      th.innerHTML = `<input type="checkbox" class="pp-sel-cb" data-pp-sel-all="${listKey}" aria-label="Select all ${listKey}" />`;
      theadRow.insertBefore(th, theadRow.firstChild);
    }

    tbody.querySelectorAll('tr').forEach(tr => {
      if (tr.querySelector(`[data-pp-row-cb="${listKey}"]`)) return;
      const rowId = extractRowId(tr, listKey);
      if (!rowId) return;
      const td = document.createElement('td');
      td.className = 'pp-sel-col';
      td.innerHTML = `<input type="checkbox" class="pp-sel-cb" data-pp-row-cb="${listKey}" value="${esc(rowId)}" aria-label="Select row" />`;
      tr.insertBefore(td, tr.firstChild);
    });

    wireBulkEventsForList(
      wrapper,
      listKey,
      (ids) => {
        const db = getDb();
        if (!Array.isArray(db[dbCollectionKey])) return;
        db[dbCollectionKey] = db[dbCollectionKey].filter(item => !ids.has(String(item.id)));
        if (dbCollectionKey === 'projects' && Array.isArray(db.allocations)) {
          db.allocations = db.allocations.filter(a => !ids.has(String(a.projectId)));
        }
        persistAppChanges();
        toast(`Deleted ${ids.size} ${listKey} item(s).`, 'success');
      },
      allowArchive ? (ids) => {
        const db = getDb();
        (db.projects || []).forEach(p => { if (ids.has(String(p.id))) p.archived = true; });
        persistAppChanges();
        toast(`Archived ${ids.size} project(s).`, 'success');
      } : null,
      allowArchive ? (ids) => {
        const db = getDb();
        (db.projects || []).forEach(p => { if (ids.has(String(p.id))) p.archived = false; });
        persistAppChanges();
        toast(`Unarchived ${ids.size} project(s).`, 'success');
      } : null
    );
  }

  function enhanceAllSetupDataLists() {
    enhanceDataTable('dataProjectsBody', 'projects', 'projects', true);
    enhanceDataTable('dataDeptsBody', 'departments', 'departments', false);
    enhanceDataTable('dataDepartmentsBody', 'departments', 'departments', false);
    enhanceDataTable('dataMilestonesBody', 'milestones', 'milestones', false);
    enhanceDataTable('dataHolidaysBody', 'holidays', 'holidays', false);
    renderPeopleDirectorySection();
  }

  if (typeof renderDataTab === 'function') {
    const nativeRenderDataTab = renderDataTab;
    renderDataTab = function (...args) {
      const res = nativeRenderDataTab.apply(this, args);
      enhanceAllSetupDataLists();
      return res;
    };
  }

  if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
    const wn = MANUAL_SECTIONS.find(s => s && s.id === 'whatsnew');
    if (wn && typeof wn.bodyHtml === 'string' && !wn.bodyHtml.includes('Owners &amp; Technical Leads Directory')) {
      wn.keywords = `${wn.keywords || ''} project owners technical leads directory dropdown bulk delete archive select`;
      wn.bodyHtml = wn.bodyHtml.replace(
        '</ul>',
        `<li>&bull; <strong>Owners &amp; Technical Leads Directory + Bulk Actions:</strong> Manage a dedicated list of Project Owners and Technical Leads in <strong>Setup &amp; Data</strong> with dropdown pickers in the Projects modal, plus multi-select checkboxes on all Setup &amp; Data lists to bulk-delete items or bulk-archive projects.</li></ul>`
      );
    }
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.__ppSetupDirTestApi = {
      getPeople: () => peopleList.slice(),
      addPerson(name, role) { peopleList.push({ id: makeId('ppl'), name, role: role || 'Both' }); savePeople(); },
      enhanceProjectModalFields,
    };
  }
})();
