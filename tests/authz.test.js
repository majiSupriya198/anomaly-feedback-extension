import { describe, it, expect } from 'vitest';
import { req } from './helpers.js';
const authz = req('../authz/authz.js');
const { ACTIONS: A } = authz;

describe('authorization policy', () => {
  it('normal users can only read, search and select', () => {
    for (const a of [A.READ, A.SEARCH, A.SELECT]) expect(authz.can('user', a)).toBe(true);
    for (const a of [A.VIEW_INACTIVE, A.CREATE, A.UPDATE, A.TOGGLE, A.DELETE, A.RESTORE]) expect(authz.can('user', a)).toBe(false);
  });
  it('admins can do everything', () => {
    for (const a of Object.values(A)) expect(authz.can('admin', a)).toBe(true);
  });
  it('fails closed for unknown, missing or spoofed roles', () => {
    for (const r of [undefined, null, '', 'ADMIN', 'root', 'admin ', { role: 'admin' }, 1]) {
      expect(authz.can(r, A.CREATE)).toBe(false);
      expect(authz.can(r, A.READ)).toBe(true);
    }
  });
  it('assertCan throws FORBIDDEN', () => {
    expect(() => authz.assertCan('user', A.DELETE)).toThrowError(/admin/);
    try { authz.assertCan('user', A.CREATE); } catch (e) { expect(e.code).toBe('FORBIDDEN'); }
    expect(() => authz.assertCan('admin', A.DELETE)).not.toThrow();
  });
  it('the policy table is frozen', () => {
    expect(Object.isFrozen(authz.POLICY.user)).toBe(true);
    expect(() => { 'use strict'; authz.POLICY.user.push('create'); }).toThrow();
  });
});
