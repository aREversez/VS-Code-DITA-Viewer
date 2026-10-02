// End-to-end sanity check: parse + render the OASIS spec's imagemap example
// exactly the way DitaViewerProvider does (same RenderContext shape), and
// print the resulting HTML for manual inspection.
const { parseDita, preprocessEntities } = require('../dist-test/parser/ditaParser');
const { renderDocument } = require('../dist-test/render/renderer');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="world-map-topic">
  <title>Click the world map</title>
  <body>
    <imagemap>
      <image href="imagemapworld.jpg" width="300" height="200">
        <alt>Map of the world showing 5 areas</alt>
      </image>
      <area><shape>rect</shape><coords>2,0,53,59</coords>
        <xref href="#section-1">Section 1 alternative text</xref>
      </area>
      <area><shape>circle</shape><coords>120,154,29</coords>
        <xref format="html" href="test.html">Link to a test html file</xref>
      </area>
      <area><shape>poly</shape>
        <coords>246,39,200,35,173,52,177,86,215,90,245,84,254,65</coords>
        <xref format="pdf" href="test.pdf">Link to a test PDF file</xref>
      </area>
    </imagemap>
    <section id="section-1"><title>Section 1</title><p>Target of the first hotspot.</p></section>
  </body>
</topic>`;

const ctx = {
  headingLevel: 1,
  asWebviewUri: (p) => `https://webview-resources/${encodeURIComponent(p)}`,
  documentDir: '/test',
};

const doc = parseDita(preprocessEntities(xml));
const html = renderDocument(doc.root, ctx);
console.log(html);
console.log('\n--- checks ---');
const checks = [
  ['img has usemap', /<img[^>]*usemap="#dita-imagemap-\d+"/.test(html)],
  ['map present', /<map name="dita-imagemap-\d+" id="dita-imagemap-\d+">/.test(html)],
  ['3 area elements', (html.match(/<area\b/g) || []).length === 3],
  ['anchor area href', html.includes('href="#section-1"')],
  ['no visible shape/coords text', !/>rect<|>circle<|>poly<|>2,0,53,59<|>120,154,29</.test(html)],
  ['no figgroup wrapper', !html.includes('class="figgroup"')],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
