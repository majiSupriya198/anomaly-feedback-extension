# Anomaly Hub Feedback Helper

A Chrome extension (Manifest V3) that speeds up false-positive validation in Anomaly Hub. Reviewers pick from an approved, searchable list of feedback instead of retyping it. Admins maintain that list. **The extension never submits, saves, closes or resolves anything.** You always click the Hub's own Submit.

## How it works
1. On `https://anomaly-hub.ef.uk.com/*` the extension adds a **💡 Suggested Feedback** button inside the review dialog. Its dot turns green when the Feedback field is found.
2. Search or filter by category, then click an entry. The text is written into the Hub's Feedback field (React-safe: native setter plus `input` and `change` events).
3. Review the text, then submit through the Hub as usual.

If the field isn't on screen, the text is copied to the clipboard instead. The field is found dynamically by its label, so there are no hard-coded IDs, and a `MutationObserver` handles the Hub's dynamically rendered UI and navigation between anomalies.

## Roles
| | Normal user | Admin |
|---|---|---|
| View, search, filter, select, insert feedback | ✅ | ✅ |
| See inactive and deleted feedback | ❌ | ✅ |
| Create, edit, enable/disable, delete, restore | ❌ | ✅ |
| See admin controls | ❌ | ✅ |

All rules live in one file, [`authz/authz.js`](authz/authz.js). The UI, service layer and dev server all call it.

**Initial admins:** supriya.m@commerceiq.ai and diwagar.j@commerceiq.ai. This is configured on the backend (see `docs/backend-api.md`), not in the extension. The extension has no admin list on purpose.

### ⚠️ Security model: read this
A client-only extension **cannot** protect an admin role. Anything stored in it (an admin list, a role flag, `chrome.storage.local`) can be read and edited by whoever runs it. So:
- **The backend decides who is an admin.** The extension asks `GET /feedback/me` and reads the role from the response. A role is never read from local storage, and anything unclear (offline, bad response) means *normal user*.
- The extension's checks (hiding controls, refusing writes) are a safety net. **The server must enforce the same policy on every write.** See [`docs/backend-api.md`](docs/backend-api.md) for the contract and the simplest way to add it to the Anomaly Hub.
- Until the backend endpoints exist, the extension works **read-only for everyone** from the bundled list, and nobody can edit it.
- No API keys, tokens or credentials are in this repo or the extension. It reuses the user's existing Hub login session.

## How feedback is stored
- **Source of truth:** the backend (once available).
- **Local cache:** `chrome.storage.local` key `afx.feedback`, a read-only copy used for fast, offline search. It is refreshed from the backend on load and replaced as a whole.
- **First run:** the cache is seeded from [`data/feedback.json`](data/feedback.json), built from the team's CSV (337 rows → 103 unique texts, verbatim).
- **Personal data only:** your usage counts (for ranking) and insert preferences. These never change the shared list.

```json
{ "id": "fb-001", "text": "…", "active": true, "attributes": ["extract.promotionText"],
  "popularity": 27, "source": "csv", "createdAt": "…", "updatedAt": "…", "deletedAt": null }
```
- `id` is stable. Editing the text never changes it.
- `active: false` hides an item from normal users (disable). `deletedAt` set means soft-deleted. Both are reversible. **There is no hard delete.**
- Upgrading from v1 migrates your local list (`feedback-001` → `fb-001`) and keeps a backup in `afx.legacyBackup`.

## Admin functionality
Admins see **Manage feedback…** in the panel, which opens the admin page (also under the extension's Options). It lets you search and filter, add, edit, enable or disable, delete (soft) and restore, show inactive and deleted items, refresh from the server, and export JSON. A normal user who opens that page sees only an "admin access required" message.

### Add or update feedback
- **Normal flow:** admin page → *Add feedback* or *Edit*. Changes go to the backend, and everyone gets them on their next load.
- **Bulk update from a new CSV:** `node scripts/csv-to-json.mjs path/to.csv` rewrites `data/feedback.json` (exact duplicates only, wording unchanged). Then import it server-side as the initial data. The bundle is only the offline fallback.
- Review the current list in [`docs/feedback-review.md`](docs/feedback-review.md).

## Install and load locally in Chrome
```bash
git clone <repo-url> && cd anomaly-feedback-extension
```
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder (no build step).
3. Open an anomaly in Anomaly Hub, click **False Positive**, then **Suggested Feedback**.
4. After pulling changes, click the reload icon on the extension card and refresh the Hub tab.

## Development
```bash
npm install
npm test                      # 60+ tests: authz, service, storage, server, DOM, integration
npm run build:data -- path/to/data.csv
npm run dev:server            # reference backend on :8787 (admins: the two initial admins; override with DEV_ADMINS)
```
To try admin features locally: start the dev server, then in the extension's service worker console (`chrome://extensions` → *service worker*) run:
```js
chrome.storage.local.set({ 'afx.devApi': true, 'afx.devUser': 'supriya.m@commerceiq.ai' })
```
and grant the optional `http://localhost:8787/*` permission. This mode is for development only. `X-Dev-User` is not real authentication.

### Layout
```
authz/authz.js            role → permission policy (single source)
storage/feedbackStore.js  chrome.storage.local cache (no authorization here)
feedback/api.js           backend client       feedback/service.js  authz + backend + cache
content/                  Hub integration (domAdapter.js, anomalyHub.js)
ui/panel.js               read-only suggestion panel (Shadow DOM)
admin/                    admin page           options/ popup/  user settings, quick search
background/serviceWorker.js  the only code that calls the backend
server/dev-server.cjs     reference API for local dev and tests      docs/  API contract, feedback review
```

## Limits
- Admin enforcement needs the backend (see above).
- The extension only runs on `anomaly-hub.ef.uk.com`. If the host changes, update `manifest.json`.
- The live Feedback field is detected by label. If the Hub's markup changes, adjust `content/domAdapter.js`.
