import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { req, ROOT } from './helpers.js';

const schema = req('../feedback/configSchema.js');
const SCRIPT = path.join(ROOT, 'scripts/import-generalized.mjs');
const NOW = '2026-10-13T08:00:00Z';
const T = '2026-01-01T00:00:00Z';
const it0 = (id, text, attrs, pop, extra) => ({ id, text, active: true, attributes: attrs, popularity: pop, source: 'csv', createdAt: T, updatedAt: T, deletedAt: null, ...(extra || {}) });

const baseConfig = () => ({ schemaVersion: 1, version: '1.0.2', updatedAt: T, items: [
  it0('fb-001', 'old A1', ['extract.promotionText'], 5),
  it0('fb-002', 'old A2', ['extract.promotionText'], 9),
  it0('fb-003', 'old A3', ['extract.promotionText'], 1),
  it0('fb-004', 'old B', ['extract.price'], 2),
  it0('fb-005', 'raw offer string', ['extract.promotionText'], 1),
  it0('fb-006', 'Gather is not done.', ['extract.outOfStock'], 1),
  it0('fb-007', 'not in the sheet', ['extract.bulletPoints'], 3),
  it0('fb-008', 'old comment', ['feedback.commentCount'], 1),
] });
const sheet = (rows) => ['Original ID\tAttribute\tPopularity\tGeneralized feedback\tIssue type\tStatus', ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
const row = (id, attr, pop, text, status = 'mapped') => [id, attr, pop, text, 'x', status];
const SHEET = () => sheet([
  row('fb-001', 'promotionText', 5, 'GENERAL A'), row('fb-002', 'promotionText', 9, 'GENERAL A'), row('fb-003', 'promotionText', 1, 'GENERAL A'),
  row('fb-004', 'price', 2, 'GENERAL B'),
  row('fb-005', 'promotionText', 1, 'Needs manual review', 'NEEDS MANUAL REVIEW'), row('fb-006', 'outOfStock', 1, 'Needs manual review', 'NEEDS MANUAL REVIEW'),
  row('fb-008', 'commentCount', 1, 'GENERAL C'),
  ['new', 'gtin', '', 'NEW GTIN RULE', '', ''], ['new', 'commentCount', '', 'NEW COMMENT RULE', '', ''], ['new', 'price', '', 'GENERAL B', '', ''],
]);

function run(cfg, tsv, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afx-imp-'));
  const c = path.join(dir, 'c.json'), s = path.join(dir, 's.tsv'), rep = path.join(dir, 'r.json');
  fs.writeFileSync(c, JSON.stringify(cfg, null, 2)); fs.writeFileSync(s, tsv);
  const res = { dir, c, s, rep };
  try { res.out = execFileSync('node', [SCRIPT, s, '--config', c, '--report', rep, '--now', NOW, ...extra], { encoding: 'utf8', stdio: 'pipe' }); res.ok = true; }
  catch (e) { res.ok = false; res.err = String(e.stderr || e.message); }
  res.cfg = () => JSON.parse(fs.readFileSync(c, 'utf8'));
  res.report = () => JSON.parse(fs.readFileSync(rep, 'utf8'));
  return res;
}
const byId = (cfg, id) => cfg.items.find((i) => i.id === id);

describe('import-generalized', () => {
  it('is a dry run unless --write is given', () => {
    const r = run(baseConfig(), SHEET());
    expect(r.ok).toBe(true);
    expect(r.cfg()).toEqual(baseConfig());
    expect(r.out).toMatch(/Dry run/);
  });

  describe('applying', () => {
    const r = run(baseConfig(), SHEET(), ['--write']);
    const cfg = r.ok ? r.cfg() : null;
    it('succeeds and bumps the minor version', () => { expect(r.ok, r.err).toBe(true); expect(cfg.version).toBe('1.1.0'); expect(cfg.updatedAt).toBe(NOW); });
    it('result is valid in the existing managed format', () => { expect(schema.validateConfig(cfg)).toEqual({ ok: true, errors: [] }); });
    it('merges identical generalized texts into the most popular id, summing popularity', () => {
      const c = byId(cfg, 'fb-002');
      expect(c).toMatchObject({ text: 'GENERAL A', active: true, deletedAt: null, popularity: 15, source: 'generalized' });
      expect(c.attributes).toEqual(['extract.promotionText']);
    });
    it('soft-deletes the merged ids: kept, resolvable, pointing at the canonical item, old wording dropped', () => {
      for (const id of ['fb-001', 'fb-003']) expect(byId(cfg, id)).toMatchObject({ mergedInto: 'fb-002', active: false, text: 'GENERAL A' });
      expect(byId(cfg, 'fb-001').deletedAt).toBe(NOW);
      expect(JSON.stringify(cfg)).not.toMatch(/old A[123]/);
      expect(cfg.items.map((i) => i.id)).toEqual(expect.arrayContaining(['fb-001', 'fb-002', 'fb-003'])); // no id ever disappears
    });
    it('updates single entries in place, keeping the id', () => {
      expect(byId(cfg, 'fb-004')).toMatchObject({ text: 'GENERAL B', active: true });
      expect(byId(cfg, 'fb-008')).toMatchObject({ text: 'GENERAL C', attributes: ['feedback.commentCount'] });
    });
    it('does NOT promote manual-review entries: original wording kept, hidden from users', () => {
      expect(byId(cfg, 'fb-005')).toMatchObject({ text: 'raw offer string', active: false, deletedAt: null });
      expect(byId(cfg, 'fb-006')).toMatchObject({ text: 'Gather is not done.', active: false });
      expect(JSON.stringify(cfg)).not.toMatch(/Needs manual review/);
    });
    it('leaves ids that are not in the sheet untouched and reports them', () => {
      expect(byId(cfg, 'fb-007')).toEqual(baseConfig().items.find((i) => i.id === 'fb-007'));
      expect(r.report().untouched.map((u) => u.id)).toEqual(['fb-007']);
    });
    it('adds new entries with fresh ids, reusing the attribute namespace, and skips equivalents', () => {
      expect(byId(cfg, 'fb-009')).toMatchObject({ text: 'NEW GTIN RULE', attributes: ['extract.gtin'], active: true, source: 'sheet', popularity: 0 });
      expect(byId(cfg, 'fb-010')).toMatchObject({ text: 'NEW COMMENT RULE', attributes: ['feedback.commentCount'] }); // namespace reused
      expect(cfg.items.some((i) => i.id === 'fb-011')).toBe(false);
      expect(r.report().newSkipped).toEqual([expect.objectContaining({ existing: 'fb-004', reason: 'identical text already exists' })]); // "GENERAL B" already exists
    });
    it('leaves no duplicate active texts', () => {
      const t = cfg.items.filter((i) => i.active && !i.deletedAt).map((i) => i.text);
      expect(new Set(t).size).toBe(t.length);
    });
    it('is idempotent: running again changes nothing and does not bump the version', () => {
      const again = run(cfg, SHEET(), ['--write']);
      expect(again.ok, again.err).toBe(true);
      expect(again.cfg()).toEqual(cfg);
      expect(again.out).toMatch(/"changed": false/);
    });
  });

  describe('--prune (remove everything that is not in the sheet)', () => {
    it('soft-deletes ids missing from the sheet, keeps their text so they can be restored, never touches sheet ids', () => {
      const r = run(baseConfig(), SHEET(), ['--write', '--prune']);
      expect(r.ok, r.err).toBe(true);
      const cfg = r.cfg();
      expect(byId(cfg, 'fb-007')).toMatchObject({ text: 'not in the sheet', active: false, deletedAt: NOW });
      expect(r.report().pruned.map((p) => p.id)).toEqual(['fb-007']);
      expect(r.report().untouched).toEqual([]);
      expect(cfg.items.length).toBe(baseConfig().items.length + 2); // nothing hard-deleted; only the 2 new items were added
      expect(byId(cfg, 'fb-002').active).toBe(true);
      expect(schema.validateConfig(cfg).ok).toBe(true);
    });
    it('is idempotent and does not prune pending (manual-review) entries, which are in the sheet', () => {
      const first = run(baseConfig(), SHEET(), ['--write', '--prune']);
      const again = run(first.cfg(), SHEET(), ['--write', '--prune']);
      expect(again.cfg()).toEqual(first.cfg());
      expect(byId(again.cfg(), 'fb-005').deletedAt).toBeNull();
      expect(byId(again.cfg(), 'fb-006').deletedAt).toBeNull();
    });
  });

  describe('safety', () => {
    it('refuses an id that is not in the config (never invents or reuses ids)', () => {
      const r = run(baseConfig(), sheet([row('fb-999', 'price', 1, 'X')]), ['--write']);
      expect(r.ok).toBe(false); expect(r.err).toMatch(/does not exist/);
      expect(r.cfg()).toEqual(baseConfig());
    });
    it('refuses empty generalized text, unknown status, duplicate ids and missing columns', () => {
      expect(run(baseConfig(), sheet([row('fb-001', 'price', 1, '  ')])).err).toMatch(/empty generalized text/);
      expect(run(baseConfig(), sheet([row('fb-001', 'price', 1, 'X', 'maybe')])).err).toMatch(/unknown status/);
      expect(run(baseConfig(), sheet([row('fb-001', 'promotionText', 1, 'X'), row('fb-001', 'promotionText', 1, 'Y')])).err).toMatch(/duplicate id/);
      expect(run(baseConfig(), 'Original ID\tAttribute\nfb-001\tprice\n').err).toMatch(/column "Popularity"/);
    });
    it('flags attribute disagreements between the sheet and the config', () => {
      const r = run(baseConfig(), sheet([row('fb-004', 'netQuantity', 2, 'GENERAL B')]));
      expect(r.ok).toBe(true);
      expect(r.report().attributeMismatches[0]).toMatch(/fb-004/);
    });
    it('does not write anything when the result would be invalid', () => {
      const cfg = baseConfig(); cfg.items = cfg.items.filter((i) => i.id === 'fb-001'); // one item, about to be deactivated
      const r = run(cfg, sheet([row('fb-001', 'promotionText', 1, 'Needs manual review', 'NEEDS MANUAL REVIEW')]), ['--write']);
      expect(r.ok).toBe(false); expect(r.err).toMatch(/no active items/);
      expect(r.cfg()).toEqual(cfg);
    });
  });
});
