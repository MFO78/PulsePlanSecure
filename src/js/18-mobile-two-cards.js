/* Native mobile cards, with an optional aligned two-period window. */
(function ppTwoCards() {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function' || typeof document.createElement !== 'function' || typeof syncMobileControlsUI !== 'function' || typeof renderMobileMatrixCards !== 'function') return;
  const preferenceKey = 'pulseplan_secure_mobile_layout_v1';
  const modes = ['grid', 'cards', 'cards2'];
  const nativeSync = syncMobileControlsUI;
  const nativeRender = renderMobileMatrixCards;
  const nativeRows = getMobileVisibleRows;
  const nativeCollapse = toggleMobileCollapseAll;
  const nativeUpdateCollapse = updateMobileCollapseAllButton;
  let restored = false;
  let pairedRows = [];
  const boundDecks = new WeakSet();
  const css = document.createElement('style');
  css.textContent = `
#pp-mobile-layout { width: 4.75rem; max-width: 4.75rem; min-width: 0; height: 2.25rem; padding: .25rem; border: 1px solid #cbd5e1; border-radius: .65rem; background: #fff; color: #334155; font-size: 11px; font-weight: 700; flex: 0 0 auto; }
#pp-mobile-layout[hidden] { display: none; }
.dark #pp-mobile-layout { background: #172334; color: #f1f5f9; border-color: #475569; }
#pp-mobile-layout:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
.pp-period-pair, .pp-period-row { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .5rem; align-items: start; min-width: 0; }
.pp-period-row { grid-column: 1 / -1; }
.pp-period-column { min-width: 0; max-width: 100%; }
.pp-period-column :where(div,section,article,details,summary) { min-width: 0; max-width: 100%; }
.pp-period-column :where(h2,h3,h4,p) { overflow-wrap: anywhere; }
.pp-period-column :where(button,input,select,textarea) { max-width: 100%; box-sizing: border-box; }
.pp-period-column button { white-space: normal; overflow-wrap: anywhere; }
.pp-period-column > details { margin: 0; }
.pp-pair-controls { grid-column: 1 / -1; }
@media (max-width: 767px) {
  .pp-layout-header > :first-child { flex: 1 1 0%; min-width: 0; }
  .pp-layout-brand-copy { flex: 1 1 auto; min-width: 0; }
  .pp-layout-brand-copy h1 { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .pp-layout-brand-copy #mobileHeaderModeChip { flex-shrink: 0; }
}
@media (min-width: 768px) { #pp-mobile-layout { display: none; } }
`;
  document.head.appendChild(css);
  function inPeriod(pk, callback) {
    const field = ui.timeUnit === 'month' ? 'startMonth' : 'startWeek';
    const savedStart = ui[field];
    const savedPeriod = ui.mobileSelectedPeriod;
    try {
      if (!getVisiblePeriods().includes(pk)) ui[field] = pk;
      ui.mobileSelectedPeriod = pk;
      return callback();
    } finally { ui[field] = savedStart; ui.mobileSelectedPeriod = savedPeriod; }
  }
  function withPairedRows(callback) {
    const previous = getMobileVisibleRows;
    try {
      if (ui.mobileLayoutMode === 'cards2' && pairedRows.length) getMobileVisibleRows = () => pairedRows;
      return callback();
    } finally { getMobileVisibleRows = previous; }
  }
  toggleMobileCollapseAll = function() { return withPairedRows(() => nativeCollapse()); };
  updateMobileCollapseAllButton = function() { return withPairedRows(() => nativeUpdateCollapse()); };
  syncMobileControlsUI = function(db) {
    if (!restored) {
      const saved = safeGetStorage(preferenceKey);
      if (modes.includes(saved)) ui.mobileLayoutMode = saved;
      restored = true;
    }
    nativeSync(db);
    const toggle = document.getElementById('mobileLayoutToggleBtn');
    if (!toggle) return;
    let select = document.getElementById('pp-mobile-layout');
    if (!select) {
      select = document.createElement('select'); select.id = 'pp-mobile-layout';
      select.setAttribute('aria-label', 'Mobile roadmap layout');
      [['grid','Grid'],['cards','Card'],['cards2','2 cards']].forEach(([value,label]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
      });
      select.addEventListener('change', () => {
        ui.mobileLayoutMode = select.value;
        safeSetStorage(preferenceKey, select.value); persistUIPrefs(); renderAll();
      });
      toggle.insertAdjacentElement('afterend', select);
      const header = toggle.closest('header');
      const bar = header && header.firstElementChild;
      if (bar) {
        bar.classList.add('pp-layout-header');
        const brand = bar.firstElementChild;
        if (brand && brand.children[1]) brand.children[1].classList.add('pp-layout-brand-copy');
      }
    }
    toggle.hidden = true; toggle.style.display = 'none';
    select.hidden = ui.activeTab !== 'matrix';
    select.value = modes.includes(ui.mobileLayoutMode) ? ui.mobileLayoutMode : 'cards';
  };
  function bindNativeSwipe(deck) {
    if (boundDecks.has(deck)) return;
    boundDecks.add(deck);
    let active = false;
    deck.addEventListener('touchstart', event => {
      if (ui.mobileLayoutMode !== 'cards2') return;
      event.stopImmediatePropagation();
      const target = event.target;
      active = event.touches.length === 1 && !(target && target.closest && target.closest('input,textarea,select,button,.snap-x'));
      if (active) handleMobileDeckTouchStart(event);
    }, { capture: true, passive: true });
    deck.addEventListener('touchend', event => {
      if (ui.mobileLayoutMode !== 'cards2') return;
      event.stopImmediatePropagation();
      if (active) handleMobileDeckTouchEnd(event);
      active = false;
    }, { capture: true, passive: true });
    deck.addEventListener('touchcancel', () => { active = false; }, { passive: true });
  }
  function rowId(details) {
    const match = (details.getAttribute('ontoggle') || '').match(/onMobileAccordionToggle\(\s*(['"])(.*?)\1/);
    return match ? match[2] : null;
  }
  function namespaceIds(root) {
    const ids = new Map();
    root.querySelectorAll('[id]').forEach(node => { const old = node.id; node.id = 'pp-second-' + old; ids.set(old,node.id); });
    root.querySelectorAll('*').forEach(node => {
      ['for','aria-controls','aria-labelledby','aria-describedby'].forEach(attr => {
        if (node.hasAttribute(attr)) node.setAttribute(attr,node.getAttribute(attr).split(/\s+/).map(id => ids.get(id) || id).join(' '));
      });
      const href = node.getAttribute('href');
      if (href && href[0] === '#' && ids.has(href.slice(1))) node.setAttribute('href','#' + ids.get(href.slice(1)));
    });
  }
  renderMobileMatrixCards = function() {
    if (!isMobileViewport() || ui.mobileLayoutMode !== 'cards2') { pairedRows = []; return nativeRender(); }
    const deck = document.getElementById('mobileMatrixDeck');
    if (!deck) return;
    bindNativeSwipe(deck);
    const anchor = getMobileSelectedPeriod();
    const next = ui.timeUnit === 'month' ? addMonthsToMonthKey(anchor,1) : addWeeksToWeekKey(anchor,1);
    const periods = [anchor,next];
    if (ui.axis === 'timeline') {
      const horizon = ui.horizon;
      try { ui.horizon = 2; return inPeriod(anchor, () => nativeRender()); }
      finally { ui.horizon = horizon; }
    }
    const db = getActiveDB();
    const ids = new Set();
    periods.forEach(pk => inPeriod(pk, () => nativeRows(db).forEach(row => ids.add(row.id))));
    const entities = ui.axis === 'department' ? db.departments : getSortedProjects(db);
    pairedRows = entities.filter(row => ids.has(row.id));
    const previousNodes = document.createDocumentFragment();
    while (deck.firstChild) previousNodes.appendChild(deck.firstChild);
    const pair = document.createElement('div'); pair.className = 'pp-period-pair';
    const columns = [];
    let strip = null;
    try {
      periods.forEach((pk,index) => {
        inPeriod(pk, () => withPairedRows(() => nativeRender()));
        const column = document.createElement('section'); column.className = 'pp-period-column space-y-3';
        column.setAttribute('aria-label',formatPeriodHeader(pk,ui.timeUnit).title);
        while (deck.firstChild) column.appendChild(deck.firstChild);
        const pill = column.querySelector('[data-mobile-period-pill]');
        const periodStrip = pill && (pill.closest('.snap-x') || pill.parentElement);
        if (periodStrip && column.contains(periodStrip)) {
          if (!index) { strip = periodStrip; periodStrip.remove(); }
          else periodStrip.remove();
        }
        column.querySelectorAll('button[onclick]').forEach(button => {
          const handler = button.getAttribute('onclick');
          if (/shiftMobileSelectedPeriod|shiftStartByInterval|shiftStartPeriod/.test(handler) || (index && handler.includes('toggleMobileCollapseAll'))) button.remove();
        });
        if (index) namespaceIds(column);
        columns.push(column); pair.appendChild(column);
      });
      const maps = columns.map(column => {
        const map = new Map();
        column.querySelectorAll('details[ontoggle]').forEach(node => { const id = rowId(node); if (id) map.set(id,node); });
        return map;
      });
      const canAlign = pairedRows.every(row => maps.every(map => map.has(row.id)));
      if (!canAlign && pairedRows.length) throw new Error('Native card row identifiers could not be matched for paired layout');
      const collapse = columns[0].querySelector('#mobileCollapseAllBtn');
      if (collapse) { const controls = document.createElement('div'); controls.className = 'pp-pair-controls'; controls.appendChild(collapse); pair.appendChild(controls); }
      pairedRows.forEach(entity => {
        const row = document.createElement('div'); row.className = 'pp-period-row';
        row.setAttribute('role','group'); row.setAttribute('aria-label',entity.name);
        const cards = maps.map(map => map.get(entity.id));
        cards.forEach((card,index) => {
          const cell = document.createElement('div'); cell.className = 'pp-period-column';
          cell.setAttribute('aria-label',columns[index].getAttribute('aria-label'));
          cell.appendChild(card); row.appendChild(cell);
          card.addEventListener('toggle', () => {
            cards.forEach(other => { if (other !== card && other.open !== card.open) other.open = card.open; });
          });
        });
        pair.appendChild(row);
      });
      deck.replaceChildren();
      if (strip) deck.appendChild(strip);
      deck.appendChild(pair);
      updateMobileCollapseAllButton();
    } catch (error) {
      deck.replaceChildren(previousNodes);
      throw error;
    }
  };
})();
