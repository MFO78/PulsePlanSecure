/* Presentation-only density adjustments for paired native cards. */
(function ppPairedCardDensity() {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function' || typeof document.createElement !== 'function' || typeof renderMobileMatrixCards !== 'function') return;
  const nativeRender = renderMobileMatrixCards;
  const style = document.createElement('style');
  style.textContent = `
#pp-mobile-layout { width: 4.1rem; max-width: 4.1rem; height: 1.75rem; padding: .125rem; border-color: transparent; border-radius: .35rem; background: transparent; font-size: 10.5px; font-weight: 600; box-shadow: none; }
.dark #pp-mobile-layout { background: transparent; border-color: transparent; }
#pp-mobile-layout:focus-visible { outline-width: 2px; outline-offset: 1px; }
.pp-period-pair [class~="text-sm"] { font-size: 11px; line-height: 1.3; }
.pp-period-pair [class~="text-xs"] { font-size: 10.5px; line-height: 1.35; }
.pp-period-pair [class~="text-[11px]"] { font-size: 10px; line-height: 1.35; }
.pp-period-pair [class~="p-3"], .pp-period-pair [class~="p-3.5"], .pp-period-pair [class~="p-4"] { padding: .5rem; }
.pp-period-pair [class~="gap-3"] { gap: .375rem; }
.pp-period-pair summary { padding: .4rem .5rem; }
.pp-period-pair summary .truncate { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
.pp-period-pair .pp-density-summary { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: .2rem .3rem; }
.pp-period-pair .pp-density-name { grid-column: 1 / -1; min-width: 0; font-size: 11px; line-height: 1.3; font-weight: 700; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
.pp-period-pair .pp-density-summary [class~="h-8"] { height: 1rem; }
.pp-period-pair .pp-density-milestone-heading { display: flex; flex-direction: column; align-items: stretch; gap: .35rem; }
.pp-period-pair .pp-density-milestone-heading > :first-child { font-size: 10px; letter-spacing: .02em; overflow-wrap: anywhere; }
.pp-period-pair .pp-density-milestone-heading > button { align-self: flex-start; width: auto; max-width: 100%; min-height: 28px; padding: .25rem .4rem; font-size: 10px; line-height: 1.25; white-space: nowrap; }
.pp-period-pair .pp-density-milestone-entry { white-space: normal; overflow-wrap: anywhere; }
.pp-period-pair .pp-density-milestone-entry .truncate { white-space: normal; overflow: visible; text-overflow: clip; }
.pp-period-pair .pp-density-milestone-entry .font-mono { display: block; font-size: 10px; white-space: normal; }
.pp-period-pair .pp-density-metadata { flex-wrap: wrap; }
.pp-period-pair .pp-density-date { display: block; flex-basis: 100%; white-space: nowrap; }
.pp-period-pair .pp-density-count { display: block; font-size: 10px; line-height: 1.3; margin-bottom: .3rem; }
`;
  document.head.appendChild(style);
  function stackName(summary, name) {
    const candidates = Array.from(summary.querySelectorAll('*'));
    const label = candidates.find(node => node.children.length === 0 && node.textContent.trim() === name);
    if (!label) return;
    label.classList.add('pp-density-name');
    summary.classList.add('pp-density-summary');
    summary.insertBefore(label, summary.firstChild);
  }
  function compactMilestones(pair) {
    pair.querySelectorAll('[onclick*="openMilestoneModal"]').forEach(node => {
      if (node.tagName === 'BUTTON' && /^\+\s*milestone$/i.test(node.textContent.trim())) {
        const heading = node.parentElement;
        if (heading && /milestones/i.test(heading.textContent)) {
          heading.classList.add('pp-density-milestone-heading');
          heading.appendChild(node);
        }
      } else {
        node.classList.add('pp-density-milestone-entry');
        node.querySelectorAll('*').forEach(child => {
          if (child.children.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(child.textContent.trim())) {
            child.classList.add('pp-density-date');
            if (child.parentElement) child.parentElement.classList.add('pp-density-metadata');
          }
        });
      }
    });
  }
  function shareCounts(pair) {
    const columns = Array.from(pair.children).filter(node => node.tagName === 'SECTION');
    const counts = columns.map(column => Array.from(column.querySelectorAll('*')).find(node => node.children.length === 0 && /^\d+\s+(departments|projects)$/i.test(node.textContent.trim()))).filter(Boolean);
    if (counts.length !== 2 || counts[0].textContent.trim().toLowerCase() !== counts[1].textContent.trim().toLowerCase()) return;
    let controls = pair.querySelector('.pp-pair-controls');
    if (!controls) {
      controls = document.createElement('div'); controls.className = 'pp-pair-controls';
      pair.insertBefore(controls, pair.querySelector('.pp-period-row'));
    }
    counts[0].classList.add('pp-density-count');
    controls.insertBefore(counts[0], controls.firstChild);
    counts[1].remove();
  }
  renderMobileMatrixCards = function() {
    const result = nativeRender();
    if (!isMobileViewport() || ui.mobileLayoutMode !== 'cards2') return result;
    const deck = document.getElementById('mobileMatrixDeck');
    const pair = deck && deck.querySelector('.pp-period-pair');
    if (!pair) return result;
    const db = getActiveDB();
    const entities = new Map((ui.axis === 'department' ? db.departments : db.projects).map(entity => [entity.id,entity]));
    pair.querySelectorAll('details[ontoggle]').forEach(details => {
      const match = (details.getAttribute('ontoggle') || '').match(/onMobileAccordionToggle\(\s*(['"])(.*?)\1/);
      const entity = match && entities.get(match[2]);
      const summary = Array.from(details.children).find(node => node.tagName === 'SUMMARY');
      if (entity && summary) stackName(summary, entity.name);
    });
    compactMilestones(pair);
    shareCounts(pair);
    return result;
  };
})();
