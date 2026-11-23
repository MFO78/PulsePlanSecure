/* Group native period cards by entity, not independent column height. */
(function ppPairedRows() {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function' || typeof document.createElement !== 'function' || typeof syncMobileControlsUI !== 'function' || typeof renderMobileMatrixCards !== 'function') return;
  const sync = syncMobileControlsUI;
  const render = renderMobileMatrixCards;
  const style = document.createElement('style');
  style.textContent = `
#pp-mobile-layout-toolbar { display: flex; justify-content: flex-end; flex-wrap: wrap; width: 100%; min-width: 0; margin-bottom: .5rem; }
#pp-mobile-layout-toolbar[hidden] { display: none; }
#pp-mobile-layout-toolbar #pp-mobile-layout { position: static; flex: 0 1 auto; margin: 0; }
.pp-shared-card-row { grid-column: 1 / -1; min-width: 0; width: 100%; border-top: 1px solid rgba(100,116,139,.3); padding-top: .5rem; }
.pp-shared-card-row > summary { cursor: pointer; min-height: 36px; padding: .4rem .25rem; font-size: .8rem; font-weight: 800; overflow-wrap: anywhere; }
.pp-shared-card-row > summary:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
.pp-shared-card-row:not([open]) > .pp-shared-card-cells { display: none; }
.pp-shared-card-cells { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); align-items: start; gap: .5rem; min-width: 0; }
.pp-shared-card-cell { min-width: 0; max-width: 100%; }
.pp-shared-card-empty { border: 1px dashed rgba(100,116,139,.35); border-radius: .75rem; padding: .75rem .5rem; font-size: .75rem; overflow-wrap: anywhere; }
.pp-shared-collapse { grid-column: 1 / -1; justify-self: start; min-height: 36px; padding: .3rem .6rem; border: 1px solid rgba(100,116,139,.3); border-radius: .6rem; font-size: .75rem; }
@media (min-width: 768px) { #pp-mobile-layout-toolbar { display: none; } }
`;
  document.head.appendChild(style);
  syncMobileControlsUI = function(db) {
    sync(db);
    const group = document.getElementById('pp-mobile-layout');
    const deck = document.getElementById('mobileMatrixDeck');
    if (!group || !deck) return;
    let toolbar = document.getElementById('pp-mobile-layout-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div'); toolbar.id = 'pp-mobile-layout-toolbar';
      toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','Roadmap display');
      deck.insertAdjacentElement('beforebegin', toolbar);
    }
    if (group.parentElement !== toolbar) toolbar.appendChild(group);
    toolbar.hidden = ui.activeTab !== 'matrix' || !isMobileViewport();
  };
  function rowId(node) {
    const handler = node.getAttribute('ontoggle') || '';
    const match = handler.match(/onMobileAccordionToggle\(\s*(['"])(.*?)\1/);
    return match ? match[2] : null;
  }
  function staticCard(details) {
    const card = document.createElement('article');
    Array.from(details.attributes).forEach(attr => {
      if (attr.name !== 'ontoggle' && attr.name !== 'open') card.setAttribute(attr.name, attr.value);
    });
    while (details.firstChild) {
      const child = details.firstChild;
      if (child.nodeType === 1 && child.tagName === 'SUMMARY') {
        const header = document.createElement('div'); header.className = child.className;
        while (child.firstChild) header.appendChild(child.firstChild);
        card.appendChild(header); child.remove();
      } else card.appendChild(child);
    }
    details.remove();
    return card;
  }
  renderMobileMatrixCards = function() {
    const result = render();
    if (!isMobileViewport() || ui.mobileLayoutMode !== 'cards2' || ui.axis === 'timeline') return result;
    const deck = document.getElementById('mobileMatrixDeck');
    const pair = deck && deck.querySelector('.pp-native-pair');
    if (!pair) return result;
    const columns = Array.from(pair.children).filter(el => el.classList.contains('pp-native-column'));
    if (columns.length !== 2) return result;
    const maps = columns.map(column => {
      const map = new Map();
      column.querySelectorAll('details[ontoggle]').forEach(node => { const id = rowId(node); if (id) map.set(id,node); });
      return map;
    });
    const ids = new Set([...maps[0].keys(), ...maps[1].keys()]);
    if (!ids.size) return result;
    const db = getActiveDB();
    const entities = ui.axis === 'department' ? db.departments : getSortedProjects(db);
    const names = new Map(entities.map(entity => [entity.id, entity]));
    const orderedIds = entities.filter(entity => ids.has(entity.id)).map(entity => entity.id);
    if (orderedIds.length !== ids.size) return result;
    columns.forEach(column => {
      column.querySelectorAll('button').forEach(button => {
        const handler = button.getAttribute('onclick') || '';
        if (handler.includes('toggleMobileCollapseAll')) button.remove();
      });
    });
    const sharedRows = [];
    const collapse = document.createElement('button'); collapse.type = 'button'; collapse.className = 'pp-shared-collapse';
    function updateCollapseLabel() {
      const allClosed = sharedRows.every(row => !row.open);
      collapse.textContent = allClosed ? 'Expand All' : 'Collapse All';
      collapse.setAttribute('aria-label', collapse.textContent + ' paired rows');
    }
    collapse.addEventListener('click', () => {
      const open = sharedRows.every(row => !row.open);
      const collapsed = new Set(Array.isArray(ui.mobileCollapsedIds) ? ui.mobileCollapsedIds : []);
      sharedRows.forEach(row => { row.open = open; if (open) collapsed.delete(row.dataset.rowId); else collapsed.add(row.dataset.rowId); });
      ui.mobileCollapsedIds = [...collapsed]; persistUIPrefs(); updateCollapseLabel();
    });
    pair.appendChild(collapse);
    orderedIds.forEach(id => {
      const entity = names.get(id);
      const row = document.createElement('details'); row.className = 'pp-shared-card-row'; row.dataset.rowId = id;
      row.open = !(Array.isArray(ui.mobileCollapsedIds) && ui.mobileCollapsedIds.includes(id));
      const title = document.createElement('summary'); title.textContent = '[' + entity.code + '] ' + entity.name; row.appendChild(title);
      const cells = document.createElement('div'); cells.className = 'pp-shared-card-cells';
      maps.forEach((map,index) => {
        const cell = document.createElement('div'); cell.className = 'pp-shared-card-cell pp-native-column';
        cell.setAttribute('aria-label', columns[index].getAttribute('aria-label') || 'Period ' + (index + 1));
        const native = map.get(id);
        if (native) cell.appendChild(staticCard(native));
        else { const empty = document.createElement('p'); empty.className = 'pp-shared-card-empty'; empty.textContent = 'No matching allocations in this period.'; cell.appendChild(empty); }
        cells.appendChild(cell);
      });
      row.appendChild(cells);
      row.addEventListener('toggle', () => {
        const collapsed = new Set(Array.isArray(ui.mobileCollapsedIds) ? ui.mobileCollapsedIds : []);
        if (row.open) collapsed.delete(id); else collapsed.add(id);
        ui.mobileCollapsedIds = [...collapsed]; persistUIPrefs(); updateCollapseLabel();
      });
      sharedRows.push(row); pair.appendChild(row);
    });
    updateCollapseLabel();
    return result;
  };
})();
