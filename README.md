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

**Who is an admin:** the extension reads the account Chrome is signed into and grants admin only if its email is **supriya.m@commerceiq.ai** or **diwagar.j@commerceiq.ai** (matched case-insensitively, exact match). The list lives in one place, `ADMIN_EMAILS` in [`authz/authz.js`](authz/authz.js). If no Chrome account is signed in, or the email isn't on the list, you're a normal user.

> Chrome will show "Read your email address" when you install. That permission (`identity.email`) is what lets the extension see which account is signed in.

### Two modes
| | Backend mode (when a feedback server exists) | Local mode (today) |
|---|---|---|
| Who is admin | The server decides (`GET /feedback/me`) | The Chrome account email allowlist above |
| Where admin edits go | The server, shared by everyone | **This browser only** |
| Enforcement | Server (real) | Extension (UI and local copy only) |

A reachable backend always wins over the email check. If it says you're a normal user, you are.

### ⚠️ Security model: read this
- **Local mode is not a security boundary.** The check runs inside the extension, so someone who edits their own copy of the extension could make themselves a local "admin". The email itself comes from Chrome's signed-in Google account and can't be typed in. What a local admin can change is **only their own browser's list**. Nobody else is affected, because the shared list ships through this Git repo (below), where changes need GitHub write access.
- **Normal users can't modify the list** through the extension: no controls are shown, and the service layer refuses writes. Unknown or unreadable identity means *normal user*.
- For shared, server-enforced edits, add the endpoints in [`docs/backend-api.md`](docs/backend-api.md). The extension switches to backend mode automatically.
- No API keys, tokens or credentials are in this repo or the extension.

### Sharing admin edits with the team (local mode)
1. Admin page → make your changes → **Export JSON**.
2. In the repo: `npm run publish:list -- path/to/feedback-export.json` (validates, rewrites `data/feedback.json`, bumps `data/feedback.meta.json`).
3. Review the diff, commit and push. Teammates `git pull`, then reload the extension. A newer bundle version refreshes their list automatically, unless they have local admin edits, which are never overwritten.

## How feedback is stored
- **Source of truth:** the backend when one exists. Otherwise the list bundled in this repo (`data/feedback.json`, versioned by `data/feedback.meta.json`).
- **Local cache:** `chrome.storage.local` key `afx.feedback`, used for fast, offline search. Refreshed from the backend on load, or from a newer bundle after an update. Local admin edits set `afx.localEdits` and are backed up (`afx.localBackup`) before any overwrite.
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
Admins (the two accounts above) see **Manage feedback…** in the panel, which opens the admin page (also under the extension's Options). It lets you search and filter, add, edit, enable or disable, delete (soft) and restore, show inactive and deleted items, refresh from the server, and export JSON. A normal user who opens that page sees only an "admin access required" message.

### Add or update feedback
- **Normal flow:** admin page → *Add feedback* or *Edit*. With a backend, everyone gets the change on their next load. In local mode, follow *Sharing admin edits* above.
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
npm run build:data -- path/to/data.csv   # CSV -> data/feedback.json
npm run publish:list -- export.json      # admin export -> shipped list (bumps version)
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
- Server-enforced admin access needs the backend (see above). Local mode only gates the UI and your own copy.
- Admin detection needs Chrome signed in to a Google account (any sign-in state that exposes the email).
- The extension only runs on `anomaly-hub.ef.uk.com`. If the host changes, update `manifest.json`.
- The live Feedback field is detected by label. If the Hub's markup changes, adjust `content/domAdapter.js`.
