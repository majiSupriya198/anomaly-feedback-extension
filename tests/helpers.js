import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const req = createRequire(import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

export function memoryBackend() {
  const data = {};
  return {
    data,
    get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in data) o[k] = structuredClone(data[k]); return o; },
    set: async (obj) => { for (const k in obj) data[k] = structuredClone(obj[k]); },
  };
}

const T = '2026-01-01T00:00:00.000Z';
const mk = (id, text, attributes, popularity, extra) => Object.assign({ id, text, active: true, attributes, popularity, source: 'csv', createdAt: T, updatedAt: T, deletedAt: null }, extra || {});
export const SEED = [
  mk('fb-001', 'NetQuantity length mismatch', ['extract.netQuantity'], 2),
  mk('fb-002', 'Repeated DOM content', [], 5),
  mk('fb-003', 'ImageURL count issue', ['extract.imageUrl'], 1),
  mk('fb-004', 'Description should be bullet points', ['extract.bulletPoints'], 0),
];

/** In-memory fake of the backend, with the identity it reports. Writes mimic server behaviour. */
export function fakeBackend(role = 'user', seed = SEED) {
  const db = { items: structuredClone(seed), role, online: true, calls: [] };
  const err = (status, error) => ({ ok: false, status, data: { error } });
  db.transport = async ({ method, path, body }) => {
    db.calls.push(method + ' ' + path);
    if (!db.online) throw new Error('network');
    if (path === '/feedback/me') return { ok: true, status: 200, data: { role: db.role, email: 't@x' } };
    if (path === '/feedback' && method === 'GET') return { ok: true, status: 200, data: db.role === 'admin' ? db.items : db.items.filter((i) => i.active && !i.deletedAt) };
    if (db.role !== 'admin') return err(403, 'forbidden');
    if (method === 'POST') { const it = mk('fb-' + String(db.items.length + 1).padStart(3, '0'), body.text, body.attributes || [], 0, { source: 'admin' }); db.items.push(it); return { ok: true, status: 201, data: it }; }
    const it = db.items.find((i) => i.id === decodeURIComponent(path.split('/').pop()));
    if (!it) return err(404, 'nf');
    if ('text' in body) it.text = body.text;
    if ('attributes' in body) it.attributes = body.attributes;
    if ('active' in body) it.active = body.active;
    if (body.deleted === true) it.deletedAt = T; if (body.deleted === false) it.deletedAt = null;
    it.updatedAt = new Date().toISOString();
    return { ok: true, status: 200, data: it };
  };
  return db;
}
