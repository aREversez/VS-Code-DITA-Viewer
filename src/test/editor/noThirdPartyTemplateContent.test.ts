import * as assert from 'assert';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Route B (WebHelp-style DOM) is implemented from the public class/id names
 * only. No third-party template, stylesheet, script, layout file or image is
 * copied into what ships. This guard scans the shipped template resources and
 * the manual-test templates for the fingerprints such a copy would carry, so
 * a pasted file fails here rather than in a vsix review. It cannot prove a
 * negative, but it catches the realistic accident.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SCANNED = [join(ROOT, 'media'), join(ROOT, 'test-dita-file', 'manual', 'templates')];
const TEXT_EXT = /\.(css|js|html|xml|xsl|json|opt|svg|md|txt)$/i;

// Fingerprints of third-party WebHelp / Bootstrap material. Plain class names
// (wh_header, topicref, ...) are deliberately NOT here: they are the interface.
const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /xmlns:whc\b|\bwhc:[a-z_]+/i, why: 'WebHelp layout-file macro namespace (whc:)' },
  { re: /oxygenxml\.com\/webhelp\/components/i, why: 'WebHelp component namespace URL' },
  { re: /com\.oxygenxml\b/i, why: 'Oxygen plugin id' },
  { re: /Syncro\s*Soft/i, why: 'vendor copyright holder' },
  { re: /Bootstrap\s+v\d|getbootstrap\.com/i, why: 'bundled Bootstrap banner' },
  { re: /\$\{(?:webhelp|args)\.[\w.]+\}/, why: 'WebHelp layout placeholder ${webhelp.*}' },
  { re: /\boxy-icon\b/, why: 'vendor icon font class' },
];

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe('no third-party template content ships', () => {
  const files = SCANNED.flatMap((d) => [...walk(d)]).filter((f) => TEXT_EXT.test(f));

  it('actually scans the template resources', () => {
    assert.ok(files.length >= 20, `only ${files.length} files scanned -- paths wrong?`);
  });

  it('finds none of the fingerprints of copied WebHelp / Bootstrap material', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf-8');
      for (const { re, why } of FORBIDDEN) if (re.test(text)) hits.push(`${f.slice(ROOT.length + 1)}: ${why}`);
    }
    assert.deepStrictEqual(hits, []);
  });

  it('the guard itself notices a fingerprint (so it is not vacuous)', () => {
    const sample = '<html xmlns:whc="http://www.oxygenxml.com/webhelp/components"><whc:macro/></html>';
    assert.ok(FORBIDDEN.filter(({ re }) => re.test(sample)).length >= 2);
  });
});
