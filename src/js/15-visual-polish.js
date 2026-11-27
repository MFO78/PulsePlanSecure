    /* ============================================================================
     * 15. PULSEPLANSECURE: VISUAL POLISH & CONTENT ENHANCEMENTS
     *     - Header Security Shield Status Badge (desktop/tablet to prevent mobile overlap)
     *     - Interactive Critical Path SVG Diagram
     *     - iCalendar (.ics) Milestone Export
     *     - In-App Changelog ("What's New") & External Costs Guide in User Manual
     * ============================================================================ */

    if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
      MANUAL_SECTIONS.push({
        id: 'external-costs',
        title: 'External Consultants & PBS Material Costs',
        badge: 'Finance',
        keywords: 'external consultants sow fixed price invoice retainer non-labour budget burn analysis pbs procurement unit cost raw material component qty',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-teal-50/70 border border-teal-200 space-y-1.5">
              <div class="font-bold text-teal-950">Capturing External / Consultant Expenditure (No &euro;/Day Rate)</div>
              <p class="text-slate-700 leading-relaxed">External consultants, labs, and subcontractors are often billed by fixed-price SOW, milestone deliverable, or lump-sum invoice rather than internal FTE &times; &euro;/day. Recording them as a regular department would distort headcount and capacity charts.</p>
              <ol class="list-decimal pl-5 space-y-1 text-slate-700 leading-relaxed">
                <li>Open <strong>Health &amp; Evolution</strong> and scroll to <strong>Burn &amp; Budget Analysis</strong>.</li>
                <li>Use the <strong>External / Consultant Costs</strong> form at the bottom of the card to select the <strong>Project</strong>, enter a <strong>Consultant / SOW Description</strong> and <strong>Amount</strong>, and optionally assign a specific <strong>Period</strong> (or leave as <em>Project-wide</em>).</li>
                <li>Click <strong>Add</strong>. The cost is saved in the encrypted database and immediately included in <strong>Total Planned</strong>, <strong>Remaining / Over Budget</strong>, <strong>Spending Split by Department &amp; Non-Labour</strong>, and (when a period is set) <strong>Spending Split by Period</strong>.</li>
                <li>Click <strong>Remove</strong> on any row to delete an entry; all additions and removals are recorded in the Change Log.</li>
              </ol>
            </div>
            <div class="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
              <div class="font-bold text-amber-950">PBS Procurement Component &amp; Raw Material Unit Cost</div>
              <p class="text-slate-700 leading-relaxed">To include hardware, components, or raw materials in project burn and budget tracking, open a project&rsquo;s <strong>PBS</strong> dialog, expand the <strong>Procurement</strong> section on any item, and enter its <strong>Unit Cost</strong>. PulsePlanSecure multiplies <code class="px-1 rounded bg-white font-mono">Unit Cost &times; Qty</code> (defaulting to <code class="px-1 rounded bg-white font-mono">&times; 1</code>) and rolls the total into <strong>Burn &amp; Budget Analysis</strong> under <strong>PBS Materials</strong>. The field is also supported in PBS CSV import/export and conflict diffs.</p>
            </div>
          </div>`,
      });

      MANUAL_SECTIONS.push({
        id: 'whatsnew',
        title: "What's New in PulsePlanSecure v9.0-secure",
        badge: "What's New",
        keywords: 'changelog release notes whats new v9 v9.0 secure rbac users admin delegated login dropdown password change sign out lock wipe connection lost finance vault auto open sync pbs expand fullscreen pdf field selector delete confirmation bullets mobile sri encryption critical path leveling ics calendar ms project xml directory health evolution project filter burn budget spending periods departments snapshot notes show hide variable capacity reset external consultants sow non-labour procurement unit cost material default 1 fte',
        bodyHtml: `
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-1.5">
              <div class="font-bold text-indigo-950">v9.0-secure Highlights</div>
              <ul class="space-y-1.5 text-slate-700 leading-relaxed">
                <li>&bull; <strong>External / Consultant Costs, PBS Procurement Unit Cost &amp; Default 1 FTE:</strong> Track fixed-fee SOWs and external consultant invoices directly inside <strong>Health &amp; Evolution &rarr; Burn &amp; Budget Analysis</strong> (per project, with optional period attribution) without distorting internal FTE capacity. Enter component or raw-material <strong>Unit Cost</strong> in the <strong>PBS &rarr; Procurement</strong> section (automatically multiplied by <em>Qty</em> and supported in CSV import/export) to roll <strong>PBS Materials</strong> into Burn &amp; Budget Analysis. Adding a new Roadmap activity now defaults to <strong>1 FTE</strong> and preserves your FTE value when other modal fields change.</li>
                <li>&bull; <strong>Health &amp; Evolution Project Filter &amp; Burn / Budget Analysis:</strong> Filter <strong>Health &amp; Evolution</strong> by a specific project (synced bidirectionally with the Roadmap view by default) and inspect the new <strong>Burn &amp; Budget Analysis</strong> frame featuring summary KPIs (Budget, Window Burn, Remaining/Over Budget, Average Burn per Period) plus spending breakdowns split by <strong>period</strong> and by <strong>department &amp; non-labour</strong>.</li>
                <li>&bull; <strong>Evolution &amp; Snapshot Comparison Notes Toggle &amp; Variable Capacity Reset Fix:</strong> Toggle <strong>Show Notes / Hide Notes</strong> in <strong>Evolution &amp; Snapshot Comparison</strong> (with a dedicated Hide button and active project/department filtering), and rely on cleaner <strong>Variable Capacity</strong> resets that automatically prune nominal-capacity overrides so the last item never remains stuck.</li>
                <li>&bull; <strong>Multi-User Access Control, Dropdown Sign-In &amp; Delegated Admin Rights:</strong> Provision team accounts with per-tab visibility (<em>Roadmap</em>, <em>Team Health</em>, <em>Setup &amp; Data</em>, <em>Sync &amp; Snapshots</em>), optional <strong>Finance Access</strong>, and delegated <strong>Administrator</strong> privileges. Pick users from a dropdown on the login screen, let team members set personal passwords, and let the Main Administrator rotate the master password or edit, reset, and disable accounts with immediate live revocation and automatic sync to disk.</li>
                <li>&bull; <strong>Full-Hide Sign-Out &amp; Connection-Loss Data Protection:</strong> Signing out clears all workspace data from memory and browser storage behind a full-screen lock gate while remembering your linked file for one-click reconnect. If a linked database connection is lost, local data is cleared automatically until the password is re-entered.</li>
                <li>&bull; <strong>Unified-Key Separate Finance Vault with Auto-Open &amp; Live Sync:</strong> Keep sensitive day rates and project budgets in an independent AES-256-GCM encrypted Finance Vault encrypted with the same session key (no second password needed). The main database stores the Finance Vault path so it reopens automatically, stays synced in real time, and re-encrypts automatically on master password rotation.</li>
                <li>&bull; <strong>Product Breakdown Structure (PBS) — Fullscreen Expand, Custom PDF Field Selector &amp; Hardened Sync:</strong> Open <strong>PBS</strong> on any project row in <strong>Setup &amp; Data &rarr; Projects</strong>, toggle <strong>Expand / Restore</strong> for near-full-screen editing on desktop, and open <strong>PDF Report</strong> to pick the exact Core and Optional fields (with quick presets such as <em>All Populated</em>, <em>Current View</em>, <em>Core Only</em>, <em>Docs</em>, <em>Procurement</em>, and <em>SWaP &amp; Spares</em>) to include in your exported PDF. Separate <code class="px-1 rounded bg-white font-mono">pbs_&lt;CODE&gt;.json</code> files reuse the session passphrase, migrate automatically when project codes are renamed, re-encrypt on password rotation, and support folder auto-sync with conflict merge.</li>
                <li>&bull; <strong>Universal Delete Confirmations:</strong> Every delete and destructive reset action across Roadmap, Team Health, Setup &amp; Data, Sync &amp; Snapshots, Finance Vault, Users, and PBS now requires explicit confirmation before removing data.</li>
                <li>&bull; <strong>Roadmap Auto-Bullet Notes, Accurate Encryption Badges &amp; Mobile Polish:</strong> Type <code class="px-1 rounded bg-white font-mono">- </code> in Roadmap notes for automatic WhatsApp-style bullet lists with clean formatted rendering, rely on accurate <em>Encrypted</em> vs <em>Live</em> header badges, and enjoy a modernized Sync Hub and tighter responsive layouts for mobile screens and permission cards.</li>
              </ul>
            </div>
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div class="font-bold text-slate-900">Earlier Foundation Highlights (v8.4-secure)</div>
              <ul class="space-y-1 text-slate-600 leading-relaxed">
                <li>&bull; <strong>Transparent AES-256-GCM JSON Encryption:</strong> Linked shared <code class="px-1 rounded bg-white font-mono">.json</code> files, folder backups, and <strong>Share / Save JSON</strong> exports encrypt automatically with PBKDF2-SHA-256 (250k iterations) and configurable inactivity auto-lock.</li>
                <li>&bull; <strong>Supply-Chain &amp; HTML5 Hardening:</strong> Verified SHA-384 Subresource Integrity hashes on CDN scripts, deduplicated single-shell PWA cache, preserved <code class="px-1 rounded bg-white font-mono">&lt;nav&gt;</code> landmark, and automated CI/CD verification.</li>
                <li>&bull; <strong>Planning Intelligence &amp; iCalendar (.ics) Export:</strong> Milestone Dependencies with an interactive Critical Path SVG diagram, Resource Leveling / Auto-Balance suggestions, Executive Diff Summary before What-If commits, and <code class="px-1 rounded bg-white font-mono">.ics</code> calendar exports.</li>
                <li>&bull; <strong>MS Project XML Milestone Import &amp; Monitor:</strong> Link or import Microsoft Project <code class="px-1 rounded bg-white font-mono">.xml</code> files per project in <strong>Setup &amp; Data &rarr; Projects</strong> with milestone selection and optional auto-apply updates in Chrome/Edge.</li>
                <li>&bull; <strong>Owners &amp; Technical Leads Directory + Bulk Actions:</strong> Manage Project Owners and Technical Leads in <strong>Setup &amp; Data</strong> with dropdown pickers and multi-select checkboxes for bulk delete and archive.</li>
              </ul>
            </div>
          </div>`,
      });
    }

    function ppExportMilestonesIcs() {
      const db = typeof ppIntelGetDb === 'function' ? ppIntelGetDb() : (typeof getActiveDB === 'function' ? getActiveDB() : null);
      const msList = (db && Array.isArray(db.milestones)) ? db.milestones.filter(m => m && m.date) : [];
      if (msList.length === 0) {
        if (typeof showToast === 'function') showToast('No dated milestones to export.', 'info');
        return;
      }
      const projMap = new Map((db.projects || []).map(p => [p.id, p]));
      const escIcs = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
      const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//PulsePlanSecure//Roadmap Milestones//EN',
        'CALSCALE:GREGORIAN',
      ];
      msList.forEach(m => {
        const dt = String(m.date).replace(/-/g, '');
        const p = projMap.get(m.projectId);
        const summary = p ? `[${p.code}] ${m.title}` : m.title;
        const desc = `Status: ${m.status || 'Pending'}${m.notes ? ' | ' + m.notes : ''}`;
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${m.id || dt}@pulseplansecure`);
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(`DTSTART;VALUE=DATE:${dt}`);
        lines.push(`SUMMARY:${escIcs(summary)}`);
        lines.push(`DESCRIPTION:${escIcs(desc)}`);
        lines.push('END:VEVENT');
      });
      lines.push('END:VCALENDAR');

      const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pulseplan_milestones_${new Date().toISOString().slice(0, 10)}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (typeof showToast === 'function') {
        showToast(`Exported ${msList.length} milestone(s) to .ics calendar file.`, 'success');
      }
    }

    function ppRenderCriticalPathSvg() {
      const cpBox = document.getElementById('ppIntelCriticalPathBox');
      if (!cpBox || typeof ppIntelGetDb !== 'function' || typeof ppIntelComputeCriticalPath !== 'function') return;
      const db = ppIntelGetDb();
      const msList = (db && Array.isArray(db.milestones)) ? db.milestones : [];
      if (msList.length === 0) return;
      const { criticalPathIds, conflicts } = ppIntelComputeCriticalPath(db);
      const conflictSet = new Set(conflicts.map(c => `${c.pred.id}->${c.succ.id}`));

      const sorted = msList.slice().sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
      const nodeW = 148;
      const gap = 36;
      const svgW = Math.max(360, sorted.length * (nodeW + gap) + 24);
      const svgH = 92;
      const posMap = new Map();
      sorted.forEach((m, i) => {
        posMap.set(m.id, { x: 12 + i * (nodeW + gap), y: 24 });
      });

      let edgesSvg = '';
      sorted.forEach(m => {
        const to = posMap.get(m.id);
        (Array.isArray(m.dependsOn) ? m.dependsOn : []).forEach(pid => {
          const from = posMap.get(pid);
          if (!from || !to) return;
          const isConf = conflictSet.has(`${pid}->${m.id}`);
          const isCrit = criticalPathIds.includes(pid) && criticalPathIds.includes(m.id);
          const stroke = isConf ? '#e11d48' : (isCrit ? '#4f46e5' : '#94a3b8');
          const x1 = from.x + nodeW;
          const y1 = from.y + 22;
          const x2 = to.x;
          const y2 = to.y + 22;
          const midX = (x1 + x2) / 2;
          edgesSvg += `<path d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}" fill="none" stroke="${stroke}" stroke-width="${isCrit || isConf ? 2.2 : 1.5}" />`;
        });
      });

      let nodesSvg = '';
      sorted.forEach(m => {
        const p = posMap.get(m.id);
        const isCrit = criticalPathIds.includes(m.id);
        const fill = isCrit ? '#eef2ff' : '#ffffff';
        const stroke = isCrit ? '#4f46e5' : '#cbd5e1';
        const label = String(m.title || '').slice(0, 18);
        nodesSvg += `
          <g transform="translate(${p.x},${p.y})">
            <rect width="${nodeW}" height="44" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${isCrit ? 2 : 1.2}" />
            <text x="10" y="18" font-size="11" font-weight="700" fill="#0f172a">${label}</text>
            <text x="10" y="34" font-size="10" fill="#64748b">${m.date || 'No date'}</text>
          </g>`;
      });

      const oldSvg = document.getElementById('ppCriticalPathSvgWrap');
      if (oldSvg) oldSvg.remove();
      const wrap = document.createElement('div');
      wrap.id = 'ppCriticalPathSvgWrap';
      wrap.className = 'overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/70 p-2';
      wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Milestone critical path dependency diagram">${edgesSvg}${nodesSvg}</svg>`;
      cpBox.prepend(wrap);
    }

    function ppUpdateHeaderShieldBadge() {
      const badge = document.getElementById('ppHeaderShieldBtn');
      if (!badge) return;
      const active = typeof ppSyncPassphrase === 'string' && ppSyncPassphrase.length >= 8;
      badge.className = active
        ? 'hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold transition cursor-pointer shrink-0'
        : 'hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-semibold hover:bg-slate-200 transition cursor-pointer shrink-0';
      badge.title = active
        ? 'Database Encryption: AES-256-GCM Active (click to manage)'
        : 'Database Encryption: Plaintext (click to enable AES-256-GCM)';
      const lbl = document.getElementById('ppHeaderShieldLabel');
      if (lbl) lbl.textContent = active ? 'Encrypted' : 'Plain';
    }

    function initVisualPolishUI() {
      if (typeof document === 'undefined' || !document.body) return;

      // 1. Header Security Shield Badge next to <h1> (desktop only; mobile uses #mobileHeaderModeChip to avoid crowding)
      const h1 = typeof document.querySelector === 'function' ? document.querySelector('header h1') : null;
      if (h1 && h1.parentElement && !document.getElementById('ppHeaderShieldBtn')) {
        const btn = document.createElement('button');
        btn.id = 'ppHeaderShieldBtn';
        btn.type = 'button';
        btn.innerHTML = `
          <svg class="w-3 h-3 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span id="ppHeaderShieldLabel">Plain</span>`;
        btn.addEventListener('click', () => {
          const isNamed = typeof ppIsNamedUser === 'function'
            ? ppIsNamedUser()
            : (typeof ppIsStandardUser === 'function' && ppIsStandardUser());
          if (isNamed) {
            if (typeof openUserSwitcherModal === 'function') openUserSwitcherModal();
            return;
          }
          if (typeof openSyncEncryptionDialog === 'function') openSyncEncryptionDialog();
        });
        h1.parentElement.appendChild(btn);
        ppUpdateHeaderShieldBadge();
      }

      // 2. Hook updateSyncEncryptionBadges and renderAll so the header shield always stays in sync
      if (typeof updateSyncEncryptionBadges === 'function' && !updateSyncEncryptionBadges.__ppShieldWrapped) {
        const origUpdate = updateSyncEncryptionBadges;
        updateSyncEncryptionBadges = function (...args) {
          origUpdate.apply(this, args);
          ppUpdateHeaderShieldBadge();
        };
        updateSyncEncryptionBadges.__ppShieldWrapped = true;
      }
      if (typeof renderAll === 'function' && !renderAll.__ppShieldWrapped) {
        const origRenderAll = renderAll;
        renderAll = function (...args) {
          const res = origRenderAll.apply(this, args);
          ppUpdateHeaderShieldBadge();
          return res;
        };
        renderAll.__ppShieldWrapped = true;
      }

      // 3. Hook renderPlanningIntelligenceDialog so the Critical Path SVG renders automatically
      if (typeof renderPlanningIntelligenceDialog === 'function' && !renderPlanningIntelligenceDialog.__ppSvgWrapped) {
        const origRenderIntel = renderPlanningIntelligenceDialog;
        renderPlanningIntelligenceDialog = function (...args) {
          origRenderIntel.apply(this, args);
          ppRenderCriticalPathSvg();
        };
        renderPlanningIntelligenceDialog.__ppSvgWrapped = true;
      }

      // 4. Wire or inject "Export Milestones (.ics)" button inside the Sync tab
      const existingIcsBtn = document.getElementById('ppExportIcsBtn');
      if (existingIcsBtn) {
        if (!existingIcsBtn.__ppIcsWired) {
          existingIcsBtn.__ppIcsWired = true;
          existingIcsBtn.addEventListener('click', ppExportMilestonesIcs);
        }
      } else {
        const encBar = document.getElementById('ppSyncTabEncBar');
        if (encBar) {
          const icsBtn = document.createElement('button');
          icsBtn.id = 'ppExportIcsBtn';
          icsBtn.type = 'button';
          icsBtn.className = 'px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold transition cursor-pointer';
          icsBtn.textContent = 'Export Milestones (.ics)';
          icsBtn.addEventListener('click', ppExportMilestonesIcs);
          encBar.appendChild(icsBtn);
        }
      }
    }

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVisualPolishUI);
      } else {
        initVisualPolishUI();
      }
    }
