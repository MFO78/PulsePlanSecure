/* Guarded presentation-only fix for Sync snapshot cards. */
(function ppMobileSnapshotLayout() {
  if (typeof document === 'undefined' || !document.head || typeof document.querySelectorAll !== 'function') return;
  const style = document.createElement('style');
  style.id = 'pp-mobile-snapshot-layout';
  style.textContent = `
@media screen and (max-width: 767px) {
  #tab-sync .pp-snapshot-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  #tab-sync .pp-snapshot-details {
    flex: 0 1 auto;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    word-break: normal;
    overflow-wrap: anywhere;
  }
  #tab-sync .pp-snapshot-details * {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    word-break: normal;
    overflow-wrap: anywhere;
  }
  #tab-sync .pp-snapshot-actions {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }
  #tab-sync .pp-snapshot-actions > button {
    flex: 0 1 auto;
    min-height: 44px;
    max-width: 100%;
    margin: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
`;
  document.head.appendChild(style);
  function annotate(root) {
    const label = button => String(button.textContent || '').trim().toLowerCase();
    root.querySelectorAll('button').forEach(button => {
      if (label(button) !== 'compare') return;
      const actions = button.parentElement;
      if (!actions || actions.classList.contains('pp-snapshot-actions')) return;
      const buttons = Array.from(actions.children).filter(el => el.tagName === 'BUTTON');
      const labels = buttons.map(label);
      if (!labels.includes('restore') || !labels.includes('delete')) return;
      if (buttons.length < 3 || buttons.length > 5) return;
      const card = actions.parentElement;
      if (!card || card.children.length !== 2 || card.lastElementChild !== actions) return;
      const details = card.firstElementChild;
      if (!details || details === actions) return;
      card.classList.add('pp-snapshot-card');
      details.classList.add('pp-snapshot-details');
      actions.classList.add('pp-snapshot-actions');
    });
  }
  function start() {
    const root = document.getElementById('tab-sync');
    if (!root) return;
    annotate(root);
    if (typeof MutationObserver !== 'undefined') {
      let pending = false;
      const observer = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        Promise.resolve().then(() => { pending = false; annotate(root); });
      });
      observer.observe(root, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
