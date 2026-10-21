import * as assert from 'assert';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ISSUE_CATEGORIES } from '../../editor/mapChecks';

// __dirname is dist-test/test/editor at runtime, so the repo root is three up.
const repoRoot = join(__dirname, '..', '..', '..');
const corpusDir = join(repoRoot, 'test-dita-file', 'completeness-corpus');
const rulesPath = join(corpusDir, 'RULES.md');

const SOURCES = ['spec', 'dita-ot', 'oxygen-report', 'catalog', 'own', 'legacy'];
/** Rules written before the ledger existed: the only rows allowed to say `legacy`. */
const GRANDFATHERED = new Set(Array.from({ length: 15 }, (_, i) => `R${String(i + 1).padStart(3, '0')}`));

interface Row { id: string; category: string; rule: string; source: string; reference: string; probe: string }

function stripTicks(s: string): string {
  return s.trim().replace(/^`|`$/g, '');
}

function readRows(): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(rulesPath, 'utf8').split(/\r?\n/)) {
    if (!/^\| R\d{3} \|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    assert.strictEqual(cells.length, 6, `ledger row must have 6 cells: ${line}`);
    rows.push({
      id: cells[0], category: stripTicks(cells[1]), rule: cells[2],
      source: cells[3], reference: cells[4], probe: stripTicks(cells[5]),
    });
  }
  return rows;
}

function listFiles(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext));
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

describe('completeness rule ledger (RULES.md)', () => {
  const rows = readRows();

  it('has a row for every issue category, and only real categories', () => {
    const known = new Set<string>(ISSUE_CATEGORIES);
    const unknown = rows.filter((r) => !known.has(r.category)).map((r) => `${r.id}:${r.category}`);
    assert.deepStrictEqual(unknown, [], `rows for categories that do not exist: ${unknown.join(', ')}`);
    const covered = new Set(rows.map((r) => r.category));
    const missing = ISSUE_CATEGORIES.filter((c) => !covered.has(c));
    assert.deepStrictEqual(missing, [], `categories without a ledger row: ${missing.join(', ')}`);
  });

  it('has unique ids and an allowed source on every row', () => {
    const ids = rows.map((r) => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate rule ids');
    const bad = rows.filter((r) => !SOURCES.includes(r.source)).map((r) => `${r.id}:${r.source}`);
    assert.deepStrictEqual(bad, [], `sources must be one of ${SOURCES.join(', ')}: ${bad.join(', ')}`);
  });

  it('allows `legacy` only on the grandfathered rows', () => {
    const bad = rows.filter((r) => r.source === 'legacy' && !GRANDFATHERED.has(r.id)).map((r) => r.id);
    assert.deepStrictEqual(bad, [], `new rules need a real source, not legacy: ${bad.join(', ')}`);
  });

  it('gives every non-legacy rule a reference and an existing corpus probe', () => {
    const problems: string[] = [];
    for (const r of rows.filter((x) => x.source !== 'legacy')) {
      if (!r.reference || r.reference === '—') problems.push(`${r.id}: no reference`);
      if (!r.probe || r.probe === '—' || !existsSync(join(corpusDir, r.probe))) {
        problems.push(`${r.id}: probe "${r.probe}" is not a file under completeness-corpus/ (use ../completeness-corpus-2/... for the second corpus)`);
      }
    }
    assert.deepStrictEqual(problems, []);
  });

  it('keeps references to Oxygen internals out of the code and the spec documents', () => {
    // A tripwire, not a proof: the check must rest on public sources and real reports.
    const banned = /bytecode|javap|decompil|disassembl|checker\/[a-z]/i;
    const files = [
      ...listFiles(join(repoRoot, 'src', 'editor'), /\.ts$/),
      ...readdirSync(corpusDir)
        .filter((f) => f.endsWith('.md') && f !== 'CLEAN-ROOM.md')
        .map((f) => join(corpusDir, f)),
    ];
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8'))).map((f) => f.slice(repoRoot.length + 1));
    assert.deepStrictEqual(hits, [], `provenance wording that must not appear: ${hits.join(', ')}`);
  });
});
