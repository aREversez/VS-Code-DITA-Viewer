const fs = require('fs');
const { PNG } = require('pngjs');

const S = 128;
const png = new PNG({ width: S, height: S });

function px(x, y, r, g, b, a) {
  const i = (y * S + x) * 4;
  png.data[i] = r; png.data[i+1] = g; png.data[i+2] = b; png.data[i+3] = a;
}

function fill(x0, y0, w, h, r, g, b, a) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) px(x, y, r, g, b, a);
}

function rr(x0, y0, w, h, rad, r, g, b, a) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      let ok = true;
      if      (x < x0+rad && y < y0+rad)       ok = (x-x0-rad+.5)**2 + (y-y0-rad+.5)**2 <= rad*rad;
      else if (x >= x0+w-rad && y < y0+rad)    ok = (x-x0-w+rad+.5)**2 + (y-y0-rad+.5)**2 <= rad*rad;
      else if (x < x0+rad && y >= y0+h-rad)    ok = (x-x0-rad+.5)**2 + (y-y0-h+rad+.5)**2 <= rad*rad;
      else if (x >= x0+w-rad && y >= y0+h-rad) ok = (x-x0-w+rad+.5)**2 + (y-y0-h+rad+.5)**2 <= rad*rad;
      if (ok) px(x, y, r, g, b, a);
    }
}

function circle(cx, cy, rad, r, g, b, a) {
  for (let y = cy - rad; y <= cy + rad; y++)
    for (let x = cx - rad; x <= cx + rad; x++)
      if ((x - cx + .5)**2 + (y - cy + .5)**2 <= rad*rad) px(x, y, r, g, b, a);
}

// Background rounded rect (soft blue)
rr(6, 6, 116, 116, 10, 74, 125, 181, 255);

// Document page
rr(28, 18, 44, 56, 2, 255, 255, 255, 242);

// Text lines
const tc = [160, 160, 160, 170];
fill(32, 26, 36, 3, ...tc);
fill(32, 34, 36, 2, ...tc);
fill(32, 40, 36, 2, ...tc);
fill(32, 46, 36, 2, ...tc);
fill(32, 54, 24, 2, ...tc);
fill(32, 60, 36, 2, ...tc);

// Gold circle with D
rr(76, 40, 40, 40, 20, 232, 168, 56, 255);

const D = [
  [1,1,1,1,1,0,0],
  [1,0,0,0,1,1,0],
  [1,0,0,0,0,1,1],
  [1,0,0,0,0,0,1],
  [1,0,0,0,0,0,1],
  [1,0,0,0,0,0,1],
  [1,0,0,0,0,1,1],
  [1,0,0,0,1,1,0],
  [1,1,1,1,1,0,0],
];
for (let r = 0; r < 9; r++)
  for (let c = 0; c < 7; c++)
    if (D[r][c]) px(93 + c, 56 + r, 255, 255, 255, 255);

const buf = PNG.sync.write(png);
fs.writeFileSync('media/icons/extension-icon.png', buf);
console.log('OK');
