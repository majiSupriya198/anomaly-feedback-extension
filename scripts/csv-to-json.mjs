// Usage: node scripts/csv-to-json.mjs <input.csv> [output.json]   (default output: config/feedback.json)
// Reads the `feedback` column, removes ONLY exact duplicates, keeps wording verbatim.
import fs from 'node:fs';

function parseCsv(src) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(f); f = ''; rows.push(row); row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const [input, output = new URL('../config/feedback.json', import.meta.url).pathname] = process.argv.slice(2);
if (!input) { console.error('Usage: node scripts/csv-to-json.mjs <input.csv> [output.json]'); process.exit(1); }
const rows = parseCsv(fs.readFileSync(input, 'utf8').replace(/^﻿/, ''));
const head = rows.shift();
const col = (n) => head.indexOf(n);
const iFb = col('feedback');
if (iFb < 0) throw new Error('No "feedback" column found. Columns: ' + head.join(', '));
const iAttr = col('attribute');

const map = new Map();
for (const r of rows) {
  const text = r[iFb];
  if (text == null || text.trim() === '' || text === 'NULL') continue;
  let e = map.get(text);
  if (!e) map.set(text, (e = { text, attributes: new Set(), uses: 0 }));
  e.uses++;
  if (iAttr >= 0 && r[iAttr]) e.attributes.add(r[iAttr]);
}
const now = new Date().toISOString();
const list = [...map.values()].sort((a, b) => b.uses - a.uses).map((e, i) => ({
  id: 'fb-' + String(i + 1).padStart(3, '0'),
  text: e.text,
  active: true,
  attributes: [...e.attributes].sort(),
  popularity: e.uses, // rows in the CSV that used this text; ranking hint only
  source: 'csv',
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
}));
fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, version: '1.0.0', updatedAt: now, items: list }, null, 2) + '\n');
console.log(`rows=${rows.length} unique=${list.length} -> ${output}`);
