import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { req, memoryBackend, ROOT } from './helpers.js';

const schema = req('../feedback/configSchema.js');
const store = req('../storage/feedbackStore.js');
const { createRemoteConfig } = req('../feedback/remoteConfig.js');

/** Real build + real HTTP: edit config -> build site -> serve (like Pages) -> installed extension picks it up. */
let dir, siteDir, server, base, hits;
const cfgPath = () => path.join(dir, 'feedback.json');
const build = () => execFileSync('node', [path.join(ROOT, 'scripts/build-site.mjs'), siteDir], { env: { ...process.env, AFX_CONFIG: cfgPath() }, stdio: 'pipe' });
const readCfg = () => JSON.parse(fs.readFileSync(cfgPath(), 'utf8'));
const writeCfg = (c) => fs.writeFileSync(cfgPath(), JSON.stringify(c, null, 2) + '\n');
const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/feedback.json'), 'utf8'));
const bump = (v) => { const [a, b, c] = schema.parseVersion(v); return `${a}.${b}.${c + 1}`; };
// A fresh "user" = own browser storage + the shipped extension bundle. The store module is a singleton,
// so each user must be switched to before acting as them.
const browser = async (bundled) => {
  const u = { mem: memoryBackend(), bundled: bundled || shipped.version };
  u.use = () => store._configure({ backend: u.mem, seedLoader: async () => structuredClone(shipped.items), metaLoader: async () => ({ version: u.bundled }) });
  u.use(); await store.getAll();
  const rc = createRemoteConfig({ baseUrl: base, store, schema, throttleMs: 0, errorRetryMs: 0, timeoutMs: 2000 });
  u.check = () => { u.use(); return rc.check(); };
  u.texts = async () => { u.use(); return (await store.getAll()).map((i) => [i.id, i.text]); };
  return u;
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afx-e2e-')); siteDir = path.join(dir, 'site');
  fs.copyFileSync(path.join(ROOT, 'config/feedback.json'), cfgPath());
  build(); hits = [];
  server = http.createServer((q, r) => {
    hits.push(q.url);
    const f = path.join(siteDir, q.url.replace(/^\/repo\//, ''));
    if (!f.startsWith(siteDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    const body = fs.readFileSync(f);
    r.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=0', ETag: '"' + crypto.createHash('md5').update(body).digest('hex') + '"' });
    r.end(body);
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  base = 'http://127.0.0.1:' + server.address().port + '/repo/';
});
afterAll(() => new Promise((r) => server.close(r)));

describe('end to end: developer edits a rule -> published -> installed extensions update', () => {
  it('the full acceptance flow, with no pull, rebuild or re-import on the user side', async () => {
    const userA = await browser();
    const userB = await browser();
    hits.length = 0;
    expect((await userA.check()).status).toBe('unchanged'); // site == shipped list
    expect(hits).toEqual(['/repo/config/version.json']);

    // developer changes a shared feedback rule and pushes (here: edit config, bump version, rebuild site)
    const c = readCfg();
    c.version = bump(readCfg().version); c.updatedAt = new Date().toISOString();
    c.items[0].text = 'EDITED SHARED RULE: updated wording for everyone.';
    c.items.push({ id: 'fb-900', text: 'A brand new shared suggestion.', active: true, attributes: ['extract.gtin'], popularity: 0, source: 'repo', createdAt: c.updatedAt, updatedAt: c.updatedAt, deletedAt: null });
    writeCfg(c); build();

    hits.length = 0;
    expect((await userA.check()).status).toBe('updated');
    expect((await userB.check()).status).toBe('updated');
    const a = await userA.texts(), b = await userB.texts();
    expect(a.map((x) => x[1])).toContain('EDITED SHARED RULE: updated wording for everyone.');
    expect(a.map((x) => x[1])).toContain('A brand new shared suggestion.');
    expect(b).toEqual(a); // every user sees exactly the same list
    expect(hits.filter((h) => h.endsWith('feedback.json')).length).toBe(2); // one download per user, no extras
  });

  it('a push that forgets to raise the version is not picked up (the CI guard exists for this)', async () => {
    const u = await browser();
    await u.check(); // up to date at the current site version
    const c = readCfg(); c.items[1].text = 'changed without a version bump'; writeCfg(c); build();
    expect((await u.check()).status).toBe('unchanged');
    expect((await u.texts()).map((x) => x[1])).not.toContain('changed without a version bump');
  });

  it('site outage: the user keeps the last known good list and recovers afterwards', async () => {
    const u = await browser();
    await u.check();
    const before = JSON.stringify(await u.texts());
    fs.renameSync(siteDir, siteDir + '.down');
    const r = await u.check();
    expect(r.status).toBe('error');
    expect(JSON.stringify(await u.texts())).toBe(before);
    fs.renameSync(siteDir + '.down', siteDir);
    const c = readCfg(); c.version = bump(readCfg().version); c.updatedAt = new Date().toISOString(); c.items[2].text = 'after the outage'; writeCfg(c); build();
    expect((await u.check()).status).toBe('updated');
    expect((await u.texts()).some((x) => x[1] === 'after the outage')).toBe(true);
  });
});
