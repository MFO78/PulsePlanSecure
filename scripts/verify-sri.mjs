#!/usr/bin/env node
/**
 * Computes verified SHA-384 Subresource Integrity (SRI) hashes for external CDN scripts,
 * removes obsolete HTML4 link tags, updates user-facing branding to PulsePlanSecure,
 * and stamps Git build revision metadata.
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
  buildSrc = buildSrc
    .replace(/\n\s*<link rel="shortcut icon"[^>]*\/>/, '')
    .replace(/<title>PulsePlan[^<]*<\/title>/, '<title>PulsePlanSecure: Company Roadmap &amp; Utilisation Planner</title>');
  fs.writeFileSync(buildPath, buildSrc, 'utf8');

  // Update visible header brand in src/html/body.html during CI build
  const bodyPath = path.join(process.cwd(), 'src', 'html', 'body.html');
  if (fs.existsSync(bodyPath)) {
    let bodySrc = fs.readFileSync(bodyPath, 'utf8');
    bodySrc = bodySrc.replace(/>PulsePlan<\/h1>/g, '>PulsePlanSecure</h1>');
    fs.writeFileSync(bodyPath, bodySrc, 'utf8');
  }

  // Update visible User Manual title in src/js/11-manual.js during CI build
  const manualPath = path.join(process.cwd(), 'src', 'js', '11-manual.js');
  if (fs.existsSync(manualPath)) {
    let manualSrc = fs.readFileSync(manualPath, 'utf8');
    manualSrc = manualSrc.replace(/PulsePlan User Manual/g, 'PulsePlanSecure User Manual');
    fs.writeFileSync(manualPath, manualSrc, 'utf8');
  }

  // Stamp short Git SHA and UTC date into src/js/13-security-licence.js
  const secPath = path.join(process.cwd(), 'src', 'js', '13-security-licence.js');
  if (fs.existsSync(secPath)) {
    const sha = (process.env.GITHUB_SHA || 'local').slice(0, 7);
    const builtAt = new Date().toISOString().slice(0, 10);
    let secSrc = fs.readFileSync(secPath, 'utf8');
    secSrc = secSrc.replace(/__PP_BUILD_SHA__/g, sha).replace(/__PP_BUILD_DATE__/g, builtAt);
    fs.writeFileSync(secPath, secSrc, 'utf8');
    console.log(`Stamped build revision: ${sha} (${builtAt}).`);
  }

  console.log('Applied verified SHA-384 SRI hashes, PulsePlanSecure branding, and HTML5 head cleanup.');
}
