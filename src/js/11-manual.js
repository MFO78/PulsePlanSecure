    /* ============================================================================
     * 13. BUILT-IN SEARCHABLE USER MANUAL & FEATURE REFERENCE
     * ============================================================================ */

    const MANUAL_SECTIONS = [
      {
        id: 'overview',
        title: 'Getting Started & Core Concepts',
        badge: 'Basics',
        keywords: 'getting started demo live database fte days hours weekly pro rata departments projects milestones setup',
        bodyHtml: `
          <p class="text-slate-600 leading-relaxed">
            <strong>PulsePlan</strong> is a self-contained, offline-ready company roadmap, capacity, and utilisation planner.
            All data lives locally in your browser or in a shared <code class="px-1 py-0.5 rounded bg-slate-100 font-mono">.json</code> file you link via Google Drive Desktop or a company network folder.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Weekly Source of Truth (Pro-Rata)</div>
              <p class="text-slate-600 leading-relaxed">Allocations and capacities are stored per <strong>ISO Week</strong> as a continuous <strong>FTE</strong> headcount rate. Switching between <strong>FTE</strong>, <strong>Days</strong>, and <strong>Hours</strong> converts automatically (default <code class="px-1 rounded bg-white font-mono">1.0 FTE = 5d/wk = 40h/wk</code>). Monthly edits pro-rate seamlessly across 4-week and 5-week ISO months.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Live DB vs. Demo Sandbox</div>
              <p class="text-slate-600 leading-relaxed">Use <strong>Demo: ON</strong> in the header to experiment with realistic sample data without touching your real company plan. Click <strong>Reset</strong> in the amber Demo banner anytime to restore the sample scenario.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Departments, Projects &amp; Setup</div>
              <p class="text-slate-600 leading-relaxed">Configure Departments (with default FTE capacity, color, and manager), Projects (code, status, priority, owner, color), Milestones, and conversion/threshold rules in the <strong>Data &amp; Setup</strong> tab.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Active User, Welcome Guide &amp; Install App</div>
              <p class="text-slate-600 leading-relaxed">Click your initials pill in the header to switch your active name, toggle <strong>Dark Mode</strong>, reopen the <strong>Welcome &amp; Setup Guide</strong>, or click <strong>Install App</strong> to install PulsePlan as a genuine offline PWA on Android, iOS, Windows, or macOS.</p>
            </div>
          </div>`,
      },
      {
        id: 'roadmap',
        title: 'Unified Roadmap Matrix',
        badge: 'Planning',
        keywords: 'roadmap matrix department project weeks months fte color accent fill 3-level drag drop copy period range comments capacity override bottleneck search filter vertical detailed note size',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Clean Meeting-Ready Canvas with Full Editing Power</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Grouping, Timeline &amp; Sorting:</strong> Switch rows between <strong>By Dept</strong> (capacity vs. load), <strong>By Project</strong> (effort across teams, sorted naturally by code, with <strong>&#9888; Over</strong> badges), and <strong>Timeline</strong> (Executive Gantt bars with effort intensity &amp; milestone diamonds).</li>
                <li>&bull; <strong>Committed, Pipeline &amp; Admin (Non-FTE) Projects:</strong> Tag projects in Setup as <strong>Committed (FTE)</strong>, <strong>Pipeline / Tentative</strong> (hatched cards, toggleable in Filters), or <strong>Admin (Non-FTE)</strong> for logging expected departmental issues and requested meetings with zero FTE impact on utilisation %, bottlenecks, or cost burn.</li>
                <li>&bull; <strong>Time Scale, Standard vs. Overview &amp; Interval Jump:</strong> Switch between <strong>Months</strong> and <strong>Weeks</strong>. Standard View supports <strong>1&ndash;6</strong> fully editable columns; <strong>12, 18, and 24</strong> switch automatically to a compact <strong>Simplified Overview</strong> so full 1&ndash;2 year horizons fit cleanly on laptops and 4K displays. Step by 1 period with <strong>&lsaquo; / &rsaquo;</strong> (<code class="px-1 rounded bg-white font-mono">&larr;/&rarr;</code>) or jump by the full selected interval with <strong>&laquo; / &raquo;</strong> (<code class="px-1 rounded bg-white font-mono">Shift+&larr;/&rarr;</code>).</li>
                <li>&bull; <strong>Row Labels &amp; Note Size:</strong> Inside <strong>Filters &amp; Display</strong>, toggle <strong>Row Labels</strong> between <strong>Vertical</strong> (compact 62 px spine maximizing card space) and <strong>Detailed</strong> (248 px panel showing manager/owner, priority, peak load, active teams/projects, budget progress bars, cost burn, next milestone, and row reordering), and adjust <strong>Notes</strong> size (<strong>Norm / Large / XL</strong>).</li>
                <li>&bull; <strong>Sticky Column Headers:</strong> While scrolling down, only the Week/Month column headers (with date ranges and <strong>&lsaquo; / Today / &rsaquo;</strong> controls) stay pinned at the top of the screen.</li>
              </ul>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Fast Editing, Inline Numbers, Bottleneck Fix &amp; Bulk Copy</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Inline Value Edit &amp; Hover Actions:</strong> Click any card&rsquo;s numeric value to type a new number right in place (<code class="px-1 rounded bg-white font-mono">Enter</code> saves, <code class="px-1 rounded bg-white font-mono">Esc</code> cancels). Hover any card for instant <strong>&minus; / +</strong> stepping, <strong>&rarr;</strong> to extend, and <strong>&#9678;</strong> to spotlight.</li>
                <li>&bull; <strong>One-Click Bottleneck Resolver:</strong> Click <strong>Fix</strong> on any overallocated (&gt;100%) cell to preview &amp; apply a trim, +1 period deferral, or temporary contractor capacity buffer (all 1-click Undoable).</li>
                <li>&bull; <strong>Column Quick Actions:</strong> Hover any column header for <strong>Copy &rarr;</strong> (duplicate into next period), <strong>Cap</strong> (define either a company holiday/shutdown % or a momentary department FTE override), and <strong>&times;</strong> (clear period allocations).</li>
                <li>&bull; <strong>Variable Capacity Overrides:</strong> Click the <code class="px-1 rounded bg-white font-mono">alloc / cap</code> readout in any cell to edit overrides (tagged <span class="px-1 rounded bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">Var ▲/▼</span>). View, filter, edit, or reset all grouped override spans in <strong>Setup &amp; Data &rarr; Departments</strong>.</li>
              </ul>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">4 Card Colour Schemes &amp; Smart Filters</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Accent:</strong> Clean white cards with left colour stripe. <strong>Fill:</strong> Solid high-contrast entity colour cards (default). <strong>By FTE:</strong> 6-tier heat scale (% of dept capacity). <strong>3-Level:</strong> Green / Yellow / Red demand tiers with configurable thresholds (<strong>&#9881; Tune</strong>).</li>
                <li>&bull; <strong>Filters &amp; Display Panel:</strong> Click <strong>Filters &amp; Display</strong> in the roadmap bar to expand Search, <strong>Spotlight</strong>, Department/Project filters, Quick Filter chips (<strong>Overallocated</strong>, <strong>At Risk</strong>, <strong>Has Notes</strong>), Row Labels, Note Size, Units, Start Date, Comments, Hide Empty, Drag Mode, and Saved Views.</li>
              </ul>
            </div>
          </div>`,
      },
      {
        id: 'presenting',
        title: 'Present Mode, Spotlight & Print Slide',
        badge: 'Presenting',
        keywords: 'present mode projector spotlight fullscreen hide empty print slide pdf actions 1 2 3 4 periods',
        bodyHtml: `
          <p class="text-slate-600 leading-relaxed">
            Because the unified Roadmap is already meeting-ready, presenting to a steering committee takes a single click—no separate mode to reconfigure.
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Present Mode (F)</div>
              <p class="text-slate-600 leading-relaxed">Click <strong>Present</strong> in the roadmap toolbar (or press <code class="px-1 rounded bg-white font-mono">F</code>) to enter distraction-free fullscreen. Editing chrome (+ Allocate, Undo/Redo, hover steppers, cell bars, and totals footer) hides automatically while keeping your exact horizon, filters, and card colours. Press <code class="px-1 rounded bg-white font-mono">Esc</code> or <code class="px-1 rounded bg-white font-mono">F</code> to exit.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Project Spotlight (&#9678;)</div>
              <p class="text-slate-600 leading-relaxed">Pick any project from the <strong>Spotlight</strong> dropdown in <strong>Filters &amp; Display</strong>, hover any card and click <strong>&#9678;</strong>, or click a vertical Project row spine. Matching cards highlight with a crisp ring while other items dim—press <code class="px-1 rounded bg-white font-mono">Esc</code> to clear.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Instant Horizon Zoom (1–4)</div>
              <p class="text-slate-600 leading-relaxed">Press <code class="px-1 rounded bg-white font-mono">1</code>, <code class="px-1 rounded bg-white font-mono">2</code>, <code class="px-1 rounded bg-white font-mono">3</code>, or <code class="px-1 rounded bg-white font-mono">4</code> anytime on the Roadmap tab to zoom into 1–4 equal-width columns with full date ranges.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Actions Menu: Print Slide &amp; Vector PDF</div>
              <p class="text-slate-600 leading-relaxed">Open <strong>Actions &#9662;</strong> in the roadmap bar to add a Milestone, save a Snapshot, export a <strong>Print Slide (Light)</strong> (always crisp light mode, zero cropped columns), or generate a multi-page <strong>Export Vector PDF</strong>.</p>
            </div>
          </div>`,
      },
      {
        id: 'powertools',
        title: 'Shift Schedule, What-If, Holidays & CSV Import',
        badge: 'Power Tools',
        keywords: 'shift project slip delay holiday shutdown capacity range budget archive completed what-if scenario sandbox clone saved views presets csv excel paste import',
        bodyHtml: `
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">&#8644; Shift Project Schedule (&plusmn;N Wks/Mos)</div>
              <p class="text-slate-600 leading-relaxed">Click <strong>&#8644; Shift</strong> on any project row in <strong>By Project</strong> view or in <strong>Data &amp; Setup &rarr; Projects</strong> to move all allocations, comments, and milestones together (with optional baseline preservation to track slip, plus full Undo).</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">What-If Scenario Sandbox</div>
              <p class="text-slate-600 leading-relaxed">Click <strong>What-If</strong> in the top header to clone your real <strong>Live DB</strong> into an isolated in-memory sandbox. Test reschedules or hiring changes safely while viewing live diffs, then click <strong>Commit to Live</strong> or <strong>Discard</strong>.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Range Capacity &amp; Holiday / Shutdown %</div>
              <p class="text-slate-600 leading-relaxed">Set variable capacity across a <strong>Start &rarr; End</strong> date span inside the Capacity Modal, or use <strong>Holiday / Shutdown %</strong> in <strong>Data &amp; Setup &rarr; Departments</strong> to scale multiple departments at once (e.g. 50% half-week or 0% shutdown).</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Effort &amp; Cost Budgets, Duplicate Project &amp; Archiving</div>
              <p class="text-slate-600 leading-relaxed">Set optional <strong>Day Rates</strong> per department and <strong>Effort / Cost Budgets</strong> per project (currency in <strong>Units &amp; Thresholds</strong>) to track financial burn automatically. Use <strong>Copy</strong> in Setup to duplicate a project with its allocations &amp; milestones, or <strong>Archive</strong> completed projects.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Executive Briefing &amp; Saved Views</div>
              <p class="text-slate-600 leading-relaxed">Use <strong>Actions &#9662; &rarr; Copy Executive Briefing</strong> to copy a ready-to-paste status summary (utilisation, bottlenecks, slipped milestones, budgets, and key notes) for Email/Slack/Teams, and bookmark filter/horizon presets via <strong>Views</strong>.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div class="font-bold text-slate-900">Multi-Mode Excel / CSV Round-Trip</div>
              <p class="text-slate-600 leading-relaxed">Click <strong>Import CSV / Excel</strong> in <strong>Data &amp; Setup</strong> to paste <strong>Allocations</strong>, <strong>Variable Capacities</strong>, or <strong>Milestones</strong> with live preview &amp; Undo. <strong>Matrix CSV</strong> exports Capacity rows, Commitments, Cost estimates, and Notes.</p>
            </div>
          </div>`,
      },
      {
        id: 'health',
        title: 'Health, Heatmap & Snapshot Comparison',
        badge: 'Analytics',
        keywords: 'health kpi chart heatmap capacity snapshots baseline pin comparison diff csv changelog audit trail budget',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Org Health, Budget KPIs &amp; Interactive Heatmap</div>
              <p class="text-slate-600 leading-relaxed">The <strong>Health &amp; Evolution</strong> tab tracks Average Organisation Utilisation, Bottleneck Slots, Milestones Health, and Project Budgets. Tap any bar in the <strong>Load vs. Variable Capacity</strong> chart, or click any cell in the <strong>Department &times; Period Capacity Heatmap</strong> to jump straight to that slot in the Roadmap Matrix.</p>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Baselines, Pinning &amp; A vs. B Comparison</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Save Snapshot:</strong> Freeze the current plan anytime. Check <strong>Pin</strong> on official baselines to protect them from automatic rolling retention caps.</li>
                <li>&bull; <strong>Compare Any Two States:</strong> Pick a <strong>Baseline (A)</strong> snapshot and compare against the <strong>Current Active Plan</strong> or another snapshot across 5 views: <em>Period Diff</em>, <em>By Project</em>, <em>Cells</em>, <em>Milestones</em>, and <em>Capacity</em>.</li>
                <li>&bull; <strong>Audit Change Log:</strong> Every edit is recorded with timestamp, user, category, and summary—searchable and exportable to CSV.</li>
              </ul>
            </div>
          </div>`,
      },
      {
        id: 'sync',
        title: 'Shared File Sync, Conflict Guard & Exports',
        badge: 'Sync & PDF',
        keywords: 'sync shared file google drive conflict guard overwrite reload backup json csv pdf export offline retention rolling prune',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Shared Folder Auto-Sync &amp; Pre-Write Conflict Guard</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; On desktop Chrome/Edge, link a shared <code class="px-1 rounded bg-white font-mono">.json</code> file in Google Drive Desktop, OneDrive, or a company network share via <strong>Sync &amp; Snapshots</strong>. Edits auto-save and teammate updates auto-reload via polling + window focus.</li>
                <li>&bull; <strong>Pre-Write Conflict Guard:</strong> Before saving, PulsePlan verifies the file timestamp on disk. If a teammate saved changes since your last sync, auto-save pauses and opens a <strong>Sync Conflict</strong> dialog so you can <em>Reload Theirs</em>, <em>Keep Mine</em>, or <em>Download Local Backup</em> without losing work.</li>
              </ul>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Vector PDF, JSON/CSV &amp; Retention Hygiene</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Export PDF:</strong> Generates a multi-page vector PDF with your chosen card colour style, 4–6 periods/page, executive KPIs, load chart, department health, milestones, comments appendix, and snapshot diff (automatically falls back to clean landscape browser print when offline).</li>
                <li>&bull; <strong>Rolling Retention Caps:</strong> Configure max dump history, change log, and unpinned snapshots in <strong>Sync &amp; Snapshots</strong> to keep synced JSON files lean, with one-click <strong>Archive Trimmed &amp; Prune</strong>.</li>
              </ul>
            </div>
          </div>`,
      },
      {
        id: 'mobile',
        title: 'Mobile & Touch Workflow',
        badge: 'Mobile',
        keywords: 'mobile phone tablet touch cards grid swipe accordion bottom sheet share',
        bodyHtml: `
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
            <div class="font-bold text-slate-900">Mobile-First Hybrid Layout</div>
            <ul class="space-y-1 text-slate-600 leading-relaxed">
              <li>&bull; On viewports under 768 px, PulsePlan automatically switches to a <strong>Period-Focus Card Deck</strong> with swipeable week/month pills (carrying live health dots), expandable department/project accordions, large touch steppers, and a bottom navigation bar.</li>
              <li>&bull; Tap <strong>Grid / Cards</strong> in the top header anytime to peek at the compact 2D table (ideal in landscape orientation).</li>
              <li>&bull; Tap <strong>&#8943;</strong> on any mobile card for the Touch Action Sheet (Edit, Extend, Move/Copy to another period, Remove), and use <strong>Share / Save JSON</strong> for native iOS/Android Share Sheet integration.</li>
            </ul>
          </div>`,
      },
      {
        id: 'shortcuts',
        title: 'Undo/Redo & Keyboard Shortcuts',
        badge: 'Shortcuts',
        keywords: 'undo redo ctrl z ctrl y keyboard shortcuts arrow left right escape fullscreen today meeting manual',
        bodyHtml: `
          <p class="text-slate-600 leading-relaxed">
            PulsePlan keeps a <strong>30-step Undo / Redo</strong> history for edits on the active database (accessible via toolbar buttons, keyboard shortcuts, or the inline <strong>Undo</strong> button inside action toasts).
          </p>
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                <tr>
                  <th scope="col" class="px-3 py-2 font-bold">Shortcut</th>
                  <th scope="col" class="px-3 py-2 font-bold">Action</th>
                  <th scope="col" class="px-3 py-2 font-bold">Where</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">Ctrl+Z / Cmd+Z</td><td class="px-3 py-2">Undo last roadmap or setup edit</td><td class="px-3 py-2 text-slate-500">Global</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">Ctrl+Y / Cmd+Shift+Z</td><td class="px-3 py-2">Redo last undone edit</td><td class="px-3 py-2 text-slate-500">Global</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">&larr; / &rarr;</td><td class="px-3 py-2">Step timeline back / forward by 1 week or month</td><td class="px-3 py-2 text-slate-500">Roadmap Tab</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">T</td><td class="px-3 py-2">Jump timeline to current week / month (Today)</td><td class="px-3 py-2 text-slate-500">Roadmap Tab</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">/</td><td class="px-3 py-2">Open Filters &amp; focus Roadmap Search box</td><td class="px-3 py-2 text-slate-500">Roadmap Tab</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">A</td><td class="px-3 py-2">Open + Allocate Manpower dialog</td><td class="px-3 py-2 text-slate-500">Roadmap Tab</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">1 / 2 / 3 / 4</td><td class="px-3 py-2">Show 1, 2, 3, or 4 equal-width weeks/months</td><td class="px-3 py-2 text-slate-500">Roadmap Tab</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">F</td><td class="px-3 py-2">Toggle distraction-free Present (Fullscreen) mode</td><td class="px-3 py-2 text-slate-500">Roadmap Tab</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">Esc</td><td class="px-3 py-2">Close menus/modal &rarr; Clear Spotlight &rarr; Exit Present mode</td><td class="px-3 py-2 text-slate-500">Global</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">Alt + Drag</td><td class="px-3 py-2">Copy an allocation card instead of moving it</td><td class="px-3 py-2 text-slate-500">Roadmap Matrix</td></tr>
                <tr><td class="px-3 py-2 font-mono font-bold text-indigo-700">?</td><td class="px-3 py-2">Open this User Manual</td><td class="px-3 py-2 text-slate-500">Global</td></tr>
              </tbody>
            </table>
          </div>`,
      },
    ];

    let _manualActiveSection = 'all';

    function openManualModal(sectionId = 'all') {
      _manualActiveSection = sectionId || 'all';
      showModal(`
        <div class="p-5 space-y-4 text-xs">
          <div class="w-10 h-1.5 rounded-full bg-slate-300 mx-auto sm:hidden" aria-hidden="true"></div>
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <h3 id="modalTitle" class="text-base font-extrabold text-slate-900">PulsePlan User Manual</h3>
                <span class="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase">Offline-Ready</span>
              </div>
              <p class="text-[11px] text-slate-500 mt-0.5">Complete guide to roadmap planning, Meeting View, analytics, file sync, and shortcuts.</p>
            </div>
            <button type="button" aria-label="Close manual" onclick="closeModal()" class="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl font-bold leading-none shrink-0">&times;</button>
          </div>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <label for="manualSearchInput" class="sr-only">Search manual topics</label>
            <input id="manualSearchInput" type="text" placeholder="Search manual (e.g., spotlight, conflict, undo, PDF, pro-rata)..." oninput="renderManualContent()"
              class="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800" />
          </div>

          <div id="manualTopicTabs" class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"></div>

          <div id="manualBodyContent" class="space-y-4 max-h-[56dvh] overflow-y-auto pr-1"></div>

          <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
            <span>Tip: Press <code class="px-1 rounded bg-slate-100 font-mono">?</code> anytime to open this guide.</span>
            <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition">Close Manual</button>
          </div>
        </div>`, 'max-w-4xl');

      renderManualContent();
    }

    function setManualSection(secId) {
      _manualActiveSection = secId || 'all';
      renderManualContent();
    }

    function renderManualContent() {
      const tabsEl = document.getElementById('manualTopicTabs');
      const bodyEl = document.getElementById('manualBodyContent');
      const q = (document.getElementById('manualSearchInput')?.value || '').trim().toLowerCase();
      if (!tabsEl || !bodyEl) return;

      const tabItems = [{ id: 'all', label: 'All Topics' }, ...MANUAL_SECTIONS.map(s => ({ id: s.id, label: s.badge }))];
      tabsEl.innerHTML = tabItems.map(t => {
        const active = _manualActiveSection === t.id;
        return `
          <button type="button" onclick="setManualSection('${t.id}')"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition ${active ? 'bg-indigo-600 text-white border-indigo-600 font-bold' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}">
            ${escapeHtml(t.label)}
          </button>`;
      }).join('');

      const filtered = MANUAL_SECTIONS.filter(sec => {
        if (_manualActiveSection !== 'all' && sec.id !== _manualActiveSection) return false;
        if (!q) return true;
        const haystack = `${sec.title} ${sec.badge} ${sec.keywords} ${sec.bodyHtml.replace(/<[^>]+>/g, ' ')}`.toLowerCase();
        return haystack.includes(q);
      });

      if (filtered.length === 0) {
        bodyEl.innerHTML = `<div class="p-6 text-center text-slate-500 rounded-xl border border-dashed border-slate-300">No manual topics matched &ldquo;${escapeHtml(q)}&rdquo;. <button type="button" onclick="document.getElementById('manualSearchInput').value=''; setManualSection('all');" class="font-bold text-indigo-600 hover:underline ml-1">Show all topics</button></div>`;
        return;
      }

      bodyEl.innerHTML = filtered.map(sec => `
        <section class="p-4 rounded-2xl bg-white border border-slate-200 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-sm font-extrabold text-slate-900">${escapeHtml(sec.title)}</h4>
            <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">${escapeHtml(sec.badge)}</span>
          </div>
          ${sec.bodyHtml}
        </section>`).join('');
    }
