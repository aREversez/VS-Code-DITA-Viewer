// dist-esm holds the same modules as dist, compiled as ES modules for bundlers
// (package.json "exports" offers it under the "module" condition, which Node
// ignores). Mark the folder as ESM so tools that read it by path do not take
// it for CommonJS.
const { writeFileSync } = require('fs');
const { join } = require('path');
writeFileSync(join(__dirname, '..', 'dist-esm', 'package.json'), '{ "type": "module" }\n');
