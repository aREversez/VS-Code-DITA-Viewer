import * as assert from 'assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildStandaloneHtml, makeDataUriInliner, buildBookHeading } from '../../editor/exportHtmlHelpers';

describe('buildStandaloneHtml', () => {
  it('should produce a complete HTML document', () => {
    const html = buildStandaloneHtml({ title: 'Test', bodyHtml: '<p>Hello</p>', css: 'body{color:red}' });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>Test</title>'));
    assert.ok(html.includes('<style>\nbody{color:red}\n</style>'));
    assert.ok(html.includes('<main class="dita-export">'));
    assert.ok(html.includes('<p>Hello</p>'));
  });

  it('should escape the title to prevent HTML injection', () => {
    const malicious = '<script>alert(1)</script>';
    const html = buildStandaloneHtml({ title: malicious, bodyHtml: '', css: '' });
    assert.ok(!html.includes(`<title>${malicious}</title>`), 'raw script tag must not appear in title');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('should escape ampersands and quotes in the title', () => {
    const html = buildStandaloneHtml({ title: 'A & B "C"', bodyHtml: '', css: '' });
    assert.ok(html.includes('A &amp; B &quot;C&quot;'));
  });

  it('should include the generator meta tag', () => {
    const html = buildStandaloneHtml({ title: 'T', bodyHtml: '', css: '' });
    assert.ok(html.includes('name="generator" content="DITA Viewer for VS Code"'));
  });
});

describe('makeDataUriInliner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dita-export-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should inline an existing PNG file as a data URI', () => {
    const pngPath = join(tmpDir, 'test.png');
    writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // minimal PNG header
    const inliner = makeDataUriInliner(tmpDir);
    const result = inliner('test.png');
    assert.ok(result.startsWith('data:image/png;base64,'));
  });

  it('should inline SVG files with the correct MIME type', () => {
    const svgPath = join(tmpDir, 'icon.svg');
    writeFileSync(svgPath, '<svg></svg>');
    const inliner = makeDataUriInliner(tmpDir);
    const result = inliner('icon.svg');
    assert.ok(result.startsWith('data:image/svg+xml;base64,'));
  });

  it('should return empty string for a non-existent file', () => {
    const inliner = makeDataUriInliner(tmpDir);
    assert.strictEqual(inliner('nonexistent.png'), '');
  });

  it('should resolve relative paths from the base directory', () => {
    mkdirSync(join(tmpDir, 'images'));
    const imgPath = join(tmpDir, 'images', 'logo.gif');
    writeFileSync(imgPath, Buffer.from([0x47, 0x49, 0x46, 0x38])); // GIF header
    const inliner = makeDataUriInliner(tmpDir);
    const result = inliner('images/logo.gif');
    assert.ok(result.startsWith('data:image/gif;base64,'));
  });
});

describe('buildBookHeading', () => {
  it('should produce an h1 for depth 0', () => {
    const html = buildBookHeading('Intro', 0);
    assert.ok(html.startsWith('<h1 '));
    assert.ok(html.includes('>Intro</h1>'));
  });

  it('should produce an h2 for depth 1', () => {
    const html = buildBookHeading('Chapter', 1);
    assert.ok(html.startsWith('<h2 '));
  });

  it('should cap heading level at h6 for deep nesting', () => {
    const html = buildBookHeading('Deep', 10);
    assert.ok(html.startsWith('<h6 '));
  });

  it('should include a role badge when role is provided', () => {
    const html = buildBookHeading('Appendix', 0, 'Appendix');
    assert.ok(html.includes('class="map-tree-badge"'));
    assert.ok(html.includes('>Appendix</span>'));
  });

  it('should omit the badge when no role is provided', () => {
    const html = buildBookHeading('Plain', 0);
    assert.ok(!html.includes('map-tree-badge'));
  });

  it('should escape the role text to prevent HTML injection', () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const html = buildBookHeading('Title', 0, malicious);
    assert.ok(!html.includes(malicious), 'raw malicious role must not appear in output');
    assert.ok(html.includes('&lt;img'));
  });

  it('should escape the name text to prevent HTML injection', () => {
    const malicious = '<script>alert(1)</script>';
    const html = buildBookHeading(malicious, 0, 'Chapter');
    assert.ok(!html.includes(malicious), 'raw malicious name must not appear in output');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('should escape ampersands and quotes in the name', () => {
    const html = buildBookHeading('A & B "C"', 0);
    assert.ok(html.includes('A &amp; B &quot;C&quot;'));
  });

  it('should escape ampersands and quotes in the role badge', () => {
    const html = buildBookHeading('Title', 0, 'A & B "C"');
    assert.ok(html.includes('A &amp; B &quot;C&quot;'));
  });
});
