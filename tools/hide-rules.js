// =============================================================================
//  castButtonRemover - keeps the two generated copies of the hide rules in step
//
//    content/hide.css        the single source, edited by hand
//    content/main-world.js   CSS_TEXT    that file verbatim, so the page world can
//                                        adopt it into every shadow root
//    content/dom-guard.js    KNOWN       the selectors hidden on sight by name
//
//  KNOWN is every selector in hide.css except two kinds, which the stylesheet
//  already covers and which must not be matched on the element alone:
//
//    [data-nocast="1"]                       this extension's own marker
//    button[...]  /  [role="button"][...]    generic elements matched by label
//
//  Usage:
//    node tools/hide-rules.mjs            rewrite the generated copies
//    node tools/hide-rules.mjs --check    write nothing, exit 1 if out of date
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssPath = path.join(root, 'extension', 'content', 'hide.css');
const mainPath = path.join(root, 'extension', 'content', 'main-world.js');
const guardPath = path.join(root, 'extension', 'content', 'dom-guard.js');
const checkOnly = process.argv.includes('--check');

const css = fs.readFileSync(cssPath, 'utf8');

// --- selectors out of the stylesheet ----------------------------------------
const MARKER = '[data-nocast="1"]';
const selectors = [];
for (const raw of css.split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('/*') || line.startsWith('*') || line.endsWith('*/')) continue;
  const brace = line.indexOf('{');
  if (brace === -1) continue;
  selectors.push(line.slice(0, brace).trim());
}
if (!selectors.length) throw new Error('no selectors found in content/hide.css');

const isGeneric = (s) => s.startsWith('button[') || s.startsWith('[role="button"]');
const known = selectors.filter((s) => s !== MARKER && !isGeneric(s));

// --- rewrite one assignment line --------------------------------------------
function rewrite(file, label, pattern, rendered) {
  const before = fs.readFileSync(file, 'utf8');
  if (!pattern.test(before)) throw new Error(`${path.relative(root, file)} has no ${label} line`);
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const after = before.replace(pattern, (_, indent) => `${indent}var ${label} = ${rendered};`);
  if (after === before) return { file, changed: false };
  if (!checkOnly) fs.writeFileSync(file, after.replace(/\r?\n/g, eol));
  return { file, changed: true };
}

const results = [
  rewrite(
    mainPath, 'CSS_TEXT',
    /^([ \t]*)var CSS_TEXT = [^\n]*;[ \t]*$/m,
    JSON.stringify(css)
  ),
  rewrite(
    guardPath, 'KNOWN',
    /^([ \t]*)var KNOWN = [^\n]*;[ \t]*$/m,
    JSON.stringify(known)
  ),
];

for (const r of results) {
  const name = path.relative(root, r.file);
  if (r.changed) {
    console.log(`${checkOnly ? 'STALE' : 'wrote'} ${name}`);
  } else {
    console.log(`ok    ${name}`);
  }
}
console.log(`      ${selectors.length} rules, ${known.length} in KNOWN, ${css.length} bytes of CSS`);

if (checkOnly && results.some((r) => r.changed)) process.exit(1);
