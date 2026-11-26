import * as assert from 'assert';
import { escapeJson } from '../../editor/jsonEscape';
import { escapeForStyleElement } from '../../editor/templateStyle';

// DitaViewerProvider imports vscode; the suite stubs it the same way the other
// provider tests do (see the existing tests that import this module).
describe('escapeJson', () => {
  it('escapes every < so no string can open <!-- / <script / </script', () => {
    const json = JSON.stringify({ a: '</script><script>x', b: '<!--<script>', c: 'a<b' });
    const out = escapeJson(json);
    assert.ok(!out.includes('<'), out);
    assert.deepStrictEqual(JSON.parse(out), JSON.parse(json));
  });
  it('leaves JSON without < untouched', () => {
    assert.strictEqual(escapeJson('{"a":"b"}'), '{"a":"b"}');
  });
});

describe('escapeForStyleElement', () => {
  it('breaks </style so css text cannot end the block', () => {
    assert.ok(!/<\/style/i.test(escapeForStyleElement('a{}</style><script>x</script>')));
    assert.ok(!/<\/STYLE/.test(escapeForStyleElement('</STYLE>')));
  });
});
