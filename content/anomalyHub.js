/* Bootstrap: glues storage -> panel -> DOM adapter. Runs only on the Anomaly Hub origin.
 * One debounced MutationObserver does a cheap re-check; the field is re-resolved at click time. */
(function () {
  'use strict';
  const { dom, createPanel, authz, store, apiClient, feedbackService } = globalThis.AFX;
  const service = feedbackService.createService({ api: apiClient.createApi(apiClient.messageTransport), store, authz, localIdentity: apiClient.messageWhoAmI });
  const DEBOUNCE_MS = 250;

  // Idempotent across re-injection and extension reloads. The generation counter lives in the DOM,
  // so it is visible to an orphaned script from an earlier extension version too: the newest wins.
  const root = document.documentElement;
  const gen = (Number(root.getAttribute('data-afx-gen')) || 0) + 1;
  root.setAttribute('data-afx-gen', String(gen));
  document.querySelectorAll('[data-afx-host]').forEach((n) => n.remove());
  let observer = null;
  let timer = null;

  async function onSelect(item) {
    const field = dom.findFeedbackField(document); // fresh lookup, never a cached element
    if (!field) {
      try { await navigator.clipboard.writeText(item.text); return { ok: false, copied: true }; }
      catch (e) { return { ok: false, copied: false }; }
    }
    const settings = await service.getSettings();
    const current = dom.readValue(field);
    if (settings.insertMode === 'replace' && settings.confirmReplace && current && current.trim() && current !== item.text &&
        !window.confirm('The Feedback field already has text. Replace it?')) {
      return { ok: false, copied: false };
    }
    return dom.fillField(field, item.text, settings.insertMode);
  }

  const panel = createPanel({
    service,
    onSelect,
    onManage: () => { try { chrome.runtime.sendMessage({ type: 'afx.openAdmin' }); } catch (e) { /* extension reloaded */ } },
  });

  // MUI dialogs trap focus: mount inside the open dialog so typing in our search box isn't stolen.
  function mountPoint() {
    return document.querySelector('.MuiDialog-paper, [role="dialog"]:not([data-afx-host])') || document.body;
  }
  function ensureMounted() {
    const target = mountPoint();
    if (panel.host.parentElement !== target) target.appendChild(panel.host);
  }

  function teardown() {
    if (observer) observer.disconnect();
    clearTimeout(timer);
    panel.host.remove();
    window.removeEventListener('popstate', schedule);
    window.removeEventListener('hashchange', schedule);
  }

  function refresh() {
    // Superseded by a newer instance, or the extension was reloaded/removed (orphaned script).
    const orphaned = !(globalThis.chrome && chrome.runtime && chrome.runtime.id);
    if (orphaned || Number(root.getAttribute('data-afx-gen')) !== gen) { teardown(); return; }
    ensureMounted();
    panel.update({ fieldFound: !!dom.findFeedbackField(document), attribute: dom.detectAttribute(document) });
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, DEBOUNCE_MS); }

  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  if (window.navigation && window.navigation.addEventListener) window.navigation.addEventListener('navigatesuccess', schedule);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[store.KEY_FEEDBACK]) panel.reload(); });

  // Ask the service worker to refresh the shared list. It is throttled there, so this is cheap.
  try { chrome.runtime.sendMessage({ type: 'afx.checkConfig' }, () => void chrome.runtime.lastError); } catch (e) { /* extension reloaded */ }
  service.sync().finally(() => panel.reload().then(refresh).catch(() => refresh()));
  ensureMounted();
})();
