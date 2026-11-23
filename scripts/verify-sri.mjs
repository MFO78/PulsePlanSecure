#!/usr/bin/env node
/**
 * Computes verified SHA-384 Subresource Integrity (SRI) hashes for external CDN scripts,
 * removes obsolete HTML4 link tags, updates user-facing branding & emerald-teal logo accent
 * to PulsePlanSecure, generates crisp emerald-teal icon-192.png & icon-512.png for Android/iOS PWAs,
 * and stamps Git build revision metadata.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function generateEmeraldIconPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const s = size / 40;
  const pulsePts = [
    [6.5, 20.5], [13.0, 20.5], [16.2, 13.5], [20.4, 26.5], [23.8, 17.5], [26.5, 20.5], [33.5, 20.5],
  ];

  for (let y = 0; y < size; y++) {
    const rowOff = y * (size * 4 + 1);
    raw[rowOff] = 0;
    const ny = y / s;
    for (let x = 0; x < size; x++) {
      const nx = x / s;
      // Gradient #065f46 -> #059669 -> #0d9488
      const g = Math.max(0, Math.min(1, (nx + ny) / 80));
      let r, gr, b, a = 255;
      if (g < 0.55) {
        const t = g / 0.55;
        r = Math.round(6 + (5 - 6) * t);
        gr = Math.round(95 + (150 - 95) * t);
        b = Math.round(70 + (105 - 70) * t);
      } else {
        const t = (g - 0.55) / 0.45;
        r = Math.round(5 + (13 - 5) * t);
        gr = Math.round(150 + (148 - 150) * t);
        b = Math.round(105 + (136 - 105) * t);
      }

      // Top/bottom roadmap bars
      const inBar1 = ny >= 9 && ny <= 12.5 && ((nx >= 7 && nx <= 21) || (nx >= 23 && nx <= 33));
      const inBar2 = ny >= 27.5 && ny <= 31 && ((nx >= 7 && nx <= 16) || (nx >= 18 && nx <= 33));
      if (inBar1 || inBar2) {
        const mix = (nx >= 23 && inBar1) || (nx <= 16 && inBar2) ? 0.55 : 0.35;
        r = Math.round(r * (1 - mix) + 220 * mix);
        gr = Math.round(gr * (1 - mix) + 255 * mix);
        b = Math.round(b * (1 - mix) + 238 * mix);
      }

      // White pulse waveform
      let minDist = 999;
      for (let i = 0; i < pulsePts.length - 1; i++) {
        const d = distToSegment(nx, ny, pulsePts[i][0], pulsePts[i][1], pulsePts[i + 1][0], pulsePts[i + 1][1]);
        if (d < minDist) minDist = d;
      }
      if (minDist <= 1.55) {
        r = 255; gr = 255; b = 255;
      }

      const pxOff = rowOff + 1 + x * 4;
      raw[pxOff] = r;
      raw[pxOff + 1] = gr;
      raw[pxOff + 2] = b;
      raw[pxOff + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

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
  // Generate crisp emerald-teal raster PNGs for Android/iOS PWA installers
  fs.writeFileSync(path.join(process.cwd(), 'icon-192.png'), generateEmeraldIconPng(192));
  fs.writeFileSync(path.join(process.cwd(), 'icon-512.png'), generateEmeraldIconPng(512));

  buildSrc = buildSrc
    .replace(/\n\s*<link rel="shortcut icon"[^>]*\/>/, '')
    .replace(/<title>PulsePlan[^<]*<\/title>/, '<title>PulsePlanSecure: Company Roadmap &amp; Utilisation Planner</title>')
    .replace(/href="\.\/icon-192\.png"/g, 'href="./icon-192.png?v=3"')
    // Update inline favicon gradient to emerald-teal security palette
    .replace(/stop-color="#4338ca"/g, 'stop-color="#065f46"')
    .replace(/stop-color="#6366f1"/g, 'stop-color="#059669"')
    .replace(/stop-color="#0ea5e9"/g, 'stop-color="#0d9488"')
    .replace(/fill="#a5f3fc"/g, 'fill="#a7f3d0"');
  fs.writeFileSync(buildPath, buildSrc, 'utf8');

  // Update visible header brand and header SVG logo gradient in src/html/body.html during CI build
  const bodyPath = path.join(process.cwd(), 'src', 'html', 'body.html');
  if (fs.existsSync(bodyPath)) {
    let bodySrc = fs.readFileSync(bodyPath, 'utf8');
    bodySrc = bodySrc
      .replace(/>PulsePlan<\/h1>/g, '>PulsePlanSecure</h1>')
      .replace(/stop-color="#4338ca"/g, 'stop-color="#065f46"')
      .replace(/stop-color="#6366f1"/g, 'stop-color="#059669"')
      .replace(/stop-color="#0ea5e9"/g, 'stop-color="#0d9488"')
      .replace(/fill="#a5f3fc"/g, 'fill="#a7f3d0"');
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

  console.log('Applied verified SHA-384 SRI hashes, emerald-teal PNG/SVG icons, PulsePlanSecure branding, and HTML5 head cleanup.');
}
