#!/usr/bin/env node
/**
 * Benchmark: full book-mode render of a large synthetic ditamap.
 *
 * MapViewerProvider's book mode assembles ALL referenced topics into one
 * webview.html string in a single pass (see renderBookContent in
 * src/editor/MapViewerProvider.ts) -- there's no lazy loading or
 * virtualization. This script exists to answer, empirically, "does that
 * fall over at realistic-to-pathological document counts, and does it
 * scale linearly or blow up?" -- rather than guessing from reading the
 * code. Run it whenever a change touches the map/topic render path and
 * you want to know if it moved the needle.
 *
 * Usage:
 *   node scripts/bench-book-render.js [topicCount]
 *
 * Deliberately NOT wired into CI: this measures wall-clock time, which is
 * noisy across CI runners and isn't a pass/fail correctness signal. It's a
 * manual tool, not a regression gate.
 *
 * Findings as of 2026-08 (this sandbox, single run, informational only --
 * re-run locally rather than trusting these numbers going stale):
 *   2,000 topics: ~1.3s render, ~13MB HTML, ~160MB RSS
 *   5,000 topics: ~2.5s render, ~33MB HTML, ~265MB RSS
 *   Scaling is roughly linear in topic count for both time and memory --
 *   no quadratic blowup found (the assembly path already uses an array +
 *   join() rather than repeated string +=, which is the usual culprit).
 *   The real cost isn't the one-time render itself (a few seconds for a
 *   genuinely huge book is tolerable for an explicit action) -- it's that
 *   book mode has no memoization, so every debounced re-render triggered
 *   by ANY edit to ANY referenced topic redoes the full render from
 *   scratch. For a multi-thousand-topic book left open while iterating on
 *   one topic's wording, that's a multi-second stall on every pause in
 *   typing. Worth revisiting with a per-topic render cache (keyed on file
 *   path + mtime, same pattern as ditaRenderUtils.ts's imageDimensionsCache
 *   / keyMapCache) if this proves disruptive in real use -- not attempted
 *   here since it's a real behavioral change, not something to slip in
 *   under a benchmark script.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const esbuild = require('esbuild');

const TOPIC_COUNT = parseInt(process.argv[2] || '2000', 10);
const REPO_ROOT = path.resolve(__dirname, '..');

function mem() {
  const m = process.memoryUsage();
  return `rss=${(m.rss / 1048576).toFixed(1)}MB heap=${(m.heapUsed / 1048576).toFixed(1)}MB`;
}

function time(label, fn) {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  console.log(`${label}: ${(t1 - t0).toFixed(1)}ms  [${mem()}]`);
  return result;
}

function generateFixture(dir, n) {
  const topicsDir = path.join(dir, 'topics');
  fs.mkdirSync(topicsDir, { recursive: true });

  function topicXml(i) {
    const paras = [];
    for (let p = 0; p < 8; p++) {
      paras.push(
        `<p>Paragraph ${p} of topic ${i}. Some <b>bold</b> and <i>italic</i> text with a ` +
          `<xref href="topic${(i + 1) % n}.dita">cross reference</xref> and an ` +
          `<image href="../img/fig${i % 10}.png" alt="figure ${i}"/>.</p>`,
      );
    }
    const table =
      '<table><tgroup cols="3"><thead><row><entry>A</entry><entry>B</entry><entry>C</entry></row>' +
      '</thead><tbody><row><entry>1</entry><entry>2</entry><entry>3</entry></row></tbody></tgroup></table>';
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n<topic id="topic${i}">\n<title>Topic ${i}</title>\n` +
      `<body>\n${paras.join('\n')}\n${table}\n</body>\n</topic>`
    );
  }

  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(topicsDir, `topic${i}.dita`), topicXml(i));
  }

  const refs = [];
  for (let i = 0; i < n; i++) refs.push(`<topicref href="topics/topic${i}.dita"/>`);
  const mapXml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<map>\n<title>Benchmark Map (${n} topics)</title>\n` +
    `${refs.join('\n')}\n</map>`;
  const mapPath = path.join(dir, 'bench.ditamap');
  fs.writeFileSync(mapPath, mapXml);
  return mapPath;
}

function bundle(entry, outfile) {
  esbuild.buildSync({
    entryPoints: [path.join(REPO_ROOT, entry)],
    bundle: true,
    outfile,
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
  });
}

function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dita-bench-'));
  try {
    console.log(`Generating ${TOPIC_COUNT} synthetic topics in ${tmpDir} ...`);
    const mapPath = generateFixture(tmpDir, TOPIC_COUNT);

    const parserCjs = path.join(tmpDir, 'ditaParser.cjs');
    const renderUtilsCjs = path.join(tmpDir, 'ditaRenderUtils.cjs');
    const mapTypeMapCjs = path.join(tmpDir, 'mapTypeMap.cjs');
    bundle('src/parser/ditaParser.ts', parserCjs);
    bundle('src/editor/ditaRenderUtils.ts', renderUtilsCjs);
    bundle('src/render/mapTypeMap.ts', mapTypeMapCjs);

    const parserMod = require(parserCjs);
    const renderMod = require(renderUtilsCjs);
    const mapMod = require(mapTypeMapCjs);

    const docDir = tmpDir;
    const asWebviewUri = (rel) => `vscode-webview://x/${rel}`;

    console.log(`--- bench start [${mem()}] ---`);

    const rawXml = fs.readFileSync(mapPath, 'utf-8');
    const pre = time('preprocessEntities', () => parserMod.preprocessEntities(rawXml));
    const mapDoc = time('parseDitamap', () => parserMod.parseDitamap(pre));
    time('expandDitamapRefs', () => renderMod.expandDitamapRefs(mapDoc.root, docDir));
    const entries = time('collectMapEntries', () => mapMod.collectMapEntries(mapDoc.root, () => undefined));
    console.log(`entries collected: ${entries.length}`);

    const parts = time('renderTopicToHtml x N (book assembly)', () => {
      const out = [];
      const visited = new Set();
      for (const entry of entries) {
        if (!entry.href) continue;
        const absPath = path.resolve(docDir, entry.href.split('#')[0]);
        if (visited.has(absPath)) continue;
        visited.add(absPath);
        const result = renderMod.renderTopicToHtml({
          filePath: absPath,
          keyMap: new Map(),
          asWebviewUri,
          headingLevel: Math.min(1 + entry.depth, 6),
          uiLanguage: 'en',
        });
        out.push(result.html || '');
      }
      return out;
    });

    const finalHtml = time('string concat', () => parts.join(''));
    console.log(`final HTML size: ${(finalHtml.length / 1048576).toFixed(2)}MB`);
    console.log(`--- bench end [${mem()}] ---`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
