/* Leaf custom desktop title bar. Never loaded by the browser or PWA.
 * System close() intentionally raises onCloseRequested in desktop-bridge.js,
 * where unsaved-document protection and recovery-session flushing live. */
(function () {
  'use strict';
  const api = window.__TAURI__;
  if (!api || !api.window || typeof api.window.getCurrentWindow !== 'function') return;
  const appWindow = api.window.getCurrentWindow();
  const caption = document.getElementById('desktop-titlebar');
  if (!caption) return;

  function notifyWindowError(action, error) {
    // Show a concise message; do not leak environment paths from native errors.
    const message = 'Cannot ' + action + ' the Leaf window.';
    if (typeof workspaceNotice === 'function') workspaceNotice(message);
    else console.warn(message);
  }
  function bindControl(id, action, callback) {
    const button = document.getElementById(id);
    if (!button) throw new Error('Missing desktop caption button: ' + id);
    button.addEventListener('click', async event => {
      event.stopPropagation();
      try { await callback(); }
      catch (error) { notifyWindowError(action, error); }
    });
  }

  bindControl('desktop-window-minimize', 'minimize', () => appWindow.minimize());
  bindControl('desktop-window-maximize', 'maximize', async () => {
    await appWindow.toggleMaximize();
    await syncMaximizeLabel();
  });
  // Do not call destroy(): close() must run the native onCloseRequested guard.
  bindControl('desktop-window-close', 'close', () => appWindow.close());

  async function syncMaximizeLabel() {
    try {
      const isMax = await appWindow.isMaximized();
      const button = document.getElementById('desktop-window-maximize');
      if (!button) return;
      const label = isMax ? 'Restore window' : 'Maximize';
      button.title = label;
      button.setAttribute('aria-label', label);
    } catch (_) { /* Caption operation still works if state query is unavailable. */ }
  }
  // Tauri itself implements dragging/double-click maximize only on nodes marked
  // data-tauri-drag-region. Do not attach duplicate mouse handlers to caption.
  if (typeof appWindow.onResized === 'function') {
    appWindow.onResized(() => { syncMaximizeLabel(); }).catch(() => {});
  }
  syncMaximizeLabel();
})();