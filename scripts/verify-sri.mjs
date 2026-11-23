#!/usr/bin/env node
/**
 * Computes verified SHA-384 Subresource Integrity (SRI) hashes for external CDN scripts.
 * Usage: node scripts/verify-sri.mjs
 */
import { createHash } from 'node:crypto';

const SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

for (const url of SCRIPTS) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${url}: HTTP ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = createHash('sha384').update(bytes).digest('base64');
  console.log(`<script defer src="${url}" integrity="sha384-${hash}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`);
}
