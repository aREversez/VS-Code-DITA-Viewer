import * as assert from 'assert';
import {
  parseOxygenUninstallOutput,
  discoverOxygenLaunchSpecs,
  WIN_UNINSTALL_KEYS,
  type OxygenDiscoveryIo,
} from '../../editor/oxygenDiscovery';

// Real `reg query ... /s /f "Oxygen" /d` output from a Windows machine with
// Oxygen XML Author 28.1 installed (install4j registers the entry).
const REAL_REG_OUTPUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\7012-7398-7717-6547
    DisplayName    REG_SZ    Oxygen XML Author 28.1 (64-bit)
    DisplayIcon    REG_SZ    C:\\Program Files\\Oxygen XML Author 28\\.install4j\\i4j_extf_16_18ef1ve_6iy482.ico
    UninstallString    REG_SZ    "C:\\Program Files\\Oxygen XML Author 28\\uninstall.exe"
    URLInfoAbout    REG_SZ    https://www.oxygenxml.com
    InstallLocation    REG_SZ    C:\\Program Files\\Oxygen XML Author 28

End of search: 5 match(es) found.
`;

describe('parseOxygenUninstallOutput', () => {
  it('reads the install folder of a real install4j registry entry', () => {
    assert.deepStrictEqual(parseOxygenUninstallOutput(REAL_REG_OUTPUT), [
      { displayName: 'Oxygen XML Author 28.1 (64-bit)', installDir: 'C:\\Program Files\\Oxygen XML Author 28' },
    ]);
  });

  it('falls back to the folder of UninstallString when InstallLocation is missing', () => {
    const out = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\abc',
      '    DisplayName    REG_SZ    Oxygen XML Editor 27.1',
      '    UninstallString    REG_SZ    "D:\\Oxygen XML Editor 27\\uninstall.exe" /silent',
    ].join('\r\n');
    assert.strictEqual(parseOxygenUninstallOutput(out)[0].installDir, 'D:\\Oxygen XML Editor 27');
  });

  it('ignores entries that are not an Oxygen product', () => {
    const out = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\abc',
      '    DisplayName    REG_SZ    Oxygen Cloud Sync',
      '    InstallLocation    REG_SZ    C:\\Other',
    ].join('\n');
    assert.deepStrictEqual(parseOxygenUninstallOutput(out), []);
  });

  it('returns nothing for empty output', () => {
    assert.deepStrictEqual(parseOxygenUninstallOutput(''), []);
  });
});

function regEntry(displayName: string, installDir: string, key = 'abc'): string {
  return [
    `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${key}`,
    `    DisplayName    REG_SZ    ${displayName}`,
    `    InstallLocation    REG_SZ    ${installDir}`,
    '',
  ].join('\r\n');
}

function winIo(over: Partial<OxygenDiscoveryIo> & { dirs?: Record<string, string[]>; reg?: Record<string, string> }): OxygenDiscoveryIo {
  const dirs = over.dirs ?? {};
  return {
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    homedir: 'C:\\Users\\a',
    readDir: (p) => dirs[p] ?? [],
    fileExists: () => false,
    queryRegistry: async (k) => over.reg?.[k] ?? '',
    ...over,
  };
}

describe('discoverOxygenLaunchSpecs', () => {
  it('Windows: finds the version-suffixed exe in the registry install folder', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        reg: { [WIN_UNINSTALL_KEYS[0]]: REAL_REG_OUTPUT },
        dirs: { 'C:\\Program Files\\Oxygen XML Author 28': ['oxygenAuthor28.1.exe', 'oxygenAuthor.bat', 'uninstall.exe'] },
      }),
    );
    assert.strictEqual(specs.length, 1);
    assert.strictEqual(specs[0].command, 'C:\\Program Files\\Oxygen XML Author 28\\oxygenAuthor28.1.exe');
    assert.strictEqual(specs[0].source, 'detected');
  });

  it('Windows: real launcher names -- the versioned exe beats the .bat, for Editor and Author alike', async () => {
    for (const [dir, files, expected] of [
      ['Oxygen XML Editor 29', ['oxygen.bat', 'oxygen29.0.exe', 'uninstall.exe'], 'oxygen29.0.exe'],
      ['Oxygen XML Author 28', ['oxygenAuthor.bat', 'oxygenAuthor28.1.exe', 'uninstall.exe'], 'oxygenAuthor28.1.exe'],
    ] as const) {
      const specs = await discoverOxygenLaunchSpecs(
        winIo({
          dirs: { 'C:\\Program Files': [dir], ['C:\\Program Files\\' + dir]: [...files] },
        }),
      );
      assert.strictEqual(specs[0].command, 'C:\\Program Files\\' + dir + '\\' + expected);
      assert.ok(!specs[0].viaCmd);
    }
  });

  it('Windows: falls back to oxygen.bat, routed through cmd.exe, when no exe matches', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        reg: { [WIN_UNINSTALL_KEYS[0]]: REAL_REG_OUTPUT },
        dirs: { 'C:\\Program Files\\Oxygen XML Author 28': ['oxygenAuthor.bat', 'uninstall.exe'] },
      }),
    );
    assert.strictEqual(specs[0].viaCmd, true);
  });

  it('Windows: scans Program Files when the registry has nothing, highest version first', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        dirs: {
          'C:\\Program Files': ['Oxygen XML Editor 26', 'Oxygen XML Editor 28', 'Git'],
          'C:\\Program Files\\Oxygen XML Editor 26': ['oxygen26.0.exe'],
          'C:\\Program Files\\Oxygen XML Editor 28': ['oxygen28.1.exe'],
        },
      }),
    );
    assert.deepStrictEqual(
      specs.map((s) => s.command),
      ['C:\\Program Files\\Oxygen XML Editor 28\\oxygen28.1.exe', 'C:\\Program Files\\Oxygen XML Editor 26\\oxygen26.0.exe'],
    );
  });

  it('Windows: one spec per folder when registry and scan both find it (case-insensitive)', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        reg: { [WIN_UNINSTALL_KEYS[0]]: REAL_REG_OUTPUT },
        dirs: {
          'C:\\Program Files': ['Oxygen XML Author 28'],
          'C:\\Program Files\\Oxygen XML Author 28': ['oxygenAuthor28.1.exe'],
        },
      }),
    );
    assert.strictEqual(specs.length, 1);
  });

  it('Windows: a failing registry query does not stop the folder scan', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        queryRegistry: async () => {
          throw new Error('reg not found');
        },
        dirs: {
          'C:\\Program Files': ['Oxygen XML Editor 28'],
          'C:\\Program Files\\Oxygen XML Editor 28': ['oxygen28.1.exe'],
        },
      }),
    );
    assert.strictEqual(specs.length, 1);
  });

  it('Windows: a newer install found by the scan beats an older registered one', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        reg: { [WIN_UNINSTALL_KEYS[0]]: regEntry('Oxygen XML Editor 27.1', 'C:\\Program Files\\Oxygen XML Editor 27') },
        dirs: {
          'C:\\Program Files': ['Oxygen XML Editor 27', 'Oxygen XML Editor 29'],
          'C:\\Program Files\\Oxygen XML Editor 27': ['oxygen27.1.exe'],
          'C:\\Program Files\\Oxygen XML Editor 29': ['oxygen29.0.exe'],
        },
      }),
    );
    assert.deepStrictEqual(
      specs.map((s) => s.command),
      [
        'C:\\Program Files\\Oxygen XML Editor 29\\oxygen29.0.exe',
        'C:\\Program Files\\Oxygen XML Editor 27\\oxygen27.1.exe',
      ],
    );
  });

  it('Windows: equal versions keep the registered install ahead of a portable one', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        reg: { [WIN_UNINSTALL_KEYS[0]]: regEntry('Oxygen XML Editor 28.1', 'C:\\Program Files\\Oxygen XML Editor 28') },
        dirs: {
          'C:\\Program Files': ['Oxygen XML Editor 28.1'],
          'C:\\Program Files\\Oxygen XML Editor 28': ['oxygen28.1.exe'],
          'C:\\Program Files\\Oxygen XML Editor 28.1': ['oxygen28.1.exe'],
        },
      }),
    );
    assert.strictEqual(specs.length, 2);
    assert.strictEqual(specs[0].command, 'C:\\Program Files\\Oxygen XML Editor 28\\oxygen28.1.exe');
  });

  it('Windows: a folder that only looks like Oxygen yields no spec and cannot win', async () => {
    const specs = await discoverOxygenLaunchSpecs(
      winIo({
        dirs: {
          'C:\\Program Files': ['Oxygen XML Editor 99 notes', 'Oxygen XML Editor 28'],
          'C:\\Program Files\\Oxygen XML Editor 99 notes': ['readme.txt'],
          'C:\\Program Files\\Oxygen XML Editor 28': ['oxygen28.1.exe'],
        },
      }),
    );
    assert.deepStrictEqual(
      specs.map((s) => s.command),
      ['C:\\Program Files\\Oxygen XML Editor 28\\oxygen28.1.exe'],
    );
  });

  it('Linux: the highest version wins across install roots, not the first root', async () => {
    const specs = await discoverOxygenLaunchSpecs({
      platform: 'linux',
      env: {},
      homedir: '/home/a',
      readDir: (p) =>
        p === '/home/a'
          ? ['Oxygen XML Editor 26']
          : p === '/home/a/Oxygen XML Editor 26'
            ? ['oxygen.sh']
            : p === '/opt'
              ? ['Oxygen XML Editor 28']
              : p === '/opt/Oxygen XML Editor 28'
                ? ['oxygen.sh']
                : [],
      fileExists: () => false,
      queryRegistry: async () => '',
    });
    assert.deepStrictEqual(
      specs.map((s) => s.argsPrefix[0]),
      ['/opt/Oxygen XML Editor 28/oxygen.sh', '/home/a/Oxygen XML Editor 26/oxygen.sh'],
    );
  });

  it('Windows: nothing installed gives an empty list', async () => {
    assert.deepStrictEqual(await discoverOxygenLaunchSpecs(winIo({})), []);
  });

  it('Linux: finds oxygen.sh in an Oxygen folder under the home directory, launched through sh', async () => {
    const specs = await discoverOxygenLaunchSpecs({
      platform: 'linux',
      env: {},
      homedir: '/home/a',
      readDir: (p) =>
        p === '/home/a' ? ['Documents', 'Oxygen XML Editor 28'] : p === '/home/a/Oxygen XML Editor 28' ? ['oxygen.sh', 'jre'] : [],
      fileExists: () => false,
      queryRegistry: async () => '',
    });
    assert.strictEqual(specs.length, 1);
    assert.strictEqual(specs[0].command, 'sh');
    assert.deepStrictEqual(specs[0].argsPrefix, ['/home/a/Oxygen XML Editor 28/oxygen.sh']);
  });

  it('macOS: a bundle in /Applications is launched through open -a', async () => {
    const specs = await discoverOxygenLaunchSpecs({
      platform: 'darwin',
      env: {},
      homedir: '/Users/a',
      readDir: (p) => (p === '/Applications' ? ['Safari.app', 'Oxygen XML Editor.app'] : []),
      fileExists: (p) => p === '/Applications/Oxygen XML Editor.app',
      queryRegistry: async () => '',
    });
    assert.strictEqual(specs[0].command, 'open');
    assert.deepStrictEqual(specs[0].argsPrefix, ['-a', '/Applications/Oxygen XML Editor.app']);
  });

  it('never queries the registry off Windows', async () => {
    let called = false;
    await discoverOxygenLaunchSpecs({
      platform: 'linux',
      env: {},
      homedir: '/h',
      readDir: () => [],
      fileExists: () => false,
      queryRegistry: async () => {
        called = true;
        return '';
      },
    });
    assert.strictEqual(called, false);
  });
});
