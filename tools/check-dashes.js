#!/usr/bin/env node
'use strict';

/* Site rule: no em dashes anywhere on the website. Use a normal hyphen,
   or reword.

   Scope is what a visitor can end up reading: the shipped HTML pages and
   the serverless functions, which produce user-facing strings. Internal
   docs (BUILD-BRIEF.md), the archived prototypes, and this checker are
   deliberately out of scope. Base64 payloads are stripped before the
   scan so image data cannot trip a false positive. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = ['index.html', 'hire', 'api'];
const EXT = new Set(['.html', '.js']);

const EM = String.fromCharCode(0x2014);
const PATTERNS = [
  { re: new RegExp(EM, 'g'), label: 'em dash (U+2014)' },
  { re: /&mdash;/gi, label: 'mdash entity' },
  { re: /&#8212;/g, label: 'numeric em dash entity' },
];

function collect(target, out = []) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return out;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (EXT.has(path.extname(full))) out.push(full);
    return out;
  }
  for (const entry of fs.readdirSync(full)) {
    collect(path.join(target, entry), out);
  }
  return out;
}

const files = TARGETS.flatMap((t) => collect(t));
let hits = 0;

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8').replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,');
  raw.split('\n').forEach((line, i) => {
    for (const { re, label } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits++;
        console.error(
          `${path.relative(ROOT, file)}:${i + 1}  ${label}\n    ${line.trim().slice(0, 120)}`
        );
      }
    }
  });
}

console.log(`Checked ${files.length} files.`);
if (hits) {
  console.error(`\n${hits} em dash${hits === 1 ? '' : 'es'} found. Use a normal hyphen, or reword.`);
  process.exit(1);
}
console.log('No em dashes found.');
