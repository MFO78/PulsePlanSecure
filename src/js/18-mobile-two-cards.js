/* Independent paired-period mobile layout; existing renderers remain available. */
(function ppTwoCards() {
  if (typeof document === 'undefined' || typeof syncMobileControlsUI !== 'function' || typeof renderMobileMatrixCards !== 'function') return;
  const key = 'pulseplan_secure_mobile_layout_v1';
  const modes = ['grid', 'cards', 'cards2'];
  let restored = false;
  const originalSync = syncMobileControlsUI;
  const originalCards = renderMobileMatrixCards;
  const css = document.createElement('style');
  css.textContent = `
#pp-mobile-layout { max-width: 100%; min-height: 44px; padding: .25rem .4rem; border: 1px solid currentColor; border-radius: .6rem; background: transparent; font-size: .75rem; }
#pp-mobile-layout option { color: #0f172a; background: #fff; }
.pp-pair-root { --pair-bg: #fff; --pair-ink: #0f172a; --pair-border: #cbd5e1; color: var(--pair-ink); min-width: 0; }
.pp-pair-root[data-dark=true] { --pair-bg: #172334; --pair-ink: #f1f5f9; --pair-border: #475569; }
.pp-pair-nav { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-bottom: .75rem; }
.pp-pair-nav h2 { flex: 1 1 8rem; font-weight: 700; }
.pp-pair-nav button, .pp-period-card button { min-height: 44px; padding: .4rem .5rem; border: 1px solid var(--pair-border); border-radius: .6rem; background: var(--pair-bg); color: inherit; }
.pp-pair-row { margin-bottom: 1rem; min-width: 0; }
.pp-pair-row > h3 { font-weight: 700; margin-bottom: .4rem; overflow-wrap: anywhere; }
.pp-period-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; min-width: 0; }
.pp-period-card { min-width: 0; padding: .65rem; border: 1px solid var(--pair-border); border-radius: .8rem; background: var(--pair-bg); overflow-wrap: anywhere; }
.pp-period-card h4 { font-weight: 700; margin-bottom: .5rem; }
.pp-period-card p { font-size: .8rem; margin-bottom: .4rem; }
.pp-period-card button { width: 100%; white-space: normal; font-size: .75rem; }
.pp-pair-root button:focus-visible, #pp-mobile-layout:focus-visible { outline: 3px solid #0d9488; outline-offset: 2px; }
@media (min-width: 768px) { #pp-mobile-layout { display: none; } }
`;
  document.head.appendChild(css);
  function nextPeriod(pk, delta) {
    return ui.timeUnit === 'month' ? addMonthsToMonthKey(pk, delta) : addWeeksToWeekKey(pk, delta);
  }
  syncMobileControlsUI = function(db) {
    if (!restored) {
      const saved = safeGetStorage(key);
      if (modes.includes(saved)) ui.mobileLayoutMode = saved;
      restored = true;
    }
    originalSync(db);
    const toggle = document.getElementById('mobileLayoutToggleBtn');
    if (!toggle) return;
    let select = document.getElementById('pp-mobile-layout');
    if (!select) {
      select = document.createElement('select');
      select.id = 'pp-mobile-layout';
      select.setAttribute('aria-label', 'Mobile roadmap layout');
      [['grid', 'Grid'], ['cards', 'Card'], ['cards2', '2 cards']].forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value; option.textContent = text; select.appendChild(option);
      });
      select.addEventListener('change', () => {
        ui.mobileLayoutMode = select.value;
        safeSetStorage(key, select.value);
        persistUIPrefs();
        renderAll();
      });
      toggle.insertAdjacentElement('afterend', select);
    }
    toggle.hidden = true;
    toggle.style.display = 'none';
    select.hidden = ui.activeTab !== 'matrix';
    select.value = modes.includes(ui.mobileLayoutMode) ? ui.mobileLayoutMode : 'cards';
  };
  renderMobileMatrixCards = function() {
    if (!isMobileViewport() || ui.mobileLayoutMode !== 'cards2') return originalCards();
    const deck = document.getElementById('mobileMatrixDeck');
    if (!deck) return;
    const db = getActiveDB();
    const anchor = getMobileSelectedPeriod();
    const pair = [anchor, nextPeriod(anchor, 1)];
    const originalPeriod = ui.mobileSelectedPeriod;
    const rows = new Map();
    try {
      pair.forEach(pk => {
        ui.mobileSelectedPeriod = pk;
        if (getVisiblePeriods().includes(pk)) {
          getMobileVisibleRows(db).forEach(row => rows.set(row.id, row));
        } else {
          const field = ui.timeUnit === 'month' ? 'startMonth' : 'startWeek';
          const oldStart = ui[field];
          try { ui[field] = pk; getMobileVisibleRows(db).forEach(row => rows.set(row.id, row)); }
          finally { ui[field] = oldStart; }
        }
      });
    } finally { ui.mobileSelectedPeriod = originalPeriod; }
    const deptAxis = ui.axis === 'department';
    const html = Array.from(rows.values()).map(row => {
      const cards = pair.map(pk => {
        const header = formatPeriodHeader(pk, ui.timeUnit);
        const fte = deptAxis ? getDeptTotalAllocatedFte(row.id, pk, ui.timeUnit, db) : getProjTotalAllocatedFte(row.id, pk, ui.timeUnit, db);
        const amount = formatValue(fteToDisplayValue(fte, pk, ui.timeUnit));
        const unit = ui.manpowerUnit === 'days' ? 'days' : ui.manpowerUnit === 'hours' ? 'hours' : 'FTE';
        const notes = getCellTotalCommentCount(row.id, pk, deptAxis ? 'department' : 'project', ui.timeUnit, db);
        let capacity = '';
        if (deptAxis) {
          const cap = getDeptCapacityForPeriod(row.id, pk, ui.timeUnit, db).avgFte;
          const pct = cap > 0 ? Math.round(fte / cap * 100) + '%' : fte > 0 ? 'Over capacity' : 'No capacity';
          capacity = '<p>' + escapeHtml(pct) + ' utilisation</p>';
        }
        return '<article class="pp-period-card"><h4>' + escapeHtml(header.title) + '</h4><p>' + escapeHtml(amount + ' ' + unit) + '</p>' + capacity + '<p>' + notes + ' notes</p><button type="button" data-pair-row="' + escapeHtml(row.id) + '" data-pair-period="' + escapeHtml(pk) + '" aria-label="' + escapeHtml('Details and edit: ' + row.name + ', ' + header.title) + '">Details / edit</button></article>';
      }).join('');
      return '<section class="pp-pair-row" aria-label="' + escapeHtml(row.name) + '"><h3>' + escapeHtml('[' + row.code + '] ' + row.name) + '</h3><div class="pp-period-pair">' + cards + '</div></section>';
    }).join('');
    deck.innerHTML = '<div class="pp-pair-root" data-dark="' + Boolean(ui.darkMode) + '"><div class="pp-pair-nav"><h2>Two-period cards</h2><button type="button" data-pair-step="-2" aria-label="Previous two periods">Previous</button><button type="button" data-pair-step="2" aria-label="Next two periods">Next</button></div>' + (html || '<p>No rows match your filters. Adjust filters in View or add departments and projects in Setup.</p>') + '</div>';
    const status = document.getElementById('matrixStatusStrip');
    if (status) { status.classList.add('hidden'); status.innerHTML = ''; }
    deck.querySelectorAll('[data-pair-step]').forEach(button => button.addEventListener('click', () => {
      const pk = nextPeriod(anchor, Number(button.dataset.pairStep));
      ui[ui.timeUnit === 'month' ? 'startMonth' : 'startWeek'] = pk;
      ui.mobileSelectedPeriod = pk;
      persistUIPrefs();
      renderAll();
    }));
    deck.querySelectorAll('[data-pair-row]').forEach(button => button.addEventListener('click', () => {
      openCellDetailModal(button.dataset.pairRow, button.dataset.pairPeriod);
    }));
  };
})();
