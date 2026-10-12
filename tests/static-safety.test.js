import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSrc, ROOT } from './helpers.js';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

describe('remote update safety (data only, no remote code)', () => {
  const files = ['background/serviceWorker.js', 'feedback/remoteConfig.js', 'feedback/configSchema.js', 'storage/feedbackStore.js'];
  for (const f of files) {
    it(`${f} never evaluates or imports remote code`, () => {
      const src = strip(readSrc(f));
      expect(src).not.toMatch(/\beval\s*\(|new Function\s*\(|document\.write|\.innerHTML\s*=|insertAdjacentHTML/);
      for (const m of src.matchAll(/importScripts\(([^)]*)\)/g)) expect(m[1]).not.toMatch(/https?:|\+|`/); // only fixed local files
    });
  }
  it('the config client only reads JSON text and never injects it as HTML', () => {
    const src = strip(readSrc('feedback/remoteConfig.js'));
    expect(src).toMatch(/JSON\.parse/);
    expect(src).not.toMatch(/innerHTML|<script|createElement/);
  });
  it('the manifest grants the Pages origin and matches the URL in the service worker', () => {
    const url = /REMOTE_CONFIG_BASE\s*=\s*'([^']+)'/.exec(readSrc('background/serviceWorker.js'))[1];
    expect(url).toMatch(/^https:\/\//);
    const origin = new URL(url);
    expect(manifest.host_permissions).toContain(`${origin.origin}${origin.pathname}*`);
  });
  it('no new broad permissions were added for remote config', () => {
    expect(manifest.permissions).toEqual(['storage', 'identity', 'identity.email']);
    expect(manifest.host_permissions.every((h) => h.startsWith('https://'))).toBe(true);
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|\*:\/\/\*/);
  });
  it('the extension has no extra network calls: only the service worker fetches', () => {
    for (const f of ['content/anomalyHub.js', 'content/domAdapter.js', 'ui/panel.js', 'admin/admin.js', 'options/options.js', 'popup/popup.js', 'feedback/service.js', 'feedback/api.js']) {
      expect(strip(readSrc(f)), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
    }
  });
  it('the deploy workflow publishes only the built site, with least-privilege permissions', () => {
    const y = readSrc('.github/workflows/deploy-config.yml');
    expect(y).toMatch(/path:\s*site\b/);
    expect(y).toMatch(/pages:\s*write/);
    expect(y).toMatch(/id-token:\s*write/);
    expect(y).not.toMatch(/contents:\s*write|secrets\./);
  });
  it('no secrets or credentials in tracked config or workflow files', () => {
    for (const f of ['config/feedback.json', '.github/workflows/deploy-config.yml', 'manifest.json']) {
      expect(readSrc(f), f).not.toMatch(/ghp_|github_pat_|xox[bp]-|BEGIN (RSA|PRIVATE)|api[_-]?key\s*[:=]/i);
    }
  });
});
