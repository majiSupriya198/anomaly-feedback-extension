import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { req } from './helpers.js';
const { createServer } = req('../server/dev-server.cjs');

let srv, base;
beforeAll(async () => {
  srv = createServer({ admins: ['admin@x.com'] });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + srv.address().port;
});
afterAll(() => new Promise((r) => srv.close(r)));

const call = (user, method, path, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Dev-User': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
const U = 'user@x.com', AD = 'admin@x.com';

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
    expect(list).toHaveLength(103);
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
    expect(created.id).toBe('fb-104');
    expect((await call(AD, 'POST', '/feedback', { text: 'server new' })).status).toBe(409);
    expect((await call(AD, 'POST', '/feedback', { text: '  ' })).status).toBe(400);
    const upd = await (await call(AD, 'PATCH', '/feedback/fb-104', { text: 'server edited' })).json();
    expect(upd).toMatchObject({ id: 'fb-104', text: 'server edited' });
    await call(AD, 'PATCH', '/feedback/fb-104', { active: false });
    expect((await (await call(U, 'GET', '/feedback')).json()).some((i) => i.id === 'fb-104')).toBe(false); // hidden from users
    expect((await (await call(AD, 'GET', '/feedback')).json()).find((i) => i.id === 'fb-104').active).toBe(false);
    await call(AD, 'PATCH', '/feedback/fb-104', { active: true });
    const del = await (await call(AD, 'PATCH', '/feedback/fb-104', { deleted: true })).json();
    expect(del.deletedAt).toBeTruthy();
    expect((await (await call(U, 'GET', '/feedback')).json()).some((i) => i.id === 'fb-104')).toBe(false);
    expect((await (await call(AD, 'GET', '/feedback')).json()).some((i) => i.id === 'fb-104')).toBe(true); // kept
    expect((await (await call(AD, 'PATCH', '/feedback/fb-104', { deleted: false })).json()).deletedAt).toBeNull();
  });
  it('there is no hard-delete endpoint', async () => {
    expect((await call(AD, 'DELETE', '/feedback/fb-001')).status).toBe(404);
  });
});
