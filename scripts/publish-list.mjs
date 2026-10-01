// Usage: node scripts/publish-list.mjs <export.json>
// Turns an admin "Export JSON" file into the list shipped with the extension: validates it, writes
// data/feedback.json, and bumps data/feedback.meta.json so teammates' caches refresh on update.
import fs from 'node:fs';

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/publish-list.mjs <export.json>'); process.exit(1); }
const list = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(list)) throw new Error('Expected a JSON array.');
const ids = new Set(), texts = new Set();
for (const i of list) {
  if (!i || typeof i.id !== 'string' || !/^fb-\d+$/.test(i.id)) throw new Error('Bad or missing id: ' + JSON.stringify(i && i.id));
  if (typeof i.text !== 'string' || !i.text.trim()) throw new Error('Empty text for ' + i.id);
  if (ids.has(i.id)) throw new Error('Duplicate id ' + i.id);
  if (!i.deletedAt && texts.has(i.text)) throw new Error('Duplicate text for ' + i.id);
  ids.add(i.id); if (!i.deletedAt) texts.add(i.text);
}
const dataDir = new URL('../data/', import.meta.url);
fs.writeFileSync(new URL('feedback.json', dataDir), JSON.stringify(list, null, 2) + '\n');
const metaUrl = new URL('feedback.meta.json', dataDir);
const prev = fs.existsSync(metaUrl) ? JSON.parse(fs.readFileSync(metaUrl, 'utf8')).version || 1 : 0;
fs.writeFileSync(metaUrl, JSON.stringify({ version: prev + 1 }) + '\n');
console.log(`Published ${list.length} items, bundle version ${prev + 1}. Commit data/ and push.`);
