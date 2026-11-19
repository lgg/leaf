# Leaf — distraction-free Markdown editor

**Fork version: v1.9.0-lgg.1** · Based on upstream **v1.7**. Original historical version numbering remains in [README.txt](README.txt); newer fork changes are recorded in [CHANGELOG.md](CHANGELOG.md).

Lightweight, single-file writing tool with multiple documents, focus mode, themes, offline support and local draft recovery.

**Original by [Dan](https://github.com/uncle-jasper)** — [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf).  
**updated by [lgg](https://github.com/lgg)** — [lgg/leaf](https://github.com/lgg/leaf).

## Open editor

[Open the lgg fork online](https://lgg.github.io/leaf/editor.html) *(GitHub Pages deployment from `main`)* · [Original author's editor](https://uncle-jasper.github.io/leaf/editor.html)

You can also download `editor.html` and open it in a browser; no build tools or account are required.

## Install as an offline mobile PWA

- **iPhone / iPad:** Open the fork URL in Safari, tap **Share → Add to Home Screen**, and select **Open as Web App** if offered.
- **Android:** Open the fork URL in Chrome and use **Install app** or **Add to Home Screen** from the menu.
- **Offline:** The first successful online visit registers a service worker and caches the editor, manifest and icons. After it completes, the installed app can launch without internet. Some remote fonts may fall back to bundled/system fonts.
- **Data:** Documents and settings are local to that browser/PWA installation and do **not** sync between devices. They may be removed if website data is cleared. Export important drafts as Markdown backups.

### Mobile writing experience

On iPhone, Android and touch tablets, Leaf uses a **distraction-free writing canvas** by default. The desktop header and tabs are hidden, and the status bar is hidden on mobile even when desktop counters are enabled.

**Tap the bottom edge** to reveal a four-action dock. It automatically disappears after about four seconds:

- **Docs**: create, switch or close documents in a bottom sheet.
- **View**: toggle Markdown writing/preview.
- **Save**: download/save the active document.
- **More**: open Markdown, export all documents as a ZIP, settings, focus and About.

Settings → Editor → **Mobile display** lets you turn on the document heading, turn on the mobile status bar, or disable automatic dock hiding. All preferences persist across sessions. Settings → Current document also lets you edit the filename, tab label and browser title separately.

The interface handles safe-area insets and avoids floating controls over the on-screen keyboard. Mobile-specific UI and keyboard behaviors are covered by regression tests, though physical-device checks in Safari/Chrome are still recommended.

## Features in the fork

- **Quiet writing:** toggle word, character, line, reading-time and cursor counters separately; the footer vanishes when all are hidden; optionally hide the empty-page hint.
- **Black theme:** pure black background with a grey caret; monospaced by default.
- **Fonts:** iA Writer, JetBrains Mono, Inconsolata, Share Tech Mono, Roboto Mono, Open Sans, Times New Roman and Arial.
- **Autosave:** debounced at 350 ms after changes, flushed at most every 2 s during continuous typing; unchanged snapshots are skipped. Saves also flush on tab hide/close. Drafts, document labels, browser titles and preferences survive browser restarts.
- **Concurrent editor safety:** when another Leaf window changes the same workspace, edits are stored in a separate recovery copy instead of silently overwriting it.
- **Multiple documents:** internal tab labels and browser-tab titles can be named independently from Markdown filenames. Double-click an in-app tab to rename it.
- **Export all:** the `all .md` toolbar button produces a ZIP containing one Markdown file per open editable document, including non-ASCII text and unique filenames.

**Back up important writing:** Browser `localStorage` is convenient but can be cleared by the browser or user. Export files for durable storage. Browser storage is scoped to each website, so drafts made on the upstream author's URL are not shared with this fork's URL.

For the full shortcut list and upstream details see [README.txt](README.txt). Run the zero-dependency regression suite with `node --test tests/leaf.test.cjs`.

## Attribution

Leaf remains credited to its original author, Dan. This fork is an independent set of updates by lgg, and is not the original author's deployment.
