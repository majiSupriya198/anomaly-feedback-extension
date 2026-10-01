/* Admin UI. Visibility of controls follows authz.can(); the service re-checks every write, and the
 * backend is the final authority. A normal user sees only the access message below. */
(function () {
  'use strict';
  const { authz, store, apiClient, feedbackService } = AFX;
  const service = feedbackService.createService({ api: apiClient.createApi(apiClient.messageTransport), store, authz, localIdentity: apiClient.messageWhoAmI });
  const $ = (id) => document.getElementById(id);
  let all = [];
  let editing = null; // { id|null }
  let confirmDel = null;

  function msg(t, err) { $('msg').textContent = t || ''; $('msg').className = err ? 'err' : ''; }
  function mk(tag, props, kids) {
    const n = document.createElement(tag);
    for (const k in props || {}) { if (k === 'text') n.textContent = props[k]; else if (k === 'class') n.className = props[k]; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]); else n.setAttribute(k, props[k]); }
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
  }
  const run = (p, ok) => p.then((r) => { if (ok) msg(ok); return r; }).catch((e) => msg(e.message, true));

  async function load() {
    all = await service.list({ includeInactive: true, includeDeleted: true });
    const cur = $('cat').value;
    $('cat').textContent = '';
    $('cat').appendChild(mk('option', { value: '', text: 'All categories' }));
    service.categories(all).forEach((c) => $('cat').appendChild(mk('option', { value: c.name, text: c.name + ' (' + c.count + ')' })));
    $('cat').value = cur;
    render();
  }

  function parseCats(s) { return s.split(',').map((x) => x.trim()).filter(Boolean); }

  function editorRow(item) {
    const ta = mk('textarea', { 'aria-label': 'Feedback text' }); ta.value = item.text || '';
    const cats = mk('input', { type: 'text', 'aria-label': 'Categories (comma separated)', placeholder: 'e.g. extract.promotionText' });
    cats.value = (item.attributes || []).join(', ');
    const err = mk('div', { class: 'sub', style: 'color:#c0392b' });
    const save = mk('button', { class: 'primary', text: 'Save', onclick: async () => {
      try {
        if (item.id) await service.update(item.id, { text: ta.value, attributes: parseCats(cats.value) });
        else await service.create({ text: ta.value, attributes: parseCats(cats.value) });
        editing = null; msg('Saved.'); await load();
      } catch (e) { err.textContent = e.message; }
    } });
    return mk('tr', null, [mk('td', { colspan: '4' }, [ta, mk('div', null, [cats]), err, mk('div', null, [save, document.createTextNode(' '), mk('button', { text: 'Cancel', onclick: () => { editing = null; render(); } })])])]);
  }

  function render() {
    const items = all.filter((i) => (i.deletedAt ? $('showDeleted').checked : (i.active || $('showInactive').checked)));
    const hits = service.search(items, $('q').value, { category: $('cat').value });
    $('count').textContent = hits.length + ' shown of ' + all.length + ' total';
    const body = $('rows'); body.textContent = '';
    if (editing && !editing.id) body.appendChild(editorRow({}));
    hits.forEach((it) => {
      if (editing && editing.id === it.id) { body.appendChild(editorRow(it)); return; }
      const pill = it.deletedAt ? mk('span', { class: 'pill del', text: 'Deleted' }) : mk('span', { class: 'pill ' + (it.active ? 'on' : 'off'), text: it.active ? 'Active' : 'Inactive' });
      const acts = [];
      if (it.deletedAt) {
        if (authz.can(role, authz.ACTIONS.RESTORE)) acts.push(mk('button', { text: 'Restore', onclick: async () => { await run(service.restore(it.id), 'Restored.'); load(); } }));
      } else {
        if (authz.can(role, authz.ACTIONS.UPDATE)) acts.push(mk('button', { text: 'Edit', onclick: () => { editing = { id: it.id }; render(); } }));
        if (authz.can(role, authz.ACTIONS.TOGGLE)) acts.push(mk('button', { text: it.active ? 'Disable' : 'Enable', onclick: async () => { await run(service.setActive(it.id, !it.active), it.active ? 'Disabled.' : 'Enabled.'); load(); } }));
        if (authz.can(role, authz.ACTIONS.DELETE)) acts.push(confirmDel === it.id
          ? mk('span', null, [mk('button', { class: 'danger', text: 'Confirm delete', onclick: async () => { confirmDel = null; await run(service.remove(it.id), 'Deleted (can be restored).'); load(); } }), mk('button', { text: 'Keep', onclick: () => { confirmDel = null; render(); } })])
          : mk('button', { text: 'Delete', onclick: () => { confirmDel = it.id; render(); } }));
      }
      body.appendChild(mk('tr', { class: it.active && !it.deletedAt ? '' : 'muted', 'data-id': it.id }, [
        mk('td', { class: 'text', text: it.text }), mk('td', { text: it.attributes.join(', ') }), mk('td', null, [pill]), mk('td', { class: 'acts' }, acts),
      ]));
    });
  }

  let role = 'user';
  async function init() {
    const id = await service.getIdentity(true);
    role = id.role;
    if (!authz.can(role, authz.ACTIONS.VIEW_INACTIVE)) {
      $('who').textContent = id.email ? 'Chrome account: ' + id.email : 'No Chrome account detected.';
      $('gate').hidden = false;
      $('gate').textContent = id.email
        ? 'Admin access is required to manage feedback. Your Chrome account (' + id.email + ') is not an admin.'
        : 'Admin access is required. Sign in to Chrome with your CommerceIQ account to be recognised.';
      return; // admin controls are never rendered or wired up
    }
    $('who').textContent = 'Signed in' + (id.email ? ' as ' + id.email : '') + ' (admin' + (id.mode === 'local' ? ', local mode' : '') + ').';
    if (id.mode === 'local') {
      $('notice').hidden = false;
      $('notice').textContent = 'No feedback server is connected. Your changes are saved in THIS browser only and are not shared. To share them: click Export JSON, then run "npm run publish:list -- <file>" in the repo and push, so the team gets them with the next extension update.';
    }
    $('app').hidden = false;
    $('q').addEventListener('input', render);
    $('cat').addEventListener('change', render);
    $('showInactive').addEventListener('change', render);
    $('showDeleted').addEventListener('change', render);
    $('add').addEventListener('click', () => { editing = { id: null }; render(); });
    $('refresh').addEventListener('click', async () => { const r = await service.sync(); msg(r.ok ? 'Refreshed (' + r.count + ' items).' : 'Server unreachable; showing cached data.', !r.ok); load(); });
    $('export').addEventListener('click', async () => {
      try {
        const blob = new Blob([await service.exportAll()], { type: 'application/json' });
        const a = mk('a', { href: URL.createObjectURL(blob), download: 'feedback-export.json' });
        document.body.appendChild(a); a.dispatchEvent(new MouseEvent('click')); a.remove();
      } catch (e) { msg(e.message, true); }
    });
    const r = await service.sync();
    if (!r.ok) msg('Server unreachable; showing cached data. Changes will fail until it is back.', true);
    await load();
  }
  init().catch((e) => { $('who').textContent = e.message; });
})();
