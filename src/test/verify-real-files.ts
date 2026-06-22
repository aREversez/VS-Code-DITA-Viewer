import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDita } from '../parser/ditaParser';
import { renderDocument } from '../render/renderer';

const sampleDir = join(__dirname, '..', '..', 'test-dita-file');

const files = ['db_overview.dita', 'db_config.dita'];

for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const xml = readFileSync(join(sampleDir, file), 'utf-8');
  try {
    const doc = parseDita(xml);
    const root = doc.root;
    console.log(`Root: <${root.tagName}> baseType=${root.baseType}`);

    const html = renderDocument(root, {
      headingLevel: 1,
      asWebviewUri: (p: string) => `vscode-resource:${p}`,
      documentDir: sampleDir,
    });
    console.log(`HTML output length: ${html.length} chars`);
    console.log(`First 300 chars:`);
    console.log(html.slice(0, 300));
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}
