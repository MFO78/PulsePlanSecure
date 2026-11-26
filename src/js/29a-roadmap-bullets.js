/* WhatsApp-style Automatic Bullet Lists for Roadmap Notes & Comments */
(function ppRoadmapBulletsModule() {
  const BULLET_CHAR = '\u2022'; // •
  const BULLET_PREFIX = `${BULLET_CHAR} `;

  function esc(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(str ?? ''));
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isBulletTextarea(el) {
    if (!el || el.tagName !== 'TEXTAREA') return false;
    return el.dataset?.bulletNotes === 'true'
      || el.classList?.contains('cell-comment-input')
      || el.id === 'mAllocComment'
      || el.id === 'mMsNotes';
  }

  /**
   * Pure transformation for typing "- " at the start of a line (WhatsApp style):
   * converts leading "- " immediately before caret into "• ".
   */
  function transformDashSpaceOnInput(value, selStart, selEnd) {
    if (selStart !== selEnd || selStart < 2) return null;
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
    const beforeCaretOnLine = value.slice(lineStart, selStart);
    const match = beforeCaretOnLine.match(/^([ \t]*)- $/);
    if (!match) return null;
    const indent = match[1];
    const replacement = `${indent}${BULLET_PREFIX}`;
    const nextValue = value.slice(0, lineStart) + replacement + value.slice(selStart);
    const nextCaret = lineStart + replacement.length;
    return { value: nextValue, caret: nextCaret };
  }

  /**
   * Pure transformation for pressing Enter inside a Roadmap notes textarea:
   * - Line starting with "-" or "•" + non-empty text -> normalizes current line to "• ..." and inserts "\n• " on next line.
   * - Empty bullet line ("• ", "- ", "-", "•") -> removes bullet prefix to exit list cleanly (like WhatsApp).
   * - Regular line -> returns null (default newline behavior).
   */
  function transformEnterKey(value, selStart, selEnd) {
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
    const nextNewlineIdx = value.indexOf('\n', selEnd);
    const lineEnd = nextNewlineIdx === -1 ? value.length : nextNewlineIdx;

    const beforeCaret = value.slice(lineStart, selStart);
    const afterCaret = value.slice(selEnd, lineEnd);

    // Check if the current line begins with a bullet marker ("•" or "-")
    // Ignore horizontal rules like "--" or "---"
    const emptyBullet = beforeCaret.match(/^([ \t]*)(?:\u2022|-)[ \t]*$/);
    if (emptyBullet && afterCaret.trim() === '') {
      const nextValue = value.slice(0, lineStart) + value.slice(lineEnd);
      return { value: nextValue, caret: lineStart };
    }

    const activeBullet = beforeCaret.match(/^([ \t]*)(?:\u2022([ \t]*)|-(?!-)([ \t]*))(.*)$/);
    if (!activeBullet) return null;

    const indent = activeBullet[1] || '';
    const isAlreadyBulletChar = activeBullet[2] !== undefined;
    const itemBefore = activeBullet[4] || '';
    const itemAfter = afterCaret;

    // If user typed just "- " before caret but there is text after caret, still continue bullet
    // If user typed "-item" (no space after dash) and hit Enter, normalize to "• item" + "\n• "
    const normalizedCurrentPrefix = `${indent}${BULLET_PREFIX}`;
    const currentLineText = isAlreadyBulletChar
      ? `${normalizedCurrentPrefix}${itemBefore}`
      : `${normalizedCurrentPrefix}${itemBefore.replace(/^[ \t]+/, '')}`;
    const nextLineText = `${indent}${BULLET_PREFIX}${itemAfter.replace(/^[ \t]+/, '')}`;

    const nextValue =
      value.slice(0, lineStart) +
      currentLineText +
      '\n' +
      nextLineText +
      value.slice(lineEnd);
    const nextCaret = lineStart + currentLineText.length + 1 + indent.length + BULLET_PREFIX.length;
    return { value: nextValue, caret: nextCaret };
  }

  /**
   * Pure transformation for Backspace right after "• " at line start: removes whole bullet prefix cleanly.
   */
  function transformBackspaceKey(value, selStart, selEnd) {
    if (selStart !== selEnd || selStart < 2) return null;
    const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
    const beforeCaret = value.slice(lineStart, selStart);
    const m = beforeCaret.match(/^([ \t]*)\u2022 $/);
    if (!m) return null;
    const indent = m[1];
    const nextValue = value.slice(0, lineStart + indent.length) + value.slice(selStart);
    return { value: nextValue, caret: lineStart + indent.length };
  }

  /**
   * Formats plain-text Roadmap notes safely into HTML, grouping lines starting with "• " or "- "
   * into crisp hanging-indent bullet lists (<ul class="pp-note-bullets">).
   */
  function ppFormatRoadmapNoteHtml(rawText, extraClass = '') {
    const text = String(rawText ?? '');
    if (!text.trim()) return '';
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const blocks = [];
    let currentBullets = null;

    const flushBullets = () => {
      if (currentBullets && currentBullets.length > 0) {
        blocks.push(`<ul class="pp-note-bullets">${currentBullets.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`);
      }
      currentBullets = null;
    };

    lines.forEach(line => {
      const m = line.match(/^[ \t]*(?:\u2022[ \t]*|-[ \t]+)(.*)$/);
      if (m) {
        if (!currentBullets) currentBullets = [];
        currentBullets.push(m[1]);
      } else {
        flushBullets();
        const trimmed = line.trim();
        if (trimmed) {
          blocks.push(`<div class="${esc(extraClass)}">${esc(line)}</div>`);
        }
      }
    });
    flushBullets();

    return blocks.join('');
  }

  function applyTextareaTransform(ta, res) {
    if (!ta || !res) return false;
    ta.value = res.value;
    if (typeof ta.setSelectionRange === 'function') {
      ta.setSelectionRange(res.caret, res.caret);
    }
    return true;
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('input', (ev) => {
      const ta = ev.target;
      if (!isBulletTextarea(ta)) return;
      if (ev.inputType && String(ev.inputType).startsWith('delete')) return;
      const res = transformDashSpaceOnInput(ta.value, ta.selectionStart, ta.selectionEnd);
      if (res) applyTextareaTransform(ta, res);
    });

    document.addEventListener('keydown', (ev) => {
      const ta = ev.target;
      if (!isBulletTextarea(ta)) return;
      if (ev.isComposing) return;

      if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const res = transformEnterKey(ta.value, ta.selectionStart, ta.selectionEnd);
        if (res) {
          ev.preventDefault();
          applyTextareaTransform(ta, res);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else if (ev.key === 'Backspace' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const res = transformBackspaceKey(ta.value, ta.selectionStart, ta.selectionEnd);
        if (res) {
          ev.preventDefault();
          applyTextareaTransform(ta, res);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.ppFormatRoadmapNoteHtml = ppFormatRoadmapNoteHtml;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.ppFormatRoadmapNoteHtml = ppFormatRoadmapNoteHtml;
    globalThis.__ppRoadmapBulletsTestApi = {
      transformDashSpaceOnInput,
      transformEnterKey,
      transformBackspaceKey,
      ppFormatRoadmapNoteHtml,
    };
  }
})();
