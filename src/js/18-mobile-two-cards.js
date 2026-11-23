/* Paired layout reuses the native card renderer and its event handlers. */
(function ppTwoCards() {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function' || typeof document.createElement !== 'function' || typeof syncMobileControlsUI !== 'function' || typeof renderMobileMatrixCards !== 'function') return;
  const key = 'pulseplan_secure_mobile_layout_v1';
  const modes = ['grid', 'cards', 'cards2'];
  const nativeSync = syncMobileControlsUI;
  const nativeCards = renderMobileMatrixCards;
  let restored = false;
  const css = document.createElement('style');
  css.textContent = `
#pp-mobile-layout { display: inline-flex; align-items: center; padding: 2px; gap: 2px; border: 1px solid rgba(100,116,139,.3); border-radius: .6rem; max-width: 100%; }
#pp-mobile-layout[hidden] { display: none; }
#pp-mobile-layout button { min-height: 32px; padding: .2rem .45rem; border-radius: .4rem; font-size: 11px; font-weight: 700; line-height: 1.2; white-space: nowrap; }
#pp-mobile-layout button[aria-pressed=true] { background: #065f46; color: #fff; }
#pp-mobile-layout button:focus-visible, .pp-native-pair-nav button:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
.pp-native-pair-nav { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .35rem; margin-bottom: .5rem; }
.pp-native-pair-nav button { min-height: 36px; padding: .3rem .6rem; border: 1px solid rgba(100,116,139,.3); border-radius: .6rem; font-size: .75rem; }
.pp-native-pair { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); align-items: start; gap: .5rem; min-width: 0; }
.pp-native-column { min-width: 0; max-width: 100%; }
.pp-native-column > h2 { font-size: .75rem; font-weight: 800; margin-bottom: .5rem; overflow-wrap: anywhere; }
.pp-native-column :where(div, section, article, details, summary) { min-width: 0; max-width: 100%; }
.pp-native-column :where(p, span, h2, h3, h4) { overflow-wrap: anywhere; }
.pp-native-column .flex { flex-wrap: wrap; }
.pp-native-column .shrink-0 { max-width: 100%; }
.pp-native-column :where(button, input, select, textarea) { max-width: 100%; box-sizing: border-box; }
.pp-native-column button { white-space: normal; overflow-wrap: anywhere; }
.pp-native-column :where(.p-3, .p-3\\.5, .p-4) { padding: .5rem; }
@media (min-width: 768px) { #pp-mobile-layout { display: none; } }
`;
  document.head.appendChild(css);
  const advance = (pk, delta) => ui.timeUnit === 'month' ? addMonthsToMonthKey(pk, delta) : addWeeksToWeekKey(pk, delta);
  syncMobileControlsUI = function(db) {
    if (!restored) {
      const saved = safeGetStorage(key);
      if (modes.includes(saved)) ui.mobileLayoutMode = saved;
      restored = true;
    }
    nativeSync(db);
    const toggle = document.getElementById('mobileLayoutToggleBtn');
    if (!toggle) return;
    let group = document.getElementById('pp-mobile-layout');
    if (!group) {
      group = document.createElement('div');
      group.id = 'pp-mobile-layout';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Mobile roadmap layout');
      [['grid','Grid'],['cards','Card'],['cards2','2 cards']].forEach(([mode, label]) => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label; button.dataset.layout = mode;
        button.addEventListener('click', () => {
          ui.mobileLayoutMode = mode;
          safeSetStorage(key, mode); persistUIPrefs(); renderAll();
        });
        group.appendChild(button);
      });
      toggle.insertAdjacentElement('afterend', group);
    }
    toggle.hidden = true; toggle.style.display = 'none';
    group.hidden = ui.activeTab !== 'matrix';
    group.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layout === ui.mobileLayoutMode)));
  };
  function namespaceIds(root, prefix) {
    const ids = new Map();
    root.querySelectorAll('[id]').forEach(el => { const old = el.id; el.id = prefix + old; ids.set(old, el.id); });
    root.querySelectorAll('*').forEach(el => {
      ['for','aria-controls','aria-labelledby','aria-describedby','aria-owns'].forEach(attr => {
        if (el.hasAttribute(attr)) el.setAttribute(attr, el.getAttribute(attr).split(/\s+/).map(id => ids.get(id) || id).join(' '));
      });
      const href = el.getAttribute('href');
      if (href && href[0] === '#' && ids.has(href.slice(1))) el.setAttribute('href', '#' + ids.get(href.slice(1)));
    });
  }
  renderMobileMatrixCards = function() {
    if (!isMobileViewport() || ui.mobileLayoutMode !== 'cards2') return nativeCards();
    const deck = document.getElementById('mobileMatrixDeck');
    if (!deck) return;
    const anchor = getMobileSelectedPeriod();
    const field = ui.timeUnit === 'month' ? 'startMonth' : 'startWeek';
    const saved = { start: ui[field], horizon: ui.horizon, selected: ui.mobileSelectedPeriod };
    if (ui.axis === 'timeline') {
      try { ui[field] = anchor; ui.horizon = 2; return nativeCards(); }
      finally { ui[field] = saved.start; ui.horizon = saved.horizon; ui.mobileSelectedPeriod = saved.selected; }
    }
    const oldNodes = document.createDocumentFragment();
    while (deck.firstChild) oldNodes.appendChild(deck.firstChild);
    const pair = document.createElement('div'); pair.className = 'pp-native-pair';
    try {
      [anchor, advance(anchor, 1)].forEach((pk, index) => {
        ui[field] = pk; ui.horizon = 1; ui.mobileSelectedPeriod = pk;
        nativeCards();
        const column = document.createElement('section'); column.className = 'pp-native-column space-y-3';
        const title = document.createElement('h2'); title.textContent = formatPeriodHeader(pk, ui.timeUnit).title;
        column.setAttribute('aria-label', title.textContent); column.appendChild(title);
        while (deck.firstChild) column.appendChild(deck.firstChild);
        column.querySelectorAll('[data-mobile-period-pill]').forEach(pill => {
          const strip = pill.closest('.snap-x');
          if (strip && column.contains(strip)) strip.remove(); else pill.remove();
        });
        column.querySelectorAll('button[onclick]').forEach(button => {
          if (/shiftMobileSelectedPeriod|shiftStartByInterval|shiftStartPeriod/.test(button.getAttribute('onclick'))) button.remove();
        });
        if (index === 1) namespaceIds(column, 'pp-second-');
        pair.appendChild(column);
      });
    } catch (error) {
      deck.replaceChildren(oldNodes); throw error;
    } finally {
      ui[field] = saved.start; ui.horizon = saved.horizon; ui.mobileSelectedPeriod = saved.selected;
    }
    const nav = document.createElement('div'); nav.className = 'pp-native-pair-nav';
    [[-2,'Previous'],[2,'Next']].forEach(([delta, label]) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-label', label + ' two periods');
      button.addEventListener('click', () => {
        const pk = advance(anchor, delta); ui[field] = pk; ui.mobileSelectedPeriod = pk;
        persistUIPrefs(); renderAll();
      });
      nav.appendChild(button);
    });
    deck.replaceChildren(nav, pair);
  };
})();
