import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

// The script is what keeps the module split of the large files honest, so it has to
// notice a real cycle and must not cry wolf at one the compiler erases.
const SCRIPT = resolve(__dirname, '..', '..', '..', 'scripts', 'check-cycles.cjs');

describe('scripts/check-cycles.cjs', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cycles-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string, text: string): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const run = (): { code: number | null; err: string } => {
    const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, CHECK_CYCLES_ROOT: root }, encoding: 'utf8' });
    return { code: r.status, err: r.stderr };
  };

  it('passes on modules that only point one way', () => {
    write('src/a.ts', "import { b } from './b';\nexport const a = b + 1;\n");
    write('src/b.ts', 'export const b = 1;\n');
    assert.strictEqual(run().code, 0);
  });

  it('reports two modules that import each other, naming both', () => {
    write('src/a.ts', "import { b } from './b';\nexport const a = () => b();\n");
    write('src/b.ts', "import { a } from './a';\nexport const b = () => a();\n");
    const r = run();
    assert.strictEqual(r.code, 1);
    assert.ok(r.err.includes('src/a.ts') && r.err.includes('src/b.ts'), r.err);
  });

  it('reports a longer loop through three modules', () => {
    write('src/a.ts', "import { b } from './b';\nexport const a = () => b();\n");
    write('src/b.ts', "import { c } from './c';\nexport const b = () => c();\n");
    write('src/c.ts', "import { a } from './a';\nexport const c = () => a();\n");
    assert.strictEqual(run().code, 1);
  });

  it('reports a loop closed by a re-export, which is a run-time import too', () => {
    write('src/a.ts', "export { b } from './b';\n");
    write('src/b.ts', "import './a';\nexport const b = 1;\n");
    assert.strictEqual(run().code, 1);
  });

  it('reports a loop closed by a dynamic import', () => {
    write('src/a.ts', "export const a = () => import('./b');\n");
    write('src/b.ts', "import { a } from './a';\nexport const b = () => a();\n");
    assert.strictEqual(run().code, 1);
  });

  it('ignores an `import type` loop: the compiler erases it', () => {
    write('src/a.ts', "import type { B } from './b';\nexport interface A { b: B }\n");
    write('src/b.ts', "import type { A } from './a';\nexport interface B { a: A }\n");
    assert.strictEqual(run().code, 0);
  });

  it('ignores a value-looking import that is only used as a type', () => {
    write('src/a.ts', "import { B } from './b';\nexport const a = (x: B) => x;\n");
    write('src/b.ts', "import { a } from './a';\nexport interface B { f: typeof a }\n");
    assert.strictEqual(run().code, 0);
  });

  it('checks the core package sources too', () => {
    write('packages/core/src/a.ts', "import { b } from './b';\nexport const a = () => b();\n");
    write('packages/core/src/b.ts', "import { a } from './a';\nexport const b = () => a();\n");
    assert.strictEqual(run().code, 1);
  });

  it('does not follow test folders', () => {
    write('src/test/t.ts', "import { x } from '../a';\nexport const t = x;\n");
    write('src/a.ts', "import { t } from './test/t';\nexport const x = t;\n");
    assert.strictEqual(run().code, 0);
  });
});
