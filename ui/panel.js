/* SUGGESTION UI: a read-only Shadow-DOM panel (search, category filter, select).
 * It has NO edit controls: editing lives in admin/admin.html, which only admins can use.
 * It reads through the injected `service` and reports choices through callbacks. It never touches
 * the Anomaly Hub DOM and never calls .click()/.submit(). */
(function (root) {
  'use strict';

  const MAX_ROWS = 100;
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:'DM Sans',system-ui,-apple-system,Segoe UI,sans-serif}
.launcher{position:fixed;left:20px;bottom:20px;z-index:2147483000;background:#1F22B2;color:#fff;border:0;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.launcher:hover{background:#C231FF}
.launcher .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-left:8px;background:#f5a524}
.launcher .dot.ok{background:#2ecc71}
.panel{position:fixed;left:20px;bottom:64px;z-index:2147483000;width:440px;max-width:calc(100vw - 40px);height:min(560px,calc(100vh - 100px));display:flex;flex-direction:column;background:#fff;color:#000;border:1px solid #d6d8e6;border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.4);font-size:13px}
.panel[hidden]{display:none}
header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#210235;color:#fff;border-radius:12px 12px 0 0}
header h1{flex:1;margin:0;font-size:14px;font-weight:700}
header button{background:transparent;color:#fff;border:0;font-size:16px;cursor:pointer}
.bar{padding:8px 12px;border-bottom:1px solid #eceef8;display:flex;flex-direction:column;gap:6px}
input[type=search],textarea.edit{width:100%;padding:7px 9px;border:1px solid #b8bcd8;border-radius:6px;font-size:13px;color:#000;background:#fff}
textarea.edit{min-height:90px;resize:vertical}
.row2{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.chip{padding:2px 8px;border-radius:999px;background:#eef3ff;color:#1F22B2;border:1px solid #5AAFFE;font-size:11px;cursor:pointer}
.chip.off{background:#fff;color:#555;border-color:#ccc}
.btn{padding:5px 10px;border-radius:6px;border:1px solid #1F22B2;background:#fff;color:#1F22B2;font-size:12px;cursor:pointer}
.btn.primary{background:#1F22B2;color:#fff}
.btn.danger{border-color:#c0392b;color:#c0392b}
.btn:hover{filter:brightness(.95)}
.list{flex:1;overflow:auto;padding:4px 0}
.item{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #f0f1f8;cursor:pointer}
.item:hover,.item:focus{background:#f6f0ff;outline:none}
.item .t{flex:1;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;line-height:1.35}
.item .meta{font-size:10px;color:#6b6f8a;margin-top:3px}
.item.inactive{opacity:.6;background:#fafafa}
.badge{display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;background:#eee;color:#555;font-size:10px;font-weight:600}
.status{padding:6px 12px;font-size:12px;border-top:1px solid #eceef8;min-height:28px;color:#210235}
.status.err{color:#c0392b}
.empty{padding:20px;text-align:center;color:#6b6f8a}
footer{display:flex;gap:6px;padding:8px 12px;border-top:1px solid #eceef8}
footer .sp{flex:1}
`;

  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    }
    (children || []).forEach((c) => c && n.appendChild(c));
    return n;
  }

  /** deps: { service, onSelect(item)->{ok,copied}|Promise, onManage() } */
  function createPanel(deps) {
    const service = deps.service;
    const host = el('div', { 'data-afx-host': '1', id: 'afx-feedback-host' });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(el('style', { text: CSS }));

    const state = { all: [], uses: {}, role: 'user', query: '', category: '', detected: '', filterOn: false, open: false, fieldFound: false };

    const dot = el('span', { class: 'dot' });
    const launcher = el('button', { class: 'launcher', type: 'button', 'aria-expanded': 'false', onclick: () => toggle() },
      [document.createTextNode('\uD83D\uDCA1 Suggested Feedback'), dot]);
    const search = el('input', { type: 'search', placeholder: 'Search feedback\u2026', 'aria-label': 'Search feedback', oninput: onSearch });
    const chips = el('div', { class: 'row2' });
    const list = el('div', { class: 'list', role: 'listbox' });
    const status = el('div', { class: 'status', role: 'status' });
    const footer = el('footer', null, []);
    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Suggested feedback', hidden: '' }, [
      el('header', null, [el('h1', { text: 'Suggested feedback' }), el('button', { type: 'button', 'aria-label': 'Close', text: '\u2715', onclick: () => toggle(false) })]),
      el('div', { class: 'bar' }, [search, chips]), list, status, footer,
    ]);
    shadow.appendChild(panel);
    shadow.appendChild(launcher);
    ['keydown', 'keyup', 'keypress'].forEach((t) => panel.addEventListener(t, (e) => e.stopPropagation()));

    let timer = null;
    function onSearch() { clearTimeout(timer); timer = setTimeout(() => { state.query = search.value; renderList(); }, 80); }
    function say(msg, isErr) { status.textContent = msg || ''; status.className = 'status' + (isErr ? ' err' : ''); }

    async function reload() {
      const role = await service.getRole();
      state.role = role;
      // Admins see disabled items too (clearly marked); everyone else only active ones.
      state.all = await service.list(role === 'admin' ? { includeInactive: true } : {});
      state.uses = await service.getUses();
      render();
    }

    function renderFooter() {
      footer.textContent = '';
      footer.appendChild(el('span', { class: 'sp' }));
      if (state.role === 'admin') footer.appendChild(el('button', { class: 'btn', type: 'button', text: 'Manage feedback\u2026', onclick: () => deps.onManage && deps.onManage() }));
    }

    function renderChips() {
      chips.textContent = '';
      const cats = service.categories(state.all).slice(0, 6);
      const add = (name, label, on) => chips.appendChild(el('button', {
        class: 'chip' + (on ? '' : ' off'), type: 'button', text: label,
        onclick: () => { state.category = on ? '' : name; state.filterOn = !!state.category; renderChips(); renderList(); },
      }));
      if (state.detected && !cats.some((c) => c.name.toLowerCase() === state.detected.toLowerCase())) cats.unshift({ name: state.detected, count: 0 });
      cats.forEach((c) => add(c.name, (state.category.toLowerCase() === c.name.toLowerCase() ? '\u2713 ' : '') + c.name.replace(/^extract\./, ''), state.category.toLowerCase() === c.name.toLowerCase()));
    }

    function row(item) {
      const inactive = !item.active;
      const body = el('div', { class: 't' });
      if (inactive) body.appendChild(el('span', { class: 'badge', text: 'Inactive' }));
      body.appendChild(document.createTextNode(item.text));
      const meta = el('div', { class: 'meta', text: [item.attributes.join(', '), state.uses[item.id] ? 'used ' + state.uses[item.id] + '\u00D7' : ''].filter(Boolean).join(' \u00B7 ') });
      const r = el('div', { class: 'item' + (inactive ? ' inactive' : ''), role: 'option', tabindex: '0', 'data-id': item.id, 'aria-disabled': inactive ? 'true' : 'false',
        onclick: () => choose(item), onkeydown: (e) => { if (e.key === 'Enter' && e.target === r) choose(item); } }, [el('div', { style: 'flex:1;min-width:0' }, [body, meta])]);
      return r;
    }

    async function choose(item) {
      if (!item.active) { say('This feedback is inactive and cannot be inserted.', true); return; }
      const res = await deps.onSelect(item);
      if (res && res.ok) { say('Inserted. Review it, then submit manually.'); service.markUsed(item.id); }
      else if (res && res.copied) say('Feedback field not found. Text copied to clipboard instead.');
      else say('Feedback field not found, and the clipboard is unavailable.', true);
    }

    function renderList() {
      list.textContent = '';
      const hits = service.search(state.all, state.query, { category: state.category, uses: state.uses });
      if (!hits.length) list.appendChild(el('div', { class: 'empty', text: state.all.length ? 'No matching feedback.' : 'No feedback available.' }));
      hits.slice(0, MAX_ROWS).forEach((h) => list.appendChild(row(h)));
      if (hits.length > MAX_ROWS) list.appendChild(el('div', { class: 'empty', text: (hits.length - MAX_ROWS) + ' more. Refine your search.' }));
    }
    function render() { renderFooter(); renderChips(); renderList(); }

    function toggle(force) {
      state.open = typeof force === 'boolean' ? force : !state.open;
      if (state.open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
      launcher.setAttribute('aria-expanded', String(state.open));
      if (state.open) { reload().then(() => search.focus()).catch((e) => say(e.message, true)); }
    }

    return {
      host, toggle, reload,
      update(info) {
        state.fieldFound = !!info.fieldFound;
        dot.className = 'dot' + (state.fieldFound ? ' ok' : '');
        launcher.title = state.fieldFound ? 'Feedback field detected' : 'Feedback field not visible yet (open the False Positive form)';
        if (info.attribute !== state.detected) {
          state.detected = info.attribute || '';
          const has = state.all.some((i) => i.attributes.some((a) => a.toLowerCase() === state.detected.toLowerCase()));
          state.category = has ? state.detected : '';
          if (state.open) render();
        }
      },
      isOpen: () => state.open,
    };
  }

  root.AFX = root.AFX || {};
  root.AFX.createPanel = createPanel;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createPanel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
