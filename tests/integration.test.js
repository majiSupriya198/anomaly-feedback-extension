// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { req, memoryBackend, SEED, sleep, readSrc, ROOT, fakeBackend } from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';

const store = req('../storage/feedbackStore.js');
req('../authz/authz.js');
req('../feedback/api.js');
req('../feedback/service.js');
req('../content/domAdapter.js');
req('../ui/panel.js');
const bootSrc = readSrc('content/anomalyHub.js');

let clipboard, be;
function boot() { new Function(bootSrc)(); }
const host = () => document.getElementById('afx-feedback-host');
const shadow = () => host().shadowRoot;
const launcher = () => shadow().querySelector('.launcher');
const items = () => [...shadow().querySelectorAll('.item')];
const dotOk = () => shadow().querySelector('.dot').classList.contains('ok');
const dialogHtml = (id, withField = true) => `<div class="MuiDialog-paper" role="dialog"><h2>Attribute: EXTRACT.IMAGEURL</h2>
  <button id="${id}-fp">False Positive</button>
  ${withField ? `<div class="MuiFormControl-root"><label>Feedback</label><textarea id="${id}-fb"></textarea></div>` : ''}
  <form id="${id}-form"><button type="submit" id="${id}-submit">Submit</button></form></div>`;

beforeEach(async () => {
  document.body.innerHTML = '';
  const backend = memoryBackend();
  store._configure({ backend, seedLoader: async () => structuredClone(SEED) });
  clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
  be = fakeBackend('user');
  globalThis.chrome = { storage: { onChanged: { addListener() {} } },
    runtime: { id: 'test-ext', sendMessage(msg, cb) { if (msg.type === 'afx.whoami') return cb({ email: 'someone@commerceiq.ai' }); if (msg.type === 'afx.checkConfig') { globalThis.__configChecks = (globalThis.__configChecks || 0) + 1; return cb({ status: 'throttled' }); } be.transport({ method: msg.method, path: msg.path, body: msg.body }).then(cb, () => cb(undefined)); } } };
  window.confirm = vi.fn(() => true);
});

describe('suggestion UI + integration', () => {
  it('lists feedback and filters as you type (case-insensitive, partial)', async () => {
    boot(); await sleep(30);
    launcher().click(); await sleep(30);
    expect(items().length).toBe(4);
    const q = shadow().querySelector('input[type=search]');
    q.value = 'NETQ'; q.dispatchEvent(new Event('input')); await sleep(150);
    expect(items().map((i) => i.querySelector('.t').textContent)).toEqual(['NetQuantity length mismatch']);
  });

  it('clicking a suggestion populates the field and does NOT submit anything', async () => {
    document.body.innerHTML = dialogHtml('a');
    const events = [];
    ['click', 'submit', 'keydown', 'keyup', 'keypress'].forEach((t) =>
      document.addEventListener(t, (e) => { if (!e.composedPath().includes(host())) events.push(t + ':' + (e.target.id || e.target.tagName)); }, true));
    const submitSpy = vi.fn(); document.getElementById('a-form').addEventListener('submit', submitSpy);
    boot(); await sleep(350);
    expect(dotOk()).toBe(true);
    launcher().click(); await sleep(30);
    items().find((i) => i.textContent.includes('Repeated DOM')).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await sleep(60);
    expect(document.getElementById('a-fb').value).toBe('Repeated DOM content');
    expect(submitSpy).not.toHaveBeenCalled();
    expect(events).toEqual([]); // no clicks, submits or key presses reached the page
  });

  it('shows the detected attribute and filters by it', async () => {
    document.body.innerHTML = dialogHtml('a');
    boot(); await sleep(350);
    launcher().click(); await sleep(30);
    expect(shadow().querySelector('.chip:not(.off)').textContent).toMatch(/imageUrl/);
    // imageUrl-tagged + untagged only
    expect(items().length).toBe(2);
  });

  it('handles a feedback field that appears after a delay', async () => {
    document.body.innerHTML = dialogHtml('a', false);
    boot(); await sleep(350);
    expect(dotOk()).toBe(false);
    document.querySelector('.MuiDialog-paper').insertAdjacentHTML('beforeend', '<div class="MuiFormControl-root"><label>Feedback</label><textarea id="late"></textarea></div>');
    await sleep(400);
    expect(dotOk()).toBe(true);
    launcher().click(); await sleep(30);
    items()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await sleep(60);
    expect(document.getElementById('late').value).not.toBe('');
  });

  it('survives navigation between anomalies (field element replaced)', async () => {
    document.body.innerHTML = dialogHtml('one');
    boot(); await sleep(350);
    launcher().click(); await sleep(30);
    document.body.innerHTML = dialogHtml('two'); // SPA swaps the DOM; our host was inside the old dialog
    await sleep(400);
    expect(document.querySelectorAll('#afx-feedback-host').length).toBe(1);
    expect(host().isConnected).toBe(true);
    expect(shadow().querySelector('.panel').hasAttribute('hidden')).toBe(false); // still open
    items()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await sleep(60);
    expect(document.getElementById('two-fb').value).not.toBe('');
  });

  it('asks the service worker to check the shared config once per page load', async () => {
    globalThis.__configChecks = 0;
    boot(); await sleep(60);
    expect(globalThis.__configChecks).toBe(1);
  });

  it('page refresh / re-injection never duplicates the panel', async () => {
    boot(); boot(); boot(); await sleep(400);
    expect(document.querySelectorAll('#afx-feedback-host').length).toBe(1);
  });

  it('an orphaned instance (extension reloaded) removes itself and stops observing', async () => {
    boot(); await sleep(30);
    expect(host()).not.toBeNull();
    globalThis.chrome.runtime.id = undefined; // what Chrome does to an orphaned content script
    document.body.appendChild(document.createElement('div')); await sleep(400);
    expect(host()).toBeNull();
    globalThis.chrome.runtime.id = 'test-ext';
  });

  it('missing field: falls back to clipboard, no error, nothing submitted', async () => {
    document.body.innerHTML = dialogHtml('a', false);
    const submitSpy = vi.fn(); document.getElementById('a-form').addEventListener('submit', submitSpy);
    boot(); await sleep(350);
    launcher().click(); await sleep(30);
    items()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await sleep(60);
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(shadow().querySelector('.status').textContent).toMatch(/not found/i);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('asks before replacing existing text and respects "Cancel"', async () => {
    document.body.innerHTML = dialogHtml('a');
    document.getElementById('a-fb').value = 'typed by hand';
    window.confirm = vi.fn(() => false);
    boot(); await sleep(350);
    launcher().click(); await sleep(30);
    items()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await sleep(60);
    expect(window.confirm).toHaveBeenCalled();
    expect(document.getElementById('a-fb').value).toBe('typed by hand');
  });

  it('normal user sees NO admin or edit controls in the panel', async () => {
    boot(); await sleep(60);
    launcher().click(); await sleep(60);
    const text = shadow().textContent;
    expect(text).not.toMatch(/Manage|\+ New|Save field text/);
    expect(shadow().querySelector('[aria-label=Edit], [aria-label=Delete], textarea')).toBeNull();
    expect(shadow().querySelectorAll('footer button').length).toBe(0);
  });

  it('admin sees the manage link and inactive items, clearly marked and not insertable', async () => {
    be = fakeBackend('admin', [...SEED, { ...SEED[0], id: 'fb-009', text: 'Disabled one', active: false, attributes: [] }]);
    document.body.innerHTML = dialogHtml('a');
    boot(); await sleep(350);
    launcher().click(); await sleep(80);
    expect([...shadow().querySelectorAll('footer button')].map((b) => b.textContent)).toEqual(['Manage feedback\u2026']);
    const inactive = items().find((i) => i.textContent.includes('Disabled one'));
    expect(inactive.textContent).toMatch(/Inactive/);
    inactive.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await sleep(60);
    expect(document.getElementById('a-fb').value).toBe('');
    expect(shadow().querySelector('.status').textContent).toMatch(/inactive/i);
  });

  it('normal user never receives inactive items', async () => {
    be = fakeBackend('user', [...SEED, { ...SEED[0], id: 'fb-009', text: 'Disabled one', active: false, attributes: [] }]);
    boot(); await sleep(60);
    launcher().click(); await sleep(80);
    expect(items().some((i) => i.textContent.includes('Disabled one'))).toBe(false);
  });

  it('works offline from the local cache (backend down)', async () => {
    be.online = false;
    boot(); await sleep(60);
    launcher().click(); await sleep(80);
    expect(items().length).toBe(4);
  });
});

describe('static safety: nothing in the page-facing code can submit', () => {
  const files = ['content/domAdapter.js', 'content/anomalyHub.js', 'ui/panel.js'];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of files) {
    it(`${f} never clicks, submits or sends key events`, () => {
      const src = strip(readSrc(f));
      expect(src).not.toMatch(/\.click\s*\(/);
      expect(src).not.toMatch(/\.submit\s*\(|requestSubmit/);
      expect(src).not.toMatch(/KeyboardEvent|new MouseEvent|PointerEvent/);
      expect(src).not.toMatch(/querySelector(All)?\([^)]*(button|submit)/i);
    });
  }
  it('user-facing code (panel, content script, popup) calls no write method', () => {
    for (const f of ['ui/panel.js', 'content/anomalyHub.js', 'popup/popup.js']) {
      const src = strip(readSrc(f));
      expect(src, f).not.toMatch(/service\.(create|update|setActive|remove|restore|exportAll)\b/);
      expect(src, f).not.toMatch(/store\.(setAll|upsert)\b/);
    }
  });
  it('manifest declares only storage, identity.email and the Hub origin', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(['storage', 'identity', 'identity.email']);
    expect(m.optional_host_permissions).toEqual(['http://localhost:8787/*']);
    expect(m.content_scripts[0].matches).toEqual(['https://anomaly-hub.ef.uk.com/*']);
    expect(m.host_permissions).toEqual(['https://anomaly-hub.ef.uk.com/*', 'https://majisupriya198.github.io/anomaly-feedback-extension/*']);
    expect(m.permissions).not.toContain('alarms');
  });
});
