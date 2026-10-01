(function () {
  'use strict';
  const { authz, store, apiClient, feedbackService } = AFX;
  const service = feedbackService.createService({ api: apiClient.createApi(apiClient.messageTransport), store, authz });
  const q = document.getElementById('q'), list = document.getElementById('list'), msg = document.getElementById('msg');
  let all = [];
  function render() {
    list.textContent = '';
    service.search(all, q.value, {}).slice(0, 50).forEach((it) => {
      const d = document.createElement('div');
      d.className = 'item'; d.textContent = it.text; d.title = 'Click to copy';
      d.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(it.text); msg.textContent = 'Copied. Paste it into the Feedback field.'; } catch (e) { msg.textContent = 'Copy failed.'; }
      });
      list.appendChild(d);
    });
  }
  q.addEventListener('input', render);
  service.list().then((l) => { all = l; render(); });
})();
