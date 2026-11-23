#!/usr/bin/env node
/**
 * Computes verified SHA-384 Subresource Integrity (SRI) hashes for external CDN scripts.
 * Usage:
 *   node scripts/verify-sri.mjs          # print verified <script> tags
 *   node scripts/verify-sri.mjs --apply  # patch build.mjs in-place with SRI + remove obsolete shortcut icon
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

const apply = process.argv.includes('--apply');
const buildPath = path.join(process.cwd(), 'build.mjs');
let buildSrc = apply ? fs.readFileSync(buildPath, 'utf8') : '';

for (const url of SCRIPTS) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${url}: HTTP ${res.status}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = createHash('sha384').update(bytes).digest('base64');
  const tag = `<script defer src="${url}" integrity="sha384-${hash}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
  console.log(tag);

  if (apply) {
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<script[^>]*src="${escapedUrl}"[^>]*><\\/script>`);
    if (re.test(buildSrc)) {
      buildSrc = buildSrc.replace(re, tag);
    } else {
      console.error(`Could not locate script tag for ${url} in build.mjs`);
      process.exit(1);
    }
  }
}

if (apply) {
  // Remove obsolete HTML5 shortcut icon link
  buildSrc = buildSrc.replace(/\n\s*<link rel="shortcut icon"[^>]*\/>/, '');
  fs.writeFileSync(buildPath, buildSrc, 'utf8');
  console.log('Applied verified SHA-384 SRI hashes and removed obsolete shortcut icon from build.mjs.');
}
