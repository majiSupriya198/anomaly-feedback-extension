// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { req } from './helpers.js';

const dom = req('../content/domAdapter.js');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mirrors MUI's multiline TextField: visible textarea + aria-hidden autosize shadow textarea.
function muiField(label) {
  return `<div class="MuiFormControl-root MuiTextField-root"><label>${label}</label>
    <div class="MuiInputBase-root"><textarea rows="3"></textarea>
    <textarea aria-hidden="true" readonly tabindex="-1" style="visibility:hidden"></textarea></div></div>`;
}
beforeEach(() => { document.body.innerHTML = ''; });

describe('locating the feedback field', () => {
  it('finds a field labelled Feedback and skips the MUI shadow textarea', () => {
    document.body.innerHTML = `<div role="dialog"><input class="MuiSelect-nativeInput"><input type="text" placeholder="Search products">${muiField('Feedback')}</div>`;
    const f = dom.findFeedbackField(document);
    expect(f.tagName).toBe('TEXTAREA');
    expect(f.getAttribute('aria-hidden')).toBeNull();
  });
  it('matches by placeholder / aria-label', () => {
    document.body.innerHTML = '<div role="dialog"><textarea aria-label="Feedback (optional)"></textarea><textarea placeholder="x"></textarea></div>';
    expect(dom.findFeedbackField(document).getAttribute('aria-label')).toMatch(/Feedback/);
  });
  it('falls back to a reason/comment field, then to the only textarea in the dialog', () => {
    document.body.innerHTML = '<div role="dialog"><textarea id="a" placeholder="Reason"></textarea></div>';
    expect(dom.findFeedbackField(document).id).toBe('a');
    document.body.innerHTML = '<div role="dialog"><textarea id="b"></textarea></div>';
    expect(dom.findFeedbackField(document).id).toBe('b');
  });
  it('returns null when there is no suitable field (missing field)', () => {
    document.body.innerHTML = '<div role="dialog"><input class="MuiSelect-nativeInput"><input type="text" placeholder="Search"><button>False Positive</button></div>';
    expect(dom.findFeedbackField(document)).toBeNull();
  });
  it('ignores hidden, disabled and read-only fields', () => {
    document.body.innerHTML = '<div hidden><textarea aria-label="Feedback"></textarea></div><textarea aria-label="Feedback" disabled></textarea><textarea aria-label="Feedback" readonly></textarea>';
    expect(dom.findFeedbackField(document)).toBeNull();
  });
  it('detects the attribute from the dialog header', () => {
    document.body.innerHTML = '<div role="dialog"><h2>Attribute: EXTRACT.PROMOTIONTEXT · Retailer : Amazon-US</h2></div>';
    expect(dom.detectAttribute(document)).toBe('EXTRACT.PROMOTIONTEXT');
  });
});

describe('populating the field', () => {
  it('fills a plain textarea and fires input + change', () => {
    document.body.innerHTML = muiField('Feedback');
    const el = dom.findFeedbackField(document);
    const seen = [];
    ['input', 'change'].forEach((t) => el.addEventListener(t, () => seen.push(t)));
    expect(dom.fillField(el, 'hello', 'replace')).toEqual({ ok: true });
    expect(el.value).toBe('hello');
    expect(seen).toEqual(['input', 'change']);
  });
  it('append mode keeps existing text', () => {
    document.body.innerHTML = muiField('Feedback');
    const el = dom.findFeedbackField(document);
    dom.fillField(el, 'one', 'replace');
    dom.fillField(el, 'two', 'append');
    expect(el.value).toBe('one\ntwo');
  });
  it('fills a contenteditable', () => {
    document.body.innerHTML = '<div role="dialog"><div contenteditable="true" role="textbox" aria-label="Feedback"></div></div>';
    const el = dom.findFeedbackField(document);
    expect(dom.fillField(el, 'ce text', 'replace').ok).toBe(true);
    expect(el.textContent).toBe('ce text');
  });
  it('reports failure for a detached/missing element', () => {
    expect(dom.fillField(null, 'x')).toEqual({ ok: false, reason: 'no-field' });
  });

  it('works with a React-controlled input (real React)', async () => {
    const changes = [];
    function App() {
      const [v, setV] = React.useState('');
      return React.createElement('div', null,
        React.createElement('label', { htmlFor: 'fb' }, 'Feedback'),
        React.createElement('textarea', { id: 'fb', value: v, onChange: (e) => { changes.push(e.target.value); setV(e.target.value); } }),
        React.createElement('output', { id: 'mirror' }, v));
    }
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(App)); });
    const el = dom.findFeedbackField(document);

    // Control: a naive assignment is swallowed by React's value tracker.
    await act(async () => { el.value = 'naive'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(changes).toEqual([]);

    await act(async () => { dom.fillField(el, 'Chosen feedback', 'replace'); });
    expect(changes).toEqual(['Chosen feedback']);
    expect(document.getElementById('mirror').textContent).toBe('Chosen feedback');
    expect(el.value).toBe('Chosen feedback'); // survives React's re-render
    await act(async () => { root.unmount(); });
  });
});
