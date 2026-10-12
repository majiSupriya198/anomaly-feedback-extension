// Usage: node scripts/check-version-bump.mjs [baseRef=HEAD~1]
// CI guard: if config/feedback.json changed, its version must have increased, otherwise installed
// extensions would never notice the change.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const schema = createRequire(import.meta.url)('../feedback/configSchema.js');

const base = process.argv[2] || 'HEAD~1';
let before;
try { before = execFileSync('git', ['show', `${base}:config/feedback.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
catch (e) { console.log('No previous config to compare with; skipping.'); process.exit(0); }
const now = fs.readFileSync(new URL('../config/feedback.json', import.meta.url), 'utf8');
const a = JSON.parse(before), b = JSON.parse(now);
const content = (c) => JSON.stringify(c.items);
if (content(a) === content(b)) { console.log('Config items unchanged.'); process.exit(0); }
if (schema.compareVersions(b.version, a.version) <= 0) {
  console.error(`config/feedback.json changed but version ${b.version} was not increased above ${a.version}. Run: npm run publish:list -- <export.json>, or bump "version" by hand.`);
  process.exit(1);
}
console.log(`Version bumped ${a.version} -> ${b.version}.`);
