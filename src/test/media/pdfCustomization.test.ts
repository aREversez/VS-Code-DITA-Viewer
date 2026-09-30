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
    join('fo', 'i18n', 'zh_CN.xml'),
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

  it('sets every title and the mini-TOC in serif, matching the serif body text', () => {
    // org.dita.pdf2 sets the page root to `serif`, but its `common.title` set
    // (topic/section/table/figure titles, running headers, front matter, ...)
    // and `__toc__mini` (the in-topic "mini TOC") to `sans-serif`. The PDF then
    // alternates serif body / sans-serif heading, and a Latin word in a title
    // no longer matches the (serif) CJK glyphs around it. Overrides replace the
    // set wholesale, so `__toc__mini` must also repeat its two other members.
    const title = attributeSetBody('common.title');
    assert.ok(title !== undefined, 'expected a `common.title` attribute-set override');
    assert.ok(/font-family">\s*serif\s*</.test(title), 'common.title must set font-family="serif"');
    assert.ok(!/sans-serif/.test(title), 'common.title must not fall back to sans-serif');

    const mini = attributeSetBody('__toc__mini');
    assert.ok(mini !== undefined, 'expected a `__toc__mini` attribute-set override');
    assert.ok(/font-family">\s*serif\s*</.test(mini), '__toc__mini must set font-family="serif"');
    assert.ok(!/sans-serif/.test(mini), '__toc__mini must not fall back to sans-serif');
    assert.ok(/font-size">\s*10\.5pt\s*</.test(mini), '__toc__mini must keep its default font-size');
    assert.ok(/end-indent">\s*5pt\s*</.test(mini), '__toc__mini must keep its default end-indent');
  });

  it('does not reintroduce sans-serif anywhere in the customization', () => {
    // Catches a future attribute-set copied from the defaults with its
    // sans-serif intact. Comments are stripped so this file's own explanation
    // of the problem does not trip it.
    const withoutComments = attrs.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/sans-serif/.test(withoutComments), 'no attribute-set in custom.xsl may use sans-serif');
  });

  it('never pads a page sequence to an even page count (no blank pages after chapters)', () => {
    // org.dita.pdf2 sets force-page-count="even" on every bookmap sequence, so a
    // chapter with an odd number of pages is followed by a blank page (DITA-OT
    // 4.4.1: a blank page after nearly every chapter, plus one after the cover
    // and one after the TOC). The override must be "no-force" for every map
    // type; the same value keeps the restarted body numbering from padding a
    // plain map's TOC.
    const body = attributeSetBody('__force__page__count');
    assert.ok(body !== undefined, 'expected a `__force__page__count` attribute-set override');
    assert.ok(/no-force/.test(body), 'force-page-count must be "no-force"');
    assert.ok(!/even|auto/.test(body), 'no branch may pad to an even/auto page count');
    assert.ok(!/bookmap\/bookmap/.test(body), 'bookmaps must not be treated differently any more');
  });

  it('numbers the cover page in lowercase roman so the front matter reads i, ii, iii', () => {
    // org.dita.pdf2's page-sequence.cover ships with no `format`, so FOP renders
    // the cover as arabic "1" even though the TOC after it is already roman -
    // the front matter read "1, ii, iii". The override adds format="i" (and
    // repeats the inherited __force__page__count, since an override replaces the
    // set wholesale) so the cover reads "i".
    const body = attributeSetBody('page-sequence.cover');
    assert.ok(body !== undefined, 'expected a `page-sequence.cover` attribute-set override');
    assert.ok(/<xsl:attribute\s+name="format">\s*i\s*</.test(body), 'cover must set format="i" (lowercase roman)');
    // use-attribute-sets lives on the opening tag, not in the body, so match the
    // whole file: the override must still inherit __force__page__count (an
    // attribute-set override replaces the default wholesale).
    assert.ok(
      /<xsl:attribute-set\s+name="page-sequence\.cover"[^>]*use-attribute-sets="__force__page__count"/.test(attrs),
      'cover override must keep the inherited __force__page__count',
    );
  });

  it('drops the in-chapter mini-TOC by switching the chapter layout to BASIC', () => {
    // The default layout (org.dita.pdf2 basic-settings.xsl, $chapterLayout =
    // 'MINITOC') opens each chapter/appendix/part with a two-column createMiniToc
    // table - a "Contents:" list of the child topics beside the chapter's own
    // body. That list reads as noise in a short manual and the table stranded
    // the title on its own page. Redeclaring the global chapterLayout variable
    // to 'BASIC' (import precedence: this file loads last) makes processChapter
    // render the body directly and skip createMiniToc, so title + content share
    // a page. This supersedes the old __toc__mini__table page-break override,
    // now removed because createMiniToc is no longer emitted at all.
    assert.match(
      attrs,
      /<xsl:variable\s+name="chapterLayout"\s+select="'BASIC'"\s*\/>/,
    );
    assert.ok(
      !/<xsl:attribute-set\s+name="__toc__mini__table"/.test(attrs),
      'the obsolete __toc__mini__table override must be gone under BASIC',
    );
  });
});

describe('media/pdf-customization: fo/xsl/custom.xsl template overrides', () => {
  const xslPath = join(customizationRoot, 'fo', 'xsl', 'custom.xsl');
  const xsl = readFileSync(xslPath, 'utf-8');

  it('restarts body page numbering at 1 via a startPageNumbering override', () => {
    // org.dita.pdf2's own startPageNumbering (xsl/fo/commons.xsl) is empty, so
    // the body page-sequence inherits no starting number and its arabic counter
    // runs on from the roman front matter (first body page reads 4, not 1).
    // This file is imported last, so a template of this name here replaces that
    // empty one; if the name drifts or the reset disappears, the override
    // silently does nothing and the numbering bug is back.
    assert.ok(
      /<xsl:template\s+name="startPageNumbering"/.test(xsl),
      'expected a startPageNumbering template override',
    );
    // The attribute MUST be initial-page-number, not the XSL-FO name
    // initial-value: FOP silently ignores initial-value (verified against a real
    // 2.11 run), so a future "cleanup" to the spec name would quietly undo the
    // whole fix while still passing every other check.
    assert.ok(
      /<xsl:attribute\s+name="initial-page-number">\s*1\s*<\/xsl:attribute>/.test(xsl),
      'startPageNumbering must emit initial-page-number="1" (not initial-value, which FOP ignores)',
    );
    assert.ok(
      !/name="initial-value"/.test(xsl),
      'must not use initial-value: FOP ignores it and the body would not restart',
    );
    // Guard against regressing into "every chapter restarts": the reset must
    // stay conditional, not emit unconditionally.
    assert.ok(
      /<xsl:if\b[\s\S]*initial-page-number/.test(xsl),
      'the reset must be behind a conditional guard (only the first body sequence restarts)',
    );
  });

  it('numbers chapters, appendices and parts by the entries that render, not every element', () => {
    // org.dita.pdf2 numbers a bookmap chapter with <xsl:number count=chapter>
    // over the map, so a key-only <chapter keys="..."> (no @href, no topic, no
    // page) still consumes a number: the first real chapter reads "Chapter 2"
    // in the TOC and in its own title. All three numbering templates live in
    // the topicTitleNumber mode; if any of them stops overriding the default,
    // or stops filtering by "has a topic", the skew silently returns.
    const templates = xsl.match(/<xsl:template\b[^>]*mode="topicTitleNumber"[^>]*>/g) ?? [];
    for (const cls of ['bookmap/chapter', 'bookmap/appendix', 'bookmap/part']) {
      assert.ok(
        templates.some((t) => t.includes(`' ${cls} '`)),
        `expected a topicTitleNumber override matching ${cls}`,
      );
    }
    assert.ok(
      /<xsl:function\s+name="vdv:renders-topic"/.test(xsl),
      'expected the vdv:renders-topic predicate that tells a rendered entry from a key-only one',
    );
    assert.ok(
      /key\(\s*'topic-id'/.test(xsl),
      "the predicate must ask whether a topic with the entry's id exists (topic-id key)",
    );
    // Every number must go through the predicate; a bare count over all
    // chapters/appendices/parts is the bug itself.
    const code = xsl.replace(/<!--[\s\S]*?-->/g, ''); // comments quote the default <xsl:number>
    const numberings = code.match(/<xsl:number\b[\s\S]*?\/>/g) ?? [];
    assert.strictEqual(numberings.length, 3, 'expected exactly the chapter, appendix and part numberings');
    for (const n of numberings) {
      assert.ok(n.includes('vdv:renders-topic'), `numbering must filter by vdv:renders-topic: ${n}`);
    }
  });

  it('drops the big chapter-number band from the opener but keeps its anchor id', () => {
    // org.dita.pdf2's insertChapterFirstpageStaticContent paints a bordered band
    // with the number in a 40pt BLOCK, which stacks "第{n}章" across three lines
    // for CJK and repeats the number the chapter title already carries. The
    // override keeps the <fo:block id="..."> (the PDF bookmark / TOC link target)
    // but emits no band; if the number container or the 'Chapter with number'
    // variable crept back in, the broken band would silently return.
    const m =
      /<xsl:template\b[^>]*mode="insertChapterFirstpageStaticContent"[^>]*>([\s\S]*?)<\/xsl:template>/.exec(xsl);
    assert.ok(m, 'expected an insertChapterFirstpageStaticContent template override');
    assert.ok(/generate-toc-id/.test(m[1]), 'must keep the anchor id (bookmark / TOC link target)');
    assert.ok(!/__chapter__frontmatter__number__container/.test(m[1]), 'must not emit the big number container');
    assert.ok(!/Chapter with number/.test(m[1]), 'must not emit the "Chapter with number" band');
  });

  it('replaces the chapter band with a single-line label that is skipped when the title already has it', () => {
    // Removing the band outright lost the number from every chapter whose title
    // does not carry it; the label is therefore emitted as one plain line, and
    // only when vdv:title-has-label says the title lacks it.
    const m =
      /<xsl:template\b[^>]*mode="insertChapterFirstpageStaticContent"[^>]*>([\s\S]*?)<\/xsl:template>/.exec(xsl);
    assert.ok(m, 'expected an insertChapterFirstpageStaticContent template override');
    assert.ok(/__vdv__opener__label/.test(m[1]), 'must emit the single-line opener label');
    assert.ok(/vdv:title-has-label/.test(m[1]), 'must skip the label when the title already carries it');
    const attrsSrc = readFileSync(join(customizationRoot, 'fo', 'attrs', 'custom.xsl'), 'utf-8');
    assert.ok(/<xsl:attribute-set\s+name="__vdv__opener__label"/.test(attrsSrc), 'the opener label attribute-set must be defined');
  });

  it('does not repeat the chapter label in the table of contents when the title already has it', () => {
    // A title / @navtitle typed as "第 1 章 产品简介" plus the auto prefix
    // "第 1 章 " printed "第 1 章 第 1 章 产品简介" in the TOC.
    const m = /<xsl:template\b[^>]*mode="tocPrefix"[^>]*>([\s\S]*?)<\/xsl:template>/.exec(xsl);
    assert.ok(m, 'expected a tocPrefix override');
    assert.ok(/vdv:title-has-label/.test(m[1]), 'must consult vdv:title-has-label');
    assert.ok(/xsl:next-match/.test(m[1]), 'must fall back to the stock prefix via next-match');
  });

  it('title-has-label treats no-break spaces as spaces and guards the number boundary', () => {
    // DITA-OT's zh_CN variables are "第&#xA0;{n}&#xA0;章"; \s and normalize-space
    // do not cover U+00A0, and "Chapter 1" must not match "Chapter 10".
    const f = /<xsl:function\s+name="vdv:title-has-label"[\s\S]*?<\/xsl:function>/.exec(xsl);
    assert.ok(f, 'expected vdv:title-has-label');
    assert.ok(/&#xA0;/.test(f[0]), 'must treat U+00A0 as whitespace');
    assert.ok(/\[\^0-9A-Za-z\]/.test(f[0]), 'must require a non-alphanumeric char after the label');
  });
});

describe('media/pdf-customization: backmatter booklist page numbers', () => {
  const attrs = readFileSync(join(customizationRoot, 'fo', 'attrs', 'custom.xsl'), 'utf-8');
  const code = attrs.replace(/<!--[\s\S]*?-->/g, '');

  it('overrides page-sequence.toc so a booklist in <backmatter> is not numbered in roman', () => {
    // org.dita.pdf2 gives page-sequence.toc (and lot/lof, which inherit it)
    // format="i" via page-sequence.frontmatter. A List of Figures/Tables in
    // <backmatter> comes after the body, so its counter runs on from the body
    // and a roman format printed page 895 as "dcccxcv" in the TOC.
    const m = /<xsl:attribute-set\s+name="page-sequence\.toc"[^>]*>([\s\S]*?)<\/xsl:attribute-set>/.exec(code);
    assert.ok(m, 'expected a page-sequence.toc attribute-set override');
    assert.ok(/name="format"/.test(m[1]), 'the override must set format itself (own members beat used sets)');
    // The backmatter test itself now lives in vdv:follows-body (covered below).
    assert.ok(/bookmap\/backmatter/.test(code), 'the override must still know about bookmap/backmatter');
    assert.ok(/then\s+'1'\s+else\s+'i'/.test(m[1]), "backmatter -> arabic '1', everything else keeps roman 'i'");
    // The composed sets must survive the wholesale replacement.
    assert.ok(/use-attribute-sets="[^"]*__force__page__count[^"]*page-sequence\.frontmatter[^"]*"/.test(m[0]),
      'must keep the default __force__page__count and page-sequence.frontmatter members');
  });
});

describe('media/pdf-customization: image fitting', () => {
  const xsl = readFileSync(join(customizationRoot, 'fo', 'xsl', 'custom.xsl'), 'utf-8');
  const code = xsl.replace(/<!--[\s\S]*?-->/g, '');

  it('wraps the stock placeImage template rather than copying it', () => {
    assert.ok(/<xsl:template\s+match="\*\[contains\(@class,\s*' topic\/image '\)\]"\s+mode="placeImage"\s+priority="10"/.test(code),
      'expected a higher-priority placeImage override for topic/image');
    assert.ok(/<xsl:next-match>/.test(code), 'must delegate to the toolkit template via xsl:next-match');
  });

  it('reads the measured sizes from the staged image-sizes.xml next to the customization folder', () => {
    assert.ok(/customizationDir\.url/.test(code), 'must locate the sidecar through customizationDir.url');
    assert.ok(/image-sizes\.xml/.test(code), 'sidecar file name must match IMAGE_SIZES_FILE');
    assert.ok(/doc-available\(/.test(code), 'a missing sidecar must degrade to the old behaviour, not fail the transform');
  });

  it('applies @scale first, narrows unsized portrait images, then shrinks what still overflows', () => {
    assert.ok(/\$pct/.test(code) && /@scale/.test(code), 'must honour @scale (own or inherited)');
    assert.ok(/\$h0 gt 1\.2 \* \$w0/.test(code), 'portrait images need their own rule');
    assert.ok(/min\(\(1,\s*\$col div \$w1,\s*\$maxH div \$h1\)\)/.test(code), 'final step must cap at column width and page height, never enlarge');
  });
});

describe('media/pdf-customization: booklist page numbers follow position, not just <backmatter>', () => {
  const attrs = readFileSync(join(customizationRoot, 'fo', 'attrs', 'custom.xsl'), 'utf-8');
  const code = attrs.replace(/<!--[\s\S]*?-->/g, '');

  it('page-sequence.toc decides arabic vs roman through vdv:follows-body', () => {
    // A list written after the chapters but outside <backmatter> (DITA-OT
    // tolerates it with only a validation error) used to fall through the
    // ancestor::backmatter test to roman "i", so its pages printed and were
    // cited in the TOC as e.g. "dcclxxx".
    const m = /<xsl:attribute-set\s+name="page-sequence\.toc"[^>]*>([\s\S]*?)<\/xsl:attribute-set>/.exec(code);
    assert.ok(m, 'expected a page-sequence.toc attribute-set override');
    assert.ok(/vdv:follows-body\(\s*\.\s*\)/.test(m[1]), 'format must be decided by vdv:follows-body(.)');
    assert.ok(/then\s+'1'\s+else\s+'i'/.test(m[1]), "follows body -> '1', otherwise roman 'i'");
  });

  it('vdv:follows-body treats backmatter AND anything after a rendered chapter/part/appendix as after the body', () => {
    const f = /<xsl:function\s+name="vdv:follows-body"[^>]*>([\s\S]*?)<\/xsl:function>/.exec(code);
    assert.ok(f, 'expected the vdv:follows-body function');
    assert.ok(/bookmap\/backmatter/.test(f[1]), 'backmatter entries follow the body');
    assert.ok(/preceding::/.test(f[1]), 'position after a preceding chapter/part/appendix also counts');
    for (const cls of ['bookmap/chapter', 'bookmap/part', 'bookmap/appendix']) {
      assert.ok(f[1].includes(cls), `${cls} must count as body`);
    }
    assert.ok(/topic-id/.test(f[1]), 'key-only chapters that print nothing must not count as body');
  });

  it('declares the vdv and xs namespaces the function uses', () => {
    assert.ok(/xmlns:vdv="urn:dita-viewer:pdf-customization"/.test(attrs));
    assert.ok(/xmlns:xs="http:\/\/www\.w3\.org\/2001\/XMLSchema"/.test(attrs));
  });
});

describe('media/pdf-customization: zh_CN i18n config keeps Latin words out of the CJK font', () => {
  // Read lazily so a missing file is a failing assertion, not a load-time crash.
  const load = (): string => {
    const path = join(customizationRoot, 'fo', 'i18n', 'zh_CN.xml');
    assert.ok(existsSync(path), 'expected media/pdf-customization/fo/i18n/zh_CN.xml');
    return readFileSync(path, 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
  };

  it('the Simplified Chinese alphabet reaches the fullwidth punctuation block (U+FF08 etc.)', () => {
    // Stock range ends at U+FF00, so the fullwidth parentheses in
    // "正交性（Orthogonality）" stayed in the same default run as the Latin
    // letters, and FOP set the whole run in the CJK face.
    const code = load();
    const m = /<alphabet\s+char-set="Simplified Chinese">([\s\S]*?)<\/alphabet>/.exec(code);
    assert.ok(m, 'expected a Simplified Chinese alphabet');
    const ends = [...m[1].matchAll(/<end[^>]*>&#x([0-9a-fA-F]+);<\/end>/g)].map((x) => parseInt(x[1], 16));
    assert.ok(ends.some((e) => e >= 0xff60), 'a range must extend past U+FF08 (fullwidth parentheses)');
    assert.ok(ends.every((e) => e < 0xffff), 'ranges must not swallow the whole BMP');
  });

  it('never claims ASCII letters for the CJK alphabet', () => {
    const code = load();
    const starts = [...code.matchAll(/<start[^>]*>&#x([0-9a-fA-F]+);<\/start>/g)].map((x) => parseInt(x[1], 16));
    assert.ok(starts.every((st) => st >= 0x0100), 'no range may start inside ASCII/Latin-1');
  });

  it('keeps the symbol alphabets of the stock file', () => {
    const code = load();
    assert.ok(/char-set="SymbolsSuperscript"/.test(code));
    assert.ok(/char-set="SubmenuSymbol"/.test(code));
  });
});
