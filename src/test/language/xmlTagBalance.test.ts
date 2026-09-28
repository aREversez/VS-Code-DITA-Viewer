import * as assert from 'assert';
import { scanMarkup, validateWrapSelection } from '../../language/xmlTagBalance';

const kinds = (t: string) => scanMarkup(t).issues.map((i) => `${i.kind}:${i.tagName ?? ''}`);

describe('scanMarkup', () => {
  it('should report no issues for balanced markup', () => {
    assert.deepStrictEqual(kinds('<p>a <b>b</b> <img href="x"/> <br /></p>'), []);
  });

  it('should flag both tags of crossed nesting <b><uicontrol>x</b></uicontrol>', () => {
    assert.deepStrictEqual(kinds('<b><uicontrol>编辑</b></uicontrol>'), [
      'unclosed-element:uicontrol',
      'unexpected-end-tag:uicontrol',
    ]);
  });

  it('should flag an unclosed element at EOF, pointing at its start tag name', () => {
    const scan = scanMarkup('<p><b>text</p>');
    assert.deepStrictEqual(scan.issues.map((i) => [i.kind, i.tagName, i.start, i.end]), [
      ['unclosed-element', 'b', 3, 5],
    ]);
  });

  it('should flag a stray end tag', () => {
    assert.deepStrictEqual(kinds('text</b>'), ['unexpected-end-tag:b']);
  });

  it('should ignore tags inside comments, CDATA and processing instructions', () => {
    assert.deepStrictEqual(kinds('<p><!-- <b> --><![CDATA[</i>]]><?pi <u> ?></p>'), []);
  });

  it('should not end a tag at ">" inside a quoted attribute value', () => {
    assert.deepStrictEqual(kinds('<p a="x>y">t</p>'), []);
  });

  it('should skip a DOCTYPE with an internal subset', () => {
    assert.deepStrictEqual(kinds('<!DOCTYPE topic [ <!ENTITY a "b>"> ]><topic/>'), []);
  });

  it('should flag an unterminated tag', () => {
    assert.deepStrictEqual(kinds('<p>a <b <i>x</i></p>'), [
      'unterminated-markup:b',
    ]);
  });

  it('should flag a "<" that starts nothing valid', () => {
    assert.deepStrictEqual(kinds('<p>a < b</p>'), ['invalid-markup:']);
  });

  it('should recover after a mismatch so later valid markup is not flagged', () => {
    assert.deepStrictEqual(kinds('<a><b></a><c>x</c>'), ['unclosed-element:b']);
  });
});

describe('validateWrapSelection', () => {
  const doc = '<p>Click <b><uicontrol>Edit</uicontrol></b> now</p>';
  const range = (needle: string) => {
    const s = doc.indexOf(needle);
    return [s, s + needle.length] as const;
  };

  it('should allow plain text', () => {
    assert.deepStrictEqual(validateWrapSelection(doc, ...range('Click')), { ok: true });
  });

  it('should allow a complete element', () => {
    assert.deepStrictEqual(
      validateWrapSelection(doc, ...range('<b><uicontrol>Edit</uicontrol></b>')),
      { ok: true },
    );
  });

  it('should refuse start tags without their end tag (the reported bug)', () => {
    const r = validateWrapSelection(doc, ...range('<b><uicontrol>Edit'));
    assert.strictEqual(r.ok, false);
    assert.strictEqual((r as { reason: string }).reason, 'unbalanced');
  });

  it('should refuse a selection that has an end tag without its start tag', () => {
    const r = validateWrapSelection(doc, ...range('Edit</uicontrol></b>'));
    assert.strictEqual(r.ok, false);
  });

  it('should name the unpaired tag', () => {
    const r = validateWrapSelection(doc, ...range('<uicontrol>Edit'));
    assert.deepStrictEqual(r, { ok: false, reason: 'unbalanced', tagName: 'uicontrol' });
  });

  it('should refuse when a boundary falls inside a tag', () => {
    const s = doc.indexOf('<b>') + 1; // between "<" and "b"
    const r = validateWrapSelection(doc, s, doc.indexOf('Edit') + 4);
    assert.deepStrictEqual(r, { ok: false, reason: 'cuts-markup' });
  });

  it('should allow a selection wholly inside one comment', () => {
    const d = '<p><!-- a <b> c --></p>';
    const s = d.indexOf('a <b>');
    assert.deepStrictEqual(validateWrapSelection(d, s, s + 5), { ok: true });
  });
});
