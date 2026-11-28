// Two DITAVAL readers exist: the completeness check's (src/analysis/ditaval.ts,
// "would this element be filtered out?") and the render-time one in
// src/profiling.ts. DESIGN.md 4.7 step 3b merges them, and says to show that
// they agree first and report the disagreement instead of choosing silently.
// This file is that evidence: where they agree it pins it, where they differ it
// pins both answers and names which one DITA 1.3 supports, so the merge changes
// exactly these rows and nothing else.

import * as assert from 'assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { parseDitaval as parseCompletenessDitaval } from '../../src/analysis/ditaval';
import { isExcluded, parseDitaval as parseRenderDitaval, profileValuesOf } from '../../src/profiling';

const exclude = (att: string, val?: string): string => `<prop att="${att}" ${val === undefined ? '' : `val="${val}" `}action="exclude"/>`;
const include = (att: string, val?: string): string => `<prop att="${att}" ${val === undefined ? '' : `val="${val}" `}action="include"/>`;
const val = (body: string): string => `<val>${body}</val>`;

/** The completeness reader's answer: is an element carrying these attributes filtered out? */
const completeness = (xml: string, attrs: Record<string, string>): boolean => parseCompletenessDitaval(xml).excludes(attrs);
/** The render-time reader's answer for the same element. */
const render = (xml: string, attrs: Record<string, string>): boolean =>
  isExcluded(profileValuesOf(attrs), { ditaval: parseRenderDitaval(xml) });

describe('the two DITAVAL readers', () => {
  describe('agree on ordinary filtering', () => {
    const cases: Array<[string, string, Record<string, string>, boolean]> = [
      ['an excluded audience value', val(exclude('audience', 'a')), { audience: 'a' }, true],
      ['an unmentioned value', val(exclude('audience', 'a')), { audience: 'b' }, false],
      ['every value of a list excluded', val(exclude('audience', 'a') + exclude('audience', 'b')), { audience: 'a b' }, true],
      ['one value of a list kept', val(exclude('audience', 'a')), { audience: 'a b' }, false],
      ['values are case sensitive', val(exclude('audience', 'A')), { audience: 'a' }, false],
      ['platform, product, otherprops and deliveryTarget', val(exclude('platform', 'p') + exclude('product', 'q') + exclude('otherprops', 'o') + exclude('deliveryTarget', 'print')), { deliveryTarget: 'print' }, true],
      ['an attribute-wide default', val(exclude('audience')), { audience: 'a' }, true],
      ['an explicit include beats the default', val(exclude('audience') + include('audience', 'a')), { audience: 'a' }, false],
      ['bare values of props', val(exclude('props', 'x')), { props: 'x' }, true],
      ['a specialization written as props="name(value)"', val(exclude('region', 'emea')), { props: 'region(emea)' }, true],
      ['a prop with no att is not a global default', val('<prop action="exclude"/>'), { audience: 'a' }, false],
      ['no rules', val(''), { audience: 'a' }, false],
    ];
    for (const [name, xml, attrs, want] of cases) {
      it(name, () => {
        assert.strictEqual(completeness(xml, attrs), want, 'completeness reader');
        assert.strictEqual(render(xml, attrs), want, 'render reader');
      });
    }
  });

  describe('differ, and which one DITA 1.3 supports', () => {
    // Each row: what the completeness reader says, what the render reader says, and the
    // reason one of them is right. Step 3b turns the wrong side into the right one.
    const differences: Array<{ name: string; xml: string; attrs: Record<string, string>; completeness: boolean; render: boolean; why: string }> = [
      {
        name: 'a filter on rev',
        xml: val(exclude('rev', '1')),
        attrs: { rev: '1' },
        completeness: true,
        render: false,
        why: 'render is right: rev "can only be used for flagging" (langRef/ditaval/ditaval-revprop)',
      },
      {
        name: 'a filter on base, importance or status',
        xml: val(exclude('status', 'draft')),
        attrs: { status: 'draft' },
        completeness: true,
        render: false,
        why: 'render is right: a prop\'s att must be props, audience, platform, product, otherprops, deliveryTarget or a props specialization (ditaval-prop)',
      },
      {
        name: 'a bare value of props next to a specialization group',
        xml: val(exclude('props', 'x')),
        attrs: { props: 'region(emea) x' },
        completeness: false,
        render: true,
        why: 'render is right: region(emea) belongs to region, so props holds the bare value x only',
      },
      {
        name: 'a specialized attribute written directly',
        xml: val(exclude('region', 'emea')),
        attrs: { region: 'emea' },
        completeness: true,
        render: false,
        why: 'completeness is right: att may name a specialization of props, which is an attribute of its own name (ditaval-prop). The render reader only sees the ten names in PROFILE_ATTRS',
      },
      {
        name: 'a prop whose action is not include, exclude, flag or passthrough',
        xml: val(exclude('audience') + '<prop att="audience" val="a" action="bogus"/>'),
        attrs: { audience: 'a' },
        completeness: false,
        render: true,
        why: 'undefined by the spec (an invalid file); render skips the rule, completeness lets it override the default',
      },
      {
        name: 'val="" on a prop',
        xml: val('<prop att="audience" val="" action="exclude"/>'),
        attrs: { audience: 'a' },
        completeness: false,
        render: true,
        why: 'undefined by the spec; render reads an empty val as absent (the attribute default), completeness as a value no element carries',
      },
      {
        name: 'two defaults for one attribute',
        xml: val(exclude('audience') + include('audience')),
        attrs: { audience: 'a' },
        completeness: true,
        render: false,
        why: 'the spec calls it an error and leaves recovery to the processor; completeness keeps the first, render the last',
      },
      {
        name: 'a prop after a malformed spot in the file',
        xml: `<val>${include('audience', 'a')}<x></y>${exclude('audience', 'b')}</val>`,
        attrs: { audience: 'b' },
        completeness: true,
        render: false,
        why: 'undefined by the spec; render stops at the first error and reports it, completeness reads on',
      },
    ];
    for (const d of differences) {
      it(`${d.name}: completeness ${d.completeness}, render ${d.render}`, () => {
        assert.strictEqual(completeness(d.xml, d.attrs), d.completeness, `completeness reader (${d.why})`);
        assert.strictEqual(render(d.xml, d.attrs), d.render, `render reader (${d.why})`);
      });
    }
  });

  describe('over every .ditaval in test-dita-file', () => {
    let root = __dirname;
    while (!existsSync(join(root, 'test-dita-file'))) {
      const up = dirname(root);
      if (up === root) throw new Error('test-dita-file not found');
      root = up;
    }
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.ditaval')) files.push(p);
      }
    };
    walk(join(root, 'test-dita-file'));

    const NOT_FILTERING = new Set(['rev', 'base', 'importance', 'status']);

    it('finds the corpus files', () => {
      assert.ok(files.length >= 5, `found ${files.length}`);
    });

    it('agree on every element built from the file\'s own attributes and values, except on attributes the spec does not filter on', () => {
      const unexpected: string[] = [];
      for (const file of files) {
        const xml = readFileSync(file, 'utf8');
        const rules = [...xml.matchAll(/<prop\b[^>]*>/g)].map((m) => ({
          att: /\batt="([^"]*)"/.exec(m[0])?.[1],
          val: /\bval="([^"]*)"/.exec(m[0])?.[1],
        }));
        const atts = [...new Set(['audience', 'platform', 'product', 'otherprops', 'deliveryTarget', 'props', ...rules.map((r) => r.att ?? '')])].filter(Boolean);
        const vals = [...new Set([...rules.map((r) => r.val ?? ''), 'zzz'])].filter(Boolean);
        for (const att of atts) {
          for (const v of vals) {
            for (const value of [v, `${v} zzz`, vals.slice(0, 2).join(' ')]) {
              const attrs = { [att]: value };
              if (completeness(xml, attrs) !== render(xml, attrs) && !NOT_FILTERING.has(att)) {
                unexpected.push(`${file}: ${JSON.stringify(attrs)}`);
              }
            }
          }
        }
      }
      assert.deepStrictEqual(unexpected, []);
    });

    it('the corpus does exercise the one real difference: a prop that filters on rev', () => {
      const withRev = files.filter((f) =>
        [...readFileSync(f, 'utf8').matchAll(/<prop\b[^>]*>/g)].some((m) => /\batt="rev"/.test(m[0]) && /\baction="exclude"/.test(m[0])),
      );
      assert.ok(withRev.length >= 1, 'no corpus .ditaval filters on rev any more; the row above has no real-file witness');
    });
  });
});
