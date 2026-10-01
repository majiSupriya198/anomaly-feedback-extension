(function () {
  'use strict';
  const { authz, store, apiClient, feedbackService } = AFX;
  const service = feedbackService.createService({ api: apiClient.createApi(apiClient.messageTransport), store, authz });
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => service.saveSettings({ insertMode: r.value })));
  document.getElementById('confirm').addEventListener('change', (e) => service.saveSettings({ confirmReplace: e.target.checked }));
  service.getSettings().then((s) => {
    document.querySelector('input[name=mode][value=' + s.insertMode + ']').checked = true;
    document.getElementById('confirm').checked = s.confirmReplace;
  });
  service.getRole().then((role) => {
    if (authz.can(role, authz.ACTIONS.VIEW_INACTIVE)) {
      document.getElementById('adminCard').hidden = false;
      document.getElementById('openAdmin').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'afx.openAdmin' }));
    }
  });
})();
