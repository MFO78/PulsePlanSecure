/* Compact header selector and paired-card action controls. */
(function ppCompactMobileControls() {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function' || typeof document.createElement !== 'function' || typeof syncMobileControlsUI !== 'function' || typeof renderMobileMatrixCards !== 'function') return;
  const sync = syncMobileControlsUI;
  const render = renderMobileMatrixCards;
  const css = document.createElement('style');
  css.textContent = `
@media (max-width: 767px) {
  #pp-mobile-layout { font-size: 10px !important; width: calc(7ch + 1.25rem); max-width: none; min-height: 0; height: auto; line-height: 1.2; padding: .125rem 1rem .125rem .25rem; border-radius: .375rem; }
}
.pp-period-pair [class~="p-2"], .pp-period-pair [class~="p-2.5"], .pp-period-pair [class~="p-3"], .pp-period-pair [class~="p-3.5"], .pp-period-pair [class~="p-4"] { padding: .3rem; }
.pp-period-pair [class~="px-2.5"], .pp-period-pair [class~="px-3"] { padding-left: .3rem; padding-right: .3rem; }
.pp-period-pair [class~="gap-2"], .pp-period-pair [class~="gap-2.5"] { gap: .25rem; }
.pp-period-pair button.pp-compact-action { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; min-width: 24px; max-width: 24px; min-height: 24px; padding: 0; font-size: 10px; line-height: 1; white-space: nowrap; overflow-wrap: normal; }
.pp-period-pair .pp-compact-footer { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; }
.pp-period-pair button.pp-compact-footer-button { flex: 0 0 auto; width: auto; min-width: max-content; max-width: none; min-height: 24px; padding: .25rem .35rem; font-size: 10px; line-height: 1.2; white-space: nowrap; overflow-wrap: normal; word-break: normal; }
`;
  document.head.appendChild(css);
  function matchLive() {
    if (!isMobileViewport() || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return;
    const select = document.getElementById('pp-mobile-layout');
    const chip = document.getElementById('mobileHeaderModeChip');
    if (!select || !chip) return;
    const live = window.getComputedStyle(chip);
    ['font-size','font-family','font-weight','line-height','letter-spacing'].forEach(property => {
      const value = live.getPropertyValue(property);
      if (value) select.style.setProperty(property, value, 'important');
    });
    if (typeof chip.getBoundingClientRect === 'function') {
      const height = chip.getBoundingClientRect().height;
      if (height > 0) select.style.setProperty('height', height + 'px');
    }
  }
  syncMobileControlsUI = function(db) { const result = sync(db); matchLive(); return result; };
  function abbreviateActions(pair) {
    pair.querySelectorAll('button').forEach(button => {
      const text = button.textContent.replace(/\s+/g,' ').trim();
      if (!/^actions?[\s.\u22ef\u2026\u00b7]*$/i.test(text)) return;
      button.textContent = 'A';
      button.classList.add('pp-compact-action');
      if (!button.getAttribute('aria-label')) button.setAttribute('aria-label','Actions');
      button.setAttribute('title','Actions');
    });
  }
  function compactFooterButtons(pair) {
    const isFooter = button => button.tagName === 'BUTTON' && /^(?:\+\s*)?allocate$|^capacity$|^notes$/i.test(button.textContent.replace(/\s+/g,' ').trim());
    pair.querySelectorAll('button').forEach(button => {
      if (!isFooter(button)) return;
      button.classList.add('pp-compact-footer-button');
      const parent = button.parentElement;
      if (parent && Array.from(parent.children).every(isFooter)) parent.classList.add('pp-compact-footer');
    });
  }
  renderMobileMatrixCards = function() {
    const result = render();
    if (!isMobileViewport() || ui.mobileLayoutMode !== 'cards2') return result;
    const deck = document.getElementById('mobileMatrixDeck');
    const pair = deck && deck.querySelector('.pp-period-pair');
    if (pair) { abbreviateActions(pair); compactFooterButtons(pair); }
    return result;
  };
})();
