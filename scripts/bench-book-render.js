#!/usr/bin/env node
/**
 * Benchmark: full book-mode render of a large synthetic ditamap.
 *
 * Book mode assembles ALL referenced topics into one webview.html string in a
 * single pass (renderBookEntries in src/editor/ditaRenderUtils.ts, called by
 * MapViewerProvider.renderBookContent) -- there's no lazy loading or
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
 * Findings as of 2026-09 (this machine, single runs, informational only --
 * re-run locally rather than trusting these numbers going stale):
 *   Scaling is roughly linear in topic count for both time and memory -- no
 *   quadratic blowup (the assembly path uses an array + join() rather than
 *   repeated string +=, which is the usual culprit). A 2,000-topic book is
 *   ~15MB of HTML and ~250MB RSS at the end of a pass.
 *   The cost that actually hurt was never the one-time render -- a second or
 *   two for a genuinely huge book is tolerable for an explicit action. It was
 *   that book mode had no memoization, so every debounced re-render triggered
 *   by ANY edit to ANY referenced topic redid the whole book from scratch:
 *   a multi-second stall on every pause in typing.
 *
 *   That is now fixed by renderTopicCached (src/editor/ditaRenderUtils.ts),
 *   which keys each topic's HTML on the mtime of every file the render
 *   actually read -- the topic itself, each conref target, each file an xref
 *   title came from, each image whose dimensions were emitted. So the
 *   interesting measurement is no longer the cold pass but the repeats, and
 *   this script measures three:
 *     pass 1  cold cache -- the fix's whole overhead, and a stand-in for what
 *             an uncached render of the same book cost before it (measured
 *             side by side once: 1943ms cold vs 1915ms uncached at 2,000)
 *     pass 2  nothing changed -- pure reuse
 *     pass 3  ONE topic edited -- the real workload: typing in a book that is
 *             already open
 *
 *   All three call renderBookEntries, the shipped assembly loop that
 *   MapViewerProvider.renderBookContent also calls. This script used to keep
 *   its own hand-copy of that loop, and it had already drifted once (it built
 *   a fresh keyMap per topic); once rendering became cached, that drift would
 *   have measured zero reuse and reported a working fix as a failure.
 *
 *     topics    cold(1)   unchanged(2)   one edit(3)   cache held
 *        100       92ms           5.8ms         7.2ms      0.75MB
 *        300      265ms            20ms          20ms       2.25MB
 *       2000     1638ms           132ms         140ms      15.03MB
 *   Re-rendering an already-open book costs roughly a tenth of what it did,
 *   12-16x, at every size measured. Note that passes 2 and 3 land within
 *   noise of each other everywhere: what is left is not rendering but mtime
 *   validation -- one statSync per recorded dependency per topic -- so that is
 *   where the next win in this path lives, not in the render itself.
 *   A 2,000-topic book holds 15MB of the 32MB budget, i.e. the whole book
 *   stays cached with room for a second one; the budget is bytes rather than
 *   an entry count precisely so a book bigger than the count cap could not
 *   fall off a cliff into zero reuse (a cyclic pass is LRU's worst case).
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

const timings = [];

function time(label, fn) {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  timings.push({ label, ms: t1 - t0 });
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
    // Stands in for webview.asWebviewUri, which maps an absolute path onto a
    // fixed https authority with no panel identity in it -- so a stub of the
    // same shape measures the same work.
    const fileToWebviewUri = (absPath) => `https://file+.vscode-resource.vscode-cdn.net${encodeURI(absPath)}`;

    console.log(`--- bench start [${mem()}] ---`);

    const rawXml = fs.readFileSync(mapPath, 'utf-8');
    const pre = time('preprocessEntities', () => parserMod.preprocessEntities(rawXml));
    const mapDoc = time('parseDitamap', () => parserMod.parseDitamap(pre));
    time('expandDitamapRefs', () => renderMod.expandDitamapRefs(mapDoc.root, docDir));
    const entries = time('collectMapEntries', () => mapMod.collectMapEntries(mapDoc.root, () => undefined));
    console.log(`entries collected: ${entries.length}`);

    // The shipped assembly loop, not a copy of it: renderBookEntries is what
    // MapViewerProvider.renderBookContent calls. One keyMap instance for the
    // whole pass, same as there -- renderTopicCached compares it by identity,
    // so a fresh Map per pass would measure zero reuse.
    const keyMap = new Map();
    const renderBook = () =>
      renderMod.renderBookEntries({ entries, docDir, keyMap, fileToWebviewUri, uiLanguage: 'en' });

    renderMod.clearTopicRenderCache();
    time('pass 1: renderBookEntries (cold cache)', renderBook);
    time('pass 2: renderBookEntries (nothing changed)', renderBook);

    // The workload that actually matters: the book is open, the author edits
    // one topic, the debounce fires and the whole map re-renders. Note this
    // invalidates more than the one file -- the fixture has every topic xref
    // the next one, so the topic pointing AT the edited one resolves its
    // title from that file and is (correctly) re-rendered too.
    const edited = path.join(docDir, 'topics', 'topic0.dita');
    fs.writeFileSync(
      edited,
      fs.readFileSync(edited, 'utf-8').replace('Paragraph 0 of topic 0', 'Paragraph 0 of topic 0 (edited)'),
    );
    const finalHtml = time('pass 3: renderBookEntries (one topic edited)', renderBook);

    console.log(`final HTML size: ${(finalHtml.length / 1048576).toFixed(2)}MB`);
    // Stale output is the one way this cache can actually be wrong, and the
    // unit tests only exercise it a few topics at a time -- so fail loudly
    // here, where the edit is one topic among thousands.
    if (!finalHtml.includes('(edited)')) {
      console.error('FAIL: the edited topic was served from cache -- the render cache is returning stale HTML');
      process.exitCode = 1;
    } else {
      console.log('edited topic correctly re-rendered into the assembled book');
    }
    console.log(
      `topic cache: ${renderMod.topicRenderCacheSize()} entries, ` +
        `${(renderMod.topicRenderCacheBytesHeld() / 1048576).toFixed(2)}MB held of ` +
        `${(renderMod.TOPIC_RENDER_CACHE_MAX_BYTES / 1048576).toFixed(0)}MB budget`,
    );

    const msOf = (prefix) => {
      const found = timings.find((t) => t.label.startsWith(prefix));
      return found ? found.ms : NaN;
    };
    const coldMs = msOf('pass 1');
    const warmMs = msOf('pass 2');
    const editMs = msOf('pass 3');
    console.log('--- summary ---');
    console.log(`cold pass (fills the cache): ${coldMs.toFixed(1)}ms -- this is the fix's whole overhead, and stands in for what an uncached render of the same book cost before it`);
    console.log(`unchanged re-render: ${(coldMs / warmMs).toFixed(1)}x faster than cold (${warmMs.toFixed(1)}ms)`);
    console.log(`after one topic edited: ${(coldMs / editMs).toFixed(1)}x faster than cold (${editMs.toFixed(1)}ms)`);
    console.log(`--- bench end [${mem()}] ---`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
