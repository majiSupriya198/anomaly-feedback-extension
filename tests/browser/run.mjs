// Real-Chrome end-to-end test of the UNMODIFIED extension.
//
//   npm run test:browser
//
// Chromium loads the extension from this repo exactly as a user would ("Load unpacked"). The Hub host and
// the GitHub Pages host are mapped to a local HTTPS server, so the extension's real hard-coded URLs are
// exercised without touching the real sites. The extension directory is never rebuilt, edited or
// re-imported during the test: only the "Pages" content changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HUB = 'https://anomaly-hub.ef.uk.com';
const PAGES_HOST = 'majisupriya198.github.io';
const PORT = 8443;
// Branded Chrome (137+) ignores --load-extension, so use a Chromium build: Chrome for Testing, or set AFX_CHROME.
const CHROME = process.env.AFX_CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afx-browser-'));
const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/feedback.json'), 'utf8'));
const isLive = (i) => i.active !== false && !i.deletedAt;
const liveCount = shipped.items.filter(isLive).length;
// What the panel shows for an EXTRACT.PROMOTIONTEXT anomaly: live items of that category plus untagged ones.
const promoCount = shipped.items.filter((i) => isLive(i) && (!i.attributes.length || i.attributes.includes('extract.promotionText'))).length;
const livePromoIdx = (cfg) => cfg.items.findIndex((i) => isLive(i) && i.attributes.includes('extract.promotionText'));

// --- local HTTPS server standing in for both the Hub and GitHub Pages ---------------------------------
const certKey = path.join(tmp, 'key.pem'), certPem = path.join(tmp, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', certKey, '-out', certPem, '-days', '2', '-subj', '/CN=afx-test',
  '-addext', `subjectAltName=DNS:anomaly-hub.ef.uk.com,DNS:${PAGES_HOST}`], { stdio: 'ignore' });

const pages = { dir: null, mode: 'ok', hits: [] }; // what "GitHub Pages" currently serves
const buildSite = (cfg, name) => {
  const cfgFile = path.join(tmp, name + '.json'); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  const out = path.join(tmp, 'site-' + name);
  execFileSync('node', [path.join(ROOT, 'scripts/build-site.mjs'), out], { env: { ...process.env, AFX_CONFIG: cfgFile }, stdio: 'pipe' });
  return out;
};
const server = https.createServer({ key: fs.readFileSync(certKey), cert: fs.readFileSync(certPem) }, (req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  if (host === PAGES_HOST) {
    const rel = req.url.replace(/^\/anomaly-feedback-extension\//, '').split('?')[0];
    pages.hits.push(rel);
    if (pages.mode === 'down') { res.writeHead(503); return res.end('unavailable'); }
    if (pages.mode === 'invalid-json' && rel.endsWith('feedback.json')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"broken": '); }
    const f = path.join(pages.dir, rel);
    if (!f.startsWith(pages.dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const body = fs.readFileSync(f);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=0', ETag: '"' + crypto.createHash('md5').update(body).digest('hex') + '"' });
    return res.end(body);
  }
  if (host === 'anomaly-hub.ef.uk.com') {
    if (req.url.startsWith('/api/')) { res.writeHead(404); return res.end(); } // no backend: extension runs in local mode
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(ROOT, 'tests/browser/fake-hub.html')));
  }
  res.writeHead(404); res.end();
});

// --- helpers ---------------------------------------------------------------------------------------
const contexts = [];
const problems = []; // console errors / uncaught exceptions from pages and service workers
async function launch(userDataDir) {
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME, headless: true, ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--ignore-certificate-errors',
      `--host-resolver-rules=MAP ${PAGES_HOST} 127.0.0.1:${PORT},MAP anomaly-hub.ef.uk.com 127.0.0.1:${PORT}`],
  });
  contexts.push(ctx);
  const watch = (target, label) => {
    target.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) problems.push(`${label}: ${m.text()}`); });
    target.on('pageerror', (e) => problems.push(`${label} exception: ${e.message}`));
  };
  ctx.on('page', (p) => watch(p, 'page'));
  ctx.on('serviceworker', (w) => watch(w, 'service-worker'));
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  watch(sw, 'service-worker');
  return { ctx, sw };
}
const storageGet = (sw, keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);
/** Simulates time passing: the 15 minute check throttle has elapsed. */
const expireThrottle = (sw) => sw.evaluate(async () => { const s = (await chrome.storage.local.get('afx.remoteState'))['afx.remoteState'] || {}; s.lastCheck = 0; await chrome.storage.local.set({ 'afx.remoteState': s }); });
async function openHub(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${HUB}/anomalies?anomaly=1`);
  await page.waitForSelector('#afx-feedback-host', { state: 'attached', timeout: 15000 });
  return page;
}
const panel = (page) => page.locator('#afx-feedback-host');
async function openPanel(page) {
  await panel(page).locator('.launcher').click();
  await panel(page).locator('.item').first().waitFor({ timeout: 10000 });
}
const itemTexts = (page) => panel(page).locator('.item .t').allTextContents();
async function settle(sw, version, ms = 10000) { // wait until the service worker's cache reaches `version`
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await storageGet(sw, 'afx.configVersion'))['afx.configVersion'] === version) return true; await new Promise((r) => setTimeout(r, 150)); }
  return false;
}
const treeHash = () => { // fingerprint of the installed extension files (code), to prove nothing is rebuilt or re-imported
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['node_modules', '.git', 'site', 'tests', 'docs', '.github'].includes(f.name)) continue;
    const p = path.join(d, f.name); f.isDirectory() ? walk(p) : h.update(p + fs.readFileSync(p)); } };
  walk(ROOT); return h.digest('hex');
};

before(async () => {
  pages.dir = buildSite(shipped, 'v-shipped');
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
});
after(async () => { for (const c of contexts) await c.close().catch(() => {}); await new Promise((r) => server.close(r)); });

// --- the scenario (tests run in order and share state, like one user's day) ------------------------------
const userA = path.join(tmp, 'profile-A');
let A, v2, codeBefore;
const NEW_RULE = 'EDITED SHARED RULE: this wording was published without any reinstall.';
const NEW_ITEM = 'A brand new shared suggestion that appeared remotely.';

test('1. existing Feedback Helper works in real Chrome: list, search, insert, and NOTHING is submitted', async () => {
  codeBefore = treeHash();
  A = await launch(userA);
  const page = await openHub(A.ctx);
  await openPanel(page);
  // The Hub page is for EXTRACT.PROMOTIONTEXT, so the panel pre-filters to that category (plus untagged items).
  const filtered = await itemTexts(page);
  assert.equal(filtered.length, promoCount, 'panel shows exactly the live promotionText items');
  await panel(page).locator('.chip:not(.off)').click(); // toggle the category filter off -> the whole shared list
  await page.waitForTimeout(250);
  assert.equal((await itemTexts(page)).length, liveCount, 'whole live list is available (soft-deleted and inactive items never show)');
  // The three newly added rules are reachable through the normal search.
  for (const [q, re] of [['.res resource', /\.res resource format/], ['collapsed accordion', /collapsed accordion/], ['ld+json', /application\/ld\+json/]]) {
    await panel(page).locator('input[type=search]').fill(q);
    await page.waitForTimeout(250);
    assert.ok((await itemTexts(page)).some((t) => re.test(t)), `new rule findable by search "${q}"`);
  }
  await panel(page).locator('input[type=search]').fill('SITE-WIDE banner'); // back to the original flow
  await page.waitForTimeout(250);
  await panel(page).locator('.chip.off').first().click().catch(() => {});
  await panel(page).locator('input[type=search]').fill('SITE-WIDE banner');
  await page.waitForTimeout(250);
  const hits = await itemTexts(page);
  assert.ok(hits.length >= 1 && hits.every((t) => /site-wide/i.test(t)));
  await panel(page).locator('.item').first().click();
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue('#fb'), hits[0].trim());
  assert.equal(await page.evaluate(() => [window.__submits, window.__fpClicks]).then((a) => a.join()), '0,0', 'extension must never submit or click anything');
  assert.ok(await page.evaluate(() => window.__inputs) >= 1, 'framework-visible input event was fired');
  await page.close();
});

test('2. first-time check: the bundled version equals Pages, so only the tiny version.json is requested', async () => {
  const hits = pages.hits.filter((h) => h.startsWith('config/'));
  assert.deepEqual([...new Set(hits)], ['config/version.json']);
  assert.ok(!hits.includes('config/feedback.json'), 'feedback.json must not be downloaded when unchanged');
  const st = await storageGet(A.sw, 'afx.remoteState');
  assert.ok(st['afx.remoteState'].lastCheck > 0 && !st['afx.remoteState'].lastError);
});

test('3. repeated page loads inside the throttle window make no extra requests', async () => {
  pages.hits.length = 0;
  for (let i = 0; i < 3; i++) { const p = await openHub(A.ctx); await p.close(); }
  assert.deepEqual(pages.hits, [], 'throttled: zero requests to Pages');
});

test('4. ACCEPTANCE: a published change reaches the already-installed extension with no pull, rebuild or re-import', async () => {
  const cfg = structuredClone(shipped);
  cfg.version = '9.9.1'; cfg.updatedAt = new Date().toISOString();
  const editIdx = livePromoIdx(cfg); // a live item visible for this anomaly's category
  cfg.items[editIdx].text = NEW_RULE;
  cfg.items.push({ id: 'fb-901', text: NEW_ITEM, active: true, attributes: ['extract.promotionText'], popularity: 0, source: 'repo', createdAt: cfg.updatedAt, updatedAt: cfg.updatedAt, deletedAt: null });
  v2 = cfg;
  pages.dir = buildSite(cfg, 'v2'); // == GitHub Actions deploying the new site
  await expireThrottle(A.sw); pages.hits.length = 0;

  const page = await openHub(A.ctx);               // user just opens/reloads Anomaly Hub
  assert.ok(await settle(A.sw, '9.9.1'), 'extension should have downloaded version 9.9.1');
  await openPanel(page);
  await panel(page).locator('input[type=search]').fill('EDITED SHARED RULE');
  await page.waitForTimeout(250);
  const found = await itemTexts(page);
  assert.ok(found.some((t) => t.includes(NEW_RULE)), 'the updated rule is visible');
  await panel(page).locator('.item').first().click();
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue('#fb'), NEW_RULE, 'the updated rule is actually used');
  assert.deepEqual([...new Set(pages.hits)].sort(), ['config/feedback.json', 'config/version.json']);
  assert.equal(treeHash(), codeBefore, 'extension code is byte-for-byte unchanged: nothing was rebuilt or re-imported');
  await page.close();
});

test('5. unchanged config: only version.json again, no re-download', async () => {
  await expireThrottle(A.sw); pages.hits.length = 0;
  const page = await openHub(A.ctx); await page.waitForTimeout(800); await page.close();
  assert.deepEqual(pages.hits, ['config/version.json']);
});

test('6. Pages unavailable (HTTP 503): the last known good list keeps working', async () => {
  pages.mode = 'down'; await expireThrottle(A.sw);
  const page = await openHub(A.ctx); await page.waitForTimeout(800);
  await openPanel(page);
  assert.ok((await itemTexts(page)).some((t) => t.includes(NEW_RULE)));
  const st = (await storageGet(A.sw, 'afx.remoteState'))['afx.remoteState'];
  assert.match(st.lastError, /HTTP 503/);
  assert.equal((await storageGet(A.sw, 'afx.configVersion'))['afx.configVersion'], '9.9.1');
  await page.close();
});

test('7. invalid JSON and a bad hash are rejected without replacing the cache', async () => {
  pages.mode = 'ok';
  const bad = structuredClone(v2); bad.version = '9.9.2'; bad.items[livePromoIdx(bad)].text = 'MUST NEVER APPEAR';
  pages.dir = buildSite(bad, 'v3');
  pages.mode = 'invalid-json'; await expireThrottle(A.sw);
  let page = await openHub(A.ctx); await page.waitForTimeout(800); await page.close();
  assert.equal((await storageGet(A.sw, 'afx.configVersion'))['afx.configVersion'], '9.9.1');
  pages.mode = 'ok';
  fs.writeFileSync(path.join(pages.dir, 'config/feedback.json'), fs.readFileSync(path.join(pages.dir, 'config/feedback.json'), 'utf8').replace('MUST NEVER APPEAR', 'TAMPERED'));
  await expireThrottle(A.sw);
  page = await openHub(A.ctx); await page.waitForTimeout(800);
  assert.match((await storageGet(A.sw, 'afx.remoteState'))['afx.remoteState'].lastError, /sha256/);
  await openPanel(page);
  assert.ok(!(await itemTexts(page)).some((t) => /NEVER APPEAR|TAMPERED/.test(t)));
  await page.close();
});

test('8. browser restart while Pages is down: the cached list is still used', async () => {
  await A.ctx.close();
  pages.mode = 'down';
  A = await launch(userA);
  const page = await openHub(A.ctx); await openPanel(page);
  assert.ok((await itemTexts(page)).some((t) => t.includes(NEW_RULE)), 'cached 9.9.1 list survived the restart');
  assert.equal((await storageGet(A.sw, 'afx.configVersion'))['afx.configVersion'], '9.9.1');
  await page.close();
});

test('9. a different user/browser profile gets the same latest list, with one download', async () => {
  pages.mode = 'ok'; pages.dir = buildSite(v2, 'v2b'); pages.hits.length = 0;
  const B = await launch(path.join(tmp, 'profile-B'));       // fresh profile, ships the same extension build
  const page = await openHub(B.ctx);
  assert.ok(await settle(B.sw, '9.9.1'), 'second profile should receive 9.9.1');
  await openPanel(page);
  await panel(page).locator('input[type=search]').fill('brand new shared suggestion');
  await page.waitForTimeout(250);
  assert.ok((await itemTexts(page)).some((t) => t.includes(NEW_ITEM)));
  assert.equal(pages.hits.filter((h) => h.endsWith('feedback.json')).length, 1);
  await page.close();
  const listA = (await storageGet(A.sw, 'afx.feedback'))['afx.feedback'].map((i) => [i.id, i.text]);
  const listB = (await storageGet(B.sw, 'afx.feedback'))['afx.feedback'].map((i) => [i.id, i.text]);
  assert.deepEqual(listA, listB);
});

test('10. no console errors or uncaught exceptions from the pages or service workers during the whole run', () => {
  assert.deepEqual(problems, []);
});
