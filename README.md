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

### Sharing admin edits with the team
1. Admin page → make your changes → **Export JSON**.
2. In the repo: `npm run publish:list -- path/to/feedback-export.json`. It validates the list, rewrites `config/feedback.json` and bumps the version.
3. Commit and push to `main`. GitHub Actions publishes it, and installed extensions pick it up automatically (see below). **No `git pull`, rebuild or re-import is needed on anyone's machine.**

## How feedback is stored
- **Source of truth:** the backend when one exists. Otherwise the shared config in this repo, [`config/feedback.json`](config/feedback.json), published to GitHub Pages.
- **Local cache:** `chrome.storage.local` key `afx.feedback`, used for fast, offline search. Refreshed from the published config (or the backend). Local admin edits set `afx.localEdits` and are never overwritten automatically.
- **First run / offline:** the cache is seeded from the copy of `config/feedback.json` shipped inside the extension (built from the team's CSV: 337 rows → 103 unique texts, verbatim).
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
- **Bulk update from a new CSV:** `node scripts/csv-to-json.mjs path/to.csv` rewrites `config/feedback.json` (exact duplicates only, wording unchanged, version reset to 1.0.0).
- Review the current list in [`docs/feedback-review.md`](docs/feedback-review.md).

## How updates reach users (GitHub Pages)
```
push to main ─► GitHub Actions (tests + validate + version-bump check) ─► GitHub Pages
                   https://majisupriya198.github.io/anomaly-feedback-extension/config/{version,feedback}.json
Extension service worker ─► version.json (tiny) ─► newer? ─► feedback.json ─► validate ─► cache ─► panel
```
- **When it checks:** when an Anomaly Hub page loads, at most once every 15 minutes (after an error, retry after 2 minutes), plus on browser start. A check is one tiny request. The full file is downloaded only when the version is newer.
- **Versioning:** `config/feedback.json` carries `version` (e.g. `1.0.12`), `updatedAt` and `items`. `version.json` repeats the version and adds a SHA-256 of the file. Versions compare numerically. Older versions are ignored.
- **Last known good:** if Pages is down, times out, or serves anything invalid (bad JSON, wrong hash, empty list, no active items, duplicate IDs, unsupported schema), the extension keeps its current list. Nothing is half-applied.
- **Timing:** deploy takes about 1–2 minutes and GitHub's CDN caches for up to about 10 minutes. Expect the change in users' extensions within about 15 minutes, not instantly.
- **Local admin edits** are never overwritten by a remote update.
- **Only data is downloaded.** The extension never fetches or runs remote code, which Chrome doesn't allow in Manifest V3 anyway.

### Applying a generalized feedback sheet
`npm run import:generalized -- sheet.tsv [--prune] [--write]` applies a sheet export (columns *Original ID, Attribute, Popularity, Generalized feedback, Status*) to `config/feedback.json` using the managed format. It is a dry run unless `--write` is given.
- **mapped** rows: the item keeps its stable ID and gets the generalized text. Rows with identical text merge into one canonical item (most popular ID, popularity summed). The others are **soft-deleted** with `mergedInto`, so their IDs still resolve and old wording is dropped.
- **NEEDS MANUAL REVIEW** rows are never promoted: the item is set inactive (hidden from normal users) until someone reviews it.
- **new** rows are added with fresh IDs, unless identical text already exists.
- **`--prune`** soft-deletes anything in the config that is not in the sheet, so the live list is exactly the sheet.
- Safe to re-run: a second run changes nothing. The version is bumped (minor) only when something changed. Review the diff, then follow the normal publish flow.

### What updates remotely, and what doesn't
| Change | How it reaches users |
|---|---|
| Feedback texts: add, edit, enable/disable, delete | Push `config/feedback.json` → automatic |
| Categories (`attributes`) on feedback | Push → automatic |
| Any JavaScript, HTML or CSS | Extension update (reload an unpacked install, or a Chrome Web Store release) |
| `manifest.json`, permissions, Chrome APIs, the Pages URL | Extension update. Chrome may ask users to approve new permissions. |
| New kinds of shared config (e.g. retailer mappings) | Extension update once, to teach it the new field. Their *values* then update remotely. |

**One-time step:** the first build that contains this update mechanism has to be installed the normal way (`git pull` and reload). After that, list changes are automatic.

### GitHub setup
- **Settings → Pages → Source:** *GitHub Actions* (already enabled).
- **Publishes only** `config/feedback.json`, `config/version.json` and a one-line `index.html`. The code, docs, tests and admin emails are not published, and the site is world-readable, so never put secrets or customer data in `config/`.
- **Protect `main`** (Settings → Branches): whoever can push to `main` changes what every user sees, so require a pull request and a review.
- The workflow needs no secrets. It uses `GITHUB_TOKEN` with `pages: write` and `id-token: write` only.

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
npm test                      # unit + integration tests (authz, service, storage, remote config, server, DOM)
npm run lint                  # ESLint (there is no TypeScript, so no separate type check)
npm run verify                # lint + tests + build:site + version-bump check (what CI runs)
npm run test:browser          # real Chrome end-to-end of the unmodified extension (see below)
npm run build:data -- path/to/data.csv   # CSV -> config/feedback.json
npm run publish:list -- export.json      # admin export -> config/feedback.json (bumps version)
npm run build:site                        # builds the GitHub Pages site into ./site (what CI publishes)
npm run check:bump                        # CI guard: config changes must raise the version
npm run dev:server            # reference backend on :8787 (admins: the two initial admins; override with DEV_ADMINS)
```
To try admin features locally: start the dev server, then in the extension's service worker console (`chrome://extensions` → *service worker*) run:
```js
chrome.storage.local.set({ 'afx.devApi': true, 'afx.devUser': 'supriya.m@commerceiq.ai' })
```
and grant the optional `http://localhost:8787/*` permission. This mode is for development only. `X-Dev-User` is not real authentication.

### Real-Chrome end-to-end test
`npm run test:browser` loads this folder as an unpacked extension in Chrome for Testing (set `AFX_CHROME` to another Chromium build; branded Chrome 137+ ignores `--load-extension`). The Hub and GitHub Pages hostnames are mapped to a local HTTPS server, so the extension's real URLs are exercised without touching the real sites. It checks, in one run: the existing helper (list, search, insert, nothing submitted), first check, throttling, the acceptance flow (a published change reaches the installed extension with the extension files byte-for-byte unchanged), an unchanged config, Pages down, invalid JSON and a bad hash, a browser restart while Pages is down, a second profile receiving the same list, and zero console errors. It is not part of `npm test` because it needs a Chromium binary.

### Layout
```
authz/authz.js            role → permission policy (single source)
storage/feedbackStore.js  chrome.storage.local cache (no authorization here)
feedback/api.js           backend client       feedback/service.js  authz + backend + cache
content/                  Hub integration (domAdapter.js, anomalyHub.js)
ui/panel.js               read-only suggestion panel (Shadow DOM)
admin/                    admin page           options/ popup/  user settings, quick search
background/serviceWorker.js  the only code that calls the backend
feedback/remoteConfig.js  throttled, validated config updates   feedback/configSchema.js  shared validation + versions
config/                   the shared feedback list (published to Pages)   scripts/  build-site, publish-list, check-version-bump
.github/workflows/        deploy-config.yml (tests → validate → Pages)
server/dev-server.cjs     reference API for local dev and tests      docs/  API contract, feedback review
```

## Limits
- Server-enforced admin access needs the backend (see above). Local mode only gates the UI and your own copy.
- Admin detection needs Chrome signed in to a Google account (any sign-in state that exposes the email).
- The extension only runs on `anomaly-hub.ef.uk.com`. If the host changes, update `manifest.json`.
- The published config URL is fixed in the extension. Moving to a different Pages URL needs an extension update.
- The live Feedback field is detected by label. If the Hub's markup changes, adjust `content/domAdapter.js`.
