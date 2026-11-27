/* PBS v2 - part 5b/7: dialog view (styles + pure HTML builders). Event wiring lives in part 5c.
 * Inert: only registers window.__ppPbsV2.view; nothing touches the DOM until injectStyles() is called by the UI. */
(function ppPbsV2ViewPart() {
  const P = (globalThis.__ppPbsV2 = globalThis.__ppPbsV2 || {});
  const MATURITY = ['Draft', 'PDR', 'CDR', 'Qualified', 'Delivered'];
  const HERITAGE = ['Existing', 'Update', 'New'];
  const YESNO = ['Yes', 'No'];

  function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const fmtNum = (v) => (P.data && typeof P.data.formatNum === 'function' ? P.data.formatNum(v) : (isNum(v) ? String(v) : ''));
  const countSpecs = (it) => (P.data && typeof P.data.countOptionalFields === 'function'
    ? P.data.countOptionalFields(it)
    : { identity: 0, docs: 0, proc: 0, eng: 0, total: 0 });

  const CSS = `
    #ppPbsDialog { width: min(1220px, calc(100% - 24px)); max-width: calc(100% - 24px); max-height: 92vh; max-height: 92dvh; margin: auto; inset: 0; box-sizing: border-box; border: 1px solid var(--border-subtle, #e2e8f0); border-radius: 1rem; padding: 0; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); box-shadow: 0 25px 50px -12px rgba(15, 23, 42, .32); overflow: hidden; overflow: clip; }
    #ppPbsDialog::backdrop { background: rgba(15, 23, 42, .55); backdrop-filter: blur(3px); }
    #ppPbsDialog.pp-pbs-expanded { width: calc(100% - 16px); max-width: calc(100% - 16px); height: calc(100vh - 20px); height: calc(100dvh - 20px); max-height: calc(100vh - 20px); max-height: calc(100dvh - 20px); margin: auto; inset: 0; border-radius: .65rem; }
    .pp-pbs-wrap { display: flex; flex-direction: column; width: 100%; max-width: 100%; max-height: calc(92vh - 2px); max-height: calc(92dvh - 2px); overflow: hidden; box-sizing: border-box; }
    #ppPbsDialog.pp-pbs-expanded .pp-pbs-wrap { height: 100%; max-height: 100%; }
    .pp-pbs-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .6rem; padding: .9rem 1.15rem; border-top: 4px solid var(--pbs-proj-color, #4f46e5); border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); flex: 0 0 auto; }
    .pp-pbs-head-title { min-width: 0; flex: 1 1 240px; }
    .pp-pbs-head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; flex: 0 0 auto; margin-left: auto; }
    #ppPbsSyncStatus { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp-pbs-toolbar, .pp-pbs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; padding: .55rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-card, #ffffff); font-size: 11.5px; flex: 0 0 auto; }
    .pp-pbs-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11px; flex: 0 0 auto; }
    .pp-pbs-colbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .45rem; padding: .42rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11px; flex: 0 0 auto; }
    .pp-pbs-colchips { display: flex; flex-wrap: wrap; align-items: center; gap: .32rem; }
    .pp-pbs-colbar-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted, #64748b); margin-right: .15rem; }
    .pp-pbs-chip { display: inline-flex; align-items: center; gap: .28rem; padding: .22rem .55rem; border-radius: 9999px; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-muted, #475569); font-size: 11px; font-weight: 700; cursor: pointer; }
    .pp-pbs-chip:hover { background: var(--surface-subtle, #f1f5f9); color: var(--text-primary, #0f172a); }
    .pp-pbs-chip.is-active { background: #eef2ff; border-color: #6366f1; color: #3730a3; }
    .pp-pbs-chip-cnt { font-size: 9.5px; font-weight: 800; padding: .02rem .32rem; border-radius: 9999px; background: rgba(79, 70, 229, .12); color: #4338ca; }
    .pp-pbs-colhint { font-size: 10.5px; color: var(--text-muted, #64748b); }
    .pp-pbs-body { padding: .85rem 1.15rem; overflow-y: auto; flex: 1 1 auto; min-height: 0; min-width: 0; }
    .pp-pbs-btn { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; padding: .34rem .62rem; border-radius: .55rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-primary, #334155); font-size: 11.5px; font-weight: 700; cursor: pointer; }
    .pp-pbs-btn:hover:not(:disabled) { background: var(--surface-subtle, #f1f5f9); }
    .pp-pbs-btn:disabled { opacity: .42; cursor: not-allowed; }
    .pp-pbs-btn:focus-visible, .pp-pbs-toggle:focus-visible, .pp-pbs-input:focus-visible, .pp-pbs-select:focus-visible, .pp-pbs-chip:focus-visible, .pp-pbs-pill-btn:focus-visible, .pp-pbs-textarea:focus-visible, .pp-pbs-pdf-group-toggle:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
    .pp-pbs-btn-primary { background: #4f46e5; border-color: #4f46e5; color: #ffffff; }
    .pp-pbs-btn-primary:hover:not(:disabled) { background: #4338ca; }
    .pp-pbs-btn-emerald { background: #059669; border-color: #059669; color: #ffffff; }
    .pp-pbs-btn-emerald:hover:not(:disabled) { background: #047857; }
    .pp-pbs-btn-danger { border-color: #fecdd3; background: #fff1f2; color: #be123c; }
    .pp-pbs-btn-xs { padding: .16rem .38rem; font-size: 10.5px; border-radius: .4rem; }
    .pp-pbs-input, .pp-pbs-select { padding: .32rem .55rem; border-radius: .5rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 11.5px; }
    .pp-pbs-pill { display: inline-flex; align-items: center; gap: .25rem; padding: .16rem .5rem; border-radius: 9999px; font-size: 10.5px; font-weight: 700; }
    .pp-pbs-pill-btn { cursor: pointer; border: 1px solid transparent; transition: filter .12s, box-shadow .12s; }
    .pp-pbs-pill-btn:hover { filter: brightness(.95); }
    .pp-pbs-pill-btn.is-active { box-shadow: 0 0 0 2px #4f46e5; }
    .pp-pbs-pill-swp { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; }
    .pp-pbs-status-ok { background: #dcfce7; color: #166534; }
    .pp-pbs-status-warn { background: #fef3c7; color: #92400e; }
    .pp-pbs-status-error { background: #ffe4e6; color: #9f1239; }
    .pp-pbs-status-idle { background: #f1f5f9; color: #475569; }
    .pp-pbs-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .pp-pbs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .pp-pbs-table th, .pp-pbs-table td { padding: .45rem .55rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); text-align: left; vertical-align: middle; }
    .pp-pbs-table th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #64748b); white-space: nowrap; }
    .pp-pbs-table.pp-pbs-sticky { border-collapse: separate; border-spacing: 0; }
    .pp-pbs-table.pp-pbs-sticky th, .pp-pbs-table.pp-pbs-sticky td { padding: .42rem .48rem; font-size: 11.5px; }
    .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-code, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-code, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-foot-code { position: sticky; left: 0; z-index: 2; width: 64px; min-width: 64px; max-width: 64px; background: var(--surface-card, #ffffff); overflow: hidden; text-overflow: ellipsis; }
    .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-name, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-name, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-foot-name { position: sticky; left: 64px; z-index: 2; min-width: 215px; max-width: 265px; background: var(--surface-card, #ffffff); box-shadow: 4px 0 8px -4px rgba(15, 23, 42, .14); }
    .pp-pbs-table.pp-pbs-sticky thead th.pp-pbs-th-code, .pp-pbs-table.pp-pbs-sticky thead th.pp-pbs-th-name { z-index: 4; }
    .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-code, .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-name { z-index: 3; background: var(--surface-subtle, #f1f5f9); }
    .pp-pbs-table tfoot tr.pp-pbs-total-row td { background: var(--surface-subtle, #f1f5f9); font-weight: 800; border-top: 2px solid var(--border-subtle, #cbd5e1); border-bottom: 0; }
    .pp-pbs-th-opt { color: #4338ca !important; }
    .pp-pbs-row-ctx { opacity: .62; }
    .pp-pbs-row:focus-visible { outline: 2px solid #4f46e5; outline-offset: -2px; }
    .pp-pbs-dept-dot { display: inline-block; width: 8px; height: 8px; border-radius: 9999px; margin-right: .35rem; vertical-align: middle; flex-shrink: 0; }
    .pp-pbs-name-flex { display: flex; align-items: flex-start; gap: .25rem; }
    .pp-pbs-name-main { min-width: 0; flex: 1 1 auto; }
    .pp-pbs-name-line { line-height: 1.35; }
    .pp-pbs-toggle { width: 1.25rem; height: 1.25rem; flex: 0 0 1.25rem; display: inline-flex; align-items: center; justify-content: center; border-radius: .35rem; border: 1px solid transparent; background: transparent; color: var(--text-muted, #64748b); cursor: pointer; font-size: 10px; }
    .pp-pbs-toggle:hover { background: var(--surface-subtle, #e2e8f0); color: var(--text-primary, #0f172a); }
    .pp-pbs-toggle-spacer { display: inline-block; width: 1.25rem; flex: 0 0 1.25rem; }
    .pp-pbs-acr { display: inline-block; margin-left: .32rem; padding: .04rem .36rem; border-radius: .35rem; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; vertical-align: middle; }
    .pp-pbs-her { display: inline-block; margin-left: .28rem; padding: .04rem .38rem; border-radius: 9999px; font-size: 9.5px; font-weight: 700; vertical-align: middle; }
    .pp-pbs-her-Existing { background: #e2e8f0; color: #334155; }
    .pp-pbs-her-Update { background: #fef3c7; color: #92400e; }
    .pp-pbs-her-New { background: #e0e7ff; color: #3730a3; }
    .pp-pbs-yn { display: inline-block; padding: .08rem .4rem; border-radius: 9999px; font-size: 10px; font-weight: 700; }
    .pp-pbs-yn-Yes { background: #d1fae5; color: #065f46; }
    .pp-pbs-yn-No { background: #f1f5f9; color: #64748b; }
    .pp-pbs-yn-Warn { background: #fef3c7; color: #92400e; border: 1px solid #f59e0b; }
    .pp-pbs-subtext { font-size: 10.5px; color: var(--text-muted, #64748b); line-height: 1.35; margin-top: .08rem; }
    .pp-pbs-cell-sub { display: block; font-size: 9.5px; line-height: 1.25; color: var(--text-muted, #64748b); font-weight: 600; }
    .pp-pbs-cell-warn { color: #b45309 !important; font-weight: 700; }
    .pp-pbs-cell-err { color: #be123c !important; font-weight: 700; }
    .pp-pbs-link { color: #4338ca; text-decoration: underline; text-underline-offset: 2px; font-weight: 600; white-space: nowrap; }
    .pp-pbs-link:hover { color: #312e81; }
    .pp-pbs-num { font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right !important; }
    .pp-pbs-center { text-align: center !important; white-space: nowrap; }
    .pp-pbs-rollup { font-style: italic; color: var(--text-muted, #64748b); font-size: 11px; }
    .pp-pbs-mono { font-family: ui-monospace, monospace; font-size: 11px; white-space: nowrap; }
    .pp-pbs-desc-cell { min-width: 150px; max-width: 240px; line-height: 1.3; }
    .pp-pbs-form, .pp-pbs-paste, .pp-pbs-pdf-panel { margin-bottom: .85rem; padding: .85rem; border-radius: .85rem; border: 1px solid #c7d2fe; background: var(--surface-subtle, #f8fafc); }
    .pp-pbs-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); align-items: end; gap: .55rem; }
    .pp-pbs-paste, .pp-pbs-pdf-panel { display: flex; flex-direction: column; gap: .6rem; }
    .pp-pbs-pdf-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; }
    .pp-pbs-pdf-presets { display: flex; flex-wrap: wrap; align-items: center; gap: .32rem; }
    .pp-pbs-pdf-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(195px, 1fr)); gap: .55rem; }
    .pp-pbs-pdf-group { border: 1px solid var(--border-subtle, #cbd5e1); border-radius: .65rem; background: var(--surface-card, #ffffff); padding: .5rem .6rem; display: flex; flex-direction: column; gap: .35rem; }
    .pp-pbs-pdf-group-head { display: flex; align-items: center; justify-content: space-between; gap: .35rem; padding-bottom: .3rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #475569); }
    .pp-pbs-pdf-group-toggle { font-size: 10px; font-weight: 700; color: #4338ca; background: transparent; border: 0; padding: .1rem .25rem; border-radius: .3rem; cursor: pointer; }
    .pp-pbs-pdf-group-toggle:hover { background: #eef2ff; }
    .pp-pbs-pdf-fields { display: flex; flex-direction: column; gap: .22rem; }
    .pp-pbs-pdf-field { display: flex; align-items: center; gap: .4rem; font-size: 11.5px; font-weight: 600; color: var(--text-primary, #1e293b); cursor: pointer; padding: .12rem .2rem; border-radius: .35rem; user-select: none; }
    .pp-pbs-pdf-field:hover { background: var(--surface-subtle, #f1f5f9); }
    .pp-pbs-pdf-field input[type="checkbox"], .pp-pbs-pdf-opt input[type="checkbox"] { width: 14px; height: 14px; accent-color: #4f46e5; cursor: pointer; flex-shrink: 0; }
    .pp-pbs-pdf-dot { width: 6px; height: 6px; border-radius: 9999px; background: #10b981; margin-left: auto; flex-shrink: 0; }
    .pp-pbs-pdf-opt { display: inline-flex; align-items: center; gap: .38rem; font-size: 11px; font-weight: 700; color: var(--text-primary, #334155); cursor: pointer; }
    .pp-pbs-pdf-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding-top: .25rem; border-top: 1px solid var(--border-subtle, #e2e8f0); }
    .pp-pbs-textarea { width: 100%; min-height: 110px; font-family: ui-monospace, monospace; font-size: 11.5px; padding: .5rem .6rem; border-radius: .5rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); box-sizing: border-box; resize: vertical; }
    .pp-pbs-field { display: flex; flex-direction: column; gap: .2rem; font-size: 11px; font-weight: 700; }
    .pp-pbs-section { grid-column: 1 / -1; border: 1px solid var(--border-subtle, #cbd5e1); border-radius: .65rem; background: var(--surface-card, #ffffff); overflow: hidden; }
    .pp-pbs-section > summary { display: flex; align-items: center; justify-content: space-between; padding: .46rem .7rem; font-size: 11.5px; font-weight: 800; color: var(--text-primary, #1e293b); cursor: pointer; user-select: none; list-style: none; }
    .pp-pbs-section > summary::-webkit-details-marker { display: none; }
    .pp-pbs-section > summary::before { content: '\u25b8'; display: inline-block; margin-right: .4rem; font-size: 10px; color: var(--text-muted, #64748b); transition: transform .15s; }
    .pp-pbs-section[open] > summary::before { transform: rotate(90deg); }
    .pp-pbs-section > summary .pp-pbs-sec-title { display: inline-flex; align-items: center; gap: .35rem; flex: 1; }
    .pp-pbs-sec-grid { padding: .6rem .7rem .7rem; border-top: 1px solid var(--border-subtle, #e2e8f0); display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); align-items: end; gap: .55rem; }
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
    .pp-pbs-syncbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .55rem 1rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11.5px; color: var(--text-primary, #334155); }
    .pp-pbs-syncbar-dot { display: inline-block; width: 8px; height: 8px; border-radius: 9999px; flex-shrink: 0; }
    html.dark .pp-pbs-syncbar, body.dark .pp-pbs-syncbar { background: #1e293b; border-bottom-color: #334155; color: #e2e8f0; }
    html.dark #ppPbsDialog, body.dark #ppPbsDialog { background: #0f172a; color: #e2e8f0; border-color: #334155; }
    html.dark .pp-pbs-head, body.dark .pp-pbs-head, html.dark .pp-pbs-summary, body.dark .pp-pbs-summary, html.dark .pp-pbs-colbar, body.dark .pp-pbs-colbar, html.dark .pp-pbs-form, body.dark .pp-pbs-form, html.dark .pp-pbs-paste, body.dark .pp-pbs-paste, html.dark .pp-pbs-pdf-panel, body.dark .pp-pbs-pdf-panel { background: #1e293b; border-bottom-color: #334155; }
    html.dark .pp-pbs-form, body.dark .pp-pbs-form, html.dark .pp-pbs-paste, body.dark .pp-pbs-paste, html.dark .pp-pbs-pdf-panel, body.dark .pp-pbs-pdf-panel { border-color: #334155; }
    html.dark .pp-pbs-pdf-group, body.dark .pp-pbs-pdf-group { background: #0f172a; border-color: #334155; }
    html.dark .pp-pbs-pdf-group-head, body.dark .pp-pbs-pdf-group-head { border-bottom-color: #334155; color: #94a3b8; }
    html.dark .pp-pbs-pdf-group-toggle, body.dark .pp-pbs-pdf-group-toggle { color: #a5b4fc; }
    html.dark .pp-pbs-pdf-group-toggle:hover, body.dark .pp-pbs-pdf-group-toggle:hover { background: rgba(99, 102, 241, .2); }
    html.dark .pp-pbs-pdf-field, body.dark .pp-pbs-pdf-field, html.dark .pp-pbs-pdf-opt, body.dark .pp-pbs-pdf-opt { color: #e2e8f0; }
    html.dark .pp-pbs-pdf-field:hover, body.dark .pp-pbs-pdf-field:hover { background: #1e293b; }
    html.dark .pp-pbs-pdf-foot, body.dark .pp-pbs-pdf-foot { border-top-color: #334155; }
    html.dark .pp-pbs-textarea, body.dark .pp-pbs-textarea { background: #0f172a; color: #e2e8f0; border-color: #475569; }
    html.dark .pp-pbs-link, body.dark .pp-pbs-link { color: #93c5fd; }
    html.dark .pp-pbs-cell-warn, body.dark .pp-pbs-cell-warn { color: #fbbf24 !important; }
    html.dark .pp-pbs-cell-err, body.dark .pp-pbs-cell-err { color: #fda4af !important; }
    html.dark .pp-pbs-section, body.dark .pp-pbs-section { background: #0f172a; border-color: #334155; }
    html.dark .pp-pbs-section > summary, body.dark .pp-pbs-section > summary { color: #e2e8f0; }
    html.dark .pp-pbs-sec-grid, body.dark .pp-pbs-sec-grid { border-top-color: #334155; }
    html.dark .pp-pbs-chip, body.dark .pp-pbs-chip { background: #0f172a; border-color: #475569; color: #cbd5e1; }
    html.dark .pp-pbs-chip:hover, body.dark .pp-pbs-chip:hover { background: #334155; color: #f8fafc; }
    html.dark .pp-pbs-chip.is-active, body.dark .pp-pbs-chip.is-active { background: rgba(79, 70, 229, .28); border-color: #818cf8; color: #c7d2fe; }
    html.dark .pp-pbs-chip-cnt, body.dark .pp-pbs-chip-cnt { background: rgba(165, 180, 252, .16); color: #c7d2fe; }
    html.dark .pp-pbs-th-opt, body.dark .pp-pbs-th-opt { color: #a5b4fc !important; }
    html.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-code, body.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-code,
    html.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-code, body.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-code,
    html.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-name, body.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-name,
    html.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-name, body.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-name { background: #0f172a; }
    html.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-name, body.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-name,
    html.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-name, body.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-name,
    html.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-foot-name, body.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-foot-name { box-shadow: 4px 0 8px -4px rgba(0, 0, 0, .5); }
    html.dark .pp-pbs-table tfoot tr.pp-pbs-total-row td, body.dark .pp-pbs-table tfoot tr.pp-pbs-total-row td,
    html.dark .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-code, body.dark .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-code,
    html.dark .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-name, body.dark .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-name { background: #1e293b; border-top-color: #475569; }
    html.dark .pp-pbs-acr, body.dark .pp-pbs-acr { background: #1e293b; color: #cbd5e1; border-color: #475569; }
    html.dark .pp-pbs-pill-swp, body.dark .pp-pbs-pill-swp { background: rgba(79, 70, 229, .25); color: #c7d2fe; border-color: #4f46e5; }
    html.dark .pp-pbs-yn-No, body.dark .pp-pbs-yn-No { background: #334155; color: #cbd5e1; }
    html.dark .pp-pbs-her-Existing, body.dark .pp-pbs-her-Existing { background: #334155; color: #cbd5e1; }
    html.dark .pp-pbs-status-idle, body.dark .pp-pbs-status-idle { background: #334155; color: #e2e8f0; }
    html.dark .pp-pbs-toolbar, body.dark .pp-pbs-toolbar, html.dark .pp-pbs-filters, body.dark .pp-pbs-filters { background: #0f172a; border-color: #334155; }
    html.dark .pp-pbs-btn:not(.pp-pbs-btn-primary):not(.pp-pbs-btn-emerald):not(.pp-pbs-btn-danger), body.dark .pp-pbs-btn:not(.pp-pbs-btn-primary):not(.pp-pbs-btn-emerald):not(.pp-pbs-btn-danger) { background: #1e293b; color: #e2e8f0; border-color: #475569; }
    html.dark .pp-pbs-btn-danger, body.dark .pp-pbs-btn-danger { background: rgba(190,18,60,.25); color: #fda4af; border-color: #9f1239; }
    html.dark .pp-pbs-input, body.dark .pp-pbs-input, html.dark .pp-pbs-select, body.dark .pp-pbs-select { background: #0f172a; color: #e2e8f0; border-color: #475569; }
    html.dark .pp-pbs-conflict, body.dark .pp-pbs-conflict { background: rgba(180,83,9,.22); color: #fde68a; border-color: #d97706; }
    html.dark .pp-pbs-notice, body.dark .pp-pbs-notice { background: rgba(30,64,175,.25); color: #bfdbfe; border-color: #3b82f6; }
    @media (min-width: 900px) {
      .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-actions, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-actions, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-foot-actions { position: sticky; right: 0; z-index: 2; background: var(--surface-card, #ffffff); box-shadow: -4px 0 8px -4px rgba(15, 23, 42, .14); }
      .pp-pbs-table.pp-pbs-sticky thead th.pp-pbs-th-actions { z-index: 4; }
      .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-actions { z-index: 3; background: var(--surface-subtle, #f1f5f9); }
      html.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-actions, body.dark .pp-pbs-table.pp-pbs-sticky th.pp-pbs-th-actions,
      html.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-actions, body.dark .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-actions { background: #0f172a; box-shadow: -4px 0 8px -4px rgba(0, 0, 0, .5); }
      html.dark .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-actions, body.dark .pp-pbs-table.pp-pbs-sticky tfoot td.pp-pbs-foot-actions { background: #1e293b; box-shadow: -4px 0 8px -4px rgba(0, 0, 0, .5); }
    }
    @media (max-width: 767px) {
      #ppPbsDialog, #ppPbsDialog.pp-pbs-expanded { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; border-radius: 0; border: 0; }
      .pp-pbs-wrap, #ppPbsDialog.pp-pbs-expanded .pp-pbs-wrap { height: 100dvh; max-height: 100dvh; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
      .pp-pbs-expand-win-btn { display: none; }
      .pp-pbs-head { padding: .65rem .8rem; gap: .4rem; }
      .pp-pbs-tip, .pp-pbs-colhint { display: none; }
      .pp-pbs-toolbar { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding: .45rem .8rem; gap: .35rem; }
      .pp-pbs-toolbar::-webkit-scrollbar { display: none; }
      .pp-pbs-toolbar > * { flex: 0 0 auto; }
      .pp-pbs-summary { padding: .45rem .8rem; gap: .35rem; }
      .pp-pbs-colbar { padding: .4rem .8rem; flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
      .pp-pbs-colbar::-webkit-scrollbar { display: none; }
      .pp-pbs-colchips { flex-wrap: nowrap; }
      .pp-pbs-colchips > * { flex: 0 0 auto; }
      .pp-pbs-filters { display: grid; grid-template-columns: 1fr 1fr; padding: .5rem .8rem; gap: .4rem; }
      .pp-pbs-filters #ppPbsFilterSearch { grid-column: 1 / -1; min-width: 0 !important; width: 100%; }
      .pp-pbs-filters #ppPbsClearFiltersBtn { grid-column: 1 / -1; }
      .pp-pbs-body { padding: .65rem .8rem 1rem; }
      .pp-pbs-btn { min-height: 38px; padding: .4rem .7rem; font-size: 12.5px; }
      .pp-pbs-btn-xs { min-height: 36px; padding: .3rem .55rem; font-size: 12px; }
      .pp-pbs-chip { min-height: 32px; padding: .28rem .6rem; font-size: 12px; }
      .pp-pbs-input, .pp-pbs-select { min-height: 38px; font-size: 16px; width: 100%; box-sizing: border-box; }
      .pp-pbs-toolbar .pp-pbs-select { width: auto; max-width: 210px; font-size: 13px; }
      .pp-pbs-toggle { width: 2rem; height: 2rem; flex: 0 0 2rem; font-size: 12px; }
      .pp-pbs-toggle-spacer { display: none; }
      .pp-pbs-form, .pp-pbs-sec-grid, .pp-pbs-pdf-groups { grid-template-columns: 1fr; }
      .pp-pbs-pdf-field { min-height: 30px; font-size: 12.5px; }
      .pp-pbs-form { padding: .75rem; }
      .pp-pbs-form .pp-pbs-field { grid-column: auto !important; }
      .pp-pbs-table, .pp-pbs-table tbody, .pp-pbs-table tfoot { display: block; width: 100%; }
      .pp-pbs-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-code, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-cell-name,
      .pp-pbs-table.pp-pbs-sticky td.pp-pbs-foot-code, .pp-pbs-table.pp-pbs-sticky td.pp-pbs-foot-name { position: static; left: auto; width: auto; min-width: 0; max-width: none; box-shadow: none; background: transparent; overflow: visible; }
      .pp-pbs-table td.pp-pbs-desc-cell { min-width: 0; max-width: none; }
      .pp-pbs-table tr.pp-pbs-row { display: block; margin: 0 0 .65rem calc(min(var(--pbs-depth, 0), 4) * 10px); padding: .55rem .7rem; border: 1px solid var(--border-subtle, #e2e8f0); border-left: 5px solid var(--pbs-dept-color, #94a3b8); border-radius: .75rem; background: var(--surface-card, #ffffff); background: color-mix(in srgb, var(--pbs-dept-color, transparent) 7%, var(--surface-card, #ffffff)); }
      .pp-pbs-table tfoot tr.pp-pbs-total-row { display: block; margin: .25rem 0 0; padding: .55rem .7rem; border: 1px solid var(--border-subtle, #cbd5e1); border-radius: .75rem; background: var(--surface-subtle, #f1f5f9); }
      .pp-pbs-table tr:not(.pp-pbs-row):not(.pp-pbs-total-row), .pp-pbs-table td[colspan] { display: block; width: 100%; border: 0; }
      .pp-pbs-table tr.pp-pbs-row td, .pp-pbs-table tfoot tr.pp-pbs-total-row td { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; padding: .22rem 0 !important; border-bottom: 0; white-space: normal !important; text-align: left !important; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-opt-empty, .pp-pbs-table tfoot tr.pp-pbs-total-row td.pp-pbs-opt-empty { display: none !important; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-code { display: inline-flex; font-size: 11px; color: var(--text-muted, #64748b); margin-right: .45rem; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-mat { display: inline-flex; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-name { display: block; padding: .2rem 0 .35rem !important; font-size: 13.5px; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-dept::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-owner::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-ms::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-kv::before,
      .pp-pbs-table tfoot tr.pp-pbs-total-row td.pp-pbs-cell-kv::before { content: attr(data-label); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #64748b); flex-shrink: 0; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-actions { display: block; margin-top: .4rem; padding-top: .45rem !important; border-top: 1px solid var(--border-subtle, #e2e8f0); }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-actions [role="group"] { display: flex; flex-wrap: wrap; gap: .3rem; }
      html.dark .pp-pbs-table tr.pp-pbs-row, body.dark .pp-pbs-table tr.pp-pbs-row { background: #1e293b; background: color-mix(in srgb, var(--pbs-dept-color, transparent) 14%, #1e293b); border-top-color: #334155; border-right-color: #334155; border-bottom-color: #334155; border-left-color: var(--pbs-dept-color, #64748b); }
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
  const herPill = (h) => (h ? `<span class="pp-pbs-her pp-pbs-her-${esc(h)}">${esc(h)}</span>` : '');
  const ynPill = (v) => (v ? `<span class="pp-pbs-yn pp-pbs-yn-${esc(v)}">${esc(v)}</span>` : '\u2014');

  function renderTextOrLink(val) {
    const raw = String(val || '').trim();
    if (!raw) return '\u2014';
    if (/^https?:\/\/[^\s<>"']+$/i.test(raw)) {
      let label = raw.replace(/^https?:\/\/(www\.)?/i, '');
      try {
        const u = new URL(raw);
        const host = u.hostname.replace(/^www\./i, '');
        const tail = u.pathname && u.pathname !== '/' ? u.pathname : '';
        label = host + (tail.length > 26 ? `${tail.slice(0, 25)}\u2026` : tail);
      } catch (_e) {
        if (label.length > 36) label = `${label.slice(0, 35)}\u2026`;
      }
      return `<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer" class="pp-pbs-link" title="${esc(raw)}">${esc(label)} &#8599;</a>`;
    }
    return esc(raw);
  }

  const OPTIONAL_COL_GROUPS = {
    docs: [
      { key: 'description', label: 'Description', cls: 'pp-pbs-desc-cell', has: it => Boolean(it.description) },
      { key: 'mechDrawing', label: 'Mech. Dwg', cls: 'pp-pbs-mono', has: it => Boolean(it.mechDrawing) },
      { key: 'elecDrawing', label: 'Elec. Dwg', cls: 'pp-pbs-mono', has: it => Boolean(it.elecDrawing) },
      { key: 'refDoc', label: 'Ref. Doc', cls: '', has: it => Boolean(it.refDoc) },
    ],
    proc: [
      { key: 'manufacturer', label: 'Manufacturer', cls: '', has: it => Boolean(it.manufacturer) },
      { key: 'partNumber', label: 'Part No.', cls: 'pp-pbs-mono', has: it => Boolean(it.partNumber) },
      { key: 'procurementStatus', label: 'Proc. Status', cls: '', has: it => Boolean(it.procurementStatus) },
      { key: 'leadTime', label: 'Lead (wks)', cls: 'pp-pbs-num', right: true, has: it => isNum(it.leadTime) },
      { key: 'componentAlt', label: 'Alternative', cls: '', has: it => Boolean(it.componentAlt) },
    ],
    swp: [
      { key: 'heritage', label: 'Status', cls: 'pp-pbs-center', center: true, has: it => Boolean(it.heritage) },
      { key: 'qty', label: 'Qty', cls: 'pp-pbs-num', right: true, has: it => isNum(it.qty) && it.qty > 1 },
      { key: 'mass', label: 'Mass (kg)', cls: 'pp-pbs-num', right: true, has: it => isNum(it.mass) },
      { key: 'powerConsumption', label: 'Pwr Cons (W)', cls: 'pp-pbs-num', right: true, has: it => isNum(it.powerConsumption) },
      { key: 'powerDissipation', label: 'Pwr Diss (W)', cls: 'pp-pbs-num', right: true, has: it => isNum(it.powerDissipation) },
      { key: 'mtbf', label: 'MTBF (h)', cls: 'pp-pbs-num', right: true, has: it => isNum(it.mtbf) },
      { key: 'lru', label: 'LRU', cls: 'pp-pbs-center', center: true, has: it => Boolean(it.lru) },
      { key: 'spareAvailable', label: 'Spare Avail.', cls: 'pp-pbs-center', center: true, has: it => Boolean(it.spareAvailable) },
      { key: 'spareToDeliver', label: 'Spare Deliv.', cls: 'pp-pbs-center', center: true, has: it => Boolean(it.spareToDeliver) },
    ],
  };

  function getPopulatedGroupFlags(doc) {
    const items = (doc && Array.isArray(doc.items)) ? doc.items : [];
    const check = (g) => OPTIONAL_COL_GROUPS[g].some(col => items.some(it => col.has(it)));
    return { docs: check('docs'), proc: check('proc'), swp: check('swp') };
  }

  /* Returns active optional column descriptors: populated columns within each enabled group (or full group if toggled while empty). */
  function resolveVisibleOptionalCols(doc, colGroups) {
    const g = colGroups || { docs: false, proc: false, swp: false };
    const items = (doc && Array.isArray(doc.items)) ? doc.items : [];
    const out = [];
    ['docs', 'proc', 'swp'].forEach(groupKey => {
      if (!g[groupKey]) return;
      const defs = OPTIONAL_COL_GROUPS[groupKey];
      const populated = defs.filter(col => items.some(it => col.has(it)));
      out.push(...(populated.length ? populated : defs));
    });
    return out;
  }

  function formatMetricCell(own, desc, descUnit, overlap, overBudget, effQ, unit) {
    const q = effQ && effQ > 1 ? effQ : 1;
    if (overlap) {
      const tip = `Parent budget (${fmtNum(own)} ${unit}) and sub-items (\u03a3 ${fmtNum(descUnit)} ${unit}) are both set. Project totals use sub-items (\u03a3 ${fmtNum(desc)} ${unit}) to prevent double-counting.`;
      const cls = overBudget ? 'pp-pbs-cell-err' : 'pp-pbs-cell-warn';
      const note = overBudget ? `\u26a0 over ${fmtNum(own)}` : `\u26a0 vs ${fmtNum(own)}`;
      return {
        html: `<span class="pp-pbs-rollup" title="${esc(tip)}">&Sigma; ${esc(fmtNum(desc))}</span><span class="pp-pbs-cell-sub ${cls}" title="${esc(tip)}">${esc(note)}</span>`,
        empty: false,
      };
    }
    if (isNum(own)) {
      if (q > 1) {
        const lineTot = Math.round(own * q * 10000) / 10000;
        return {
          html: `<span title="${q} &times; ${esc(fmtNum(own))} ${unit} = ${esc(fmtNum(lineTot))} ${unit}">${esc(fmtNum(lineTot))}</span><span class="pp-pbs-cell-sub">${q}&times;${esc(fmtNum(own))}</span>`,
          empty: false,
        };
      }
      return { html: `<span>${esc(fmtNum(own))}</span>`, empty: false };
    }
    if (isNum(desc)) {
      if (q > 1) {
        return {
          html: `<span class="pp-pbs-rollup" title="Auto-rolled up from sub-items (${q} &times; ${esc(fmtNum(descUnit))} ${unit})">&Sigma; ${esc(fmtNum(desc))}</span><span class="pp-pbs-cell-sub">${q}&times;${esc(fmtNum(descUnit))}</span>`,
          empty: false,
        };
      }
      return { html: `<span class="pp-pbs-rollup" title="Auto-rolled up from sub-items">&Sigma; ${esc(fmtNum(desc))}</span>`, empty: false };
    }
    return { html: '\u2014', empty: true };
  }

  function renderOptionalCell(col, item, sub, summary, rollups) {
    let html = '\u2014';
    let empty = true;
    const effQ = sub ? sub.effQty : ((isNum(item.qty) && item.qty > 1) ? item.qty : 1);
    switch (col.key) {
      case 'description': if (item.description) { html = esc(item.description); empty = false; } break;
      case 'mechDrawing': if (item.mechDrawing) { html = renderTextOrLink(item.mechDrawing); empty = false; } break;
      case 'elecDrawing': if (item.elecDrawing) { html = renderTextOrLink(item.elecDrawing); empty = false; } break;
      case 'refDoc': if (item.refDoc) { html = renderTextOrLink(item.refDoc); empty = false; } break;
      case 'manufacturer': if (item.manufacturer) { html = esc(item.manufacturer); empty = false; } break;
      case 'partNumber': if (item.partNumber) { html = esc(item.partNumber); empty = false; } break;
      case 'procurementStatus': if (item.procurementStatus) { html = `<span class="pp-pbs-pill pp-pbs-status-idle">${esc(item.procurementStatus)}</span>`; empty = false; } break;
      case 'leadTime':
        if (isNum(item.leadTime)) {
          const risk = summary && summary.leadRiskMap ? summary.leadRiskMap.get(item.id) : null;
          html = `${esc(fmtNum(item.leadTime))} wks${risk ? `<span class="pp-pbs-cell-sub pp-pbs-cell-err" title="Projected ETA ${esc(risk.etaIso)} is ${risk.slipWeeks}w past milestone (${esc(risk.milestoneDate)})">\u26a0 +${risk.slipWeeks}w slip</span>` : ''}`;
          empty = false;
        }
        break;
      case 'componentAlt': if (item.componentAlt) { html = esc(item.componentAlt); empty = false; } break;
      case 'heritage': if (item.heritage) { html = herPill(item.heritage); empty = false; } break;
      case 'qty':
        if (isNum(item.qty) && item.qty > 1) { html = `<strong>&times;${item.qty}</strong>`; empty = false; }
        else if (isNum(item.qty)) { html = '1'; empty = false; }
        break;
      case 'mass':
        ({ html, empty } = formatMetricCell(item.mass, sub && sub.descMass, sub && sub.descMassUnit, Boolean(sub && sub.massOverlap), Boolean(sub && sub.massOverBudget), effQ, 'kg'));
        break;
      case 'powerConsumption':
        ({ html, empty } = formatMetricCell(item.powerConsumption, sub && sub.descPowerCons, sub && sub.descPowerConsUnit, Boolean(sub && sub.powerConsOverlap), Boolean(sub && sub.powerConsOverBudget), effQ, 'W'));
        break;
      case 'powerDissipation':
        ({ html, empty } = formatMetricCell(item.powerDissipation, sub && sub.descPowerDiss, sub && sub.descPowerDissUnit, Boolean(sub && sub.powerDissOverlap), Boolean(sub && sub.powerDissOverBudget), effQ, 'W'));
        break;
      case 'mtbf': if (isNum(item.mtbf)) { html = esc(fmtNum(item.mtbf)); empty = false; } break;
      case 'lru': if (item.lru) { html = ynPill(item.lru); empty = false; } break;
      case 'spareAvailable': if (item.spareAvailable) { html = ynPill(item.spareAvailable); empty = false; } break;
      case 'spareToDeliver':
        if (item.spareToDeliver) {
          const gap = Boolean(rollups && rollups.spareGapIds && rollups.spareGapIds.has(item.id));
          html = gap
            ? '<span class="pp-pbs-yn pp-pbs-yn-Warn" title="SPARE to be delivered is Yes, but SPARE available is No">Yes \u26a0</span>'
            : ynPill(item.spareToDeliver);
          empty = false;
        }
        break;
      default: break;
    }
    const cls = `pp-pbs-cell-kv${col.cls ? ` ${col.cls}` : ''}${empty ? ' pp-pbs-opt-empty' : ''}`;
    return `<td class="${cls}" data-label="${esc(col.label)}">${html}</td>`;
  }

  /* ctx.rows: [{ item, depth, hasChildren, isContextOnly }]; ctx.summary; ctx.rollups; ctx.colGroups */
  function renderRows(ctx, optColsArg) {
    const optCols = optColsArg || resolveVisibleOptionalCols(ctx.doc, ctx.colGroups);
    const colSpan = 7 + optCols.length;
    const deptMap = new Map((ctx.db.departments || []).map(d => [d.id, d]));
    const msMap = new Map((ctx.db.milestones || []).map(m => [m.id, m]));
    const rollupsById = (ctx.rollups && ctx.rollups.byId) ? ctx.rollups.byId : new Map();
    const hasHeritageCol = optCols.some(c => c.key === 'heritage');
    const hasQtyCol = optCols.some(c => c.key === 'qty');
    const hasLeadCol = optCols.some(c => c.key === 'leadTime');

    if (!ctx.rows.length) {
      const msg = ctx.doc.items.length ? 'No PBS items match the active filters.' : 'No PBS deliverables yet. Use <strong>+ Add Root Item</strong>, <strong>Paste Table</strong>, import a CSV, or clone another project.';
      return `<tr><td colspan="${colSpan}" style="text-align:center;padding:1.5rem;color:var(--text-muted,#64748b)">${msg}</td></tr>`;
    }

    return ctx.rows.map(({ item, depth, hasChildren, isContextOnly }) => {
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      const collapsed = ctx.collapsedIds.has(item.id);
      const bottleneck = ctx.summary.bottleneckMap.get(item.id);
      const overdue = ctx.summary.overdueIds.has(item.id);
      const leadRisk = ctx.summary.leadRiskMap ? ctx.summary.leadRiskMap.get(item.id) : null;
      const nm = esc(item.name);
      const id = esc(item.id);
      const deptColor = dept && dept.color ? esc(dept.color) : '';
      const sub = rollupsById.get(item.id) || null;

      const toggle = hasChildren
        ? `<button type="button" class="pp-pbs-toggle" data-pbs-toggle="${id}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${nm}">${collapsed ? '\u25b6' : '\u25bc'}</button>`
        : '<span class="pp-pbs-toggle-spacer" aria-hidden="true"></span>';

      const acrBadge = item.acronym ? `<span class="pp-pbs-acr">${esc(item.acronym)}</span>` : '';
      const inlineQty = (!hasQtyCol && isNum(item.qty) && item.qty > 1) ? `<span class="pp-pbs-acr" title="Quantity">&times;${item.qty}</span>` : '';
      const inlineHer = (!hasHeritageCol && item.heritage) ? herPill(item.heritage) : '';
      const subNotes = item.notes ? `<div class="pp-pbs-subtext">${esc(item.notes)}</div>` : '';
      const nameCell = `<td class="pp-pbs-cell-name" data-label="Deliverable" style="padding-left:${6 + depth * 16}px"><div class="pp-pbs-name-flex">${toggle}<div class="pp-pbs-name-main"><div class="pp-pbs-name-line"><span style="font-weight:${depth === 0 ? 800 : 600}">${nm}</span>${acrBadge}${inlineQty}${inlineHer}${bottleneck ? ` <span class="pp-pbs-pill pp-pbs-status-warn" title="A child deliverable is still at ${esc(bottleneck)}">\u26a0 Child at ${esc(bottleneck)}</span>` : ''}</div>${subNotes}</div></div></td>`;

      const inlineLeadWarn = (leadRisk && !hasLeadCol)
        ? ` <span class="pp-pbs-cell-err" style="font-size:10px" title="Lead time (${esc(fmtNum(item.leadTime))} wks) projects ETA ${esc(leadRisk.etaIso)}, ${leadRisk.slipWeeks}w past milestone">\u00b7 \u26a0 +${leadRisk.slipWeeks}w lead</span>`
        : '';
      const msCell = ms
        ? `${esc(ms.title)}${ms.date ? ` <span style="font-size:10px;color:${overdue ? '#be123c' : '#64748b'};font-weight:${overdue ? 800 : 400}">(${esc(ms.date)}${overdue ? ' \u00b7 Overdue' : ''})</span>` : ''}${inlineLeadWarn}`
        : '\u2014';
      const deptCell = dept
        ? `<span>${deptColor ? `<span class="pp-pbs-dept-dot" style="background:${deptColor}" aria-hidden="true"></span>` : ''}${esc(`[${dept.code}] ${dept.name}`)}</span>`
        : '\u2014';

      const optCells = optCols.map(col => renderOptionalCell(col, item, sub, ctx.summary, ctx.rollups)).join('');

      const btn = (act, label, text) => `<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-move="${act}" data-pbs-id="${id}" aria-label="${label} ${nm}">${text}</button>`;
      const actionsCell = `<td class="pp-pbs-cell-actions" data-label="Actions" style="text-align:right;white-space:nowrap"><span role="group" aria-label="Actions for ${nm}">${btn('up', 'Move up', '\u2191')} ${btn('down', 'Move down', '\u2193')} ${btn('outdent', 'Outdent', '\u2190')} ${btn('indent', 'Indent', '\u2192')}
        <button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-add-child="${id}" aria-label="Add child to ${nm}">+Child</button>
        <button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-edit="${id}" aria-label="Edit ${nm}">Edit</button>
        <button type="button" class="pp-pbs-btn pp-pbs-btn-xs pp-pbs-btn-danger" data-pbs-del="${id}" aria-label="Delete ${nm}">\u00d7</button></span></td>`;

      return `<tr class="pp-pbs-row${isContextOnly ? ' pp-pbs-row-ctx' : ''}" tabindex="0" data-pbs-row="${id}" style="--pbs-depth:${depth};${deptColor ? `--pbs-dept-color:${deptColor};` : ''}border-left:4px solid ${deptColor || 'transparent'}">
        <td class="pp-pbs-cell-code" data-label="Code" style="font-family:ui-monospace,monospace;font-weight:700;white-space:nowrap">${esc(item.code)}</td>
        ${nameCell}
        <td class="pp-pbs-cell-mat" data-label="Maturity">${matPill(item.maturity)}</td>
        <td class="pp-pbs-cell-dept" data-label="Department" style="color:${deptColor || 'inherit'};font-weight:600;white-space:nowrap">${deptCell}</td>
        <td class="pp-pbs-cell-owner" data-label="Owner" style="white-space:nowrap">${esc(item.owner || '\u2014')}</td>
        <td class="pp-pbs-cell-ms" data-label="Milestone" style="white-space:nowrap">${msCell}</td>
        ${optCells}
        ${actionsCell}
      </tr>`;
    }).join('');
  }

  function renderTotalFoot(ctx, optCols) {
    const r = (ctx.isFiltered && ctx.filteredRollups) ? ctx.filteredRollups : ctx.rollups;
    if (!r || !ctx.rows.length || !optCols.length) return '';
    const hasSummaryCol = optCols.some(c =>
      (c.key === 'mass' && r.totalMass !== null)
      || (c.key === 'powerConsumption' && r.totalPowerConsumption !== null)
      || (c.key === 'powerDissipation' && r.totalPowerDissipation !== null)
      || (c.key === 'lru' && r.lruCount > 0)
      || (c.key === 'spareAvailable' && r.spareAvailCount > 0)
      || (c.key === 'spareToDeliver' && r.spareDelivCount > 0)
    );
    if (!hasSummaryCol) return '';

    const optTds = optCols.map(col => {
      if (col.key === 'mass' && r.totalMass !== null) return `<td class="pp-pbs-cell-kv pp-pbs-num" data-label="Total Mass (kg)">${esc(fmtNum(r.totalMass))}</td>`;
      if (col.key === 'powerConsumption' && r.totalPowerConsumption !== null) return `<td class="pp-pbs-cell-kv pp-pbs-num" data-label="Total Power Cons. (W)">${esc(fmtNum(r.totalPowerConsumption))}</td>`;
      if (col.key === 'powerDissipation' && r.totalPowerDissipation !== null) return `<td class="pp-pbs-cell-kv pp-pbs-num" data-label="Total Power Diss. (W)">${esc(fmtNum(r.totalPowerDissipation))}</td>`;
      if (col.key === 'lru' && r.lruCount > 0) return `<td class="pp-pbs-cell-kv pp-pbs-center" data-label="Total LRU">${r.lruCount} Yes</td>`;
      if (col.key === 'spareAvailable' && r.spareAvailCount > 0) return `<td class="pp-pbs-cell-kv pp-pbs-center" data-label="Spares Avail.">${r.spareAvailCount} Yes</td>`;
      if (col.key === 'spareToDeliver' && r.spareDelivCount > 0) return `<td class="pp-pbs-cell-kv pp-pbs-center" data-label="Spares Deliv.">${r.spareDelivCount} Yes</td>`;
      return '<td class="pp-pbs-opt-empty"></td>';
    }).join('');

    const footCode = ctx.isFiltered ? 'SUM' : 'TOTAL';
    const footName = ctx.isFiltered
      ? `FILTERED &middot; ${ctx.matchedCount != null ? ctx.matchedCount : ctx.rows.length} / ${ctx.doc.items.length} items`
      : `${ctx.doc.items.length} item${ctx.doc.items.length === 1 ? '' : 's'}`;

    return `<tfoot><tr class="pp-pbs-total-row">
      <td class="pp-pbs-foot-code" style="font-family:ui-monospace,monospace">${footCode}</td>
      <td class="pp-pbs-foot-name">${footName}</td>
      <td class="pp-pbs-opt-empty"></td><td class="pp-pbs-opt-empty"></td><td class="pp-pbs-opt-empty"></td><td class="pp-pbs-opt-empty"></td>
      ${optTds}
      <td class="pp-pbs-foot-actions pp-pbs-opt-empty"></td>
    </tr></tfoot>`;
  }

  function renderEditForm(ctx) {
    const e = ctx.edit;
    if (!e || !e.open) return '';
    const item = e.item || null;
    const counts = item ? countSpecs(item) : { identity: 0, docs: 0, proc: 0, eng: 0, total: 0 };
    const openSec = e.openSections || { docs: counts.docs > 0, proc: counts.proc > 0, eng: counts.eng > 0 };
    const field = (label, inner, extra) => `<label class="pp-pbs-field"${extra ? ` style="${extra}"` : ''}><span>${label}</span>${inner}</label>`;
    const deptOpts = (ctx.db.departments || []).map(d => `<option value="${esc(d.id)}"${item && item.deptId === d.id ? ' selected' : ''}>[${esc(d.code)}] ${esc(d.name)}</option>`).join('');
    const msOpts = (ctx.projectMilestones || []).map(m => `<option value="${esc(m.id)}"${item && item.milestoneId === m.id ? ' selected' : ''}>${esc(m.title)}${m.date ? ` (${esc(m.date)})` : ''}</option>`).join('');
    const parentOpts = (e.parentCandidates || []).map(p => `<option value="${esc(p.id)}"${p.id === (e.parentId || '') ? ' selected' : ''}>${esc(p.code)} \u2014 ${esc(p.name)}</option>`).join('');
    const matOpts = MATURITY.map(m => `<option value="${m}"${(item ? item.maturity : 'Draft') === m ? ' selected' : ''}>${m}</option>`).join('');
    const herOpts = HERITAGE.map(h => `<option value="${h}"${item && item.heritage === h ? ' selected' : ''}>${h}</option>`).join('');
    const ynOpts = (cur) => `<option value="">\u2014 Unset \u2014</option>${YESNO.map(v => `<option value="${v}"${cur === v ? ' selected' : ''}>${v}</option>`).join('')}`;
    const owners = (ctx.owners || []).map(o => `<option value="${esc(o)}"></option>`).join('');
    const mfrs = (ctx.manufacturers || []).map(m => `<option value="${esc(m)}"></option>`).join('');
    const procStatuses = (ctx.procStatuses || P.PROC_STATUS_PRESETS || []).map(s => `<option value="${esc(s)}"></option>`).join('');
    const numVal = (v) => (isNum(v) ? esc(fmtNum(v)) : '');
    const secBadge = (n) => (n > 0 ? `<span class="pp-pbs-pill pp-pbs-pill-swp">${n} set</span>` : '<span style="font-size:10px;font-weight:600;color:var(--text-muted,#64748b)">Optional</span>');

    return `<form id="ppPbsItemForm" class="pp-pbs-form" aria-label="${item ? 'Edit PBS item' : 'Add PBS item'}">
      ${field('Code *', `<input type="text" id="ppPbsFCode" class="pp-pbs-input" value="${esc(item ? item.code : e.suggestedCode)}" required />`)}
      ${field('Acronym', `<input type="text" id="ppPbsFAcronym" class="pp-pbs-input" value="${esc(item ? item.acronym : '')}" placeholder="e.g., PSU, OBC" maxlength="24" />`)}
      ${field('Deliverable / Subsystem Name *', `<input type="text" id="ppPbsFName" class="pp-pbs-input" value="${esc(item ? item.name : '')}" placeholder="e.g., Power Supply Unit" required />`, 'grid-column:span 2')}
      ${field('Existing / Update / New', `<select id="ppPbsFHeritage" class="pp-pbs-select"><option value="">\u2014 Unset \u2014</option>${herOpts}</select>`)}
      ${field('Parent Item', `<select id="ppPbsFParent" class="pp-pbs-select"><option value="">(Root Level)</option>${parentOpts}</select>`)}
      ${field('Maturity Gate', `<select id="ppPbsFMaturity" class="pp-pbs-select">${matOpts}</select>`)}
      ${field('Department', `<select id="ppPbsFDept" class="pp-pbs-select"><option value="">\u2014 Unassigned \u2014</option>${deptOpts}</select>`)}
      ${field('Owner (People Directory)', `<input type="text" id="ppPbsFOwner" list="ppPbsOwnerList" class="pp-pbs-input" value="${esc(item ? item.owner : '')}" placeholder="Type or pick a name..." autocomplete="off" /><datalist id="ppPbsOwnerList">${owners}</datalist>`)}
      ${field('Linked Milestone', `<select id="ppPbsFMilestone" class="pp-pbs-select"><option value="">\u2014 None \u2014</option>${msOpts}</select>`)}
      ${field('Description', `<input type="text" id="ppPbsFDescription" class="pp-pbs-input" value="${esc(item ? item.description : '')}" placeholder="Optional functional or hardware description..." />`, 'grid-column:1 / -1')}
      ${field('Notes / Acceptance Criteria', `<input type="text" id="ppPbsFNotes" class="pp-pbs-input" value="${esc(item ? item.notes : '')}" placeholder="Optional review remarks, caveats, or gate criteria..." />`, 'grid-column:1 / -1')}

      <details class="pp-pbs-section" data-pbs-section="docs"${openSec.docs ? ' open' : ''}>
        <summary><span class="pp-pbs-sec-title">Documentation &amp; Drawings</span>${secBadge(counts.docs)}</summary>
        <div class="pp-pbs-sec-grid">
          ${field('Mechanical Drawing', `<input type="text" id="ppPbsFMechDrawing" class="pp-pbs-input" value="${esc(item ? item.mechDrawing : '')}" placeholder="e.g., DWG-MECH-042 Rev B or https://..." />`)}
          ${field('Electrical Drawing', `<input type="text" id="ppPbsFElecDrawing" class="pp-pbs-input" value="${esc(item ? item.elecDrawing : '')}" placeholder="e.g., DWG-ELEC-118 Rev A or https://..." />`)}
          ${field('Reference Document', `<input type="text" id="ppPbsFRefDoc" class="pp-pbs-input" value="${esc(item ? item.refDoc : '')}" placeholder="e.g., ICD-SYS-003 or https://..." />`)}
        </div>
      </details>

      <details class="pp-pbs-section" data-pbs-section="proc"${openSec.proc ? ' open' : ''}>
        <summary><span class="pp-pbs-sec-title">Procurement &amp; Supply Chain</span>${secBadge(counts.proc)}</summary>
        <div class="pp-pbs-sec-grid">
          ${field('Manufacturer', `<input type="text" id="ppPbsFManufacturer" list="ppPbsMfrList" class="pp-pbs-input" value="${esc(item ? item.manufacturer : '')}" placeholder="e.g., Texas Instruments" autocomplete="off" /><datalist id="ppPbsMfrList">${mfrs}</datalist>`)}
          ${field('Part Number', `<input type="text" id="ppPbsFPartNumber" class="pp-pbs-input" value="${esc(item ? item.partNumber : '')}" placeholder="e.g., LM2596S-5.0" />`)}
          ${field('Procurement / Manufacture Status', `<input type="text" id="ppPbsFProcStatus" list="ppPbsProcStatusList" class="pp-pbs-input" value="${esc(item ? item.procurementStatus : '')}" placeholder="Pick preset or type status..." autocomplete="off" /><datalist id="ppPbsProcStatusList">${procStatuses}</datalist>`)}
          ${field('Lead Time (wks)', `<input type="number" id="ppPbsFLeadTime" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.leadTime)}" placeholder="e.g., 12" />`)}
          ${field('Component Alternative', `<input type="text" id="ppPbsFComponentAlt" class="pp-pbs-input" value="${esc(item ? item.componentAlt : '')}" placeholder="Second source / alternate part number..." />`, 'grid-column:span 2')}
        </div>
      </details>

      <details class="pp-pbs-section" data-pbs-section="eng"${openSec.eng ? ' open' : ''}>
        <summary><span class="pp-pbs-sec-title">Engineering Budgets, Reliability &amp; Spares</span>${secBadge(counts.eng)}</summary>
        <div class="pp-pbs-sec-grid">
          ${field('Quantity (Qty)', `<input type="number" id="ppPbsFQty" class="pp-pbs-input" min="1" step="1" value="${numVal(item && item.qty)}" placeholder="1" title="Multiplies unit Mass &amp; Power in roll-ups when &gt; 1" />`)}
          ${field('Unit Mass (kg)', `<input type="number" id="ppPbsFMass" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.mass)}" placeholder="e.g., 1.25" />`)}
          ${field('Unit Power Cons. (W)', `<input type="number" id="ppPbsFPowerCons" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.powerConsumption)}" placeholder="e.g., 45" />`)}
          ${field('Unit Power Diss. (W)', `<input type="number" id="ppPbsFPowerDiss" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.powerDissipation)}" placeholder="e.g., 12.5" />`)}
          ${field('MTBF (h)', `<input type="number" id="ppPbsFMtbf" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.mtbf)}" placeholder="e.g., 50000" />`)}
          ${field('LRU', `<select id="ppPbsFLru" class="pp-pbs-select">${ynOpts(item ? item.lru : '')}</select>`)}
          ${field('SPARE Available', `<select id="ppPbsFSpareAvail" class="pp-pbs-select">${ynOpts(item ? item.spareAvailable : '')}</select>`)}
          ${field('SPARE to be Delivered', `<select id="ppPbsFSpareDeliv" class="pp-pbs-select">${ynOpts(item ? item.spareToDeliver : '')}</select>`)}
        </div>
      </details>

      <div style="grid-column:1 / -1;display:flex;justify-content:flex-end;gap:.45rem">
        <button type="button" class="pp-pbs-btn" id="ppPbsFormCancel">Cancel</button>
        <button type="submit" class="pp-pbs-btn pp-pbs-btn-primary">${item ? 'Save Changes' : 'Add PBS Item'}</button>
      </div></form>`;
  }

  function renderPastePanel(ctx) {
    if (!ctx.pasteOpen) return '';
    return `<div id="ppPbsPastePanel" class="pp-pbs-paste" role="region" aria-label="Paste PBS rows from Excel or CSV">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap">
        <strong style="font-size:12px">Paste from Excel / Sheets / CSV</strong>
        <span style="font-size:10.5px;color:var(--text-muted,#64748b)">Tab, comma, or semicolon separated &middot; header row auto-detected across all PBS columns</span>
      </div>
      <textarea id="ppPbsPasteInput" class="pp-pbs-textarea" placeholder="Code&#9;Name&#9;Acronym&#9;Manufacturer&#9;Part Number&#9;Mass (kg)&#9;Qty&#10;1&#9;Avionics Bay&#9;AVB&#9;&#9;&#9;&#9;&#10;1.1&#9;Sensor Module&#9;SNS&#9;Bosch&#9;BNO085&#9;0.15&#9;4"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:.45rem">
        <button type="button" class="pp-pbs-btn" id="ppPbsPasteCancel">Cancel</button>
        <button type="button" class="pp-pbs-btn pp-pbs-btn-primary" id="ppPbsPasteSubmit">Import Pasted Rows</button>
      </div></div>`;
  }

  const PDF_GROUPS = [
    { key: 'core', label: 'Core & Identity' },
    { key: 'docs', label: 'Docs & Drawings' },
    { key: 'proc', label: 'Procurement' },
    { key: 'swp', label: 'SWaP & Spares' },
  ];

  function renderPdfPanel(ctx) {
    const cfg = ctx.pdfExport;
    if (!cfg || !cfg.open) return '';
    const allCols = (P.report && Array.isArray(P.report.REPORT_COLS)) ? P.report.REPORT_COLS : [];
    const selSet = cfg.selectedFields instanceof Set ? cfg.selectedFields : new Set(cfg.selectedFields || []);
    const popSet = cfg.populatedFields instanceof Set ? cfg.populatedFields : new Set(cfg.populatedFields || []);
    const selectedCols = allCols.filter(c => selSet.has(c.key));
    const selCount = selectedCols.length;
    const hasOpt = selectedCols.some(c => !c.always);
    const neededW = selectedCols.reduce((sum, c) => sum + (hasOpt ? c.w : (c.baseW || c.w)), 0);
    const pageLabel = neededW > 1142 ? 'Wide Landscape' : (neededW > 770 ? 'A3 Landscape' : 'A4 Landscape');

    const presets = [
      { key: 'populated', label: 'All Populated' },
      { key: 'currentView', label: 'Current View' },
      { key: 'core', label: 'Core Only' },
      { key: 'docs', label: 'Core + Docs' },
      { key: 'proc', label: 'Core + Proc.' },
      { key: 'swp', label: 'Core + SWaP' },
      { key: 'all', label: 'Select All' },
      { key: 'minimal', label: 'Minimal' },
    ];

    const groupsHtml = PDF_GROUPS.map(g => {
      const gCols = allCols.filter(c => (c.group || 'core') === g.key);
      if (!gCols.length) return '';
      const allSelected = gCols.every(c => selSet.has(c.key));
      const fieldsHtml = gCols.map(c => {
        const checked = selSet.has(c.key);
        const hasData = popSet.has(c.key);
        return `<label class="pp-pbs-pdf-field" title="${hasData ? 'Field contains data in this PBS' : 'Currently empty in this PBS'}"><input type="checkbox" data-pbs-pdf-field="${esc(c.key)}"${checked ? ' checked' : ''} /><span>${esc(c.label)}</span>${hasData ? '<span class="pp-pbs-pdf-dot" aria-hidden="true"></span>' : ''}</label>`;
      }).join('');
      return `<div class="pp-pbs-pdf-group"><div class="pp-pbs-pdf-group-head"><span>${esc(g.label)}</span><button type="button" class="pp-pbs-pdf-group-toggle" data-pbs-pdf-group-toggle="${esc(g.key)}">${allSelected ? 'None' : 'All'}</button></div><div class="pp-pbs-pdf-fields">${fieldsHtml}</div></div>`;
    }).join('');

    const filterOptHtml = ctx.isFiltered
      ? `<label class="pp-pbs-pdf-opt"><input type="checkbox" id="ppPbsPdfApplyFilters"${cfg.applyFilters ? ' checked' : ''} /><span>Apply active row filters (${ctx.matchedCount != null ? ctx.matchedCount : ctx.rows.length}/${ctx.doc.items.length} items)</span></label>`
      : '';

    return `<div id="ppPbsPdfPanel" class="pp-pbs-pdf-panel" role="region" aria-label="Configure PBS PDF export fields">
      <div class="pp-pbs-pdf-head">
        <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
          <strong style="font-size:12px">Export PBS PDF &mdash; Select Fields</strong>
          <span class="pp-pbs-pill pp-pbs-pill-swp" id="ppPbsPdfCountBadge">${selCount} / ${allCols.length} fields</span>
          ${selCount > 0 ? `<span class="pp-pbs-pill pp-pbs-status-idle">${esc(pageLabel)}</span>` : '<span class="pp-pbs-pill pp-pbs-status-warn">Pick at least 1 field</span>'}
        </div>
        ${filterOptHtml}
      </div>
      <div class="pp-pbs-pdf-presets" role="group" aria-label="PDF field presets">
        <span class="pp-pbs-colbar-label">Presets:</span>
        ${presets.map(p => `<button type="button" class="pp-pbs-chip" data-pbs-pdf-preset="${p.key}">${esc(p.label)}</button>`).join('')}
      </div>
      <div class="pp-pbs-pdf-groups">${groupsHtml}</div>
      <div class="pp-pbs-pdf-foot">
        <span style="display:inline-flex;align-items:center;gap:.35rem;font-size:10.5px;color:var(--text-muted,#64748b)"><span class="pp-pbs-pdf-dot" style="margin-left:0"></span> Field has data in this PBS &middot; Selection is remembered</span>
        <div style="display:flex;align-items:center;gap:.45rem">
          <button type="button" class="pp-pbs-btn" id="ppPbsPdfCancelBtn">Cancel</button>
          <button type="button" class="pp-pbs-btn pp-pbs-btn-primary" id="ppPbsPdfRunBtn"${selCount === 0 ? ' disabled' : ''}>Export PDF (${selCount} field${selCount === 1 ? '' : 's'})</button>
        </div>
      </div></div>`;
  }

  /* ctx.conflict: { diff: { addedRemote, modifiedBoth, onlyLocal } | null } or null */
  function renderConflictPanel(ctx) {
    if (!ctx.conflict) return '';
    const diff = ctx.conflict.diff;
    const summary = diff
      ? `Remote added: <strong>${diff.addedRemote.length}</strong> &middot; Modified in both: <strong>${diff.modifiedBoth.length}</strong> &middot; Local only: <strong>${diff.onlyLocal.length}</strong>`
      : 'The shared folder file changed on disk and could not be compared (it may be encrypted with another passphrase).';
    const formatModLine = (m) => {
      const changes = Array.isArray(m.changes) ? m.changes : [];
      if (changes.length) {
        const shown = changes.slice(0, 4).map(c => `${esc(c.label)}: <em>${esc(c.localVal)}</em> vs <em>${esc(c.remoteVal)}</em>`).join(' &middot; ');
        const more = changes.length > 4 ? ` (+${changes.length - 4} more)` : '';
        return `<div>~ <strong>Both:</strong> ${esc(m.local.code)} ${esc(m.local.name)} &mdash; ${shown}${more}</div>`;
      }
      return `<div>~ <strong>Both:</strong> ${esc(m.local.code)} ${esc(m.local.name)} [Local: ${esc(m.local.maturity)} / Remote: ${esc(m.remote.maturity)}]</div>`;
    };
    const lines = diff ? [
      ...diff.addedRemote.map(r => `<div>+ <strong>Remote:</strong> ${esc(r.code)} ${esc(r.name)} (${esc(r.maturity)})</div>`),
      ...diff.modifiedBoth.map(formatModLine),
      ...diff.onlyLocal.map(l => `<div>\u2022 <strong>Local only:</strong> ${esc(l.code)} ${esc(l.name)}</div>`),
    ] : [];
    return `<div class="pp-pbs-conflict" role="alert"><div style="font-weight:800;margin-bottom:.25rem">Sync Conflict Detected</div><div>${summary}</div>
      ${lines.length ? `<div style="margin:.45rem 0;max-height:125px;overflow-y:auto;border-top:1px solid rgba(180,83,9,.25);padding-top:.35rem;font-size:11px">${lines.join('')}</div>` : ''}
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
    const renumBtn = (ctx.doc.items || []).length >= 2
      ? '<button type="button" class="pp-pbs-btn" id="ppPbsRenumberBtn" title="Re-sequence hierarchical codes (1, 1.1, 1.2...) to match current tree order">Renumber</button>'
      : '';
    const pdfOpen = Boolean(ctx.pdfExport && ctx.pdfExport.open);
    return `<div class="pp-pbs-toolbar" role="toolbar" aria-label="PBS actions">
      <button type="button" class="pp-pbs-btn pp-pbs-btn-primary" id="ppPbsAddRootBtn">+ Add Root Item</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsUndoBtn"${ctx.canUndo ? '' : ' disabled'} title="${esc(ctx.undoLabel || 'Undo (Ctrl+Z)')}">\u21b6 Undo</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsRedoBtn"${ctx.canRedo ? '' : ' disabled'} title="${esc(ctx.redoLabel || 'Redo (Ctrl+Y)')}">\u21b7 Redo</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsExpandAllBtn">Expand All</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsCollapseAllBtn">Collapse All</button>
      ${renumBtn}
      ${folderBtn}
      <button type="button" class="pp-pbs-btn" id="ppPbsSaveJsonBtn">Save JSON</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsLoadJsonBtn">Load JSON</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsExportCsvBtn">Export CSV</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsImportCsvBtn">Import CSV</button>
      <button type="button" class="pp-pbs-btn" id="ppPbsPasteBtn">Paste Table</button>
      <button type="button" class="pp-pbs-btn pp-pbs-btn-emerald" id="ppPbsExportSvgBtn">SVG Diagram</button>
      <button type="button" class="pp-pbs-btn${pdfOpen ? ' pp-pbs-btn-primary' : ''}" id="ppPbsExportPdfBtn" aria-expanded="${pdfOpen ? 'true' : 'false'}" aria-controls="ppPbsPdfPanel" title="Select fields and export PBS PDF report">PDF Report ${pdfOpen ? '\u25b4' : '\u25be'}</button>
      ${clone}
      <input type="file" id="ppPbsJsonFileInput" accept=".json,application/json" style="display:none" tabindex="-1" />
      <input type="file" id="ppPbsCsvFileInput" accept=".csv,.tsv,.txt,text/csv" style="display:none" tabindex="-1" />
    </div>`;
  }

  function renderSummary(ctx) {
    const s = ctx.summary;
    const fullR = ctx.rollups || null;
    const activeR = (ctx.isFiltered && ctx.filteredRollups) ? ctx.filteredRollups : fullR;
    const activeFlag = (ctx.filter && ctx.filter.flag) || '';
    const riskPill = (flagKey, tone, text, title) =>
      `<button type="button" class="pp-pbs-pill pp-pbs-pill-btn pp-pbs-status-${tone}${activeFlag === flagKey ? ' is-active' : ''}" data-pbs-flag-pill="${flagKey}" aria-pressed="${activeFlag === flagKey ? 'true' : 'false'}" title="${esc(title)}">${text}</button>`;

    const swpPills = [];
    if (ctx.isFiltered) {
      swpPills.push(`<span class="pp-pbs-pill pp-pbs-status-idle" title="SWaP totals reflect the currently filtered items">Filtered: ${ctx.matchedCount != null ? ctx.matchedCount : ctx.rows.length}/${ctx.doc.items.length}</span>`);
    }
    if (activeR) {
      if (activeR.totalMass !== null) swpPills.push(`<span class="pp-pbs-pill pp-pbs-pill-swp" title="Effective total Mass (qty-multiplied, without parent/child double-counting)">Mass: ${esc(fmtNum(activeR.totalMass))} kg</span>`);
      if (activeR.totalPowerConsumption !== null) swpPills.push(`<span class="pp-pbs-pill pp-pbs-pill-swp" title="Effective total Power Consumption">Power: ${esc(fmtNum(activeR.totalPowerConsumption))} W</span>`);
      if (activeR.totalPowerDissipation !== null) swpPills.push(`<span class="pp-pbs-pill pp-pbs-pill-swp" title="Effective total Power Dissipation">Diss.: ${esc(fmtNum(activeR.totalPowerDissipation))} W</span>`);
      if (activeR.lruCount > 0) swpPills.push(`<span class="pp-pbs-pill pp-pbs-status-ok">LRU: ${activeR.lruCount}</span>`);
      if (activeR.spareDelivCount > 0) swpPills.push(`<span class="pp-pbs-pill pp-pbs-status-idle">Spares to deliver: ${activeR.spareDelivCount}</span>`);
    }
    const riskPills = [];
    if (s.overdueCount) riskPills.push(riskPill('overdue', 'error', `\u26a0 ${s.overdueCount} overdue milestone${s.overdueCount === 1 ? '' : 's'}`, 'Click to filter items with overdue linked milestones'));
    if (s.leadRiskCount) riskPills.push(riskPill('leadRisk', 'error', `\u26a0 ${s.leadRiskCount} lead-time risk${s.leadRiskCount === 1 ? '' : 's'}`, 'Click to filter items whose procurement lead time exceeds their linked milestone'));
    if (fullR && fullR.spareGapCount > 0) riskPills.push(riskPill('spareGap', 'warn', `\u26a0 Spares gap: ${fullR.spareGapCount}`, 'Click to filter items where SPARE to be delivered = Yes and SPARE available = No'));
    if (fullR && fullR.overlapCount > 0) riskPills.push(riskPill('overlap', 'warn', `\u26a0 Budget overlap: ${fullR.overlapCount}`, 'Parent & child SWaP values both entered (totals use children to prevent double-counting). Click to filter.'));

    return `<div class="pp-pbs-summary" aria-label="Maturity gate and SWaP summary"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem">
      ${MATURITY.map(m => `<span class="pp-pbs-pill pp-pbs-mat-${m}">${m}: ${s.counts[m]}</span>`).join('')}
      ${riskPills.join('')}
      ${swpPills.join('')}</div>
      <div style="display:flex;align-items:center;gap:.45rem;font-weight:700"><span>Qualified / Delivered: ${s.qualifiedPct}%</span>
      <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.qualifiedPct}" aria-label="Qualified or delivered share" style="width:90px;height:8px;border-radius:9999px;background:#e2e8f0;overflow:hidden"><div style="width:${s.qualifiedPct}%;height:100%;background:#059669"></div></div></div></div>`;
  }

  function renderColBar(ctx, optCols) {
    const g = ctx.colGroups || { docs: false, proc: false, swp: false };
    const r = ctx.rollups || { docsItemsCount: 0, procItemsCount: 0, engItemsCount: 0 };
    const pop = getPopulatedGroupFlags(ctx.doc);
    const anyOn = Boolean(g.docs || g.proc || g.swp);
    const anyPop = Boolean(pop.docs || pop.proc || pop.swp);
    const allPopOn = anyPop && (!pop.docs || g.docs) && (!pop.proc || g.proc) && (!pop.swp || g.swp);

    const chip = (key, label, count) => {
      const on = Boolean(g[key]);
      return `<button type="button" class="pp-pbs-chip${on ? ' is-active' : ''}" data-pbs-col-group="${key}" aria-pressed="${on ? 'true' : 'false'}">${on ? '\u2713 ' : '+ '}${label}${count > 0 ? `<span class="pp-pbs-chip-cnt">${count}</span>` : ''}</button>`;
    };
    const viewPdfBtn = '<button type="button" id="ppPbsExportPdfViewBtn" class="pp-pbs-btn pp-pbs-btn-xs" title="Export PDF with only the currently visible columns and active filters">PDF (Current View)</button>';
    const hint = optCols.length
      ? `<span class="pp-pbs-colhint">${optCols.length} spec col${optCols.length === 1 ? '' : 's'} inline &middot; Code, Deliverable &amp; Actions pinned</span>`
      : '';

    return `<div class="pp-pbs-colbar" role="region" aria-label="Optional PBS columns"><div class="pp-pbs-colchips">
      <span class="pp-pbs-colbar-label">Columns:</span>
      <button type="button" id="ppPbsColsMainBtn" class="pp-pbs-chip${!anyOn ? ' is-active' : ''}" aria-pressed="${!anyOn ? 'true' : 'false'}">Main Only</button>
      ${chip('docs', 'Docs & Drawings', r.docsItemsCount)}
      ${chip('proc', 'Procurement', r.procItemsCount)}
      ${chip('swp', 'SWaP & Spares', r.engItemsCount)}
      ${anyPop && !allPopOn ? '<button type="button" id="ppPbsColsAllBtn" class="pp-pbs-btn pp-pbs-btn-xs">Show All Used</button>' : ''}
      ${viewPdfBtn}
    </div>${hint}</div>`;
  }

  function renderFilters(ctx) {
    const f = ctx.filter || {};
    const items = (ctx.doc && ctx.doc.items) || [];
    const r = ctx.rollups || null;
    const s = ctx.summary || null;
    const active = Boolean(f.search || f.deptId || f.maturity || f.milestoneId || f.heritage || f.procStatus || f.flag);
    const sel = (id, label, all, opts, cur) => `<select id="${id}" class="pp-pbs-select" aria-label="${label}"><option value="">${all}</option>${opts.map(o => `<option value="${esc(o.v)}"${cur === o.v ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;

    const hasHeritage = Boolean(f.heritage || items.some(it => it.heritage));
    const procVals = Array.from(new Set(items.map(it => it.procurementStatus).filter(Boolean))).sort();
    if (f.procStatus && !procVals.includes(f.procStatus)) procVals.push(f.procStatus);
    const hasFlags = Boolean(
      f.flag
      || (r && (r.lruCount > 0 || r.spareDelivCount > 0 || r.spareGapCount > 0 || r.overlapCount > 0))
      || (s && (s.overdueCount > 0 || s.leadRiskCount > 0))
    );
    const flagOpts = [
      { v: 'lru', t: 'LRU Only' },
      { v: 'spareDeliv', t: 'Spares to Deliver' },
      { v: 'spareGap', t: 'Spares Gap' },
      { v: 'leadRisk', t: 'Lead-Time Risk' },
      { v: 'overdue', t: 'Overdue Milestone' },
      { v: 'overlap', t: 'SWaP Budget Overlap' },
    ];

    return `<div class="pp-pbs-filters" role="search" aria-label="Filter PBS items">
      <input type="search" id="ppPbsFilterSearch" class="pp-pbs-input" style="min-width:180px;flex:1" aria-label="Search PBS items" placeholder="Filter by code, acronym, deliverable, P/N, manufacturer, drawing..." value="${esc(f.search || '')}" />
      ${sel('ppPbsFilterDept', 'Filter by department', 'All Departments', (ctx.db.departments || []).map(d => ({ v: d.id, t: `[${d.code}] ${d.name}` })), f.deptId || '')}
      ${sel('ppPbsFilterMaturity', 'Filter by maturity', 'All Gates', MATURITY.map(m => ({ v: m, t: m })), f.maturity || '')}
      ${sel('ppPbsFilterMs', 'Filter by milestone', 'All Milestones', (ctx.projectMilestones || []).map(m => ({ v: m.id, t: m.title })), f.milestoneId || '')}
      ${hasHeritage ? sel('ppPbsFilterHeritage', 'Filter by Existing/Update/New status', 'All Statuses', HERITAGE.map(h => ({ v: h, t: h })), f.heritage || '') : ''}
      ${procVals.length ? sel('ppPbsFilterProc', 'Filter by procurement status', 'All Proc.', procVals.map(v => ({ v, t: v })), f.procStatus || '') : ''}
      ${hasFlags ? sel('ppPbsFilterFlag', 'Filter by engineering or risk flag', 'All Flags', flagOpts, f.flag || '') : ''}
      ${active ? '<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" id="ppPbsClearFiltersBtn">Reset</button>' : ''}</div>`;
  }

  function renderNotice(ctx) {
    const w = ctx.notices || [];
    if (!w.length) return '';
    return `<div class="pp-pbs-notice" role="status"><strong>Import notes</strong><ul style="margin:.3rem 0 0 1rem;list-style:disc">${w.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${w.length > 8 ? `<div>\u2026and ${w.length - 8} more.</div>` : ''}</div>`;
  }

  /* ctx: { doc, db, project, summary, rollups, filteredRollups, isFiltered, matchedCount, rows, collapsedIds, colGroups, filter, edit, pasteOpen,
   *        isExpanded, pdfExport, canUndo, canRedo, undoLabel, redoLabel, conflict, notices, owners, manufacturers, procStatuses, projectMilestones,
   *        cloneSources:[{id,code,name,count}], canDirSync, dirName, hasRemembered, status:{text,tone} } */
  function buildDialogHtml(ctx) {
    const p = ctx.project;
    const n = ctx.summary.total;
    const optCols = resolveVisibleOptionalCols(ctx.doc, ctx.colGroups);
    const projStyle = p && p.color ? ` style="--pbs-proj-color:${esc(p.color)}"` : '';
    const optHeads = optCols.map(c => `<th scope="col" class="pp-pbs-th-opt"${c.right ? ' style="text-align:right"' : (c.center ? ' style="text-align:center"' : '')}>${esc(c.label)}</th>`).join('');
    const stickyCls = optCols.length ? ' pp-pbs-sticky' : '';
    const isExp = Boolean(ctx.isExpanded);

    return `<div class="pp-pbs-wrap"${projStyle}>
      <header class="pp-pbs-head"><div class="pp-pbs-head-title">
        <h2 id="ppPbsDialogTitle" style="margin:0;font-size:15px;font-weight:800">PBS \u2014 ${p ? `[${esc(p.code)}] ${esc(p.name)}` : 'Project'}</h2>
        <div style="font-size:11px;color:var(--text-muted,#64748b)">Rev ${esc(ctx.doc.meta.revision)} &middot; ${n} item${n === 1 ? '' : 's'}<span class="pp-pbs-tip"> &middot; Tip: double-click or Enter to edit, Alt+Arrows to move/indent, Ctrl+Z to undo</span></div></div>
        <div class="pp-pbs-head-actions"><span id="ppPbsSyncStatus" class="pp-pbs-pill pp-pbs-status-${esc(ctx.status.tone)}" role="status" aria-live="polite" title="${esc(ctx.status.text)}">${esc(ctx.status.text)}</span>
        <button type="button" class="pp-pbs-btn pp-pbs-expand-win-btn" id="ppPbsExpandWinBtn" aria-pressed="${isExp ? 'true' : 'false'}" title="${isExp ? 'Restore default PBS window size' : 'Expand PBS window to full screen'}">${isExp ? '\u2921 Restore' : '\u2922 Expand'}</button>
        <button type="button" class="pp-pbs-btn" id="ppPbsCloseBtn" aria-label="Close PBS dialog">Close</button></div></header>
      ${renderToolbar(ctx)}${renderSummary(ctx)}${renderFilters(ctx)}${renderColBar(ctx, optCols)}
      <div class="pp-pbs-body">${renderConflictPanel(ctx)}${renderNotice(ctx)}${renderPdfPanel(ctx)}${renderPastePanel(ctx)}${renderEditForm(ctx)}
        <div class="pp-pbs-table-wrap"><table class="pp-pbs-table${stickyCls}"><caption class="pp-pbs-sr">Product breakdown structure items</caption>
          <thead><tr>
            <th scope="col" class="pp-pbs-th-code">Code</th>
            <th scope="col" class="pp-pbs-th-name">Deliverable / Subsystem</th>
            <th scope="col">Maturity</th>
            <th scope="col">Department</th>
            <th scope="col">Owner</th>
            <th scope="col">Milestone</th>
            ${optHeads}
            <th scope="col" class="pp-pbs-th-actions" style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>${renderRows(ctx, optCols)}</tbody>
          ${renderTotalFoot(ctx, optCols)}
        </table></div></div></div>`;
  }

  P.view = {
    esc, CSS, OPTIONAL_COL_GROUPS, renderTextOrLink, getPopulatedGroupFlags, resolveVisibleOptionalCols,
    injectStyles, renderRows, renderTotalFoot, renderEditForm, renderPastePanel, renderPdfPanel, renderConflictPanel,
    renderToolbar, renderSummary, renderColBar, renderFilters, renderNotice, buildDialogHtml,
  };
})();
