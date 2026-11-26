    /* ============================================================================
     * 15. PULSEPLANSECURE: VISUAL POLISH & CONTENT ENHANCEMENTS
     *     - Header Security Shield Status Badge (desktop/tablet to prevent mobile overlap)
     *     - Interactive Critical Path SVG Diagram
     *     - iCalendar (.ics) Milestone Export
     *     - In-App Changelog ("What's New") in User Manual
     * ============================================================================ */

    if (typeof MANUAL_SECTIONS !== 'undefined' && Array.isArray(MANUAL_SECTIONS)) {
      MANUAL_SECTIONS.push({
        id: 'whatsnew',
        title: "What's New in PulsePlanSecure v8.4-secure",
        badge: "What's New",
        keywords: 'changelog release notes whats new v8.4 secure sri encryption critical path leveling ics calendar badge',
        bodyHtml: `
          <div class="space-y-2.5">
            <div class="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-1.5">
              <div class="font-bold text-indigo-950">v8.4-secure Highlights</div>
              <ul class="space-y-1 text-slate-700 leading-relaxed">
                <li>&bull; <strong>Transparent AES-256-GCM JSON Encryption:</strong> Linked shared <code class="px-1 rounded bg-white font-mono">.json</code> files, folder backups, and <strong>Share / Save JSON</strong> exports encrypt automatically with PBKDF2-SHA-256 (250k iterations) and configurable inactivity auto-lock.</li>
                <li>&bull; <strong>Supply-Chain &amp; HTML5 Hardening:</strong> Verified SHA-384 Subresource Integrity hashes on CDN scripts, deduplicated single-shell PWA cache, preserved <code class="px-1 rounded bg-white font-mono">&lt;nav&gt;</code> landmark, and automated CI/CD verification.</li>
                <li>&bull; <strong>Planning Intelligence:</strong> Added Milestone Dependencies with an interactive Critical Path SVG diagram, Resource Leveling / Auto-Balance suggestions, and an Executive Diff Summary before committing from What-If.</li>
                <li>&bull; <strong>iCalendar (.ics) Export &amp; Header Shield:</strong> Export milestones directly to Outlook / Google Calendar / Apple Calendar, and monitor encryption status at a glance from the top header shield badge.</li>
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
      const active = typeof ppSyncPassphrase !== 'undefined' && Boolean(ppSyncPassphrase);
      badge.className = active
        ? 'hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold transition cursor-pointer shrink-0'
        : 'hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-semibold hover:bg-slate-200 transition cursor-pointer shrink-0';
      badge.title = active
        ? 'Sync JSON Encryption: AES-256-GCM Active (click to configure)'
        : 'Sync JSON Encryption: Plaintext (click to enable AES-256-GCM)';
      const lbl = document.getElementById('ppHeaderShieldLabel');
      if (lbl) lbl.textContent = active ? 'AES-256' : 'Plain';
    }

    function initVisualPolishUI() {
      if (typeof document === 'undefined' || !document.body) return;

      // 1. Header Security Shield Badge next to <h1> (hidden on tiny mobile screens to avoid overlapping Install button)
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

      // 2. Hook updateSyncEncryptionBadges so the header shield stays in sync
      if (typeof updateSyncEncryptionBadges === 'function' && !updateSyncEncryptionBadges.__ppShieldWrapped) {
        const origUpdate = updateSyncEncryptionBadges;
        updateSyncEncryptionBadges = function (...args) {
          origUpdate.apply(this, args);
          ppUpdateHeaderShieldBadge();
        };
        updateSyncEncryptionBadges.__ppShieldWrapped = true;
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
