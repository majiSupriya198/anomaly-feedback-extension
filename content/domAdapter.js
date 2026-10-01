/* DOM INTEGRATION LAYER: finds Anomaly Hub's feedback field and fills it.
 * Knows nothing about storage or the suggestion UI. It never clicks, submits or
 * presses keys: it only sets a value and fires input/change events. */
(function (root) {
  'use strict';

  const FEEDBACK_RE = /feedback/i;
  const SECONDARY_RE = /reason|comment|note|remark|explain|justif/i;
  const EXCLUDE_RE = /search|filter|find/i;
  const CANDIDATES = 'textarea, input:not([type]), input[type="text"], [contenteditable=""], [contenteditable="true"], [role="textbox"]';

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = (n.ownerDocument.defaultView || window).getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  function labelText(el) {
    const parts = [
      el.getAttribute('aria-label'), el.getAttribute('placeholder'),
      el.getAttribute('name'), el.id, el.getAttribute('data-testid'),
    ];
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => { const n = el.ownerDocument.getElementById(id); if (n) parts.push(n.textContent); });
    if (el.id) {
      const l = el.ownerDocument.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l) parts.push(l.textContent);
    }
    const wrap = el.closest('label');
    if (wrap) parts.push(wrap.textContent);
    // MUI: <div FormControl><label/><div InputBase><textarea/></div></div>
    const fc = el.closest('.MuiFormControl-root, .MuiTextField-root');
    if (fc) { const l = fc.querySelector('label, legend'); if (l) parts.push(l.textContent); }
    // Plain markup: a heading/label immediately before the field's container
    const prev = (el.closest('div') || el).previousElementSibling;
    if (prev && prev.textContent && prev.textContent.length < 60) parts.push(prev.textContent);
    return parts.filter(Boolean).join(' ');
  }

  function candidateList(scope) {
    return Array.from(scope.querySelectorAll(CANDIDATES)).filter((el) => {
      if (el.classList.contains('MuiSelect-nativeInput')) return false; // MUI Select's hidden input
      if (el.closest('[data-afx-host]')) return false; // never target our own UI
      if (el.readOnly || el.disabled) return false;
      if (el.tagName === 'TEXTAREA' && el.getAttribute('aria-hidden') === 'true') return false; // MUI autosize shadow
      if (el.tagName === 'INPUT' && /search|filter/i.test(el.type)) return false;
      return isVisible(el);
    });
  }

  function dialogScope(doc) {
    const dialogs = doc.querySelectorAll('[role="dialog"], .MuiDialog-paper, .MuiDrawer-paper, .MuiModal-root');
    return dialogs.length ? dialogs[dialogs.length - 1] : null; // topmost open one
  }

  /** Returns the best feedback field or null. Strategies, in order of confidence:
   *  1. field labelled/placed/named "feedback"  2. reason/comment/note-like field
   *  3. the only free-text field in the open dialog  4. the only textarea on the page. */
  function findFeedbackField(doc) {
    doc = doc || document;
    const dlg = dialogScope(doc);
    const scopes = dlg ? [dlg, doc] : [doc];
    let best = null;
    let bestScore = 0;
    for (let s = 0; s < scopes.length; s++) {
      const cands = candidateList(scopes[s]);
      for (const el of cands) {
        const label = labelText(el);
        if (EXCLUDE_RE.test(label)) continue;
        let score = 0;
        if (FEEDBACK_RE.test(label)) score = 100;
        else if (SECONDARY_RE.test(label)) score = 60;
        if (score && s === 0 && dlg) score += 10;
        if (score > bestScore) { best = el; bestScore = score; }
      }
      if (best) return best;
      const areas = cands.filter((c) => c.tagName === 'TEXTAREA' || c.isContentEditable);
      if (areas.length === 1 && !EXCLUDE_RE.test(labelText(areas[0]))) return areas[0];
    }
    return null;
  }

  /** The anomaly's attribute, e.g. "extract.promotionText", read from the dialog header. */
  function detectAttribute(doc) {
    doc = doc || document;
    const scope = dialogScope(doc) || doc.body;
    if (!scope) return null;
    const m = /Attribute:\s*([A-Za-z0-9_.]+)/i.exec((scope.textContent || '').slice(0, 600));
    return m ? m[1] : null;
  }

  function readValue(el) {
    return el.isContentEditable && el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT' ? el.textContent : el.value;
  }

  function fire(el, type, extra) {
    const Ev = type === 'input' && typeof InputEvent === 'function' ? InputEvent : Event;
    el.dispatchEvent(new Ev(type, Object.assign({ bubbles: true, cancelable: false }, extra || {})));
  }

  /** Sets the value the way the browser would so React/Vue/Angular register the change. */
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    const ownDesc = Object.getOwnPropertyDescriptor(el, 'value'); // React's value tracker lives here
    if (ownDesc && ownDesc.set && ownDesc.set !== protoSetter) {
      // Bypass the tracker so React sees the event as a real change.
      protoSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  /** Fills `el` with `text`. mode: 'replace' | 'append'. Returns {ok, reason?}. */
  function fillField(el, text, mode) {
    if (!el || !el.isConnected) return { ok: false, reason: 'no-field' };
    let value = text;
    if (mode === 'append') {
      const cur = readValue(el) || '';
      value = cur ? cur + (/\s$/.test(cur) ? '' : '\n') + text : text;
    }
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      setNativeValue(el, value);
      fire(el, 'input', { data: text, inputType: 'insertText' });
      fire(el, 'change');
    } else {
      const doc = el.ownerDocument;
      const sel = doc.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      let done = false;
      try { done = !!doc.execCommand && doc.execCommand('insertText', false, value); } catch (e) { done = false; }
      if (!done || readValue(el) !== value) {
        el.textContent = value;
        fire(el, 'input', { data: value, inputType: 'insertText' });
      }
      fire(el, 'change');
    }
    return { ok: true };
  }

  const api = { findFeedbackField, detectAttribute, fillField, readValue, isVisible, dialogScope };
  root.AFX = root.AFX || {};
  root.AFX.dom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
