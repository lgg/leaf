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
  let updateApproved = false;
  let sessionRecoveryBlocked = false;

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
    if (restoring || sessionRecoveryBlocked) return pendingSession;
    const snapshot = sessionSnapshot();
    pendingSession = pendingSession.catch(() => {}).then(() =>
      invoke('desktop_save_session', {session: snapshot})
    );
    pendingSession.catch(err => workspaceNotice('Native session recovery failed: ' + safeError(err)));
    return pendingSession;
  }
  function scheduleSession() {
    if (restoring || sessionRecoveryBlocked) return;
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(storeSession, 450);
  }
  async function flushSession() {
    clearTimeout(sessionTimer);
    if (sessionRecoveryBlocked) {
      saveActiveTabState();
      // Without a valid original recovery session, desktop_save_session must
      // never create a replacement. Only permit exit after drafts are saved.
      if (tabs.some(tab => !tab.readonly &&
          (tab.dirty || (!tab.nativePath && tab.content.trim())))) {
        throw new Error('Recovery storage is blocked. Use Save As for every unsaved draft before closing.');
      }
      return;
    }
    await storeSession();
  }

  // Reuse editor change notifications but persist desktop tabs ONLY through
  // the Tauri app-data session. Browser storage would duplicate private files.
  scheduleWorkspaceSave = function () {
    scheduleSession();
  };

  // A second OS Open must refresh a clean tab after an external disk edit.
  // Dirty documents always win: never clobber the user's unsaved changes.
  function refreshCleanTabFromDisk(tab, doc) {
    if (tab.dirty || tab.nativeRev === doc.revision) return false;
    tab.content = doc.content;
    tab.name = doc.name;
    tab.nativeRev = doc.revision;
    tab.nativeEol = doc.lineEnding || 'lf';
    return true;
  }

  function showDocument(doc) {
    if (!doc || !doc.path) return;
    saveActiveTabState();
    const existing = tabs.find(tab => tab.nativePath === doc.path);
    if (existing) {
      // Switch FIRST: switchTab snapshots the previously active editor.
      // Refreshing before switching would overwrite the freshly read content.
      switchTab(existing.id);
      if (refreshCleanTabFromDisk(existing, doc)) {
        editor.value = existing.content;
        document.getElementById('filename-input').value = existing.name;
        isDirty = false;
        lastSavedContent = existing.content;
        updateStats();
        if (currentMode !== 'write') renderPreview();
        renderTabs();
        scheduleSession();
        workspaceNotice('Updated this clean tab from the current file on disk.');
      } else if (existing.dirty && existing.nativeRev !== doc.revision) {
        workspaceNotice('File changed outside Leaf. Unsaved edits remain intact; use Save As to preserve them.');
      }
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
      sessionRecoveryBlocked = true;
      workspaceNotice('Native recovery cannot be read. The original recovery file has not been overwritten. Save As any new drafts before closing. ' + safeError(error));
    } finally {
      restoring = false;
      if (!sessionRecoveryBlocked) scheduleSession();
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

  // Installation mode is determined natively from the running executable location.
  // The renderer only receives "installed" or "portable", never local paths.
  invoke('desktop_installation_mode').then(mode => {
    const edition = mode === 'installed'
      ? 'Standalone desktop · Windows (Setup)' : 'Portable desktop · Windows (ZIP)';
    // Keep the permanent About tab and restored welcome window in sync.
    for (const id of ['about-install-type','about-dialog-install-type']) {
      const type = document.getElementById(id);
      if (type) type.textContent = edition;
    }
  }).catch(() => {
    for (const id of ['about-install-type','about-dialog-install-type']) {
      const type = document.getElementById(id);
      if (type) type.textContent = 'Desktop · Windows';
    }
  });

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

  // Native update broker: GitHub prereleases are discovered via trusted Windows
  // helper, asset content verified against GitHub SHA-256 before any handoff.
  // Never auto-download or auto-install, even if the check finds an update.
  const checkButton = document.getElementById('btn-desktop-check-updates');
  const updateStatus = document.getElementById('desktop-update-status');
  const updatePanel = document.getElementById('desktop-update-panel');
  const updateNotes = document.getElementById('desktop-update-notes');
  const downloadButton = document.getElementById('btn-desktop-update-download');
  const installButton = document.getElementById('btn-desktop-update-install');
  const updateNotice = document.getElementById('desktop-update-notice');
  const updateNoticeText = document.getElementById('desktop-update-notice-text');
  let availableUpdate = null;
  let downloadedUpdate = null;
  let checking = false;
  function hideUpdateNotice() {
    if (updateNotice) updateNotice.hidden = true;
  }
  const dismissUpdate = document.getElementById('desktop-update-dismiss');
  if (dismissUpdate) dismissUpdate.addEventListener('click', hideUpdateNotice);
  const openUpdate = document.getElementById('desktop-update-open');
  if (openUpdate) openUpdate.addEventListener('click', () => {
    if (typeof openAboutSettings === 'function') openAboutSettings();
    hideUpdateNotice();
  });
  async function checkUpdates(manual = false) {
    if (checking || closing) return;
    checking = true;
    if (checkButton) checkButton.disabled = true;
    if (manual && updateStatus) updateStatus.textContent = 'Checking GitHub Releases, including prereleases…';
    try {
      const info = await invoke('desktop_check_update');
      availableUpdate = info || null;
      downloadedUpdate = null;
      if (updatePanel) updatePanel.hidden = !info;
      if (installButton) installButton.hidden = true;
      if (downloadButton) { downloadButton.hidden = false; downloadButton.disabled = false; }
      if (!info) {
        hideUpdateNotice();
        if (updateStatus && manual) updateStatus.textContent = 'Leaf is up to date.';
        return;
      }
      if (!/^v[0-9]+[.][0-9]+[.][0-9]+-lgg[.][0-9]+(?:-windows-rc[.][0-9]+)?$/.test(info.tag)) {
        throw new Error('Invalid release version.');
      }
      if (updateNotes) updateNotes.textContent =
        'New version: ' + info.tag + '\n' +
        'Package: ' + (info.mode === 'portable' ? 'Portable ZIP' : 'Windows Setup') +
        ' · ' + Math.round(info.bytes / 1024 / 1024 * 10) / 10 + ' MB\n\n' +
        (info.notes || 'Release notes are available on GitHub.');
      if (updateStatus) updateStatus.textContent = 'Update available: ' + info.tag;
      if (updateNoticeText) updateNoticeText.textContent = 'Leaf ' + info.tag + ' is available';
      if (updateNotice) updateNotice.hidden = false;
    } catch (_) {
      if (manual && updateStatus) updateStatus.textContent =
        'Update check unavailable. Check your connection or use GitHub Releases.';
    } finally {
      checking = false;
      if (checkButton) checkButton.disabled = false;
    }
  }
  if (checkButton) checkButton.addEventListener('click', () => checkUpdates(true));
  if (downloadButton) downloadButton.addEventListener('click', async () => {
    if (!availableUpdate || downloadedUpdate) return;
    if (!confirm('Download verified Leaf ' + availableUpdate.tag +
          ' from the official GitHub Release? No installation will start yet.')) return;
    downloadButton.disabled = true;
    if (updateStatus) updateStatus.textContent = 'Downloading and verifying GitHub SHA-256…';
    try {
      const info = await invoke('desktop_download_update', {tag: availableUpdate.tag});
      if (!info || info.tag !== availableUpdate.tag) throw new Error('Version changed during download.');
      downloadedUpdate = info;
      downloadButton.hidden = true;
      if (installButton) {
        installButton.textContent = info.mode === 'portable' ? 'apply portable update' : 'run setup update';
        installButton.hidden = false;
      }
      if (updateStatus) updateStatus.textContent = 'Verified download ready. Install only when you confirm.';
    } catch (_) {
      if (updateStatus) updateStatus.textContent =
        'Download or integrity check failed. Files remain unchanged; retry.';
    } finally { downloadButton.disabled = false; }
  });
  if (installButton) installButton.addEventListener('click', async () => {
    if (!downloadedUpdate || closing) return;
    const mode = downloadedUpdate.mode;
    if (!confirm((mode === 'portable'
        ? 'Close Leaf, replace the portable EXE with the verified update and restart it?'
        : 'Close Leaf and launch the verified Setup installer for this user?') +
        '\n\nUnsaved drafts will be saved to recovery storage.')) return;
    installButton.disabled = true;
    try {
      // Protect all documents before launching a helper that must wait for exit.
      await flushSession();
      await invoke('desktop_apply_update', {tag: downloadedUpdate.tag});
      updateApproved = true;
      if (updateStatus) updateStatus.textContent = 'Closing Leaf safely to apply the update…';
      if (!tauri.window || !tauri.window.getCurrentWindow) throw new Error('Window API unavailable.');
      await tauri.window.getCurrentWindow().close();
    } catch (_) {
      updateApproved = false;
      if (updateStatus) updateStatus.textContent =
        'Update could not start safely. Your documents are intact; try again.';
      installButton.disabled = false;
    }
  });
  // One lightweight check after restoration, no silent downloads or repeated
  // polling. A manual Check updates button remains available in Settings → About.
  setTimeout(() => { checkUpdates(false).catch(() => {}); }, 2000);

  if (tauri.window && tauri.window.getCurrentWindow) {
    const win = tauri.window.getCurrentWindow();
    win.onCloseRequested(async event => {
      // Always stop the OS default close, even if another close request arrives
      // while the recovery session is still being written.
      event.preventDefault();
      if (closing) return;
      saveActiveTabState();
      if (!updateApproved && tabs.some(tab => tab.dirty) &&
          !confirm('Unsaved edits exist. Leaf will keep recovery drafts. Exit without saving them to disk?')) {
        return;
      }
      closing = true; // Guard before awaiting the asynchronous session write.
      try {
        await flushSession();
        await win.destroy();
      } catch (error) {
        closing = false; // Let the user retry after a failed session write.
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
