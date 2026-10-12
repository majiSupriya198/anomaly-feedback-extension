// Usage: node scripts/import-generalized.mjs <sheet.tsv> [--write] [--prune] [--config path] [--report path] [--now ISO]
//
// Applies a "generalized feedback" sheet (TSV export) to the managed config (config/feedback.json),
// using the EXISTING managed format: stable ids, `active`, soft delete (`deletedAt`), `attributes`.
//
// Columns used (by header name): "Original ID", "Attribute", "Popularity", "Generalized feedback", "Status".
//   - Status "mapped": the item with that Original ID gets the generalized text. Rows with identical text are
//     merged: the first (highest popularity) id is kept as the canonical item, the others are soft-deleted
//     and point at it (`mergedInto`). Their old wording is dropped; the tombstone carries the canonical text,
//     so ids stay resolvable and nothing referencing them breaks.
//   - Status containing "MANUAL": NOT promoted. The original item is left as it was but set inactive
//     (hidden from normal users, still visible to admins) until someone reviews it.
//   - Original ID "new": added as a new item (id assigned after the highest existing id), unless an
//     identical active text already exists.
//   - Ids in the config that are not in the sheet are left untouched and reported, or, with --prune,
//     soft-deleted (hidden, restorable from the admin page; there is no hard delete).
// Dry run by default. With --write the config is rewritten and its version bumped (minor).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const schema = createRequire(import.meta.url)('../feedback/configSchema.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const tsvPath = args.find((a, i) => !a.startsWith('--') && (i === 0 || !['--config', '--report', '--now'].includes(args[i - 1])));
if (!tsvPath) { console.error('Usage: node scripts/import-generalized.mjs <sheet.tsv> [--write] [--config path] [--report path]'); process.exit(1); }
const configPath = opt('--config') || new URL('../config/feedback.json', import.meta.url).pathname;
const now = opt('--now') || new Date().toISOString().replace(/\.\d+Z$/, 'Z');

function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }

// ---- read sheet --------------------------------------------------------------------------------------------
const lines = fs.readFileSync(tsvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
const header = lines.shift().split('\t').map((h) => h.trim());
const col = (name) => { const i = header.indexOf(name); if (i < 0) fail(`column "${name}" not found. Columns: ${header.join(', ')}`); return i; };
const cId = col('Original ID'), cAttr = col('Attribute'), cPop = col('Popularity'), cText = col('Generalized feedback'), cStatus = col('Status');
const rows = lines.map((l, n) => {
  const c = l.split('\t');
  return { line: n + 2, id: (c[cId] || '').trim(), attr: (c[cAttr] || '').trim(), pop: Number(c[cPop]) || 0, text: c[cText] || '', status: (c[cStatus] || '').trim() };
});

// ---- read config -------------------------------------------------------------------------------------------
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const before = JSON.stringify(cfg.items);
const byId = new Map(cfg.items.map((i) => [i.id, i]));
const report = { pruned: [], removedOld: [], canonical: [], newAdded: [], newSkipped: [], pending: [], untouched: [], warnings: [], attributeMismatches: [] };

const isPending = (r) => /manual/i.test(r.status);
const isNew = (r) => r.id === 'new' || r.id === '';
const mapped = rows.filter((r) => !isNew(r) && !isPending(r) && /^mapped$/i.test(r.status));
const pending = rows.filter((r) => !isNew(r) && isPending(r));
const added = rows.filter(isNew);

for (const r of rows) {
  if (!isNew(r) && !byId.has(r.id)) fail(`line ${r.line}: "${r.id}" does not exist in the config (no id is ever invented or reused).`);
  if (!isNew(r) && !isPending(r) && !/^mapped$/i.test(r.status)) fail(`line ${r.line}: unknown status "${r.status}" for ${r.id}`);
  if (!isPending(r) && (!r.text || r.text.trim() === '')) fail(`line ${r.line}: empty generalized text for ${r.id || 'new'}`);
}
const seen = new Set();
for (const r of rows.filter((x) => !isNew(x))) { if (seen.has(r.id)) fail(`duplicate id ${r.id} in the sheet`); seen.add(r.id); }

const hasAttr = (item, attr) => (item.attributes || []).some((a) => a.split('.').pop().toLowerCase() === attr.toLowerCase());
const prefixFor = (attr) => { // reuse the namespace the config already uses for this attribute (extract. / feedback.)
  const hit = cfg.items.flatMap((i) => i.attributes || []).find((a) => a.split('.').pop().toLowerCase() === attr.toLowerCase());
  return hit ? hit.split('.').slice(0, -1).join('.') + '.' + hit.split('.').pop() : 'extract.' + attr;
};

// ---- group mapped rows by identical generalized text -------------------------------------------------------
const groups = new Map();
for (const r of mapped) { if (!groups.has(r.text)) groups.set(r.text, []); groups.get(r.text).push(r); }

for (const [text, members] of groups) {
  members.sort((a, b) => b.pop - a.pop || a.id.localeCompare(b.id)); // canonical = most popular, then lowest id
  const canon = byId.get(members[0].id);
  const attrs = new Set();
  for (const m of members) {
    const item = byId.get(m.id);
    if (!hasAttr(item, m.attr)) report.attributeMismatches.push(`${m.id}: sheet says "${m.attr}", config has [${(item.attributes || []).join(', ')}]`);
    (item.attributes || []).forEach((a) => attrs.add(a));
  }
  const pop = members.reduce((s, m) => s + m.pop, 0);
  const wasText = canon.text;
  Object.assign(canon, { text, active: true, attributes: [...attrs].sort(), popularity: pop, deletedAt: null, source: 'generalized' });
  delete canon.mergedInto;
  if (canon.text !== wasText || JSON.stringify(canon) !== JSON.stringify(JSON.parse(before).find((i) => i.id === canon.id))) canon.updatedAt = now;
  report.canonical.push({ id: canon.id, attributes: canon.attributes, popularity: pop, merged: members.slice(1).map((m) => m.id), text });
  for (const m of members.slice(1)) {
    const old = byId.get(m.id);
    if (!(old.deletedAt && old.mergedInto === canon.id && old.text === text)) {
      Object.assign(old, { text, active: false, deletedAt: old.deletedAt || now, mergedInto: canon.id, updatedAt: now });
    }
    report.removedOld.push({ id: m.id, mergedInto: canon.id });
  }
}

// Old wording of every replaced item is gone: canonical items carry the generalized text, tombstones carry it too.
for (const r of mapped) { const i = byId.get(r.id); if (!i.deletedAt && i.text !== r.text) fail(`internal: ${r.id} was not updated`); }

// ---- pending / manual review: never promoted ----------------------------------------------------------------
for (const r of pending) {
  const item = byId.get(r.id);
  if (item.active !== false) { item.active = false; item.updatedAt = now; }
  report.pending.push({ id: r.id, attribute: r.attr, originalText: item.text, status: r.status });
}

// ---- ids in the config but not in the sheet ------------------------------------------------------------------
const inSheet = new Set(rows.filter((r) => !isNew(r)).map((r) => r.id));
// An item also counts as "in the sheet" when its text is one of the sheet's texts. That protects entries added
// from "new" rows (which have no Original ID) when the import is run again.
const sheetTexts = new Set(rows.filter((r) => !isPending(r)).map((r) => r.text));
for (const i of cfg.items) {
  if (inSheet.has(i.id) || i.deletedAt || sheetTexts.has(i.text)) continue;
  if (flag('--prune')) { Object.assign(i, { active: false, deletedAt: now, updatedAt: now }); report.pruned.push({ id: i.id, attributes: i.attributes, text: i.text }); }
  else report.untouched.push({ id: i.id, attributes: i.attributes, text: i.text });
}

// ---- new entries ----------------------------------------------------------------------------------------------
let maxId = Math.max(...cfg.items.map((i) => +i.id.slice(3)));
for (const r of added) {
  const dup = cfg.items.find((i) => !i.deletedAt && i.active !== false && i.text === r.text);
  if (dup) { report.newSkipped.push({ attribute: r.attr, existing: dup.id, reason: 'identical text already exists' }); continue; }
  const prior = cfg.items.find((i) => i.source === 'sheet' && i.text === r.text);
  if (prior) { report.newSkipped.push({ attribute: r.attr, existing: prior.id, reason: 'already imported' }); continue; }
  const item = { id: 'fb-' + String(++maxId).padStart(3, '0'), text: r.text, active: true, attributes: [prefixFor(r.attr)], popularity: 0, source: 'sheet', createdAt: now, updatedAt: now, deletedAt: null };
  cfg.items.push(item); byId.set(item.id, item);
  report.newAdded.push({ id: item.id, attributes: item.attributes, text: item.text });
}
// an id that was assigned above but whose item was not pushed must not shift later ids
// (ids are only taken when an item is actually added)

// ---- finish -----------------------------------------------------------------------------------------------------
const changed = JSON.stringify(cfg.items) !== before;
if (changed) {
  const [maj, min] = schema.parseVersion(cfg.version);
  cfg.version = `${maj}.${min + 1}.0`; cfg.updatedAt = now;
}
const v = schema.validateConfig(cfg);
if (!v.ok) fail('resulting config is invalid:\n- ' + v.errors.join('\n- '));
const active = cfg.items.filter((i) => i.active !== false && !i.deletedAt);
const texts = active.map((i) => i.text);
if (new Set(texts).size !== texts.length) fail('duplicate active feedback texts remain after import');

const summary = { changed, version: cfg.version, totalItems: cfg.items.length, activeItems: active.length, canonical: report.canonical.length, softDeleted: report.removedOld.length, pruned: report.pruned.length, pending: report.pending.length, newAdded: report.newAdded.length, newSkipped: report.newSkipped.length, untouched: report.untouched.length, attributeMismatches: report.attributeMismatches.length };
console.log(JSON.stringify(summary, null, 2));
if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify({ summary, ...report }, null, 2) + '\n');
if (flag('--write')) {
  if (!changed) console.log('No changes: the config already matches the sheet.');
  else { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n'); console.log(`Wrote ${configPath} (version ${cfg.version}). Review the diff, then commit.`); }
} else console.log('Dry run only. Re-run with --write to apply.');
