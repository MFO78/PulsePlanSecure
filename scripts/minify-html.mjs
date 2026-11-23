#!/usr/bin/env node
/**
 * Safe zero-dependency whitespace/comment optimiser for compiled index.html.
 * Strips CSS block comments inside <style> blocks and trims leading indentation
 * without altering JavaScript string literals or template strings.
 */
import fs from 'node:fs';
import path from 'node:path';

const htmlPath = path.join(process.cwd(), 'index.html');
const original = fs.readFileSync(htmlPath, 'utf8');

let optimised = original.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_m, attrs, css) => {
  const cleanCss = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return `<style${attrs}>${cleanCss}</style>`;
});

optimised = optimised.replace(/<!--(?!\s*\[)[\s\S]*?-->/g, (m, offset, str) => {
  const before = str.slice(0, offset);
  const lastScriptOpen = before.lastIndexOf('<script');
  const lastScriptClose = before.lastIndexOf('</script>');
  if (lastScriptOpen > lastScriptClose) return m;
  return '';
});

fs.writeFileSync(htmlPath, optimised, 'utf8');
const savedKb = ((original.length - optimised.length) / 1024).toFixed(1);
console.log(`Optimised index.html: ${(original.length / 1024).toFixed(1)} KB -> ${(optimised.length / 1024).toFixed(1)} KB (saved ${savedKb} KB).`);
