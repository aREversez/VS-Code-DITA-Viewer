#!/usr/bin/env node
// i18n consistency checker: source strings vs l10n catalogs vs package.nls.
// Run via `npm run check:l10n`. Exits non-zero when keys drift apart.
//
// Strings looked up with a runtime key (vscode.l10n.t(info.role)) can't be
// found statically — allowlist them here with their call site.
const DYNAMIC_KEYS = [
  // src/language/bookRoleL10n.ts — vscode.l10n.t(info.role)
  'Abstract',
  'Amendments',
  'Colophon',
  'Dedication',
  'Draft Intro',
  'Glossary',
  'Notices',
  'Preface',
];

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = require('child_process')
  .execSync('git ls-files src', { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => f.endsWith('.ts') && !f.includes('test'));

const used = new Map(); // key -> [file:line]
const callRe = /vscode\.l10n\.t\(\s*('([^'\\]|\\.)*'|"([^"\\]|\\.)*")/g;

for (const f of files) {
  const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(callRe)) {
      let key = m[1].slice(1, -1);
      key = key
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n');
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(`${f}:${i + 1}`);
    }
  });
}
for (const k of DYNAMIC_KEYS) {
  if (!used.has(k)) used.set(k, ['(dynamic key)']);
}

const en = JSON.parse(fs.readFileSync(path.join(root, 'l10n/bundle.l10n.json'), 'utf8'));
const zh = JSON.parse(fs.readFileSync(path.join(root, 'l10n/bundle.l10n.zh-cn.json'), 'utf8'));
const enKeys = new Set(Object.keys(en));
const zhKeys = new Set(Object.keys(zh));

console.log(`strings used in source: ${used.size}`);
console.log(`en catalog: ${enKeys.size} | zh-cn catalog: ${zhKeys.size}`);

const missing = [...used.keys()].filter((k) => !enKeys.has(k));
console.log(`\n[1] used in source but NOT in catalogs (${missing.length}):`);
missing.forEach((k) => console.log(`    ${JSON.stringify(k)}  <- ${used.get(k)[0]}`));

const zhMissing = [...enKeys].filter((k) => !zhKeys.has(k));
console.log(`\n[2] in en catalog but MISSING zh-cn translation (${zhMissing.length}):`);
zhMissing.forEach((k) => console.log(`    ${JSON.stringify(k)}`));

const zhOnly = [...zhKeys].filter((k) => !enKeys.has(k));
console.log(`\n[3] in zh-cn catalog but not in en catalog (${zhOnly.length}):`);
zhOnly.forEach((k) => console.log(`    ${JSON.stringify(k)}`));

const unused = [...enKeys].filter((k) => !used.has(k));
console.log(`\n[4] in en catalog but NOT used in source (${unused.length}):`);
unused.forEach((k) => console.log(`    ${JSON.stringify(k)}`));

const identicalZh = [...zhKeys].filter((k) => zh[k] === en[k] && /[a-z]{3}/i.test(k));
console.log(`\n[5] zh-cn translation identical to en — possible oversight (${identicalZh.length}):`);
identicalZh.forEach((k) => console.log(`    ${JSON.stringify(k)}`));

// package.json %keys% vs package.nls.<locale>.json
const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const pkgKeys = new Set();
for (const m of pkg.matchAll(/%([a-zA-Z0-9.]+)%/g)) pkgKeys.add(m[1]);
const nlsEn = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const nlsZh = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf8'));
const nlsProblems = [];
for (const k of pkgKeys) {
  if (!(k in nlsEn)) nlsProblems.push(`%${k}% missing in package.nls.json`);
  if (!(k in nlsZh)) nlsProblems.push(`%${k}% missing in package.nls.zh-cn.json`);
}
for (const k of Object.keys(nlsEn)) if (!pkgKeys.has(k)) nlsProblems.push(`stale key in package.nls.json: ${k}`);
for (const k of Object.keys(nlsZh)) if (!pkgKeys.has(k)) nlsProblems.push(`stale key in package.nls.zh-cn.json: ${k}`);
console.log(`\n[6] package.json %keys% (${pkgKeys.size}) vs package.nls files:`);
nlsProblems.forEach((p) => console.log(`    ${p}`));

const problems = missing.length + zhMissing.length + zhOnly.length + nlsProblems.length;
console.log(`\n${problems === 0 ? 'OK' : 'PROBLEMS: ' + problems}`);
process.exit(problems === 0 ? 0 : 1);
