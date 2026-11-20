import * as assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { blocksFor, readRepo, stripComments } from '../media/cssBlocks';

const repoRoot = join(__dirname, '..', '..', '..');

// --color-link (#2b6cb0) on the light review box (#90ee90) is 3.8:1, under the
// 4.5:1 WCAG AA threshold for body text. A link inside a draft comment takes
// the box's own text colour (8.7:1) and keeps an underline so it still reads
// as a link. Both stylesheets carry the rule: media/styles.css for the
// extension, packages/core/styles/dita-content.css for core's consumers.
describe('draft-comment link legibility', () => {
  for (const rel of ['media/styles.css', 'packages/core/styles/dita-content.css']) {
    it(`${rel}: links inside a draft comment inherit its text colour and stay underlined`, () => {
      const css = readFileSync(join(repoRoot, rel), 'utf8');
      const m = /\.draft-comment a,\s*\.draft-comment \.xref,\s*\.draft-comment \.link\s*\{([^}]*)\}/.exec(css);
      assert.ok(m, 'rule present');
      assert.ok(/color:\s*inherit/.test(m[1]), m[1]);
      assert.ok(/text-decoration:\s*underline/.test(m[1]), m[1]);
    });
  }
});

// The inherit rule above sits in @layer dv-base, and every template's css is
// unlayered: its `body[data-template="..."] #dita-content-root a { color:
// var(--color-link) }` beats a layered normal declaration at any specificity,
// which would put the low-contrast link colour back inside the box on Book and
// Docsite pages. styles.css therefore repeats the rule unlayered, one class
// stronger than the template's selector. These tripwires keep that repeat
// outside the layer, and keep every template's content-link colour rule
// strictly below the repeat's specificity (a tie wins by source order, since
// template css is injected after styles.css) and free of !important (an
// unlayered !important beats the repeat's normal declaration at any
// specificity). Every file in template.json's css list is scanned, so a
// split or renamed stylesheet cannot slip past the guard.
describe('draft-comment link legibility vs template css', () => {
  const css = stripComments(readRepo('media/styles.css'));

  /** Preludes of the blocks enclosing `needle`'s first occurrence, outermost first. */
  function enclosing(needle: string): string[] {
    const at = css.indexOf(needle);
    assert.ok(at !== -1, `expected ${needle} in styles.css`);
    const stack: string[] = [];
    let start = 0;
    for (let i = 0; i < at; i++) {
      if (css[i] === '{') {
        stack.push(css.slice(start, i).replace(/\s+/g, ' ').trim());
        start = i + 1;
      } else if (css[i] === '}') {
        stack.pop();
        start = i + 1;
      } else if (css[i] === ';' && stack.length === 0) {
        start = i + 1;
      }
    }
    return stack;
  }

  it('styles.css repeats the inherit rule unlayered, scoped to template pages', () => {
    for (const tail of ['a', '.xref', '.link']) {
      const selector = `body[data-template] #dita-content-root .draft-comment ${tail}`;
      const blocks = blocksFor(css, selector);
      assert.strictEqual(blocks.length, 1, `${selector}: exactly one rule`);
      assert.ok(/color:\s*inherit/.test(blocks[0]), blocks[0]);
      assert.ok(/text-decoration:\s*underline/.test(blocks[0]), blocks[0]);
      assert.deepStrictEqual(enclosing(selector).filter((p) => p.startsWith('@layer')), [], `${selector} must stay outside every @layer`);
    }
  });

  // Everything below is pure string work on css text, so it is exercised both on
  // the real templates and on synthetic css that tries to slip past it.
  type Spec = [number, number, number];
  const isComma = (c: string): boolean => c === ',';
  const isCombinator = (c: string): boolean => /[\s>+~]/.test(c);

  /** Split `s` at depth-0 separators, never inside () or [] (so `:is(a, .xref)` and `[title="a, b"]` stay whole). */
  function splitTop(s: string, isSep: (ch: string) => boolean): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      if (depth === 0 && isSep(ch)) {
        parts.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    return parts.map((x) => x.trim()).filter(Boolean);
  }

  const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

  /**
   * Specificity (ids, classes/attrs/pseudo-classes, types/pseudo-elements),
   * computed conservatively: a functional pseudo-class counts itself plus
   * the SUM of its arguments (the spec takes the max of :is/:not/:has
   * arguments), and :where counts zero, as in the spec. An overestimate
   * fails the cap and sends a human to re-check -- never the reverse.
   */
  function specificity(sel: string): Spec {
    let total: Spec = [0, 0, 0];
    let rest = sel;
    const fn = /(:[\w-]+)\(([^()]*)\)/;
    for (let m = fn.exec(rest); m; m = fn.exec(rest)) {
      rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length);
      if (m[1] === ':where') continue;
      total = add(total, [0, 1, 0]);
      for (const arg of splitTop(m[2], isComma)) total = add(total, specificity(arg));
    }
    const ids = (rest.match(/#[\w-]+/g) || []).length;
    const mid = (rest.match(/\.[\w-]+/g) || []).length
      + (rest.match(/\[[^\]]*\]/g) || []).length
      + (rest.match(/(?<!:):[\w-]+/g) || []).length;
    let types = (rest.match(/::[\w-]+/g) || []).length;
    for (const compound of splitTop(rest, isCombinator)) {
      if (/^[a-zA-Z][\w-]*/.test(compound)) types++;
    }
    return add(total, [ids, mid, types]);
  }

  /** Strictly below: a tie loses too -- template css is injected after styles.css, so equal specificity wins by source order. */
  function below(a: Spec, b: Spec): boolean {
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  /**
   * Can this selector's subject be a link? Its LAST compound is the element
   * being coloured. It can paint a link when it is `a`, `*`, carries .xref or
   * .link, names no type and no class at all (`[href]`, `:hover`: it matches
   * anything), or holds a :is/:where/:matches/any(...) list with such an
   * argument. Returns 'class' when only the .xref/.link repeat can apply to
   * it, 'any' when a plain link is possible too, null when it cannot be one.
   */
  function linkSubject(sel: string): 'class' | 'any' | null {
    const compounds = splitTop(sel, isCombinator);
    let last = compounds[compounds.length - 1] || '';
    let found: 'class' | 'any' | null = null;
    const merge = (k: 'class' | 'any' | null): void => {
      if (k === 'any' || (k === 'class' && found === null)) found = k;
    };
    const lists = /:(?:is|where|matches|-webkit-any|-moz-any)\(([^()]*)\)/;
    for (let m = lists.exec(last); m; m = lists.exec(last)) {
      last = last.slice(0, m.index) + last.slice(m.index + m[0].length);
      for (const arg of splitTop(m[1], isComma)) merge(linkSubject(arg));
    }
    // Arguments of :not(...), :has(...) and the like describe what the subject
    // must NOT or MAY contain, not its own type or classes.
    last = last.replace(/:[\w-]+\([^()]*\)/g, '');
    const classes: string[] = last.match(/\.[\w-]+/g) || [];
    const type = (/^[a-zA-Z][\w-]*/.exec(last) || [''])[0];
    if (type === 'a' || type === '*') merge('any');
    else if (!type && classes.length === 0 && !/#[\w-]/.test(last)) merge('any');
    if (classes.includes('.xref') || classes.includes('.link')) merge('class');
    return found;
  }

  // The caps come from the repeat rules themselves (asserted present and
  // unlayered by the case above), not from a copy that could drift.
  const capA = specificity('body[data-template] #dita-content-root .draft-comment a');
  const capClass = specificity('body[data-template] #dita-content-root .draft-comment .xref');

  /** Scan one template stylesheet; `seen` counts the content-link colour or decoration rules it found. */
  function scanTemplateCss(tplCss: string, label: string): { seen: number; problems: string[] } {
    const problems: string[] = [];
    let seen = 0;
    const text = stripComments(tplCss);
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // Decoration counts too: a `text-decoration: none !important` carrying no
      // colour declaration would otherwise slip the scan. The underline itself
      // is also pinned in real Chromium by draftCommentLinks.test.ts.
      if (!/color\s*:|text-decoration\s*:/.test(m[2])) continue;
      for (const sel of splitTop(m[1], isComma).map((x) => x.replace(/\s+/g, ' '))) {
        if (!/#dita-content-root(?![\w-])/.test(sel)) continue;
        const subject = linkSubject(sel);
        if (!subject) continue;
        seen++;
        const where = `${label}: ${sel}`;
        // An unlayered !important beats the repeat's unlayered normal
        // declaration at any specificity (the book-entry rules use
        // !important for exactly this reason), so the cap cannot save it.
        if (/!\s*important/i.test(m[2])) {
          problems.push(`${where}: content-link rule uses !important; it would beat the unlayered draft-comment repeat in media/styles.css regardless of specificity`);
        }
        // A selector that can only be an .xref/.link meets the class repeat;
        // one that can be a plain link is held to the `a` repeat.
        const cap = subject === 'class' ? capClass : capA;
        const spec = specificity(sel);
        if (!below(spec, cap)) {
          problems.push(`${where}: specificity (${spec.join(',')}) must stay below (${cap.join(',')}); re-check the unlayered draft-comment repeat in media/styles.css`);
        }
      }
    }
    return { seen, problems };
  }

  it('every template content-link colour or decoration rule stays below the repeat it must lose to', () => {
    const names = readdirSync(join(repoRoot, 'media/templates'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.ok(names.length >= 7, 'template folders found');
    for (const name of names) {
      // Scan exactly the files the preview concatenates: template.json's css
      // list, in order -- not a guessed `${name}/${name}.css`.
      const manifest = JSON.parse(readRepo(`media/templates/${name}/template.json`)) as { css: string[] };
      assert.ok(Array.isArray(manifest.css) && manifest.css.length > 0, `${name}: template.json has a css list`);
      let seen = 0;
      for (const cssFile of manifest.css) {
        const r = scanTemplateCss(readRepo(`media/templates/${name}/${cssFile}`), `${name}/${cssFile}`);
        assert.deepStrictEqual(r.problems, []);
        seen += r.seen;
      }
      assert.ok(seen > 0, `${name}: expected a content-link colour or decoration rule`);
    }
  });

  // The guard itself, on css written to get past it. Each of these was, or
  // could have been, invisible to an earlier shape of the scan.
  describe('the guard catches css written to slip past it', () => {
    const root = 'body[data-template="x"] #dita-content-root';
    const scan = (rules: string) => scanTemplateCss(rules, 'x.css');

    it('accepts an ordinary template rule', () => {
      const r = scan(`${root} a { color: var(--color-link); }`);
      assert.deepStrictEqual(r, { seen: 1, problems: [] });
    });
    it('rejects !important on a plain link rule', () => {
      const r = scan(`${root} a { color: red !important; }`);
      assert.strictEqual(r.problems.length, 1);
      assert.ok(/!important/.test(r.problems[0]), r.problems[0]);
    });
    it('rejects a decoration-only !important rule that carries no colour at all', () => {
      const r = scan(`${root} .draft-comment a { text-decoration: none !important; }`);
      assert.strictEqual(r.seen, 1, 'the rule is recognized as a link rule');
      assert.ok(r.problems.some((p) => /!important/.test(p)), r.problems.join('\n'));
    });
    it('accepts an ordinary decoration-only rule below the cap', () => {
      const r = scan(`${root} a { text-decoration: underline; }`);
      assert.deepStrictEqual(r, { seen: 1, problems: [] });
    });
    it('rejects a selector that ties the repeat once a class is inserted', () => {
      const r = scan(`${root} .draft-comment a { color: red; }`);
      assert.strictEqual(r.problems.length, 1);
      assert.ok(/specificity/.test(r.problems[0]), r.problems[0]);
    });
    it('sees through a comma inside :is(...) instead of cutting the selector in half', () => {
      const r = scan(`${root} :is(a, .xref) { color: red !important; }`);
      assert.strictEqual(r.seen, 1, 'the rule is recognized as a link rule');
      assert.ok(r.problems.some((p) => /!important/.test(p)), r.problems.join('\n'));
    });
    it('sees through :matches and vendor any-lists the same way', () => {
      for (const fn of ['matches', '-webkit-any', '-moz-any']) {
        const r = scan(`${root} :${fn}(.note, a) { color: red !important; }`);
        assert.ok(r.problems.some((p) => /!important/.test(p)), `${fn}: ${r.problems.join('\n')}`);
      }
    });
    it('counts :where as zero but still scans it', () => {
      const ok = scan(`${root} :where(a, .xref) { color: red; }`);
      assert.deepStrictEqual(ok, { seen: 1, problems: [] });
      const bad = scan(`${root} :where(a, .xref) { color: red !important; }`);
      assert.ok(bad.problems.some((p) => /!important/.test(p)), bad.problems.join('\n'));
    });
    it('over-counts :is(...) arguments, so a possible tie is flagged for a human rather than passed', () => {
      const r = scan(`${root} :is(a, .xref) { color: red; }`);
      assert.ok(r.problems.some((p) => /specificity/.test(p)), r.problems.join('\n'));
    });
    it('does not cut a selector at a comma inside an attribute value', () => {
      const r = scan(`${root} a[title="x, y"] { color: red !important; }`);
      assert.strictEqual(r.seen, 1, 'one selector, not two');
      assert.ok(r.problems.some((p) => /!important/.test(p)), r.problems.join('\n'));
    });
    it('treats a compound with no type or class (it can match any link) as a link rule', () => {
      for (const subject of ['[href]', ':hover', ':not(.note)']) {
        const r = scan(`${root} ${subject} { color: red !important; }`);
        assert.strictEqual(r.seen, 1, subject);
        assert.ok(r.problems.some((p) => /!important/.test(p)), `${subject}: ${r.problems.join('\n')}`);
      }
    });
    it('ignores rules that cannot colour a link, however loud', () => {
      const r = scan(`${root} p, ${root} .note { color: red !important; }`);
      assert.deepStrictEqual(r, { seen: 0, problems: [] });
    });
    it('scans rules nested in @media', () => {
      const r = scan(`@media (min-width: 600px) { ${root} a { color: red !important; } }`);
      assert.strictEqual(r.seen, 1);
      assert.strictEqual(r.problems.length, 1);
    });
  });
});
