/* Shared screen-dialog containment; deliberately excludes PDF/print geometry. */
(function ppInstallResponsiveFrames() {
  if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return;
  if (document.getElementById('pp-responsive-frames')) return;
  const style = document.createElement('style');
  style.id = 'pp-responsive-frames';
  style.textContent = `
@media screen {
  #modalCard, dialog.mobile-sheet {
    box-sizing: border-box;
    min-width: 0;
    min-height: 0;
    max-width: calc(100vw - 1.5rem);
    max-height: calc(100vh - 2rem);
    max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    overflow-wrap: anywhere;
  }
  #modalCard :where(div, section, article, form, fieldset, legend, label),
  dialog.mobile-sheet :where(div, section, article, form, fieldset, legend, label) {
    min-width: 0;
    box-sizing: border-box;
  }
  #modalCard fieldset, dialog.mobile-sheet fieldset {
    min-inline-size: 0;
    max-inline-size: 100%;
  }
  #modalCard :where(input, select, textarea),
  dialog.mobile-sheet :where(input, select, textarea) {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  #modalCard :where(img, video, canvas, iframe),
  dialog.mobile-sheet :where(img, video, canvas, iframe) {
    max-width: 100%;
  }
  #modalCard :where(img, video), dialog.mobile-sheet :where(img, video) { height: auto; }
}
@media screen and (max-width: 767px) {
  #modalCard, dialog.mobile-sheet { width: calc(100% - 1.5rem); }
  #modalCard > div { padding: 1rem; }
  #modalCard :where(h1, h2, h3, p, label, legend),
  dialog.mobile-sheet :where(h1, h2, h3, p, label, legend) {
    overflow-wrap: anywhere;
  }
  #modalCard .grid, dialog.mobile-sheet .grid {
    grid-template-columns: minmax(0, 1fr);
  }
  #modalCard .flex, dialog.mobile-sheet .flex { flex-wrap: wrap; }
  #modalCard label.flex, dialog.mobile-sheet label.flex { flex-wrap: nowrap; }
  #modalCard :where(input[type=checkbox], input[type=radio]),
  dialog.mobile-sheet :where(input[type=checkbox], input[type=radio]) { flex-shrink: 0; }
  #modalCard button, dialog.mobile-sheet button {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  #modalCard .truncate, dialog.mobile-sheet .truncate {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
  }
  #modalCard #mPdfHorizonSummary { flex: 1 1 12rem; }
  #modalCard #btnGeneratePdfSubmit { flex: 1 1 12rem; min-height: 44px; }
  #modalCard :where(select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=color])) {
    width: 100%;
  }
}
`;
  document.head.appendChild(style);
})();
