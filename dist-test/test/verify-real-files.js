"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const ditaParser_1 = require("../parser/ditaParser");
const renderer_1 = require("../render/renderer");
const sampleDir = (0, path_1.join)(__dirname, '..', '..', 'test-dita-file');
const files = ['db_overview.dita', 'db_config.dita'];
for (const file of files) {
    console.log(`\n=== ${file} ===`);
    const xml = (0, fs_1.readFileSync)((0, path_1.join)(sampleDir, file), 'utf-8');
    try {
        const doc = (0, ditaParser_1.parseDita)(xml);
        const root = doc.root;
        console.log(`Root: <${root.tagName}> baseType=${root.baseType}`);
        const html = (0, renderer_1.renderDocument)(root, {
            headingLevel: 1,
            asWebviewUri: (p) => `vscode-resource:${p}`,
            documentDir: sampleDir,
        });
        console.log(`HTML output length: ${html.length} chars`);
        console.log(`First 300 chars:`);
        console.log(html.slice(0, 300));
    }
    catch (err) {
        console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
}
//# sourceMappingURL=verify-real-files.js.map