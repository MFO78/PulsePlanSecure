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
    #ppPbsDialog { width: min(1160px, 96vw); max-height: 92vh; border: 1px solid var(--border-subtle, #e2e8f0); border-radius: 1rem; padding: 0; background: var(--surface-card, #ffffff); color: var(--text-primary, #0f172a); box-shadow: 0 25px 50px -12px rgba(15, 23, 42, .32); overflow: hidden; }
    #ppPbsDialog::backdrop { background: rgba(15, 23, 42, .55); backdrop-filter: blur(3px); }
    .pp-pbs-wrap { display: flex; flex-direction: column; max-height: 92vh; }
    .pp-pbs-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .6rem; padding: .9rem 1.15rem; border-top: 4px solid var(--pbs-proj-color, #4f46e5); border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); }
    .pp-pbs-toolbar, .pp-pbs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; padding: .55rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-card, #ffffff); font-size: 11.5px; }
    .pp-pbs-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; padding: .5rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11px; }
    .pp-pbs-viewbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .45rem; padding: .42rem 1.15rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-subtle, #f8fafc); font-size: 11px; }
    .pp-pbs-tabs { display: inline-flex; align-items: center; gap: .25rem; padding: .18rem; border-radius: .6rem; background: var(--border-subtle, #e2e8f0); }
    .pp-pbs-tab { display: inline-flex; align-items: center; gap: .3rem; padding: .24rem .58rem; border-radius: .46rem; border: 0; background: transparent; color: var(--text-muted, #475569); font-size: 11px; font-weight: 700; cursor: pointer; }
    .pp-pbs-tab:hover { color: var(--text-primary, #0f172a); }
    .pp-pbs-tab.is-active { background: var(--surface-card, #ffffff); color: #4f46e5; box-shadow: 0 1px 2px rgba(15, 23, 42, .08); }
    .pp-pbs-tab-cnt { font-size: 9.5px; font-weight: 800; padding: .04rem .32rem; border-radius: 9999px; background: rgba(79, 70, 229, .12); color: #4338ca; }
    .pp-pbs-body { padding: .85rem 1.15rem; overflow-y: auto; flex: 1 1 auto; }
    .pp-pbs-btn { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; padding: .34rem .62rem; border-radius: .55rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-card, #ffffff); color: var(--text-primary, #334155); font-size: 11.5px; font-weight: 700; cursor: pointer; }
    .pp-pbs-btn:hover { background: var(--surface-subtle, #f1f5f9); }
    .pp-pbs-btn:focus-visible, .pp-pbs-toggle:focus-visible, .pp-pbs-input:focus-visible, .pp-pbs-select:focus-visible, .pp-pbs-tab:focus-visible, .pp-pbs-spec-btn:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
    .pp-pbs-btn-primary { background: #4f46e5; border-color: #4f46e5; color: #ffffff; }
    .pp-pbs-btn-primary:hover { background: #4338ca; }
    .pp-pbs-btn-emerald { background: #059669; border-color: #059669; color: #ffffff; }
    .pp-pbs-btn-emerald:hover { background: #047857; }
    .pp-pbs-btn-danger { border-color: #fecdd3; background: #fff1f2; color: #be123c; }
    .pp-pbs-btn-xs { padding: .16rem .38rem; font-size: 10.5px; border-radius: .4rem; }
    .pp-pbs-input, .pp-pbs-select { padding: .32rem .55rem; border-radius: .5rem; border: 1px solid var(--border-subtle, #cbd5e1); background: var(--surface-subtle, #f8fafc); color: var(--text-primary, #0f172a); font-size: 11.5px; }
    .pp-pbs-pill { display: inline-flex; align-items: center; gap: .25rem; padding: .16rem .5rem; border-radius: 9999px; font-size: 10.5px; font-weight: 700; }
    .pp-pbs-pill-swp { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; }
    .pp-pbs-status-ok { background: #dcfce7; color: #166534; }
    .pp-pbs-status-warn { background: #fef3c7; color: #92400e; }
    .pp-pbs-status-error { background: #ffe4e6; color: #9f1239; }
    .pp-pbs-status-idle { background: #f1f5f9; color: #475569; }
    .pp-pbs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .pp-pbs-table th, .pp-pbs-table td { padding: .45rem .55rem; border-bottom: 1px solid var(--border-subtle, #e2e8f0); text-align: left; vertical-align: middle; }
    .pp-pbs-table.pp-pbs-dense th, .pp-pbs-table.pp-pbs-dense td { padding: .4rem .38rem; font-size: 11.5px; }
    .pp-pbs-table th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #64748b); white-space: nowrap; }
    .pp-pbs-spares-stack { display: inline-flex; flex-direction: column; gap: .15rem; font-size: 10px; line-height: 1.15; }
    .pp-pbs-spares-stack > span { display: inline-flex; align-items: center; gap: .22rem; white-space: nowrap; }
    .pp-pbs-row-ctx { opacity: .62; }
    .pp-pbs-row:focus-visible { outline: 2px solid #4f46e5; outline-offset: -2px; }
    .pp-pbs-dept-dot { display: inline-block; width: 8px; height: 8px; border-radius: 9999px; margin-right: .35rem; vertical-align: middle; flex-shrink: 0; }
    .pp-pbs-toggle { width: 1.25rem; height: 1.25rem; display: inline-flex; align-items: center; justify-content: center; border-radius: .35rem; border: 1px solid transparent; background: transparent; color: var(--text-muted, #64748b); cursor: pointer; font-size: 10px; margin-right: .25rem; }
    .pp-pbs-toggle:hover { background: var(--surface-subtle, #e2e8f0); color: var(--text-primary, #0f172a); }
    .pp-pbs-acr { display: inline-block; margin-left: .32rem; padding: .04rem .36rem; border-radius: .35rem; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; vertical-align: middle; }
    .pp-pbs-her { display: inline-block; margin-left: .28rem; padding: .04rem .38rem; border-radius: 9999px; font-size: 9.5px; font-weight: 700; vertical-align: middle; }
    .pp-pbs-her-Existing { background: #e2e8f0; color: #334155; }
    .pp-pbs-her-Update { background: #fef3c7; color: #92400e; }
    .pp-pbs-her-New { background: #e0e7ff; color: #3730a3; }
    .pp-pbs-yn { display: inline-block; padding: .08rem .4rem; border-radius: 9999px; font-size: 10px; font-weight: 700; }
    .pp-pbs-yn-Yes { background: #d1fae5; color: #065f46; }
    .pp-pbs-yn-No { background: #f1f5f9; color: #64748b; }
    .pp-pbs-spec-btn { display: inline-flex; align-items: center; gap: .2rem; margin-left: .35rem; padding: .08rem .42rem; border-radius: 9999px; border: 1px solid #cbd5e1; background: var(--surface-subtle, #f8fafc); color: #475569; font-size: 10px; font-weight: 700; cursor: pointer; vertical-align: middle; }
    .pp-pbs-spec-btn:hover, .pp-pbs-spec-btn.is-open { background: #eef2ff; border-color: #818cf8; color: #3730a3; }
    .pp-pbs-subtext { font-size: 10.5px; color: var(--text-muted, #64748b); margin-left: 1.5rem; line-height: 1.35; }
    .pp-pbs-num { font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right !important; }
    .pp-pbs-rollup { font-style: italic; color: var(--text-muted, #64748b); font-size: 11px; }
    .pp-pbs-mono { font-family: ui-monospace, monospace; font-size: 11px; }
    .pp-pbs-detail-row > td { padding: .35rem .55rem .65rem !important; background: var(--surface-subtle, #f8fafc); border-bottom: 1px solid var(--border-subtle, #e2e8f0); }
    .pp-pbs-detail-card { margin-left: calc(min(var(--pbs-depth, 0), 5) * 18px + 1.25rem); padding: .6rem .75rem; border-radius: .65rem; border: 1px solid var(--border-subtle, #e2e8f0); border-left: 3px solid var(--pbs-dept-color, #6366f1); background: var(--surface-card, #ffffff); display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .65rem .9rem; font-size: 11px; }
    .pp-pbs-detail-group h4 { margin: 0 0 .35rem; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted, #64748b); }
    .pp-pbs-detail-list { display: grid; grid-template-columns: auto 1fr; gap: .2rem .55rem; margin: 0; }
    .pp-pbs-detail-list dt { color: var(--text-muted, #64748b); font-weight: 600; white-space: nowrap; }
    .pp-pbs-detail-list dd { margin: 0; color: var(--text-primary, #0f172a); font-weight: 600; word-break: break-word; }
    .pp-pbs-form { margin-bottom: .85rem; padding: .85rem; border-radius: .85rem; border: 1px solid #c7d2fe; background: var(--surface-subtle, #f8fafc); display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); align-items: end; gap: .55rem; }
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
    html.dark #ppPbsDialog, body.dark #ppPbsDialog { background: #0f172a; color: #e2e8f0; border-color: #334155; }
    html.dark .pp-pbs-head, body.dark .pp-pbs-head, html.dark .pp-pbs-summary, body.dark .pp-pbs-summary, html.dark .pp-pbs-viewbar, body.dark .pp-pbs-viewbar, html.dark .pp-pbs-form, body.dark .pp-pbs-form { background: #1e293b; border-bottom-color: #334155; }
    html.dark .pp-pbs-form, body.dark .pp-pbs-form { border-color: #334155; }
    html.dark .pp-pbs-section, body.dark .pp-pbs-section, html.dark .pp-pbs-detail-card, body.dark .pp-pbs-detail-card { background: #0f172a; border-color: #334155; }
    html.dark .pp-pbs-section > summary, body.dark .pp-pbs-section > summary { color: #e2e8f0; }
    html.dark .pp-pbs-sec-grid, body.dark .pp-pbs-sec-grid { border-top-color: #334155; }
    html.dark .pp-pbs-detail-row > td, body.dark .pp-pbs-detail-row > td { background: #1e293b; border-bottom-color: #334155; }
    html.dark .pp-pbs-detail-list dd, body.dark .pp-pbs-detail-list dd { color: #e2e8f0; }
    html.dark .pp-pbs-tabs, body.dark .pp-pbs-tabs { background: #0f172a; }
    html.dark .pp-pbs-tab, body.dark .pp-pbs-tab { color: #94a3b8; }
    html.dark .pp-pbs-tab.is-active, body.dark .pp-pbs-tab.is-active { background: #334155; color: #a5b4fc; }
    html.dark .pp-pbs-tab-cnt, body.dark .pp-pbs-tab-cnt { background: rgba(165, 180, 252, .16); color: #c7d2fe; }
    html.dark .pp-pbs-acr, body.dark .pp-pbs-acr { background: #1e293b; color: #cbd5e1; border-color: #475569; }
    html.dark .pp-pbs-spec-btn, body.dark .pp-pbs-spec-btn { background: #1e293b; border-color: #475569; color: #cbd5e1; }
    html.dark .pp-pbs-spec-btn:hover, body.dark .pp-pbs-spec-btn:hover, html.dark .pp-pbs-spec-btn.is-open, body.dark .pp-pbs-spec-btn.is-open { background: rgba(79, 70, 229, .28); border-color: #818cf8; color: #c7d2fe; }
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
    @media (max-width: 767px) {
      #ppPbsDialog { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; border-radius: 0; border: 0; }
      .pp-pbs-wrap { height: 100dvh; max-height: 100dvh; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
      .pp-pbs-head { padding: .65rem .8rem; gap: .4rem; }
      .pp-pbs-tip { display: none; }
      .pp-pbs-toolbar { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding: .45rem .8rem; gap: .35rem; }
      .pp-pbs-toolbar::-webkit-scrollbar { display: none; }
      .pp-pbs-toolbar > * { flex: 0 0 auto; }
      .pp-pbs-summary { padding: .45rem .8rem; gap: .35rem; }
      .pp-pbs-viewbar { padding: .4rem .8rem; flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
      .pp-pbs-viewbar::-webkit-scrollbar { display: none; }
      .pp-pbs-viewbar > * { flex: 0 0 auto; }
      .pp-pbs-filters { display: grid; grid-template-columns: 1fr 1fr; padding: .5rem .8rem; gap: .4rem; }
      .pp-pbs-filters #ppPbsFilterSearch { grid-column: 1 / -1; min-width: 0 !important; width: 100%; }
      .pp-pbs-filters #ppPbsClearFiltersBtn { grid-column: 1 / -1; }
      .pp-pbs-body { padding: .65rem .8rem 1rem; }
      .pp-pbs-btn { min-height: 38px; padding: .4rem .7rem; font-size: 12.5px; }
      .pp-pbs-btn-xs { min-height: 36px; padding: .3rem .55rem; font-size: 12px; }
      .pp-pbs-tab { min-height: 32px; padding: .28rem .6rem; font-size: 12px; }
      .pp-pbs-input, .pp-pbs-select { min-height: 38px; font-size: 16px; width: 100%; box-sizing: border-box; }
      .pp-pbs-toolbar .pp-pbs-select { width: auto; max-width: 210px; font-size: 13px; }
      .pp-pbs-toggle { width: 2rem; height: 2rem; font-size: 12px; }
      .pp-pbs-form, .pp-pbs-sec-grid { grid-template-columns: 1fr; }
      .pp-pbs-form { padding: .75rem; }
      .pp-pbs-form .pp-pbs-field { grid-column: auto !important; }
      .pp-pbs-table, .pp-pbs-table tbody { display: block; width: 100%; }
      .pp-pbs-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      .pp-pbs-table tr.pp-pbs-row { display: block; margin: 0 0 .65rem calc(min(var(--pbs-depth, 0), 4) * 10px); padding: .55rem .7rem; border: 1px solid var(--border-subtle, #e2e8f0); border-left: 5px solid var(--pbs-dept-color, #94a3b8); border-radius: .75rem; background: var(--surface-card, #ffffff); background: color-mix(in srgb, var(--pbs-dept-color, transparent) 7%, var(--surface-card, #ffffff)); }
      .pp-pbs-table tr.pp-pbs-detail-row { display: block; margin: -.45rem 0 .65rem calc(min(var(--pbs-depth, 0), 4) * 10px); border: 0; }
      .pp-pbs-table tr.pp-pbs-detail-row > td { display: block; padding: 0 !important; background: transparent; border: 0; }
      .pp-pbs-detail-card { margin-left: 0; grid-template-columns: 1fr; }
      .pp-pbs-table tr:not(.pp-pbs-row):not(.pp-pbs-detail-row), .pp-pbs-table td[colspan] { display: block; width: 100%; border: 0; }
      .pp-pbs-table tr.pp-pbs-row td { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; padding: .22rem 0 !important; border-bottom: 0; white-space: normal !important; text-align: left !important; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-code { display: inline-flex; font-size: 11px; color: var(--text-muted, #64748b); margin-right: .45rem; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-mat { display: inline-flex; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-name { display: block; padding: .2rem 0 .35rem !important; font-size: 13.5px; }
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-dept::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-owner::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-ms::before,
      .pp-pbs-table tr.pp-pbs-row td.pp-pbs-cell-kv::before { content: attr(data-label); font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted, #64748b); flex-shrink: 0; }
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

  const VIEW_COLUMNS = {
    overview: [
      { label: 'Code' }, { label: 'Deliverable / Subsystem' }, { label: 'Maturity' },
      { label: 'Department' }, { label: 'Owner' }, { label: 'Milestone' }, { label: 'Actions', right: true },
    ],
    engineering: [
      { label: 'Code' }, { label: 'Deliverable / Subsystem' }, { label: 'Status' },
      { label: 'Mass (kg)', right: true }, { label: 'Power Cons. (W)', right: true }, { label: 'Power Diss. (W)', right: true },
      { label: 'MTBF (h)', right: true }, { label: 'LRU' }, { label: 'Actions', right: true },
    ],
    procurement: [
      { label: 'Code' }, { label: 'Deliverable / Subsystem' }, { label: 'Manufacturer' },
      { label: 'Part Number' }, { label: 'Proc. Status' }, { label: 'Lead (wks)', right: true },
      { label: 'Spares' }, { label: 'Alternative' }, { label: 'Actions', right: true },
    ],
    docs: [
      { label: 'Code' }, { label: 'Deliverable / Subsystem' }, { label: 'Description' },
      { label: 'Mech. Drawing' }, { label: 'Elec. Drawing' }, { label: 'Reference Doc' }, { label: 'Actions', right: true },
    ],
  };

  function renderDetailRow(item, depth, colSpan, deptColor, sub) {
    const id = esc(item.id);
    const kv = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const docPairs = [];
    if (item.acronym) docPairs.push(kv('Acronym', `<span class="pp-pbs-mono">${esc(item.acronym)}</span>`));
    if (item.heritage) docPairs.push(kv('Existing / Update / New', herPill(item.heritage)));
    if (item.description) docPairs.push(kv('Description', esc(item.description)));
    if (item.mechDrawing) docPairs.push(kv('Mechanical Drawing', `<span class="pp-pbs-mono">${esc(item.mechDrawing)}</span>`));
    if (item.elecDrawing) docPairs.push(kv('Electrical Drawing', `<span class="pp-pbs-mono">${esc(item.elecDrawing)}</span>`));
    if (item.refDoc) docPairs.push(kv('Reference Document', esc(item.refDoc)));

    const procPairs = [];
    if (item.manufacturer) procPairs.push(kv('Manufacturer', esc(item.manufacturer)));
    if (item.partNumber) procPairs.push(kv('Part Number', `<span class="pp-pbs-mono">${esc(item.partNumber)}</span>`));
    if (item.procurementStatus) procPairs.push(kv('Proc. / Mfg. Status', `<span class="pp-pbs-pill pp-pbs-status-idle">${esc(item.procurementStatus)}</span>`));
    if (isNum(item.leadTime)) procPairs.push(kv('Lead Time', `${esc(fmtNum(item.leadTime))} wks`));
    if (item.componentAlt) procPairs.push(kv('Component Alternative', esc(item.componentAlt)));

    const engPairs = [];
    const fmtMetric = (own, desc, unit) => {
      if (isNum(own)) {
        const extra = isNum(desc) ? ` <span class="pp-pbs-rollup">(+ ${esc(fmtNum(desc))} ${unit} sub-items)</span>` : '';
        return `${esc(fmtNum(own))} ${unit}${extra}`;
      }
      return isNum(desc) ? `<span class="pp-pbs-rollup">&Sigma; ${esc(fmtNum(desc))} ${unit} (sub-items)</span>` : '';
    };
    const mStr = fmtMetric(item.mass, sub && sub.descMass, 'kg');
    const pcStr = fmtMetric(item.powerConsumption, sub && sub.descPowerCons, 'W');
    const pdStr = fmtMetric(item.powerDissipation, sub && sub.descPowerDiss, 'W');
    if (mStr) engPairs.push(kv('Mass', mStr));
    if (pcStr) engPairs.push(kv('Power Consumption', pcStr));
    if (pdStr) engPairs.push(kv('Power Dissipation', pdStr));
    if (isNum(item.mtbf)) engPairs.push(kv('MTBF', `${esc(fmtNum(item.mtbf))} h`));
    if (item.lru) engPairs.push(kv('LRU', ynPill(item.lru)));
    if (item.spareAvailable) engPairs.push(kv('SPARE Available', ynPill(item.spareAvailable)));
    if (item.spareToDeliver) engPairs.push(kv('SPARE to be Delivered', ynPill(item.spareToDeliver)));

    const groups = [];
    if (docPairs.length) groups.push(`<div class="pp-pbs-detail-group"><h4>Identity &amp; Documentation</h4><dl class="pp-pbs-detail-list">${docPairs.join('')}</dl></div>`);
    if (procPairs.length) groups.push(`<div class="pp-pbs-detail-group"><h4>Procurement &amp; Supply</h4><dl class="pp-pbs-detail-list">${procPairs.join('')}</dl></div>`);
    if (engPairs.length) groups.push(`<div class="pp-pbs-detail-group"><h4>Engineering Budgets &amp; Spares</h4><dl class="pp-pbs-detail-list">${engPairs.join('')}</dl></div>`);
    if (!groups.length) return '';

    return `<tr class="pp-pbs-detail-row" data-pbs-detail-for="${id}" style="--pbs-depth:${depth};${deptColor ? `--pbs-dept-color:${deptColor};` : ''}">
      <td colspan="${colSpan}"><div class="pp-pbs-detail-card">${groups.join('')}</div></td></tr>`;
  }

  function formatMetricCell(own, desc, unit) {
    if (isNum(own)) {
      const tip = isNum(desc) ? ` title="Own: ${esc(fmtNum(own))} ${unit} + Sub-items: ${esc(fmtNum(desc))} ${unit}"` : '';
      return `<span${tip}>${esc(fmtNum(own))}</span>`;
    }
    if (isNum(desc)) {
      return `<span class="pp-pbs-rollup" title="Auto-rolled up from sub-items">&Sigma; ${esc(fmtNum(desc))}</span>`;
    }
    return '\u2014';
  }

  function formatSparesChips(item) {
    const parts = [];
    if (item.spareAvailable) parts.push(`<span><span style="color:var(--text-muted,#64748b)">Avail:</span>${ynPill(item.spareAvailable)}</span>`);
    if (item.spareToDeliver) parts.push(`<span><span style="color:var(--text-muted,#64748b)">Deliv:</span>${ynPill(item.spareToDeliver)}</span>`);
    return parts.length ? `<span class="pp-pbs-spares-stack">${parts.join('')}</span>` : '\u2014';
  }

  /* ctx.rows: [{ item, depth, hasChildren, isContextOnly }]; ctx.summary; ctx.rollups; ctx.viewMode; ctx.expandedDetailIds */
  function renderRows(ctx) {
    const viewMode = VIEW_COLUMNS[ctx.viewMode] ? ctx.viewMode : 'overview';
    const colSpan = VIEW_COLUMNS[viewMode].length;
    const deptMap = new Map((ctx.db.departments || []).map(d => [d.id, d]));
    const msMap = new Map((ctx.db.milestones || []).map(m => [m.id, m]));
    const rollupsById = (ctx.rollups && ctx.rollups.byId) ? ctx.rollups.byId : new Map();
    const expandedDetails = ctx.expandedDetailIds || new Set();

    if (!ctx.rows.length) {
      const msg = ctx.doc.items.length ? 'No PBS items match the active filters.' : 'No PBS deliverables yet. Use <strong>+ Add Root Item</strong>, import a CSV, or clone another project.';
      return `<tr><td colspan="${colSpan}" style="text-align:center;padding:1.5rem;color:var(--text-muted,#64748b)">${msg}</td></tr>`;
    }

    return ctx.rows.map(({ item, depth, hasChildren, isContextOnly }) => {
      const dept = item.deptId ? deptMap.get(item.deptId) : null;
      const ms = item.milestoneId ? msMap.get(item.milestoneId) : null;
      const collapsed = ctx.collapsedIds.has(item.id);
      const bottleneck = ctx.summary.bottleneckMap.get(item.id);
      const overdue = ctx.summary.overdueIds.has(item.id);
      const nm = esc(item.name);
      const id = esc(item.id);
      const deptColor = dept && dept.color ? esc(dept.color) : '';
      const sub = rollupsById.get(item.id) || null;
      const counts = countSpecs(item);
      const hasRollupOnly = counts.total === 0 && sub && (isNum(sub.descMass) || isNum(sub.descPowerCons) || isNum(sub.descPowerDiss));
      const detailOpen = expandedDetails.has(item.id) && (counts.total > 0 || hasRollupOnly);

      const toggle = hasChildren
        ? `<button type="button" class="pp-pbs-toggle" data-pbs-toggle="${id}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${nm}">${collapsed ? '\u25b6' : '\u25bc'}</button>`
        : '<span style="display:inline-block;width:1.5rem" aria-hidden="true"></span>';

      const specBtn = counts.total > 0
        ? `<button type="button" class="pp-pbs-spec-btn${detailOpen ? ' is-open' : ''}" data-pbs-details="${id}" aria-expanded="${detailOpen ? 'true' : 'false'}" aria-label="${detailOpen ? 'Hide' : 'Show'} optional specifications for ${nm}">${detailOpen ? '\u25be' : '\u25b8'} Specs (${counts.total})</button>`
        : '';

      const acrBadge = item.acronym ? `<span class="pp-pbs-acr">${esc(item.acronym)}</span>` : '';
      const inlineHer = (viewMode === 'overview' && item.heritage) ? herPill(item.heritage) : '';
      const overviewSubtext = viewMode === 'overview'
        ? `${item.description ? `<div class="pp-pbs-subtext">${esc(item.description)}</div>` : ''}${item.notes ? `<div class="pp-pbs-subtext">${item.description ? '<strong>Note:</strong> ' : ''}${esc(item.notes)}</div>` : ''}`
        : '';
      const nameCell = `<td class="pp-pbs-cell-name" data-label="Deliverable" style="padding-left:${6 + depth * 18}px">${toggle}<span style="font-weight:${depth === 0 ? 800 : 600}">${nm}</span>${acrBadge}${inlineHer}${viewMode === 'overview' && bottleneck ? ` <span class="pp-pbs-pill pp-pbs-status-warn" title="A child deliverable is still at ${esc(bottleneck)}">\u26a0 Child at ${esc(bottleneck)}</span>` : ''}${specBtn}${overviewSubtext}</td>`;

      const btn = (act, label, text) => `<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-move="${act}" data-pbs-id="${id}" aria-label="${label} ${nm}">${text}</button>`;
      const actionsCell = `<td class="pp-pbs-cell-actions" data-label="Actions" style="text-align:right;white-space:nowrap"><span role="group" aria-label="Actions for ${nm}">${btn('up', 'Move up', '\u2191')} ${btn('down', 'Move down', '\u2193')} ${btn('outdent', 'Outdent', '\u2190')} ${btn('indent', 'Indent', '\u2192')}
        <button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-add-child="${id}" aria-label="Add child to ${nm}">+Child</button>
        <button type="button" class="pp-pbs-btn pp-pbs-btn-xs" data-pbs-edit="${id}" aria-label="Edit ${nm}">Edit</button>
        <button type="button" class="pp-pbs-btn pp-pbs-btn-xs pp-pbs-btn-danger" data-pbs-del="${id}" aria-label="Delete ${nm}">\u00d7</button></span></td>`;

      let middleCells = '';
      if (viewMode === 'overview') {
        const msCell = ms
          ? `${esc(ms.title)}${ms.date ? ` <span style="font-size:10px;color:${overdue ? '#be123c' : '#64748b'};font-weight:${overdue ? 800 : 400}">(${esc(ms.date)}${overdue ? ' \u00b7 Overdue' : ''})</span>` : ''}`
          : '\u2014';
        const deptCell = dept
          ? `<span>${deptColor ? `<span class="pp-pbs-dept-dot" style="background:${deptColor}" aria-hidden="true"></span>` : ''}${esc(`[${dept.code}] ${dept.name}`)}</span>`
          : '\u2014';
        middleCells = `<td class="pp-pbs-cell-mat" data-label="Maturity">${matPill(item.maturity)}</td>
          <td class="pp-pbs-cell-dept" data-label="Department" style="color:${deptColor || 'inherit'};font-weight:600;white-space:nowrap">${deptCell}</td>
          <td class="pp-pbs-cell-owner" data-label="Owner" style="white-space:nowrap">${esc(item.owner || '\u2014')}</td>
          <td class="pp-pbs-cell-ms" data-label="Milestone" style="white-space:nowrap">${msCell}</td>`;
      } else if (viewMode === 'engineering') {
        middleCells = `<td class="pp-pbs-cell-kv" data-label="Status" style="white-space:nowrap">${item.heritage ? herPill(item.heritage) : '\u2014'}</td>
          <td class="pp-pbs-cell-kv pp-pbs-num" data-label="Mass (kg)">${formatMetricCell(item.mass, sub && sub.descMass, 'kg')}</td>
          <td class="pp-pbs-cell-kv pp-pbs-num" data-label="Power Cons. (W)">${formatMetricCell(item.powerConsumption, sub && sub.descPowerCons, 'W')}</td>
          <td class="pp-pbs-cell-kv pp-pbs-num" data-label="Power Diss. (W)">${formatMetricCell(item.powerDissipation, sub && sub.descPowerDiss, 'W')}</td>
          <td class="pp-pbs-cell-kv pp-pbs-num" data-label="MTBF (h)">${isNum(item.mtbf) ? esc(fmtNum(item.mtbf)) : '\u2014'}</td>
          <td class="pp-pbs-cell-kv" data-label="LRU" style="white-space:nowrap">${ynPill(item.lru)}</td>`;
      } else if (viewMode === 'procurement') {
        middleCells = `<td class="pp-pbs-cell-kv" data-label="Manufacturer">${esc(item.manufacturer || '\u2014')}</td>
          <td class="pp-pbs-cell-kv pp-pbs-mono" data-label="Part Number" style="white-space:nowrap">${esc(item.partNumber || '\u2014')}</td>
          <td class="pp-pbs-cell-kv" data-label="Proc. Status" style="white-space:nowrap">${item.procurementStatus ? `<span class="pp-pbs-pill pp-pbs-status-idle">${esc(item.procurementStatus)}</span>` : '\u2014'}</td>
          <td class="pp-pbs-cell-kv pp-pbs-num" data-label="Lead Time (wks)">${isNum(item.leadTime) ? `${esc(fmtNum(item.leadTime))} wks` : '\u2014'}</td>
          <td class="pp-pbs-cell-kv" data-label="Spares" style="white-space:nowrap">${formatSparesChips(item)}</td>
          <td class="pp-pbs-cell-kv" data-label="Alternative">${esc(item.componentAlt || '\u2014')}</td>`;
      } else if (viewMode === 'docs') {
        middleCells = `<td class="pp-pbs-cell-kv" data-label="Description" style="max-width:260px">${esc(item.description || '\u2014')}</td>
          <td class="pp-pbs-cell-kv pp-pbs-mono" data-label="Mech. Drawing">${esc(item.mechDrawing || '\u2014')}</td>
          <td class="pp-pbs-cell-kv pp-pbs-mono" data-label="Elec. Drawing">${esc(item.elecDrawing || '\u2014')}</td>
          <td class="pp-pbs-cell-kv" data-label="Reference Doc">${esc(item.refDoc || '\u2014')}</td>`;
      }

      const mainRow = `<tr class="pp-pbs-row${isContextOnly ? ' pp-pbs-row-ctx' : ''}" tabindex="0" data-pbs-row="${id}" style="--pbs-depth:${depth};${deptColor ? `--pbs-dept-color:${deptColor};` : ''}border-left:4px solid ${deptColor || 'transparent'}">
        <td class="pp-pbs-cell-code" data-label="Code" style="font-family:ui-monospace,monospace;font-weight:700;white-space:nowrap">${esc(item.code)}</td>
        ${nameCell}${middleCells}${actionsCell}
      </tr>`;

      return detailOpen ? mainRow + renderDetailRow(item, depth, colSpan, deptColor, sub) : mainRow;
    }).join('');
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
          ${field('Mechanical Drawing', `<input type="text" id="ppPbsFMechDrawing" class="pp-pbs-input" value="${esc(item ? item.mechDrawing : '')}" placeholder="e.g., DWG-MECH-042 Rev B" />`)}
          ${field('Electrical Drawing', `<input type="text" id="ppPbsFElecDrawing" class="pp-pbs-input" value="${esc(item ? item.elecDrawing : '')}" placeholder="e.g., DWG-ELEC-118 Rev A" />`)}
          ${field('Reference Document', `<input type="text" id="ppPbsFRefDoc" class="pp-pbs-input" value="${esc(item ? item.refDoc : '')}" placeholder="e.g., ICD-SYS-003, Spec..." />`)}
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
          ${field('Mass (kg)', `<input type="number" id="ppPbsFMass" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.mass)}" placeholder="e.g., 1.25" />`)}
          ${field('Power Consumption (W)', `<input type="number" id="ppPbsFPowerCons" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.powerConsumption)}" placeholder="e.g., 45" />`)}
          ${field('Power Dissipation (W)', `<input type="number" id="ppPbsFPowerDiss" class="pp-pbs-input" min="0" step="any" value="${numVal(item && item.powerDissipation)}" placeholder="e.g., 12.5" />`)}
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
    const r = ctx.rollups || null;
    const swpPills = [];
    if (r) {
      if (r.totalMass !== null) swpPills.push(`<span class="pp-pbs-pill pp-pbs-pill-swp" title="Sum of entered Mass across ${r.massCount} item${r.massCount === 1 ? '' : 's'}">Mass: ${esc(fmtNum(r.totalMass))} kg</span>`);
      if (r.totalPowerConsumption !== null) swpPills.push(`<span class="pp-pbs-pill pp-pbs-pill-swp" title="Sum of entered Power Consumption across ${r.powerConsCount} item${r.powerConsCount === 1 ? '' : 's'}">Power: ${esc(fmtNum(r.totalPowerConsumption))} W</span>`);
      if (r.totalPowerDissipation !== null) swpPills.push(`<span class="pp-pbs-pill pp-pbs-pill-swp" title="Sum of entered Power Dissipation across ${r.powerDissCount} item${r.powerDissCount === 1 ? '' : 's'}">Diss.: ${esc(fmtNum(r.totalPowerDissipation))} W</span>`);
      if (r.lruCount > 0) swpPills.push(`<span class="pp-pbs-pill pp-pbs-status-ok">LRU: ${r.lruCount}</span>`);
      if (r.spareDelivCount > 0) swpPills.push(`<span class="pp-pbs-pill pp-pbs-status-idle">Spares to deliver: ${r.spareDelivCount}</span>`);
    }
    return `<div class="pp-pbs-summary" aria-label="Maturity gate and SWaP summary"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem">
      ${MATURITY.map(m => `<span class="pp-pbs-pill pp-pbs-mat-${m}">${m}: ${s.counts[m]}</span>`).join('')}
      ${s.overdueCount ? `<span class="pp-pbs-pill pp-pbs-status-error">\u26a0 ${s.overdueCount} overdue milestone link${s.overdueCount === 1 ? '' : 's'}</span>` : ''}
      ${swpPills.join('')}</div>
      <div style="display:flex;align-items:center;gap:.45rem;font-weight:700"><span>Qualified / Delivered: ${s.qualifiedPct}%</span>
      <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.qualifiedPct}" aria-label="Qualified or delivered share" style="width:90px;height:8px;border-radius:9999px;background:#e2e8f0;overflow:hidden"><div style="width:${s.qualifiedPct}%;height:100%;background:#059669"></div></div></div></div>`;
  }

  function renderViewBar(ctx) {
    const cur = VIEW_COLUMNS[ctx.viewMode] ? ctx.viewMode : 'overview';
    const r = ctx.rollups || { docsItemsCount: 0, procItemsCount: 0, engItemsCount: 0, anySpecsCount: 0 };
    const expanded = ctx.expandedDetailIds || new Set();
    const tabs = [
      { id: 'overview', label: 'Overview', count: 0 },
      { id: 'engineering', label: 'Engineering', count: r.engItemsCount },
      { id: 'procurement', label: 'Procurement', count: r.procItemsCount },
      { id: 'docs', label: 'Docs', count: r.docsItemsCount },
    ];
    const tabHtml = tabs.map(t => `<button type="button" role="tab" aria-selected="${cur === t.id ? 'true' : 'false'}" class="pp-pbs-tab${cur === t.id ? ' is-active' : ''}" data-pbs-view="${t.id}">${t.label}${t.count > 0 ? `<span class="pp-pbs-tab-cnt">${t.count}</span>` : ''}</button>`).join('');
    const specsBtn = r.anySpecsCount > 0
      ? `<button type="button" class="pp-pbs-btn pp-pbs-btn-xs" id="ppPbsToggleAllSpecsBtn">${expanded.size > 0 ? 'Hide All Specs' : `Show All Specs (${r.anySpecsCount})`}</button>`
      : '';
    return `<div class="pp-pbs-viewbar"><div class="pp-pbs-tabs" role="tablist" aria-label="PBS column view">${tabHtml}</div>${specsBtn}</div>`;
  }

  function renderFilters(ctx) {
    const f = ctx.filter;
    const active = Boolean(f.search || f.deptId || f.maturity || f.milestoneId);
    const sel = (id, label, all, opts, cur) => `<select id="${id}" class="pp-pbs-select" aria-label="${label}"><option value="">${all}</option>${opts.map(o => `<option value="${esc(o.v)}"${cur === o.v ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
    return `<div class="pp-pbs-filters" role="search" aria-label="Filter PBS items">
      <input type="search" id="ppPbsFilterSearch" class="pp-pbs-input" style="min-width:190px;flex:1" aria-label="Search PBS items" placeholder="Filter by code, acronym, deliverable, P/N, manufacturer, drawing..." value="${esc(f.search)}" />
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

  /* ctx: { doc, db, project, summary, rollups, rows, collapsedIds, expandedDetailIds, viewMode, filter, edit, conflict, notices,
   *        owners, manufacturers, procStatuses, projectMilestones, cloneSources:[{id,code,name,count}],
   *        canDirSync, dirName, hasRemembered, status:{text,tone} } */
  function buildDialogHtml(ctx) {
    const p = ctx.project;
    const n = ctx.summary.total;
    const viewMode = VIEW_COLUMNS[ctx.viewMode] ? ctx.viewMode : 'overview';
    const cols = VIEW_COLUMNS[viewMode];
    const projStyle = p && p.color ? ` style="--pbs-proj-color:${esc(p.color)}"` : '';
    const theadCells = cols.map(c => `<th scope="col"${c.right ? ' style="text-align:right"' : ''}>${esc(c.label)}</th>`).join('');
    return `<div class="pp-pbs-wrap"${projStyle}>
      <header class="pp-pbs-head"><div>
        <h2 id="ppPbsDialogTitle" style="margin:0;font-size:15px;font-weight:800">PBS \u2014 ${p ? `[${esc(p.code)}] ${esc(p.name)}` : 'Project'}</h2>
        <div style="font-size:11px;color:var(--text-muted,#64748b)">Rev ${esc(ctx.doc.meta.revision)} &middot; ${n} item${n === 1 ? '' : 's'}<span class="pp-pbs-tip"> &middot; Tip: focus a row, then Alt+Arrows to move or indent, Enter to edit</span></div></div>
        <div style="display:flex;align-items:center;gap:.45rem"><span id="ppPbsSyncStatus" class="pp-pbs-pill pp-pbs-status-${esc(ctx.status.tone)}" role="status" aria-live="polite">${esc(ctx.status.text)}</span>
        <button type="button" class="pp-pbs-btn" id="ppPbsCloseBtn" aria-label="Close PBS dialog">Close</button></div></header>
      ${renderToolbar(ctx)}${renderSummary(ctx)}${renderFilters(ctx)}${renderViewBar(ctx)}
      <div class="pp-pbs-body">${renderConflictPanel(ctx)}${renderNotice(ctx)}${renderEditForm(ctx)}
        <div style="overflow-x:auto"><table class="pp-pbs-table${cols.length > 7 ? ' pp-pbs-dense' : ''}"><caption class="pp-pbs-sr">Product breakdown structure items</caption>
          <thead><tr>${theadCells}</tr></thead>
          <tbody>${renderRows(ctx)}</tbody></table></div></div></div>`;
  }

  P.view = {
    esc, CSS, VIEW_COLUMNS, injectStyles, renderRows, renderEditForm, renderConflictPanel,
    renderToolbar, renderSummary, renderViewBar, renderFilters, renderNotice, buildDialogHtml,
  };
})();
