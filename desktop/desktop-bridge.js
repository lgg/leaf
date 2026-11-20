/* Leaf desktop only. This file is never loaded by the website or PWA. */
(function () {
  'use strict';
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') return;
  const invoke = tauri.core.invoke;
  let restoring = true;
  let sessionTimer = null;
  let pendingSession = Promise.resolve();
  let saveQueue = Promise.resolve();
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

  // Reuse editor change notifications but persist desktop tabs ONLY through
  // the Tauri app-data session. Browser storage would duplicate private files.
  scheduleWorkspaceSave = function () {
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
    tab.nativeEol = doc.lineEnding || 'lf';
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
        saveAs: !!saveAs,
        lineEnding: tab.nativeEol || 'lf'
      });
      if (!doc) return false; // cancelled OS dialog
      const updatedTab = tabs.find(item => item.id === tabId);
      if (!updatedTab) return false;
      updatedTab.nativePath = doc.path;
      updatedTab.nativeRev = doc.revision;
      updatedTab.nativeEol = doc.lineEnding || 'lf';
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

  // Native Save and Save As may wait for OS dialogs or filesystem writes.
  // Serialize requests to avoid two overlapping saves with the same revision.
  // A queued request captures the latest editor state when it actually starts.
  function queuedSave(saveAs) {
    const operation = saveQueue.catch(() => {}).then(() => save(saveAs));
    saveQueue = operation.catch(() => {});
    return operation;
  }

  function restoredTab(item, id, recoveryCopies) {
    const saved = item.saved;
    const disk = item.disk;
    let content = disk ? disk.content : (saved.draft || '');
    let dirty = !disk && !!content;
    let nativePath = disk ? disk.path : null;
    let nativeRev = disk ? disk.revision : null;
    if (disk && saved.dirty && typeof saved.draft === 'string' &&
        saved.draft !== disk.content) {
      // A missing saved revision is also unsafe: never silently bind such
      // a draft to the latest disk contents as though the user approved them.
      const externalChanged = !saved.revision || saved.revision !== disk.revision;
      const answer = confirm(
        '"' + disk.name + '" has an unsaved recovery draft.' +
        (externalChanged ? '\nThe disk version has changed or cannot be verified.' : '') +
        '\n\nOK: recover the draft as unsaved edits.' +
        (externalChanged ? ' You must use Save As; the disk version will not be overwritten.' : '') +
        '\nCancel: load the current file from disk (draft retained separately).'
      );
      if (answer) {
        content = saved.draft;
        dirty = true;
        if (externalChanged) {
          // Recovery drafts must NOT gain authorization for an externally
          // modified document just because we reopened the disk version.
          nativePath = null;
          nativeRev = null;
          workspaceNotice('Externally changed file: recovered draft is detached. Use Save As.');
        }
      } else {
        // Choosing the current disk version must NEVER destroy an unsaved draft.
        // Keep it as a separate unbound document that can be saved with Save As.
        recoveryCopies.push({
          id: 0,
          name: disk.name.replace(/\.(md|txt)$/i, '') + ' (recovery).md',
          label: (saved.label || disk.name) + ' · recovery',
          browserTitle: '',
          content: saved.draft,
          handle: null,
          dirty: true,
          readonly: false,
          nativePath: null,
          nativeRev: null,
          nativeEol: disk.lineEnding || 'lf'
        });
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
      nativeRev,
      nativeEol: disk ? (disk.lineEnding || 'lf') : 'lf'
    };
  }

  async function restore() {
    try {
      const data = await invoke('desktop_restore');
      if (!(data.tabs && data.tabs.length) && !(data.launchFiles || []).length &&
          typeof restoreWorkspace === 'function' && restoreWorkspace()) {
        // One-time migration from older desktop previews that used browser storage.
        // These copies are UNBOUND drafts; never assume a path from the browser.
        for (const tab of tabs) {
          tab.nativePath = null;
          tab.nativeRev = null;
          tab.nativeEol = 'lf';
          if (!tab.readonly) tab.dirty = true;
        }
        isDirty = !!current()?.dirty;
        renderTabs();
        workspaceNotice('Older desktop drafts were recovered from browser storage. Save As to choose their file locations.');
      }
      if (data.tabs && data.tabs.length) {
        const recoveryCopies = [];
        const restored = data.tabs.map((item, index) => restoredTab(item, index + 1, recoveryCopies));
        const missing = data.tabs.filter(item => item.error);
        for (const copy of recoveryCopies) {
          copy.id = restored.length + 1;
          restored.push(copy);
        }
        tabs = restored;
        const selected = Math.min(data.activeIndex || 0, data.tabs.length - 1);
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
        const notices = [];
        if (missing.length) notices.push(missing.length +
          ' previously open file(s) are unavailable. Recovery drafts remain available.');
        if (recoveryCopies.length) notices.push(recoveryCopies.length +
          ' unsaved draft(s) were preserved as separate recovery tabs.');
        if (notices.length) workspaceNotice(notices.join(' ') + ' Use Save As to choose new paths.');
      }
      for (const doc of data.launchFiles || []) showDocument(doc);
    } catch (error) {
      workspaceNotice('Could not restore native files. Existing browser drafts remain available. ' + safeError(error));
    } finally {
      restoring = false;
      scheduleSession();
    }
  }

  window.leafDesktop = {open, exportZip, save: () => queuedSave(false), saveAs: () => queuedSave(true)};

  const saveAsButton = document.getElementById('btn-desktop-save-as');
  if (saveAsButton) saveAsButton.addEventListener('click', () => queuedSave(true));

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'o' || (key === 's' && event.shiftKey)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === 'o') open();
      else queuedSave(true);
    }
  }, true);

  const releaseButton = document.getElementById('btn-desktop-releases');
  if (releaseButton) releaseButton.addEventListener('click', async event => {
    event.preventDefault();
    if (confirm('Open GitHub Releases to review desktop downloads and release notes?')) {
      try { await invoke('desktop_show_releases'); }
      catch (error) { alert('Could not open releases: ' + safeError(error)); }
    }
  });

  // Never navigate the privileged editor WebView to untrusted Markdown links.
  // Open only safe HTTP(S) and mail links in the OS default application.
  document.addEventListener('click', event => {
    const link = event.target && event.target.closest && event.target.closest('a[href]');
    if (!link || link.id === 'btn-desktop-releases') return;
    const target = link.getAttribute('href') || '';
    if (target.startsWith('#')) return; // In-app About / help controls.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!/^(https?:\/\/|mailto:)/i.test(target)) {
      workspaceNotice('Only web and email links can be opened from Leaf desktop.');
      return;
    }
    invoke('desktop_open_external', {url:target}).catch(error => {
      workspaceNotice('Could not open external link: ' + safeError(error));
    });
  }, true);

  const checkButton = document.getElementById('btn-desktop-check-updates');
  const updateStatus = document.getElementById('desktop-update-status');
  if (checkButton && updateStatus) {
    checkButton.addEventListener('click', async () => {
      checkButton.disabled = true;
      updateStatus.textContent = 'Checking published releases…';
      try {
        const response = await fetch('https://api.github.com/repos/lgg/leaf/releases/latest', {
          headers: {'Accept': 'application/vnd.github+json'}
        });
        if (response.status === 404) {
          updateStatus.textContent = 'No published desktop release yet.';
        } else if (!response.ok) {
          updateStatus.textContent = 'Could not check releases (HTTP ' + response.status + ').';
        } else {
          const payload = await response.json();
          const latest = String(payload.tag_name || '').replace(/^v/i, '');
          const current = '1.10.0-lgg.1';
          const nums = v => v.split(/[^0-9]+/).filter(Boolean).map(Number);
          const parts = nums(latest), base = nums(current);
          const newer = parts.some((n, i) => n > (base[i] || 0) &&
            parts.slice(0, i).every((m, j) => m === (base[j] || 0)));
          updateStatus.textContent = newer
            ? 'A newer version (' + latest.slice(0, 40) + ') is available. Open GitHub Releases to review notes and download.'
            : 'Your app is current, or no newer stable release is published.';
        }
      } catch (error) {
        updateStatus.textContent = 'Release check unavailable. Open GitHub Releases manually.';
      } finally {
        checkButton.disabled = false;
      }
    });
  }

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
