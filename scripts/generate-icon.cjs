// Generates media/icons/extension-icon.png (the VS Code Marketplace icon,
// referenced by package.json's top-level "icon" field — must be a PNG, SVG
// isn't accepted there) directly from media/icons/extension-icon.svg,
// which is the actual source of truth for this icon's design.
//
// An earlier version of this script hand-rasterized the design pixel by
// pixel (rounded rects, rotated rects, bezier-stroked curves, ...) instead
// of rendering the SVG itself. That hand-rolled code did not exactly
// reproduce what the SVG specifies (confirmed by rendering the same SVG
// through an independent renderer and comparing pixel colors), so the two
// could silently drift apart. Rendering the SVG directly with `sharp`
// (which uses a real SVG rendering engine) instead makes the PNG
// mechanically guaranteed to match the SVG — there's only one design to
// keep in sync, not two independent implementations of it.
const path = require('path');
const sharp = require('sharp');

const SIZE = 256; // VS Code recommends at least 128x128; render at 2x for a crisper Marketplace listing
const svgPath = path.join(__dirname, '..', 'media', 'icons', 'extension-icon.svg');
const pngPath = path.join(__dirname, '..', 'media', 'icons', 'extension-icon.png');

sharp(svgPath, { density: 96 * (SIZE / 128) })
  .resize(SIZE, SIZE)
  .png()
  .toFile(pngPath)
  .then(() => console.log(`Wrote media/icons/extension-icon.png (${SIZE}x${SIZE}, rendered from extension-icon.svg)`))
  .catch((err) => {
    console.error('Failed to render extension-icon.png from SVG:', err);
    process.exit(1);
  });
