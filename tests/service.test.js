import { describe, it, expect, beforeEach } from 'vitest';
import { req, memoryBackend, SEED, fakeBackend } from './helpers.js';

const authz = req('../authz/authz.js');
const store = req('../storage/feedbackStore.js');
const { createApi } = req('../feedback/api.js');
const { createService } = req('../feedback/service.js');

let mem, be, svc;
function setup(role, email) {
  mem = memoryBackend();
  store._configure({ backend: mem, seedLoader: async () => structuredClone(SEED), metaLoader: async () => ({ version: '1.0.0' }) });
  be = fakeBackend(role);
  svc = createService({ api: createApi(be.transport), store, authz, localIdentity: email === undefined ? undefined : async () => email });
  return svc;
}
const writes = () => be.calls.filter((c) => !c.startsWith('GET'));

describe('normal user', () => {
  beforeEach(() => setup('user'));
  it('can read, search and select (records use)', async () => {
    const list = await svc.list();
    expect(list).toHaveLength(4);
    expect(svc.search(list, 'netquan').map((i) => i.id)).toEqual(['fb-001']);
    await svc.markUsed('fb-001');
    expect((await svc.getUses())['fb-001']).toBe(1);
  });
  it('cannot create, update, toggle, delete or restore, and the backend is never called', async () => {
    for (const fn of [() => svc.create({ text: 'x' }), () => svc.update('fb-001', { text: 'y' }), () => svc.setActive('fb-001', false), () => svc.remove('fb-001'), () => svc.restore('fb-001')]) {
      await expect(fn()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(writes()).toEqual([]);
    expect((await store.getAll()).map((i) => i.text)).toEqual(SEED.map((i) => i.text));
  });
  it('cannot list inactive or deleted items, or export', async () => {
    await expect(svc.list({ includeInactive: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.list({ includeDeleted: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.exportAll()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('never sees inactive items even if they are in the cache', async () => {
    await store.getAll();
    await store.upsert({ ...SEED[0], id: 'fb-009', text: 'hidden', active: false });
    await store.upsert({ ...SEED[0], id: 'fb-010', text: 'gone', deletedAt: 'x' });
    expect((await svc.list()).map((i) => i.id)).not.toContain('fb-009');
    expect((await svc.list()).map((i) => i.id)).not.toContain('fb-010');
  });
  it('a locally stored role flag grants nothing', async () => {
    await mem.set({ 'afx.role': 'admin', role: 'admin', isAdmin: true });
    await expect(svc.create({ text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('role resolution fails closed', () => {
  it('unreachable backend means normal user', async () => {
    setup('admin'); be.online = false;
    expect(await svc.getRole(true)).toBe('user');
    await expect(svc.create({ text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('garbage role from the backend means normal user', async () => {
    setup('Admin!!');
    expect(await svc.getRole(true)).toBe('user');
  });
  it('role is re-checked on every write (demoted admin is blocked)', async () => {
    setup('admin');
    await svc.getRole();
    be.role = 'user'; // demoted on the server; cached role would still say admin
    await expect(svc.create({ text: 'new' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(writes()).toEqual([]);
  });
});

describe('admin CRUD', () => {
  beforeEach(() => setup('admin'));
  it('create: new item gets a new stable id and persists', async () => {
    const it = await svc.create({ text: 'brand new', attributes: [' extract.price ', 'extract.price'] });
    expect(it.id).toBe('fb-005');
    expect(it.attributes).toEqual(['extract.price']);
    expect((await store.getAll()).find((i) => i.id === it.id).text).toBe('brand new');
  });
  it('read: admin sees inactive and deleted items when asked', async () => {
    await svc.setActive('fb-001', false); await svc.remove('fb-002');
    expect((await svc.list()).map((i) => i.id)).toEqual(['fb-003', 'fb-004']);
    expect((await svc.list({ includeInactive: true })).map((i) => i.id)).toContain('fb-001');
    expect((await svc.list({ includeDeleted: true })).map((i) => i.id)).toContain('fb-002');
  });
  it('update: id stays the same when text is edited; wording is preserved exactly', async () => {
    const t = '**False Positive:** edited  \nline 2 ';
    const it = await svc.update('fb-001', { text: t });
    expect(it.id).toBe('fb-001');
    expect((await store.getAll()).find((i) => i.id === 'fb-001').text).toBe(t);
  });
  it('enable / disable', async () => {
    expect((await svc.setActive('fb-003', false)).active).toBe(false);
    expect((await svc.setActive('fb-003', true)).active).toBe(true);
  });
  it('delete is soft: the item is kept and can be restored; there is no hard delete', async () => {
    const d = await svc.remove('fb-004');
    expect(d.deletedAt).toBeTruthy();
    expect((await store.getAll()).some((i) => i.id === 'fb-004')).toBe(true);
    expect((await svc.restore('fb-004')).deletedAt).toBeNull();
    expect(svc.remove.length).toBe(1);
    expect(be.calls.some((c) => c.startsWith('DELETE'))).toBe(false);
  });
  it('validates input and rejects exact duplicates', async () => {
    await expect(svc.create({ text: '   ' })).rejects.toMatchObject({ code: 'EMPTY' });
    await expect(svc.create({ text: 'Repeated DOM content' })).rejects.toMatchObject({ code: 'DUPLICATE' });
    await expect(svc.update('fb-001', { text: 'Repeated DOM content' })).rejects.toMatchObject({ code: 'DUPLICATE' });
    await svc.update('fb-002', { text: 'Repeated DOM content' }); // editing to its own text is fine
  });
  it('a failed write leaves the cache untouched (no accidental data loss)', async () => {
    await store.getAll();
    be.online = true;
    const real = be.transport;
    const api = createApi(async (r) => { if (r.path === '/feedback/me') return real(r); throw new Error('down'); });
    const s2 = createService({ api, store, authz });
    const before = JSON.stringify(await store.getAll());
    await expect(s2.update('fb-001', { text: 'zzz' })).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(JSON.stringify(await store.getAll())).toBe(before);
  });
  it('export includes everything, including inactive and deleted', async () => {
    await svc.setActive('fb-001', false); await svc.remove('fb-002');
    expect(JSON.parse(await svc.exportAll())).toHaveLength(4);
  });
});

describe('sync, search, categories', () => {
  it('sync replaces the cache from the backend; offline sync keeps the cache', async () => {
    setup('user');
    await store.getAll();
    be.items.push({ ...SEED[0], id: 'fb-050', text: 'server side' });
    expect((await svc.sync()).ok).toBe(true);
    expect((await svc.list()).some((i) => i.id === 'fb-050')).toBe(true);
    be.online = false;
    expect(await svc.sync()).toMatchObject({ ok: false, offline: true });
    expect((await svc.list()).some((i) => i.id === 'fb-050')).toBe(true);
  });
  it('search is case-insensitive, partial, multi-term; ranks by your usage then popularity', async () => {
    setup('user');
    const list = await svc.list();
    expect(svc.search(list, 'DOM cont').map((i) => i.id)).toEqual(['fb-002']);
    expect(svc.search(list, 'content repeated').map((i) => i.id)).toEqual(['fb-002']);
    expect(svc.search(list, '').map((i) => i.id)).toEqual(['fb-002', 'fb-001', 'fb-003', 'fb-004']);
    expect(svc.search(list, '', { uses: { 'fb-004': 3 } })[0].id).toBe('fb-004');
  });
  it('category filter keeps uncategorised items; categories() counts', async () => {
    setup('user');
    const list = await svc.list();
    expect(svc.search(list, '', { category: 'EXTRACT.IMAGEURL' }).map((i) => i.id)).toEqual(['fb-002', 'fb-003']);
    expect(svc.categories(list).map((c) => c.name).sort()).toEqual(['extract.bulletPoints', 'extract.imageUrl', 'extract.netQuantity']);
  });
  it('search stays fast on a very large list', async () => {
    setup('user');
    const big = Array.from({ length: 20000 }, (_, i) => ({ id: 'x' + i, text: 'feedback number ' + i, attributes: [], popularity: 0 }));
    const t = performance.now();
    expect(svc.search(big, 'number 19999')).toHaveLength(1);
    expect(performance.now() - t).toBeLessThan(250);
  });
});

describe('storage: seeding, migration, no data loss', () => {
  it('seeds once from the bundle and never overwrites later', async () => {
    setup('user');
    let loads = 0;
    store._configure({ backend: mem, seedLoader: async () => { loads++; return structuredClone(SEED); } });
    await store.getAll(); await store.getAll();
    expect(loads).toBe(1);
  });
  it('migrates the v1 list: stable ids mapped, user additions kept, backup written', async () => {
    mem = memoryBackend();
    const old = [{ id: 'feedback-001', text: 'old one', uses: 4 }, { id: 'feedback-002', text: 'mine', source: 'user' }];
    await mem.set({ 'afx.options': old });
    store._configure({ backend: mem, seedLoader: async () => structuredClone(SEED) });
    const list = await store.getAll();
    expect(list.map((i) => i.id)).toEqual(['fb-001', 'fb-002']);
    expect(list.every((i) => typeof i.active === 'boolean' && i.createdAt && i.updatedAt)).toBe(true);
    expect(mem.data['afx.legacyBackup']).toEqual(old);
    expect(mem.data['afx.options']).toEqual(old); // original untouched
  });
  it('bundled config/feedback.json matches the schema', async () => {
    const fs = await import('node:fs');
    const list = JSON.parse(fs.readFileSync(new URL('../config/feedback.json', import.meta.url), 'utf8')).items;
    expect(list.length).toBeGreaterThanOrEqual(103);
    expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
    const live = list.filter((i) => i.active && !i.deletedAt);
    expect(new Set(live.map((i) => i.text)).size).toBe(live.length); // soft-deleted entries may share their canonical text
    expect(list.every((i) => /^fb-\d{3}$/.test(i.id) && typeof i.active === 'boolean' && i.createdAt && i.updatedAt && 'deletedAt' in i)).toBe(true);
  });
  it('settings default and persist', async () => {
    setup('user');
    expect(await store.getSettings()).toEqual({ insertMode: 'replace', confirmReplace: true });
    await store.saveSettings({ insertMode: 'append' });
    expect((await store.getSettings()).insertMode).toBe('append');
  });
});

describe('local mode: no backend, admin decided by the Chrome account email', () => {
  const ADMIN = 'supriya.m@commerceiq.ai';
  it('admin email => admin; other or missing email => user (fail closed)', async () => {
    setup('user', ADMIN); be.online = false;
    expect(await svc.getIdentity(true)).toMatchObject({ role: 'admin', mode: 'local', email: ADMIN });
    setup('user', 'diwagar.j@commerceiq.ai'); be.online = false;
    expect(await svc.getRole(true)).toBe('admin');
    setup('user', 'someone@commerceiq.ai'); be.online = false;
    expect(await svc.getRole(true)).toBe('user');
    setup('user', ''); be.online = false;
    expect(await svc.getRole(true)).toBe('user');
  });
  it('a failing identity lookup fails closed', async () => {
    setup('user'); be.online = false;
    svc = createService({ api: createApi(be.transport), store, authz, localIdentity: async () => { throw new Error('no profile'); } });
    expect(await svc.getRole(true)).toBe('user');
  });
  it('a reachable backend wins over the email allowlist', async () => {
    setup('user', ADMIN); // backend online and says "user"
    expect(await svc.getIdentity(true)).toMatchObject({ role: 'user', mode: 'backend' });
    await expect(svc.create({ text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('local admin full lifecycle works offline, stays in this browser, and never calls the backend', async () => {
    setup('user', ADMIN); be.online = false;
    const c = await svc.create({ text: 'local new', attributes: ['extract.price'] });
    expect(c).toMatchObject({ id: 'fb-005', source: 'admin-local', active: true });
    expect((await svc.update('fb-001', { text: 'edited locally' })).id).toBe('fb-001');
    expect((await svc.setActive('fb-002', false)).active).toBe(false);
    expect((await svc.remove('fb-003')).deletedAt).toBeTruthy();
    expect((await svc.restore('fb-003')).deletedAt).toBeNull();
    expect((await svc.list({ includeInactive: true })).length).toBe(5);
    expect(await svc.hasLocalEdits()).toBe(true);
    expect(be.calls.filter((x) => !x.startsWith('GET'))).toEqual([]);
    await expect(svc.create({ text: 'edited locally' })).rejects.toMatchObject({ code: 'DUPLICATE' });
  });
  it('a normal user in local mode still cannot write', async () => {
    setup('user', 'someone@commerceiq.ai'); be.online = false;
    for (const fn of [() => svc.create({ text: 'x' }), () => svc.update('fb-001', { text: 'y' }), () => svc.remove('fb-001')]) {
      await expect(fn()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect((await store.getAll()).map((i) => i.text)).toEqual(SEED.map((i) => i.text));
  });
  it('a locally stored email or role grants nothing (identity comes from the Chrome profile)', async () => {
    setup('user', 'someone@commerceiq.ai'); be.online = false;
    await mem.set({ 'afx.devUser': ADMIN, email: ADMIN, 'afx.role': 'admin' });
    await expect(svc.create({ text: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('when a backend later answers, local edits are backed up before the cache is replaced', async () => {
    setup('user', ADMIN); be.online = false;
    await svc.create({ text: 'my local edit' });
    be.online = true;
    expect((await svc.sync()).ok).toBe(true);
    expect(mem.data[store.KEY_LOCAL_BACKUP].some((i) => i.text === 'my local edit')).toBe(true);
  });
});

describe('bundle versioning', () => {
  it('a backend-synced list is not replaced by the bundled one afterwards', async () => {
    setup('user');
    be.items.push({ ...SEED[0], id: 'fb-077', text: 'server only' });
    await svc.sync();
    expect((await svc.list()).some((i) => i.id === 'fb-077')).toBe(true);
  });
  const cfg = (version, seed) => store._configure({ backend: mem, seedLoader: async () => structuredClone(seed), metaLoader: async () => ({ version }) });
  it('a newer bundled list refreshes a pristine cache', async () => {
    mem = memoryBackend(); cfg(1, SEED); await store.getAll();
    cfg(2, [...SEED, { ...SEED[0], id: 'fb-050', text: 'shipped in v2' }]);
    expect((await store.getAll()).some((i) => i.id === 'fb-050')).toBe(true);
  });
  it('the same bundle version leaves the cache alone', async () => {
    mem = memoryBackend(); cfg(1, SEED); await store.getAll();
    await store.upsert({ ...SEED[0], text: 'changed' });
    cfg(1, SEED);
    expect((await store.getAll()).find((i) => i.id === 'fb-001').text).toBe('changed');
  });
  it('a newer bundle never overwrites local admin edits', async () => {
    mem = memoryBackend(); cfg(1, SEED); await store.getAll();
    await store.upsert({ ...SEED[0], text: 'my edit' }); await store.markLocalEdits();
    cfg(2, SEED);
    expect((await store.getAll()).find((i) => i.id === 'fb-001').text).toBe('my edit');
  });
});
