import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { req, ROOT } from './helpers.js';

const schema = req('../feedback/configSchema.js');
const good = () => ({ schemaVersion: 1, version: '1.0.1', updatedAt: '2026-10-12T10:00:00Z', items: [
  { id: 'fb-001', text: 'one', active: true, attributes: ['extract.price'] }, { id: 'fb-002', text: 'two' }] });
const bad = (patch) => schema.validateConfig(Object.assign(good(), patch));

describe('version comparison', () => {
  it('compares numerically, not as strings', () => {
    expect(schema.compareVersions('1.0.12', '1.0.9')).toBe(1);
    expect(schema.compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(schema.compareVersions('1.2', '1.10.0')).toBe(-1);
    expect(schema.compareVersions(2, '1.9.9')).toBe(1);
  });
  it('throws on invalid versions so garbage can never look newer', () => {
    for (const v of ['', 'abc', '1.0.0.0', '1.x', null, undefined, -1, {}]) expect(() => schema.compareVersions(v, '1.0.0')).toThrow();
  });
});

describe('config validation', () => {
  it('accepts a valid config', () => expect(schema.validateConfig(good())).toEqual({ ok: true, errors: [] }));
  it('rejects malformed shapes', () => {
    for (const c of [null, undefined, 'x', 5, [], { items: [] }]) expect(schema.validateConfig(c).ok).toBe(false);
  });
  it('rejects an empty list and a list with nothing active', () => {
    expect(bad({ items: [] }).errors.join()).toMatch(/empty/);
    expect(bad({ items: [{ id: 'fb-001', text: 'a', active: false }] }).errors.join()).toMatch(/no active/);
  });
  it('rejects bad ids, empty text, duplicates, bad types, wrong schema/version/date', () => {
    expect(bad({ items: [{ id: 'x1', text: 'a' }] }).ok).toBe(false);
    expect(bad({ items: [{ id: 'fb-001', text: '  ' }] }).ok).toBe(false);
    expect(bad({ items: [{ id: 'fb-001', text: 'a' }, { id: 'fb-001', text: 'b' }] }).ok).toBe(false);
    expect(bad({ items: [{ id: 'fb-001', text: 'a' }, { id: 'fb-002', text: 'a' }] }).ok).toBe(false);
    expect(bad({ items: [{ id: 'fb-001', text: 'a', active: 'yes' }] }).ok).toBe(false);
    expect(bad({ items: [{ id: 'fb-001', text: 'a', attributes: [1] }] }).ok).toBe(false);
    expect(bad({ schemaVersion: 2 }).ok).toBe(false);
    expect(bad({ version: 'latest' }).ok).toBe(false);
    expect(bad({ updatedAt: 'yesterday' }).ok).toBe(false);
  });
  it('allows the same text again if the earlier one is deleted', () => {
    expect(bad({ items: [{ id: 'fb-001', text: 'a', deletedAt: 'x' }, { id: 'fb-002', text: 'a' }] }).ok).toBe(true);
  });
  it('enforces size limits', () => {
    expect(bad({ items: Array.from({ length: 5001 }, (_, i) => ({ id: 'fb-' + i, text: 't' + i })) }).ok).toBe(false);
    expect(bad({ items: [{ id: 'fb-001', text: 'x'.repeat(5001) }] }).ok).toBe(false);
  });
  it('validates version.json', () => {
    const v = { schemaVersion: 1, version: '1.0.1', updatedAt: '2026-10-12T10:00:00Z', sha256: 'a'.repeat(64) };
    expect(schema.validateVersionInfo(v).ok).toBe(true);
    for (const patch of [{ sha256: 'zz' }, { version: 'x' }, { schemaVersion: 9 }, { updatedAt: 'no' }]) expect(schema.validateVersionInfo({ ...v, ...patch }).ok).toBe(false);
    expect(schema.validateVersionInfo(null).ok).toBe(false);
  });
  it('the shipped config/feedback.json is valid: 103 unique texts, version set', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/feedback.json'), 'utf8'));
    expect(schema.validateConfig(cfg)).toEqual({ ok: true, errors: [] });
    expect(cfg.items.length).toBeGreaterThanOrEqual(103);
  });
});

describe('site build (what gets published)', () => {
  const build = (cfgPath) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'afx-site-'));
    execFileSync('node', [path.join(ROOT, 'scripts/build-site.mjs'), out], { env: { ...process.env, ...(cfgPath ? { AFX_CONFIG: cfgPath } : {}) }, stdio: 'pipe' });
    return out;
  };
  it('publishes ONLY config files, with a matching sha256', () => {
    const out = build();
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.relative(out, path.join(d, f.name))); })(out);
    expect(files.sort()).toEqual(['.nojekyll', 'config/feedback.json', 'config/version.json', 'index.html']);
    const info = JSON.parse(fs.readFileSync(path.join(out, 'config/version.json'), 'utf8'));
    expect(info.sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, 'config/feedback.json'))).digest('hex'));
    const all = files.map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
    expect(all).not.toMatch(/commerceiq\.ai|token|secret|password/i); // no admin emails or credentials
  });
  it('refuses to build an invalid config', () => {
    const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'afx-')), 'c.json');
    fs.writeFileSync(bad, JSON.stringify({ ...good(), items: [] }));
    expect(() => build(bad)).toThrow();
  });
});
