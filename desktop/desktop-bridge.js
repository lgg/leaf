/* Leaf desktop only. This file is never loaded by the website or PWA. */
(function () {
  'use strict';
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return;
  const invoke = tauri.core.invoke;
  const releaseUrl = 'https://github.com/lgg/leaf/releases';
  let restoring = true;
  let sessionTimer = null;
  let pendingSession = Promise.resolve();
  let closing = false;

  function current() { return getActiveTab(); }
  function safeError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function sessionSnapshot() {
    saveActiveTabState();
    const live = tabs.filter(tab => !tab.readonly);
    return {
      activeIndex: Math.max(0, live.findIndex(tab => tab.id === activeTabId)),
      tabs: live.map(tab => ({
        path: tab.nativePath || null,
        name: tab.name,
        label: tab.label || '',
        browserTitle: tab.browserTitle || '',
        dirty: Boolean(tab.dirty),
        revision: tab.nativeRev || null,
        // Keep recovery drafts separately. Never treat snapshots as the disk file.
        draft: tab.dirty || !tab.nativePath ? tab.content : null
      }))
    };
  }
  function storeSession() {
    if (restoring) return pendingSession;
    const snapshot = sessionSnapshot();
    pendingSession = pendingSession.catch(() => {}).then(() =>
      invoke('desktop_save_session', {session: snapshot})
    );
    pendingSession.catch(err => workspaceNotice('Native session recovery failed: ' + safeError(err)));
    return pendingSession;
  }
  function scheduleSession() {
    if (restoring) return;
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(storeSession, 450);
  }
  async function flushSession() {
    clearTimeout(sessionTimer);
    await storeSession();
  }

  // The editor already calls scheduleWorkspaceSave whenever tabs, content or
  // labels change. Reuse that event, rather than changing web autosave logic.
  const browserSchedule = scheduleWorkspaceSave;
  scheduleWorkspaceSave = function () {
    browserSchedule();
    scheduleSession();
  };

  function showDocument(doc) {
    if (!doc || !doc.path) return;
    saveActiveTabState();
    const existing = tabs.find(tab => tab.nativePath === doc.path);
    if (existing) {
      switchTab(existing.id);
      return;
    }
    let tab = current();
    if (!tab || tab.readonly || tab.nativePath || tab.dirty || tab.content.trim()) {
      newTab();
      tab = current();
    }
    tab.name = doc.name;
    tab.content = doc.content;
    tab.nativePath = doc.path;
    tab.nativeRev = doc.revision;
    tab.dirty = false;
    tab.handle = null;
    editor.value = doc.content;
    document.getElementById('filename-input').value = doc.name;
    fileHandle = null;
    isDirty = false;
    lastSavedContent = doc.content;
    editor.readOnly = false;
    seedMilestones(doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0);
    updateStats();
    if (currentMode !== 'write') renderPreview();
    renderTabs();
    scheduleWorkspaceSave();
    editor.focus();
  }

  async function open() {
    try {
      const doc = await invoke('desktop_open_dialog');
      if (doc) showDocument(doc);
      return !!doc;
    } catch (error) {
      alert('Could not open file: ' + safeError(error));
      return false;
    }
  }

  async function exportZip() {
    saveActiveTabState();
    const files = getMarkdownExportEntries(tabs);
    if (!files.length) return false;
    try {
      const blob = makeMarkdownZip(files);
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      return !!(await invoke('desktop_export_zip', {bytes}));
    } catch (error) {
      alert('Could not export Markdown ZIP: ' + safeError(error));
      return false;
    }
  }

  async function save(saveAs) {
    const tab = current();
    if (!tab || tab.readonly) return false;
    const tabId = tab.id;
    const contents = editor.value;
    const suggestedName = document.getElementById('filename-input').value || 'untitled.md';
    try {
      const doc = await invoke('desktop_save', {
        path: tab.nativePath || null,
        expectedRevision: tab.nativeRev || null,
        content: contents,
        suggestedName: suggestedName,
        saveAs: !!saveAs
      });
      if (!doc) return false; // cancelled OS dialog
      const updatedTab = tabs.find(item => item.id === tabId);
      if (!updatedTab) return false;
      updatedTab.nativePath = doc.path;
      updatedTab.nativeRev = doc.revision;
      finishDocumentSave(tabId, contents, null, doc.name);
      // If the user kept typing during a save, mark the newer text dirty.
      if (tabId === activeTabId && editor.value !== contents) {
        updatedTab.dirty = true;
        markDirty();
        renderTabs();
      }
      scheduleSession();
      return true;
    } catch (error) {
      alert('File was not saved: ' + safeError(error) +
        '\n\nYour draft is retained in Leaf. You can also use Save As.');
      return false;
    }
  }

  function restoredTab(item, id) {
    const saved = item.saved;
    const disk = item.disk;
    let content = disk ? disk.content : (saved.draft || '');
    let dirty = !disk && !!content;
    let nativePath = disk ? disk.path : null;
    let nativeRev = disk ? disk.revision : null;
    if (disk && saved.dirty && typeof saved.draft === 'string' &&
        saved.draft !== disk.content) {
      const externalChanged = !!saved.revision && saved.revision !== disk.revision;
      const answer = confirm(
        '"' + disk.name + '" has an unsaved recovery draft.' +
        (externalChanged ? '\nThe file also changed outside Leaf.' : '') +
        '\n\nOK: recover the draft as unsaved edits.' +
        '\nCancel: load the current file from disk.'
      );
      if (answer) {
        content = saved.draft;
        dirty = true;
      }
    }
    if (!disk && saved.path) {
      // Missing path: retain the recovery draft but NEVER bind it to a missing file.
      nativePath = null;
      nativeRev = null;
      dirty = true;
    }
    return {
      id,
      name: disk ? disk.name : (saved.name || 'untitled.md'),
      label: saved.label || '',
      browserTitle: saved.browserTitle || '',
      content,
      handle: null,
      dirty,
      readonly: false,
      nativePath,
      nativeRev
    };
  }

  async function restore() {
    try {
      const data = await invoke('desktop_restore');
      if (data.tabs && data.tabs.length) {
        const restored = data.tabs.map((item, index) => restoredTab(item, index + 1));
        const missing = data.tabs.filter(item => item.error);
        tabs = restored;
        const selected = Math.min(data.activeIndex || 0, restored.length - 1);
        activeTabId = restored[selected].id;
        nextTabId = restored.length + 1;
        const tab = current();
        editor.value = tab.content;
        editor.readOnly = false;
        document.getElementById('filename-input').value = tab.name;
        fileHandle = null;
        isDirty = tab.dirty;
        lastSavedContent = tab.dirty ? '' : tab.content;
        seedMilestones(tab.content.trim() ? tab.content.trim().split(/\s+/).length : 0);
        updateStats();
        if (currentMode !== 'write') renderPreview();
        renderTabs();
        if (missing.length) {
          workspaceNotice(missing.length + ' previously open file(s) are unavailable. ' +
            'Recovery drafts are preserved as untitled documents. Use Save As to choose new paths.');
        }
      }
      for (const doc of data.launchFiles || []) showDocument(doc);
    } catch (error) {
      workspaceNotice('Could not restore native files. Existing browser drafts remain available. ' + safeError(error));
    } finally {
      restoring = false;
      scheduleSession();
    }
  }

  window.leafDesktop = {open, exportZip, save: () => save(false), saveAs: () => save(true)};

  const saveAsButton = document.getElementById('btn-desktop-save-as');
  if (saveAsButton) saveAsButton.addEventListener('click', () => save(true));

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'o' || (key === 's' && event.shiftKey)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === 'o') open();
      else save(true);
    }
  }, true);

  const releaseButton = document.getElementById('btn-desktop-releases');
  if (releaseButton) releaseButton.addEventListener('click', () => {
    if (confirm('Open GitHub Releases to see available desktop downloads and release notes?')) {
      // No downloads or installs happen without the user's explicit action.
      window.open(releaseUrl, '_blank', 'noopener,noreferrer');
    }
  });

  if (tauri.window && tauri.window.getCurrentWindow) {
    const win = tauri.window.getCurrentWindow();
    win.onCloseRequested(async event => {
      if (closing) return;
      event.preventDefault();
      saveActiveTabState();
      if (tabs.some(tab => tab.dirty) &&
          !confirm('Unsaved edits exist. Leaf will keep recovery drafts. Exit without saving them to disk?')) {
        return;
      }
      try {
        await flushSession();
        closing = true;
        await win.destroy();
      } catch (error) {
        alert('Cannot save the recovery session. Leaf remains open: ' + safeError(error));
      }
    }).catch(() => {});
  }

  // OS-native drop event: unlike browser File API, this retains the real file path.
  if (tauri.webview && tauri.webview.getCurrentWebview) {
    tauri.webview.getCurrentWebview().onDragDropEvent(async event => {
      if (event.payload.type !== 'drop') return;
      for (const path of event.payload.paths || []) {
        if (!/\.(md|txt)$/i.test(path)) continue;
        try {
          const doc = await invoke('desktop_open_path', {path});
          showDocument(doc);
        } catch (error) {
          alert('Could not open dropped file: ' + safeError(error));
        }
      }
    }).catch(() => {});
  }

  restore();
})();
