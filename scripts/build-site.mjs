// Usage: node scripts/build-site.mjs [outDir=site]
// Builds the GitHub Pages site. ONLY the shared config is published: config/feedback.json and a tiny
// config/version.json. No source code, docs, tests or admin list ever goes into the site.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const schema = createRequire(import.meta.url)('../feedback/configSchema.js');

const out = path.resolve(process.argv[2] || 'site');
const src = process.env.AFX_CONFIG ? path.resolve(process.env.AFX_CONFIG) : new URL('../config/feedback.json', import.meta.url);
const text = fs.readFileSync(src, 'utf8');
const cfg = JSON.parse(text);
const v = schema.validateConfig(cfg);
if (!v.ok) { console.error('config/feedback.json is invalid:\n- ' + v.errors.join('\n- ')); process.exit(1); }
if (Buffer.byteLength(text) > schema.LIMITS.MAX_BYTES) { console.error('config/feedback.json is too large'); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'config'), { recursive: true });
fs.writeFileSync(path.join(out, 'config/feedback.json'), text); // byte-for-byte, so the hash matches
const info = { schemaVersion: schema.SCHEMA_VERSION, version: cfg.version, updatedAt: cfg.updatedAt, sha256: crypto.createHash('sha256').update(text).digest('hex'), count: cfg.items.length };
fs.writeFileSync(path.join(out, 'config/version.json'), JSON.stringify(info) + '\n');
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Anomaly Hub Feedback Helper config</title><p>Shared configuration for the Anomaly Hub Feedback Helper extension. Version ' + cfg.version + '.</p>\n');
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`Built ${out}: version ${cfg.version}, ${cfg.items.length} items, sha256 ${info.sha256.slice(0, 12)}…`);
