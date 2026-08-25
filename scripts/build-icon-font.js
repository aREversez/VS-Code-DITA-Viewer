#!/usr/bin/env node
/**
 * Builds media/fonts/dita-viewer-icons.woff from the source SVGs in
 * media/icon-font-src/. Each SVG becomes one glyph, in a fixed order,
 * assigned sequential Private Use Area codepoints starting at U+E900.
 *
 * Run: node scripts/build-icon-font.js
 * (add/remove an icon by editing ICONS below and the corresponding
 * fontCharacter values in package.json's `contributes.icons`)
 *
 * Why this exists instead of using an off-the-shelf SVG->font CLI
 * (e.g. fantasticon): that toolchain (svgicons2svgfont -> svg2ttf ->
 * cubic2quad) produces NaN glyph outlines for some of our icon shapes
 * (reproducible even on a single, simple rounded-rect path with no
 * arcs) -- a bug in its cubic-to-quadratic curve degree reduction, not
 * something fixable by adjusting our SVGs. This script does that
 * reduction itself with a simple, unconditional formula (De Casteljau
 * subdivision + endpoint-tangent-matching quadratic fit) that has no
 * division-by-difference and therefore no degenerate branch to hit.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const svgpath = require('svgpath');
const opentype = require('opentype.js');
const ttf2woff = require('ttf2woff');

const SRC_DIR = path.join(__dirname, '..', 'media', 'icon-font-src');
const OUT_DIR = path.join(__dirname, '..', 'media', 'fonts');
const OUT_WOFF = path.join(OUT_DIR, 'dita-viewer-icons.woff');

// Order defines codepoint assignment: index 0 -> U+E900, index 1 -> U+E901, etc.
// Must match the fontCharacter values under contributes.icons in package.json.
const ICONS = ['preview', 'map-preview', 'transform'];
const PUA_START = 0xe900;

const UNITS_PER_EM = 1000;
const ASCENDER = 850;
const DESCENDER = -150;
const SVG_SIZE = 16;
const MARGIN = 60;
const SCALE = (UNITS_PER_EM - 2 * MARGIN) / SVG_SIZE;

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function subdivideCubic(p0, p1, p2, p3, t) {
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const p0123 = lerp(p012, p123, t);
  return [
    [p0, p01, p012, p0123],
    [p0123, p123, p23, p3],
  ];
}

// Endpoint-tangent-matching single-quadratic fit for a cubic segment.
// Fixed linear combination (always /4) -- no singular/degenerate branch.
function quadFromCubic(p0, p1, p2, p3) {
  return {
    x: (-p0.x + 3 * p1.x + 3 * p2.x - p3.x) / 4,
    y: (-p0.y + 3 * p1.y + 3 * p2.y - p3.y) / 4,
  };
}

function cubicToTwoQuads(p0, p1, p2, p3) {
  const [left, right] = subdivideCubic(p0, p1, p2, p3, 0.5);
  return [
    { ctrl: quadFromCubic(...left), end: left[3] },
    { ctrl: quadFromCubic(...right), end: right[3] },
  ];
}

function svgPathToGlyphPath(dAttr, transform) {
  const abs = svgpath(dAttr).abs().unarc().unshort();
  const p = new opentype.Path();
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };

  abs.iterate((seg) => {
    const cmd = seg[0];
    const tp = (x, y) => transform({ x, y });
    switch (cmd) {
      case 'M': {
        cur = { x: seg[1], y: seg[2] };
        start = cur;
        const t = tp(cur.x, cur.y);
        p.moveTo(t.x, t.y);
        break;
      }
      case 'L': {
        const next = { x: seg[1], y: seg[2] };
        const t = tp(next.x, next.y);
        p.lineTo(t.x, t.y);
        cur = next;
        break;
      }
      case 'H': {
        const next = { x: seg[1], y: cur.y };
        const t = tp(next.x, next.y);
        p.lineTo(t.x, t.y);
        cur = next;
        break;
      }
      case 'V': {
        const next = { x: cur.x, y: seg[1] };
        const t = tp(next.x, next.y);
        p.lineTo(t.x, t.y);
        cur = next;
        break;
      }
      case 'C': {
        const p0 = cur;
        const p1 = { x: seg[1], y: seg[2] };
        const p2 = { x: seg[3], y: seg[4] };
        const p3 = { x: seg[5], y: seg[6] };
        for (const q of cubicToTwoQuads(p0, p1, p2, p3)) {
          const tc = tp(q.ctrl.x, q.ctrl.y);
          const te = tp(q.end.x, q.end.y);
          p.quadraticCurveTo(tc.x, tc.y, te.x, te.y);
        }
        cur = p3;
        break;
      }
      case 'Q': {
        const c = { x: seg[1], y: seg[2] };
        const e = { x: seg[3], y: seg[4] };
        const tc = tp(c.x, c.y);
        const te = tp(e.x, e.y);
        p.quadraticCurveTo(tc.x, tc.y, te.x, te.y);
        cur = e;
        break;
      }
      case 'Z': {
        p.close();
        cur = start;
        break;
      }
      default:
        throw new Error(`Unsupported path command after unarc/unshort: ${cmd}`);
    }
  });
  return p;
}

function svgToGlyphPath(svgFile) {
  const xml = fs.readFileSync(svgFile, 'utf8');
  const $ = cheerio.load(xml, { xmlMode: true });
  const glyphPath = new opentype.Path();
  $('path').each((_, el) => {
    const d = $(el).attr('d');
    const sub = svgPathToGlyphPath(d, ({ x, y }) => ({
      x: MARGIN + x * SCALE,
      y: UNITS_PER_EM - MARGIN - y * SCALE - (UNITS_PER_EM - ASCENDER + DESCENDER) / 2,
    }));
    for (const cmd of sub.commands) glyphPath.commands.push(cmd);
  });
  return glyphPath;
}

function main() {
  const notdefGlyph = new opentype.Glyph({
    name: '.notdef',
    unicode: 0,
    advanceWidth: UNITS_PER_EM,
    path: new opentype.Path(),
  });

  const glyphs = [notdefGlyph];
  const report = [];

  ICONS.forEach((name, i) => {
    const svgFile = path.join(SRC_DIR, `${name}.svg`);
    const cp = PUA_START + i;
    const glyphPath = svgToGlyphPath(svgFile);
    glyphs.push(
      new opentype.Glyph({
        name,
        unicode: cp,
        advanceWidth: UNITS_PER_EM,
        path: glyphPath,
      })
    );
    report.push(`  ${name}: U+${cp.toString(16).toUpperCase()}`);
  });

  const font = new opentype.Font({
    familyName: 'dita-viewer-icons',
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: ASCENDER,
    descender: DESCENDER,
    glyphs,
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ttfBuf = Buffer.from(font.toArrayBuffer());
  const woffBuf = Buffer.from(ttf2woff(ttfBuf).buffer);
  fs.writeFileSync(OUT_WOFF, woffBuf);

  console.log(`Wrote ${path.relative(process.cwd(), OUT_WOFF)}`);
  console.log('Codepoints (must match contributes.icons in package.json):');
  console.log(report.join('\n'));
}

main();
