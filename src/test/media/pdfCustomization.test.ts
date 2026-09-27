import * as assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import sax from 'sax';

// dist-test/test/media/pdfCustomization.test.js -> repo root is three levels up.
const customizationRoot = join(__dirname, '..', '..', '..', 'media', 'pdf-customization');

/**
 * Parses `xml` with the same strict sax parser src/parser/ditaParser.ts uses,
 * throwing on any error instead of recovering. Every file DITA-OT loads for
 * the `pdf` customization is plain XML: it has to parse, not just look
 * roughly right in a regex. A comment containing the two-character sequence
 * `--` (e.g. an ASCII dash used as an em-dash in prose) is well-formed to a
 * casual eye and to a text matcher, but is an XML spec violation that makes
 * the whole file unparseable -- which, for a customization file, means
 * DITA-OT silently skips it and the default, un-fixed styling is used with no
 * error surfaced to the user.
 */
function parseStrictXml(xml: string, label: string): void {
  const parser = sax.parser(true, { trim: false, normalize: false });
  parser.onerror = (err) => {
    throw new Error(`${label}: SAX parse error at line ${parser.line}:${parser.column}: ${err.message}`);
  };
  parser.write(xml).close();
}

/**
 * media/pdf-customization/ is a static asset consumed by DITA-OT itself, not
 * by any code in this repo: nothing compiles it, nothing exercises it, and
 * every way it can be wrong is silent — a missing/renamed file, or an
 * attribute-set whose name doesn't match what org.dita.pdf2 actually declares,
 * means the customization is quietly ignored and the PDF comes out with the
 * old, un-fixed styling rather than failing the transform. These are tripwires
 * on the three shapes that have to hold for the `customization.dir` option to
 * do anything at all.
 *
 * They match on file text, so a legitimate rewording (a comment edit, an
 * attribute added to an existing set) won't fail them; only losing the
 * structural piece that makes the override work will.
 */
describe('media/pdf-customization: every file is well-formed XML', () => {
  const files = [
    'catalog.xml',
    join('fo', 'attrs', 'custom.xsl'),
    join('fo', 'xsl', 'custom.xsl'),
  ];
  for (const rel of files) {
    it(`${rel} parses with a strict XML parser`, () => {
      // Tripwire against the `--` -in-a-comment class of mistake (see
      // parseStrictXml's doc comment) and anything else that only a real
      // parser catches, not a text match.
      parseStrictXml(readFileSync(join(customizationRoot, rel), 'utf-8'), rel);
    });
  }
});

describe('media/pdf-customization: catalog.xml wiring', () => {
  const catalogPath = join(customizationRoot, 'catalog.xml');
  const catalog = readFileSync(catalogPath, 'utf-8');

  /** Every `uri name="..." uri="..."` pair declared in the catalog. */
  function uriEntries(): { name: string; uri: string }[] {
    const entries: { name: string; uri: string }[] = [];
    const re = /<uri\s+name="([^"]+)"\s+uri="([^"]+)"\s*\/>/g;
    for (const m of catalog.matchAll(re)) entries.push({ name: m[1], uri: m[2] });
    return entries;
  }

  it('maps both org.dita.pdf2 customization hooks (fo/attrs/custom.xsl and fo/xsl/custom.xsl)', () => {
    const names = uriEntries().map((e) => e.name).sort();
    assert.deepStrictEqual(names, ['cfg:fo/attrs/custom.xsl', 'cfg:fo/xsl/custom.xsl']);
  });

  it('points every uri at a file that actually exists, relative to the catalog', () => {
    // A drift here (file renamed, or moved a level up/down) is not an error
    // DITA-OT reports -- the catalog lookup just misses and the default,
    // un-customized stylesheet is used instead.
    for (const e of uriEntries()) {
      const target = join(customizationRoot, e.uri);
      assert.ok(existsSync(target), `catalog.xml maps "${e.name}" to "${e.uri}", which is not on disk at ${target}`);
    }
  });
});

describe('media/pdf-customization: fo/attrs/custom.xsl attribute-set overrides', () => {
  const attrsPath = join(customizationRoot, 'fo', 'attrs', 'custom.xsl');
  const attrs = readFileSync(attrsPath, 'utf-8');

  function attributeSetBody(name: string): string | undefined {
    const re = new RegExp(`<xsl:attribute-set\\s+name="${name}"[^>]*>([\\s\\S]*?)</xsl:attribute-set>`);
    const m = re.exec(attrs);
    return m ? m[1] : undefined;
  }

  it('scales a too-wide image down to the column instead of letting it run off the page', () => {
    const body = attributeSetBody('image');
    assert.ok(body !== undefined, 'expected an `image` attribute-set override');
    // FOP's own keywords, not core XSL-FO: this is what makes "only shrink,
    // never enlarge" work; `uniform` is what keeps the aspect ratio while it
    // does. Losing any one of the three silently falls back to drawing the
    // image at its intrinsic size.
    assert.ok(/content-width">\s*scale-down-to-fit\s*<\//.test(body), 'image must set content-width="scale-down-to-fit"');
    assert.ok(/content-height">\s*scale-down-to-fit\s*<\//.test(body), 'image must set content-height="scale-down-to-fit"');
    assert.ok(/scaling">\s*uniform\s*<\//.test(body), 'image must set scaling="uniform"');
    // `width` is the reference rectangle content-width/content-height scale
    // down *to* -- without it the two keywords above have nothing to fit into.
    assert.ok(/<xsl:attribute\s+name="width">\s*100%\s*<\/xsl:attribute>/.test(body), 'image must set width="100%"');
  });

  it('keeps codeph monospace while adding the background/padding that make it readable', () => {
    // Overriding an attribute-set replaces it wholesale rather than merging,
    // so dropping font-family here would silently un-monospace every codeph
    // in a PDF instead of just losing the new background.
    const body = attributeSetBody('codeph');
    assert.ok(body !== undefined, 'expected a `codeph` attribute-set override');
    assert.ok(/font-family">\s*monospace\s*</.test(body), 'codeph must keep font-family="monospace"');
    assert.ok(/background-color">/.test(body), 'codeph must set a background-color');
  });
});

describe('media/pdf-customization: fo/xsl/custom.xsl stays a loadable empty shell', () => {
  it('has no stray templates', () => {
    // It's referenced from catalog.xml, so it has to parse even while it
    // overrides nothing yet (the long-codeph-string fix is deferred; see the
    // comment in the file itself, and the well-formedness check above for
    // what actually validates it loads). A half-written template here would
    // break the whole customization load, not just its own rule.
    const xsl = readFileSync(join(customizationRoot, 'fo', 'xsl', 'custom.xsl'), 'utf-8');
    assert.ok(!/<xsl:template/.test(xsl), 'no template overrides yet -- this file is a placeholder');
  });
});
