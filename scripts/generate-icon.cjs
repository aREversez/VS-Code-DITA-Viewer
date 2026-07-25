// Generates media/icons/extension-icon.png (the VS Code Marketplace icon,
// referenced by package.json's top-level "icon" field — must be a PNG, SVG
// isn't accepted there).
//
// Design: a stack of topic "cards" fanned out slightly behind a front
// document (folded top-right corner, three content lines) — representing
// DITA's core idea of individual topics assembled together into a larger
// piece of content. Kept to one warm neutral tan/beige family + white, no
// gradients, no letter badge.
//
// Pure JS + pngjs, no external image tooling required to regenerate this.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const S = 128;
const SS = 4; // supersample factor for smoother rotated edges, downscaled at the end
const W = S * SS;
const png = new PNG({ width: W, height: W });

function px(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
}

function rr(x0, y0, w, h, rad, r, g, b, a) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      let ok = true;
      if      (x < x0 + rad && y < y0 + rad)           ok = (x - x0 - rad + .5) ** 2 + (y - y0 - rad + .5) ** 2 <= rad * rad;
      else if (x >= x0 + w - rad && y < y0 + rad)      ok = (x - x0 - w + rad + .5) ** 2 + (y - y0 - rad + .5) ** 2 <= rad * rad;
      else if (x < x0 + rad && y >= y0 + h - rad)      ok = (x - x0 - rad + .5) ** 2 + (y - y0 - h + rad + .5) ** 2 <= rad * rad;
      else if (x >= x0 + w - rad && y >= y0 + h - rad) ok = (x - x0 - w + rad + .5) ** 2 + (y - y0 - h + rad + .5) ** 2 <= rad * rad;
      if (ok) px(x, y, r, g, b, a);
    }
}

function fillRect(x0, y0, w, h, rad, r, g, b, a) {
  rr(x0, y0, w, h, rad, r, g, b, a);
}

// A rounded rectangle of size w×h, centered at (cx, cy), rotated by
// angleDeg around its own center — used for the two "shadow" cards fanned
// out slightly behind the front document.
function rotatedRoundedRect(cx, cy, w, h, rad, angleDeg, r, g, b, a) {
  const angle = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const halfW = w / 2, halfH = h / 2;
  const diag = Math.sqrt(w * w + h * h) / 2 + 4;
  const minX = Math.floor(cx - diag), maxX = Math.ceil(cx + diag);
  const minY = Math.floor(cy - diag), maxY = Math.ceil(cy + diag);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx, dy = y - cy;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const ax = Math.abs(lx), ay = Math.abs(ly);
      let inside;
      if (ax <= halfW - rad || ay <= halfH - rad) {
        inside = ax <= halfW && ay <= halfH;
      } else {
        const cdx = ax - (halfW - rad);
        const cdy = ay - (halfH - rad);
        inside = cdx * cdx + cdy * cdy <= rad * rad;
      }
      if (inside) px(x, y, r, g, b, a);
    }
  }
}

// Document silhouette with a folded top-right corner: full body rect minus
// the corner triangle (left showing the background through), plus a
// smaller, lighter triangle representing the folded flap itself.
function foldedDocument(x0, y0, w, h, fold, rBody, gBody, bBody, rFlap, gFlap, bFlap) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const inFoldCorner = x >= x0 + w - fold && y < y0 + fold && (x - (x0 + w - fold)) > (fold - (y - y0));
      if (inFoldCorner) continue;
      px(x, y, rBody, gBody, bBody, 255);
    }
  }
  for (let y = y0; y < y0 + fold; y++) {
    for (let x = x0 + w - fold; x < x0 + w; x++) {
      const localX = x - (x0 + w - fold);
      const localY = y - y0;
      if (localX <= localY) px(x, y, rFlap, gFlap, bFlap, 255);
    }
  }
}

function scaled(coords) {
  return coords.map((v) => v * SS);
}

// ── Background ──
rr(0, 0, W, W, 28 * SS, 242, 236, 225, 255); // #F2ECE1, warm cream

// ── Two shadow cards, fanned out slightly behind the front document ──
rotatedRoundedRect(...scaled([60, 79]), ...scaled([52, 66]), 8 * SS, -8, 216, 203, 180, 255); // #D8CBB4
rotatedRoundedRect(...scaled([68, 73]), ...scaled([52, 66]), 8 * SS, 5, 185, 154, 122, 255); // #B99A7A

// ── Front document, folded top-right corner ──
foldedDocument(...scaled([46, 34]), ...scaled([38, 66]), 12 * SS, 255, 255, 255, 237, 230, 216);

// ── Content lines ──
fillRect(...scaled([52, 66]), ...scaled([26, 5]), 2.5 * SS, 199, 169, 139, 255); // #C7A98B
fillRect(...scaled([52, 78]), ...scaled([26, 5]), 2.5 * SS, 199, 169, 139, 255);
fillRect(...scaled([52, 90]), ...scaled([18, 5]), 2.5 * SS, 199, 169, 139, 255);

// ── Downscale supersampled buffer to the final 128x128 output ──
const out = new PNG({ width: S, height: S });
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const si = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += png.data[si]; g += png.data[si + 1]; b += png.data[si + 2]; a += png.data[si + 3];
      }
    }
    const n = SS * SS;
    const oi = (y * S + x) * 4;
    out.data[oi] = Math.round(r / n);
    out.data[oi + 1] = Math.round(g / n);
    out.data[oi + 2] = Math.round(b / n);
    out.data[oi + 3] = Math.round(a / n);
  }
}

const buf = PNG.sync.write(out);
fs.writeFileSync(path.join(__dirname, '..', 'media', 'icons', 'extension-icon.png'), buf);
console.log('Wrote media/icons/extension-icon.png');
