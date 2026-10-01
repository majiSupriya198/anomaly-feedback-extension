# Feedback backend API (optional: enables shared, server-enforced editing)

Without it the extension runs in **local mode**: admins are recognised by their Chrome account email and edit only their own browser (see README). Add this API when you want one shared list with real enforcement. The extension then uses it automatically, and it takes priority over the email check.

A Chrome extension cannot keep an admin role secret. Anything stored in the extension (an admin list,
a role flag, `chrome.storage.local`) can be read and edited by the person using it. So **the backend is the
only place that decides who may change feedback.** The extension asks the backend who the user is and
disables controls accordingly, but a normal user who bypasses the UI is still rejected by the server.

## Architecture
```
Extension (user's Chrome)                      Anomaly Hub backend
  content script / admin page                    /api/feedback*
        │  chrome.runtime message                     │
        ▼                                             │ identity = existing Hub login session
  service worker ── fetch, credentials: include ────► │ role = admin | user (from Hub users)
        ▲                                             │ enforces policy, stores items
        └── JSON ◄────────────────────────────────────┘
  local cache (chrome.storage.local) = read-only copy for fast, offline search
```
- No API keys or tokens exist in the extension. It reuses the user's logged-in Hub session cookie.
- The extension only calls paths matching `/feedback…` on `https://anomaly-hub.ef.uk.com/api` (checked in the service worker).
- Reads work offline from the cache. Writes require the backend. If it is unreachable the role resolves to **user** (fail closed).

## Endpoints
Identity comes from the session. The server must ignore any role sent by the client.

| Method and path | Who | Behaviour |
|---|---|---|
| `GET /feedback/me` | any signed-in user | `{ "role": "admin" \| "user", "email": "..." }` |
| `GET /feedback` | any signed-in user | Users: only `active && !deletedAt`. Admins: everything. |
| `POST /feedback` `{text, attributes?}` | admin | 201 with the item. 400 if text is empty. 409 on an exact duplicate. |
| `PATCH /feedback/:id` | see below | Returns the updated item. 404 if unknown. |

`PATCH` body fields and the permission each needs (all admin-only):
- `text`, `attributes` → update
- `active` (bool) → enable or disable
- `deleted: true` → soft delete (sets `deletedAt`)
- `deleted: false` → restore

There is **no hard delete**. Authorize each field before changing anything. Return 401 when not signed in, 403 when not allowed.

## Item
```json
{ "id": "fb-001", "text": "…", "active": true, "attributes": ["extract.promotionText"],
  "popularity": 27, "source": "csv", "createdAt": "…", "updatedAt": "…", "deletedAt": null }
```
`id` is assigned by the server and never changes, even when `text` is edited.

## Roles in the Anomaly Hub
Initial admins (exactly two, same as `ADMIN_EMAILS` in `authz/authz.js`): **supriya.m@commerceiq.ai** and **diwagar.j@commerceiq.ai**. Everyone else is a normal user. Seed these two when you add the role, and match emails case-insensitively.

The Hub already has a `users` table. The simplest change is an `is_feedback_admin` boolean (or a `role` column) on it, read when answering `/feedback/me` and when authorizing writes. Reuse the Hub's existing session auth and CORS settings. Allow credentialed requests from the extension's origin, or serve the API on the Hub origin as above.

## Local development
`server/dev-server.cjs` is a reference implementation of this contract with the same policy
(`authz/authz.js`). It identifies users by an `X-Dev-User` header, which is **dev-only and insecure**.
```bash
DEV_ADMINS=you@example.com node server/dev-server.cjs
```
To point the extension at it, grant the optional `http://localhost:8787/*` permission and set the
`afx.devApi` flag from the service worker console (see README → Development). The server tests in
`tests/server.test.js` double as an executable version of this contract.
