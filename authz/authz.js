/* AUTHORIZATION: the single place that decides who may do what.
 * UI code and the service layer call can()/assertCan(); nothing else encodes role rules.
 * NOTE: in a client-only extension this is a convenience and a safety net, not a security
 * boundary. The real boundary is the backend, which enforces the same policy (docs/backend-api.md). */
(function (root) {
  'use strict';

  const ACTIONS = Object.freeze({
    READ: 'read', SEARCH: 'search', SELECT: 'select',
    VIEW_INACTIVE: 'viewInactive',
    CREATE: 'create', UPDATE: 'update', TOGGLE: 'toggle', DELETE: 'delete', RESTORE: 'restore',
  });
  const ROLES = Object.freeze({ USER: 'user', ADMIN: 'admin' });
  const A = ACTIONS;

  const POLICY = Object.freeze({
    [ROLES.USER]: Object.freeze([A.READ, A.SEARCH, A.SELECT]),
    [ROLES.ADMIN]: Object.freeze(Object.values(A)),
  });

  /** Accounts that get admin in local mode (no backend), matched against the Chrome profile email.
   *  Client-side by nature: it gates the UI and the local copy of the list only. See README. */
  const ADMIN_EMAILS = Object.freeze(['supriya.m@commerceiq.ai', 'diwagar.j@commerceiq.ai']);
  function roleForEmail(email) {
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    return e && ADMIN_EMAILS.indexOf(e) !== -1 ? ROLES.ADMIN : ROLES.USER;
  }

  /** Anything that is not exactly 'admin' is a normal user (fail closed). */
  function normaliseRole(role) { return role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USER; }
  function can(role, action) { return POLICY[normaliseRole(role)].indexOf(action) !== -1; }
  function assertCan(role, action) {
    if (!can(role, action)) {
      const e = new Error('Not allowed: "' + action + '" requires admin access.');
      e.code = 'FORBIDDEN';
      throw e;
    }
  }

  const api = { ACTIONS, ROLES, POLICY, ADMIN_EMAILS, can, assertCan, normaliseRole, roleForEmail };
  root.AFX = root.AFX || {};
  root.AFX.authz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
