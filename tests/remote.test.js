import { describe, it, expect, beforeEach } from 'vitest';
import { req, memoryBackend, SEED, sleep } from './helpers.js';

const schema = req('../feedback/configSchema.js');
const store = req('../storage/feedbackStore.js');
const { createRemoteConfig, sha256Hex } = req('../feedback/remoteConfig.js');

const BASE = 'https://pages.example/repo/';
const cfg = (version, extra = []) => ({ schemaVersion: 1, version, updatedAt: '2026-10-12T10:00:00Z', items: [...SEED, ...extra] });
const item = (n, text) => ({ id: 'fb-' + n, text, active: true, attributes: [], popularity: 0, source: 'repo' });

/** A fake GitHub Pages site. `calls` records every request made. */
function pages(initial) {
  const site = { calls: [], files: {}, fail: null, hang: false, options: [] };
  site.publish = async (c, over) => {
    const text = typeof c === 'string' ? c : JSON.stringify(c);
    site.files['config/feedback.json'] = text;
    let ver = { schemaVersion: 1, version: c.version, updatedAt: c.updatedAt, sha256: await sha256Hex(text), count: (c.items || []).length };
    site.files['config/version.json'] = JSON.stringify({ ...ver, ...(over || {}) });
  };
  site.fetchFn = (url, opts) => {
    site.calls.push(url.replace(BASE, ''));
    site.options.push(opts);
    if (site.hang) return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (site.fail === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    if (site.fail) return Promise.resolve({ ok: false, status: site.fail, text: async () => '' });
    const body = site.files[url.replace(BASE, '')];
    if (body == null) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
    return Promise.resolve({ ok: true, status: 200, text: async () => body });
  };
  return initial ? site.publish(initial).then(() => site) : site;
}

let mem, clock, site;
const mk = (over) => createRemoteConfig({ baseUrl: BASE, fetchFn: site.fetchFn, store, schema, now: () => clock, throttleMs: 15 * 60e3, errorRetryMs: 2 * 60e3, timeoutMs: 50, ...over });
async function setup(bundledVersion = '1.0.0') {
  mem = memoryBackend(); clock = 1_000_000;
  store._configure({ backend: mem, seedLoader: async () => structuredClone(SEED), metaLoader: async () => ({ version: bundledVersion }) });
  await store.getAll();
  site = await pages(cfg('1.0.1', [item(50, 'shipped remotely')]));
}
const texts = async () => (await store.getAll()).map((i) => i.text);

describe('first-time download and caching', () => {
  beforeEach(() => setup());
  it('downloads once, validates, caches, and records the version', async () => {
    const r = await mk().check();
    expect(r).toMatchObject({ status: 'updated', version: '1.0.1' });
    expect(site.calls).toEqual(['config/version.json', 'config/feedback.json']);
    expect(await texts()).toContain('shipped remotely');
    expect(await store.getConfigVersion()).toBe('1.0.1');
    expect(mem.data['afx.remoteConfig'].version).toBe('1.0.1'); // last known good
  });
  it('config unchanged: only the tiny version.json is requested, nothing re-downloaded', async () => {
    const rc = mk();
    await rc.check(); site.calls.length = 0;
    clock += 16 * 60e3;
    expect((await rc.check()).status).toBe('unchanged');
    expect(site.calls).toEqual(['config/version.json']);
  });
  it('same version as the bundled list: feedback.json is never downloaded', async () => {
    await setup('1.0.1');
    expect((await mk().check()).status).toBe('unchanged');
    expect(site.calls).toEqual(['config/version.json']);
  });
  it('requests are made without credentials and revalidate with the server', async () => {
    await mk().check();
    for (const o of site.options) expect(o).toMatchObject({ credentials: 'omit', cache: 'no-cache', redirect: 'error' });
  });
});

describe('no unnecessary network calls', () => {
  beforeEach(() => setup());
  it('is throttled: repeated checks inside the window make zero requests', async () => {
    const rc = mk();
    await rc.check(); site.calls.length = 0;
    for (let i = 0; i < 20; i++) expect((await rc.check()).status).toBe('throttled');
    expect(site.calls).toEqual([]);
    clock += 15 * 60e3 + 1;
    await rc.check();
    expect(site.calls).toEqual(['config/version.json']);
  });
  it('force bypasses the throttle', async () => {
    const rc = mk(); await rc.check(); site.calls.length = 0;
    await rc.check({ force: true });
    expect(site.calls).toEqual(['config/version.json']);
  });
  it('simultaneous checks (several Hub tabs) share one run', async () => {
    const rc = mk();
    const rs = await Promise.all([rc.check(), rc.check(), rc.check(), rc.check()]);
    expect(rs.every((r) => r === rs[0] || r.status === rs[0].status)).toBe(true);
    expect(site.calls).toEqual(['config/version.json', 'config/feedback.json']);
  });
  it('throttle survives a service worker restart (state is persisted)', async () => {
    await mk().check(); site.calls.length = 0;
    expect((await mk().check()).status).toBe('throttled'); // brand-new client, same storage
    expect(site.calls).toEqual([]);
  });
});

describe('version changes', () => {
  beforeEach(() => setup());
  it('picks up a newer version and replaces the cached list', async () => {
    const rc = mk(); await rc.check();
    await site.publish(cfg('1.0.2', [item(51, 'second change')]));
    clock += 16 * 60e3; site.calls.length = 0;
    expect((await rc.check()).status).toBe('updated');
    expect(site.calls).toEqual(['config/version.json', 'config/feedback.json']);
    expect(await texts()).toContain('second change');
    expect(await texts()).not.toContain('shipped remotely'); // the published list is the truth
  });
  it('ignores an older version (no downgrade)', async () => {
    const rc = mk(); await rc.check();
    await site.publish(cfg('1.0.0', [item(60, 'rollback attempt')]));
    clock += 16 * 60e3;
    expect((await rc.check()).status).toBe('unchanged');
    expect(await texts()).not.toContain('rollback attempt');
  });
  it('compares versions numerically (1.0.12 beats 1.0.9)', async () => {
    await site.publish(cfg('1.0.9', [item(70, 'nine')]));
    const rc = mk(); await rc.check();
    await site.publish(cfg('1.0.12', [item(71, 'twelve')]));
    clock += 16 * 60e3;
    expect((await rc.check()).status).toBe('updated');
    expect(await texts()).toContain('twelve');
  });
});

describe('failures keep the last known good cache', () => {
  beforeEach(() => setup());
  async function failsAndKeeps(prepare, match) {
    const before = JSON.stringify(await store.getAll());
    await prepare();
    const r = await mk().check();
    expect(r.status).toBe('error');
    expect(r.error).toMatch(match);
    expect(JSON.stringify(await store.getAll())).toBe(before);
    expect((await store.getRemoteState()).lastError).toMatch(match);
  }
  it('GitHub Pages unavailable (offline)', () => failsAndKeeps(async () => { site.fail = 'offline'; }, /fetch/i));
  it('HTTP 503 / 404', async () => {
    await failsAndKeeps(async () => { site.fail = 503; }, /HTTP 503/);
    await setup(); await failsAndKeeps(async () => { delete site.files['config/version.json']; }, /HTTP 404/);
  });
  it('network timeout', () => failsAndKeeps(async () => { site.hang = true; }, /Timed out/));
  it('malformed version.json', () => failsAndKeeps(async () => { site.files['config/version.json'] = '{nope'; }, /not valid JSON/));
  it('malformed feedback.json (hash matches, JSON is broken)', () => failsAndKeeps(async () => { await site.publish('{"broken": '.padEnd(40, 'x'), { version: '1.0.5', schemaVersion: 1, updatedAt: '2026-10-12T10:00:00Z' }); }, /not valid JSON/));
  it('empty configuration is rejected', () => failsAndKeeps(async () => { await site.publish(cfg('1.0.3')); await site.publish({ ...cfg('1.0.3'), items: [] }); }, /empty/));
  it('config with nothing active is rejected', () => failsAndKeeps(async () => { await site.publish({ ...cfg('1.0.3'), items: [{ id: 'fb-001', text: 'x', active: false }] }); }, /no active/));
  it('schema-invalid config (duplicate ids) is rejected', () => failsAndKeeps(async () => { await site.publish({ ...cfg('1.0.3'), items: [{ id: 'fb-001', text: 'a' }, { id: 'fb-001', text: 'b' }] }); }, /duplicate id/));
  it('unsupported schemaVersion is rejected', () => failsAndKeeps(async () => { await site.publish({ ...cfg('1.0.3'), schemaVersion: 2 }); }, /schemaVersion/));
  it('tampered or truncated file fails the sha256 check', () => failsAndKeeps(async () => { await site.publish(cfg('1.0.3')); site.files['config/feedback.json'] = site.files['config/feedback.json'].replace('NetQuantity', 'Hacked'); }, /sha256/));
  it('version.json and feedback.json disagreeing is rejected', () => failsAndKeeps(async () => { await site.publish(cfg('1.0.3'), { version: '1.0.4' }); }, /disagree/));
  it('oversized files are rejected', () => failsAndKeeps(async () => { site.files['config/version.json'] = ' '.repeat(2 * 1024 * 1024 + 1); }, /too large/));
  it('retries soon after an error, then recovers', async () => {
    const rc = mk();
    site.fail = 'offline';
    expect((await rc.check()).status).toBe('error');
    site.fail = null; site.calls.length = 0;
    expect((await rc.check()).status).toBe('throttled'); // inside the 2 minute error window
    clock += 2 * 60e3 + 1;
    expect((await rc.check()).status).toBe('updated');
    expect((await store.getRemoteState()).lastError).toBeNull();
  });
  it('requires https (loopback http allowed only for tests)', () => {
    expect(() => createRemoteConfig({ baseUrl: 'http://evil.example/', store, schema })).toThrow(/https/);
    expect(() => createRemoteConfig({ baseUrl: 'http://127.0.0.1:1/', store, schema })).not.toThrow();
  });
  it('a redirect or cross-origin response is refused by fetch options (redirect: error)', async () => {
    await mk().check();
    expect(site.options.every((o) => o.redirect === 'error')).toBe(true);
  });
});

describe('local admin edits and multiple users', () => {
  it('never overwrites local admin edits (kept as deferred)', async () => {
    await setup();
    await store.upsert({ ...SEED[0], text: 'my local edit' }); await store.markLocalEdits();
    const r = await mk().check();
    expect(r).toMatchObject({ status: 'deferred', reason: 'local-edits' });
    expect(await texts()).toContain('my local edit');
    expect(await texts()).not.toContain('shipped remotely');
    expect(mem.data['afx.remoteConfig'].version).toBe('1.0.1');
  });
  it('different users/browsers all receive the identical latest list', async () => {
    const results = [];
    for (let u = 0; u < 3; u++) {
      await setup();
      await mk().check();
      results.push(JSON.stringify((await store.getAll()).map((i) => [i.id, i.text, i.active])));
    }
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toContain('shipped remotely');
  });
  it('a newer bundled list (extension update) still wins over an older cached remote one', async () => {
    await setup('1.0.0');
    await mk().check(); // cache = 1.0.1
    store._configure({ backend: mem, seedLoader: async () => [...structuredClone(SEED), item(80, 'new in extension')], metaLoader: async () => ({ version: '2.0.0' }) });
    expect((await store.getAll()).some((i) => i.text === 'new in extension')).toBe(true);
    expect(await store.getConfigVersion()).toBe('2.0.0');
  });
});

describe('user-specific state stays local', () => {
  it('usage counts and settings are untouched by a config update', async () => {
    await setup();
    await store.recordUse('fb-001'); await store.saveSettings({ insertMode: 'append' });
    await mk().check();
    expect((await store.getUses())['fb-001']).toBe(1);
    expect((await store.getSettings()).insertMode).toBe('append');
  });
});
