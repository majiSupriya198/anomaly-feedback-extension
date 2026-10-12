// Usage: node scripts/publish-list.mjs <export.json>
// Turns an admin "Export JSON" file into the shared config: validates it, writes config/feedback.json
// and bumps the patch version. Commit and push; GitHub Actions then publishes it to everyone.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const schema = createRequire(import.meta.url)('../feedback/configSchema.js');

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/publish-list.mjs <export.json>'); process.exit(1); }
const items = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(items)) throw new Error('Expected a JSON array (an admin export).');

const file = new URL('../config/feedback.json', import.meta.url);
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: '1.0.0' };
const [maj, min, pat] = schema.parseVersion(prev.version);
const cfg = { schemaVersion: schema.SCHEMA_VERSION, version: `${maj}.${min}.${pat + 1}`, updatedAt: new Date().toISOString(), items };
const v = schema.validateConfig(cfg);
if (!v.ok) { console.error('Invalid list:\n- ' + v.errors.join('\n- ')); process.exit(1); }
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log(`Published ${items.length} items as version ${cfg.version}. Commit config/ and push.`);
