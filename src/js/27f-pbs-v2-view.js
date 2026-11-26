/* PBS v2 - part 5b/7: dialog view (styles + pure HTML builders). Event wiring lives in part 5c.
 * Inert: only registers window.__ppPbsV2.view; nothing touches the DOM until injectStyles() is called by the UI. */
(function ppPbsV2ViewPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const MATURITY = ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];

  function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const CSS = `
    #ppPbsDialog { width: min(1120px, 96vw); max-height: 92vh; border: 1px solid var(--border-subtle, #e2e8f0); border-radius: 1rem; padding: 0; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); box-shadow: 0 25px 50px -12px rgba(15, 23, 42, .32); overflow: hidden; }
    #ppPbsDialog::backdrop { background: rgba(15, 23, 42, .55); backdrop-filter: blur(3px); }
    .pp-pbs-wrap { display: flex; flex-direction: column; max-height: 92vh; }
    .pp-pbs-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .6rem; padding: .9rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); }
    .pp-pbs-toolbar, .pp-pbs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; padding: .55rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-card, #ffffff); font-size: 11.5px; }
    .pp-pbs-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11px; }
    .pp-pbs-body { padding: .85rem 1.15rem; overflow-y: auto; flex: 1 1 auto; }
    .pp-pbs-btn { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; padding: .34rem .62rem; border-radius: .55rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-primary, #334155); font-size: 11.5px; font-weight: 700; cursor: pointer; }
    .pp-pbs-btn:hover { background: var(--surface-subtle, #f1f5f9); }
    .pp-pbs-btn:focus-visible, .pp-pbs-toggle:focus-visible, .pp-pbs-input:focus-visible, .pp-pbs-select:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
    .pp-pbs-btn-primary { background: #4f46e5; border-color: #4f46e5; color: #ffffff; }
    .pp-pbs-btn-primary:hover { background: #4338ca; }
    .pp-pbs-btn-emerald { background: #059669; border-color: #059669; color: #ffffff; }
    .pp-pbs-btn-emerald:hover { background: #047857; }
    .pp-pbs-btn-danger { border-color: #fecdd3; background: #fff1f2; color: #be123c; }
    .pp-pbs-btn-xs { padding: .16rem .38rem; font-size: 10.5px; border-radius: .4rem; }
    .pp-pbs-input, .pp-pbs-select { padding: .32rem .55rem; border-radius: .5rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 11.5px; }
    .pp-pbs-pill { display: inline-flex; align-items: center; gap: .25rem; padding: .16rem .5rem; border-radius: 9999px; font-size: 10.5px; font-weight: 700; }
    .pp-pbs-status-ok { background: #dcfce7; color: #166534; }
    .pp-pbs-status-warn { background: #fef3c7; color: #92400e; }
    .pp-pbs-status-error { background: #ffe4e6; color: #9f1239; }
    .pp-pbs-status-idle { background: #f1f5f9; color: #475569; }
    .pp-pbs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .pp-pbs-table th, .pp-pbs-table td { padding: .45rem .55rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); text-align: left; vertical-align: middle; }
    .pp-pbs-table th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #64748b); }
    .pp-pbs-row-ctx { opacity: .62; }
    .pp-pbs-row:focus-visible { outline: 2px solid #4f46e5; outline-offset: -2px; }
    .pp-pbs-toggle { width: 1.25rem; height: 1.25rem; display: inline-flex; align-items: center; justify-content: center; border-radius: .35rem; border: 1px solid transparent; background: transparent; color: var(--text-muted, #64748b); cursor: pointer; font-size: 10px; margin-right: .25rem; }
    .pp-pbs-toggle:hover { background: var(--surface-subtle, #e2e8f0); color: var(--text-primary, #0f172a); }
    .pp-pbs-form { margin-bottom: .85rem; padding: .85rem; border-radius: .85rem; border: 1px solid #c7d2fe; background: var(--surface-subtle, #f8fafc); display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: .55rem; }
    .pp-pbs-field { display: flex; flex-direction: column; gap: .2rem; font-size: 11px; font-weight: 700; }
    .pp-pbs-conflict, .pp-pbs-notice { margin-bottom: .85rem; padding: .85rem; border-radius: .85rem; border: 1px solid #f59e0b; background: #fffbeb; color: #78350f; font-size: 11.5px; }
    .pp-pbs-notice { border-color: #93c5fd; background: #eff6ff; color: #1e3a8a; }
    .pp-pbs-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .pp-pbs-mat-Draft { background: #f1f5f9; color: #475569; }
    .pp-pbs-mat-PDR { background: #fef3c7; color: #92400e; }
    .pp-pbs-mat-CDR { background: #e0e7ff; color: #3730a3; }
    .pp-pbs-mat-Qualified { background: #d1fae5; color: #065f46; }
    .pp-pbs-mat-Delivered { background: #059669; color: #ffffff; }
    .pp-pbs-proj-btn { display: inline-flex; align-items: center; gap: .25rem; padding: .22rem .5rem; border-radius: .5rem; border: 1px solid #c7d2fe; background: #eef2ff; color: #3730a3; font-size: 11px; font-weight: 700; cursor: pointer; margin-right: .3rem; }
    .pp-pbs-proj-btn:hover { background: #e0e7ff; }
    html.dark #ppPbsDialog, body.dark #ppPbsDialog { background: #0f172a; color: #e2e8f0; border-color: #334155; }
    html.dark .pp-pbs-head, body.dark .pp-pbs-head, html.dark .pp-pbs-summary, body.dark .pp-pbs-summary, html.dark .pp-pbs-form, body.dark .pp-pbs-form { background: #1e293b; border-color: #334155; }
    html.dark .pp-pbs-toolbar, body.dark .pp-pbs-toolbar, html.dark .pp-pbs-filters, body.dark .pp-pbs-filters { background: #0f172a; border-color: #334155; }
    html.dark .pp-pbs-btn, body.dark .pp-pbs-btn { background: #1e293b; color: #e2e8f0; border-color: #475569; }
    html.dark .pp-pbs-input, body.dark .pp-pbs-input, html.dark .pp-pbs-select, body.dark .pp-pbs-select { background: #0f172a; color: #e2e8f0; border-color: #475569; }
    html.dark .pp-pbs-conflict, body.dark .pp-pbs-conflict { background: rgba(180,83,9,.22); color: #fde68a; border-color: #d97706; }
    html.dark .pp-pbs-notice, body.dark .pp-pbs-notice { background: rgba(30,64,175,.25); color: #bfdbfe; border-color: #3b82f6; }
    @media (max-width: 767px) {
      #ppPbsDialog { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; border-radius: 0; border: 0; }
      .pp-pbs-wrap { height: 100dvh; max-height: 100dvh; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
      .pp-pbs-head { padding: .65rem .8rem; gap: .4rem; }
      .pp-pbs-tip { display: none; }
      .pp-pbs-toolbar { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding: .45rem .8rem; gap: .35rem; }
      .pp-pbs-toolbar::-webkit-scrollbar { display: none; }
      .pp-pbs-toolbar > * { flex: 0 0 auto; }
      .pp-pbs-summary { padding: .45rem .8rem; gap: .35rem; }
      .pp-pbs-filters { display: grid; grid-template-columns: 1fr 1fr; padding: .5rem .8rem; gap: .4rem; }
      .pp-pbs-filters #ppPbsFilterSearch { grid-column: 1 / -1; min-width: 0 !important; width: 100%; }
      .pp-pbs-filters #ppPbsClearFiltersBtn { grid-column: 1 / -1; }
      .pp-pbs-body { padding: .65rem .8rem 1rem; }
      .pp-pbs-btn { min-height: 38px; padding: .4rem .7rem; font-size: 12.5px; }
      .pp-pbs-btn-xs { min-height: 36px; padding: .3rem .55rem; font-size: 12px; }
      .pp-pbs-input, .pp-pbs-select { min-height: 38px; font-size: 16px; width: 100%; box-sizing: border-box; }
      .pp-pbs-toolbar .pp-pbs-select { width: auto; max-width: 210px; font-size: 13px; }
      .pp-pbs-toggle { width: 2rem; height: 2rem; font-size: 12px; }
      .pp-pbs-form { grid-template-columns: 1fr; padding: .75rem; }
      .pp-pbs-form .pp-pbs-field { grid-column: auto !important; }
      .pp-pbs-table, .pp-pbs-table tbody { display: block; width: 100%; }
      .pp-pbs-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      .pp-pbs-table tr.pp-pbs-row { display: block; margin: 0 0 .65rem calc(min(var(--pbs-depth, 0), 4) * 10px); padding: .55rem .7rem; border: 1px solid var(--border-subtle, #e2e8f0); border-left-width: 4px; border-radius: .75rem; background: var(--surface-card, #ffffff); }
      .pp-pbs-table tr:not(.pp-pbs-row), .pp-pbs-table td[colspan] { display: block; width: 100%; border: 0; }
      .pp-pbs-table tr.pp-pbs-row td { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; padding: .22rem 0 !important; border-bottom: 0; white-space: normal !important; text-align: left !important; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-code { display: inline-flex; font-size: 11px; color: var(--text-muted, #64748b); margin-right: .45rem; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-mat { display: inline-flex; float: right; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-name { display: block; padding: .2rem 0 .35rem !important; font-size: 13.5px; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-dept::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-owner::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-ms::before { content: attr(data-label); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #64748b); flex-shrink: 0; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-actions { display: block; margin-top: .4rem; padding-top: .45rem !important; border-top: 1px solid var(--border-subtle, #e2e8f0); }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-actions [role="group"] { display: flex; flex-wrap: wrap; gap: .3rem; }
      html.dark .pp-pbs-table tr.pp-pbs-row, body.dark .pp-pbs-table tr.pp-pbs-row { background: #1e293b; border-color: #334155; }
      html.dark .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-actions, body.dark .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-actions { border-top-color: #334155; }
    }
  `;

  function injectStyles() {
    if (document.getElementById('ppPbsStyles')) return;
    const style = document.createElement('style');
    style.id = 'ppPbsStyles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const matPill = (m) => `<span class="pp-pbs-pill pp-pbs-mat-${esc(m)}">${esc(m)}</span>`;

  /* ctx.rows: [{ item, depth, hasChildren, isContextOnly }]; ctx.summary from tree.computeMaturitySummary; ctx.collapsedIds: Set */
  function renderRows(ctx) {
    const deptMap = new Map((ctx.db.departments || []).map(d => [d.id, d]));
    const msMap = new Map((ctx.db.milestones || []).map(m => [m.id, m]));
    if (!ctx.rows.length) {
      const msg = ctx.doc.items.length ? 'No PBS items match the active filters.' : 'No PBS deliverables yet. Use <strong>+ Add Root Item</strong>, import a CSV, or clone another project.';
      return `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--text-muted,#64748b)">${msg}</td></tr>`;
    }
    return ctx.rows.map(({ item, depth, hasChildren, isContextOnly }) => {
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      const collapsed = ctx.collapsedIds.has(item.id);
      const bottleneck = ctx.summary.bottleneckMap.get(item.id);
      const overdue = ctx.summary.overdueIds.has(item.id);
      const nm = esc(item.name);
      const id = esc(item.id);
      const toggle = hasChildren
        ? `<button type="button" class="pp-pbs-toggle" data-pbs-toggle="${id}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${nm}">${collapsed ? '\u25b6' : '\u25bc'}</button>`
        : '<span style="display:inline-block;width:1.5rem" aria-hidden="true"></span>';
      const msCell = ms
        ? `${esc(ms.title)}${ms.date ? ` <span style="font-size:10px;color:${overdue ? '#be123c' : '#64748b'};font-weight:${overdue ? 800 : 400}">(${esc(ms.date)}${overdue ? ' \u00b7 Overdue' : ''})</span>` : ''}`
        : '\u2014';
      const btn = (act, label, text) => `<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-move="${act}" data-pbs-id="${id}" aria-label="${label} ${nm}">${text}</button>`;
      return `<tr class="pp-pbs-row${isContextOnly ? ' pp-pbs-row-ctx' : ''}" tabindex="0" data-pbs-row="${id}" style="--pbs-depth:${depth};border-left:4px solid ${esc(dept && dept.color ? dept.color : 'transparent')}">
        <td class="pp-pbs-cell-code" data-label="Code" style="font-family:ui-monospace,monospace;font-weight:700;white-space:nowrap">${esc(item.code)}</td>
        <td class="pp-pbs-cell-name" data-label="Deliverable" style="padding-left:${6 + depth * 18}px">${toggle}<span style="font-weight:${depth === 0 ? 800 : 600}">${nm}</span>${bottleneck ? ` <span class="pp-pbs-pill pp-pbs-status-warn" title="A child deliverable is still at ${esc(bottleneck)}">\u26a0 Child at ${esc(bottleneck)}</span>` : ''}${item.notes ? `<div style="font-size:10.5px;color:var(--text-muted,#64748b);margin-left:1.5rem">${esc(item.notes)}</div>` : ''}</td>
        <td class="pp-pbs-cell-mat" data-label="Maturity">${matPill(item.maturity)}</td>
        <td class="pp-pbs-cell-dept" data-label="Department" style="color:${esc(dept && dept.color ? dept.color : 'inherit')};font-weight:600;white-space:nowrap">${dept ? esc(`[${dept.code}] ${dept.name}`) : '\u2014'}</td>
        <td class="pp-pbs-cell-owner" data-label="Owner" style="white-space:nowrap">${esc(item.owner || '\u2014')}</td>
        <td class="pp-pbs-cell-ms" data-label="Milestone" style="white-space:nowrap">${msCell}</td>
        <td class="pp-pbs-cell-actions" data-label="Actions" style="text-align:right;white-space:nowrap"><span role="group" aria-label="Actions for ${nm}">${btn('up', 'Move up', '\u2191')} ${btn('down', 'Move down', '\u2193')} ${btn('outdent', 'Outdent', '\u2190')} ${btn('indent', 'Indent', '\u2192')}
          <button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-add-child="${id}" aria-label="Add child to ${nm}">+Child</button>
          <button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-edit="${id}" aria-label="Edit ${nm}">Edit</button>
          <button type="button" class="pp-pbs-btn pp-pbs-btn-xs pp-pbs-btn-danger" data-pbs-del="${id}" aria-label="Delete ${nm}">\u00d7</button></span></td>
      </tr>`;
    }).join('');
  }

  function renderEditForm(ctx) {
    const e = ctx.edit;
    if (!e || !e.open) return '';
    const item = e.item || null;
    const field = (label, inner, extra) => `<label class="pp-pbs-field"${extra ? ` style="${extra}"` : ''}><span>${label}</span>${inner}</label>`;
    const deptOpts = (ctx.db.departments || []).map(d => `<option value="${esc(d.id)}"${item && item.deptId === d.id ? ' selected' : ''}>[${esc(d.code)}] ${esc(d.name)}</option>`).join('');
    const msOpts = (ctx.projectMilestones || []).map(m => `<option value="${esc(m.id)}"${item && item.milestoneId === m.id ? ' selected' : ''}>${esc(m.title)}${m.date ? ` (${esc(m.date)})` : ''}</option>`).join('');
    const parentOpts = (e.parentCandidates || []).map(p => `<option value="${esc(p.id)}"${p.id === (e.parentId || '') ? ' selected' : ''}>${esc(p.code)} \u2014 ${esc(p.name)}</option>`).join('');
    const matOpts = MATURITY.map(m => `<option value="${m}"${(item ? item.maturity : 'Draft') === m ? ' selected' : ''}>${m}</option>`).join('');
    const owners = (ctx.owners || []).map(o => `<option value="${esc(o)}"></option>`).join('');
    return `<form id="ppPbsItemForm" class="pp-pbs-form" aria-label="${item ? 'Edit PBS item' : 'Add PBS item'}">
      ${field('Code *', `<input type="text" id="ppPbsFCode" class="pp-pbs-input" value="${esc(item ? item.code : e.suggestedCode)}" required />`)}
      ${field('Deliverable / Subsystem Name *', `<input type="text" id="ppPbsFName" class="pp-pbs-input" value="${esc(item ? item.name : '')}" placeholder="e.g., Power Supply Unit" required />`, 'grid-column:span 2')}
      ${field('Parent Item', `<select id="ppPbsFParent" class="pp-pbs-select"><option value="">(Root Level)</option>${parentOpts}</select>`)}
      ${field('Maturity Gate', `<select id="ppPbsFMaturity" class="pp-pbs-select">${matOpts}</select>`)}
      ${field('Department', `<select id="ppPbsFDept" class="pp-pbs-select"><option value="">\u2014 Unassigned \u2014</option>${deptOpts}</select>`)}
      ${field('Owner (People Directory)', `<input type="text" id="ppPbsFOwner" list="ppPbsOwnerList" class="pp-pbs-input" value="${esc(item ? item.owner : '')}" placeholder="Type or pick a name..." autocomplete="off" /><datalist id="ppPbsOwnerList">${owners}</datalist>`)}
      ${field('Linked Milestone', `<select id="ppPbsFMilestone" class="pp-pbs-select"><option value="">\u2014 None \u2014</option>${msOpts}</select>`)}
      ${field('Notes / Acceptance Criteria', `<input type="text" id="ppPbsFNotes" class="pp-pbs-input" value="${esc(item ? item.notes : '')}" placeholder="Optional specification, part ref, or gate criteria..." />`, 'grid-column:1 / -1')}
      <div style="grid-column:1 / -1;display:flex;justify-content:flex-end;gap:.45rem">
        <button type="button" class="pp-pbs-btn" id="ppPbsFormCancel">Cancel</button>
        <button type="submit" class="pp-pbs-btn pp-pbs-btn-primary">${item ? 'Save Changes' : 'Add PBS Item'}</button>
      </div></form>`;
  }

  /* ctx.conflict: { diff: { addedRemote, modifiedBoth, onlyLocal } | null } or null */
  function renderConflictPanel(ctx) {
    if (!ctx.conflict) return '';
    const diff = ctx.conflict.diff;
    const summary = diff
      ? `Remote added: <strong>${diff.addedRemote.length}</strong> &middot; Modified in both: <strong>${diff.modifiedBoth.length}</strong> &middot; Local only: <strong>${diff.onlyLocal.length}</strong>`
      : 'The shared folder file changed on disk and could not be compared (it may be encrypted with another passphrase).';
    const lines = diff ? [
      ...diff.addedRemote.map(r => `<div>+ <strong>Remote:</strong> ${esc(r.code)} ${esc(r.name)} (${esc(r.maturity)})</div>`),
      ...diff.modifiedBoth.map(m => `<div>~ <strong>Both:</strong> ${esc(m.local.code)} ${esc(m.local.name)} [Local: ${esc(m.local.maturity)} / Remote: ${esc(m.remote.maturity)}]</div>`),
      ...diff.onlyLocal.map(l => `<div>\u2022 <strong>Local only:</strong> ${esc(l.code)} ${esc(l.name)}</div>`),
    ] : [];
    return `<div class="pp-pbs-conflict" role="alert"><div style="font-weight:800;margin-bottom:.25rem">Sync Conflict Detected</div><div>${summary}</div>
      ${lines.length ? `<div style="margin:.45rem 0;max-height:110px;overflow-y:auto;border-top:1px solid rgba(180,83,9,.25);padding-top:.35rem;font-size:11px">${lines.join('')}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem">
        ${diff ? '<button type="button" class="pp-pbs-btn pp-pbs-btn-emerald" id="ppPbsConflictMerge">Merge Non-Conflicting</button>' : ''}
        <button type="button" class="pp-pbs-btn" id="ppPbsConflictLoad">Load Shared Folder</button>
        <button type="button" class="pp-pbs-btn pp-pbs-btn-danger" id="ppPbsConflictOverwrite">Overwrite with Local</button>
      </div></div>`;
  }

  function renderToolbar(ctx) {
    const folderBtn = !ctx.canDirSync ? ''
      : ctx.dirName ? `<button type="button" class="pp-pbs-btn" id="ppPbsRelinkBtn">Folder: ${esc(ctx.dirName)}</button>`
        : ctx.hasRemembered ? '<button type="button" class="pp-pbs-btn" id="ppPbsReconnectBtn">Reconnect Folder</button>'
          : '<button type="button" class="pp-pbs-btn" id="ppPbsLinkFolderBtn">Link Sync Folder</button>';
    const clone = (ctx.cloneSources || []).length
      ? `<select id="ppPbsCloneSelect" class="pp-pbs-select" aria-label="Clone PBS from another project"><option value="">Clone from project...</option>${ctx.cloneSources.map(p => `<option value="${esc(p.id)}">[${esc(p.code)}] ${esc(p.name)} (${esc(p.count)})</option>`).join('')}</select>`
      : '';
    return `<div class="pp-pbs-toolbar" role="toolbar" aria-label="PBS actions">
      <button type="button" class="pp-pbs-btn pp-pbs-btn-primary" id="ppPbsAddRootBtn">+ Add Root Item</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsExpandAllBtn">Expand All</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsCollapseAllBtn">Collapse All</button>
      ${folderBtn}
      <button type="button" class="pp-pbs-btn" id="ppPbsSaveJsonBtn">Save JSON</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsLoadJsonBtn">Load JSON</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsExportCsvBtn">Export CSV</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsImportCsvBtn">Import CSV</button>
      <button type="button" class="pp-pbs-btn pp-pbs-btn-emerald" id="ppPbsExportSvgBtn">SVG Diagram</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsExportPdfBtn">PDF Report</button>
      ${clone}
      <input type="file" id="ppPbsJsonFileInput" accept=".json,application/json" style="display:none" tabindex="-1" />
      <input type="file" id="ppPbsCsvFileInput" accept=".csv,.tsv,.txt,text/csv" style="display:none" tabindex="-1" />
    </div>`;
  }

  function renderSummary(ctx) {
    const s = ctx.summary;
    return `<div class="pp-pbs-summary" aria-label="Maturity gate summary"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem">
      ${MATURITY.map(m => `<span class="pp-pbs-pill pp-pbs-mat-${m}">${m}: ${s.counts[m]}</span>`).join('')}
      ${s.overdueCount ? `<span class="pp-pbs-pill pp-pbs-status-error">\u26a0 ${s.overdueCount} overdue milestone link${s.overdueCount === 1 ? '' : 's'}</span>` : ''}</div>
      <div style="display:flex;align-items:center;gap:.45rem;font-weight:700"><span>Qualified / Delivered: ${s.qualifiedPct}%</span>
      <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.qualifiedPct}" aria-label="Qualified or delivered share" style="width:90px;height:8px;border-radius:9999px;background:#e2e8f0;overflow:hidden"><div style="width:${s.qualifiedPct}%;height:100%;background:#059669"></div></div></div></div>`;
  }

  function renderFilters(ctx) {
    const f = ctx.filter;
    const active = Boolean(f.search || f.deptId || f.maturity || f.milestoneId);
    const sel = (id, label, all, opts, cur) => `<select id="${id}" class="pp-pbs-select" aria-label="${label}"><option value="">${all}</option>${opts.map(o => `<option value="${esc(o.v)}"${cur === o.v ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
    return `<div class="pp-pbs-filters" role="search" aria-label="Filter PBS items">
      <input type="search" id="ppPbsFilterSearch" class="pp-pbs-input" style="min-width:190px;flex:1" aria-label="Search PBS items" placeholder="Filter by code, deliverable, owner, or notes..." value="${esc(f.search)}" />
      ${sel('ppPbsFilterDept', 'Filter by department', 'All Departments', (ctx.db.departments || []).map(d => ({ v: d.id, t: `[${d.code}] ${d.name}` })), f.deptId)}
      ${sel('ppPbsFilterMaturity', 'Filter by maturity', 'All Gates', MATURITY.map(m => ({ v: m, t: m })), f.maturity)}
      ${sel('ppPbsFilterMs', 'Filter by milestone', 'All Milestones', (ctx.projectMilestones || []).map(m => ({ v: m.id, t: m.title })), f.milestoneId)}
      ${active ? '<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" id="ppPbsClearFiltersBtn">Reset</button>' : ''}</div>`;
  }

  function renderNotice(ctx) {
    const w = ctx.notices || [];
    if (!w.length) return '';
    return `<div class="pp-pbs-notice" role="status"><strong>Import notes</strong><ul style="margin:.3rem 0 0 1rem;list-style:disc">${w.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${w.length > 8 ? `<div>\u2026and ${w.length - 8} more.</div>` : ''}</div>`;
  }

  /* ctx: { doc, db, project, summary, rows, collapsedIds, filter, edit, conflict, notices, owners, projectMilestones,
   *        cloneSources:[{id,code,name,count}], canDirSync, dirName, hasRemembered, status:{text,tone} } */
  function buildDialogHtml(ctx) {
    const p = ctx.project;
    const n = ctx.summary.total;
    return `<div class="pp-pbs-wrap">
      <header class="pp-pbs-head"><div>
        <h2 id="ppPbsDialogTitle" style="margin:0;font-size:15px;font-weight:800">PBS \u2014 ${p ? `[${esc(p.code)}] ${esc(p.name)}` : 'Project'}</h2>
        <div style="font-size:11px;color:var(--text-muted,#64748b)">Rev ${esc(ctx.doc.meta.revision)} &middot; ${n} item${n === 1 ? '' : 's'}<span class="pp-pbs-tip"> &middot; Tip: focus a row, then Alt+Arrows to move or indent, Enter to edit</span></div></div>
        <div style="display:flex;align-items:center;gap:.45rem"><span id="ppPbsSyncStatus" class="pp-pbs-pill pp-pbs-status-${esc(ctx.status.tone)}" role="status" aria-live="polite">${esc(ctx.status.text)}</span>
        <button type="button" class="pp-pbs-btn" id="ppPbsCloseBtn" aria-label="Close PBS dialog">Close</button></div></header>
      ${renderToolbar(ctx)}${renderSummary(ctx)}${renderFilters(ctx)}
      <div class="pp-pbs-body">${renderConflictPanel(ctx)}${renderNotice(ctx)}${renderEditForm(ctx)}
        <div style="overflow-x:auto"><table class="pp-pbs-table"><caption class="pp-pbs-sr">Product breakdown structure items</caption>
          <thead><tr><th scope="col">Code</th><th scope="col">Deliverable / Subsystem</th><th scope="col">Maturity</th><th scope="col">Department</th><th scope="col">Owner</th><th scope="col">Milestone</th><th scope="col" style="text-align:right">Actions</th></tr></thead>
          <tbody>${renderRows(ctx)}</tbody></table></div></div></div>`;
  }

  P.view = { esc, CSS, injectStyles, renderRows, renderEditForm, renderConflictPanel, renderToolbar, renderSummary, renderFilters, renderNotice, buildDialogHtml };
})();
