#!/usr/bin/env node
/**
 * PulsePlan Zero-Dependency Single-File Builder
 *
 * Compiles modular sources in src/ + pre-compiled offline Tailwind utility CSS
 * into a single self-contained, offline-ready index.html and validates JS syntax.
 *
 * Usage: node build.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');

/* ============================================================================
 * 1. TAILWIND COLOR PALETTE & SCALES
 * ============================================================================ */

const COLORS = {
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
  current: 'currentColor',
  slate: {
    50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
    500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617',
  },
  indigo: {
    50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8',
    500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
  },
  violet: {
    50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa',
    500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065',
  },
  emerald: {
    50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
    500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22',
  },
  amber: {
    50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24',
    500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03',
  },
  rose: {
    50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185',
    500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337', 950: '#4c0519',
  },
  sky: {
    50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8',
    500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e', 950: '#082f49',
  },
  brand: {
    50: '#eef2ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
  },
};

const SPACING = {
  0: '0px', px: '1px', 0.5: '0.125rem', 1: '0.25rem', 1.5: '0.375rem', 2: '0.5rem',
  2.5: '0.625rem', 3: '0.75rem', 3.5: '0.875rem', 4: '1rem', 5: '1.25rem', 6: '1.5rem',
  7: '1.75rem', 8: '2rem', 9: '2.25rem', 10: '2.5rem', 11: '2.75rem', 12: '3rem',
  14: '3.5rem', 16: '4rem', 20: '5rem', 24: '6rem', 28: '7rem', 32: '8rem',
  36: '9rem', 40: '10rem', 44: '11rem', 48: '12rem', 52: '13rem', 56: '14rem',
  60: '15rem', 64: '16rem', 72: '18rem', 80: '20rem', 96: '24rem',
};

const MAX_W = {
  none: 'none', xs: '20rem', sm: '24rem', md: '28rem', lg: '32rem', xl: '36rem',
  '2xl': '42rem', '3xl': '48rem', '4xl': '56rem', '5xl': '64rem', full: '100%',
};

const TEXT_SIZES = {
  xs: ['0.75rem', '1rem'],
  sm: ['0.875rem', '1.25rem'],
  base: ['1rem', '1.5rem'],
  lg: ['1.125rem', '1.75rem'],
  xl: ['1.25rem', '1.75rem'],
  '2xl': ['1.5rem', '2rem'],
  '3xl': ['1.875rem', '2.25rem'],
};

const RADII = {
  '': '0.25rem', none: '0px', sm: '0.125rem', md: '0.375rem', lg: '0.5rem',
  xl: '0.75rem', '2xl': '1rem', '3xl': '1.5rem', full: '9999px',
};

const SHADOWS = {
  '2xs': '0 1px 0 0 rgba(15, 23, 42, 0.04)',
  xs: '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
  sm: '0 1px 3px 0 rgba(15, 23, 42, 0.1), 0 1px 2px -1px rgba(15, 23, 42, 0.1)',
  '': '0 1px 3px 0 rgba(15, 23, 42, 0.1), 0 1px 2px -1px rgba(15, 23, 42, 0.1)',
  md: '0 4px 6px -1px rgba(15, 23, 42, 0.1), 0 2px 4px -2px rgba(15, 23, 42, 0.1)',
  lg: '0 10px 15px -3px rgba(15, 23, 42, 0.1), 0 4px 6px -4px rgba(15, 23, 42, 0.1)',
  xl: '0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.1)',
  '2xl': '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
  none: 'none',
};

const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
  xl: '(min-width: 1280px)',
  '2xl': '(min-width: 1536px)',
};

function hexToRgba(hex, alphaPct) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Number(alphaPct) / 100})`;
}

function resolveColor(token) {
  const [base, alpha] = token.split('/');
  let hex = null;
  if (typeof COLORS[base] === 'string') {
    hex = COLORS[base];
  } else {
    const idx = base.lastIndexOf('-');
    if (idx > 0) {
      const fam = base.slice(0, idx);
      const shade = base.slice(idx + 1);
      if (COLORS[fam] && COLORS[fam][shade]) hex = COLORS[fam][shade];
    }
  }
  if (!hex) return null;
  if (alpha !== undefined && hex.startsWith('#')) return hexToRgba(hex, alpha);
  return hex;
}

function resolveSpacing(val) {
  if (Object.prototype.hasOwnProperty.call(SPACING, val)) return SPACING[val];
  if (val === 'auto') return 'auto';
  if (val === 'full') return '100%';
  if (val === 'screen') return '100vh';
  if (val.startsWith('[') && val.endsWith(']')) {
    let inner = val.slice(1, -1).replace(/_/g, ' ');
    if (inner.includes('calc(')) {
      inner = inner.replace(/(\d(?:px|rem|em|%|vh|vw|dvh|svh|ch)?|\))\s*([+-])\s*/g, '$1 $2 ');
    }
    return inner;
  }
  return null;
}

function cssEscape(cls) {
  return cls.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function compileUtilityDecl(util) {
  const neg = util.startsWith('-');
  const raw = neg ? util.slice(1) : util;
  const sign = (v) => (neg && v !== '0px' && v !== 'auto' ? `-${v}` : v);

  // Static one-offs
  const STATIC = {
    block: 'display: block;',
    inline: 'display: inline;',
    'inline-block': 'display: inline-block;',
    flex: 'display: flex;',
    'inline-flex': 'display: inline-flex;',
    grid: 'display: grid;',
    table: 'display: table;',
    hidden: 'display: none;',
    relative: 'position: relative;',
    absolute: 'position: absolute;',
    fixed: 'position: fixed;',
    sticky: 'position: sticky;',
    static: 'position: static;',
    isolate: 'isolation: isolate;',
    'flex-1': 'flex: 1 1 0%;',
    'flex-col': 'flex-direction: column;',
    'flex-row': 'flex-direction: row;',
    'flex-wrap': 'flex-wrap: wrap;',
    'flex-nowrap': 'flex-wrap: nowrap;',
    'shrink-0': 'flex-shrink: 0;',
    shrink: 'flex-shrink: 1;',
    grow: 'flex-grow: 1;',
    'items-start': 'align-items: flex-start;',
    'items-center': 'align-items: center;',
    'items-end': 'align-items: flex-end;',
    'items-baseline': 'align-items: baseline;',
    'items-stretch': 'align-items: stretch;',
    'justify-start': 'justify-content: flex-start;',
    'justify-center': 'justify-content: center;',
    'justify-end': 'justify-content: flex-end;',
    'justify-between': 'justify-content: space-between;',
    'self-center': 'align-self: center;',
    'align-top': 'vertical-align: top;',
    'align-middle': 'vertical-align: middle;',
    'overflow-hidden': 'overflow: hidden;',
    'overflow-auto': 'overflow: auto;',
    'overflow-visible': 'overflow: visible;',
    'overflow-x-auto': 'overflow-x: auto;',
    'overflow-x-hidden': 'overflow-x: hidden;',
    'overflow-y-auto': 'overflow-y: auto;',
    'overscroll-contain': 'overscroll-behavior: contain;',
    'border-collapse': 'border-collapse: collapse;',
    'border-separate': 'border-collapse: separate;',
    'border-spacing-0': 'border-spacing: 0px 0px;',
    'table-fixed': 'table-layout: fixed;',
    'table-auto': 'table-layout: auto;',
    'border-dashed': 'border-style: dashed;',
    'border-solid': 'border-style: solid;',
    border: 'border-width: 1px;',
    'border-0': 'border-width: 0px;',
    'border-t': 'border-top-width: 1px;',
    'border-t-2': 'border-top-width: 2px;',
    'border-b': 'border-bottom-width: 1px;',
    'border-l': 'border-left-width: 1px;',
    'border-r': 'border-right-width: 1px;',
    'border-x': 'border-left-width: 1px; border-right-width: 1px;',
    'border-y': 'border-top-width: 1px; border-bottom-width: 1px;',
    'font-normal': 'font-weight: 400;',
    'font-medium': 'font-weight: 500;',
    'font-semibold': 'font-weight: 600;',
    'font-bold': 'font-weight: 700;',
    'font-extrabold': 'font-weight: 800;',
    'font-mono': 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
    'font-sans': "font-family: 'Inter', system-ui, -apple-system, sans-serif;",
    'leading-none': 'line-height: 1;',
    'leading-tight': 'line-height: 1.25;',
    'leading-snug': 'line-height: 1.375;',
    'leading-normal': 'line-height: 1.5;',
    'leading-relaxed': 'line-height: 1.625;',
    'tracking-tight': 'letter-spacing: -0.025em;',
    'tracking-wide': 'letter-spacing: 0.025em;',
    'tracking-wider': 'letter-spacing: 0.05em;',
    'text-left': 'text-align: left;',
    'text-center': 'text-align: center;',
    'text-right': 'text-align: right;',
    uppercase: 'text-transform: uppercase;',
    lowercase: 'text-transform: lowercase;',
    capitalize: 'text-transform: capitalize;',
    underline: 'text-decoration-line: underline;',
    italic: 'font-style: italic;',
    'tabular-nums': 'font-variant-numeric: tabular-nums;',
    truncate: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
    'whitespace-nowrap': 'white-space: nowrap;',
    'whitespace-pre-line': 'white-space: pre-line;',
    'break-words': 'overflow-wrap: break-word;',
    'break-all': 'word-break: break-all;',
    antialiased: '-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;',
    'cursor-pointer': 'cursor: pointer;',
    'cursor-text': 'cursor: text;',
    'cursor-grab': 'cursor: grab;',
    'cursor-grabbing': 'cursor: grabbing;',
    'select-none': 'user-select: none;',
    'pointer-events-none': 'pointer-events: none;',
    'pointer-events-auto': 'pointer-events: auto;',
    'outline-none': 'outline: 2px solid transparent; outline-offset: 2px;',
    transition: 'transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;',
    'transition-all': 'transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;',
    'transition-transform': 'transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms;',
    'animate-pulse': 'animation: tw-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;',
    'animate-ping': 'animation: tw-ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;',
    'backdrop-blur-xs': 'backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);',
    'backdrop-blur-sm': 'backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);',
    'backdrop-blur-md': 'backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);',
    'brightness-95': 'filter: brightness(0.95);',
    'snap-x': 'scroll-snap-type: x var(--tw-scroll-snap-strictness, proximity);',
    'snap-mandatory': '--tw-scroll-snap-strictness: mandatory;',
    'snap-center': 'scroll-snap-align: center;',
    'sr-only': 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;',
    'not-sr-only': 'position: static; width: auto; height: auto; padding: 0; margin: 0; overflow: visible; clip: auto; white-space: normal;',
    'list-decimal': 'list-style-type: decimal;',
    'list-disc': 'list-style-type: disc;',
    'bg-gradient-to-br': 'background-image: linear-gradient(to bottom right, var(--tw-gradient-from, #4f46e5), var(--tw-gradient-to, #7c3aed));',
    'ring-1': 'box-shadow: 0 0 0 1px var(--tw-ring-color, rgba(59, 130, 246, 0.5));',
    'ring-2': 'box-shadow: 0 0 0 2px var(--tw-ring-color, rgba(59, 130, 246, 0.5));',
    'ring-offset-1': '--tw-ring-offset-width: 1px;',
  };
  if (Object.prototype.hasOwnProperty.call(STATIC, raw)) return { decl: STATIC[raw] };

  // Divide / space child combinators
  if (raw === 'divide-y') {
    return { childSelector: ' > :not([hidden]) ~ :not([hidden])', decl: 'border-top-width: 1px; border-bottom-width: 0px;' };
  }
  if (raw.startsWith('divide-')) {
    const col = resolveColor(raw.slice(7));
    if (col) return { childSelector: ' > :not([hidden]) ~ :not([hidden])', decl: `border-color: ${col};` };
  }
  if (raw.startsWith('space-y-')) {
    const sp = resolveSpacing(raw.slice(8));
    if (sp) return { childSelector: ' > :not([hidden]) ~ :not([hidden])', decl: `margin-top: ${sp};` };
  }
  if (raw.startsWith('space-x-')) {
    const sp = resolveSpacing(raw.slice(8));
    if (sp) return { childSelector: ' > :not([hidden]) ~ :not([hidden])', decl: `margin-left: ${sp};` };
  }

  // Gradient stops
  if (raw.startsWith('from-')) {
    const col = resolveColor(raw.slice(5));
    if (col) return { decl: `--tw-gradient-from: ${col};` };
  }
  if (raw.startsWith('to-')) {
    const col = resolveColor(raw.slice(3));
    if (col) return { decl: `--tw-gradient-to: ${col};` };
  }

  // Grid columns & col-span
  let m;
  if ((m = raw.match(/^grid-cols-(\d+)$/))) {
    return { decl: `grid-template-columns: repeat(${m[1]}, minmax(0, 1fr));` };
  }
  if ((m = raw.match(/^col-span-(\d+)$/))) {
    return { decl: `grid-column: span ${m[1]} / span ${m[1]};` };
  }

  // Gap
  if (raw.startsWith('gap-x-')) {
    const sp = resolveSpacing(raw.slice(6));
    if (sp) return { decl: `column-gap: ${sp};` };
  }
  if (raw.startsWith('gap-y-')) {
    const sp = resolveSpacing(raw.slice(6));
    if (sp) return { decl: `row-gap: ${sp};` };
  }
  if (raw.startsWith('gap-')) {
    const sp = resolveSpacing(raw.slice(4));
    if (sp) return { decl: `gap: ${sp};` };
  }

  // Padding & margin
  if ((m = raw.match(/^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-(.+)$/))) {
    const prop = m[1];
    const sp = resolveSpacing(m[2]);
    if (sp) {
      const v = sign(sp);
      const MAP = {
        p: `padding: ${v};`,
        px: `padding-left: ${v}; padding-right: ${v};`,
        py: `padding-top: ${v}; padding-bottom: ${v};`,
        pt: `padding-top: ${v};`,
        pb: `padding-bottom: ${v};`,
        pl: `padding-left: ${v};`,
        pr: `padding-right: ${v};`,
        m: `margin: ${v};`,
        mx: `margin-left: ${v}; margin-right: ${v};`,
        my: `margin-top: ${v}; margin-bottom: ${v};`,
        mt: `margin-top: ${v};`,
        mb: `margin-bottom: ${v};`,
        ml: `margin-left: ${v};`,
        mr: `margin-right: ${v};`,
      };
      return { decl: MAP[prop] };
    }
  }

  // Width / Height / Min / Max
  if ((m = raw.match(/^(w|h|min-w|max-w|min-h|max-h)-(.+)$/))) {
    const kind = m[1];
    const arg = m[2];
    let val = null;
    if (kind === 'max-w' && arg in MAX_W) val = MAX_W[arg];
    else val = resolveSpacing(arg);
    if (val) {
      const PMAP = { w: 'width', h: 'height', 'min-w': 'min-width', 'max-w': 'max-width', 'min-h': 'min-height', 'max-h': 'max-height' };
      return { decl: `${PMAP[kind]}: ${val};` };
    }
  }

  // Inset / top / bottom / left / right
  if ((m = raw.match(/^(inset-x|inset-y|inset|top|bottom|left|right)-(.+)$/))) {
    const sp = resolveSpacing(m[2]);
    if (sp) {
      const v = sign(sp);
      const k = m[1];
      if (k === 'inset') return { decl: `inset: ${v};` };
      if (k === 'inset-x') return { decl: `left: ${v}; right: ${v};` };
      if (k === 'inset-y') return { decl: `top: ${v}; bottom: ${v};` };
      return { decl: `${k}: ${v};` };
    }
  }

  // Z-index
  if ((m = raw.match(/^z-(\d+|auto)$/))) {
    return { decl: `z-index: ${m[1]};` };
  }

  // Opacity
  if ((m = raw.match(/^opacity-(\d+)$/))) {
    return { decl: `opacity: ${Number(m[1]) / 100};` };
  }

  // Border radius
  if (raw === 'rounded') return { decl: `border-radius: ${RADII['']};` };
  if ((m = raw.match(/^rounded-(t|b|l|r)-(.+)$/)) && m[2] in RADII) {
    const r = RADII[m[2]];
    if (m[1] === 't') return { decl: `border-top-left-radius: ${r}; border-top-right-radius: ${r};` };
    if (m[1] === 'b') return { decl: `border-bottom-left-radius: ${r}; border-bottom-right-radius: ${r};` };
    if (m[1] === 'l') return { decl: `border-top-left-radius: ${r}; border-bottom-left-radius: ${r};` };
    if (m[1] === 'r') return { decl: `border-top-right-radius: ${r}; border-bottom-right-radius: ${r};` };
  }
  if (raw.startsWith('rounded-') && raw.slice(8) in RADII) {
    return { decl: `border-radius: ${RADII[raw.slice(8)]};` };
  }

  // Shadow
  if (raw === 'shadow') return { decl: `box-shadow: ${SHADOWS['']};` };
  if (raw.startsWith('shadow-') && raw.slice(7) in SHADOWS) {
    return { decl: `box-shadow: ${SHADOWS[raw.slice(7)]};` };
  }

  // Ring color
  if (raw.startsWith('ring-')) {
    const col = resolveColor(raw.slice(5));
    if (col) return { decl: `--tw-ring-color: ${col};` };
  }

  // Text size & color
  if (raw.startsWith('text-')) {
    const arg = raw.slice(5);
    if (arg in TEXT_SIZES) {
      return { decl: `font-size: ${TEXT_SIZES[arg][0]}; line-height: ${TEXT_SIZES[arg][1]};` };
    }
    if (arg.startsWith('[') && arg.endsWith(']')) {
      return { decl: `font-size: ${arg.slice(1, -1)};` };
    }
    const col = resolveColor(arg);
    if (col) return { decl: `color: ${col};` };
  }

  // Background color
  if (raw.startsWith('bg-')) {
    const col = resolveColor(raw.slice(3));
    if (col) return { decl: `background-color: ${col};` };
  }

  // Border color
  if (raw.startsWith('border-')) {
    const col = resolveColor(raw.slice(7));
    if (col) return { decl: `border-color: ${col};` };
  }

  return null;
}

function getBaseOrder(util) {
  const raw = util.startsWith('-') ? util.slice(1) : util;
  if (raw === 'hidden') return 2;
  if (['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'table'].includes(raw)) return 1;
  if (/^(p|m)-/.test(raw)) return 1;
  if (/^(px|py|mx|my)-/.test(raw)) return 2;
  if (/^(pt|pr|pb|pl|mt|mr|mb|ml)-/.test(raw)) return 3;
  if (raw === 'border' || raw === 'border-0') return 1;
  if (raw === 'border-x' || raw === 'border-y') return 2;
  if (/^border-(t|r|b|l)(-|$)/.test(raw)) return 3;
  if (/^rounded-(t|b|l|r)-/.test(raw)) return 2;
  if (raw === 'rounded' || raw.startsWith('rounded-')) return 1;
  if (raw.startsWith('inset-x-') || raw.startsWith('inset-y-')) return 2;
  if (raw.startsWith('inset-')) return 1;
  if (/^(top|right|bottom|left)-/.test(raw)) return 3;
  if (raw.startsWith('overflow-x-') || raw.startsWith('overflow-y-')) return 2;
  if (raw.startsWith('overflow-')) return 1;
  return 0;
}

function compileToken(token) {
  const parts = token.split(':');
  const util = parts.pop();
  const variants = parts;

  const compiled = compileUtilityDecl(util);
  if (!compiled) return null;

  let bp = null;
  let pseudo = '';
  let prefixSel = '';
  let order = getBaseOrder(util);

  for (const v of variants) {
    if (v in BREAKPOINTS) {
      bp = v;
    } else if (v === 'hover') {
      pseudo += ':hover';
      order = Math.max(order, 20);
    } else if (v === 'focus') {
      pseudo += ':focus';
      order = Math.max(order, 21);
    } else if (v === 'focus-visible') {
      pseudo += ':focus-visible';
      order = Math.max(order, 22);
    } else if (v === 'active') {
      pseudo += ':active';
      order = Math.max(order, 23);
    } else if (v === 'disabled') {
      pseudo += ':disabled';
      order = Math.max(order, 24);
    } else if (v === 'selection') {
      pseudo += '::selection';
      order = Math.max(order, 25);
    } else if (v.startsWith('group-hover/')) {
      const grp = v.slice('group-hover/'.length);
      prefixSel = `.group\\/${grp}:hover `;
      order = Math.max(order, 20);
    } else {
      return null;
    }
  }

  const sel = `${prefixSel}.${cssEscape(token)}${pseudo}${compiled.childSelector || ''}`;
  const rule = `${sel} { ${compiled.decl} }`;
  return { bp, order, rule };
}

const PREFLIGHT_CSS = `/* Pre-compiled Tailwind Preflight & Offline Utility Stylesheet */
*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e2e8f0; }
html { line-height: 1.5; -webkit-text-size-adjust: 100%; tab-size: 4; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
body { margin: 0; line-height: inherit; }
hr { height: 0; color: inherit; border-top-width: 1px; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; margin: 0; }
p, dl, dd, ul, ol, figure, blockquote, pre { margin: 0; }
ul, ol { list-style: none; padding: 0; }
a { color: inherit; text-decoration: inherit; }
b, strong { font-weight: bolder; }
code, kbd, samp, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 1em; }
table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
button, input, optgroup, select, textarea { font-family: inherit; font-feature-settings: inherit; font-variation-settings: inherit; font-size: 100%; font-weight: inherit; line-height: inherit; letter-spacing: inherit; color: inherit; margin: 0; padding: 0; }
button, select { text-transform: none; }
button, [type='button'], [type='reset'], [type='submit'] { -webkit-appearance: button; background-color: transparent; background-image: none; }
button:not(:disabled), [role='button']:not(:disabled) { cursor: pointer; }
fieldset { margin: 0; padding: 0; border: 0; }
legend { padding: 0; }
textarea { resize: vertical; }
input::placeholder, textarea::placeholder { opacity: 1; color: #94a3b8; }
img, svg, video, canvas { display: block; vertical-align: middle; }
img, video { max-width: 100%; height: auto; }
[hidden] { display: none; }
@keyframes tw-pulse { 50% { opacity: .5; } }
@keyframes tw-ping { 75%, 100% { transform: scale(2); opacity: 0; } }
`;

function collectTokensFromSources(sourceStrings) {
  const found = new Set();
  const combined = sourceStrings.join('\n');

  // Extract every whitespace/delimiter-separated token while keeping [...] arbitrary values (like calc(...)) intact
  const tokenRe = /(?:\[[^\]]+\]|[^\s"'`<>={}?(),;\[\]])+/g;
  for (const m of combined.matchAll(tokenRe)) {
    const tok = m[0].replace(/^\.+|\.+$/g, '');
    if (tok && tok.length <= 80) found.add(tok);
  }
  return found;
}

function buildTailwindCss(sourceStrings) {
  const candidates = collectTokensFromSources(sourceStrings);
  const baseRules = [];
  const bpBuckets = { sm: [], md: [], lg: [], xl: [], '2xl': [] };

  let compiledCount = 0;
  for (const tok of [...candidates].sort()) {
    const res = compileToken(tok);
    if (!res) continue;
    compiledCount++;
    if (res.bp) bpBuckets[res.bp].push(res);
    else baseRules.push(res);
  }

  baseRules.sort((a, b) => a.order - b.order);
  const out = [PREFLIGHT_CSS];
  for (const r of baseRules) out.push(r.rule);
  for (const [bp, media] of Object.entries(BREAKPOINTS)) {
    const list = bpBuckets[bp];
    if (!list.length) continue;
    list.sort((a, b) => a.order - b.order);
    out.push(`@media ${media} {\n${list.map(r => '  ' + r.rule).join('\n')}\n}`);
  }
  return { css: out.join('\n'), compiledCount };
}

/* ============================================================================
 * 2. STITCH MODULAR SOURCES -> SINGLE-FILE index.html
 * ============================================================================ */

function build() {
  const appCss = fs.readFileSync(path.join(SRC_DIR, 'styles', 'app.css'), 'utf8');
  const bodyHtml = fs.readFileSync(path.join(SRC_DIR, 'html', 'body.html'), 'utf8');
  const jsDir = path.join(SRC_DIR, 'js');
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
  const jsChunks = jsFiles.map(f => ({
    name: f,
    code: fs.readFileSync(path.join(jsDir, f), 'utf8'),
  }));

  const combinedJs = "'use strict';\n\n" + jsChunks.map(c => c.code.trim()).join('\n\n') + '\n';

  // Validate JavaScript syntax before writing output
  try {
    new Function(combinedJs);
  } catch (err) {
    console.error('❌ JavaScript syntax error during build:', err.message);
    process.exit(1);
  }

  // Compile 100% offline Tailwind CSS for all classes used in body + bodyHtml + all JS modules
  const bodyClassStr = 'class="bg-slate-50 text-slate-900 antialiased selection:bg-indigo-100 selection:text-indigo-900"';
  const { css: tailwindCss, compiledCount } = buildTailwindCss([bodyClassStr, bodyHtml, ...jsChunks.map(c => c.code)]);

  // Inline SVG Brand Favicon (100% offline, crisp at 16px-64px in browser tabs)
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><defs><linearGradient id="g" x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#4338ca"/><stop offset="55%" stop-color="#6366f1"/><stop offset="100%" stop-color="#0ea5e9"/></linearGradient></defs><rect x="1" y="1" width="38" height="38" rx="10" fill="url(#g)"/><rect x="7" y="9" width="14" height="3.5" rx="1.75" fill="#fff" fill-opacity=".38"/><rect x="23" y="9" width="10" height="3.5" rx="1.75" fill="#a5f3fc" fill-opacity=".55"/><rect x="7" y="27.5" width="9" height="3.5" rx="1.75" fill="#a5f3fc" fill-opacity=".55"/><rect x="18" y="27.5" width="15" height="3.5" rx="1.75" fill="#fff" fill-opacity=".38"/><path d="M6.5 20.5H13L16.2 13.5L20.4 26.5L23.8 17.5L26.5 20.5H33.5" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="33.5" cy="20.5" r="2.4" fill="#34d399"/></svg>`;
  const faviconHref = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;

  const outputHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="theme-color" content="#059669" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#0b1120" media="(prefers-color-scheme: dark)" />
  <title>PulsePlan — Company Roadmap &amp; Utilisation Planner</title>
  <link rel="manifest" href="./manifest.webmanifest" />
  <link rel="icon" type="image/svg+xml" href="${faviconHref}" />
  <link rel="apple-touch-icon" sizes="192x192" href="./icon-192.png" />
  <!-- Optional jsPDF & AutoTable for direct vector PDF export (gracefully falls back to browser print when offline) -->
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" integrity="sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <script defer src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js" integrity="sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
  <!-- Optional Inter Font (gracefully falls back to system UI font when offline) -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style id="pulseplan-offline-tailwind">
${tailwindCss}
  </style>
  <style id="pulseplan-theme">
${appCss.trim()}
  </style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased selection:bg-indigo-100 selection:text-indigo-900">
${bodyHtml.trimEnd()}
  <script>
${combinedJs.trimEnd()}
  </script>
</body>
</html>
`;

  fs.writeFileSync(path.join(ROOT, 'index.html'), outputHtml, 'utf8');
  console.log(`✅ Built index.html (${(outputHtml.length / 1024).toFixed(1)} KB) from ${jsFiles.length} JS modules + ${compiledCount} offline Tailwind utilities.`);
}

build();
