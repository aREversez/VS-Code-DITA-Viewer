import * as assert from 'assert';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { DitaNode } from '@dita-viewer/core';
import {
  applyInlineMarksToHtml,
  arrangeByRecency,
  buildQuickCommitChoices,
  coalesceDiffParts,
  computeRowStats,
  diffTokens,
  diffTopics,
  lcsAlign,
  normalizeText,
  swapAlignedRows,
  tokenizeForDiff,
  type AlignedRow,
  type DiffPart,
} from '../../editor/ditaDiffEngine';

// Characterization of ditaDiffEngine: the output of the public functions on a fixed
// corpus, written down once from the code as it stood and compared byte for byte
// afterwards. It exists so the engine can be split into modules (O2) as a pure move:
// a split that changes any result, in any module, shows up as a diff of this file.
// It is deliberately not a statement that every one of these results is *right*.
//
// What it pins (checked by mutating each constant and watching this file fail): the
// three similarity tiers and their thresholds, the id / shared-reference pairing
// bonuses, the inline token cap, CJK tokenisation, inline marks across tags, moves,
// section recursion, and the banded pairing path for a large run. What it does not
// distinguish: PAIR_BASE (it only breaks ties), and the size limits PAIR_DP_CELL_LIMIT,
// PAIR_MIN_HALF_BAND and REF_WALK_CAP, which change speed rather than the result on
// inputs this small.
//
// Regenerate (only when a change of behaviour is intended and reviewed):
//   UPDATE_GOLDEN=1 npx mocha --config .mocharc.json -g "ditaDiffEngine golden"
const GOLDEN = resolve(__dirname, '..', '..', '..', 'src', 'test', 'editor', 'golden', 'ditaDiffEngine.golden.json');

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function html(node: DitaNode): string {
  if (node.type === 'text') return esc(node.text || '');
  const tag = node.tagName || 'span';
  return `<${tag}>${(node.children || []).map(html).join('')}</${tag}>`;
}
// A renderer with real nesting, so inline marks have tags to cross; the block text is
// whatever the engine derives from this HTML.
const renderBlockFactory = () => (node: DitaNode): string => html(node);

const topic = (body: string, title = 'Title'): string =>
  `<?xml version="1.0"?><topic id="t"><title>${title}</title><body>${body}</body></topic>`;


// Twelve words, then the same sentence with 2, 4, ... 12 of them replaced: the engine
// treats texts differently by how much they share, and a ladder reaches every tier.
function ladder(): Array<[string, string, string]> {
  const words = 'The scheduler reads each queued job and then writes a short status line'.split(' ');
  const out: Array<[string, string, string]> = [];
  for (let k = 2; k <= 12; k += 2) {
    const changed = words.map((w, i) => (i < k ? `${w.toUpperCase().slice(0, 3)}${i}x` : w)).join(' ');
    out.push([`overlap ladder ${k}`, topic(`<p>${words.join(' ')}</p>`), topic(`<p>${changed}</p>`)]);
  }
  return out;
}

// More changed blocks per side than the pairing matrix (40 000 cells) holds, so the
// engine has to fall back from the full table to a band around the diagonal.
function bulk(tag: string): string {
  return Array.from({ length: 210 }, (_, i) => `<p>Block ${i} of the ${tag} run keeps ${i % 7} shared words.</p>`).join('');
}

const CORPUS: Array<[string, string, string]> = [
  ['identical', topic('<p>One.</p><p>Two.</p>'), topic('<p>One.</p><p>Two.</p>')],
  ['word edit', topic('<p>The quick brown fox jumps over the lazy dog.</p>'), topic('<p>The quick red fox leaps over the lazy dog.</p>')],
  ['title edit', topic('<p>Same.</p>', 'Old title'), topic('<p>Same.</p>', 'New title')],
  ['added and removed', topic('<p>Keep.</p><p>Drop me.</p>'), topic('<p>Keep.</p><p>Brand new paragraph here.</p><p>Another.</p>')],
  ['cjk edit', topic('<p>这是一个测试段落，用来检查中文的差异显示。</p>'), topic('<p>这是一个测试段落，用来检查中文的修改显示效果。</p>')],
  ['mixed cjk and latin', topic('<p>使用 DITA-OT 转换 map 文件。</p>'), topic('<p>使用 DITA Open Toolkit 转换 ditamap 文件。</p>')],
  [
    'inline markup crossing a change',
    topic('<p>Press <b>Save</b> to keep the <i>current</i> settings.</p>'),
    topic('<p>Press <b>Save As</b> to keep the <i>new</i> settings now.</p>'),
  ],
  ['entities', topic('<p>Fish &amp; chips &lt;tag&gt; one</p>'), topic('<p>Fish &amp; chips &lt;tag&gt; two</p>')],
  [
    'moved block',
    topic('<p>Alpha paragraph with several words in it.</p><p>Beta paragraph with other words in it.</p><p>Gamma paragraph closing the topic.</p>'),
    topic('<p>Gamma paragraph closing the topic.</p><p>Alpha paragraph with several words in it.</p><p>Beta paragraph with other words in it.</p>'),
  ],
  [
    'moved block with an edit',
    topic('<p id="a">Alpha paragraph with several words in it.</p><p id="b">Beta paragraph.</p>'),
    topic('<p id="b">Beta paragraph.</p><p id="a">Alpha paragraph with several different words in it.</p>'),
  ],
  [
    'section with nested changes',
    topic('<section id="s"><title>Sec</title><p>Inner one.</p><p>Inner two stays.</p><p>Inner three goes.</p></section>'),
    topic('<section id="s"><title>Sec</title><p>Inner one changed.</p><p>Inner two stays.</p><p>Inner four arrives.</p></section>'),
  ],
  [
    'list items',
    topic('<ul><li>First item</li><li>Second <b>item</b></li><li>Third item</li></ul>'),
    topic('<ul><li>First item</li><li>Second <b>entry</b></li><li>Third item</li><li>Fourth item</li></ul>'),
  ],
  [
    'wholesale replacement',
    topic('<p>Completely different sentence about apples and oranges.</p>'),
    topic('<p>Nothing in common here at all, honestly speaking.</p>'),
  ],
  [
    'many blocks reordered and edited',
    topic(
      ['one', 'two', 'three', 'four', 'five', 'six']
        .map((w) => `<p>Paragraph ${w} has a fair amount of shared wording to pair against.</p>`)
        .join(''),
    ),
    topic(
      ['two', 'one', 'four', 'six', 'five', 'seven']
        .map((w) => `<p>Paragraph ${w} has a fair amount of shared wording to pair against${w === 'four' ? ' plus more' : ''}.</p>`)
        .join(''),
    ),
  ],
  [
    'prolog indexterms',
    `<?xml version="1.0"?><topic id="t"><title>T</title><prolog><metadata><keywords><indexterm>alpha</indexterm></keywords></metadata></prolog><body><p>x</p></body></topic>`,
    `<?xml version="1.0"?><topic id="t"><title>T</title><prolog><metadata><keywords><indexterm>beta</indexterm></keywords></metadata></prolog><body><p>x</p></body></topic>`,
  ],
  ['table cells', topic('<table><tgroup cols="2"><tbody><row><entry>a</entry><entry>b</entry></row></tbody></tgroup></table>'), topic('<table><tgroup cols="2"><tbody><row><entry>a</entry><entry>c</entry></row></tbody></tgroup></table>')],
  ...ladder(),
  [
    'shared phrase inside a rewritten paragraph',
    topic('<p>Before we begin you should know that the installation wizard will always create a backup copy of the existing configuration directory before changing anything else on disk.</p>'),
    topic('<p>Honestly nobody reads this, yet the installation wizard will always create a backup copy of the existing configuration directory before moving on to totally unrelated steps.</p>'),
  ],
  [
    'shared reference decides the pairing',
    topic('<p><xref href="guide.dita">Open</xref> the quarterly report dashboard</p><p>Stays.</p>'),
    topic('<p>Open the monthly summary</p><p><xref href="guide.dita">Totally unrelated gardening words</xref></p><p>Stays.</p>'),
  ],
  [
    'same id beats a closer text',
    topic('<p id="intro">The very first words of the old introduction.</p><p>Tail.</p>'),
    topic('<p>The very first words of the old introduction preface.</p><p id="intro">Totally other content.</p><p>Tail.</p>'),
  ],
  ['zero similarity still pairs', topic('<p>aaaa bbbb</p><p>Tail.</p>'), topic('<p>xxxx yyyy</p><p>Tail.</p>')],
  [
    'middling similarity keeps a diff',
    topic('<p>aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp</p>'),
    topic('<p>aaa bbb ccc ddd eee fff ggg zzz yyy xxx www vvv uuu ttt sss rrr</p>'),
  ],
  [
    'middling similarity becomes a rewrite',
    topic('<p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu</p>'),
    topic('<p>alpha beta nu xi omicron pi rho sigma tau upsilon phi chi</p>'),
  ],
  ['run larger than the pairing matrix', topic(bulk('old')), topic(bulk('new'))],
  ['left unparsable', '<topic id="t"><title>T</p>', topic('<p>Only right.</p>')],
  ['right unparsable', topic('<p>Only left.</p>'), '<topic id="t"><title>T</p>'],
  ['both unparsable', '<a><b></a>', '<c>'],
];

// Row objects hold the source DitaNode (a big graph with positions) and a move id that
// comes from a process-wide counter. Keep what the engine decided, not the node, and
// number move ids by first appearance so the order tests run in cannot matter.
function plain(result: unknown): unknown {
  const ids = new Map<number, number>();
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'node') o[k] = (val as DitaNode | undefined)?.tagName ?? null;
        else o[k] = walk(val, k);
      }
      return o;
    }
    if (key === 'moveId' && typeof v === 'number') {
      if (!ids.has(v)) ids.set(v, ids.size + 1);
      return ids.get(v);
    }
    return v;
  };
  return walk(result);
}

// A result of hundreds of rows would make the golden file huge; for those keep the
// shape (row kinds, stats) and a hash of everything else, which still changes if any
// byte of the result does.
function keep(name: string, result: unknown): unknown {
  if (!name.startsWith('run larger')) return result;
  const r = result as { rows: AlignedRow[]; stats: unknown };
  return {
    rowKinds: r.rows.map((x) => x.changeType[0]).join(''),
    stats: r.stats,
    sha1: createHash('sha1').update(JSON.stringify(result)).digest('hex'),
  };
}

function snapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, left, right] of CORPUS) {
    const input = { leftXml: left, rightXml: right, leftDocDir: '/l', rightDocDir: '/r', renderBlockFactory };
    const result = diffTopics(input);
    const swapped = swapAlignedRows(result.rows);
    out[`diffTopics: ${name}`] = keep(name, plain(result));
    // the same pair the other way round, since "swap sides" is a real use
    out[`swapped: ${name}`] = keep(name, plain({ rows: swapped, stats: computeRowStats(swapped) }));
  }

  const texts = [
    '',
    'plain words only',
    'tabs\tand  double  spaces',
    '中文和English混合text，标点！',
    'ひらがなカタカナ漢字 한국어 mixed',
    'a-b_c.d/e f',
    '😀 emoji 👍🏽 and 日本',
    'x'.repeat(40) + ' ' + 'y'.repeat(40),
  ];
  out['normalizeText'] = texts.concat('a\u00a0b  c').map(normalizeText);
  out['tokenizeForDiff'] = texts.map(tokenizeForDiff);

  const pairs: Array<[string, string]> = [
    ['the cat sat on the mat', 'the cat sat on a mat'],
    ['这是原来的句子', '这是修改后的句子'],
    ['', 'new text'],
    ['old text', ''],
    ['same', 'same'],
  ];
  const parts: DiffPart[][] = pairs.map(([a, b]) => diffTokens(tokenizeForDiff(a), tokenizeForDiff(b)));
  out['diffTokens'] = parts;
  out['coalesceDiffParts'] = parts.map(coalesceDiffParts);
  out['diffTokens over the cap'] = diffTokens(Array.from({ length: 6000 }, (_, i) => `w${i}`), ['x']);

  const inlineCases: Array<[string, string, string]> = [
    ['<p>Press <b>Save</b> now</p>', 'Press Save now', 'Press Save As now'],
    ['<p>a &amp; b &lt;c&gt;</p>', 'a & b <c>', 'a & b <d>'],
    ['<p>中文<i>强调</i>文字</p>', '中文强调文字', '中文强调内容'],
    ['<ul><li>one</li><li>two</li></ul>', 'onetwo', 'onethree'],
    ['<p>nothing changes</p>', 'nothing changes', 'nothing changes'],
  ];
  out['applyInlineMarksToHtml'] = inlineCases.flatMap(([h, a, b]) => {
    const p = diffTokens(tokenizeForDiff(a), tokenizeForDiff(b));
    return [applyInlineMarksToHtml(h, p, 'left'), applyInlineMarksToHtml(h, p, 'right')];
  });

  const eq = (x: string, y: string): boolean => x === y;
  out['lcsAlign'] = [
    [[], []],
    [['a'], []],
    [[], ['a']],
    [['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'e']],
    [['x', 'a', 'b'], ['a', 'b', 'y', 'z']],
  ].map(([a, b]) => lcsAlign(a, b, eq, (s) => s));

  const rows: AlignedRow[] = [];
  out['computeRowStats'] = computeRowStats(rows);
  out['arrangeByRecency'] = [arrangeByRecency({ order: 1 }, { order: 2 }), arrangeByRecency({ order: 5 }, { order: 5 })];
  out['buildQuickCommitChoices'] = [
    buildQuickCommitChoices([]),
    buildQuickCommitChoices([{ hash: 'h1', shortHash: 's1', subject: 'one' }]),
    buildQuickCommitChoices([
      { hash: 'h1', shortHash: 's1', subject: 'one' },
      { hash: 'h2', shortHash: 's2', subject: 'two' },
      { hash: 'h3', shortHash: 's3', subject: 'three' },
    ]),
  ];
  return out;
}

describe('ditaDiffEngine golden (characterization)', () => {
  it('produces the recorded result for every case of the corpus', () => {
    const actual = JSON.parse(JSON.stringify(snapshot())) as Record<string, unknown>;
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, '{\n' + Object.keys(actual).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(actual[k])}`).join(',\n') + '\n}\n');
      if (process.env.UPDATE_GOLDEN !== '1') assert.fail('golden file did not exist; it was written, rerun to compare');
      return;
    }
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), 'the set of cases changed');
    for (const key of Object.keys(expected)) {
      assert.deepStrictEqual(actual[key], expected[key], `result changed: ${key}`);
    }
  });

  it('is deterministic: two runs in one process agree', () => {
    const a = JSON.stringify(snapshot());
    const b = JSON.stringify(snapshot());
    assert.strictEqual(a, b);
  });

  it('covers the interesting behaviours (so an empty golden cannot pass)', () => {
    const s = JSON.parse(JSON.stringify(snapshot())) as Record<string, { rows?: AlignedRow[] }>;
    const types = (name: string): string[] => (s[`diffTopics: ${name}`].rows ?? []).map((r) => r.changeType);
    assert.ok(types('word edit').includes('modified'));
    assert.ok(types('moved block').includes('added') && types('moved block').includes('removed'));
    assert.ok(types('left unparsable').every((t) => t === 'added'));
    assert.ok(types('right unparsable').every((t) => t === 'removed'));
    assert.ok(JSON.stringify(s['diffTopics: moved block']).includes('moveId'));
    assert.ok(JSON.stringify(s['diffTopics: wholesale replacement']).includes('"replaced":true'));
    assert.ok(JSON.stringify(s['diffTopics: section with nested changes']).includes('"children"'));
    assert.ok(JSON.stringify(s['diffTopics: cjk edit']).includes('inlineDiff'));
  });
});
