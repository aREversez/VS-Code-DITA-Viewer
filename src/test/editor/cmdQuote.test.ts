import * as assert from 'assert';
import { CmdUnsafeArgumentError, quoteCmdArg } from '../../editor/cmdQuote';
import { buildDitaOtSpawnSpec } from '../../editor/ditaOtUtils';

describe('quoteCmdArg', () => {
  it('quotes and doubles embedded quotes', () => {
    assert.strictEqual(quoteCmdArg('a b'), '"a b"');
    assert.strictEqual(quoteCmdArg('say "hi"'), '"say ""hi"""');
  });
  it('leaves characters that are inert inside quotes alone', () => {
    assert.strictEqual(quoteCmdArg('R&D^x|y<z>'), '"R&D^x|y<z>"');
  });
  it('refuses a % (cmd expands it inside quotes) and a line break', () => {
    for (const a of ['%COMSPEC%', 'a%b', 'a\nb', 'a\rb']) {
      assert.throws(() => quoteCmdArg(a), CmdUnsafeArgumentError, a);
    }
  });
});

describe('buildDitaOtSpawnSpec on Windows refuses an argument cmd would expand', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  it('a %VAR% in an output path throws instead of reaching cmd', () => {
    assert.throws(
      () => buildDitaOtSpawnSpec('C:\\dita\\bin\\dita.bat', ['--output=C:\\out\\%COMSPEC%'], 'win32', env),
      CmdUnsafeArgumentError,
    );
  });
  it('a % in the executable path throws too', () => {
    assert.throws(() => buildDitaOtSpawnSpec('C:\\100%\\dita.bat', [], 'win32', env), CmdUnsafeArgumentError);
  });
  it('is unchanged elsewhere and for a safe Windows call', () => {
    assert.deepStrictEqual(buildDitaOtSpawnSpec('/opt/dita', ['%x'], 'linux'), { command: '/opt/dita', args: ['%x'] });
    const spec = buildDitaOtSpawnSpec('C:\\d\\dita.bat', ['--a=b c'], 'win32', env);
    assert.strictEqual(spec.args[3], '""C:\\d\\dita.bat" "--a=b c""');
  });
});
