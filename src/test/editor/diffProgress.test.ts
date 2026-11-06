import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

const provider = readFileSync(join(__dirname, '..', '..', '..', 'src/editor/ditaDiffProvider.ts'), 'utf8');

describe('diff computation progress', () => {
  it('does not use a notification toast for a computation that is done in a blink', () => {
    // A notification progress leaves an alert node ("Info: Computing
    // differences…") in the accessibility tree after it closes, so a screen
    // reader keeps announcing work that finished. The status bar slot has no
    // such alert.
    assert.ok(!/ProgressLocation\.Notification/.test(provider));
    assert.ok(/ProgressLocation\.Window/.test(provider));
  });
});
