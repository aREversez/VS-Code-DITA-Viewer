import * as assert from 'assert';
import { discoverOxygenOnThisMachine } from '../../editor/oxygenDiscoveryNode';

// The Node-backed wiring of oxygenDiscovery.ts (real registry, file system,
// environment). The pure module has its own tests; this pins the contract the
// caller depends on: whatever the machine looks like, the answer is a list,
// never a rejection, and every entry names a command to launch.
describe('discoverOxygenOnThisMachine', () => {
  it('resolves to an array of launch specs and never rejects', async function () {
    this.timeout(15000);
    const found = await discoverOxygenOnThisMachine();
    assert.ok(Array.isArray(found));
    for (const spec of found) assert.ok(typeof spec.command === 'string' && spec.command.length > 0);
  });

  it('is empty rather than throwing when the home folder and registry yield nothing', async function () {
    this.timeout(15000);
    const home = process.env.HOME;
    const userprofile = process.env.USERPROFILE;
    process.env.HOME = process.env.USERPROFILE = '/nonexistent-dita-viewer-home';
    try {
      const found = await discoverOxygenOnThisMachine();
      assert.ok(Array.isArray(found));
    } finally {
      if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
      if (userprofile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = userprofile;
    }
  });
});
