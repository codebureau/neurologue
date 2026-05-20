#!/usr/bin/env node
'use strict';

/**
 * Renders design/neurologue.svg into build/icon.png (1024×1024)
 * and build/icon.ico (256, 128, 64, 48, 32, 16 px layers).
 *
 * Usage: node scripts/render-icons.js
 * (or: npm run icons)
 */

const { Resvg }  = require('@resvg/resvg-js');
const _pngToIco  = require('png-to-ico');
const pngToIco   = _pngToIco.default || _pngToIco;
const fs         = require('fs');
const path       = require('path');

const SVG_PATH  = path.join(__dirname, '..', 'design', 'neurologue.svg');
const BUILD_DIR = path.join(__dirname, '..', 'build');

// The SVG viewBox is 460×437.  Centre it in a square viewport so icons
// render square without distortion (shift content down by half the diff).
const PAD_TOP = (460 - 437) / 2; // 11.5 px

function squareSvg(raw) {
  return raw
    .replace('width="100%" height="100%"', 'width="460" height="460"')
    .replace('viewBox="0 0 460 437"',       `viewBox="0 -${PAD_TOP} 460 460"`);
}

async function renderPng(svgBuffer, size) {
  const resvg = new Resvg(svgBuffer, {
    fitTo: { mode: 'width', value: size },
  });
  return resvg.render().asPng();
}

async function main() {
  if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR, { recursive: true });

  const raw      = fs.readFileSync(SVG_PATH, 'utf8');
  const svgBuf   = Buffer.from(squareSvg(raw));

  const SIZES    = [1024, 512, 256, 128, 64, 48, 32, 16];
  const pngMap   = {};

  console.log('Rendering sizes…');
  for (const size of SIZES) {
    process.stdout.write(`  ${size}×${size} … `);
    pngMap[size] = await renderPng(svgBuf, size);
    process.stdout.write('done\n');
  }

  // ── icon.png (1024) ────────────────────────────────────────────────────
  const pngOut = path.join(BUILD_DIR, 'icon.png');
  fs.writeFileSync(pngOut, pngMap[1024]);
  console.log(`\nWrote ${pngOut}`);

  // ── icon.ico (multi-size) ─────────────────────────────────────────────
  const icoSizes  = [256, 128, 64, 48, 32, 16];
  const icoBuf    = await pngToIco(icoSizes.map(s => pngMap[s]));
  const icoOut    = path.join(BUILD_DIR, 'icon.ico');
  fs.writeFileSync(icoOut, icoBuf);
  console.log(`Wrote ${icoOut}`);

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
