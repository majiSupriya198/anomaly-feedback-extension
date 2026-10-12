import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { req } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
const { createServer, INITIAL_ADMINS } = req('../server/dev-server.cjs');
const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/feedback.json'), 'utf8')).items;
const nextId = 'fb-' + (Math.max(...shipped.map((i) => +i.id.slice(3))) + 1);

let srv, base;
beforeAll(async () => {
  srv = createServer({ admins: ['admin@x.com'] });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
afterAll(() => new Promise((r) => srv.close(r)));

const call = (user, method, path, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Dev-User': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
const U = 'user@x.com', AD = 'admin@x.com';

describe('initial admins', () => {
  it('are exactly the two named accounts (case-insensitive); everyone else is a user', async () => {
    expect(INITIAL_ADMINS).toEqual(['supriya.m@commerceiq.ai', 'diwagar.j@commerceiq.ai']);
    const s = createServer({ admins: INITIAL_ADMINS });
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const b = 'http://127.0.0.1:' + s.address().port;
    const role = async (u) => (await (await fetch(b + '/feedback/me', { headers: { 'X-Dev-User': u } })).json()).role;
    expect(await role('supriya.m@commerceiq.ai')).toBe('admin');
    expect(await role('Diwagar.J@CommerceIQ.ai')).toBe('admin');
    expect(await role('someone.else@commerceiq.ai')).toBe('user');
    expect(await role('supriya.m@commerceiq.ai.evil.com')).toBe('user');
    await new Promise((r) => s.close(r));
  });
});

describe('server-side enforcement (the real security boundary)', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await call(null, 'GET', '/feedback')).status).toBe(401);
  });
  it('/me reports the role; unknown users are normal users', async () => {
    expect(await (await call(U, 'GET', '/feedback/me')).json()).toMatchObject({ role: 'user' });
    expect(await (await call(AD, 'GET', '/feedback/me')).json()).toMatchObject({ role: 'admin' });
  });
  it('normal users get only active items and cannot write', async () => {
    const list = await (await call(U, 'GET', '/feedback')).json();
    expect(list).toHaveLength(shipped.filter((i) => i.active !== false && !i.deletedAt).length);
    expect((await call(U, 'POST', '/feedback', { text: 'x' })).status).toBe(403);
    expect((await call(U, 'PATCH', '/feedback/fb-001', { text: 'x' })).status).toBe(403);
    expect((await call(U, 'PATCH', '/feedback/fb-001', { active: false })).status).toBe(403);
    expect((await call(U, 'PATCH', '/feedback/fb-001', { deleted: true })).status).toBe(403);
    expect((await call(U, 'PATCH', '/feedback/fb-001', { deleted: false })).status).toBe(403);
  });
  it('a role header or body field cannot elevate a user', async () => {
    const r = await fetch(base + '/feedback', { method: 'POST', headers: { 'X-Dev-User': U, 'X-Role': 'admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x', role: 'admin' }) });
    expect(r.status).toBe(403);
  });
  it('admin full lifecycle: create, update (id stable), disable, soft-delete, restore', async () => {
    const created = await (await call(AD, 'POST', '/feedback', { text: 'server new', attributes: ['extract.price'] })).json();
    expect(created.id).toBe(nextId);
    expect((await call(AD, 'POST', '/feedback', { text: 'server new' })).status).toBe(409);
    expect((await call(AD, 'POST', '/feedback', { text: '  ' })).status).toBe(400);
    const upd = await (await call(AD, 'PATCH', '/feedback/' + nextId, { text: 'server edited' })).json();
    expect(upd).toMatchObject({ id: nextId, text: 'server edited' });
    await call(AD, 'PATCH', '/feedback/' + nextId, { active: false });
    expect((await (await call(U, 'GET', '/feedback')).json()).some((i) => i.id === nextId)).toBe(false); // hidden from users
    expect((await (await call(AD, 'GET', '/feedback')).json()).find((i) => i.id === nextId).active).toBe(false);
    await call(AD, 'PATCH', '/feedback/' + nextId, { active: true });
    const del = await (await call(AD, 'PATCH', '/feedback/' + nextId, { deleted: true })).json();
    expect(del.deletedAt).toBeTruthy();
    expect((await (await call(U, 'GET', '/feedback')).json()).some((i) => i.id === nextId)).toBe(false);
    expect((await (await call(AD, 'GET', '/feedback')).json()).some((i) => i.id === nextId)).toBe(true); // kept
    expect((await (await call(AD, 'PATCH', '/feedback/' + nextId, { deleted: false })).json()).deletedAt).toBeNull();
  });
  it('there is no hard-delete endpoint', async () => {
    expect((await call(AD, 'DELETE', '/feedback/fb-001')).status).toBe(404);
  });
});
