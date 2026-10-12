# Rollback notes

## Restore point: before GitHub Pages remote config
- **Commit:** `17e55c8` (already on `origin/main`), tag `restore/pre-pages-local-admin`, branch `backup/pre-pages`.
- **What that version does:** the feedback list is bundled inside the extension (`data/feedback.json`, version in `data/feedback.meta.json`). Admins are recognised by Chrome account email (local mode). 77 tests. It makes no requests to GitHub. Updating the list means `git pull` and reloading the extension.
- **What the next version changes:** the list moves to `config/feedback.json`, is published to GitHub Pages by `.github/workflows/deploy-config.yml`, and the extension fetches it (new host permission for the Pages origin, `feedback/remoteConfig.js`, `feedback/configSchema.js`).

## Go back (safe, keeps history)
```bash
git revert --no-edit <first-pages-commit>..HEAD      # or: git revert <commit>  for one commit
git push
```
Or restore the old files without rewriting history:
```bash
git checkout restore/pre-pages-local-admin -- .      # files only
git commit -m "Roll back to pre-Pages version" && git push
```
Never force-push `main` unless you are certain nobody else has pulled it.

## Switch Pages off
- Stop publishing: delete or disable `.github/workflows/deploy-config.yml`, or Settings → Pages → *Unpublish site*.
- Installed extensions that already have the fetcher keep working from their cache and simply find nothing new. They fall back to their last known good list. To remove the fetching itself, ship a build without `feedback/remoteConfig.js` (an extension update).

## Offline copy
A `git bundle` of the restore point was saved next to the repo as `../anomaly-feedback-extension-pre-pages.bundle`. Restore with `git clone anomaly-feedback-extension-pre-pages.bundle restore-copy`.
